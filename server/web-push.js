// ─────────────────────────────────────────
//  WEB PUSH SANS DÉPENDANCE
//  (chiffrement RFC 8291 + authentification VAPID RFC 8292)
// ─────────────────────────────────────────
//
// Pourquoi pas le paquet npm "web-push" : le dépôt n'a pas de package.json,
// et ajouter une dépendance obligerait à changer la commande de build sur
// Render. Tout ce qu'il faut est déjà dans le module crypto de Node :
// ECDH P-256, HKDF, AES-128-GCM et ECDSA.
//
// Le chiffrement est vérifié contre l'exemple de la RFC 8291 (annexe A) :
//   node server/web-push.js --selftest
// Et pour créer les clés VAPID à mettre dans les variables d'env de Render :
//   node server/web-push.js --generate

const crypto = require('crypto');
const https = require('https');
const { URL } = require('url');

// ── base64url ──
function b64urlEncode(buf) {
    return Buffer.from(buf).toString('base64')
        .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str) {
    const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
    return Buffer.from(s + '='.repeat((4 - s.length % 4) % 4), 'base64');
}

// ── Clés VAPID ──
function generateVAPIDKeys() {
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.generateKeys();
    return {
        publicKey: b64urlEncode(ecdh.getPublicKey()),          // 65 octets, point non compressé
        privateKey: b64urlEncode(ecdh.getPrivateKey()),        // 32 octets
    };
}

function validateVAPIDKeys(publicKey, privateKey) {
    const pub = b64urlDecode(publicKey);
    const priv = b64urlDecode(privateKey);
    if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY invalide (65 octets attendus)');
    if (priv.length !== 32) throw new Error('VAPID_PRIVATE_KEY invalide (32 octets attendus)');
    // La clé publique doit bien correspondre à la clé privée
    const ecdh = crypto.createECDH('prime256v1');
    ecdh.setPrivateKey(priv);
    if (!ecdh.getPublicKey().equals(pub)) throw new Error('Les clés VAPID publique et privée ne vont pas ensemble');
    return { pub, priv };
}

// ── JWT VAPID (ES256) ──
function vapidHeader(endpoint, { publicKey, privateKey, subject }) {
    const { pub, priv } = validateVAPIDKeys(publicKey, privateKey);
    const audience = new URL(endpoint).origin;
    const header = b64urlEncode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const claims = b64urlEncode(JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 3600,
        sub: subject,
    }));
    const key = crypto.createPrivateKey({
        key: {
            kty: 'EC', crv: 'P-256',
            d: b64urlEncode(priv),
            x: b64urlEncode(pub.subarray(1, 33)),
            y: b64urlEncode(pub.subarray(33, 65)),
        },
        format: 'jwk',
    });
    const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`),
        { key, dsaEncoding: 'ieee-p1363' });
    return `vapid t=${header}.${claims}.${b64urlEncode(signature)}, k=${publicKey}`;
}

// ── Chiffrement aes128gcm (RFC 8188 + RFC 8291) ──
function hkdf(salt, ikm, info, length) {
    return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));
}

/**
 * Chiffre `plaintext` pour un abonnement. `test` permet d'imposer la paire de
 * clés éphémère et le sel (pour l'autotest RFC) ; en production ils sont tirés
 * au hasard à chaque message.
 */
function encrypt(plaintext, uaPublicB64, authSecretB64, test = {}) {
    const uaPublic = b64urlDecode(uaPublicB64);
    const authSecret = b64urlDecode(authSecretB64);
    if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error('clé p256dh invalide');
    if (authSecret.length < 16) throw new Error('secret auth invalide');

    const ecdh = crypto.createECDH('prime256v1');
    if (test.asPrivate) ecdh.setPrivateKey(b64urlDecode(test.asPrivate));
    else ecdh.generateKeys();
    const asPublic = ecdh.getPublicKey();
    const ecdhSecret = ecdh.computeSecret(uaPublic);

    const salt = test.salt ? b64urlDecode(test.salt) : crypto.randomBytes(16);

    const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
    const ikm = hkdf(authSecret, ecdhSecret, keyInfo, 32);
    const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
    const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);

    // Un seul enregistrement : le délimiteur 0x02 marque le dernier, sans bourrage
    const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
    const ciphertext = Buffer.concat([
        cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([0x02])])),
        cipher.final(),
        cipher.getAuthTag(),
    ]);

    const recordSize = Buffer.alloc(4);
    recordSize.writeUInt32BE(4096, 0);
    const header = Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic]);
    return Buffer.concat([header, ciphertext]);
}

// ── Envoi ──
function post(endpoint, headers, body) {
    return new Promise((resolve, reject) => {
        const u = new URL(endpoint);
        const req = https.request({
            method: 'POST',
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            headers: { ...headers, 'Content-Length': body.length },
            timeout: 15000,
        }, (res) => {
            let text = '';
            res.on('data', c => { if (text.length < 2000) text += c; });
            res.on('end', () => resolve({ statusCode: res.statusCode, body: text }));
        });
        req.on('timeout', () => req.destroy(new Error('délai dépassé')));
        req.on('error', reject);
        req.end(body);
    });
}

/**
 * Envoie une notification. Résout { statusCode, gone } — gone = true quand le
 * service push dit que l'abonnement n'existe plus (404/410) : à oublier.
 */
async function sendNotification(subscription, payload, vapid, { ttl = 3600, urgency = 'high' } = {}) {
    if (!subscription || !subscription.endpoint || !subscription.keys) throw new Error('abonnement invalide');
    const body = encrypt(typeof payload === 'string' ? payload : JSON.stringify(payload),
        subscription.keys.p256dh, subscription.keys.auth);
    const res = await post(subscription.endpoint, {
        'Authorization': vapidHeader(subscription.endpoint, vapid),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        'TTL': String(ttl),
        'Urgency': urgency,
    }, body);
    return { statusCode: res.statusCode, gone: res.statusCode === 404 || res.statusCode === 410, body: res.body };
}

function isValidSubscription(sub) {
    if (!sub || typeof sub !== 'object') return false;
    if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || sub.endpoint.length > 1000) return false;
    const k = sub.keys || {};
    try {
        const p = b64urlDecode(k.p256dh);
        const a = b64urlDecode(k.auth);
        return p.length === 65 && p[0] === 0x04 && a.length >= 16 && a.length <= 64;
    } catch (e) {
        return false;
    }
}

module.exports = {
    generateVAPIDKeys, validateVAPIDKeys, vapidHeader, encrypt, sendNotification,
    isValidSubscription, b64urlEncode, b64urlDecode,
};

// ── Ligne de commande ──
if (require.main === module) {
    const arg = process.argv[2];
    if (arg === '--generate') {
        const keys = generateVAPIDKeys();
        console.log('VAPID_PUBLIC_KEY=' + keys.publicKey);
        console.log('VAPID_PRIVATE_KEY=' + keys.privateKey);
    } else if (arg === '--selftest') {
        // RFC 8291, section 5 et annexe A
        const expected = 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
            'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
            'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
        const out = b64urlEncode(encrypt('When I grow up, I want to be a watermelon',
            'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
            'BTBZMqHH6r4Tts7J_aSIgg',
            { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' }));
        const okCipher = out === expected;
        console.log('Chiffrement RFC 8291 :', okCipher ? 'OK' : 'ÉCHEC\n  obtenu  ' + out + '\n  attendu ' + expected);

        // VAPID : la signature produite doit se vérifier avec la clé publique
        const keys = generateVAPIDKeys();
        const h = vapidHeader('https://push.example.net/abc', { ...keys, subject: 'mailto:test@example.net' });
        const jwt = h.match(/t=([^,]+)/)[1].split('.');
        const pub = b64urlDecode(keys.publicKey);
        const pubKey = crypto.createPublicKey({
            key: { kty: 'EC', crv: 'P-256', x: b64urlEncode(pub.subarray(1, 33)), y: b64urlEncode(pub.subarray(33)) },
            format: 'jwk',
        });
        const okSig = crypto.verify('sha256', Buffer.from(jwt[0] + '.' + jwt[1]),
            { key: pubKey, dsaEncoding: 'ieee-p1363' }, b64urlDecode(jwt[2]));
        const claims = JSON.parse(b64urlDecode(jwt[1]).toString());
        console.log('Signature VAPID :', okSig && claims.aud === 'https://push.example.net' ? 'OK' : 'ÉCHEC');
        process.exit(okCipher && okSig ? 0 : 1);
    } else {
        console.log('Usage : node server/web-push.js --generate | --selftest');
    }
}
