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
    // La lampe appartient à la caméra arrière : pour la piloter il faut la caméra
    // ouverte, et une caméra ouverte coûte de la batterie (capteur qui tourne,
    // voyant allumé). D'où un cycle en trois temps :
    //  1. Le spectateur l'ACTIVE une fois (tuto ou ✨) : on demande l'accès, on
    //     trouve la caméra qui porte la lampe, on la retient… et on referme.
    //  2. La régie ARME les flashs quelques secondes avant de s'en servir (ou
    //     envoie directement une lumière avec lampe) : la caméra se rouvre, en
    //     basse résolution, juste pour tenir la lampe.
    //  3. DÉSARMÉE par la régie, au bout d'un long silence, ou quand la page
    //     passe en arrière-plan : la caméra se referme.
    // Aucune image n'est lue ni envoyée.
    var torch = {
        // off         : pas activée par le spectateur
        // pending     : activation en cours (demande d'accès)
        // standby     : activée, caméra fermée
        // arming      : la régie a armé, caméra en cours d'ouverture
        // armed       : caméra ouverte, lampe pilotable
        // blocked     : la régie a armé, mais rouvrir ferait surgir la demande
        //               d'accès : il faut un geste du spectateur
        // unavailable : pas de lampe sur ce téléphone
        // denied      : accès à la caméra refusé
        state: 'off',
        stream: null,
        track: null,
        lit: false,        // dernier état demandé à la lampe
    };

    var serverArmed = false;          // la régie a armé les flashs
    var lastCommandAt = Date.now();   // dernière commande de lumière ou d'armement
    // Garde-fou si le serveur ne peut plus nous désarmer (réseau perdu) : le
    // serveur, lui, désarme au bout de 10 min sans lumière.
    var LOCAL_DISARM_MS = 15 * 60 * 1000;

    // Petite image, peu d'images par seconde : la caméra ne sert qu'à tenir la lampe
    var LOW_RES = { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 5, max: 15 } };

    function torchSupported() {
        return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    function torchEnabled() {
        return store.get('blast_torch') === 'on' && torch.state !== 'off' &&
            torch.state !== 'unavailable' && torch.state !== 'denied';
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

    function isDenied(e) {
        return !!e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    }

    function stopStream(stream) {
        if (stream) stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { } });
    }

    function videoConstraints(base, lowRes) {
        var c = {};
        var k;
        for (k in base) c[k] = base[k];
        if (lowRes) for (k in LOW_RES) c[k] = LOW_RES[k];
        return c;
    }

    function openCamera(video) {
        return navigator.mediaDevices.getUserMedia({ video: video, audio: false }).then(function (stream) {
            return { stream: stream, track: stream.getVideoTracks()[0] };
        });
    }

    // Plusieurs caméras arrière (grand-angle, télé…) : la lampe n'est rattachée
    // qu'à une seule. On essaie d'abord la caméra arrière par défaut, puis les
    // autres une par une.
    function searchTorchCamera(lowRes) {
        return openCamera(videoConstraints({ facingMode: { ideal: 'environment' } }, lowRes)).then(function (cam) {
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
                    return openCamera(videoConstraints({ deviceId: { exact: d.deviceId } }, lowRes)).then(function (c) {
                        if (trackHasTorch(c.track)) return c;
                        stopStream(c.stream);
                        return next();
                    }, next);
                }
                return next();
            });
        });
    }

    // La caméra retenue d'abord, en basse résolution ; sinon la recherche
    // complète, en basse résolution puis (rares téléphones qui refusent la
    // lampe en petite taille) en résolution normale.
    function openTorchCamera() {
        var id = store.get('blast_torch_device');
        var remembered = id
            ? openCamera(videoConstraints({ deviceId: { exact: id } }, true)).then(function (cam) {
                if (trackHasTorch(cam.track)) return cam;
                stopStream(cam.stream);
                return null;
            }, function (e) {
                if (isDenied(e)) throw e;
                return null;
            })
            : Promise.resolve(null);

        return remembered.then(function (cam) {
            return cam || searchTorchCamera(true).then(function (c) { return c || searchTorchCamera(false); });
        });
    }

    function rememberDevice(track) {
        try {
            var id = track.getSettings ? track.getSettings().deviceId : null;
            if (id) store.set('blast_torch_device', id);
        } catch (e) { }
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

    function detachVideo() {
        var v = $('torch-video');
        if (v) { try { v.srcObject = null; } catch (e) { } }
    }

    function setTorchState(s) {
        torch.state = s;
        reportTorch();
        changed();
    }

    // Garde la caméra ouverte : la lampe est pilotable
    function holdCamera(cam) {
        torch.stream = cam.stream;
        torch.track = cam.track;
        torch.lit = false;
        attachVideo(cam.stream);
        cam.track.addEventListener('ended', function () {
            if (torch.track !== cam.track) return;
            torch.track = null;
            torch.stream = null;
            if (torch.state === 'armed') setTorchState('standby');
        });
        setTorchState('armed');
        // La régie a peut-être déjà allumé : on suit
        if (lightState) handleLight(lightState);
    }

    function closeCamera() {
        applyTorch(false);
        detachVideo();
        stopStream(torch.stream);
        torch.stream = null;
        torch.track = null;
        torch.lit = false;
    }

    // L'activation par le spectateur (tuto ou ✨), dans son geste : c'est le
    // seul moment où la demande d'accès doit apparaître.
    function enableTorch() {
        if (!torchSupported()) { setTorchState('unavailable'); return Promise.resolve(torch.state); }
        if (torchEnabled() && torch.state !== 'blocked') return Promise.resolve(torch.state);
        setTorchState('pending');
        return openTorchCamera().then(function (cam) {
            if (!cam) {
                store.set('blast_torch', 'unavailable');
                setTorchState('unavailable');
                return torch.state;
            }
            store.set('blast_torch', 'on');
            rememberDevice(cam.track);
            if (serverArmed && document.visibilityState === 'visible') {
                holdCamera(cam);
            } else {
                // L'accès est acquis : la caméra se referme jusqu'à l'armement
                stopStream(cam.stream);
                setTorchState('standby');
            }
            return torch.state;
        }).catch(function (e) {
            console.warn('Lampe torche indisponible :', e);
            setTorchState(isDenied(e) ? 'denied' : 'unavailable');
            return torch.state;
        });
    }

    function disableTorch() {
        closeCamera();
        store.set('blast_torch', 'off');
        setTorchState('off');
    }

    function cameraPermission() {
        if (!navigator.permissions || !navigator.permissions.query) return Promise.resolve('unknown');
        return navigator.permissions.query({ name: 'camera' }).then(function (p) { return p.state; },
            function () { return 'unknown'; });
    }

    // Rouvre la caméra pour tenir la lampe. `geste` = appelé depuis un toucher
    // du spectateur : la demande d'accès peut alors apparaître sans surprise.
    function armTorch(geste) {
        if (store.get('blast_torch') !== 'on' || !torchSupported()) return Promise.resolve(torch.state);
        if (torch.state === 'armed' && torch.track && torch.track.readyState === 'live') return Promise.resolve('armed');
        if (torch.state === 'arming' || torch.state === 'pending') return Promise.resolve(torch.state);
        // Une page cachée ne peut pas ouvrir la caméra : on réarme au retour
        if (document.visibilityState !== 'visible') return Promise.resolve(torch.state);

        setTorchState('arming');
        var check = geste ? Promise.resolve('granted') : cameraPermission();
        return check.then(function (perm) {
            // Rouvrir sans accès acquis ferait surgir la demande du navigateur en
            // plein spectacle : on attend un toucher (bouton « Réactiver »).
            if (perm === 'prompt') { setTorchState('blocked'); return torch.state; }
            if (perm === 'denied') { setTorchState('denied'); return torch.state; }
            return openTorchCamera().then(function (cam) {
                if (!cam) { setTorchState('unavailable'); return torch.state; }
                // Désarmé pendant l'ouverture
                if (!serverArmed && !(lightState && lightState.mode !== 'screen')) {
                    stopStream(cam.stream);
                    setTorchState('standby');
                    return torch.state;
                }
                rememberDevice(cam.track);
                holdCamera(cam);
                return 'armed';
            });
        }).catch(function (e) {
            console.warn('Armement de la lampe impossible :', e);
            setTorchState(isDenied(e) ? 'denied' : 'standby');
            return torch.state;
        });
    }

    function disarmTorch() {
        closeCamera();
        if (torch.state === 'armed' || torch.state === 'arming' || torch.state === 'blocked') setTorchState('standby');
    }

    function applyTorch(on) {
        if (!torch.track || torch.track.readyState !== 'live') return Promise.resolve(false);
        if (torch.lit === on) return Promise.resolve(true);
        torch.lit = on;
        return torch.track.applyConstraints({ advanced: [{ torch: on }] }).then(function () { return true; }, function (e) {
            console.warn('Commande de la lampe refusée :', e);
            torch.lit = !on;
            return false;
        });
    }

    // Lampe activée lors d'une visite précédente : elle reste en attente, caméra
    // fermée. Elle ne se rouvrira que sur armement.
    function restoreTorch() {
        var saved = store.get('blast_torch');
        if (saved === 'on' && torchSupported()) setTorchState('standby');
        else if (saved === 'unavailable') setTorchState('unavailable');
    }

    function handleTorchArm(d) {
        lastCommandAt = Date.now();
        serverArmed = !!(d && d.armed);
        if (serverArmed) armTorch(); else disarmTorch();
    }

    // Ce que la régie compte : armée, en attente, ou rien
    var socketRef = null;
    function reportTorch() {
        if (!socketRef || !socketRef.connected) return;
        var s = torch.state === 'armed' ? 'armed' : torchEnabled() ? 'standby' : 'none';
        socketRef.emit('torch_state', { state: s });
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
        lastCommandAt = Date.now();
        clearTimeout(flashTimer);
        clearInterval(strobeTimer);
        strobeTimer = null;

        lightState = l && l.on ? l : null;
        if (!lightState) {
            setScreen(null);
            applyTorch(false);
            return;
        }

        var torchArmed = torch.state === 'armed';
        // Lampe demandée mais caméra fermée : on arme, la lampe suivra dès que
        // la caméra sera ouverte (holdCamera rejoue cette commande).
        if (l.mode !== 'screen' && !torchArmed && torchEnabled()) armTorch();

        var useTorch = l.mode !== 'screen' && torchArmed;
        // Lampe absente ou pas encore prête : l'écran prend le relais
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

    // Installation : sur Android (Chrome, Edge, Samsung…) le navigateur propose
    // lui-même d'installer, via beforeinstallprompt, qu'on garde pour un bouton.
    // Sur iPhone il n'y a pas de bouton possible : seulement des explications.
    var installed = false;

    window.addEventListener('beforeinstallprompt', function (e) {
        e.preventDefault();
        installPrompt = e;
        changed();
    });

    window.addEventListener('appinstalled', function () {
        installPrompt = null;
        installed = true;
        changed();
    });

    function install() {
        if (!installPrompt) return Promise.resolve(false);
        var p = installPrompt;
        installPrompt = null;
        p.prompt();
        return p.userChoice.then(function (c) {
            if (c && c.outcome === 'accepted') installed = true;
            changed();
            return installed;
        });
    }

    // Vaut-il la peine de proposer l'installation ? Pas dans l'app installée,
    // oui sur iPhone (explications), oui là où le navigateur sait installer —
    // même si sa proposition n'est pas encore arrivée : elle vient souvent
    // quelques secondes après le chargement, le bouton s'active alors.
    function installSuggested() {
        if (isStandalone()) return false;
        return isIOS() || !!installPrompt || 'onbeforeinstallprompt' in window;
    }

    function installLabel() {
        if (installed) return '✅ Installée : tu la retrouveras sur ton écran d\'accueil';
        if (installPrompt) return '';
        return 'Le bouton s\'active dès que le navigateur est prêt. S\'il reste grisé, BLAST est peut-être ' +
            'déjà installé ; sinon, menu ⋮ → « Installer l\'application ».';
    }

    // ─────────────────────────────────────────
    //  INSTALLATION SUR IPHONE
    // ─────────────────────────────────────────
    // Sur iPhone, seul un navigateur qui l'a prévu sait ajouter un site à l'écran
    // d'accueil : Safari, Chrome, Edge… mais pas Brave. Brave se reconnaît à
    // navigator.brave ; les autres à leur signature (CriOS, FxiOS…).
    function isBrave() {
        return !!navigator.brave;
    }

    function iosInstallHint() {
        var ua = navigator.userAgent;
        if (isBrave()) {
            return 'Brave ne sait pas installer d\'application sur iPhone : ouvre cette page dans Safari, ' +
                'puis touche Partager → « Sur l\'écran d\'accueil ».';
        }
        if (/FxiOS|OPiOS|DuckDuckGo|GSA\//.test(ua)) {
            return 'Ouvre cette page dans Safari, puis touche Partager → « Sur l\'écran d\'accueil ».';
        }
        return 'Touche Partager puis « Sur l\'écran d\'accueil ». Si ton navigateur ne le propose pas ' +
            '(Brave…), ouvre cette page dans Safari.';
    }

    // ─────────────────────────────────────────
    //  PANNEAU ✨ (effets)
    // ─────────────────────────────────────────
    var TORCH_LABELS = {
        off: 'Désactivée',
        pending: 'Activation…',
        standby: '✅ Activée : elle s\'allumera quand la régie en aura besoin',
        arming: '✅ Activée : préparation de la lampe…',
        armed: '✅ Activée et prête',
        blocked: 'La régie veut allumer ta lampe : touche « Réactiver la lampe »',
        unavailable: 'Pas de lampe utilisable : l\'écran s\'allumera à la place',
        denied: 'Accès à la caméra refusé : autorise-le dans les réglages du navigateur',
    };

    var PUSH_LABELS = {
        off: 'Désactivées',
        pending: 'Activation…',
        on: '✅ Activées',
        denied: 'Refusées : autorise-les dans les réglages du téléphone',
        unsupported: 'Non disponibles sur ce navigateur',
        'server-off': 'Pas encore disponibles pour ce spectacle',
        error: 'Activation impossible, réessaie plus tard',
    };

    function pushLabel() {
        if (push.state === 'ios-install') {
            return 'Sur iPhone, les notifications demandent BLAST installé. ' + iosInstallHint() +
                ' Ouvre ensuite BLAST depuis la nouvelle icône et reviens ici.';
        }
        return PUSH_LABELS[push.state] || '';
    }

    function renderPanel() {
        var panel = $('effects-panel');
        if (panel) {
            $('fx-torch-status').textContent = TORCH_LABELS[torch.state] || '';
            var tb = $('fx-torch-btn');
            tb.textContent = torch.state === 'blocked' ? 'Réactiver la lampe'
                : torchEnabled() ? 'Désactiver' : 'Activer la lampe';
            tb.disabled = torch.state === 'pending' || torch.state === 'arming' || !torchSupported();

            $('fx-push-status').textContent = pushLabel();
            var pb = $('fx-push-btn');
            pb.textContent = push.state === 'on' ? 'Désactiver' : 'Activer les notifications';
            pb.disabled = push.state === 'pending' || push.state === 'unsupported' || push.state === 'ios-install';

            // iPhone : la marche à suivre ; ailleurs : le bouton, grisé tant que le
            // navigateur n'a pas fait sa proposition
            var ios = isIOS();
            $('fx-install-row').style.display = installSuggested() || installed ? '' : 'none';
            var ib = $('fx-install-btn');
            ib.style.display = ios ? 'none' : '';
            ib.disabled = !installPrompt;
            var hint = ios ? iosInstallHint() : installLabel();
            $('fx-install-hint').textContent = hint;
            $('fx-install-hint').style.display = hint ? '' : 'none';
        }

        // Le bouton flottant « Réactiver la lampe », seulement quand la régie l'attend
        var rearm = $('torch-rearm');
        if (rearm) rearm.classList.toggle('visible', torch.state === 'blocked');
    }

    function openPanel() {
        renderPanel();
        $('effects-panel').classList.add('open');
    }

    function closePanel() {
        $('effects-panel').classList.remove('open');
    }

    function torchButton() {
        if (torch.state === 'blocked') armTorch(true);
        else if (torchEnabled()) disableTorch();
        else enableTorch();
    }

    function bindPanel() {
        $('fx-torch-btn').addEventListener('click', torchButton);
        $('fx-push-btn').addEventListener('click', function () {
            if (push.state === 'on') disablePush(); else enablePush();
        });
        $('fx-install-btn').addEventListener('click', install);
        $('fx-close').addEventListener('click', closePanel);
        $('effects-panel').addEventListener('click', function (e) {
            if (e.target === $('effects-panel')) closePanel();
        });
        var rearm = $('torch-rearm');
        if (rearm) rearm.addEventListener('click', function () { armTorch(true); });
    }

    // ─────────────────────────────────────────
    //  BRANCHEMENT
    // ─────────────────────────────────────────
    function attach(socket) {
        socketRef = socket;
        socket.on('connect', reportTorch);
        socket.on('light', handleLight);
        socket.on('torch_arm', handleTorchArm);
        socket.on('vibrate', handleVibrate);
        socket.on('show_carton', showCarton);
        socket.on('hide_carton', hideCarton);
    }

    function init() {
        bindPanel();
        restoreTorch();
        renderPanel();
        registerServiceWorker();
        requestWakeLock();

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                requestWakeLock();
                // Toujours armée : on rouvre la caméra au retour sur la page
                if (serverArmed) armTorch();
            } else if (torch.track) {
                // En arrière-plan la caméra est inutilisable : on la libère
                closeCamera();
                if (torch.state === 'armed') setTorchState('standby');
            }
        });

        // Garde-fou : armée, mais plus aucune commande depuis longtemps
        setInterval(function () {
            if (torch.track && Date.now() - lastCommandAt > LOCAL_DISARM_MS) {
                serverArmed = false;
                disarmTorch();
            }
        }, 30000);
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
        torchEnabled: torchEnabled,
        pushState: function () { return push.state; },
        torchSupported: torchSupported,
        pushSupport: pushSupport,
        torchLabel: function () { return TORCH_LABELS[torch.state] || ''; },
        pushLabel: pushLabel,
        isIOS: isIOS,
        isStandalone: isStandalone,
        iosInstallHint: iosInstallHint,
        installSuggested: installSuggested,
        canInstall: function () { return !!installPrompt; },
        installed: function () { return installed; },
        installLabel: installLabel,
        onChange: function (fn) { listeners.push(fn); },
        // Pour les tests : rejouer une commande sans passer par le serveur
        _light: handleLight,
        _arm: handleTorchArm,
        _carton: showCarton,
        _hideCarton: hideCarton,
    };
})();
