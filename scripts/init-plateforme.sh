#!/usr/bin/env bash
# =============================================================================
# Initialisation de la plateforme Talixman Range
#
# À lancer une fois après un clone, ou à chaque changement de poste de travail.
# Le script :
#   1. génère les secrets (jamais deux fois les mêmes, jamais de valeur par défaut)
#   2. crée les quatre fichiers .env à partir des .env.example
#   3. adapte les valeurs qui dépendent de la machine : adresse IP et chemin
#      absolu du projet
#   4. crée le premier superadmin (email et mot de passe passés en argument)
#
# Après ça : `docker compose --profile app up -d` et la plateforme est utilisable.
#
# L'envoi d'emails reste en mode « console » : les liens d'activation et de
# réinitialisation s'affichent dans les journaux de l'API. Aucune configuration
# SMTP n'est demandée.
#
# Usage :
#   ./scripts/init-plateforme.sh <email-superadmin> <mot-de-passe>
#   ./scripts/init-plateforme.sh --secrets-seulement   (régénère sans toucher au compte)
#   ./scripts/init-plateforme.sh --garder-secrets <email> <mdp>  (changement de poste)
# =============================================================================
set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORTAIL="$RACINE/talixman-auth"
ORCH="$RACINE/cyber-range-orchestrator"

rouge()  { printf '\033[0;31m%s\033[0m\n' "$*"; }
vert()   { printf '\033[0;32m%s\033[0m\n' "$*"; }
jaune()  { printf '\033[0;33m%s\033[0m\n' "$*"; }
titre()  { printf '\n\033[1m%s\033[0m\n' "$*"; }

# --- Analyse des arguments ---------------------------------------------------
GARDER_SECRETS=0
SECRETS_SEULEMENT=0
EMAIL=""
MOTDEPASSE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --garder-secrets)   GARDER_SECRETS=1; shift ;;
    --secrets-seulement) SECRETS_SEULEMENT=1; shift ;;
    -h|--help) sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) rouge "Option inconnue : $1"; exit 1 ;;
    *)  if [ -z "$EMAIL" ]; then EMAIL="$1"; else MOTDEPASSE="$1"; fi; shift ;;
  esac
done

if [ "$SECRETS_SEULEMENT" -eq 0 ]; then
  if [ -z "$EMAIL" ] || [ -z "$MOTDEPASSE" ]; then
    rouge "Il faut l'email et le mot de passe du superadmin."
    echo   "  Exemple : ./scripts/init-plateforme.sh admin@exemple.fr 'MonMotDePasse#2026'"
    echo   "  Ou       : ./scripts/init-plateforme.sh --secrets-seulement"
    exit 1
  fi
  # Contraintes vérifiées AVANT de générer quoi que ce soit : rien de pire que
  # de découvrir un mot de passe refusé après avoir tout reconfiguré.
  case "$EMAIL" in *@*.*) ;; *) rouge "Adresse email invalide : $EMAIL"; exit 1 ;; esac
  if [ ${#MOTDEPASSE} -lt 10 ]; then
    rouge "Le mot de passe doit faire au moins 10 caractères (règle du portail)."
    exit 1
  fi
fi

# --- Prérequis ---------------------------------------------------------------
titre "Vérification des prérequis"
for outil in docker openssl; do
  command -v "$outil" >/dev/null || { rouge "  $outil est requis mais absent."; exit 1; }
  echo "  $outil : présent"
done
docker compose version >/dev/null 2>&1 || { rouge "  docker compose (v2) est requis."; exit 1; }
echo "  docker compose : présent"

# --- Valeurs propres à cette machine ----------------------------------------
titre "Détection de l'environnement"

# Adresse par laquelle un NAVIGATEUR joindra la plateforme. Jamais localhost :
# depuis un autre poste, localhost désignerait le poste client. C'est la cause
# la plus fréquente de « je n'arrive pas à me connecter ».
IP_HOTE="$(ip -4 route get 1.1.1.1 2>/dev/null | grep -oP '(?<=src )[\d.]+' | head -1)"
[ -n "$IP_HOTE" ] || IP_HOTE="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP_HOTE" ] || { rouge "  Adresse IP introuvable — définir IP_HOTE=... et relancer."; exit 1; }
echo "  adresse IP        : $IP_HOTE"
echo "  racine du projet  : $RACINE"

# --- Secrets -----------------------------------------------------------------
titre "Secrets"
# Emplacement du coffre de secrets : HORS du dépôt, pour qu'aucune manipulation
# git (un `git add -f`, un .gitignore mal fusionné) ne puisse le publier.
# Surchargeable : TALIXMAN_SECRETS_FILE=/chemin/voulu ./scripts/init-plateforme.sh ...
FICHIER_SECRETS="${TALIXMAN_SECRETS_FILE:-$HOME/.talixman-secrets}"

# Migration depuis l'ancien emplacement, à l'intérieur du projet.
ANCIEN_FICHIER="$RACINE/.secrets-generes"
if [ -f "$ANCIEN_FICHIER" ] && [ ! -f "$FICHIER_SECRETS" ]; then
  mv "$ANCIEN_FICHIER" "$FICHIER_SECRETS"
  chmod 600 "$FICHIER_SECRETS"
  jaune "  Coffre déplacé hors du dépôt : $FICHIER_SECRETS"
fi

# Le répertoire peut ne pas exister si l'emplacement a été surchargé.
mkdir -p "$(dirname "$FICHIER_SECRETS")" 2>/dev/null || {
  rouge "  Impossible de créer $(dirname "$FICHIER_SECRETS") — droits insuffisants ?"
  exit 1
}

if [ "$GARDER_SECRETS" -eq 1 ] && [ -f "$FICHIER_SECRETS" ]; then
  # shellcheck source=/dev/null
  . "$FICHIER_SECRETS"
  echo "  réutilisés depuis $FICHIER_SECRETS"
  jaune "  (la base existante reste déchiffrable — c'est le but d'un changement de poste)"
else
  if [ -f "$FICHIER_SECRETS" ]; then
    jaune "  ATTENTION : de nouveaux secrets sont générés."
    jaune "  Les comptes existants deviendront INUTILISABLES : les secrets de"
    jaune "  double authentification sont chiffrés avec TOTP_ENC_KEY."
    jaune "  Pour conserver une base existante, relancer avec --garder-secrets."
    printf '  Continuer ? [o/N] '
    read -r reponse
    case "$reponse" in [oO]*) ;; *) echo "  Abandon."; exit 1 ;; esac
  fi
  TOTP_ENC_KEY="$(openssl rand -hex 32)"
  LAB_SSO_MASTER_KEY="$(openssl rand -hex 32)"
  ORCHESTRATOR_SERVICE_TOKEN="$(openssl rand -hex 32)"
  POSTGRES_PASSWORD="$(openssl rand -hex 16)"
  cat > "$FICHIER_SECRETS" <<EOF
# Secrets générés le $(date -Iseconds) — NE PAS VERSIONNER.
# Sauvegarder ce fichier séparément de la base de données : sans TOTP_ENC_KEY,
# une restauration rend tous les comptes inutilisables.
TOTP_ENC_KEY=$TOTP_ENC_KEY
LAB_SSO_MASTER_KEY=$LAB_SSO_MASTER_KEY
ORCHESTRATOR_SERVICE_TOKEN=$ORCHESTRATOR_SERVICE_TOKEN
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
EOF
  chmod 600 "$FICHIER_SECRETS"
  echo "  4 secrets générés (256 bits chacun) → $FICHIER_SECRETS (chmod 600)"
fi

# --- Écriture des .env -------------------------------------------------------
# Principe : on part du .env.example et on ne remplace que les valeurs qui
# doivent l'être. Tout commentaire ou réglage non listé est conservé tel quel.
ecrire_env() {
  local exemple="$1" cible="$2"; shift 2
  [ -f "$exemple" ] || { rouge "  Modèle absent : $exemple"; return 1; }
  cp "$exemple" "$cible"
  while [ $# -gt 0 ]; do
    local cle="${1%%=*}" val="${1#*=}"; shift
    if grep -q "^${cle}=" "$cible"; then
      # Délimiteur | car les valeurs contiennent des / (URL, chemins)
      sed -i "s|^${cle}=.*|${cle}=${val}|" "$cible"
    else
      printf '%s=%s\n' "$cle" "$val" >> "$cible"
    fi
  done
  chmod 600 "$cible"
  echo "  $(realpath --relative-to="$RACINE" "$cible")"
}

titre "Génération des fichiers .env"

BDD_URL="postgresql://talixman:${POSTGRES_PASSWORD}@postgres:5432/talixman_auth"
ORIGINES="http://localhost:5173,http://${IP_HOTE}:5173"

ecrire_env "$PORTAIL/.env.example" "$PORTAIL/.env" \
  "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" \
  "DATABASE_URL=postgresql://talixman:${POSTGRES_PASSWORD}@localhost:5432/talixman_auth" \
  "TOTP_ENC_KEY=$TOTP_ENC_KEY" \
  "LAB_SSO_MASTER_KEY=$LAB_SSO_MASTER_KEY" \
  "ORCHESTRATOR_SERVICE_TOKEN=$ORCHESTRATOR_SERVICE_TOKEN" \
  "SEED_SUPERADMIN_EMAIL=${EMAIL:-admin@exemple.fr}" \
  "SEED_SUPERADMIN_PASSWORD=${MOTDEPASSE:-a-definir}" \
  "CORS_ORIGIN=$ORIGINES" \
  "FRONTEND_URL=http://${IP_HOTE}:5173" \
  "VITE_API_URL=http://${IP_HOTE}:3000" \
  "LABS_ORCHESTRATOR_URL=http://cyber_range_orchestrator_control:4100" \
  "EMAIL_TRANSPORT=console"

# Le backend tourne DANS un conteneur : ses hôtes sont des noms de services
# Docker, pas localhost. C'est une distinction qui a déjà coûté du temps.
ecrire_env "$PORTAIL/backend/.env.example" "$PORTAIL/backend/.env" \
  "DATABASE_URL=$BDD_URL" \
  "REDIS_URL=redis://redis:6379" \
  "TOTP_ENC_KEY=$TOTP_ENC_KEY" \
  "LAB_SSO_MASTER_KEY=$LAB_SSO_MASTER_KEY" \
  "ORCHESTRATOR_SERVICE_TOKEN=$ORCHESTRATOR_SERVICE_TOKEN" \
  "SEED_SUPERADMIN_EMAIL=${EMAIL:-admin@exemple.fr}" \
  "SEED_SUPERADMIN_PASSWORD=${MOTDEPASSE:-a-definir}" \
  "CORS_ORIGIN=$ORIGINES" \
  "FRONTEND_URL=http://${IP_HOTE}:5173" \
  "LABS_ORCHESTRATOR_URL=http://cyber_range_orchestrator_control:4100" \
  "EMAIL_TRANSPORT=console"

ecrire_env "$PORTAIL/frontend/.env.example" "$PORTAIL/frontend/.env" \
  "VITE_API_URL=http://${IP_HOTE}:3000"

# TEMPLATES_HOST_DIR est un chemin ABSOLU monté dans le conteneur : il change
# à chaque déplacement du projet. Un chemin périmé donne « Template inconnu »
# au démarrage d'un laboratoire.
ecrire_env "$ORCH/.env.example" "$ORCH/.env" \
  "ORCHESTRATOR_SERVICE_TOKEN=$ORCHESTRATOR_SERVICE_TOKEN" \
  "LAB_SSO_MASTER_KEY=$LAB_SSO_MASTER_KEY" \
  "TEMPLATES_HOST_DIR=$RACINE" \
  "GATEWAY_PUBLIC_HOST=$IP_HOTE" \
  "PORTAL_NETWORK=talixman-auth_default"

if [ "$SECRETS_SEULEMENT" -eq 1 ]; then
  titre "Terminé"
  echo "  Fichiers .env régénérés. Superadmin non touché."
  exit 0
fi

# --- Base de données et superadmin ------------------------------------------
titre "Base de données"
cd "$PORTAIL"
docker compose up -d postgres redis >/dev/null 2>&1
printf '  attente de PostgreSQL'
for _ in $(seq 1 60); do
  if docker compose exec -T postgres pg_isready -U talixman >/dev/null 2>&1; then
    echo " — prêt"; break
  fi
  printf '.'; sleep 2
done

echo "  application des migrations"
docker compose --profile app up -d api >/dev/null 2>&1
for _ in $(seq 1 45); do
  docker compose exec -T api npx prisma migrate deploy >/dev/null 2>&1 && break
  sleep 2
done

titre "Création du superadmin"
if docker compose exec -T api npx prisma db seed 2>&1 | tee /tmp/seed-sortie.txt | sed 's/^/  /'; then
  :
else
  rouge "  Échec de la création. Sortie ci-dessus."
  exit 1
fi

# --- Fin ---------------------------------------------------------------------
titre "Terminé"
vert "  La plateforme est configurée."
echo
echo "  Portail      : http://${IP_HOTE}:5173"
echo "  Superadmin   : $EMAIL"
echo
jaune "  Le QR code de double authentification est dans :"
jaune "    talixman-auth/backend/superadmin-totp-qr.png"
jaune "  À scanner AVANT la première connexion — elle est impossible sans."
echo
echo "  Pour démarrer le reste :"
echo "    cd talixman-auth            && docker compose --profile app up -d"
echo "    cd dispatching              && ./build-images.sh"
echo "    cd cyber-range-orchestrator && docker compose up -d --build"
echo
echo "  Les emails restent en mode console : les liens d'activation"
echo "  apparaissent dans « docker compose logs api »."
