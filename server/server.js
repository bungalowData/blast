const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // À restreindre en production
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Mot de passe de la régie : routes /admin/* et commandes socket (admin.html, Unity)
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'blast-admin';

const githubStore = require('./github-store');
const webPush = require('./web-push');

// ─────────────────────────────────────────
//  TEMPLATES DE SONDAGES
// ─────────────────────────────────────────
const TEMPLATES_FILE = path.join(__dirname, 'poll-templates.json');

// Cache en mémoire, persisté sur GitHub (server/poll-templates.json en fallback local)
let templatesCache = [];

function loadLocalTemplatesFallback() {
    try {
        if (!fs.existsSync(TEMPLATES_FILE)) {
            fs.writeFileSync(TEMPLATES_FILE, '[]', 'utf8');
        }
        return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    } catch (e) {
        console.error('Erreur lecture templates locaux:', e);
        return [];
    }
}

async function loadTemplates() {
    if (githubStore.isConfigured()) {
        templatesCache = await githubStore.readJson('poll-templates.json', []);
    } else {
        templatesCache = loadLocalTemplatesFallback();
    }
    return templatesCache;
}

async function saveTemplates(templates) {
    templatesCache = templates;
    if (githubStore.isConfigured()) {
        return githubStore.writeJson('poll-templates.json', templates, 'Mise à jour des templates de sondages');
    }
    try {
        fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Erreur écriture templates locaux:', e);
        return false;
    }
}

// ─────────────────────────────────────────
//  TWEETS
// ─────────────────────────────────────────
let tweetsCache = [];

async function loadTweets() {
    tweetsCache = await githubStore.readJson('tweets.json', []);
    return tweetsCache;
}

async function saveTweets(tweets) {
    tweetsCache = tweets;
    return githubStore.writeJson('tweets.json', tweets, 'Mise à jour des tweets');
}

// ─────────────────────────────────────────
//  PRESETS (images et sons de la régie)
// ─────────────────────────────────────────
// Une seule liste pour admin.html et la régie Unity, versionnée avec le serveur.
// Relue à chaque requête : le fichier est minuscule et on peut le modifier
// sans redémarrer.
const PRESETS_FILE = path.join(__dirname, 'presets.json');

function loadPresets() {
    try {
        const p = JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8'));
        return { images: Array.isArray(p.images) ? p.images : [], sounds: Array.isArray(p.sounds) ? p.sounds : [] };
    } catch (e) {
        console.error('Erreur lecture presets:', e);
        return { images: [], sounds: [] };
    }
}

app.get('/presets', (req, res) => {
    res.send(loadPresets());
});

// ─────────────────────────────────────────
//  NOTIFICATIONS PUSH
// ─────────────────────────────────────────
// Clés à créer une fois avec `node server/web-push.js --generate`, puis à
// renseigner dans les variables d'environnement de Render.
const VAPID = {
    publicKey: (process.env.VAPID_PUBLIC_KEY || '').trim(),
    privateKey: (process.env.VAPID_PRIVATE_KEY || '').trim(),
    subject: (process.env.VAPID_SUBJECT || '').trim() || 'https://blast.blindsp0t.com',
};

let pushEnabled = false;
if (VAPID.publicKey && VAPID.privateKey) {
    try {
        webPush.validateVAPIDKeys(VAPID.publicKey, VAPID.privateKey);
        pushEnabled = true;
        console.log('[push] Notifications push activées.');
    } catch (e) {
        console.error('[push] Désactivées :', e.message);
    }
} else {
    console.warn('[push] Désactivées : VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY absents.');
}

const MAX_PUSH_SUBSCRIPTIONS = 5000;
let pushSubscriptions = [];   // [{ endpoint, keys: { p256dh, auth }, createdAt }]
let pushSaveTimer = null;

async function loadPushSubscriptions() {
    if (!githubStore.isConfigured()) return;
    const list = await githubStore.readJson('push-subscriptions.json', []);
    pushSubscriptions = Array.isArray(list) ? list.filter(webPush.isValidSubscription) : [];
}

// Regroupe les écritures : 300 spectateurs qui s'abonnent dans la même minute
// ne doivent pas devenir 300 commits sur le dépôt de données.
function schedulePushSave() {
    if (!githubStore.isConfigured() || pushSaveTimer) return;
    pushSaveTimer = setTimeout(() => {
        pushSaveTimer = null;
        githubStore.writeJson('push-subscriptions.json', pushSubscriptions, 'Mise à jour des abonnements push')
            .catch(e => console.error('[push] Sauvegarde des abonnements impossible :', e));
    }, 10000);
}

function sanitizeNotification(d) {
    d = d || {};
    const url = typeof d.url === 'string' && /^(\.?\/|https:\/\/)/.test(d.url.trim()) ? d.url.trim().slice(0, 500) : './index_new.html';
    return {
        title: cleanText(d.title, 80) || 'BLAST',
        body: cleanText(d.body, 300),
        url,
        tag: cleanText(d.tag, 40) || 'blast',
    };
}

async function pushToAll(notification) {
    if (!pushEnabled) return { sent: 0, failed: 0, removed: 0, disabled: true };

    const payload = JSON.stringify(notification);
    const queue = pushSubscriptions.slice();
    const gone = new Set();
    let sent = 0, failed = 0;

    // 20 envois en parallèle : assez pour quelques centaines d'abonnés en
    // quelques secondes, sans ouvrir des centaines de connexions d'un coup.
    async function worker() {
        while (queue.length) {
            const sub = queue.shift();
            try {
                const r = await webPush.sendNotification(sub, payload, VAPID);
                if (r.statusCode >= 200 && r.statusCode < 300) {
                    sent++;
                } else {
                    failed++;
                    if (r.gone) gone.add(sub.endpoint);
                }
            } catch (e) {
                failed++;
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(20, queue.length) }, worker));

    if (gone.size) {
        pushSubscriptions = pushSubscriptions.filter(s => !gone.has(s.endpoint));
        schedulePushSave();
    }
    console.log(`[push] ${sent} envoyée(s), ${failed} échec(s), ${gone.size} abonnement(s) expiré(s)`);
    return { sent, failed, removed: gone.size };
}

app.get('/push/public-key', (req, res) => {
    if (!pushEnabled) return res.status(503).send({ error: 'Notifications push non configurées.' });
    res.send({ publicKey: VAPID.publicKey });
});

app.post('/push/subscribe', (req, res) => {
    if (!pushEnabled) return res.status(503).send({ error: 'Notifications push non configurées.' });
    const sub = req.body && req.body.subscription;
    if (!webPush.isValidSubscription(sub)) return res.status(400).send({ error: 'Abonnement invalide.' });

    const entry = {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        createdAt: new Date().toISOString(),
    };
    const i = pushSubscriptions.findIndex(s => s.endpoint === entry.endpoint);
    if (i >= 0) {
        pushSubscriptions[i] = entry;
    } else {
        if (pushSubscriptions.length >= MAX_PUSH_SUBSCRIPTIONS) {
            return res.status(507).send({ error: 'Trop d\'abonnements.' });
        }
        pushSubscriptions.push(entry);
    }
    schedulePushSave();
    res.send({ success: true });
});

app.post('/push/unsubscribe', (req, res) => {
    const endpoint = req.body && req.body.endpoint;
    if (typeof endpoint !== 'string') return res.status(400).send({ error: 'Endpoint requis.' });
    const before = pushSubscriptions.length;
    pushSubscriptions = pushSubscriptions.filter(s => s.endpoint !== endpoint);
    if (pushSubscriptions.length !== before) schedulePushSave();
    res.send({ success: true });
});

// ─────────────────────────────────────────
//  RÉGIE : état partagé et validation
// ─────────────────────────────────────────
// Ce que la régie affiche en ce moment sur les téléphones. Un spectateur qui
// arrive (ou qui recharge sa page) le reçoit dès sa connexion.
let currentImage = null;
let currentCarton = null;
let currentLight = null;

// ── Armement des lampes torches ──
// Une lampe n'est pilotable que caméra ouverte, et une caméra ouverte vide la
// batterie. Les téléphones la gardent donc fermée, et ne l'ouvrent que quand
// la régie « arme » les flashs, quelques secondes avant de s'en servir.
// Une lumière qui demande la lampe arme d'elle-même. Sans commande de lumière
// pendant TORCH_ARM_TIMEOUT_MS, le serveur désarme : une régie qui oublie ne
// doit pas laisser des centaines de caméras ouvertes.
const TORCH_ARM_TIMEOUT_MS = Number(process.env.TORCH_ARM_TIMEOUT_MS) || 10 * 60 * 1000;
let torchArmed = false;
let torchDisarmTimer = null;

function setTorchArmed(armed, reason) {
    clearTimeout(torchDisarmTimer);
    torchDisarmTimer = armed
        ? setTimeout(() => setTorchArmed(false, 'désarmement automatique, aucune lumière depuis ' +
            Math.round(TORCH_ARM_TIMEOUT_MS / 60000) + ' min'), TORCH_ARM_TIMEOUT_MS)
        : null;
    if (armed === torchArmed) return;
    torchArmed = armed;
    io.emit('torch_arm', { armed });
    console.log(`Flashs ${armed ? 'armés' : 'désarmés'}${reason ? ` (${reason})` : ''}`);
}

// Chaque téléphone dit où en est sa lampe : 'armed' (caméra ouverte),
// 'standby' (activée par le spectateur, caméra fermée) ou 'none'. Purement
// indicatif pour la régie : un compte, recalculé au plus deux fois par seconde.
const TORCH_STATES = ['armed', 'standby', 'none'];
let torchCountTimer = null;

function torchCounts() {
    let armed = 0, available = 0;
    for (const s of io.of('/').sockets.values()) {
        if (s.data.torch === 'armed') { armed++; available++; }
        else if (s.data.torch === 'standby') available++;
    }
    return { armed, available, armedByRegie: torchArmed };
}

function scheduleTorchCount() {
    if (torchCountTimer) return;
    torchCountTimer = setTimeout(() => {
        torchCountTimer = null;
        io.to('admins').emit('torch_count', torchCounts());
    }, 500);
}

function cleanText(v, max) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function clampNumber(v, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
}

function cleanColor(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '#ffffff';
}

function cleanPattern(p) {
    if (!Array.isArray(p)) return null;
    const out = p.slice(0, 20).map(v => Math.round(clampNumber(v, 0, 5000)));
    return out.length ? out : null;
}

const LIGHT_MODES = ['screen', 'torch', 'both'];

function sanitizeLight(d) {
    return {
        on: Boolean(d.on),
        mode: LIGHT_MODES.includes(d.mode) ? d.mode : 'both',
        color: cleanColor(d.color),
        flash: Math.round(clampNumber(d.flash, 0, 10000)),   // ms ; 0 = reste allumé
        strobe: clampNumber(d.strobe, 0, 12),                // Hz ; 0 = lumière fixe
    };
}

const CARTON_ALIGNS = ['gauche', 'centre', 'droite', 'justifie'];

function sanitizeCarton(d) {
    const imageUrl = typeof d.imageUrl === 'string' && /^https?:\/\//i.test(d.imageUrl.trim())
        ? d.imageUrl.trim().slice(0, 1000) : '';
    return {
        id: cleanText(d.id, 100),
        titre: cleanText(d.titre, 300),
        sousTitre: cleanText(d.sousTitre, 300),
        texte: cleanText(d.texte, 4000),
        auteur: cleanText(d.auteur, 300),
        source: cleanText(d.source, 300),
        imageUrl,
        couleur: cleanColor(d.couleur),
        alignementTexte: CARTON_ALIGNS.includes(d.alignementTexte) ? d.alignementTexte : 'justifie',
        alignementCredit: CARTON_ALIGNS.includes(d.alignementCredit) ? d.alignementCredit : 'gauche',
        titreEnMajuscules: d.titreEnMajuscules !== false,
        titreSousLeTexte: Boolean(d.titreSousLeTexte),
    };
}

// Toute commande de régie peut faire vibrer les téléphones en même temps :
// { vibrate: true } pour le motif par défaut, ou { vibrate: [400, 150, 400] }.
function vibrateIfAsked(d) {
    if (!d.vibrate) return;
    const pattern = cleanPattern(d.vibrate);
    io.emit('vibrate', pattern ? { pattern } : {});
}

// ─────────────────────────────────────────
//  SONDAGE
// ─────────────────────────────────────────
let votes = [];
let currentPoll = { question: '', reponses: [] };

app.post('/vote', (req, res) => {
    const { option } = req.body;
    if (!option) return res.status(400).send({ error: "L'option de vote est requise." });
    votes.push(option);
    console.log(`Vote reçu : ${option}`);
    res.send({ success: true, message: "Vote enregistré avec succès !" });
});

app.get('/results', (req, res) => {
    const result = {};
    currentPoll.reponses.forEach(reponse => {
        result[reponse] = votes.filter(v => v === reponse).length;
    });
    res.send(result);
});

// Rediffuse le sondage en cours sur tous les téléphones. Protégée : sans mot de
// passe, n'importe qui pouvait faire réapparaître le sondage chez tout le monde.
app.get('/declencher-sondage', (req, res) => {
    if (req.get('x-admin-password') !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect (en-tête x-admin-password).' });
    }
    io.emit('afficher_sondage', currentPoll);
    res.send({ success: true, message: "Sondage déclenché avec succès !" });
});

// ─────────────────────────────────────────
//  CHAT PUBLIC
// ─────────────────────────────────────────

// Pseudos actifs : socketId → nickname
const connectedUsers = new Map();

// Historique des 100 derniers messages (en mémoire)
const MAX_HISTORY = 100;
const messageHistory = [];

function addToHistory(msg) {
    messageHistory.push(msg);
    if (messageHistory.length > MAX_HISTORY) messageHistory.shift();
}

function broadcastUserCount() {
    io.emit('user_count', connectedUsers.size);
}

// ─────────────────────────────────────────
//  SOCKET.IO
// ─────────────────────────────────────────
// Une commande de régie n'est exécutée que si la connexion s'est présentée avec
// le mot de passe admin (handshake socket.io : auth: { password }). Avant, un
// spectateur pouvait tout déclencher depuis la console de son navigateur.
function onAdmin(socket, event, handler) {
    socket.on(event, (data) => {
        if (!socket.data.admin) {
            console.warn(`Commande admin refusée (${event}) pour ${socket.id}`);
            socket.emit('admin_status', { admin: false, refused: event });
            return;
        }
        handler(data && typeof data === 'object' ? data : {});
    });
}

io.on('connection', (socket) => {
    console.log(`Nouvelle connexion : ${socket.id}`);

    // ── Régie : authentification à la connexion ──
    // Une mauvaise clé ne ferme pas la connexion : la régie Unity est aussi un
    // participant du chat, et le chat doit marcher même sans droits admin.
    const auth = socket.handshake.auth || {};
    socket.data.admin = typeof auth.password === 'string' && auth.password === ADMIN_PASSWORD;
    if (auth.password !== undefined) {
        socket.emit('admin_status', { admin: socket.data.admin });
        console.log(socket.data.admin ? `Régie connectée : ${socket.id}` : `Mot de passe régie refusé : ${socket.id}`);
    }
    if (socket.data.admin) {
        socket.join('admins');
        socket.emit('torch_count', torchCounts());
    }

    // ── Rattraper l'état en cours (image, carton, lumière, armement) ──
    if (currentImage) socket.emit('show_image', { imageUrl: currentImage });
    if (currentCarton) socket.emit('show_carton', currentCarton);
    if (torchArmed) socket.emit('torch_arm', { armed: true });
    if (currentLight) socket.emit('light', currentLight);

    // ── Téléphone : état de sa lampe torche ──
    socket.on('torch_state', (data) => {
        const state = data && TORCH_STATES.includes(data.state) ? data.state : 'none';
        if (socket.data.torch === state) return;
        socket.data.torch = state;
        scheduleTorchCount();
    });

    // ── Sondage ──
    onAdmin(socket, 'demander_sondage', () => {
        io.emit('afficher_sondage', currentPoll);
    });

    onAdmin(socket, 'nouveau_sondage', async (data) => {
        const question = cleanText(data.question, 200);
        const reponses = Array.isArray(data.reponses)
            ? data.reponses.map(r => cleanText(String(r), 100)).filter(Boolean).slice(0, 10)
            : [];
        if (!question || reponses.length < 2) return;

        currentPoll = { question, reponses };
        votes = [];
        console.log(`Nouveau sondage : ${question}`);
        io.emit('afficher_sondage', currentPoll);
        vibrateIfAsked(data);

        if (data.push) {
            const result = await pushToAll({ title: 'Nouveau sondage', body: question, url: './index_new.html', tag: 'sondage' });
            socket.emit('push_result', result);
        }
    });

    // ── Admin : vibrer tous les clients ──
    onAdmin(socket, 'admin_vibrate', (data) => {
        const pattern = cleanPattern(data.pattern);
        io.emit('vibrate', pattern ? { pattern } : {});
        console.log('Vibration déclenchée par admin');
    });

    // ── Admin : diffuser un son sur tous les clients (sauf l'admin émetteur) ──
    onAdmin(socket, 'play_sound', (data) => {
        const soundUrl = cleanText(data.soundUrl, 1000);
        if (!/^https?:\/\//i.test(soundUrl)) return;
        socket.broadcast.emit('play_sound', { soundUrl });
        vibrateIfAsked(data);
        console.log(`Son diffusé : ${soundUrl}`);
    });

    // ── Admin : stopper la lecture sur tous les clients ──
    onAdmin(socket, 'stop_sound', () => {
        socket.broadcast.emit('stop_sound');
        console.log('Arrêt du son demandé par admin');
    });

    // ── Admin : afficher image plein écran ──
    onAdmin(socket, 'show_image', (data) => {
        const imageUrl = cleanText(data.imageUrl, 1000);
        if (!/^https?:\/\//i.test(imageUrl)) return;
        currentImage = imageUrl;
        io.emit('show_image', { imageUrl: currentImage });
        vibrateIfAsked(data);
        console.log(`Image affichée : ${currentImage}`);
    });

    // ── Admin : masquer image ──
    onAdmin(socket, 'hide_image', () => {
        currentImage = null;
        io.emit('hide_image');
        console.log('Image masquée');
    });

    // ── Admin : carton (le même qu'à l'écran dans Unity) ──
    onAdmin(socket, 'show_carton', (data) => {
        const carton = sanitizeCarton(data);
        if (!carton.titre && !carton.sousTitre && !carton.texte && !carton.imageUrl) return;
        currentCarton = carton;
        io.emit('show_carton', currentCarton);
        vibrateIfAsked(data);
        console.log(`Carton affiché : ${carton.id || carton.titre || '(sans titre)'}`);
    });

    onAdmin(socket, 'hide_carton', () => {
        currentCarton = null;
        io.emit('hide_carton');
        console.log('Carton masqué');
    });

    // ── Admin : lumière (écran coloré et/ou lampe torche) ──
    onAdmin(socket, 'light', (data) => {
        const light = sanitizeLight(data);
        // Un flash est un événement, pas un état : un retardataire ne doit pas
        // recevoir un flash fini depuis longtemps.
        currentLight = light.on && !light.flash ? light : (light.on ? currentLight : null);
        // La lampe demandée : on arme (les téléphones ouvrent leur caméra). Toute
        // commande de lumière repousse aussi le désarmement automatique.
        if (light.on && light.mode !== 'screen') setTorchArmed(true, 'lumière avec lampe');
        else if (torchArmed) setTorchArmed(true);
        io.emit('light', light);
        vibrateIfAsked(data);
        console.log(`Lumière : ${light.on ? `${light.mode} ${light.color}${light.flash ? ` flash ${light.flash} ms` : ''}${light.strobe ? ` strobe ${light.strobe} Hz` : ''}` : 'éteinte'}`);
    });

    // ── Admin : armer / désarmer les lampes torches ──
    onAdmin(socket, 'torch_arm', (data) => {
        setTorchArmed(Boolean(data.armed), 'régie');
        // Réponse même sans changement : la régie qui insiste voit l'état
        socket.emit('torch_arm', { armed: torchArmed });
    });

    // ── Admin : notification push à tous les abonnés ──
    onAdmin(socket, 'push_notify', async (data) => {
        const result = await pushToAll(sanitizeNotification(data));
        socket.emit('push_result', result);
    });

    // ── Chat : rejoindre avec un pseudo ──
    socket.on('join', ({ nickname }) => {
        if (!nickname || typeof nickname !== 'string') return;

        const trimmed = nickname.trim().slice(0, 32);
        if (!trimmed) return;

        // Vérifier si le pseudo est déjà pris
        const taken = [...connectedUsers.values()].some(
            n => n.toLowerCase() === trimmed.toLowerCase()
        );

        if (taken) {
            socket.emit('nickname_taken');
            return;
        }

        // Enregistrer l'utilisateur
        connectedUsers.set(socket.id, trimmed);
        socket.emit('join_success');

        // Envoyer l'historique au nouvel arrivant
        socket.emit('history', messageHistory);

        // Annoncer l'arrivée aux autres
        const sysMsg = `${trimmed} a rejoint le chat`;
        io.emit('system', sysMsg);

        // Mettre à jour le compteur
        broadcastUserCount();
        console.log(`${trimmed} a rejoint (${connectedUsers.size} en ligne)`);
    });

    // ── Chat : nouveau message ──
    socket.on('message', ({ nickname, text }) => {
        if (!nickname || !text) return;

        const trimmedText = String(text).trim().slice(0, 2000);
        if (!trimmedText) return;

        // Vérifier que le nickname correspond bien à ce socket
        const registeredNick = connectedUsers.get(socket.id);
        if (!registeredNick || registeredNick !== nickname) return;

        const msg = {
            nickname: registeredNick,
            text: trimmedText,
            timestamp: Date.now()
        };

        addToHistory(msg);
        io.emit('message', msg);
    });

    // ── Chat : indicateur de frappe ──
    socket.on('typing', ({ nickname, isTyping }) => {
        const registeredNick = connectedUsers.get(socket.id);
        if (!registeredNick) return;

        // Diffuser aux autres seulement
        socket.broadcast.emit('typing', {
            nickname: registeredNick,
            isTyping: Boolean(isTyping)
        });
    });

    // ── Déconnexion ──
    socket.on('disconnect', () => {
        if (socket.data.torch && socket.data.torch !== 'none') scheduleTorchCount();
        const nickname = connectedUsers.get(socket.id);
        if (nickname) {
            connectedUsers.delete(socket.id);
            io.emit('system', `${nickname} a quitté le chat`);
            broadcastUserCount();
            console.log(`${nickname} déconnecté (${connectedUsers.size} en ligne)`);
        }
    });
});

// ─────────────────────────────────────────
//  ADMIN
// ─────────────────────────────────────────

// Vider l'historique du chat
app.post('/admin/clear-history', (req, res) => {
    const { password, check } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect.' });
    }
    // Mode vérification seule (login check)
    if (check) {
        return res.send({ success: true, message: 'Authentifié.' });
    }
    messageHistory.length = 0;
    io.emit('history_cleared');
    console.log('Historique vidé par un administrateur');
    res.send({ success: true, message: 'Historique vidé avec succès.' });
});

// Stats pour la page admin
app.post('/admin/stats', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect.' });
    }
    res.send({
        messageCount: messageHistory.length,
        onlineCount: connectedUsers.size,
        voteCount: votes.length,
        currentPoll: currentPoll,
        socketCount: io.engine.clientsCount,
        pushEnabled,
        pushCount: pushSubscriptions.length,
        currentImage,
        currentCarton,
        currentLight,
        torch: torchCounts(),
    });
});

// Notification push à tous les abonnés (même chose que l'événement socket push_notify)
app.post('/admin/push', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect.' });
    }
    if (!pushEnabled) return res.status(503).send({ error: 'Notifications push non configurées.' });
    const result = await pushToAll(sanitizeNotification(req.body));
    res.send({ success: true, ...result });
});

// ─────────────────────────────────────────
//  ADMIN — TEMPLATES DE SONDAGES
// ─────────────────────────────────────────

// Lister tous les templates
app.post('/admin/poll-templates', (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect.' });
    }
    res.send({ success: true, templates: templatesCache });
});

// Ajouter un nouveau template
app.post('/admin/poll-templates/add', async (req, res) => {
    const { password, question, reponses } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect.' });
    }
    if (!question || !Array.isArray(reponses) || reponses.length < 2) {
        return res.status(400).send({ error: 'Question et au moins 2 réponses requises.' });
    }

    const templates = templatesCache;

    // Vérifier qu'un template identique n'existe pas déjà
    const duplicate = templates.some(t =>
        t.question.toLowerCase() === question.trim().toLowerCase()
    );
    if (duplicate) {
        return res.status(409).send({ error: 'Un template avec cette question existe déjà.' });
    }

    const newTemplate = {
        id: Date.now().toString(),
        question: question.trim().slice(0, 200),
        reponses: reponses.map(r => String(r).trim().slice(0, 100)).filter(Boolean),
        createdAt: new Date().toISOString()
    };

    templates.push(newTemplate);

    if (!await saveTemplates(templates)) {
        return res.status(500).send({ error: 'Erreur lors de la sauvegarde.' });
    }

    console.log(`Nouveau template créé : "${newTemplate.question}"`);
    res.send({ success: true, template: newTemplate });
});

// Supprimer un template
app.post('/admin/poll-templates/delete', async (req, res) => {
    const { password, id } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect.' });
    }
    if (!id) {
        return res.status(400).send({ error: 'ID du template requis.' });
    }

    let templates = templatesCache;
    const before = templates.length;
    templates = templates.filter(t => t.id !== id);

    if (templates.length === before) {
        return res.status(404).send({ error: 'Template introuvable.' });
    }

    if (!await saveTemplates(templates)) {
        return res.status(500).send({ error: 'Erreur lors de la sauvegarde.' });
    }

    console.log(`Template supprimé : ${id}`);
    res.send({ success: true });
});

// ─────────────────────────────────────────
//  TWEETS
// ─────────────────────────────────────────

// Récupérer le tweet existant d'un pseudo (pour préremplir la page)
app.get('/tweet/:pseudo', (req, res) => {
    const pseudo = String(req.params.pseudo || '').trim();
    if (!pseudo) return res.status(400).send({ error: 'Pseudo requis.' });

    const tweet = tweetsCache.find(
        t => t.pseudo.toLowerCase() === pseudo.toLowerCase()
    );
    res.send({ tweet: tweet || null });
});

// Poster ou mettre à jour son tweet
app.post('/tweet', async (req, res) => {
    const { pseudo, text } = req.body;

    const trimmedPseudo = String(pseudo || '').trim().slice(0, 32);
    const trimmedText = String(text || '').trim().slice(0, 160);

    if (!trimmedPseudo) return res.status(400).send({ error: 'Pseudo requis.' });
    if (!trimmedText) return res.status(400).send({ error: 'Le tweet ne peut pas être vide.' });

    const tweet = {
        pseudo: trimmedPseudo,
        text: trimmedText,
        timestamp: Date.now()
    };

    const existingIndex = tweetsCache.findIndex(
        t => t.pseudo.toLowerCase() === trimmedPseudo.toLowerCase()
    );

    if (existingIndex >= 0) {
        tweetsCache[existingIndex] = tweet;
    } else {
        tweetsCache.push(tweet);
    }

    if (!await saveTweets(tweetsCache)) {
        return res.status(500).send({ error: 'Erreur lors de la sauvegarde.' });
    }

    console.log(`Tweet de ${trimmedPseudo} : "${trimmedText}"`);
    res.send({ success: true, tweet });
});

// Vider l'historique des tweets (admin)
app.post('/admin/clear-tweets', async (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect.' });
    }

    tweetsCache = [];
    if (!await saveTweets(tweetsCache)) {
        return res.status(500).send({ error: 'Erreur lors de la sauvegarde.' });
    }

    console.log('Historique des tweets vidé par un administrateur');
    res.send({ success: true, message: 'Tweets supprimés avec succès.' });
});

// ─────────────────────────────────────────
(async () => {
    await loadTemplates();
    await loadTweets();
    await loadPushSubscriptions();
    server.listen(PORT, () => {
        console.log(`Serveur démarré sur http://localhost:${PORT}`);
    });
})();
