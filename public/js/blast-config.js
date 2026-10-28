// Adresse du serveur BLAST, partagée par toutes les pages et le service worker
// (d'où `self` plutôt que `window`).
//
// Page servie depuis la machine ou le réseau local (tests) : on vise le serveur
// de développement sur le port 3000 de la même machine. Partout ailleurs : le
// serveur de production sur Render.
self.BLAST_SERVER = (function () {
    var h = location.hostname;
    var local = h === 'localhost' || h === '127.0.0.1' || h === '[::1]' ||
        /^(10|192\.168)\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /\.local$/.test(h);
    return local ? 'http://' + h + ':3000' : 'https://blast-mg48.onrender.com';
})();
