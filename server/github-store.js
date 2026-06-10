// ─────────────────────────────────────────
//  STOCKAGE PERSISTANT VIA L'API GITHUB
//  (contourne le disque éphémère de Render)
// ─────────────────────────────────────────

// .trim() pour ignorer les espaces/retours à la ligne parasites
// parfois introduits en collant des valeurs dans les champs d'env Render
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').trim() || undefined;
const GITHUB_DATA_REPO = (process.env.GITHUB_DATA_REPO || '').trim() || undefined; // ex: "bungalowData/blast-data"
const GITHUB_DATA_BRANCH = (process.env.GITHUB_DATA_BRANCH || '').trim() || 'main';

const https = require('https');

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

// Implémentation via le module https natif (et non fetch/undici) :
// fetch supprime l'en-tête Authorization lors de redirections cross-origin,
// ce qui peut transformer une requête authentifiée en requête anonyme (→ 404
// sur un repo privé). https.request n'a pas ce comportement.
function githubRequest(method, filePath, { body, query } = {}) {
    return new Promise((resolve, reject) => {
        // Encoder uniquement le chemin du fichier (en préservant les éventuels
        // séparateurs de dossier), JAMAIS la query string : sinon le "?ref=..."
        // serait encodé en "%3Fref%3D..." et GitHub renverrait 404.
        const encodedPath = filePath
            .split('/')
            .map(encodeURIComponent)
            .join('/');
        const search = query ? `?${query}` : '';
        const url = new URL(`${API_BASE}/repos/${GITHUB_DATA_REPO}/contents/${encodedPath}${search}`);
        const payload = body ? JSON.stringify(body) : undefined;

        const headers = {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'blast-server',
        };
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }

        const req = https.request({
            hostname: url.hostname,
            path: url.pathname + url.search,
            method,
            headers,
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                resolve({
                    status: res.statusCode,
                    ok: res.statusCode >= 200 && res.statusCode < 300,
                    headers: {
                        get: (name) => res.headers[name.toLowerCase()] || null,
                    },
                    text: async () => text,
                    json: async () => JSON.parse(text),
                });
            });
        });

        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function fetchFile(filePath) {
    const res = await githubRequest('GET', filePath, {
        query: `ref=${encodeURIComponent(GITHUB_DATA_BRANCH)}`,
    });
    if (res.status === 404) {
        const requestId = res.headers.get('x-github-request-id');
        const cacheStatus = res.headers.get('x-cache') || res.headers.get('cf-cache-status');
        const bodyText = await res.text().catch(() => '');
        console.warn(`[github-store] ${filePath} introuvable sur ${GITHUB_DATA_REPO}@${GITHUB_DATA_BRANCH} (404) — vérifie le chemin/la branche. [request-id=${requestId} cache=${cacheStatus}] body=${bodyText}`);
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

        const res = await githubRequest('PUT', filePath, { body });

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
