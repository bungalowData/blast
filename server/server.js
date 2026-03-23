const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

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
//  SONDAGE  (existant, inchangé)
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
server.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
