const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*", // Autorise toutes les origines (à restreindre en production)
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

const PORT = 3000;

// Tableau pour stocker les votes
let votes = [];
// Variable pour stocker le sondage actuel
let currentPoll = { question: '', reponses: [] };

// Route pour recevoir les votes
app.post('/vote', (req, res) => {
    const { option } = req.body;
    if (!option) {
        return res.status(400).send({ error: "L'option de vote est requise." });
    }
    votes.push(option);
    console.log(`Vote reçu : ${option}`);
    res.send({ success: true, message: "Vote enregistré avec succès !" });
});

// Route pour obtenir les résultats des votes
app.get('/results', (req, res) => {
    const result = {};
    currentPoll.reponses.forEach(reponse => {
        result[reponse] = votes.filter(v => v === reponse).length;
    });
    res.send(result);
});

// Gestion des connexions WebSocket
io.on('connection', (socket) => {
    console.log('Un client est connecté');

    // Écoutez un événement personnalisé pour déclencher l'affichage du sondage
    socket.on('demander_sondage', () => {
        console.log('Demande d\'affichage du sondage reçue');
        io.emit('afficher_sondage', currentPoll); // Émettez le sondage actuel à tous les clients connectés
    });

    // Écoutez un événement pour créer un nouveau sondage
    socket.on('nouveau_sondage', (data) => {
        currentPoll = { question: data.question, reponses: data.reponses };
        votes = []; // Réinitialiser les votes pour le nouveau sondage
        console.log(`Nouveau sondage créé : ${data.question}`);
        io.emit('afficher_sondage', currentPoll); // Émettez le nouveau sondage à tous les clients connectés
    });
});

app.get('/declencher-sondage', (req, res) => {
    io.emit('afficher_sondage', currentPoll); // Émettez le sondage actuel à tous les clients connectés
    res.send({ success: true, message: "Sondage déclenché avec succès !" });
});

server.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
});
