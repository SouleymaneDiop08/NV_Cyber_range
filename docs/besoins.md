il y'a une gestion centralisée des accés à partir du portal permettant ainsi d'avoir accés aux différents utilisateurs.
Les types utilisateurs qu'on aura : 
- Le superadmin c'est à dire l'équipe talixman délivre les accés aux futurs utilisateurs en créant les profils autres superadmin, admin et leur liant à un secteur dans le lequel les users évoluent (dispatching electrique, raffinerie, systeme ferroviaire), gére les services qui seront accessibles depuis le portal. Au niveau de la page de superadmin, il gére (ajoute, supprime, autorise, modifier les informations) les services qui seront accéssibles aux admin et aux invités pour chaque secteur existant.
- L'admin ou le client , qui crée que les invités ou simple visualiseur et peut accéder au différent services du cyber range.
- Les invités simples héritent du secteur dans lequel évoluent les admins qui les aient créer et auront accés au service du cyber range mais qu'en visuel (il ne pourront pas jouer des scénarios) ils auront donc qu'accés à la vue 3D et la vue opérateur.

Pour la gestion du code OTP lorsque l'admin crée un email pour l'utilisateur.
Dans ce cas, c'est l'administrateur qui déclenche l'inscription. Un scénario courant est le suivant :
L'admin crée le compte (nom, email, rôle, etc.).
Le serveur génère un secret TOTP pour cet utilisateur et le stocke.
L'utilisateur reçoit une invitation (par email, par exemple) avec un lien pour activer son compte.Lors de la première connexion, l'utilisateur :
choisit son mot de passe (si ce n'est pas déjà fait),
voit un QR Code,le scanne avec Google Authenticator,
saisit le premier code à 6 chiffres pour confirmer l'activation.
À partir de là, chaque connexion demandera le mot de passe puis le code généré par Google Authenticator.

Dans le processus d'authentification, en plus du username password, un code OTP provenant de google authenticator doit être fournies.
Aprés l'authentification, en fonction du secteur dans lequel évolue le client, des boxs presentant les services spécifiques à son domaine simulé lui seront présentes. Et pour accéder à ses services, il pourrait les faire en un clic.


Sans authentification nul ne doit pouvoir avoir accès aux différents service du cyber range.

les services du cyber ranges sont exposé via leur numéro de port (ex 1881,8080,8090,...) et c'est à partir de du portal que les utilisateurs auront accés aux services du cyber range.
