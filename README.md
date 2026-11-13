Attention c'est la branche master qui est utilisée pour la github pages.
Pas la branche main!  ;)

---

## Pièces

- `public/` : les pages (GitHub Pages, `blast.blindsp0t.com`).
  - `index_new.html` : la page des spectateurs (web-app installable) : chat en iframe, sondages,
    images, cartons, lumière, panneau ✨ (lampe torche, notifications, installation).
  - `admin.html` : la régie web. La régie Unity (projet WormHole, onglet Public du Hub) fait la
    même chose, plus le miroir des cartons.
  - `js/blast-config.js` : adresse du serveur (`localhost:3000` quand la page est servie en local).
  - `js/blast-textes.js` : **tous les textes de l'accueil des spectateurs** (installation, pseudo,
    réglages, tutoriel). C'est le seul fichier à modifier pour les changer.
  - `js/blast-onboarding.js` + `css/blast-onboarding.css` : l'accueil lui-même (voir plus bas).
  - `js/blast-phone.js` : lumière, lampe torche, cartons, push, anti-veille côté téléphone.
  - `sw.js` + `manifest.webmanifest` + `icons/` : la web-app (PWA) et les notifications push.
- `server/` : le serveur Express + Socket.IO (Render, `blast-mg48.onrender.com`).
  - `presets.json` : les images et les sons proposés par la régie (admin.html et Unity).
  - `web-push.js` : notifications push sans dépendance npm.

## Variables d'environnement du serveur (Render)

| Variable | Rôle |
|---|---|
| `ADMIN_PASSWORD` | mot de passe de la régie (routes `/admin/*` **et** commandes socket) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | clés des notifications push, créées une fois : `node server/web-push.js --generate` |
| `VAPID_SUBJECT` | facultatif, `https://blast.blindsp0t.com` par défaut |
| `GITHUB_TOKEN`, `GITHUB_DATA_REPO`, `GITHUB_DATA_BRANCH` | stockage persistant (templates, tweets, abonnements push) |
| `TORCH_ARM_TIMEOUT_MS` | facultatif : désarmement automatique des flashs sans lumière, 10 min par défaut |

Sans clés VAPID, le push est simplement désactivé (le reste marche). Changer les clés invalide
tous les abonnements existants : les garder une fois créées.

## La régie est protégée

Les commandes envoyées aux téléphones (sondage, vibration, son, image, carton, lumière, push)
ne sont acceptées que d'une connexion socket.io qui présente le mot de passe admin à son
ouverture : `io(SERVER, { auth: { password } })`. `admin.html` le fait après le login ; Unity le
lit dans la variable d'environnement `BLAST_ADMIN_PASSWORD` du poste de régie.
`GET /declencher-sondage` demande l'en-tête `x-admin-password`.

Le serveur et les pages doivent être déployés **ensemble** : un ancien `admin.html` se verrait
refuser ses commandes par le nouveau serveur.

## L'accueil des spectateurs

1. **Sur le site, dans le navigateur d'un téléphone** : on pousse à installer l'app, et rien
   d'autre. Android : le bouton déclenche l'installation du navigateur (ou explique son menu).
   iPhone : trois étapes illustrées sur une seule page (Partager → « Sur l'écran d'accueil » → Ajouter), puis
   « ouvre BLAST depuis ton écran d'accueil ». Navigateur intégré (Instagram…) ou Brave sur
   iPhone : « ouvre ce lien dans Safari / Chrome ».
2. **Premier lancement de l'app** : pseudo, puis un réglage par écran (notifications, lampe,
   son), puis un récapitulatif.
3. **Le tutoriel**, puis le chat.

Qui refuse ou rate l'installation (« Continuer sans installer ») fait 2 et 3 dans le navigateur.
Sur ordinateur, pas d'installation proposée : on commence au pseudo.

Pourquoi rien avant l'installation : sur iPhone, l'app installée a sa propre mémoire, séparée
de Safari (pseudo et réglages seraient à refaire) ; sur Android, une caméra refusée dans Chrome
reste refusée dans l'app.

- **Textes** : `public/js/blast-textes.js`, commenté. Ajouter `?accueil` à l'adresse
  (`…/index_new.html?accueil`) rejoue tout l'accueil pour relire les textes. Changer `version`
  dans ce fichier remontre l'accueil à ceux qui l'ont déjà vu.
- **Pseudo d'un même téléphone** : le chat envoie un identifiant de téléphone avec le pseudo.
  Le serveur laisse ce téléphone reprendre son pseudo à une autre de ses connexions (l'onglet
  resté ouvert quand on passe dans l'app, une connexion fantôme après une coupure) ; l'ancienne
  affiche « BLAST est ouvert ailleurs ». Un autre téléphone reçoit toujours « pseudo déjà pris ».
- **Bouton ✨** : là où le navigateur n'installe pas d'un bouton (iPhone…), « Voir comment
  faire » rouvre la marche à suivre illustrée.
- Mémoire du téléphone : `blast_accueil_app` / `blast_accueil_web` (accueil fait, par version),
  `blast_install_choix` (a choisi le navigateur), `blast_install_fait`, `blast_app_vue`,
  `blast_nickname`, `blast_device`.

## Lampes torches : activer, armer, désarmer

Une lampe torche ne se pilote que caméra ouverte, et une caméra ouverte coûte de la batterie.
1. Le spectateur **active** la lampe une fois (accueil ou bouton ✨) : le téléphone demande
   l'accès, retient la caméra qui porte la lampe, la fait clignoter une fois (accueil), puis
   **referme** la caméra.
2. La régie **arme** les flashs quelques secondes avant de s'en servir (`admin.html` ou Unity) :
   les caméras se rouvrent, en basse résolution. Une lumière avec lampe arme d'elle-même, avec
   environ une seconde de retard pendant laquelle l'écran sert de relais.
3. **Désarmement** par la régie, automatiquement après 10 min sans lumière, ou pour un téléphone
   qui passe en arrière-plan (il se réarme à son retour).

La régie voit « Lampes : N prêtes sur M activées ». Si un navigateur redemanderait l'accès
(Chrome « cette fois uniquement », Safari après rechargement), la caméra n'est pas rouverte de
force : un bouton « Réactiver la lampe » apparaît sur le téléphone.

## Tester en local

1. Serveur : `node server/server.js` (avec `express`, `socket.io` et `cors` installés), sur le
   port 3000. Vérifier le chiffrement push : `node server/web-push.js --selftest`.
2. Pages : servir la racine du dépôt, par exemple `python -m http.server 8080`, puis ouvrir
   `http://localhost:8080/public/index_new.html` (téléphone) et `.../public/admin.html` (régie).
   `blast-config.js` vise alors `http://localhost:3000` tout seul.

La lampe torche, l'anti-veille et le push exigent HTTPS (ou `localhost`) : depuis un vrai
téléphone sur le réseau local en HTTP, seules la lumière d'écran, les cartons et les sondages
fonctionnent.

## Ce que permet un téléphone

| | Android (Chrome) | iPhone (Safari) |
|---|---|---|
| Vibration | oui | non : un bref éclair d'écran la remplace |
| Lampe torche | oui, après accord caméra | oui (iOS 17+), après accord caméra |
| Anti-veille | oui | oui (iOS 16.4+, 18.4+ une fois installée) |
| Notifications push | oui | seulement si BLAST est ajouté à l'écran d'accueil (iOS 16.4+) |
