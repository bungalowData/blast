// ─────────────────────────────────────────
//  BLAST — les textes de l'accueil des spectateurs
// ─────────────────────────────────────────
//
// Tous les écrans que voit un spectateur entre l'ouverture du site et l'arrivée
// dans le chat : installation de l'app, pseudo, réglages, tutoriel.
//
// COMMENT MODIFIER
//  - Change seulement ce qui est entre les accents graves ` ` (les apostrophes
//    et les guillemets y sont libres). Ne touche pas aux noms à gauche des « : ».
//  - Un retour à la ligne dans le texte = un retour à la ligne à l'écran.
//  - Les émojis sont permis partout.
//  - {pseudo} est remplacé par le pseudo du spectateur, {site} par l'adresse
//    du site, {n} et {total} par les numéros d'étape.
//  - Le tutoriel (tout en bas, « tuto ») accepte autant de pages qu'on veut :
//    copier un bloc { … }, pour en ajouter une, en effacer un pour la retirer.
//  - Pour vérifier une modification sans téléphone : ouvrir le site avec
//    ?accueil à la fin de l'adresse (…/index_new.html?accueil) rejoue tout
//    l'accueil, même s'il a déjà été vu.
//
// Changer « version » remontre l'accueil (réglages + tuto, sans l'installation)
// à ceux qui l'ont déjà vu, par exemple après une grosse refonte des textes.

self.BLAST_TEXTES = {
    version: 1,

    // ── Boutons communs ──
    suivant: `Suivant`,
    plusTard: `Plus tard`,

    // ═════════════════════════════════════
    //  1. SUR LE SITE (navigateur du téléphone)
    // ═════════════════════════════════════

    // Premier écran : inciter à installer
    accueil: {
        titre: `BLAST`,
        texte: `Pour vivre le spectacle à fond, installe l'app.`,
        points: [
            `💡 Ton téléphone s'allume avec la salle`,
            `📊 Tu votes aux sondages`,
            `🔔 On te prévient au bon moment`,
        ],
        bouton: `Installer l'app · 30 s`,
        lien: `Continuer sans installer`,
    },

    // Navigateur qui ne sait pas installer : Instagram, Facebook, Brave sur iPhone…
    navigateur: {
        icone: `🌐`,
        titreIPhone: `Ouvre BLAST dans Safari`,
        titreAndroid: `Ouvre BLAST dans Chrome`,
        texte: `Ce navigateur ne permet pas d'installer l'app.`,
        consigneIntegre: `Touche ··· ou ⋮ en haut de l'écran, puis « Ouvrir dans le navigateur ».`,
        consigneCopier: `Ou copie le lien et colle-le dans {navigateur}.`,
        bouton: `Copier le lien`,
        copie: `Lien copié ✓`,
        lien: `Continuer quand même`,
    },

    // Android : le navigateur installe lui-même
    android: {
        icone: `📲`,
        titre: `Installe BLAST`,
        texte: `Touche le bouton, puis « Installer » dans la fenêtre qui s'ouvre.`,
        bouton: `Installer l'app`,
        attente: `Ton navigateur prépare l'installation…`,
        // Quand le navigateur n'a pas de bouton d'installation (Firefox, certains Samsung…)
        menu: `Ouvre le menu ⋮ ou ≡ de ton navigateur, puis touche « Installer l'application » ou « Ajouter à l'écran d'accueil ».`,
        boutonMenu: `C'est fait`,
        refus: `Installation annulée. Tu peux réessayer, ou continuer sans l'app.`,
        lien: `Continuer sans installer`,
    },

    androidOk: {
        icone: `✅`,
        titre: `BLAST est installé`,
        texte: `Ouvre-le depuis ton écran d'accueil (l'icône BLAST).\nTu peux fermer cet onglet.`,
        lien: `Ça ne marche pas ? Continuer ici`,
    },

    // iPhone : les trois étapes illustrées sur une seule page, puis « ouvre l'app »
    iphone: {
        titre: `Installe BLAST en 3 gestes`,
        // Laisser vide (``) pour ne rien afficher sous le titre
        texte: `Lis les trois étapes avant de commencer : le menu Partager recouvre cette page.`,
        etape1: {
            titre: `Touche le bouton Partager`,
            texte: `En bas de l'écran, au milieu.`,
            // Safari depuis iOS 26 : le bouton Partager est rangé dans le menu ···
            texteIOS26: `Touche ··· en bas à droite, puis « Partager ».`,
            // Chrome, Edge… sur iPhone
            texteAutre: `Touche le bouton Partager, en haut à droite à côté de l'adresse (ou dans le menu ···).`,
        },
        etape2: {
            titre: `Choisis « Sur l'écran d'accueil »`,
            texte: `Fais défiler la liste vers le bas si tu ne le vois pas.`,
        },
        etape3: {
            titre: `Touche « Ajouter »`,
            texte: `Laisse « Ouvrir comme app web » activé.`,
        },
        boutonFin: `C'est fait`,
        lien: `Je n'y arrive pas · continuer ici`,
    },

    iphoneOk: {
        icone: `🏁`,
        titre: `Dernière étape`,
        texte: `Ferme {navigateur}, puis ouvre BLAST depuis ton écran d'accueil.`,
        bouton: `Revoir les étapes`,
        lien: `Je n'y arrive pas · continuer ici`,
    },

    // Retour sur le site alors que l'app est installée
    dejaInstallee: {
        icone: `📲`,
        titre: `Tu as déjà l'app BLAST`,
        texte: `Ouvre-la depuis ton écran d'accueil : tout s'y passe.`,
        bouton: `Revoir l'installation`,
        lien: `Continuer ici quand même`,
    },

    // Les libellés des fenêtres du téléphone, dessinées dans les illustrations.
    // À ajuster si Apple ou Google les renomment.
    pictos: {
        iosCopier: `Copier`,
        iosFavoris: `Ajouter aux favoris`,
        iosEcranAccueil: `Sur l'écran d'accueil`,
        iosImprimer: `Imprimer`,
        iosAnnuler: `Annuler`,
        iosAjouter: `Ajouter`,
        iosAppWeb: `Ouvrir comme app web`,
        androidTitre: `Installer l'application ?`,
        androidAnnuler: `Annuler`,
        androidInstaller: `Installer`,
        notifTitre: `« BLAST » souhaite vous envoyer des notifications`,
        notifRefuser: `Refuser`,
        notifAutoriser: `Autoriser`,
        cameraTitre: `Autoriser BLAST à utiliser votre caméra ?`,
        cameraVisite: `Pendant la visite du site`,
        cameraUneFois: `Cette fois-ci uniquement`,
        cameraJamais: `Ne pas autoriser`,
    },

    // ═════════════════════════════════════
    //  2. PREMIER LANCEMENT DE L'APP
    //     (ou dans le navigateur, pour qui n'a pas installé)
    // ═════════════════════════════════════

    pseudo: {
        titre: `Bienvenue`,
        texte: `Choisis ton pseudo, il te suivra pendant tout le spectacle.`,
        exemple: `ex. SuperHero42`,
        bouton: `C'est moi`,
        connexion: `Connexion…`,
        attente: `Connexion au spectacle… ça peut prendre jusqu'à une minute.`,
        pris: `Ce pseudo est déjà utilisé, essaie-en un autre.`,
        vide: `Écris un pseudo pour continuer.`,
    },

    // Les réglages : « Réglage 1 sur 3 »…
    etapeReglage: `Réglage {n} sur {total}`,

    notifs: {
        icone: `🔔`,
        titre: `Ne rate aucun sondage`,
        texte: `On te prévient quand un sondage commence, même téléphone verrouillé.`,
        bouton: `Autoriser les notifications`,
        aide: `Touche « Autoriser » dans la fenêtre qui s'ouvre.`,
        ok: `Notifications activées ✓`,
        refuseAndroid: `Notifications refusées. Pour les rétablir : Réglages du téléphone › Applications › BLAST (ou Chrome) › Notifications.`,
        refuseIPhone: `Notifications refusées. Pour les rétablir : Réglages › Notifications › BLAST.`,
        // iPhone sans l'app installée : Apple réserve les notifications aux apps
        iphoneSansApp: `Sur iPhone, les notifications ne marchent que dans l'app installée. Tu pourras l'installer plus tard avec le bouton ✨ du chat.`,
        indispo: `Les notifications ne sont pas encore ouvertes pour ce spectacle.`,
        erreur: `Activation impossible pour l'instant. Tu pourras réessayer avec le bouton ✨ du chat.`,
    },

    lampe: {
        icone: `🔦`,
        titre: `Deviens une lumière du spectacle`,
        texte: `La régie allumera la lampe de ton téléphone avec la salle.\nTon téléphone va demander l'accès à la caméra : rien n'est filmé, et elle reste fermée tant que la régie n'en a pas besoin.`,
        bouton: `Activer la lampe`,
        aide: `Choisis « Pendant la visite du site », pas « Cette fois-ci uniquement ».\nSi ton téléphone demande ensuite si {navigateur} peut prendre des photos, réponds « Lorsque vous utilisez l'appli ».`,
        enCours: `Recherche de la lampe…`,
        ok: `Lampe prête ✓ Elle vient de clignoter.`,
        sansLampe: `Pas de lampe utilisable sur ce téléphone : c'est l'écran qui s'allumera.`,
        // La fenêtre de demande s'est fermée sans réponse : on peut simplement réessayer
        fermee: `La demande s'est fermée sans réponse. Touche de nouveau « Activer la lampe », puis « Pendant la visite du site ».`,
        bloqueTitre: `La lampe est bloquée`,
        // Le site est bloqué dans Chrome (un « Ne pas autoriser » donné une fois)
        bloqueAndroid: `BLAST n'a plus le droit d'utiliser la caméra. Pour le lui rendre :\n1. Ouvre l'application Chrome (pas BLAST).\n2. Touche ⋮ › Paramètres › Paramètres des sites › Appareil photo.\n3. Dans la liste « Bloqués », touche {site}, puis choisis « Autoriser ».\nSi {site} n'apparaît pas : Paramètres des sites › Tous les sites › {site} › Effacer et réinitialiser (BLAST te redemandera ton pseudo).\nReviens ensuite ici.`,
        bloqueSamsung: `BLAST n'a plus le droit d'utiliser la caméra. Pour le lui rendre :\n1. Ouvre l'application Samsung Internet (pas BLAST).\n2. Touche ≡ › Paramètres, puis cherche « Autorisations des sites » › Appareil photo.\n3. Touche {site}, puis autorise-le.\nReviens ensuite ici.`,
        // Le téléphone interdit l'appareil photo au navigateur lui-même
        bloqueSysteme: `Ton téléphone interdit l'appareil photo à {navigateur}. Pour le rétablir :\n1. Ouvre les Paramètres du téléphone › Applications › {navigateur} › Autorisations › Appareil photo.\n2. Choisis « Autoriser seulement si l'appli est en cours d'utilisation ».\nVérifie aussi, dans les réglages rapides (glisse depuis le haut de l'écran), que « Accès à l'appareil photo » est activé.\nReviens ensuite ici.`,
        bloqueIPhone: `L'accès à la caméra a été refusé. Ferme BLAST, rouvre-le, puis touche « Autoriser » quand ton iPhone le demande.`,
        toujoursBloque: `Toujours bloquée : vérifie le réglage, ou passe cette étape.`,
        // Petite ligne grise sous les explications, utile pour signaler un souci
        detail: `Détail : {erreur}`,
        boutonReessayer: `J'ai changé le réglage`,
        lien: `Passer, l'écran suffira`,
    },

    son: {
        icone: `🔊`,
        titre: `Monte le son`,
        texte: `Enlève le mode silencieux et monte le volume.\nGarde BLAST ouvert pendant le spectacle : l'écran restera allumé.`,
        bouton: `Tester le son et la vibration`,
        question: `Tu as entendu le son ?`,
        oui: `Oui`,
        non: `Non`,
        aideNon: `Vérifie le volume et le mode silencieux (sur iPhone : le bouton sur le côté). Puis teste à nouveau.`,
    },

    recap: {
        titre: `Tout est prêt`,
        texte: `Tu pourras tout régler plus tard avec le bouton ✨ en haut du chat.`,
        notifsOn: `Notifications activées`,
        notifsOff: `Notifications non activées`,
        notifsApp: `Notifications : dans l'app installée`,
        lampeOn: `Lampe prête`,
        lampeOff: `Lampe non activée`,
        lampeEcran: `L'écran s'allumera avec la salle`,
        sonOk: `Son testé`,
        sonNon: `Son à vérifier`,
        ecran: `Écran gardé allumé`,
        bouton: `Continuer`,
    },

    // ═════════════════════════════════════
    //  3. LE TUTORIEL (pages libres)
    // ═════════════════════════════════════
    tuto: [
        {
            icone: `💬`,
            titre: `Comment ça marche`,
            texte: `Ici tu es dans un chat.\nÉcris ton message en bas et appuie sur envoyer.\nTu peux discuter avec nous, et avec les autres spectateurs.`,
        },
        {
            icone: `⚖️`,
            titre: `Les règles du jeu`,
            texte: `Tout propos diffamant ou discriminatoire est interdit et entraînera une exclusion par un modérateur.`,
        },
        {
            icone: `📊`,
            titre: `Les sondages`,
            texte: `Au cours du spectacle, on va régulièrement te demander ton avis. Des sondages s'afficheront ici et tu pourras faire ton choix en touchant une réponse.`,
        },
        {
            icone: `✍️`,
            titre: `Le tweet`,
            texte: `Si tu passes tous les niveaux du jeu tu pourras rédiger ton propre tweet et astroturfer les internets avec nous. On te guidera en temps voulu pour cela ;)`,
        },
        {
            icone: `🚀`,
            titre: `Prêt ? C'est parti !`,
            texte: `Bon spectacle, {pseudo}.`,
        },
    ],
    tutoBoutonFin: `Entrer dans le chat`,

    // ═════════════════════════════════════
    //  DANS LE CHAT
    // ═════════════════════════════════════

    // Le même pseudo vient d'être repris par l'app (ou un autre onglet)
    ailleurs: {
        titre: `BLAST est ouvert ailleurs`,
        texte: `Ton pseudo est maintenant utilisé dans l'app BLAST ou dans un autre onglet.`,
        bouton: `Revenir ici`,
    },
};
