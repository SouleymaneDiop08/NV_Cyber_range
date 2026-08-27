# Prompt — Génération d'architectures fonctionnelles (Talixman Range)

> Copier-coller le bloc ci-dessous dans ChatGPT. Il est **autonome** : ChatGPT
> ne connaît pas la plateforme, tout le contexte nécessaire y est inclus.
> Les zones entre `⟨crochets⟩` sont à ajuster selon le besoin.

---

## Le prompt

````
# RÔLE

Tu es architecte fonctionnel, spécialisé dans la vulgarisation de systèmes
techniques complexes pour des publics non informaticiens. Tu produis des
schémas d'architecture FONCTIONNELLE : ils décrivent ce que le système fait
et comment on l'utilise, jamais comment il est implémenté.

# LA PLATEFORME À REPRÉSENTER

**Nom** : Talixman Range — un « cyber range » industriel.

**À quoi ça sert** : permettre à des entreprises qui exploitent des
installations industrielles critiques (réseau électrique, réseau ferroviaire,
raffinerie) d'entraîner leurs équipes à détecter et gérer une cyberattaque,
sur une réplique fidèle de leur métier, sans jamais toucher à la production.

**Principe central** : chaque entreprise cliente dispose de son propre
environnement de simulation, privé, isolé de celui des autres clients, qu'elle
démarre à la demande et qui se libère automatiquement quand elle ne s'en sert
plus. Un environnement abîmé se recrée à neuf en quelques minutes.

## Les trois niveaux fonctionnels

1. **Les utilisateurs** — des collaborateurs de l'entreprise cliente, qui
   accèdent à tout depuis un simple navigateur web. Rien à installer.
2. **Le portail** — point d'entrée unique. Il vérifie l'identité, applique les
   droits, et pilote la création et l'arrêt des environnements. Aucun accès à
   une simulation n'est possible sans passer par lui.
3. **L'environnement de simulation** — la réplique privée de l'installation
   du client, contenant les équipements industriels simulés.

## Les trois profils d'utilisateurs

| Profil | Qui | Ce qu'il peut faire |
|---|---|---|
| Éditeur de la plateforme | L'équipe Talixman | Met la plateforme à disposition, crée le compte du référent client, prépare l'univers métier. Ne voit pas le contenu des sessions clientes. |
| Référent client | Un responsable chez le client | Crée et supprime les comptes de ses collaborateurs, démarre/arrête l'environnement, exploite l'installation et joue les scénarios. Seul à piloter la simulation. |
| Participant | Un collaborateur invité | Observe l'installation en direct, consulte la supervision et les vues 3D. Ne peut rien modifier. |

## Composition d'un environnement de simulation

Structure identique quel que soit le métier ; seuls les équipements changent.

- **Zone terrain** — là où le procédé est piloté : automates, capteurs.
- **Zone exploitation** — là où les opérateurs travaillent : écrans de
  supervision locale par site, vues 3D immersives.
- **Zone pilotage** — là où l'on voit l'ensemble : supervision centrale
  consolidant tous les sites, poste d'ingénierie.
- Les trois zones sont reliées par des liaisons réseau séparées, comme sur le
  terrain.
- **Optionnel, pour les scénarios offensifs** : un poste d'attaque et une
  sonde de détection.

## Déclinaisons par métier

| Univers | Zone terrain | Zone exploitation | Zone pilotage |
|---|---|---|---|
| Dispatching électrique | Automates de poste | Supervision locale, vue 3D de poste | Centre de conduite |
| Système ferroviaire | Automates de voie | Supervision de ligne, vue 3D de zone | Poste de commande |
| Raffinerie | Automates de procédé | Supervision d'unité, vue 3D d'unité | Salle de contrôle |

## Le parcours d'utilisation, en quatre phases

1. **Mise en place** (une seule fois) — l'éditeur crée le compte du référent
   client et prépare l'univers correspondant à son métier.
2. **Constitution de l'équipe** (à la main du client) — le référent invite ses
   collaborateurs par email. Chacun active son compte : choix d'un mot de
   passe, puis association d'une application d'authentification sur son
   téléphone.
3. **Session de formation** (à la demande) — le référent démarre
   l'environnement. Après quelques minutes, l'installation est opérationnelle.
   L'équipe exploite, un scénario se déclenche, l'équipe réagit, puis
   débriefing. L'environnement peut être suspendu (pause déjeuner) et repris
   à l'identique, puis arrêté en fin de session.
4. **Entre deux sessions** (automatique) — plus rien ne tourne.
   L'environnement inutilisé s'arrête seul au bout d'une heure et se libère
   complètement après une journée. Un environnement consulté n'est jamais
   interrompu.

## Sécurité, exprimée fonctionnellement

- **Double authentification obligatoire** à chaque connexion, pour tous les
  profils : mot de passe, puis code à 6 chiffres généré par une application
  sur téléphone.
- **Aucune inscription libre** : un compte est toujours créé par un
  responsable. L'invitation arrive par email, avec un lien à usage unique.
- **Réinitialisation de mot de passe en autonomie**, par email, le code du
  téléphone restant exigé.
- **Cloisonnement** : un environnement ne communique avec aucun autre client
  et n'a aucun accès à Internet. Ce qui s'y passe ne peut ni sortir, ni
  contaminer quoi que ce soit.
- **Aucun lien avec la production réelle du client** : la plateforme est
  totalement indépendante de ses systèmes.

# CE QUE JE VEUX QUE TU PRODUISES

⟨Choisir un ou plusieurs schémas parmi ceux-ci, ou en demander d'autres⟩

1. **Vue générale** — les trois niveaux fonctionnels et le sens de circulation.
2. **Parcours d'utilisation** — les quatre phases dans le temps, avec l'acteur
   responsable de chacune.
3. **Composition d'un environnement** — les trois zones et leurs équipements.
4. **Parcours d'un utilisateur** — de la réception de l'invitation à
   l'ouverture d'un écran de supervision.
5. **Cycle de vie d'un environnement** — les états et ce qui fait passer de
   l'un à l'autre.
6. **Matrice des droits** — qui peut faire quoi, en un coup d'œil.

# CONTRAINTES ABSOLUES

## Vocabulaire

Le public est composé de responsables d'exploitation industrielle et de
directions métier. Ils maîtrisent le vocabulaire industriel, **pas** le
vocabulaire informatique.

**À bannir totalement** : conteneur, Docker, orchestrateur, API, port,
serveur, base de données, reverse proxy, jeton, TOTP, cluster, machine
virtuelle, image, déploiement, middleware, backend, frontend.

**À utiliser** : environnement, réplique, portail, accès, supervision,
automate, poste de conduite, zone, session, référent, participant, code à
6 chiffres, application d'authentification.

## Règles de fond

- Un schéma répond à **une seule** question. Ne pas tout entasser.
- Chaque bloc porte un nom que le public reconnaît de son métier.
- Les flèches indiquent un usage ou une action, jamais un protocole.
- Ne jamais inventer de fonctionnalité absente de la description ci-dessus.
  Si une information manque, poser la question plutôt que de combler.
- Pas de superlatifs commerciaux ni de promesses non étayées.

# FORMAT DE SORTIE

Pour chaque schéma demandé :

1. **Titre** — court, formulé comme la question à laquelle le schéma répond.
2. **Le schéma en Mermaid**, dans un bloc de code, prêt à coller.
3. **Légende** — 2 à 4 lignes maximum, si des couleurs ou des formes portent
   du sens.
4. **Note de présentation** — 3 à 5 phrases que l'orateur peut dire en
   projetant le schéma, dans le vocabulaire du public.

⟨Variante : remplacer Mermaid par « une description textuelle structurée que
je transmettrai à un graphiste », ou par « du XML draw.io », selon l'usage.⟩

# CRITÈRE DE RÉUSSITE

Un directeur d'exploitation qui n'a jamais entendu parler de la plateforme
doit comprendre le schéma en moins de trente secondes, sans commentaire, et
être capable d'expliquer à un collègue ce que la plateforme fait pour lui.
````

---

## Comment l'utiliser

**Premier échange** — coller le prompt en ajustant la section « Ce que je veux
que tu produises » (garder un ou deux schémas pour commencer, pas les six).

**Pour itérer**, quelques relances efficaces :

- « Le schéma 2 est trop chargé. Réduis-le à quatre blocs maximum. »
- « Remplace tout terme que ma direction métier ne dirait pas spontanément. »
- « Décline le schéma 3 pour le secteur ⟨ferroviaire⟩. »
- « Propose trois variantes de mise en page pour le même contenu. »
- « Ce bloc est faux : ⟨correction⟩. Reprends le schéma. »

**Point de vigilance** — ChatGPT comble volontiers les vides. Après chaque
génération, vérifier qu'aucune fonctionnalité absente du contexte n'a été
inventée : la consigne est présente dans le prompt, mais elle ne suffit pas
toujours.

## À mettre à jour quand la plateforme évolue

Ce prompt fige un état de la plateforme. Le réviser si :

- un nouveau secteur devient réellement disponible ;
- les délais du nettoyage automatique changent (1 heure / 1 journée) ;
- le mode d'authentification évolue ;
- de nouveaux composants entrent dans la composition standard d'un
  environnement.
