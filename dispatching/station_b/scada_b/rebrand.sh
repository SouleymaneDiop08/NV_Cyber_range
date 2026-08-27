#!/usr/bin/env bash
#
# rebrand-talixman.sh
# ---------------------------------------------------------------------------
# Remplace le logo FUXA par votre logo (Talixman) et remplace les textes
# visibles "FUXA"/"Fuxa" par "Talixman" dans le frontend Angular.
#
# Ce script NE touche PAS aux noms internes de composants/services
# (ex: FuxaViewComponent, fuxa-view.component.ts, window.fuxaScriptAPI,
# valeurs d'exemple type "fuxa@example.com") car les renommer casserait
# le code (imports, sélecteurs Angular, API JS exposée aux widgets).
# Seul ce qui s'affiche réellement à l'écran est modifié.
#
# UTILISATION :
#   1. Placez vos 4 fichiers image dans un dossier, nommés :
#        X.svg   X.ico   X.png   X.icns
#      (remplacez X par le nom réel que vous utilisez, cf. variable
#      IMG_BASENAME ci-dessous)
#   2. Modifiez les variables REPO_DIR / IMG_SRC_DIR / IMG_BASENAME
#   3. Lancez : bash rebrand-talixman.sh
#
# Le script fait une copie de sauvegarde (.bak) de chaque fichier modifié
# avant de le toucher, au cas où vous voudriez revenir en arrière.
# ---------------------------------------------------------------------------

set -euo pipefail

# ===================== A CONFIGURER =========================================
REPO_DIR="."          # chemin vers le dépôt FUXA cloné
IMG_SRC_DIR="./Images"   # dossier contenant X.svg, X.ico, X.png, X.icns
IMG_BASENAME="X"           # nom de base de vos fichiers image (sans extension)
OLD_NAME="FUXA"
NEW_NAME="Talixman SCADA"
# =============================================================================

echo "== Rebranding ${OLD_NAME} -> ${NEW_NAME} =="
echo "Dépôt cible : ${REPO_DIR}"

if [ ! -d "${REPO_DIR}" ]; then
    echo "ERREUR : le dossier ${REPO_DIR} n'existe pas." >&2
    exit 1
fi

CLIENT_SRC="${REPO_DIR}/client/src"

backup_then_write() {
    # $1 = fichier source (l'image fournie par l'utilisateur)
    # $2 = fichier destination dans le repo
    local src="$1"
    local dst="$2"

    if [ ! -f "${src}" ]; then
        echo "  [SKIP] Image absente : ${src}"
        return
    fi
    if [ -f "${dst}" ] && [ ! -f "${dst}.bak" ]; then
        cp "${dst}" "${dst}.bak"
    fi
    cp "${src}" "${dst}"
    echo "  [OK] ${dst} <- ${src}"
}

# -----------------------------------------------------------------------
# 1. REMPLACEMENT DES LOGOS / ICONES
# -----------------------------------------------------------------------
echo ""
echo "-- Remplacement des logos --"

backup_then_write "${IMG_SRC_DIR}/${IMG_BASENAME}.svg" "${CLIENT_SRC}/assets/images/logo.svg"
backup_then_write "${IMG_SRC_DIR}/${IMG_BASENAME}.ico" "${CLIENT_SRC}/favicon.ico"
backup_then_write "${IMG_SRC_DIR}/${IMG_BASENAME}.ico" "${REPO_DIR}/app/electron/icons/fuxa-logo.ico"
backup_then_write "${IMG_SRC_DIR}/${IMG_BASENAME}.png" "${REPO_DIR}/app/electron/icons/fuxa-logo.png"
backup_then_write "${IMG_SRC_DIR}/${IMG_BASENAME}.icns" "${REPO_DIR}/app/electron/icons/fuxa-logo.icns"

# -----------------------------------------------------------------------
# 2. REMPLACEMENT DU TEXTE VISIBLE "FUXA" -> "Talixman"
# -----------------------------------------------------------------------
echo ""
echo "-- Remplacement des textes visibles --"

replace_text() {
    # $1 = fichier à modifier
    local file="$1"
    if [ ! -f "${file}" ]; then
        echo "  [SKIP] Fichier introuvable : ${file}"
        return
    fi
    if [ ! -f "${file}.bak" ]; then
        cp "${file}" "${file}.bak"
    fi
    # Remplacement SENSIBLE A LA CASSE :
    #   "FUXA" (tout en majuscules)  -> "Talixman"
    #   "Fuxa" (première lettre maj) -> "Talixman"
    # On ne touche pas à "fuxa" tout en minuscules, qui n'apparaît que dans
    # des identifiants techniques (window.fuxaScriptAPI, fuxa@example.com...).
    sed -i \
        -e "s/${OLD_NAME}/${NEW_NAME}/g" \
        -e "s/Fuxa/${NEW_NAME}/g" \
        "${file}"
    echo "  [OK] ${file}"
}

# Titre de l'onglet navigateur + écran de chargement
replace_text "${CLIENT_SRC}/index.html"

# Log de démarrage dans la console
replace_text "${CLIENT_SRC}/app/app.component.ts"

# Sujet de l'e-mail de test SMTP dans les paramètres
replace_text "${CLIENT_SRC}/app/editor/app-settings/app-settings.component.ts"

# Dialogue "à propos" (icône info dans le header) et menu utilisateur
replace_text "${CLIENT_SRC}/app/header/info.dialog.html"
replace_text "${CLIENT_SRC}/app/home/userinfo.dialog.html"

# En-tête des rapports PDF exportés ("FUXA by frangoteam")
replace_text "${CLIENT_SRC}/app/reports/report-editor/report-editor.component.ts"

# Toutes les traductions (menu, tooltips, dialogues "à propos", etc.)
for i18n_file in "${CLIENT_SRC}"/assets/i18n/*.json; do
    replace_text "${i18n_file}"
done

# -----------------------------------------------------------------------
# 3. SUPPRESSION DE LA MENTION "powered by frangoteam"
# -----------------------------------------------------------------------
echo ""
echo "-- Suppression de \"powered by frangoteam\" --"

remove_powered_by() {
    local file="$1"
    if [ ! -f "${file}" ]; then
        echo "  [SKIP] Fichier introuvable : ${file}"
        return
    fi
    if [ ! -f "${file}.bak" ]; then
        cp "${file}" "${file}.bak"
    fi
    # Supprime "powered by <b>frango</b>team", précédé ou non de FUXA/Talixman SCADA
    perl -0777 -pi -e "s/(${NEW_NAME}\\s*)?(${OLD_NAME}\\s*)?powered by <span><b>frango<\\/b>team<\\/span>//gi" "${file}"
    echo "  [OK] ${file}"
}

remove_powered_by "${CLIENT_SRC}/index.html"
remove_powered_by "${CLIENT_SRC}/app/header/info.dialog.html"
remove_powered_by "${CLIENT_SRC}/app/home/userinfo.dialog.html"

# Nettoyage de "Talixman SCADA by frangoteam" -> "Talixman SCADA" dans les rapports PDF
REPORT_FILE="${CLIENT_SRC}/app/reports/report-editor/report-editor.component.ts"
if [ -f "${REPORT_FILE}" ]; then
    sed -i "s/${NEW_NAME} by frangoteam/${NEW_NAME}/g" "${REPORT_FILE}"
    echo "  [OK] ${REPORT_FILE} (mention 'by frangoteam' retirée)"
fi

