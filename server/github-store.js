// ─────────────────────────────────────────
//  STOCKAGE PERSISTANT VIA L'API GITHUB
//  (contourne le disque éphémère de Render)
// ─────────────────────────────────────────

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_DATA_REPO = process.env.GITHUB_DATA_REPO; // ex: "bungalowData/blast-data"
const GITHUB_DATA_BRANCH = process.env.GITHUB_DATA_BRANCH || 'main';

const API_BASE = 'https://api.github.com';

let warned = false;
function warnNoToken() {
    if (warned) return;
    warned = true;
    console.warn('[github-store] GITHUB_TOKEN ou GITHUB_DATA_REPO non configuré : les écritures ne seront pas persistées sur GitHub.');
}

function isConfigured() {
    return Boolean(GITHUB_TOKEN && GITHUB_DATA_REPO);
}

// Log de diagnostic au démarrage (n'affiche jamais le token complet)
if (isConfigured()) {
    const tokenPreview = `${GITHUB_TOKEN.slice(0, 8)}…(${GITHUB_TOKEN.length} car.)`;
    console.log(`[github-store] Configuré : repo="${GITHUB_DATA_REPO}" branche="${GITHUB_DATA_BRANCH}" token=${tokenPreview}`);
} else {
    console.warn('[github-store] Non configuré au démarrage : GITHUB_TOKEN et/ou GITHUB_DATA_REPO absents.');
}

// sha courant connu pour chaque fichier (nécessaire pour les écritures)
const shaCache = new Map();

// queue de promesses par fichier pour sérialiser les écritures
const queues = new Map();

function enqueue(filePath, task) {
    const prev = queues.get(filePath) || Promise.resolve();
    const next = prev.then(task, task);
    queues.set(filePath, next.catch(() => {}));
    return next;
}

async function githubRequest(method, filePath, body) {
    const url = `${API_BASE}/repos/${GITHUB_DATA_REPO}/contents/${encodeURIComponent(filePath)}`;
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'User-Agent': 'blast-server',
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return res;
}

async function fetchFile(filePath) {
    const res = await githubRequest('GET', `${filePath}?ref=${encodeURIComponent(GITHUB_DATA_BRANCH)}`);
    if (res.status === 404) {
        console.warn(`[github-store] ${filePath} introuvable sur ${GITHUB_DATA_REPO}@${GITHUB_DATA_BRANCH} (404) — vérifie le chemin/la branche.`);
        shaCache.set(filePath, null);
        return null;
    }
    if (!res.ok) {
        throw new Error(`GitHub GET ${filePath} a échoué : ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    shaCache.set(filePath, data.sha);
    const content = Buffer.from(data.content, 'base64').toString('utf8');
    return content;
}

async function readJson(filePath, fallback) {
    if (!isConfigured()) {
        warnNoToken();
        return fallback;
    }
    try {
        const content = await fetchFile(filePath);
        if (content === null) return fallback;
        return JSON.parse(content);
    } catch (e) {
        console.error(`[github-store] Erreur lecture ${filePath}:`, e.message);
        return fallback;
    }
}

async function writeJson(filePath, data, message) {
    if (!isConfigured()) {
        warnNoToken();
        return false;
    }
    return enqueue(filePath, () => doWrite(filePath, data, message));
}

async function doWrite(filePath, data, message, retried = false) {
    try {
        const content = Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64');
        const sha = shaCache.get(filePath);

        const body = {
            message: message || `Mise à jour de ${filePath}`,
            content,
            branch: GITHUB_DATA_BRANCH,
        };
        if (sha) body.sha = sha;

        const res = await githubRequest('PUT', filePath, body);

        if ((res.status === 409 || res.status === 422) && !retried) {
            // Conflit de sha (409) ou sha manquant/obsolète (422) :
            // on récupère le sha à jour et on retente une fois
            await fetchFile(filePath);
            return doWrite(filePath, data, message, true);
        }

        if (!res.ok) {
            throw new Error(`GitHub PUT ${filePath} a échoué : ${res.status} ${await res.text()}`);
        }

        const result = await res.json();
        shaCache.set(filePath, result.content.sha);
        return true;
    } catch (e) {
        console.error(`[github-store] Erreur écriture ${filePath}:`, e.message);
        return false;
    }
}

module.exports = { readJson, writeJson, isConfigured };
