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

// ─────────────────────────────────────────
//  TEMPLATES DE SONDAGES
// ─────────────────────────────────────────
const TEMPLATES_FILE = path.join(__dirname, 'poll-templates.json');

function loadTemplates() {
    try {
        if (!fs.existsSync(TEMPLATES_FILE)) {
            fs.writeFileSync(TEMPLATES_FILE, '[]', 'utf8');
        }
        return JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8'));
    } catch (e) {
        console.error('Erreur lecture templates:', e);
        return [];
    }
}

function saveTemplates(templates) {
    try {
        fs.writeFileSync(TEMPLATES_FILE, JSON.stringify(templates, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('Erreur écriture templates:', e);
        return false;
    }
}

// ─────────────────────────────────────────
//  SONDAGE  (existant, inchangé)
// ─────────────────────────────────────────
let votes = [];
let currentPoll = { question: '', reponses: [] };
let currentImage = null;

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

app.get('/declencher-sondage', (req, res) => {
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
io.on('connection', (socket) => {
    console.log(`Nouvelle connexion : ${socket.id}`);

    // ── Envoyer l'image en cours au nouveau client ──
    if (currentImage) {
        socket.emit('show_image', { imageUrl: currentImage });
    }

    // ── Sondage (existant) ──
    socket.on('demander_sondage', () => {
        io.emit('afficher_sondage', currentPoll);
    });

    socket.on('nouveau_sondage', (data) => {
        currentPoll = { question: data.question, reponses: data.reponses };
        votes = [];
        console.log(`Nouveau sondage : ${data.question}`);
        io.emit('afficher_sondage', currentPoll);
    });

    // ── Admin : vibrer tous les clients ──
    socket.on('admin_vibrate', () => {
        io.emit('vibrate');
        console.log('Vibration déclenchée par admin');
    });

    // ── Admin : afficher image plein écran ──
    socket.on('show_image', ({ imageUrl }) => {
        if (!imageUrl || typeof imageUrl !== 'string') return;
        currentImage = imageUrl.trim();
        io.emit('show_image', { imageUrl: currentImage });
        console.log(`Image affichée : ${currentImage}`);
    });

    // ── Admin : masquer image ──
    socket.on('hide_image', () => {
        currentImage = null;
        io.emit('hide_image');
        console.log('Image masquée');
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

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'blast-admin';

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
    });
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
    const templates = loadTemplates();
    res.send({ success: true, templates });
});

// Ajouter un nouveau template
app.post('/admin/poll-templates/add', (req, res) => {
    const { password, question, reponses } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect.' });
    }
    if (!question || !Array.isArray(reponses) || reponses.length < 2) {
        return res.status(400).send({ error: 'Question et au moins 2 réponses requises.' });
    }

    const templates = loadTemplates();

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

    if (!saveTemplates(templates)) {
        return res.status(500).send({ error: 'Erreur lors de la sauvegarde.' });
    }

    console.log(`Nouveau template créé : "${newTemplate.question}"`);
    res.send({ success: true, template: newTemplate });
});

// Supprimer un template
app.post('/admin/poll-templates/delete', (req, res) => {
    const { password, id } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).send({ error: 'Mot de passe incorrect.' });
    }
    if (!id) {
        return res.status(400).send({ error: 'ID du template requis.' });
    }

    let templates = loadTemplates();
    const before = templates.length;
    templates = templates.filter(t => t.id !== id);

    if (templates.length === before) {
        return res.status(404).send({ error: 'Template introuvable.' });
    }

    if (!saveTemplates(templates)) {
        return res.status(500).send({ error: 'Erreur lors de la sauvegarde.' });
    }

    console.log(`Template supprimé : ${id}`);
    res.send({ success: true });
});

// ─────────────────────────────────────────
server.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
