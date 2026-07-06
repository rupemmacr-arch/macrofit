// ============================================================
//  MacroFit — drive-sync.js
//  Authentification Google (Identity Services) + synchronisation
//  des données via Google Drive (appDataFolder).
//  Étape 1 : connexion / déconnexion.
//  Étape 2 : sauvegarde (push) vers Drive.
//  Étape 3 : récupération (pull) au chargement / à la connexion.
//  Étape 4 : détection simple des conflits entre appareils.
// ============================================================

const GOOGLE_CLIENT_ID    = '340408877285-l6uk3et5js8aivuqm37qbv6vrgggpkmc.apps.googleusercontent.com';
const GOOGLE_DRIVE_SCOPE  = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/userinfo.email';

let _driveTokenClient  = null;
let _driveAccessToken  = null;
let _driveTokenExpiry  = 0; // timestamp ms

// Initialise le client OAuth Google. Appelé une fois au démarrage.
function initialiserGoogleAuth() {
  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    console.warn('⚠️ Google Identity Services non disponible (script pas encore chargé ou bloqué)');
    return;
  }
  _driveTokenClient = google.accounts.oauth2.initTokenClient({
    client_id : GOOGLE_CLIENT_ID,
    scope     : GOOGLE_DRIVE_SCOPE,
    callback  : '', // défini dynamiquement à chaque appel de connecterGoogleDrive()
  });

  // Le token n'est jamais persisté (sécurité) : il disparaît à chaque
  // rechargement de page. Si un compte était connecté précédemment, on
  // tente de récupérer un token frais sans popup (silencieux), puis on
  // vérifie si un autre appareil a poussé des données plus récentes.
  if (obtenirCompteGoogle()) {
    tenterReconnexionSilencieuseGoogle().then(async (ok) => {
      if (ok) await driveRecupererDonnees();
      if (typeof _rafraichirIndicateurSyncDrive === 'function') _rafraichirIndicateurSyncDrive();
    });
  }
}

// Tente d'obtenir un token frais sans interaction utilisateur (mode silencieux
// de Google Identity Services). Ne fonctionne que si une session Google est
// toujours active dans le navigateur et que le consentement a déjà été donné.
// Retourne une Promise<boolean> (true si un token valide a été obtenu).
function tenterReconnexionSilencieuseGoogle() {
  return new Promise((resolve) => {
    if (!_driveTokenClient) { resolve(false); return; }
    if (_driveTokenValide()) { resolve(true); return; }
    _driveTokenClient.callback = (reponse) => {
      if (reponse.error) { resolve(false); return; }
      _driveAccessToken = reponse.access_token;
      _driveTokenExpiry = Date.now() + (reponse.expires_in * 1000) - 60000;
      resolve(true);
    };
    _driveTokenClient.requestAccessToken({ prompt: '' });
  });
}

// Token d'accès actuellement valide en mémoire ?
function _driveTokenValide() {
  return !!_driveAccessToken && Date.now() < _driveTokenExpiry;
}

// Lance le flux de connexion Google (ouvre la popup de consentement).
// Doit être appelé depuis un vrai clic utilisateur.
// Retourne une Promise résolue avec { email } en cas de succès.
function connecterGoogleDrive() {
  return new Promise((resolve, reject) => {
    if (!_driveTokenClient) {
      reject(new Error('Client Google non initialisé (script Google bloqué ou hors-ligne ?)'));
      return;
    }
    _driveTokenClient.callback = async (reponse) => {
      if (reponse.error) {
        reject(new Error(reponse.error));
        return;
      }
      _driveAccessToken = reponse.access_token;
      _driveTokenExpiry = Date.now() + (reponse.expires_in * 1000) - 60000; // marge de 60s

      let email = '';
      try {
        const infos = await _driveInfosCompte();
        email = infos.email || '';
      } catch (_) { /* pas bloquant si l'email n'est pas récupérable */ }

      sauvegarderCompteGoogle(email);
      resolve({ email });
    };
    _driveTokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

// Extrait le message d'erreur détaillé renvoyé par l'API Google (plus utile
// que le seul code HTTP pour diagnostiquer un 403/400).
async function _driveExtraireErreur(res) {
  try {
    const data = await res.json();
    return data?.error?.message || data?.error_description || ('HTTP ' + res.status);
  } catch (_) {
    return 'HTTP ' + res.status;
  }
}

// Récupère l'email du compte connecté via l'API userinfo
async function _driveInfosCompte() {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: 'Bearer ' + _driveAccessToken }
  });
  if (!res.ok) throw new Error('Impossible de récupérer les infos du compte Google');
  return res.json();
}

// Révoque le token et efface l'état de connexion local
function deconnecterGoogleDrive() {
  if (_driveAccessToken && typeof google !== 'undefined' && google.accounts?.oauth2?.revoke) {
    google.accounts.oauth2.revoke(_driveAccessToken, () => {});
  }
  _driveAccessToken = null;
  _driveTokenExpiry = 0;
  _driveSyncFileId  = null; // évite de réutiliser l'id d'un fichier d'un autre compte
  sauvegarderCompteGoogle('');
  _driveMajStatut('inactif');
}

// L'utilisateur a-t-il un token Google valide en mémoire pour cette session ?
function estConnecteGoogleDrive() {
  return _driveTokenValide();
}


// ------------------------------------------------------------
//  SAUVEGARDE VERS DRIVE (push)
// ------------------------------------------------------------

const DRIVE_SYNC_NOM_FICHIER   = 'macrofit-sync.json';
const DRIVE_SYNC_DEBOUNCE_MS   = 4000;
const DRIVE_SYNC_BOUNDARY      = 'macrofit-sync-boundary';

// Clés purement locales à l'appareil : à ne jamais pousser vers Drive
// ni utiliser comme déclencheur de synchronisation.
const _DRIVE_SYNC_CLES_EXCLUES = new Set([CLES.GOOGLE_COMPTE, CLES.SYNC_DERNIER]);

let _driveSyncFileId       = null;  // id du fichier Drive, mis en cache après la 1ère recherche
let _driveSyncTimer        = null;  // handle du debounce
let _driveSyncEnCours      = false;
let _driveSyncStatut       = 'inactif'; // 'inactif' | 'en-cours' | 'succes' | 'erreur' | 'conflit'
let _driveSyncDerniereErreur = '';
let _driveRestaurationEnCours = false; // true pendant l'application d'un snapshot téléchargé
let _driveLocalModifieDepuisSync = false; // true si des écritures locales n'ont pas encore été synchronisées

// Intercepte toutes les écritures localStorage pour déclencher une
// synchronisation différée (debounce) sur toute clé applicative macrofit_*.
// Évite de devoir instrumenter chacune des fonctions de storage.js.
// Suspendu pendant l'application d'un snapshot téléchargé depuis Drive
// (sinon on repousserait aussitôt vers Drive ce qu'on vient d'en récupérer).
(function _driveInstallerHookLocalStorage() {
  const setItemOriginal = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (cle, valeur) {
    setItemOriginal(cle, valeur);
    if (!_driveRestaurationEnCours && cle.startsWith('macrofit_') && !_DRIVE_SYNC_CLES_EXCLUES.has(cle)) {
      _driveLocalModifieDepuisSync = true;
      _driveProgrammerSync();
    }
  };
})();

function _driveProgrammerSync() {
  // On se base sur le compte mémorisé plutôt que sur le token en mémoire :
  // celui-ci peut avoir expiré entre-temps, driveSauvegarderDonnees()
  // tentera alors une reconnexion silencieuse avant d'abandonner.
  if (!obtenirCompteGoogle()) return;
  clearTimeout(_driveSyncTimer);
  _driveSyncTimer = setTimeout(() => { driveSauvegarderDonnees(); }, DRIVE_SYNC_DEBOUNCE_MS);
}

function _driveMajStatut(statut, erreur) {
  _driveSyncStatut = statut;
  _driveSyncDerniereErreur = erreur || '';
  if (typeof _rafraichirIndicateurSyncDrive === 'function') _rafraichirIndicateurSyncDrive();
}

// Construit un instantané de toutes les données applicatives (clés macrofit_*)
function _driveConstruireSnapshot() {
  const donnees = {};
  for (let i = 0; i < localStorage.length; i++) {
    const cle = localStorage.key(i);
    if (cle.startsWith('macrofit_') && !_DRIVE_SYNC_CLES_EXCLUES.has(cle)) {
      donnees[cle] = localStorage.getItem(cle);
    }
  }
  return { donnees, exportedAt: new Date().toISOString() };
}

// Cherche le fichier de sync existant dans appDataFolder (une fois par session,
// puis mis en cache dans _driveSyncFileId).
async function _driveObtenirFileId() {
  if (_driveSyncFileId) return _driveSyncFileId;

  const params = new URLSearchParams({
    spaces : 'appDataFolder',
    q      : "name = '" + DRIVE_SYNC_NOM_FICHIER + "' and trashed = false",
    fields : 'files(id, name)',
  });
  const res = await fetch('https://www.googleapis.com/drive/v3/files?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + _driveAccessToken },
  });
  if (!res.ok) throw new Error('Recherche du fichier Drive échouée : ' + await _driveExtraireErreur(res));
  const data = await res.json();
  if (data.files && data.files.length > 0) {
    _driveSyncFileId = data.files[0].id;
  }
  return _driveSyncFileId;
}

function _driveConstruireCorpsMultipart(metadata, contenu) {
  const delimiter    = '\r\n--' + DRIVE_SYNC_BOUNDARY + '\r\n';
  const closeDelim   = '\r\n--' + DRIVE_SYNC_BOUNDARY + '--';
  return (
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(contenu) +
    closeDelim
  );
}

// Crée le fichier de sync dans appDataFolder (1ère synchronisation uniquement)
async function _driveCreerFichier(contenu) {
  const metadata = { name: DRIVE_SYNC_NOM_FICHIER, parents: ['appDataFolder'] };
  const corps    = _driveConstruireCorpsMultipart(metadata, contenu);

  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method  : 'POST',
    headers : {
      Authorization  : 'Bearer ' + _driveAccessToken,
      'Content-Type' : 'multipart/related; boundary=' + DRIVE_SYNC_BOUNDARY,
    },
    body: corps,
  });
  if (!res.ok) throw new Error('Création du fichier Drive échouée : ' + await _driveExtraireErreur(res));
  const data = await res.json();
  return data.id;
}

// Met à jour le contenu du fichier de sync existant
async function _driveMettreAJourFichier(fileId, contenu) {
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files/' + fileId + '?uploadType=media', {
    method  : 'PATCH',
    headers : {
      Authorization  : 'Bearer ' + _driveAccessToken,
      'Content-Type' : 'application/json; charset=UTF-8',
    },
    body: JSON.stringify(contenu),
  });
  if (!res.ok) throw new Error('Mise à jour du fichier Drive échouée : ' + await _driveExtraireErreur(res));
}

// Pousse l'état actuel du localStorage vers le fichier de sync sur Drive.
// Crée le fichier s'il n'existe pas encore, le met à jour sinon.
// options.forcerEcrasement = true : ignore la détection de conflit (utilisé
// après que l'utilisatrice a choisi de garder ses modifications locales).
async function driveSauvegarderDonnees(options = {}) {
  clearTimeout(_driveSyncTimer);

  if (!estConnecteGoogleDrive()) {
    if (!obtenirCompteGoogle()) {
      _driveMajStatut('inactif');
      return false;
    }
    // Token expiré (ex. après un rechargement de page) : on retente
    // silencieusement avant d'abandonner et de demander une reconnexion.
    const reconnecte = await tenterReconnexionSilencieuseGoogle();
    if (!reconnecte) {
      _driveMajStatut('erreur', 'session expirée — reconnecte-toi');
      return false;
    }
  }
  if (_driveSyncEnCours) return false; // évite les envois concurrents

  _driveSyncEnCours = true;
  _driveMajStatut('en-cours');
  try {
    const fileId = await _driveObtenirFileId();

    if (fileId && !options.forcerEcrasement) {
      // Un autre appareil a-t-il synchronisé depuis notre dernière synchro
      // connue ? Si oui, écraser directement risquerait de perdre ses
      // changements : on laisse l'utilisatrice choisir quoi garder.
      const distant = await _driveTelechargerFichier(fileId);
      const dernierSyncLocal = obtenirDernierSync();
      const conflit = !!dernierSyncLocal &&
        new Date(distant.exportedAt).getTime() > new Date(dernierSyncLocal).getTime();
      if (conflit) {
        _driveMajStatut('conflit');
        if (typeof _driveGererConflit === 'function') _driveGererConflit(distant);
        return false;
      }
    }

    const contenu = _driveConstruireSnapshot();
    if (fileId) {
      await _driveMettreAJourFichier(fileId, contenu);
    } else {
      _driveSyncFileId = await _driveCreerFichier(contenu);
    }

    enregistrerDernierSync(new Date().toISOString());
    _driveLocalModifieDepuisSync = false;
    _driveMajStatut('succes');
    return true;
  } catch (e) {
    console.error('❌ Synchronisation Drive échouée :', e);
    _driveMajStatut('erreur', e.message);
    return false;
  } finally {
    _driveSyncEnCours = false;
  }
}


// ------------------------------------------------------------
//  RÉCUPÉRATION DEPUIS DRIVE (pull, au chargement / à la connexion)
// ------------------------------------------------------------

// Télécharge le contenu brut du fichier de sync
async function _driveTelechargerFichier(fileId) {
  const res = await fetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media', {
    headers: { Authorization: 'Bearer ' + _driveAccessToken },
  });
  if (!res.ok) throw new Error('Téléchargement du fichier Drive échoué : ' + await _driveExtraireErreur(res));
  return res.json();
}

// Réécrit les clés localStorage à partir d'un snapshot { donnees, exportedAt }
// sans redéclencher de push automatique, puis rafraîchit l'état de l'app.
function _driveAppliquerSnapshot(snapshot) {
  _driveRestaurationEnCours = true;
  try {
    Object.entries(snapshot.donnees || {}).forEach(([cle, valeur]) => {
      localStorage.setItem(cle, valeur);
    });
  } finally {
    _driveRestaurationEnCours = false;
  }
  enregistrerDernierSync(new Date().toISOString());
  _driveLocalModifieDepuisSync = false; // le local correspond exactement à Drive désormais
  if (typeof _driveRafraichirUIApresRestauration === 'function') _driveRafraichirUIApresRestauration();
}

// Récupère les données depuis Drive si elles sont plus récentes que la
// dernière synchronisation connue de cet appareil, et les applique en local.
// Si le local a lui aussi des changements non synchronisés, c'est un conflit :
// on laisse l'utilisatrice choisir plutôt que d'écraser silencieusement.
// Retourne true si des données distantes ont été appliquées, false sinon
// (rien sur Drive, local déjà à jour, conflit en attente d'arbitrage, ou échec).
async function driveRecupererDonnees() {
  if (!estConnecteGoogleDrive()) {
    const reconnecte = await tenterReconnexionSilencieuseGoogle();
    if (!reconnecte) return false;
  }
  try {
    const fileId = await _driveObtenirFileId();
    if (!fileId) return false; // rien sur Drive pour l'instant (1er appareil)

    const snapshot = await _driveTelechargerFichier(fileId);
    const dernierSyncLocal = obtenirDernierSync();
    const distantPlusRecent = !dernierSyncLocal ||
      new Date(snapshot.exportedAt).getTime() > new Date(dernierSyncLocal).getTime();

    if (!distantPlusRecent) return false; // le local est déjà à jour

    if (_driveLocalModifieDepuisSync) {
      _driveMajStatut('conflit');
      if (typeof _driveGererConflit === 'function') _driveGererConflit(snapshot);
      return false;
    }

    _driveAppliquerSnapshot(snapshot);
    return true;
  } catch (e) {
    console.error('❌ Récupération Drive échouée :', e);
    _driveMajStatut('erreur', e.message);
    return false;
  }
}
