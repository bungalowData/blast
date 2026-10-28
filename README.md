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
