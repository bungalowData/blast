// ─────────────────────────────────────────
//  BLAST — le téléphone comme instrument de la régie
// ─────────────────────────────────────────
//
// Chargé par la page principale (index_new.html), qui garde le plein écran au
// dessus du chat. Tout ce que la régie pilote et qui doit COUVRIR le chat vit
// ici : lumière (écran coloré + lampe torche), cartons, flash de remplacement
// de la vibration sur iPhone. S'y ajoutent ce qui demande l'accord du
// spectateur : la lampe (caméra), les notifications push, l'installation.
//
// Le chat (chat.html, dans l'iframe) appelle window.parent.BlastPhone pour son
// tutoriel et son bouton ✨ : même origine, donc accès direct.
//
// Rien ici ne doit casser la page si une API manque : chaque fonction teste ce
// dont elle a besoin et se replie sur l'écran.

(function () {
    'use strict';

    var SERVER = window.BLAST_SERVER;

    // localStorage peut lever une exception (navigation privée, stockage bloqué)
    var store = {
        get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
    };

    var listeners = [];
    function changed() {
        listeners.forEach(function (fn) { try { fn(); } catch (e) { } });
        renderPanel();
    }

    function $(id) { return document.getElementById(id); }

    function isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    function isStandalone() {
        return window.matchMedia('(display-mode: standalone)').matches ||
            window.matchMedia('(display-mode: fullscreen)').matches ||
            navigator.standalone === true;
    }

    // ─────────────────────────────────────────
    //  ÉCRAN : la couche de lumière
    // ─────────────────────────────────────────
    function setScreen(color) {
        var o = $('light-overlay');
        if (!o) return;
        if (color) {
            o.style.background = color;
            o.classList.add('on');
        } else {
            o.classList.remove('on');
        }
    }

    // ─────────────────────────────────────────
    //  LAMPE TORCHE
    // ─────────────────────────────────────────
    // La lampe appartient à la caméra arrière : il faut l'ouvrir (avec
    // l'accord du spectateur) et la garder ouverte tant qu'on veut s'en servir.
    // Aucune image n'est lue ni envoyée.
    var torch = {
        state: 'off',      // off | pending | ready | unavailable | denied
        stream: null,
        track: null,
        wanted: false,     // la régie veut la lampe allumée en ce moment
        lit: false,        // dernier état demandé à la lampe
    };

    function torchSupported() {
        return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    function trackHasTorch(track) {
        try {
            if (track.getCapabilities) {
                var caps = track.getCapabilities();
                if (caps && 'torch' in caps) {
                    return caps.torch === true || (Array.isArray(caps.torch) && caps.torch.indexOf(true) >= 0);
                }
                return false;
            }
        } catch (e) { }
        var sc = navigator.mediaDevices.getSupportedConstraints ? navigator.mediaDevices.getSupportedConstraints() : {};
        return !!sc.torch;
    }

    function stopStream(stream) {
        if (stream) stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } });
    }

    function openCamera(video) {
        return navigator.mediaDevices.getUserMedia({ video: video, audio: false }).then(function (stream) {
            return { stream: stream, track: stream.getVideoTracks()[0] };
        });
    }

    // Plusieurs caméras arrière (grand-angle, télé…) : la lampe n'est rattachée
    // qu'à une seule. On essaie d'abord la caméra arrière par défaut, puis les
    // autres une par une.
    function findTorchCamera() {
        return openCamera({ facingMode: { ideal: 'environment' } }).then(function (cam) {
            if (trackHasTorch(cam.track)) return cam;
            stopStream(cam.stream);
            return navigator.mediaDevices.enumerateDevices().then(function (devices) {
                var cams = devices.filter(function (d) { return d.kind === 'videoinput' && d.deviceId; });
                // Les caméras arrière d'abord : c'est là qu'est la lampe
                cams.sort(function (a, b) {
                    var back = /back|rear|arri|environment/i;
                    return (back.test(b.label) ? 1 : 0) - (back.test(a.label) ? 1 : 0);
                });
                var i = 0;
                function next() {
                    if (i >= cams.length) return null;
                    var d = cams[i++];
                    return openCamera({ deviceId: { exact: d.deviceId } }).then(function (c) {
                        if (trackHasTorch(c.track)) return c;
                        stopStream(c.stream);
                        return next();
                    }, next);
                }
                return next();
            });
        });
    }

    // Certains navigateurs coupent une caméra que rien n'affiche : on la
    // branche sur une vidéo invisible.
    function attachVideo(stream) {
        var v = $('torch-video');
        if (!v) {
            v = document.createElement('video');
            v.id = 'torch-video';
            v.muted = true;
            v.setAttribute('muted', '');
            v.setAttribute('playsinline', '');
            v.setAttribute('aria-hidden', 'true');
            v.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0.01;pointer-events:none;left:0;bottom:0;';
            document.body.appendChild(v);
        }
        // Simple précaution : si elle échoue, la lampe doit marcher quand même
        try {
            v.srcObject = stream;
            var p = v.play();
            if (p && p.catch) p.catch(function () { });
        } catch (e) {
            console.warn('Vidéo de maintien de la caméra impossible :', e);
        }
    }

    function setTorchState(s) {
        torch.state = s;
        changed();
    }

    function enableTorch() {
        if (!torchSupported()) { setTorchState('unavailable'); return Promise.resolve(torch.state); }
        if (torch.state === 'ready' && torch.track && torch.track.readyState === 'live') return Promise.resolve('ready');
        setTorchState('pending');
        return findTorchCamera().then(function (cam) {
            if (!cam) {
                setTorchState('unavailable');
                store.set('blast_torch', 'unavailable');
                return torch.state;
            }
            torch.stream = cam.stream;
            torch.track = cam.track;
            torch.lit = false;
            attachVideo(cam.stream);
            cam.track.addEventListener('ended', function () {
                torch.track = null;
                torch.stream = null;
                if (torch.state === 'ready') setTorchState('off');
            });
            store.set('blast_torch', 'on');
            setTorchState('ready');
            // La régie a peut-être déjà allumé : on suit
            if (lightState) handleLight(lightState);
            return 'ready';
        }).catch(function (e) {
            console.warn('Lampe torche indisponible :', e);
            var denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
            setTorchState(denied ? 'denied' : 'unavailable');
            return torch.state;
        });
    }

    function disableTorch() {
        applyTorch(false);
        stopStream(torch.stream);
        torch.stream = null;
        torch.track = null;
        store.set('blast_torch', 'off');
        setTorchState('off');
    }

    function applyTorch(on) {
        torch.wanted = on;
        if (!torch.track || torch.track.readyState !== 'live') return Promise.resolve(false);
        if (torch.lit === on) return Promise.resolve(true);
        torch.lit = on;
        return torch.track.applyConstraints({ advanced: [{ torch: on }] }).then(function () { return true; }, function (e) {
            console.warn('Commande de la lampe refusée :', e);
            torch.lit = !on;
            return false;
        });
    }

    // Lampe déjà acceptée lors d'une visite précédente : on la rouvre sans
    // redemander, seulement si le navigateur confirme que l'accès est acquis.
    function restoreTorch() {
        if (store.get('blast_torch') !== 'on' || !torchSupported()) return;
        if (!navigator.permissions || !navigator.permissions.query) return;
        navigator.permissions.query({ name: 'camera' }).then(function (p) {
            if (p.state === 'granted') enableTorch();
        }, function () { });
    }

    // ─────────────────────────────────────────
    //  LUMIÈRE (commande de la régie)
    // ─────────────────────────────────────────
    // { on, mode: screen|torch|both, color, flash (ms), strobe (Hz) }
    var lightState = null;
    var flashTimer = null;
    var strobeTimer = null;

    // Au-delà de 4 Hz la lampe ne suit plus (chaque commande prend des dizaines
    // de millisecondes) : elle reste allumée pendant que l'écran clignote.
    var TORCH_MAX_STROBE = 4;

    function handleLight(l) {
        clearTimeout(flashTimer);
        clearInterval(strobeTimer);
        strobeTimer = null;

        lightState = l && l.on ? l : null;
        if (!lightState) {
            setScreen(null);
            applyTorch(false);
            return;
        }

        var torchReady = torch.state === 'ready';
        var useTorch = l.mode !== 'screen' && torchReady;
        // Lampe demandée mais absente sur ce téléphone : l'écran prend le relais
        var useScreen = l.mode !== 'torch' || !useTorch;
        var torchStrobes = l.strobe > 0 && l.strobe <= TORCH_MAX_STROBE;

        function phase(on) {
            setScreen(useScreen && on ? l.color : null);
            if (useTorch) applyTorch(torchStrobes ? on : true);
        }

        phase(true);
        if (l.strobe > 0) {
            var lit = true;
            strobeTimer = setInterval(function () { lit = !lit; phase(lit); }, 500 / l.strobe);
        }
        if (l.flash > 0) {
            flashTimer = setTimeout(function () { handleLight({ on: false }); }, l.flash);
        }
    }

    // ─────────────────────────────────────────
    //  VIBRATION — remplacement sur iPhone
    // ─────────────────────────────────────────
    // Le chat (iframe) fait vibrer. Là où la vibration n'existe pas (iPhone),
    // un bref éclair d'écran signale l'action de la régie.
    function handleVibrate() {
        if ('vibrate' in navigator) return;
        if (lightState) return;
        var o = $('light-overlay');
        if (!o) return;
        o.style.background = '#ffffff';
        o.classList.add('blink');
        setTimeout(function () { o.classList.remove('blink'); }, 160);
    }

    // ─────────────────────────────────────────
    //  CARTONS
    // ─────────────────────────────────────────
    var ALIGN = { gauche: 'left', centre: 'center', droite: 'right', justifie: 'justify' };

    function setText(node, text) {
        node.textContent = text || '';
        node.style.display = text ? '' : 'none';
    }

    function showCarton(c) {
        var o = $('carton-overlay');
        if (!o || !c) return;

        o.style.color = c.couleur || '#ffffff';
        o.classList.toggle('titre-bas', !!c.titreSousLeTexte);

        var img = $('carton-image');
        if (c.imageUrl) {
            img.src = c.imageUrl;
            img.style.display = '';
        } else {
            img.removeAttribute('src');
            img.style.display = 'none';
        }

        setText($('carton-titre'), c.titreEnMajuscules === false ? c.titre : (c.titre || '').toUpperCase());
        setText($('carton-soustitre'), c.sousTitre);
        setText($('carton-texte'), c.texte);
        $('carton-texte').style.textAlign = ALIGN[c.alignementTexte] || 'justify';

        var credit = [c.auteur, c.source].filter(Boolean).join('\n');
        setText($('carton-credit'), credit);
        $('carton-credit').style.textAlign = ALIGN[c.alignementCredit] || 'left';

        // Un carton fait de seul titre (UTOPIE, PART I…) est centré en grand
        o.classList.toggle('titre-seul', !c.texte && !c.auteur && !c.source && !c.imageUrl);

        o.classList.add('visible');
        requestAnimationFrame(function () {
            o.classList.add('shown');
            fitCarton();
        });
        if (c.imageUrl) img.onload = fitCarton;
    }

    function hideCarton() {
        var o = $('carton-overlay');
        if (!o) return;
        o.classList.remove('shown');
        setTimeout(function () {
            if (!o.classList.contains('shown')) o.classList.remove('visible');
        }, 450);
    }

    // Les tailles sont en vw ; une citation longue est réduite jusqu'à tenir
    // dans la hauteur de l'écran.
    function fitCarton() {
        var o = $('carton-overlay');
        var box = $('carton-box');
        if (!o || !box || !o.classList.contains('visible')) return;
        var k = 1;
        o.style.setProperty('--k', k);
        for (var i = 0; i < 16 && box.scrollHeight > o.clientHeight * 0.92; i++) {
            k *= 0.9;
            o.style.setProperty('--k', k.toFixed(3));
        }
    }
    window.addEventListener('resize', fitCarton);

    // ─────────────────────────────────────────
    //  ANTI-VEILLE
    // ─────────────────────────────────────────
    var wakeLock = null;
    function requestWakeLock() {
        if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
        navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }, function (e) {
            console.warn('Anti-veille refusé :', e);
        });
    }

    // ─────────────────────────────────────────
    //  SERVICE WORKER, PUSH, INSTALLATION
    // ─────────────────────────────────────────
    var swRegistration = null;
    var push = { state: 'off' };   // off | pending | on | denied | unsupported | ios-install | server-off | error
    var installPrompt = null;

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker.register('./sw.js').then(function (reg) {
            swRegistration = reg;
            syncPush();
        }, function (e) {
            console.warn('Service worker non enregistré :', e);
        });
    }

    function swReady() {
        if (swRegistration && swRegistration.active) return Promise.resolve(swRegistration);
        return Promise.race([
            navigator.serviceWorker.ready,
            new Promise(function (_, reject) { setTimeout(function () { reject(new Error('service worker absent')); }, 8000); }),
        ]);
    }

    function pushSupport() {
        if ('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window) return 'ok';
        // Safari iOS n'expose les notifications qu'aux PWA installées
        return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
    }

    function b64ToBytes(b64) {
        var s = b64.replace(/-/g, '+').replace(/_/g, '/');
        s += '='.repeat((4 - s.length % 4) % 4);
        var raw = atob(s);
        var out = new Uint8Array(raw.length);
        for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
        return out;
    }

    function sameKey(buffer, b64) {
        if (!buffer) return false;
        var a = new Uint8Array(buffer);
        var b = b64ToBytes(b64);
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    function setPushState(s) {
        push.state = s;
        changed();
        return s;
    }

    // Abonne (ou ré-abonne) ce téléphone et le déclare au serveur.
    function subscribe() {
        return swReady().then(function (reg) {
            return fetch(SERVER + '/push/public-key').then(function (r) {
                if (!r.ok) throw Object.assign(new Error('push désactivé côté serveur'), { code: 'server-off' });
                return r.json();
            }).then(function (data) {
                return reg.pushManager.getSubscription().then(function (sub) {
                    // Clé VAPID changée côté serveur : l'ancien abonnement ne sert plus
                    if (sub && !sameKey(sub.options && sub.options.applicationServerKey, data.publicKey)) {
                        return sub.unsubscribe().then(function () { return null; });
                    }
                    return sub;
                }).then(function (sub) {
                    return sub || reg.pushManager.subscribe({
                        userVisibleOnly: true,
                        applicationServerKey: b64ToBytes(data.publicKey),
                    });
                });
            });
        }).then(function (sub) {
            return fetch(SERVER + '/push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ subscription: sub.toJSON() }),
            }).then(function (r) {
                if (!r.ok) throw new Error('abonnement refusé par le serveur');
                store.set('blast_push', 'on');
                return setPushState('on');
            });
        });
    }

    function enablePush() {
        var sup = pushSupport();
        if (sup !== 'ok') return Promise.resolve(setPushState(sup));
        setPushState('pending');
        // requestPermission doit partir tout de suite, dans le geste du spectateur
        var asked = Notification.requestPermission();
        return Promise.resolve(asked).then(function (perm) {
            if (perm !== 'granted') return setPushState('denied');
            return subscribe();
        }).catch(function (e) {
            console.warn('Notifications indisponibles :', e);
            return setPushState(e && e.code === 'server-off' ? 'server-off' : 'error');
        });
    }

    function disablePush() {
        store.set('blast_push', 'off');
        return swReady().then(function (reg) {
            return reg.pushManager.getSubscription();
        }).then(function (sub) {
            if (!sub) return;
            var endpoint = sub.endpoint;
            return sub.unsubscribe().then(function () {
                return fetch(SERVER + '/push/unsubscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ endpoint: endpoint }),
                });
            });
        }).catch(function () { }).then(function () { setPushState('off'); });
    }

    // Au chargement : un téléphone déjà abonné se redéclare (le serveur a pu
    // perdre sa liste), sans rien redemander.
    function syncPush() {
        var sup = pushSupport();
        if (sup !== 'ok') { push.state = sup; changed(); return; }
        if (Notification.permission === 'denied') { setPushState('denied'); return; }
        if (Notification.permission === 'granted' && store.get('blast_push') === 'on') {
            subscribe().catch(function () { setPushState('off'); });
        }
    }

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        installPrompt = e;
        changed();
    });

    window.addEventListener('appinstalled', function () {
        installPrompt = null;
        changed();
    });

    function install() {
        if (!installPrompt) return Promise.resolve(false);
        var p = installPrompt;
        installPrompt = null;
        p.prompt();
        return p.userChoice.then(function (c) { changed(); return c && c.outcome === 'accepted'; });
    }

    // ─────────────────────────────────────────
    //  PANNEAU ✨ (effets)
    // ─────────────────────────────────────────
    var TORCH_LABELS = {
        off: 'Désactivée',
        pending: 'Activation…',
        ready: '✅ Activée',
        unavailable: 'Pas de lampe utilisable : l\'écran s\'allumera à la place',
        denied: 'Accès à la caméra refusé : autorise-le dans les réglages du navigateur',
    };

    var PUSH_LABELS = {
        off: 'Désactivées',
        pending: 'Activation…',
        on: '✅ Activées',
        denied: 'Refusées : autorise-les dans les réglages du téléphone',
        unsupported: 'Non disponibles sur ce navigateur',
        'ios-install': 'Sur iPhone : touche Partager puis « Sur l\'écran d\'accueil », ouvre BLAST depuis la nouvelle icône, puis reviens ici',
        'server-off': 'Pas encore disponibles pour ce spectacle',
        error: 'Activation impossible, réessaie plus tard',
    };

    function renderPanel() {
        var panel = $('effects-panel');
        if (!panel) return;
        $('fx-torch-status').textContent = TORCH_LABELS[torch.state] || '';
        var tb = $('fx-torch-btn');
        tb.textContent = torch.state === 'ready' ? 'Désactiver' : 'Activer la lampe';
        tb.disabled = torch.state === 'pending' || !torchSupported();

        $('fx-push-status').textContent = PUSH_LABELS[push.state] || '';
        var pb = $('fx-push-btn');
        pb.textContent = push.state === 'on' ? 'Désactiver' : 'Activer les notifications';
        pb.disabled = push.state === 'pending' || push.state === 'unsupported' || push.state === 'ios-install';

        var installRow = $('fx-install-row');
        var iosHint = isIOS() && !isStandalone();
        installRow.style.display = installPrompt || iosHint ? '' : 'none';
        $('fx-install-btn').style.display = installPrompt ? '' : 'none';
        $('fx-install-hint').style.display = iosHint ? '' : 'none';
    }

    function openPanel() {
        renderPanel();
        $('effects-panel').classList.add('open');
    }

    function closePanel() {
        $('effects-panel').classList.remove('open');
    }

    function bindPanel() {
        $('fx-torch-btn').addEventListener('click', function () {
            if (torch.state === 'ready') disableTorch(); else enableTorch();
        });
        $('fx-push-btn').addEventListener('click', function () {
            if (push.state === 'on') disablePush(); else enablePush();
        });
        $('fx-install-btn').addEventListener('click', install);
        $('fx-close').addEventListener('click', closePanel);
        $('effects-panel').addEventListener('click', function (e) {
            if (e.target === $('effects-panel')) closePanel();
        });
    }

    // ─────────────────────────────────────────
    //  BRANCHEMENT
    // ─────────────────────────────────────────
    function attach(socket) {
        socket.on('light', handleLight);
        socket.on('vibrate', handleVibrate);
        socket.on('show_carton', showCarton);
        socket.on('hide_carton', hideCarton);
    }

    function init() {
        bindPanel();
        renderPanel();
        registerServiceWorker();
        restoreTorch();
        requestWakeLock();
        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState !== 'visible') return;
            requestWakeLock();
            // La caméra a pu être coupée pendant que la page était cachée
            if (store.get('blast_torch') === 'on' && (!torch.track || torch.track.readyState !== 'live')) {
                restoreTorch();
            }
        });
    }

    window.BlastPhone = {
        attach: attach,
        init: init,
        enableTorch: enableTorch,
        disableTorch: disableTorch,
        enablePush: enablePush,
        disablePush: disablePush,
        install: install,
        openPanel: openPanel,
        closePanel: closePanel,
        torchState: function () { return torch.state; },
        pushState: function () { return push.state; },
        torchSupported: torchSupported,
        pushSupport: pushSupport,
        torchLabel: function () { return TORCH_LABELS[torch.state] || ''; },
        pushLabel: function () { return PUSH_LABELS[push.state] || ''; },
        onChange: function (fn) { listeners.push(fn); },
        // Pour les tests : rejouer une commande sans passer par le serveur
        _light: handleLight,
        _carton: showCarton,
        _hideCarton: hideCarton,
    };
})();
