// ─────────────────────────────────────────
//  BLAST — l'accueil des spectateurs
// ─────────────────────────────────────────
//
// Du premier écran jusqu'au chat, en trois temps :
//  1. SUR LE SITE (navigateur d'un téléphone) : on pousse à installer l'app,
//     et RIEN d'autre. Ni pseudo, ni caméra, ni notifications : tout ce qui
//     serait demandé ici serait à redemander dans l'app (iPhone : mémoire
//     séparée de Safari) ou y resterait bloqué (Android : une caméra refusée
//     dans Chrome l'est aussi dans l'app).
//  2. PREMIER LANCEMENT DE L'APP : pseudo, puis un réglage par écran
//     (notifications, lampe, son), puis un récapitulatif.
//  3. LE TUTORIEL, puis le chat.
// Qui refuse ou rate l'installation fait 2 et 3 dans le navigateur.
//
// Les textes sont dans js/blast-textes.js : rien à toucher ici pour les changer.
//
// Le pseudo est porté par le chat (chat.html, dans l'iframe), qui se déclare
// ici à chaque chargement (chatReady) : c'est l'accueil qui décide quand il
// rejoint, pour qu'aucun pseudo ne soit réservé avant l'installation.

(function () {
    'use strict';

    var T = self.BLAST_TEXTES || {};
    var BP = window.BlastPhone;

    var store = {
        get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
        set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
        del: function (k) { try { localStorage.removeItem(k); } catch (e) { } },
    };

    // L'app installée et le navigateur ont chacun leur accueil. Sur Android ils
    // partagent la même mémoire : d'où deux clés.
    var STANDALONE = BP.isStandalone();
    var KEY_DONE = 'blast_accueil_' + (STANDALONE ? 'app' : 'web');
    var KEY_CHOICE = 'blast_install_choix';   // 'navigateur' : a choisi de rester dans le navigateur
    var KEY_INSTALLED = 'blast_install_fait'; // date : a suivi l'installation jusqu'au bout
    var KEY_APP_SEEN = 'blast_app_vue';       // l'app a déjà été ouverte (visible du navigateur sur Android)
    var VERSION = String(T.version || 1);

    var root = null;
    var chatApi = null;
    var chatWaiters = [];
    var started = false;
    var current = null;          // { id, arg } : l'écran affiché
    var steps = [];              // les réglages proposés, dans l'ordre
    var mode = 'accueil';        // 'accueil' | 'pseudo' (pseudo seul) | 'installer' (depuis ✨)

    // État des écrans
    var st = {
        pseudo: { value: '', err: '', busy: false, slow: false },
        androidRefus: false,
        copie: false,
        lampeRefuseeAvant: false,
        lampeEssais: 0,
        lampeEclair: false,
        sonTeste: false,
        sonOk: false,
        sonNon: false,
    };

    // ─────────────────────────────────────────
    //  OUTILS
    // ─────────────────────────────────────────
    function txt(path) {
        var v = T;
        path.split('.').forEach(function (k) { v = v == null ? undefined : v[k]; });
        return v == null ? '' : v;
    }

    function fill(s, vars) {
        var all = {
            pseudo: (chatApi && chatApi.nickname()) || store.get('blast_nickname') || '',
            site: location.host,
            navigateur: BP.isIOS() && BP.iosBrowser() === 'aucun' ? 'Safari' : BP.browserName(),
        };
        if (vars) for (var k in vars) all[k] = vars[k];
        return String(s == null ? '' : s).replace(/\{(\w+)\}/g, function (m, k) {
            return k in all ? all[k] : m;
        });
    }

    function h(tag, props) {
        var el = document.createElement(tag);
        if (props) {
            for (var k in props) {
                var v = props[k];
                if (v == null || v === false) continue;
                if (k === 'class') el.className = v;
                else if (k === 'text') el.textContent = v;
                else if (k === 'svg') el.innerHTML = v;      // illustrations écrites ici, jamais de texte
                else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
                else el.setAttribute(k, v === true ? '' : v);
            }
        }
        for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
        return el;
    }

    function append(el, c) {
        if (c == null || c === false) return;
        if (Array.isArray(c)) { c.forEach(function (x) { append(el, x); }); return; }
        el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }

    function isDone() { return store.get(KEY_DONE) === VERSION; }

    function whenChat() {
        if (chatApi) return Promise.resolve(chatApi);
        return new Promise(function (r) { chatWaiters.push(r); });
    }

    // ─────────────────────────────────────────
    //  MISE EN PAGE D'UN ÉCRAN
    // ─────────────────────────────────────────
    // o : { etape, retour, logo, icone, titre, texte, points, contenu, picto,
    //       statut, statutClasse, points de progression (dots), boutons, lien }
    function screen(o) {
        var top = h('div', { class: 'ob-top' },
            o.retour ? h('button', { class: 'ob-back', 'aria-label': 'Retour', text: '‹', onclick: o.retour }) : null,
            o.etape ? h('span', { text: o.etape }) : null);

        var body = h('div', { class: 'ob-body' },
            o.logo ? h('div', { class: 'ob-logo', text: o.logo }) : null,
            o.icone ? h('div', { class: 'ob-icon', 'aria-hidden': 'true', text: o.icone }) : null,
            o.titre ? h('h1', { class: 'ob-title', text: o.titre }) : null,
            o.texte ? h('p', { class: 'ob-text', text: o.texte }) : null,
            o.points ? h('ul', { class: 'ob-points' }, o.points.map(function (p) { return h('li', { text: p }); })) : null,
            o.contenu || null,
            o.statut ? h('p', { class: 'ob-status ' + (o.statutClasse || ''), role: 'status', text: o.statut }) : null,
            o.picto ? h('div', { class: 'ob-picto', 'aria-hidden': 'true' }, o.picto) : null,
            o.detail ? h('p', { class: 'ob-detail', text: o.detail }) : null);

        var actions = h('div', { class: 'ob-actions' },
            o.dots ? h('div', { class: 'ob-dots' }, range(o.dots.total).map(function (i) {
                return h('span', { class: i === o.dots.n ? 'on' : '' });
            })) : null,
            (o.boutons || []).map(function (b) {
                return h('button', {
                    class: 'ob-btn ' + (b.style || 'primary'),
                    text: b.label,
                    disabled: !!b.disabled,
                    onclick: b.run,
                });
            }),
            o.lien ? h('button', { class: 'ob-link', text: o.lien.label, onclick: o.lien.run }) : null);

        var box = h('div', { class: 'ob-screen' }, top, body, actions);
        root.replaceChildren(box);
        root.classList.add('on');
        root.scrollTop = 0;
        return box;
    }

    function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a; }

    function go(id, arg) {
        current = { id: id, arg: arg };
        render();
    }

    function render() {
        if (current && SCREENS[current.id]) SCREENS[current.id](current.arg);
    }

    function close() {
        current = null;
        if (root) {
            root.classList.remove('on');
            root.replaceChildren();
        }
    }

    // ─────────────────────────────────────────
    //  ILLUSTRATIONS
    // ─────────────────────────────────────────
    var ICON = {
        share: '<path d="M12 15V3M8 7l4-4 4 4"/><path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16"/>',
        left: '<path d="M15 5l-7 7 7 7"/>',
        right: '<path d="M9 5l7 7-7 7"/>',
        book: '<path d="M12 6c-2-1.5-5-2-8-1.5v14c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-14c-3-.5-6 0-8 1.5zM12 6v14"/>',
        tabs: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/>',
        dots: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
        plus: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>',
        copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
        star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/>',
        print: '<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>',
    };

    function icon(name, cls) {
        return h('span', {
            class: 'ob-ic ' + (cls || ''),
            svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
                'stroke-linecap="round" stroke-linejoin="round">' + ICON[name] + '</svg>',
        });
    }

    function appIcon() {
        return h('img', { class: 'ob-appicon', src: './icons/icon-192.png', alt: '' });
    }

    var P = function (k) { return txt('pictos.' + k); };

    // L'écran d'accueil du téléphone, l'icône BLAST entourée
    function pictoHome() {
        return h('div', { class: 'ob-home' },
            h('div', { class: 'app' }), h('div', { class: 'app' }), h('div', { class: 'app' }),
            h('div', { class: 'ob-hl app-blast' }, appIcon(), h('div', { class: 'lbl', text: 'BLAST' })));
    }

    // iPhone, étape 1 : où est le bouton Partager
    function pictoPartager() {
        var b = BP.iosBrowser();
        var host = h('div', { class: 'ob-addr', text: location.host });
        if (b === 'safari26') return h('div', { class: 'ob-bar' }, icon('left'), host, icon('dots', 'ob-hl'));
        if (b === 'autre') return h('div', { class: 'ob-bar' }, host, icon('share', 'ob-hl'));
        return h('div', { class: 'ob-bar' }, icon('left'), icon('right'), icon('share', 'ob-hl'), icon('book'), icon('tabs'));
    }

    // iPhone, étape 2 : la liste du menu Partager
    function pictoListe() {
        function row(label, ic, hl) {
            return h('div', { class: 'ob-row' + (hl ? ' ob-hl' : '') }, h('span', { text: label }), icon(ic));
        }
        return h('div', { class: 'ob-sys' },
            row(P('iosCopier'), 'copy'),
            row(P('iosFavoris'), 'star'),
            row(P('iosEcranAccueil'), 'plus', true),
            row(P('iosImprimer'), 'print'));
    }

    // iPhone, étape 3 : la fenêtre « Sur l'écran d'accueil »
    function pictoAjouter() {
        return h('div', { class: 'ob-sys' },
            h('div', { class: 'ob-row ob-row-top' },
                h('span', { class: 'ob-blue', text: P('iosAnnuler') }),
                h('span', { class: 'ob-blue ob-strong ob-hl', text: P('iosAjouter') })),
            h('div', { class: 'ob-row ob-row-app' }, appIcon(), h('span', { class: 'ob-strong', text: 'BLAST' })),
            h('div', { class: 'ob-row ob-hl' }, h('span', { text: P('iosAppWeb') }), h('span', { class: 'ob-toggle' })));
    }

    // Android : la fenêtre d'installation du navigateur
    function pictoAndroid() {
        return h('div', { class: 'ob-sys' },
            h('div', { class: 'ob-row ob-row-app' }, appIcon(),
                h('span', null, h('span', { class: 'ob-strong', text: P('androidTitre') }), h('br'),
                    h('span', { class: 'ob-grey', text: 'BLAST · ' + location.host }))),
            h('div', { class: 'ob-buttons' },
                h('span', { class: 'ob-blue', text: P('androidAnnuler') }),
                h('span', { class: 'ob-blue ob-strong ob-hl', text: P('androidInstaller') })));
    }

    function pictoNotif() {
        return h('div', { class: 'ob-sys' },
            h('div', { class: 'ob-strong', text: P('notifTitre') }),
            h('div', { class: 'ob-buttons' },
                h('span', { class: 'ob-blue', text: P('notifRefuser') }),
                h('span', { class: 'ob-blue ob-strong ob-hl', text: P('notifAutoriser') })));
    }

    // Chrome Android propose trois réponses ; « cette fois-ci » expirerait avant
    // le spectacle. iPhone : deux boutons.
    function pictoCamera() {
        if (BP.isIOS()) {
            return h('div', { class: 'ob-sys' },
                h('div', { class: 'ob-strong', text: P('cameraTitre') }),
                h('div', { class: 'ob-buttons' },
                    h('span', { class: 'ob-blue', text: P('cameraJamais') }),
                    h('span', { class: 'ob-blue ob-strong ob-hl', text: P('notifAutoriser') })));
        }
        return h('div', { class: 'ob-sys' },
            h('div', { class: 'ob-strong', text: P('cameraTitre') }),
            h('div', { class: 'ob-choice ob-hl', text: P('cameraVisite') }),
            h('div', { class: 'ob-choice', text: P('cameraUneFois') }),
            h('div', { class: 'ob-choice', text: P('cameraJamais') }));
    }

    // ─────────────────────────────────────────
    //  LES ÉCRANS
    // ─────────────────────────────────────────
    var SCREENS = {

        // ── 1. Sur le site ──
        accueil: function () {
            screen({
                logo: txt('accueil.titre'),
                texte: txt('accueil.texte'),
                points: txt('accueil.points') || [],
                boutons: [{ label: txt('accueil.bouton'), run: startInstall }],
                lien: { label: txt('accueil.lien'), run: continueHere },
            });
        },

        navigateur: function () {
            var integre = BP.inAppBrowser();
            var url = location.href.split('#')[0];
            screen({
                icone: txt('navigateur.icone'),
                titre: BP.isIOS() ? txt('navigateur.titreIPhone') : txt('navigateur.titreAndroid'),
                texte: txt('navigateur.texte'),
                contenu: [
                    integre ? h('p', { class: 'ob-text', text: fill(txt('navigateur.consigneIntegre')) }) : null,
                    h('p', { class: 'ob-text', text: fill(txt('navigateur.consigneCopier'), { navigateur: BP.isIOS() ? 'Safari' : 'Chrome' }) }),
                    h('div', { class: 'ob-url', text: url }),
                ],
                statut: st.copie ? txt('navigateur.copie') : '',
                statutClasse: 'ok',
                boutons: [{ label: txt('navigateur.bouton'), run: function () { copyLink(url); } }],
                lien: { label: txt('navigateur.lien'), run: continueHere },
            });
        },

        android: function () {
            if (BP.installed()) { markInstalled(); go('androidOk'); return; }
            var can = BP.canInstall();
            // Le navigateur sait installer mais ne l'a pas (encore) proposé :
            // soit il prépare, soit l'app est déjà là, soit il faut son menu.
            var waits = !can && 'onbeforeinstallprompt' in window && !st.androidRefus;
            var menuFait = { label: txt('android.boutonMenu'), style: 'secondary', run: function () { markInstalled(); go('androidOk'); } };
            var o = {
                retour: mode === 'installer' ? null : function () { go('accueil'); },
                icone: txt('android.icone'),
                titre: txt('android.titre'),
                lien: { label: txt('android.lien'), run: continueHere },
            };
            if (can) {
                o.texte = txt('android.texte');
                o.statut = st.androidRefus ? txt('android.refus') : '';
                o.statutClasse = 'ko';
                o.picto = pictoAndroid();
                o.boutons = [{ label: txt('android.bouton'), run: installAndroid }];
            } else if (waits) {
                o.texte = txt('android.texte');
                o.statut = txt('android.attente') + '\n\n' + txt('android.menu');
                o.boutons = [{ label: txt('android.bouton'), disabled: true }, menuFait];
            } else {
                o.statut = (st.androidRefus ? txt('android.refus') + '\n\n' : '') + txt('android.menu');
                o.boutons = [menuFait];
            }
            screen(o);
        },

        androidOk: function () {
            screen({
                icone: txt('androidOk.icone'),
                titre: txt('androidOk.titre'),
                texte: fill(txt('androidOk.texte')),
                picto: pictoHome(),
                lien: { label: txt('androidOk.lien'), run: continueHere },
            });
        },

        // Les trois étapes sur une seule page : le menu Partager d'iOS recouvre
        // le site, autant tout avoir lu avant de l'ouvrir.
        iphone: function () {
            var b = BP.iosBrowser();
            var texte1 = b === 'safari26' ? txt('iphone.etape1.texteIOS26')
                : b === 'autre' ? txt('iphone.etape1.texteAutre')
                : txt('iphone.etape1.texte');
            var etapes = [
                { titre: txt('iphone.etape1.titre'), texte: texte1, picto: pictoPartager() },
                { titre: txt('iphone.etape2.titre'), texte: txt('iphone.etape2.texte'), picto: pictoListe() },
                { titre: txt('iphone.etape3.titre'), texte: txt('iphone.etape3.texte'), picto: pictoAjouter() },
            ];
            screen({
                retour: mode === 'installer' ? null : function () { go('accueil'); },
                titre: txt('iphone.titre'),
                texte: fill(txt('iphone.texte')),
                contenu: h('ol', { class: 'ob-steps' }, etapes.map(function (e, i) {
                    return h('li', { class: 'ob-step' },
                        h('span', { class: 'ob-step-n', 'aria-hidden': 'true', text: String(i + 1) }),
                        h('div', { class: 'ob-step-t', text: fill(e.titre) }),
                        e.texte ? h('p', { class: 'ob-step-x', text: fill(e.texte) }) : null,
                        h('div', { class: 'ob-picto', 'aria-hidden': 'true' }, e.picto));
                })),
                boutons: [{ label: txt('iphone.boutonFin'), run: function () { markInstalled(); go('iphoneOk'); } }],
                lien: { label: txt('iphone.lien'), run: continueHere },
            });
        },

        iphoneOk: function () {
            screen({
                icone: txt('iphoneOk.icone'),
                titre: txt('iphoneOk.titre'),
                texte: fill(txt('iphoneOk.texte')),
                picto: pictoHome(),
                boutons: [{ label: txt('iphoneOk.bouton'), style: 'secondary', run: function () { go('iphone'); } }],
                lien: { label: txt('iphoneOk.lien'), run: continueHere },
            });
        },

        dejaInstallee: function () {
            screen({
                icone: txt('dejaInstallee.icone'),
                titre: txt('dejaInstallee.titre'),
                texte: fill(txt('dejaInstallee.texte')),
                picto: pictoHome(),
                boutons: [{ label: txt('dejaInstallee.bouton'), style: 'secondary', run: startInstall }],
                lien: { label: txt('dejaInstallee.lien'), run: continueHere },
            });
        },

        // ── 2. Premier lancement ──
        pseudo: function () {
            var p = st.pseudo;
            var input = h('input', {
                class: 'ob-input', type: 'text', maxlength: '32', autocomplete: 'off',
                autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go',
                placeholder: txt('pseudo.exemple'), 'aria-label': txt('pseudo.titre'),
            });
            input.value = p.value;
            input.addEventListener('input', function () { p.value = input.value; });
            input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submitPseudo(); });
            screen({
                logo: 'BLAST',
                titre: txt('pseudo.titre'),
                texte: txt('pseudo.texte'),
                contenu: [input, p.err ? h('p', { class: 'ob-error', role: 'alert', text: p.err }) : null],
                statut: p.busy && p.slow ? txt('pseudo.attente') : '',
                boutons: [{ label: p.busy ? txt('pseudo.connexion') : txt('pseudo.bouton'), disabled: p.busy, run: submitPseudo }],
            });
            if (!p.busy && !BP.isMobile()) input.focus();
        },

        notifs: function () {
            var s = BP.pushState();
            var o = {
                etape: stepLabel('notifs'),
                icone: txt('notifs.icone'),
                titre: txt('notifs.titre'),
                texte: txt('notifs.texte'),
            };
            var next = { label: txt('suivant'), run: function () { nextStep('notifs'); } };
            if (s === 'off' || s === 'pending') {
                o.statut = txt('notifs.aide');
                o.picto = pictoNotif();
                o.boutons = [{ label: txt('notifs.bouton'), disabled: s === 'pending', run: function () { BP.enablePush(); } }];
                o.lien = { label: txt('plusTard'), run: next.run };
            } else {
                var msg = {
                    on: txt('notifs.ok'),
                    denied: BP.isIOS() ? txt('notifs.refuseIPhone') : txt('notifs.refuseAndroid'),
                    'ios-install': txt('notifs.iphoneSansApp'),
                    'server-off': txt('notifs.indispo'),
                }[s] || txt('notifs.erreur');
                o.statut = fill(msg);
                o.statutClasse = s === 'on' ? 'ok' : s === 'ios-install' ? '' : 'ko';
                o.boutons = [next];
            }
            screen(o);
        },

        lampe: function () {
            var s = BP.torchState();
            var next = { label: txt('suivant'), run: function () { nextStep('lampe'); } };
            var o = {
                etape: stepLabel('lampe'),
                icone: txt('lampe.icone'),
                titre: txt('lampe.titre'),
                texte: txt('lampe.texte'),
            };
            var refus = BP.torchRefusal();
            var refusee = s === 'denied' || (s === 'off' && st.lampeRefuseeAvant);
            if (refusee) {
                // Le remède dépend de qui bloque : le téléphone, ou le navigateur
                var cle = s === 'denied' && refus === 'systeme' ? 'lampe.bloqueSysteme'
                    : BP.isIOS() ? 'lampe.bloqueIPhone'
                    : BP.browserName() === 'Samsung Internet' ? 'lampe.bloqueSamsung'
                    : 'lampe.bloqueAndroid';
                o.titre = txt('lampe.bloqueTitre');
                o.texte = fill(txt(cle));
                o.statut = st.lampeEssais > 0 ? txt('lampe.toujoursBloque') : '';
                o.statutClasse = 'ko';
                o.detail = BP.torchError() ? fill(txt('lampe.detail'), { erreur: BP.torchError() }) : '';
                o.boutons = [{ label: txt('lampe.boutonReessayer'), run: activerLampe }];
                o.lien = { label: txt('lampe.lien'), run: next.run };
            } else if (s === 'off' || s === 'pending') {
                var fermee = s === 'off' && refus === 'ferme';
                o.statut = fill(s === 'pending' ? txt('lampe.enCours') : fermee ? txt('lampe.fermee') : txt('lampe.aide'));
                o.statutClasse = fermee ? 'ko' : '';
                o.picto = pictoCamera();
                o.boutons = [{ label: txt('lampe.bouton'), disabled: s === 'pending', run: activerLampe }];
                o.lien = { label: txt('plusTard'), run: next.run };
            } else if (s === 'unavailable') {
                o.statut = txt('lampe.sansLampe');
                o.boutons = [next];
            } else {
                o.statut = st.lampeEclair ? txt('lampe.ok') : txt('recap.lampeOn') + ' ✓';
                o.statutClasse = 'ok';
                o.boutons = [next];
            }
            screen(o);
        },

        son: function () {
            var next = function () { nextStep('son'); };
            var o = {
                etape: stepLabel('son'),
                icone: txt('son.icone'),
                titre: txt('son.titre'),
                texte: txt('son.texte'),
            };
            if (!st.sonTeste) {
                o.boutons = [{ label: txt('son.bouton'), run: testSound }];
                o.lien = { label: txt('plusTard'), run: next };
            } else {
                o.contenu = h('p', { class: 'ob-question', text: txt('son.question') });
                o.statut = st.sonNon ? txt('son.aideNon') : '';
                o.statutClasse = 'ko';
                o.boutons = [
                    { label: txt('son.oui'), run: function () { st.sonOk = true; next(); } },
                    { label: txt('son.non'), style: 'secondary', run: function () { st.sonNon = true; render(); } },
                ];
                o.lien = st.sonNon
                    ? { label: txt('son.bouton'), run: testSound }
                    : null;
                if (st.sonNon) o.boutons = [{ label: txt('suivant'), run: next }];
            }
            screen(o);
        },

        recap: function () {
            var lines = [];
            function line(ok, label) { lines.push(h('div', { class: 'ob-line ' + (ok ? 'ok' : 'ko') }, h('span', { class: 'mark', text: ok ? '✓' : '•' }), h('span', { text: label }))); }

            var ps = BP.pushState();
            if (ps === 'on') line(true, txt('recap.notifsOn'));
            else if (ps === 'ios-install') line(false, txt('recap.notifsApp'));
            else if (ps !== 'unsupported') line(false, txt('recap.notifsOff'));

            if (steps.indexOf('lampe') >= 0 || BP.torchEnabled()) {
                var ts = BP.torchState();
                if (BP.torchEnabled()) line(true, txt('recap.lampeOn'));
                else if (ts === 'unavailable') line(true, txt('recap.lampeEcran'));
                else line(false, txt('recap.lampeOff'));
            }
            line(st.sonOk, st.sonOk ? txt('recap.sonOk') : txt('recap.sonNon'));
            if (BP.wakeLockActive()) line(true, txt('recap.ecran'));

            screen({
                titre: txt('recap.titre'),
                contenu: h('div', { class: 'ob-check' }, lines),
                texte: '',
                statut: txt('recap.texte'),
                boutons: [{ label: txt('recap.bouton'), run: function () { tutoOrFinish(0); } }],
            });
        },

        // ── 3. Tutoriel ──
        tuto: function (i) {
            var pages = txt('tuto') || [];
            var p = pages[i] || {};
            var last = i >= pages.length - 1;
            screen({
                retour: i > 0 ? function () { go('tuto', i - 1); } : null,
                icone: p.icone,
                titre: fill(p.titre),
                texte: fill(p.texte),
                dots: { n: i, total: pages.length },
                boutons: [{
                    label: last ? txt('tutoBoutonFin') : txt('suivant'),
                    run: function () { tutoOrFinish(i + 1); },
                }],
            });
        },
    };

    // Ces écrans suivent l'état du téléphone (installation, autorisations)
    var LIVE = { android: 1, notifs: 1, lampe: 1 };

    // ─────────────────────────────────────────
    //  ENCHAÎNEMENT
    // ─────────────────────────────────────────
    function start() {
        if (started) return;
        started = true;
        root = document.getElementById('onboarding');
        if (!root) return;

        // …?accueil : rejouer tout l'accueil (pour relire les textes)
        if (/[?&]accueil\b/.test(location.search)) {
            reset();
            try { history.replaceState(null, '', location.pathname); } catch (e) { }
        }
        if (STANDALONE) store.set(KEY_APP_SEEN, '1');
        // Le pseudo déjà choisi (Android : aussi celui choisi dans le navigateur)
        st.pseudo.value = store.get('blast_nickname') || '';

        BP.onChange(function () { if (current && LIVE[current.id]) render(); });

        if (isDone()) {
            close();
            if (chatApi) autoJoin(chatApi);
            return;
        }
        // Sur un téléphone, dans le navigateur, tant que le spectateur n'a pas
        // choisi d'y rester : l'installation d'abord.
        if (!STANDALONE && BP.isMobile() && store.get(KEY_CHOICE) !== 'navigateur') {
            installPhase();
            return;
        }
        go('pseudo');
    }

    function cannotInstallHere() {
        return BP.inAppBrowser() || (BP.isIOS() && BP.iosBrowser() === 'aucun');
    }

    function installPhase() {
        if (cannotInstallHere()) { go('navigateur'); return; }
        alreadyInstalled().then(function (yes) { go(yes ? 'dejaInstallee' : 'accueil'); });
    }

    // Android (Chrome) le sait ; ailleurs on se souvient seulement que le
    // spectateur a suivi l'installation jusqu'au bout, ou (Android, mémoire
    // partagée avec l'app) que l'app a déjà été ouverte.
    function alreadyInstalled() {
        var recent = Date.now() - Number(store.get(KEY_INSTALLED) || 0) < 10 * 60 * 1000;
        return BP.appInstalled().then(function (yes) {
            if (yes === true) return true;
            // L'app tout juste installée n'est pas toujours déjà déclarée
            if (yes === false) return recent;
            return !!store.get(KEY_INSTALLED) || !!store.get(KEY_APP_SEEN);
        });
    }

    function startInstall() {
        st.androidRefus = false;
        if (BP.isIOS()) go('iphone'); else go('android');
    }

    function installAndroid() {
        BP.install().then(function (outcome) {
            if (outcome === 'accepted') { markInstalled(); go('androidOk'); return; }
            st.androidRefus = true;
            render();
        });
    }

    function markInstalled() { store.set(KEY_INSTALLED, String(Date.now())); }

    // Rester dans le navigateur : la suite de l'accueil s'y déroule
    function continueHere() {
        store.set(KEY_CHOICE, 'navigateur');
        if (mode === 'installer' || isDone()) { mode = 'accueil'; close(); return; }
        go('pseudo');
    }

    function copyLink(url) {
        var done = function () { st.copie = true; render(); };
        try {
            navigator.clipboard.writeText(url).then(done, function () { selectUrl(); });
        } catch (e) { selectUrl(); }
    }

    // Presse-papiers refusé : le lien est sélectionné, le spectateur le copie
    function selectUrl() {
        var el = root.querySelector('.ob-url');
        if (!el) return;
        var r = document.createRange();
        r.selectNodeContents(el);
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
    }

    // ── Pseudo ──
    function submitPseudo() {
        var p = st.pseudo;
        if (p.busy) return;
        var val = (p.value || '').trim();
        if (!val) { p.err = txt('pseudo.vide'); render(); return; }

        // Dans le geste du spectateur : débloque les sons du chat
        if (chatApi) chatApi.unlockAudio();

        p.err = '';
        p.busy = true;
        p.slow = false;
        render();
        var slow = setTimeout(function () { p.slow = true; if (current && current.id === 'pseudo') render(); }, 3000);

        whenChat().then(function (chat) { return chat.join(val); }).then(function (r) {
            clearTimeout(slow);
            p.busy = false;
            if (r === 'ok') { afterPseudo(); return; }
            p.err = r === 'taken' ? txt('pseudo.pris') : txt('pseudo.vide');
            render();
        });
    }

    function afterPseudo() {
        if (mode === 'pseudo') { finish(); return; }
        startReglages();
    }

    // ── Réglages ──
    function startReglages() {
        steps = [];
        if (BP.pushSupport() !== 'unsupported') steps.push('notifs');
        if (BP.isMobile() && BP.torchSupported()) steps.push('lampe');
        steps.push('son');
        st.lampeRefuseeAvant = false;
        BP.cameraPermission().then(function (p) {
            st.lampeRefuseeAvant = p === 'denied';
            if (current && current.id === 'lampe') render();
        });
        go(steps[0]);
    }

    function stepLabel(id) {
        return fill(txt('etapeReglage'), { n: steps.indexOf(id) + 1, total: steps.length });
    }

    function nextStep(from) {
        var i = steps.indexOf(from);
        if (i >= 0 && i + 1 < steps.length) go(steps[i + 1]);
        else go('recap');
    }

    function activerLampe() {
        if (BP.torchState() === 'denied' || st.lampeRefuseeAvant) st.lampeEssais++;
        BP.enableTorch({ test: true }).then(function (s) {
            if (s === 'standby' || s === 'armed') { st.lampeEclair = true; st.lampeRefuseeAvant = false; }
            if (s === 'off') st.lampeRefuseeAvant = false;
            if (current && current.id === 'lampe') render();
        });
    }

    // Retour des réglages du téléphone sur l'écran de la lampe : si le site
    // n'est plus bloqué, on repropose « Activer la lampe » sans attendre.
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState !== 'visible' || !current || current.id !== 'lampe') return;
        BP.cameraPermission().then(function (p) {
            if (p === 'denied') return;
            st.lampeRefuseeAvant = false;
            st.lampeEssais = 0;
            if (BP.torchRefusal() === 'site') BP.clearTorchRefusal();
            if (current && current.id === 'lampe') render();
        });
    });

    function testSound() {
        if (chatApi) {
            chatApi.unlockAudio();
            chatApi.testSound();
        }
        BP.buzz([200, 100, 200]);
        BP.keepAwake();
        st.sonTeste = true;
        st.sonNon = false;
        render();
    }

    // ── Tutoriel, puis le chat ──
    function tutoOrFinish(i) {
        var pages = txt('tuto') || [];
        if (i < pages.length) go('tuto', i); else finish();
    }

    function finish() {
        store.set(KEY_DONE, VERSION);
        mode = 'accueil';
        close();
        if (chatApi && !BP.isMobile()) chatApi.focus();
    }

    // ─────────────────────────────────────────
    //  LE CHAT
    // ─────────────────────────────────────────
    // Appelé par chat.html à chaque chargement (y compris au retour de la
    // page du tweet).
    function chatReady(api) {
        chatApi = api;
        var w = chatWaiters;
        chatWaiters = [];
        w.forEach(function (r) { r(api); });
        if (!st.pseudo.value) st.pseudo.value = api.savedNickname() || '';
        if (started && isDone() && !current) autoJoin(api);
    }

    // Accueil déjà fait : on rejoint avec le pseudo connu, sans rien montrer
    function autoJoin(api) {
        var saved = api.savedNickname();
        if (!saved) { askNickname(); return; }
        api.join(saved).then(function (r) {
            if (r === 'taken' || r === 'invalid') askNickname(r);
        });
    }

    // Le chat a perdu son pseudo (repris entre deux connexions) : on le
    // redemande, et seulement lui.
    function askNickname(reason) {
        mode = 'pseudo';
        st.pseudo.err = reason === 'taken' ? txt('pseudo.pris') : '';
        st.pseudo.busy = false;
        st.pseudo.value = st.pseudo.value || store.get('blast_nickname') || '';
        go('pseudo');
    }

    // Depuis le bouton ✨ : la marche à suivre de l'installation, puis retour au chat
    function showInstall() {
        mode = 'installer';
        if (cannotInstallHere()) go('navigateur'); else startInstall();
    }

    function reset() {
        [KEY_DONE, KEY_CHOICE, KEY_INSTALLED].forEach(store.del);
    }

    window.BlastOnboarding = {
        start: start,
        chatReady: chatReady,
        askNickname: askNickname,
        showInstall: showInstall,
        isDone: isDone,
        reset: reset,
        // Pour les tests : afficher un écran précis
        _go: go,
        _steps: function (s) { steps = s; },
    };
})();
