# Discours — Présentation technique Talixman Range

> Support : `docs/talixman-presentation-technique.pptx` (15 diapositives).
> Durée visée : **30 à 35 minutes**, questions non comprises.
> Le texte est écrit pour être **dit**, pas lu mot à mot : gardez les idées et les
> chiffres, laissez tomber la formulation exacte si elle ne vous vient pas.

**Fil rouge à garder en tête** — toute la présentation raconte une seule histoire :
*nous avons choisi d'isoler totalement les laboratoires, et cette décision a
ensuite commandé toutes les autres.* Les diapositives 4 et 5 posent la
contrainte, la 8 montre ce qu'elle a coûté, la 9 montre comment nous l'avons
résolue. Si l'auditoire ne retient qu'une chose, c'est ce lien de cause à effet.

---

## 1 — Couverture · 30 secondes

Bonjour à tous.

Je vais vous présenter l'architecture technique de Talixman Range, notre
plateforme de cyber range industriel.

L'objectif de cette présentation n'est pas de faire le tour de chaque ligne de
code, mais de vous montrer **comment le système est construit, et surtout
pourquoi il est construit comme ça**. Plusieurs décisions peuvent surprendre au
premier abord — je vais prendre le temps de les justifier.

On va procéder en quatre temps : d'abord l'architecture générale, ensuite les
réseaux et l'isolation, puis l'authentification des composants — c'est la partie
qui a le plus évolué récemment — et enfin le système d'emails et la trajectoire
vers la mise en production.

> *Transition* : « Commençons par la vue d'ensemble. »

---

## 2 — Architecture globale · 3 minutes

Voici l'architecture complète. Elle se lit de gauche à droite, en quatre étages.

À gauche, **l'utilisateur**. Il n'a besoin que d'un navigateur : rien n'est
installé sur son poste.

Juste après, en vert, le bloc **exposition publique**. Je le signale tout de
suite : c'est le seul bloc de ce schéma qui **n'existe pas encore**. C'est le
reverse proxy public, avec le TLS et le nom de domaine. J'y reviendrai à la fin.

Au centre, **le portail**. C'est le cœur métier : un frontend React et une API
NestJS. Le portail détient l'identité, les rôles, les secteurs et la propriété
des laboratoires. Retenez ce point, il est structurant : **le portail ne parle
jamais à Docker**. Il ne sait pas lancer un conteneur, et c'est volontaire.

Juste à droite, ses données : PostgreSQL pour le métier, Redis pour les sessions,
les verrous et les compteurs.

Ensuite, **l'orchestrateur**. C'est un service séparé, et il est scindé en deux
rôles. Le rôle « control » détient le socket Docker de l'hôte — autrement dit,
l'équivalent d'un accès root sur la machine — et il ne publie **aucun port**. Le
rôle « gateway » est la seule surface publique, et il n'a **aucun** accès à
Docker. Cette coupure est délibérée : elle évite qu'un seul processus cumule
« root sur l'hôte » et « exposé à Internet ».

Enfin, en bas, **les laboratoires**. Chacun est un conteneur Docker-in-Docker :
il embarque son propre démon Docker, en mode rootless, son propre `docker
compose`, son propre Nginx, et ses propres réseaux L1, L2 et L3.

Un détail qui a l'air anodin et qui ne l'est pas : regardez les adresses. Elles
sont **identiques** d'un laboratoire à l'autre — `192.168.10`, `.20`, `.30`.
C'est possible précisément parce que chaque labo a sa propre pile réseau. Sans
ça, il aurait fallu réattribuer les adresses de chaque automate à chaque
création de labo, donc modifier la configuration des logiciels industriels. On
s'y refusait : la fidélité de la simulation en aurait souffert.

> *Transition* : « Vous avez vu que j'ai signalé un bloc "à venir". Faisons le
> point précis sur ce qui existe et ce qui reste à faire. »

---

## 3 — Existant vs à venir · 2 minutes

Je préfère être explicite là-dessus, parce que sur un schéma tout se ressemble.

**À gauche, ce qui tourne aujourd'hui et qui a été validé de bout en bout.**
L'authentification à deux facteurs, les invitations, la réinitialisation de mot
de passe. Le contrôle d'accès par rôle et par secteur. Le cycle de vie complet
des laboratoires : créer, démarrer, suspendre, détruire. Le runtime
Docker-in-Docker rootless avec ses quotas et son nettoyage automatique. La
gateway qui expose les composants. Le Nginx interne de chaque labo. Et le
lancement authentifié des composants, sur lequel je reviendrai en détail.

**À droite, ce qui reste.** Le reverse proxy public, le TLS, le nom de domaine.
La bascule de l'envoi d'emails du mode console vers le relais réel. Et la
sauvegarde automatique, qui est aujourd'hui manuelle — c'est notre point le plus
exposé avant une mise en service.

Le nom de domaine est le prérequis de presque tout le reste. Et il apporte un
bénéfice qu'on n'attend pas forcément : il **supprime la limite actuelle
d'environ neuf laboratoires simultanés**. J'y reviens dans deux diapositives.

Le message important, en bas : **rien de tout ça ne demande de refonte**.
L'exposition réseau a été conçue dès le départ comme une stratégie remplaçable.

> *Transition* : « Passons maintenant à ce qui est, à mon sens, le cœur de
> l'architecture : les réseaux. »

---

## 4 — Les trois réseaux Docker · 2 minutes 30

Il y a trois réseaux Docker, et leur séparation est le socle de toute la
sécurité de la plateforme.

**En haut, le réseau applicatif.** Il contient PostgreSQL, Redis, l'API et le
frontend. C'est le cœur métier du portail — donc ce qu'il y a de plus sensible :
les comptes, les droits, les secrets de second facteur.

**Au milieu, le réseau des laboratoires.** On y trouve les conteneurs de labo et
les deux rôles de l'orchestrateur. Ce réseau est déclaré **`internal`**. En
Docker, ça veut dire une chose très précise : aucune route sortante. Ni vers
Internet, ni vers le réseau applicatif.

**En bas, le réseau public.** Il ne contient que la gateway. C'est le seul
réseau joignable de l'extérieur.

Regardez maintenant le rôle « control », au centre : c'est **le seul point de
contact** entre le réseau applicatif et le réseau des laboratoires. C'est lui
qui reçoit les ordres du portail et pilote Docker. Rien d'autre ne traverse.

La conséquence pratique est forte, et c'est l'argument que vous entendrez le
plus souvent en clientèle : un laboratoire compromis — y compris la machine
d'attaque qu'on y déploie volontairement pour les exercices offensifs — ne peut
atteindre **ni la base de données du portail, ni Internet**.

> *Note si on vous montre le schéma de près* : le conteneur Keycloak apparaît
> encore sur le réseau applicatif. Il n'est plus déployé — je vous explique dans
> quelques minutes pourquoi nous l'avons retiré. Le schéma est d'ailleurs utile
> tel quel : il montre bien que Keycloak était du mauvais côté de la frontière.

> *Transition* : « Ce mot, "internal", a l'air d'un détail de configuration.
> C'est en réalité la contrainte qui a décidé de plusieurs de nos choix. »

---

## 5 — Ce que « internal: true » implique · 2 minutes 30

Voici l'état réel, relevé sur la plateforme.

Le réseau applicatif n'est pas `internal` : il a accès à Internet, ce qui est
nécessaire — c'est lui qui envoie les emails, par exemple.

Le réseau des laboratoires, lui, est `internal`. Le réseau public ne l'est pas
non plus, mais il ne contient que la gateway.

Descendons au concret. **Ce qu'un conteneur de laboratoire peut faire** : joindre
les autres conteneurs de son propre labo, et être joint par la gateway, qui lui
relaie le trafic web et le temps réel.

**Ce qu'il ne peut pas faire** : joindre PostgreSQL, Redis ou l'API. Sortir sur
Internet. Et — c'est là que ça devient intéressant — **résoudre le moindre nom
d'hôte extérieur à son réseau**.

Autrement dit : depuis un laboratoire, on ne peut appeler **aucun** service
d'authentification externe. Aucun.

Ce cloisonnement n'est pas négociable. C'est ce qui empêche qu'un exercice
offensif — dont le but est justement d'attaquer — atteigne la plateforme
elle-même. Donc toute brique d'authentification devait s'y plier. Gardez ça en
tête, on y revient dans trois diapositives.

> *Transition* : « Avant ça, parlons de la façon dont on expose les composants,
> puisque c'est la deuxième contrainte forte. »

---

## 6 — Les trois reverse proxies · 2 minutes 30

C'est le point le plus souvent mal compris de l'architecture, alors je le pose
clairement : il y a **déjà deux** reverse proxies dans la plateforme, à deux
étages différents. Un troisième arrivera en production.

**Le premier, le Nginx du laboratoire.** Il y en a un **par laboratoire**,
embarqué dans son `docker compose`. Il est attaché aux trois réseaux L1, L2 et
L3 avec des adresses fixes, et il déclare un bloc `server` par composant : un
port d'écoute distinct, relayé vers le service correspondant. Point important :
ses ports sont publiés **dans le conteneur de labo**, jamais sur la machine
hôte.

**Le deuxième, la gateway de l'orchestrateur.** Une seule instance, partagée par
tous les laboratoires. Elle ouvre un point d'entrée par composant et relaie le
trafic — y compris les WebSockets, indispensables au temps réel de la
supervision. Elle se resynchronise avec l'état des laboratoires toutes les cinq
secondes : il n'y a **aucune route à déclarer à la main**. Un labo créé est
exposé automatiquement, un labo détruit disparaît.

**Le troisième, le proxy public**, viendra en frontal sur l'hôte. C'est lui qui
portera le nom de domaine et le certificat.

Une question revient souvent : *pourquoi ne pas utiliser le Nginx du laboratoire
comme point d'entrée public, puisqu'il existe déjà ?* Trois raisons. Il est
dupliqué — un par labo, il n'y a pas d'instance unique à cibler. Ses adresses
sont volontairement identiques d'un labo à l'autre, on ne peut donc pas les
distinguer de l'extérieur. Et surtout, il vit **dans la zone non fiable**, aux
côtés des composants industriels et de la machine d'attaque. En faire le point
d'entrée public reviendrait à mettre un composant attaquable sur le chemin de
confiance.

> *Transition* : « Et cette gateway, elle expose les composants d'une façon
> particulière, qui mérite une explication. »

---

## 7 — Une origine par composant · 2 minutes

Chaque composant d'un laboratoire reçoit **sa propre origine complète** —
aujourd'hui un port dédié, demain un sous-domaine.

Ça peut sembler lourd. C'est en réalité une contrainte imposée par les logiciels
industriels eux-mêmes.

Le problème est le suivant : la supervision, les automates et la vue 3D
construisent **tous leurs liens depuis la racine du site**. La supervision
déclare une base de document à la racine et demande ses ressources dans
`/assets/…`. Les automates redirigent vers `/login` en absolu. Les appels d'API
et les WebSockets partent également de la racine.

Résultat : si on les sert sous un préfixe de chemin — quelque chose comme
`/labo-untel/supervision/` — le navigateur redemande toutes les ressources
**hors du préfixe**, à la racine du proxy. Et la page ne charge jamais. Nous
l'avons essayé, ça ne fonctionnait pas.

L'alternative aurait été de modifier chaque logiciel industriel pour qu'il
accepte un préfixe. On se l'interdit : ces logiciels sont ce qui donne à la
simulation sa fidélité. La plateforme s'adapte au laboratoire, pas l'inverse.

Le point décisif est en bas de la diapositive : **le portail ne connaît jamais
les ports**. L'API renvoie une URL, le frontend la relaie telle quelle. Changer
de stratégie d'exposition ne touchera donc ni le portail, ni le frontend, ni les
laboratoires.

Et j'en profite pour l'effet de bord que je vous annonçais : la limite d'environ
neuf laboratoires simultanés vient **uniquement** de la plage de ports réservée.
Le passage au nom de domaine la supprime, sans changer une ligne de matériel.

> *Transition* : « Venons-en maintenant à la partie qui a le plus changé
> récemment : l'authentification des composants. »

---

## 8 — Pourquoi Keycloak a été abandonné · 3 minutes

Un mot de contexte d'abord, parce que c'est important pour la crédibilité de ce
qui suit : **Keycloak a été intégré, et ça fonctionnait**. Nous avions un pont
opérationnel, testé de bout en bout. Ce n'est pas un abandon par échec technique.

Trois constats l'ont rendu intenable.

**Premier constat, et c'est le décisif : le laboratoire ne peut pas joindre
Keycloak.** Le composant validait le jeton en allant chercher les clés publiques
auprès du serveur Keycloak. Or on vient de le voir : le réseau des laboratoires
est `internal`. Aucune sortie, aucune résolution de nom. Pour que ça marche, il
aurait fallu ouvrir une route entre les laboratoires et le serveur
d'authentification — donc percer précisément le cloisonnement qui est notre
garantie principale. Ce n'était pas acceptable.

**Deuxième constat : les URL de lancement sont dynamiques.** Keycloak refuse
toute URL de retour qui n'a pas été enregistrée à l'avance. Or le port d'un
composant est alloué par laboratoire, et réattribué à chaque recréation. Il
aurait fallu enregistrer toute la plage de ports — ce qui vide de son sens le
contrôle même de l'URL de retour.

**Troisième constat, plus prosaïque : le coût d'exploitation.** Un serveur
supplémentaire à déployer, à sauvegarder, à maintenir et à mettre à jour. Plus un
realm et des clients à recréer à la main en cas de redéploiement — nous l'avons
vécu, le realm a été perdu une fois lors d'une réinitialisation des volumes.
Tout ça pour un seul besoin : ouvrir une session dans un composant du labo.

Aujourd'hui, Keycloak est **entièrement retiré** : plus aucun conteneur, plus
aucun module dans le backend.

> *Transition* : « La question devient donc : comment ouvre-t-on une session
> authentifiée dans un composant, sans serveur tiers et sans le moindre appel
> sortant ? »

---

## 9 — Ce qui remplace Keycloak · 3 minutes

La réponse tient en une phrase : **le portail signe un jeton de lancement, et le
composant le vérifie localement**.

Suivons le schéma.

En haut, une **clé maîtresse**, partagée entre le portail et l'orchestrateur.
Elle ne quitte jamais leur environnement — elle n'est jamais transmise à un
laboratoire.

À partir de cette clé, on **dérive un secret propre à chaque laboratoire** :
c'est un HMAC-SHA256 de l'identifiant du labo avec la clé maîtresse. Le portail
et l'orchestrateur calculent la même valeur, chacun de son côté, sans se la
communiquer.

L'orchestrateur injecte ce secret dérivé dans le conteneur du laboratoire, au
moment de sa création.

Quand un utilisateur clique sur un composant, le portail **signe un jeton** avec
le secret de ce laboratoire, et redirige le navigateur vers le composant, jeton
en paramètre.

Le composant vérifie la signature **avec le secret qu'il a déjà**. Et c'est tout.
**Aucun appel sortant.** C'est exactement ce qui nous permet de garder le réseau
des laboratoires totalement fermé.

Trois propriétés à souligner, à droite de la diapositive.

**Le secret est dérivé, jamais transmis.** La clé maîtresse reste côté
plateforme.

**Le cloisonnement est préservé.** Un client qui lirait le secret dans *son*
conteneur — ce qui est possible, c'est son environnement — ne peut ni remonter à
la clé maîtresse, parce qu'un HMAC n'est pas réversible, ni dériver le secret
d'un autre laboratoire.

**Zéro dépendance réseau.** C'est le point qui règle le problème de départ.

C'est déployé de bout en bout : le portail signe, l'orchestrateur injecte, et le
module de vérification est présent dans les trois superviseurs du laboratoire.

Et il y a un bénéfice collatéral qu'on apprécie à l'exploitation : **un serveur
de moins** à déployer, sauvegarder et maintenir — et plus aucune configuration
manuelle à refaire en cas de redéploiement.

> *Transition* : « Regardons ce jeton d'un peu plus près, parce que le diable est
> dans les détails. »

---

## 10 — Anatomie du jeton · 2 minutes 30

C'est un JWT classique, signé en HMAC-SHA256.

À gauche, sa charge utile. On y trouve l'émetteur, l'audience, l'identifiant de
l'utilisateur, son email, son nom, ses droits dans le composant, un identifiant
aléatoire, et les dates d'émission et d'expiration.

Notez ce qui **n'y est pas** : aucune empreinte de mot de passe, aucun secret de
second facteur, aucun identifiant de session du portail. Le jeton ne porte que ce
dont le composant a besoin pour ouvrir une session, rien de plus.

En bas à gauche, la correspondance des rôles. Un superadministrateur obtient
l'administration complète du composant. Un administrateur devient opérateur : il
peut piloter et envoyer des commandes, mais pas éditer la configuration. Un
invité est en lecture seule stricte. Les droits du portail sont donc **transposés
dans le composant**, sans ressaisie.

À droite, les quatre protections. Je les détaille parce que ce sont les pièges
classiques des JWT, et qu'ils sont tous fermés explicitement.

**La durée de vie est de soixante secondes.** Le jeton est consommé dans la
seconde par une redirection de navigateur. Une minute couvre largement une
latence dégradée, et borne la fenêtre d'exploitation si le jeton fuite — par
l'historique de navigation ou les journaux d'un proxy.

**L'audience est par composant.** C'est subtil mais important : les trois
superviseurs d'un même laboratoire partagent le secret de ce laboratoire. Sans
l'audience, un jeton émis pour l'un serait rejouable sur les autres. Le composant
destinataire vérifie donc qu'il est bien le destinataire.

**L'algorithme est figé.** Il est imposé à l'émission et vérifié à la réception.
C'est ce qui ferme la confusion d'algorithme — l'attaque classique où on présente
un jeton en `none` ou dans un autre algorithme.

**La charge utile est minimale**, je viens d'y revenir.

> *Transition* : « On change de sujet. Parlons du système d'emails, parce qu'il
> conditionne deux parcours critiques. »

---

## 11 — Le système d'envoi d'emails · 1 minute 30

Deux parcours seulement dépendent de l'email — mais ils sont bloquants.

**L'invitation de compte** : un lien d'activation à usage unique, valable 48
heures. Sans lui, aucun compte ne peut être créé.

**La réinitialisation de mot de passe** : un lien à usage unique, valable 1 heure.
Et j'insiste : même par ce chemin, **le code du téléphone reste exigé**. L'accès à
la boîte mail ne suffit donc pas à prendre un compte. C'était un choix
délibéré — sinon le lien email serait devenu un contournement complet du second
facteur, que toute la plateforme impose par ailleurs.

Le transport est du SMTP avec chiffrement STARTTLS, via le relais SMTP2GO.

Et un prérequis à ne pas oublier : le domaine expéditeur doit être vérifié, par
des enregistrements SPF et DKIM. Tant que ce n'est pas fait, les envois vers des
adresses tierces sont rejetés. Nous en avons déjà fait l'expérience avec un
fournisseur précédent — c'est ce qui nous a maintenus en mode dégradé jusqu'ici.

> *Transition* : « Regardons la configuration concrète, et un point d'attention
> technique. »

---

## 12 — Protocole et configuration SMTP2GO · 2 minutes

D'abord une question qu'on nous pose souvent : **pourquoi le SMTP plutôt que
l'API du fournisseur ?**

Parce que le SMTP est un protocole standard. Changer de fournisseur ne demande
que des variables d'environnement — aucune modification de code, aucune
dépendance nouvelle. Passer par l'API de SMTP2GO aurait installé leur kit de
développement dans notre code, et rendu tout changement coûteux.

Ce qu'on perd, c'est le suivi fin — les ouvertures, les rebonds détaillés. Dans
notre cas, ça ne mord pas : on envoie deux emails par compte créé, il n'y a
aucun besoin marketing.

À gauche, la configuration : le serveur `mail.smtp2go.com`, le port 2525, et un
identifiant SMTP dédié — créé dans leur console, distinct du compte
d'administration.

**Et voici le point d'attention**, en rouge à droite. Notre service ne définit
pas l'option `secure` : la connexion démarre en clair, puis bascule en TLS via
STARTTLS. Ça fonctionne parfaitement sur les ports 2525 et 587. En revanche, sur
les ports à TLS immédiat — 465, 8465, 443 — le serveur attend un chiffrement dès
la première trame, et **la connexion échouerait**. Donc : port 2525. Si la
politique réseau imposait un port TLS direct, il faudrait ajouter une option au
service — c'est une ligne, mais il faut y penser.

En bas à droite, le mode de repli : `EMAIL_TRANSPORT=console` écrit le lien dans
les journaux de l'API. C'est le mode actif aujourd'hui, et il permet de débloquer
manuellement un utilisateur si le fournisseur tombe.

> *Transition* : « Un mot sur la façon dont ces deux parcours se comportent. »

---

## 13 — Comportement des deux parcours · 1 minute 30

Le tableau compare les deux. Je m'arrête sur trois lignes.

**La validité** : 48 heures pour une invitation, 1 heure pour une
réinitialisation. C'est volontaire : une réinitialisation redonne l'accès à un
compte **déjà actif**, sa fenêtre d'exposition doit être minimale.

**Le quota** : trois demandes par email et par quart d'heure sur la
réinitialisation. Sans ça, cette page publique deviendrait un moyen d'inonder la
boîte mail d'un tiers.

**Le traitement de l'échec**, et c'est le plus intéressant. Sur l'invitation,
l'échec est signalé dans l'interface : l'administrateur peut transmettre le lien
autrement. Sur la réinitialisation, l'échec est **seulement journalisé**, et la
réponse ne change pas.

Pourquoi cette différence ? C'est l'encadré en bas à gauche. Email inconnu,
compte désactivé, quota atteint, panne d'envoi : la réponse est **toujours
identique**. Une réponse différenciée ferait de cette page publique un moyen de
découvrir quelles adresses possèdent un compte chez nous.

Dernier point, à droite : **seule l'empreinte du jeton est stockée en base**. Le
jeton en clair n'existe que dans l'email et dans l'URL cliquée. Une fuite de la
base de données ne permettrait donc de fabriquer aucun lien valide.

> *Transition* : « Terminons par la trajectoire : ce qui se passe quand on
> obtient le nom de domaine. »

---

## 14 — Passage au domaine et au HTTPS · 2 minutes 30

À gauche, la chaîne cible. Un proxy public en frontal, qui porte le domaine et
le certificat, et qui termine le TLS. Au-delà, le trafic reste en clair sur un
réseau Docker privé qui ne sort pas de la machine — c'est le modèle standard, et
il évite d'avoir à distribuer des certificats à chaque composant industriel, ce
qui serait de toute façon impossible sans les modifier.

Regardez les trois mentions « inchangé » : la gateway, le Nginx du laboratoire,
les composants. **Rien de tout ça ne bouge.**

À droite, la nature du travail. L'essentiel est de la **configuration** : le DNS,
le proxy, le certificat, les variables d'environnement. Le code nouveau se limite
à une stratégie de nommage et un aiguillage sur l'en-tête `Host` — de l'ordre de
130 lignes. Et une ligne de correction, dont je parle dans un instant. Le portail,
le frontend, les laboratoires et les logiciels industriels ne changent pas.

Deux pièges à connaître.

**Le certificat générique.** Un certificat pour `*.domaine.fr` couvre
`composant-labo.domaine.fr`, mais **pas** `composant.labo.domaine.fr`. Le
composant et le laboratoire doivent donc tenir dans une seule étiquette DNS,
séparés par un tiret. Sinon il faudrait un certificat par laboratoire.

**Le correctif impératif.** Le backend ne déclare pas aujourd'hui qu'il est
derrière un proxy. En l'état, dès qu'on le met derrière un reverse proxy, la
limitation anti-force-brute verrait **la même adresse IP pour tout le monde** —
celle du proxy. Un seul utilisateur en échec bloquerait tous les autres. C'est
une ligne de code, mais elle n'est pas optionnelle.

Et en bas, les deux en-têtes à ne pas oublier côté proxy : `Host`, parce que la
gateway aiguille dessus, et le couple `Upgrade`/`Connection`, sans lequel les
pages s'affichent mais **le temps réel reste figé**. C'est un symptôme trompeur :
au premier coup d'œil, tout semble fonctionner.

> *Transition* : « Je conclus. »

---

## 15 — Synthèse · 1 minute 30

Si vous ne retenez que quatre décisions, ce sont celles-là.

**Un démon Docker par laboratoire.** C'est ce qui permet à tous les labos de
réutiliser les mêmes adresses internes sans collision, et donc de ne modifier
aucune ligne de la configuration des logiciels industriels.

**Un réseau de laboratoires totalement fermé.** Ni base du portail, ni Internet.
C'est la garantie principale de la plateforme, et c'est la contrainte à laquelle
toutes les autres briques ont dû se plier.

**Une authentification des composants sans serveur tiers.** Un jeton signé par le
portail, vérifié localement avec un secret dérivé par laboratoire. Zéro appel
sortant, zéro serveur supplémentaire à exploiter.

**Une exposition réseau interchangeable.** Le portail ne construit jamais d'URL.
Passer aux sous-domaines et au HTTPS ne touchera ni le portail, ni le frontend,
ni les laboratoires.

Je suis à votre disposition pour vos questions.

---

# Annexe A — Questions probables

### « Pourquoi Docker-in-Docker et pas Kubernetes ? »

Parce que le besoin n'est pas d'orchestrer des services élastiques, mais de faire
tourner **un `docker compose` existant, tel quel**, avec ses adresses figées.
Kubernetes aurait imposé de convertir la topologie et de réécrire l'adressage —
donc de modifier les logiciels industriels. Docker-in-Docker donne à chaque labo
sa propre pile réseau et exécute le compose sans le toucher.

### « Docker-in-Docker, ce n'est pas dangereux ? »

Le conteneur de laboratoire est privilégié, oui — son démon interne l'exige.
C'est pour ça qu'on l'a entouré : image rootless, réseau `internal`, aucun port
sur l'hôte, aucun socket Docker de l'hôte monté dedans, quotas mémoire, CPU et
processus, et nettoyage automatique. La cible long terme reste une isolation par
mini-machine virtuelle ; le pilote existe déjà dans le code, il attend un hôte
équipé.

### « Fabriquer vos propres jetons, ce n'est pas risqué ? »

Nous ne faisons pas de cryptographie maison. C'est un JWT de structure standard,
signé en HMAC-SHA256 par la bibliothèque standard de Node. Les quatre pièges
classiques sont fermés explicitement : algorithme figé et vérifié, audience par
composant, expiration à 60 secondes, comparaison de signature à temps constant.
Et l'alternative — un serveur d'authentification externe — était structurellement
impossible ici, puisque le laboratoire ne peut joindre personne.

### « Que se passe-t-il si la gateway tombe ? »

Les laboratoires continuent de tourner : elle ne fait que relayer. L'accès aux
composants est interrompu le temps du redémarrage, et les points d'entrée sont
rouverts automatiquement à la resynchronisation, dans les cinq secondes. Aucune
donnée n'est perdue.

### « Combien de laboratoires en parallèle ? »

Environ neuf aujourd'hui, et la limite est **uniquement** la plage de ports
réservée — pas le matériel. Une simulation complète mesurée consomme environ
950 Mo de mémoire pour 6 Go alloués, et moins de 8 % de processeur. Le passage au
nom de domaine supprime cette limite.

### « Et si un client veut brancher son propre annuaire d'entreprise ? »

Deux scénarios très différents. Si c'est pour que ses collaborateurs se connectent
au **portail** avec leur compte d'entreprise, c'est un chantier significatif :
l'authentification actuelle serait remplacée. Si c'est pour l'accès aux composants
du labo, la contrainte réseau revient intacte — le labo ne peut joindre aucun
serveur externe, la validation devrait rester côté portail.

### « Vous avez retiré Keycloak alors que ça marchait, n'est-ce pas un gâchis ? »

Ça marchait dans une architecture où le laboratoire pouvait sortir. En fermant le
réseau des labos — décision de sécurité que nous assumons — l'hypothèse de départ
tombait. Le remplacement fait la même chose, sans serveur supplémentaire et sans
percer le cloisonnement. Nous avons échangé une brique lourde contre environ
150 lignes de code et un secret dérivé.

---

# Annexe B — Version courte, 15 minutes

Si le temps est réduit, gardez ces sept diapositives :

| Diapo | Contenu | Temps |
|---|---|---|
| 1 | Couverture | 30 s |
| 2 | Architecture globale | 3 min |
| 4 | Les trois réseaux Docker | 2 min |
| 5 | Ce que `internal` implique | 2 min |
| 8 | Pourquoi Keycloak a été abandonné | 2 min 30 |
| 9 | Ce qui le remplace | 3 min |
| 15 | Synthèse | 1 min 30 |

On perd les reverse proxies, les emails et la trajectoire HTTPS — mais on garde
le fil narratif complet : *nous avons isolé, ça nous a coûté Keycloak, voici
comment nous l'avons résolu.*

---

# Annexe C — Chiffres à avoir en tête

| Sujet | Valeur |
|---|---|
| Durée de vie du jeton de lancement | 60 secondes |
| Lien d'activation | 48 heures, usage unique |
| Lien de réinitialisation | 1 heure, usage unique |
| Quota de réinitialisation | 3 par email / 15 minutes |
| Blocage anti-force-brute | 5 échecs / 15 minutes |
| Durée d'une session | 12 heures |
| Arrêt automatique d'un labo inactif | 60 minutes |
| Destruction automatique | 24 heures |
| Resynchronisation de la gateway | 5 secondes |
| Quotas par laboratoire | 6 Go de mémoire, 4 cœurs, 4 096 processus |
| Consommation réelle mesurée | ~950 Mo, ~7,6 % de processeur |
| Laboratoires simultanés | ~9 (limite de la plage de ports) |
| Port SMTP retenu | 2525 (STARTTLS) |
