// ============================================================
//  MacroFit — storage.js
//  Toute la logique de sauvegarde et lecture des données.
//  Les autres fichiers JS n'touchent JAMAIS localStorage
//  directement : ils passent toujours par ces fonctions.
// ============================================================


// ------------------------------------------------------------
//  CLÉS DE STOCKAGE
//  On définit les noms une seule fois ici pour éviter les fautes
//  de frappe ailleurs dans le code.
// ------------------------------------------------------------
const CLES = {
  INGREDIENTS          : 'macrofit_ingredients',
  RECETTES             : 'macrofit_recettes',
  OBJECTIFS            : 'macrofit_objectifs',
  PLANNING             : 'macrofit_planning',
  JOURNAL              : 'macrofit_journal',
  COURSES_COCHES       : 'macrofit_courses_coches',
  SEED_VERSION         : 'macrofit_seed_version',
  COEFFICIENTS         : 'macrofit_coefficients',
  GRIGNOTAGE           : 'macrofit_grignotage',
  TOLERANCE            : 'macrofit_tolerance',
  DISMISSED_OPTIMISEUR : 'macrofit_dismissed_optimiseur',
  CLE_API              : 'macrofit_cle_api',
  GOOGLE_COMPTE        : 'macrofit_google_compte',
  SYNC_DERNIER         : 'macrofit_sync_dernier',
};

// Valeurs par défaut des coefficients ×2 par catégorie d'ingrédient
const COEFFICIENTS_DEFAUT = {
  'Viandes, Oeufs & Poissons' : 3,
  'Céréales & Féculents'      : 4,
  'Fruits & Légumes'          : 1.5,
  'Produits Laitiers'         : 2,
  'Matières Grasses'          : 2,
  'Condiments & Épices'       : 2,
  'Produits Sucrés'           : 1.5,
  'Boissons'                  : 1,
};

// Ratio cru→cuit par défaut selon la catégorie
// ratio > 1 : l'aliment gonfle (féculents secs)
// ratio < 1 : l'aliment perd du poids (viandes, légumes cuits)
// ratio = 1 : pas de transformation (produits laitiers, condiments…)
const RATIO_CUISSON_DEFAUT = {
  'Viandes, Oeufs & Poissons' : 0.75,
  'Céréales & Féculents'      : 2.50,
  'Fruits & Légumes'          : 1.0,
  'Produits Laitiers'         : 1.0,
  'Matières Grasses'          : 1.0,
  'Condiments & Épices'       : 1.0,
  'Produits Sucrés'           : 1.0,
  'Boissons'                  : 1.0,
};

// Version du dataset. Changer cette valeur force le rechargement
// des ingrédients au prochain lancement, sans toucher aux autres données.
const SEED_VERSION = 'ciqual-2025-v4';

// Mapping des anciens IDs (avant migration v3) vers les nouveaux IDs séquentiels
// Ciqual v2 IDs → v3 sequential IDs (1-513)
const MIGRATION_IDS_V2 = {
  // Ciqual IDs → new sequential IDs
  36024: 469, 22001: 447, 36304: 406, 26036: 469, 6254: 394,
  9100: 120,  9876: 118,  20503: 173, 20360: 179, 13004: 130,
  13005: 131, 20385: 263, 20041: 218, 20059: 269, 20020: 154,
  20066: 189, 12110: 291, 19646: 300, 17270: 278, 7001: 100,
  // Legacy pre-Ciqual IDs (1-20) → v3 sequential IDs
  1: 469, 2: 447, 3: 406, 4: 469, 5: 394,
  6: 120, 7: 118, 8: 173, 9: 179, 10: 130,
  11: 131, 12: 263, 13: 218, 14: 269, 15: 154,
  16: 189, 17: 291, 18: 300, 19: 278, 20: 100,
};


// ------------------------------------------------------------
//  NORMALISATION CIQUAL
//  Convertit un ingrédient au format ANSES Ciqual 2025
//  (pour_100g / kcal / nulls possibles) vers le format interne
//  (pour100g / calories / 0 par défaut).
// ------------------------------------------------------------
function normaliserIngredientCiqual(ing) {
  const p = ing.macros_pour_100g || ing.pour_100g || {};
  const ratioDefaut = RATIO_CUISSON_DEFAUT[ing.categorie] ?? 1.0;
  const cuisson = ing.cuisson || {
    ratio_cru_vers_cuit        : ratioDefaut,
    poids_cuit_pour_100g_cru   : Math.round(ratioDefaut * 100),
    poids_cru_pour_100g_cuit   : ratioDefaut > 0 ? Math.round(100 / ratioDefaut) : 100,
    methode_reference          : '',
    note                       : '',
  };
  const result = {
    id           : ing.id,
    nom          : ing.nom,
    categorie    : ing.categorie,
    sousCategorie: ing.sous_categorie || '',
    pour100g     : {
      proteines : p.proteines ?? 0,
      glucides  : p.glucides  ?? 0,
      lipides   : p.lipides   ?? 0,
      calories  : p.kcal      ?? 0,
      fibres    : p.fibres    ?? 0,
    },
    cuisson      : cuisson,
    favori       : false,
  };
  return result;
}


// ------------------------------------------------------------
//  INITIALISATION — HELPERS PRIVÉS
// ------------------------------------------------------------

// Charge tout seed.json et initialise toutes les clés
async function _chargerSeedComplet() {
  const reponse = await fetch('data/seed.json');
  const donnees = await reponse.json();

  const ingredients = donnees.ingredients.map(normaliserIngredientCiqual);

  localStorage.setItem(CLES.INGREDIENTS,  JSON.stringify(ingredients));
  localStorage.setItem(CLES.RECETTES,     JSON.stringify(donnees.recettes || []));
  localStorage.setItem(CLES.OBJECTIFS,    JSON.stringify(donnees.objectifsUtilisateurs));
  localStorage.setItem(CLES.PLANNING,     JSON.stringify({}));
  localStorage.setItem(CLES.JOURNAL,      JSON.stringify([]));
  localStorage.setItem(CLES.SEED_VERSION, SEED_VERSION);
}

// Recharge uniquement les ingrédients (planning/journal/objectifs conservés)
// et migre les IDs de recettes si nécessaire.
// Les ingrédients ajoutés manuellement (IDs absents du seed) sont préservés.
async function _mettreAJourIngredients() {
  const reponse = await fetch('data/seed.json');
  const donnees = await reponse.json();

  const seedIds         = new Set(donnees.ingredients.map(i => i.id));
  const seedIngredients = donnees.ingredients.map(normaliserIngredientCiqual);

  // Conserver les ingrédients custom (IDs non présents dans le seed)
  const existants = obtenirIngredients();
  const custom    = existants.filter(i => !seedIds.has(i.id));

  const ingredients = [...seedIngredients, ...custom];
  localStorage.setItem(CLES.INGREDIENTS,  JSON.stringify(ingredients));

  // Migrer les IDs d'ingrédients dans les recettes enregistrées
  const recettes = obtenirRecettes();
  const recettesMigrees = recettes.map(recette => ({
    ...recette,
    ingredients: (recette.ingredients || []).map(ligne => ({
      ...ligne,
      ingredientId: MIGRATION_IDS_V2[ligne.ingredientId] ?? ligne.ingredientId,
    })),
  }));
  sauvegarderRecettes(recettesMigrees);

  // Garantir une structure d'objectifs complète (Collation, fibres, quotidien) sans reset des données
  appliquerMigrationsObjectifs();

  localStorage.setItem(CLES.SEED_VERSION, SEED_VERSION);
  console.log(`✅ Ingrédients et recettes migrés vers ${SEED_VERSION}`);
}

// Ajoute le créneau Collation aux objectifs de chaque utilisateur s'il manque
function _ajouterCollationObjectifs() {
  const objectifs = obtenirObjectifs();
  if (!objectifs) return;
  const defauts = {
    moi    : { proteines: 15, glucides: 20, lipides: 8,  calories: 210, fibres: 5 },
    copain : { proteines: 20, glucides: 25, lipides: 10, calories: 270, fibres: 5 },
  };
  let modifie = false;
  for (const [user, def] of Object.entries(defauts)) {
    if (objectifs[user] && !objectifs[user].parRepas?.['Collation']) {
      objectifs[user].parRepas['Collation'] = def;
      modifie = true;
    }
  }
  if (modifie) localStorage.setItem(CLES.OBJECTIFS, JSON.stringify(objectifs));
}

// Ajoute le créneau Collation matin (post-training) aux objectifs si absent
function _ajouterCollationMatinObjectifs() {
  const objectifs = obtenirObjectifs();
  if (!objectifs) return;
  const defauts = {
    moi    : { proteines: 15, glucides: 20, lipides: 8,  calories: 210, fibres: 5 },
    copain : { proteines: 20, glucides: 25, lipides: 10, calories: 270, fibres: 5 },
  };
  let modifie = false;
  for (const [user, def] of Object.entries(defauts)) {
    if (objectifs[user] && !objectifs[user].parRepas?.['Collation matin']) {
      objectifs[user].parRepas['Collation matin'] = def;
      modifie = true;
    }
  }
  if (modifie) localStorage.setItem(CLES.OBJECTIFS, JSON.stringify(objectifs));
}

// Ajoute les fibres aux objectifs de chaque utilisateur si elles manquent
function _migrerFibresObjectifs() {
  const objectifs = obtenirObjectifs();
  if (!objectifs) return;
  const fibresDefaut = {
    moi    : { 'Petit-déjeuner': 7, 'Collation matin': 5, 'Déjeuner': 10, 'Collation': 5, 'Dîner': 10 },
    copain : { 'Petit-déjeuner': 8, 'Collation matin': 5, 'Déjeuner': 12, 'Collation': 5, 'Dîner': 12 },
  };
  let modifie = false;
  for (const [user, repasDefauts] of Object.entries(fibresDefaut)) {
    if (!objectifs[user]) continue;
    for (const [repas, val] of Object.entries(repasDefauts)) {
      const obj = objectifs[user].parRepas?.[repas];
      if (obj && obj.fibres === undefined) {
        obj.fibres = val;
        modifie = true;
      }
    }
    if (objectifs[user].quotidien && objectifs[user].quotidien.fibres === undefined) {
      objectifs[user].quotidien.fibres = user === 'moi' ? 30 : 35;
      modifie = true;
    }
  }
  if (modifie) localStorage.setItem(CLES.OBJECTIFS, JSON.stringify(objectifs));
}

// Additionne les repas d'un utilisateur pour obtenir des totaux quotidiens
function _genererQuotidienDepuisParRepas(parRepas) {
  const total = { proteines: 0, glucides: 0, lipides: 0, calories: 0, fibres: 0 };
  Object.values(parRepas || {}).forEach(r => {
    total.proteines += r.proteines || 0;
    total.glucides  += r.glucides  || 0;
    total.lipides   += r.lipides   || 0;
    total.calories  += r.calories  || 0;
    total.fibres    += r.fibres    || 0;
  });
  return total;
}

// Ajoute les objectifs quotidiens s'ils manquent. Le seed ne contient que
// des objectifs par repas : le quotidien n'est normalement créé qu'au premier
// enregistrement manuel du formulaire Réglages → Objectifs. Sans ce filet,
// un tout premier lancement (ou une donnée reçue d'un autre appareil qui n'a
// jamais visité cet écran) fait planter l'affichage du planning et des réglages.
function _ajouterQuotidienObjectifs() {
  const objectifs = obtenirObjectifs();
  if (!objectifs) return;
  let modifie = false;
  for (const user of Object.keys(objectifs)) {
    if (!objectifs[user].quotidien) {
      objectifs[user].quotidien = _genererQuotidienDepuisParRepas(objectifs[user].parRepas);
      modifie = true;
    }
  }
  if (modifie) localStorage.setItem(CLES.OBJECTIFS, JSON.stringify(objectifs));
}

// Regroupe toutes les migrations de sécurité sur les objectifs. À appeler
// après tout chargement de données — premier lancement, mise à jour de
// version, ou application d'un snapshot reçu de Google Drive — pour garantir
// une structure toujours complète quelle que soit sa provenance.
function appliquerMigrationsObjectifs() {
  _ajouterCollationObjectifs();
  _ajouterCollationMatinObjectifs();
  _migrerFibresObjectifs();
  _ajouterQuotidienObjectifs();
}


// ------------------------------------------------------------
//  INITIALISATION
//  • Premier lancement : charge tout seed.json
//  • Mise à jour de version : recharge uniquement les ingrédients
//  • Sinon : ne fait rien
// ------------------------------------------------------------
async function initialiserDonnees() {
  const premierLancement = !localStorage.getItem(CLES.OBJECTIFS);
  const versionActuelle  = localStorage.getItem(CLES.SEED_VERSION);

  if (premierLancement) {
    console.log('🌱 Premier lancement : chargement des données initiales...');
    try {
      await _chargerSeedComplet();
      appliquerMigrationsObjectifs(); // le seed ne contient pas les objectifs quotidiens
      console.log('✅ Données initiales chargées avec succès');
    } catch (erreur) {
      console.error('❌ Erreur lors du chargement de seed.json :', erreur);
    }
    return;
  }

  if (versionActuelle !== SEED_VERSION) {
    console.log(`🔄 Mise à jour des ingrédients (${versionActuelle || 'ancienne'} → ${SEED_VERSION})...`);
    try {
      await _mettreAJourIngredients();
    } catch (erreur) {
      console.error('❌ Erreur lors de la mise à jour des ingrédients :', erreur);
    }
  } else {
    // Garantir une structure d'objectifs complète même sans changement de version
    appliquerMigrationsObjectifs();
    console.log('✅ Données à jour');
  }
}


// ------------------------------------------------------------
//  INGRÉDIENTS
// ------------------------------------------------------------

// Lire tous les ingrédients
function obtenirIngredients() {
  const donnees = localStorage.getItem(CLES.INGREDIENTS);
  return donnees ? JSON.parse(donnees) : [];
}

// Sauvegarder la liste complète des ingrédients
function sauvegarderIngredients(ingredients) {
  localStorage.setItem(CLES.INGREDIENTS, JSON.stringify(ingredients));
}

// Trouver un ingrédient par son id
function obtenirIngredientParId(id) {
  const ingredients = obtenirIngredients();
  return ingredients.find(ing => ing.id === id) || null;
}

// Ajouter un nouvel ingrédient
function ajouterIngredient(nouvelIngredient) {
  const ingredients = obtenirIngredients();

  // Générer un id unique (le plus grand id existant + 1)
  const maxId = ingredients.reduce((max, ing) => Math.max(max, ing.id), 0);
  nouvelIngredient.id = maxId + 1;

  ingredients.push(nouvelIngredient);
  sauvegarderIngredients(ingredients);
  return nouvelIngredient;
}

// Supprimer un ingrédient par son id
function supprimerIngredient(id) {
  const ingredients = obtenirIngredients();
  const nouveau = ingredients.filter(ing => ing.id !== id);
  sauvegarderIngredients(nouveau);
}

// Mettre à jour un ingrédient existant (remplace par l'objet complet)
function modifierIngredient(ingredientModifie) {
  const ingredients = obtenirIngredients();
  const index = ingredients.findIndex(i => i.id === ingredientModifie.id);
  if (index !== -1) {
    ingredients[index] = ingredientModifie;
    sauvegarderIngredients(ingredients);
  }
}

// Basculer le statut favori d'un ingrédient
function toggleFavoriIngredient(id) {
  const ingredients = obtenirIngredients();
  const ing = ingredients.find(i => i.id === id);
  if (ing) {
    ing.favori = !ing.favori;
    sauvegarderIngredients(ingredients);
  }
}


// ------------------------------------------------------------
//  PHOTOS — File System Access API
//  Les photos sont de vrais fichiers dans un dossier "photos/"
//  choisi par l'utilisateur. On mémorise le handle dans IndexedDB.
// ------------------------------------------------------------

let _photoDirHandle = null;

function _ouvrirIDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('macrofit-meta', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('handles');
    r.onsuccess = e => res(e.target.result);
    r.onerror = rej;
  });
}
async function _lireIDB(key) {
  const db = await _ouvrirIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readonly');
    const r  = tx.objectStore('handles').get(key);
    r.onsuccess = e => res(e.target.result ?? null);
    r.onerror = rej;
  });
}
async function _ecrireIDB(key, val) {
  const db = await _ouvrirIDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(val, key);
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}

// Appelé au démarrage : tente de pré-autoriser silencieusement via queryPermission (sans geste)
async function initialiserPhotoDirHandle() {
  const saved = await _lireIDB('photosDir');
  if (!saved) return;
  const perm = await saved.queryPermission({ mode: 'readwrite' });
  if (perm === 'granted') _photoDirHandle = saved;
}

// Doit être appelé depuis un vrai clic (user gesture).
// Réutilise le handle mémorisé si permission encore valide,
// sinon demande re-autorisation ou sélection d'un nouveau dossier.
async function obtenirDossierPhotos() {
  if (_photoDirHandle) {
    const perm = await _photoDirHandle.queryPermission({ mode: 'readwrite' });
    if (perm === 'granted') return _photoDirHandle;
  }
  const saved = await _lireIDB('photosDir');
  if (saved) {
    const perm = await saved.requestPermission({ mode: 'readwrite' });
    if (perm === 'granted') { _photoDirHandle = saved; return saved; }
  }
  const handle = await window.showDirectoryPicker({
    id: 'macrofit-photos', mode: 'readwrite', startIn: 'pictures'
  });
  await _ecrireIDB('photosDir', handle);
  _photoDirHandle = handle;
  return handle;
}

// Suppose que _photoDirHandle est déjà autorisé (appelé après obtenirDossierPhotos)
async function sauvegarderPhotoFichier(file) {
  if (!_photoDirHandle) throw new Error('Dossier photos non configuré');
  const ext = file.type === 'image/png' ? 'png' : 'jpg';
  const nom = 'recette-' + Date.now() + '.' + ext;
  const fh  = await _photoDirHandle.getFileHandle(nom, { create: true });
  const w   = await fh.createWritable();
  await w.write(file);
  await w.close();
  return nom;
}

async function supprimerPhotoFichier(nomFichier) {
  if (!nomFichier || nomFichier.startsWith('data:') || !_photoDirHandle) return;
  try { await _photoDirHandle.removeEntry(nomFichier); } catch (_) { /* déjà absent */ }
}

// Retourne le src correct selon que la photo est un nom de fichier ou un base64 hérité
function srcPhoto(photo) {
  if (!photo) return '';
  if (photo.startsWith('data:')) return photo;
  if (photo.startsWith('drive:')) {
    const fileId = photo.slice(6);
    return (typeof _drivePhotoCache !== 'undefined' && _drivePhotoCache.has(fileId))
      ? _drivePhotoCache.get(fileId)
      : (typeof DRIVE_PHOTO_PLACEHOLDER !== 'undefined' ? DRIVE_PHOTO_PLACEHOLDER : '');
  }
  return 'photos/' + photo;
}

// ------------------------------------------------------------
//  RECETTES
// ------------------------------------------------------------

// Lire toutes les recettes
function obtenirRecettes() {
  const donnees = localStorage.getItem(CLES.RECETTES);
  return donnees ? JSON.parse(donnees) : [];
}

// Sauvegarder la liste complète des recettes
function sauvegarderRecettes(recettes) {
  try {
    localStorage.setItem(CLES.RECETTES, JSON.stringify(recettes));
  } catch (e) {
    alert('Impossible de sauvegarder : espace de stockage insuffisant.\nEssayez de supprimer la photo ou de réduire le nombre de recettes avec photo.');
    throw e;
  }
}

// Trouver une recette par son id
function obtenirRecetteParId(id) {
  const recettes = obtenirRecettes();
  return recettes.find(r => r.id === id) || null;
}

// Ajouter une nouvelle recette
function ajouterRecette(nouvelleRecette) {
  const recettes = obtenirRecettes();
  const maxId = recettes.reduce((max, r) => Math.max(max, r.id), 0);
  nouvelleRecette.id = maxId + 1;
  recettes.push(nouvelleRecette);
  sauvegarderRecettes(recettes);
  return nouvelleRecette;
}

// Mettre à jour une recette existante (remplace par l'objet complet)
function modifierRecette(recetteModifiee) {
  const recettes = obtenirRecettes();
  const index = recettes.findIndex(r => r.id === recetteModifiee.id);
  if (index !== -1) {
    recettes[index] = recetteModifiee;
    sauvegarderRecettes(recettes);
  }
}

function supprimerRecette(id) {
  const recettes = obtenirRecettes();
  sauvegarderRecettes(recettes.filter(r => r.id !== id));
}

// Basculer le statut favori d'une recette
function toggleFavoriRecette(id) {
  const recettes = obtenirRecettes();
  const recette = recettes.find(r => r.id === id);
  if (recette) {
    recette.favori = !recette.favori;
    sauvegarderRecettes(recettes);
  }
}


// ------------------------------------------------------------
//  OBJECTIFS MACROS
// ------------------------------------------------------------

// Lire les objectifs des deux utilisateurs
function obtenirObjectifs() {
  const donnees = localStorage.getItem(CLES.OBJECTIFS);
  return donnees ? JSON.parse(donnees) : null;
}

// Mettre à jour les objectifs d'un utilisateur ('moi' ou 'copain')
function mettreAJourObjectifs(utilisateur, nouveauxObjectifs) {
  const objectifs = obtenirObjectifs();
  if (objectifs && objectifs[utilisateur]) {
    objectifs[utilisateur] = { ...objectifs[utilisateur], ...nouveauxObjectifs };
    localStorage.setItem(CLES.OBJECTIFS, JSON.stringify(objectifs));
  }
}


// ------------------------------------------------------------
//  PLANNING HEBDOMADAIRE
//  Structure : { "2024-04-08": { "moi": { "Déjeuner": 2 }, "copain": {} }, ... }
//  La valeur est l'id de la recette planifiée.
// ------------------------------------------------------------

function obtenirPlanning() {
  const donnees = localStorage.getItem(CLES.PLANNING);
  return donnees ? JSON.parse(donnees) : {};
}

// Planifier une recette pour un jour, un repas et un utilisateur
function planifierRepas(dateISO, utilisateur, typeRepas, recetteId) {
  const planning = obtenirPlanning();

  if (!planning[dateISO]) planning[dateISO] = {};
  if (!planning[dateISO][utilisateur]) planning[dateISO][utilisateur] = {};

  planning[dateISO][utilisateur][typeRepas] = recetteId;
  localStorage.setItem(CLES.PLANNING, JSON.stringify(planning));
}

// Supprimer un repas planifié
function supprimerRepas(dateISO, utilisateur, typeRepas) {
  const planning = obtenirPlanning();
  if (planning[dateISO] && planning[dateISO][utilisateur]) {
    delete planning[dateISO][utilisateur][typeRepas];
    localStorage.setItem(CLES.PLANNING, JSON.stringify(planning));
  }
}

// Obtenir le planning d'une semaine entière (à partir d'une date de lundi)
function obtenirPlanningDeLaSemaine(dateLundi) {
  const planning = obtenirPlanning();
  const semaine = {};

  for (let i = 0; i < 7; i++) {
    const date = new Date(dateLundi);
    date.setDate(date.getDate() + i);
    const pad = n => String(n).padStart(2, '0');
    const dateISO = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    semaine[dateISO] = planning[dateISO] || {};
  }

  return semaine;
}


// ------------------------------------------------------------
//  JOURNAL QUOTIDIEN (repas cochés comme "mangés")
//  Structure : [{ date, utilisateur, typeRepas, recetteId, mange }, ...]
// ------------------------------------------------------------

function obtenirJournal() {
  const donnees = localStorage.getItem(CLES.JOURNAL);
  return donnees ? JSON.parse(donnees) : [];
}

// Marquer un repas comme mangé ou pas
function marquerRepasCommemange(dateISO, utilisateur, typeRepas, recetteId, mange) {
  const journal = obtenirJournal();

  // Chercher si une entrée existe déjà pour ce créneau
  const index = journal.findIndex(
    e => e.date === dateISO && e.utilisateur === utilisateur && e.typeRepas === typeRepas
  );

  const entree = { date: dateISO, utilisateur, typeRepas, recetteId, mange };

  if (index !== -1) {
    journal[index] = entree; // Mettre à jour
  } else {
    journal.push(entree);    // Ajouter
  }

  localStorage.setItem(CLES.JOURNAL, JSON.stringify(journal));
}

// Obtenir le journal d'un jour précis pour un utilisateur
function obtenirJournalDuJour(dateISO, utilisateur) {
  const journal = obtenirJournal();
  return journal.filter(e => e.date === dateISO && e.utilisateur === utilisateur);
}


// ------------------------------------------------------------
//  UTILITAIRES
// ------------------------------------------------------------

// Effacer TOUTES les données (utile pour tester ou réinitialiser)
function reinitialiserDonnees() {
  Object.values(CLES).forEach(cle => localStorage.removeItem(cle));
  console.log('🗑️ Toutes les données ont été supprimées');
}

// Exporter toutes les données en JSON (pour sauvegarde)
function exporterDonnees() {
  return {
    ingredients    : obtenirIngredients(),
    recettes       : obtenirRecettes(),
    objectifs      : obtenirObjectifs(),
    planning       : obtenirPlanning(),
    journal        : obtenirJournal(),
    coursesCoches  : obtenirCoursesCoches(),
    coefficients   : obtenirCoefficients(),
    exportedAt     : new Date().toISOString(),
  };
}

// Exporter uniquement les ingrédients (format simple : tableau d'ingrédients)
function exporterIngredients() {
  return {
    version     : SEED_VERSION,
    exportedAt  : new Date().toISOString(),
    ingredients : obtenirIngredients(),
  };
}

// Importer des ingrédients depuis un fichier de sauvegarde.
// Stratégie de fusion : ajoute les nouveaux ingrédients (ID absent),
// met à jour les existants (même ID). Ne supprime rien.
// Retourne le nombre d'ingrédients ajoutés et mis à jour.
function importerIngredients(data) {
  const source    = data.ingredients || data; // accepte tableau direct ou objet avec .ingredients
  if (!Array.isArray(source)) throw new Error('Format invalide');
  const actuels   = obtenirIngredients();
  const parId     = new Map(actuels.map(i => [i.id, i]));
  let ajoutes = 0, mises_a_jour = 0;
  source.forEach(ing => {
    if (!ing.id || !ing.nom) return;
    if (parId.has(ing.id)) {
      parId.set(ing.id, ing);
      mises_a_jour++;
    } else {
      parId.set(ing.id, ing);
      ajoutes++;
    }
  });
  sauvegarderIngredients([...parId.values()]);
  return { ajoutes, mises_a_jour };
}

// Importer des données depuis un fichier de sauvegarde
function importerDonnees(donnees) {
  if (donnees.ingredients)   sauvegarderIngredients(donnees.ingredients);
  if (donnees.recettes)      sauvegarderRecettes(donnees.recettes);
  if (donnees.objectifs)     localStorage.setItem(CLES.OBJECTIFS,       JSON.stringify(donnees.objectifs));
  if (donnees.planning)      localStorage.setItem(CLES.PLANNING,        JSON.stringify(donnees.planning));
  if (donnees.journal)       localStorage.setItem(CLES.JOURNAL,         JSON.stringify(donnees.journal));
  if (donnees.coursesCoches) localStorage.setItem(CLES.COURSES_COCHES,  JSON.stringify(donnees.coursesCoches));
  if (donnees.coefficients)  sauvegarderCoefficients(donnees.coefficients);
  console.log('✅ Données importées avec succès');
}


// ------------------------------------------------------------
//  LISTE DE COURSES — articles cochés
//  Structure : { "2025-04-07": [ingredientId1, ingredientId2, ...] }
//  La clé est la date ISO du lundi de la semaine.
// ------------------------------------------------------------

function obtenirCoursesCoches() {
  const d = localStorage.getItem(CLES.COURSES_COCHES);
  return d ? JSON.parse(d) : {};
}

function toggleCoursesCoche(semaineCle, ingredientId) {
  const coches = obtenirCoursesCoches();
  if (!coches[semaineCle]) coches[semaineCle] = [];
  const idx = coches[semaineCle].indexOf(ingredientId);
  if (idx !== -1) coches[semaineCle].splice(idx, 1);
  else coches[semaineCle].push(ingredientId);
  localStorage.setItem(CLES.COURSES_COCHES, JSON.stringify(coches));
}

function reinitialiserCoursesCoches(semaineCle) {
  const coches = obtenirCoursesCoches();
  coches[semaineCle] = [];
  localStorage.setItem(CLES.COURSES_COCHES, JSON.stringify(coches));
}


// ------------------------------------------------------------
//  COEFFICIENTS ×2 PAR CATÉGORIE
//  Stockés séparément de l'objectif utilisateur.
//  Merge avec COEFFICIENTS_DEFAUT pour garantir les valeurs manquantes.
// ------------------------------------------------------------

function obtenirCoefficients() {
  const d = localStorage.getItem(CLES.COEFFICIENTS);
  if (!d) return { ...COEFFICIENTS_DEFAUT };
  return { ...COEFFICIENTS_DEFAUT, ...JSON.parse(d) };
}

function sauvegarderCoefficients(coeffs) {
  localStorage.setItem(CLES.COEFFICIENTS, JSON.stringify(coeffs));
}


// ------------------------------------------------------------
//  PORTIONS PAR REPAS (x1 ou x2)
//  Stockées dans le planning : planning[dateISO].portions[typeRepas] = 1|2
// ------------------------------------------------------------

function obtenirPortionRepas(dateISO, typeRepas) {
  const planning = obtenirPlanning();
  return planning[dateISO]?.portions?.[typeRepas] ?? 1;
}

function togglePortionRepas(dateISO, typeRepas) {
  const planning = obtenirPlanning();
  if (!planning[dateISO])          planning[dateISO]          = {};
  if (!planning[dateISO].portions) planning[dateISO].portions = {};
  const current = planning[dateISO].portions[typeRepas] ?? 1;
  planning[dateISO].portions[typeRepas] = current === 1 ? 2 : 1;
  localStorage.setItem(CLES.PLANNING, JSON.stringify(planning));
}


// ------------------------------------------------------------
//  GRIGNOTAGE — ingrédients libres du jour
//  Structure : { "2025-04-11": [{ ingredientId, quantite }, ...] }
// ------------------------------------------------------------

function obtenirGrignotage(dateISO) {
  const d = localStorage.getItem(CLES.GRIGNOTAGE);
  const all = d ? JSON.parse(d) : {};
  return all[dateISO] || [];
}

function ajouterGrignotageItem(dateISO, ingredientId, quantite) {
  const d = localStorage.getItem(CLES.GRIGNOTAGE);
  const all = d ? JSON.parse(d) : {};
  if (!all[dateISO]) all[dateISO] = [];
  all[dateISO].push({ ingredientId, quantite });
  localStorage.setItem(CLES.GRIGNOTAGE, JSON.stringify(all));
}

function supprimerGrignotageItem(dateISO, index) {
  const d = localStorage.getItem(CLES.GRIGNOTAGE);
  const all = d ? JSON.parse(d) : {};
  if (all[dateISO]) {
    all[dateISO].splice(index, 1);
    localStorage.setItem(CLES.GRIGNOTAGE, JSON.stringify(all));
  }
}

// ------------------------------------------------------------
//  TOLÉRANCE MACROS
//  Marge en grammes acceptée pour les indicateurs vert/orange/rouge
// ------------------------------------------------------------

function obtenirTolerance() {
  const v = localStorage.getItem(CLES.TOLERANCE);
  return v !== null ? parseFloat(v) : 3;
}

function sauvegarderTolerance(valeur) {
  localStorage.setItem(CLES.TOLERANCE, String(valeur));
}


// ------------------------------------------------------------
//  DISMISSED OPTIMISEUR
//  Stocke les recettes pour lesquelles l'utilisateur a masqué
//  le bouton "Ajuster les macros".
//  Structure : { [recetteId]: hashObjectifs }
//  Le hash encode les objectifs en vigueur au moment du masquage.
//  Si les objectifs changent, le hash ne correspond plus →
//  le bouton réapparaît automatiquement.
// ------------------------------------------------------------

function obtenirDismissedOptimiseur() {
  try { return JSON.parse(localStorage.getItem(CLES.DISMISSED_OPTIMISEUR)) || {}; }
  catch { return {}; }
}

function sauvegarderDismissedOptimiseur(map) {
  localStorage.setItem(CLES.DISMISSED_OPTIMISEUR, JSON.stringify(map));
}


// ------------------------------------------------------------
//  CLÉ API ANTHROPIC
// ------------------------------------------------------------

function obtenirCleAPI() {
  return localStorage.getItem(CLES.CLE_API) || '';
}

function sauvegarderCleAPI(cle) {
  localStorage.setItem(CLES.CLE_API, cle);
}


// ------------------------------------------------------------
//  COMPTE GOOGLE (synchronisation Drive)
//  On ne stocke que l'email pour l'affichage — jamais le token,
//  qui reste en mémoire et expire avec la session.
// ------------------------------------------------------------

function obtenirCompteGoogle() {
  return localStorage.getItem(CLES.GOOGLE_COMPTE) || '';
}

function sauvegarderCompteGoogle(email) {
  if (email) localStorage.setItem(CLES.GOOGLE_COMPTE, email);
  else localStorage.removeItem(CLES.GOOGLE_COMPTE);
}

// Horodatage (ISO) de la dernière synchronisation Drive réussie
function obtenirDernierSync() {
  return localStorage.getItem(CLES.SYNC_DERNIER) || '';
}

function enregistrerDernierSync(dateISO) {
  localStorage.setItem(CLES.SYNC_DERNIER, dateISO);
}


// ------------------------------------------------------------
//  REPAS LIBRES (remplacement par ingrédients libres / IA)
//  Structure : { "2024-04-08": { "Déjeuner": { description,
//    ingredients, macros, estime, mange }, ... }, ... }
// ------------------------------------------------------------

const _CLE_REPAS_LIBRES = 'macrofit_repas_libres';

function obtenirRepasLibreJour(dateISO) {
  const d = localStorage.getItem(_CLE_REPAS_LIBRES);
  const all = d ? JSON.parse(d) : {};
  return all[dateISO] || {};
}

function sauvegarderRepasLibreItem(dateISO, typeRepas, data) {
  const d = localStorage.getItem(_CLE_REPAS_LIBRES);
  const all = d ? JSON.parse(d) : {};
  if (!all[dateISO]) all[dateISO] = {};
  all[dateISO][typeRepas] = data;
  localStorage.setItem(_CLE_REPAS_LIBRES, JSON.stringify(all));
}

function supprimerRepasLibreItem(dateISO, typeRepas) {
  const d = localStorage.getItem(_CLE_REPAS_LIBRES);
  if (!d) return;
  const all = JSON.parse(d);
  if (all[dateISO]) {
    delete all[dateISO][typeRepas];
    localStorage.setItem(_CLE_REPAS_LIBRES, JSON.stringify(all));
  }
}

function toggleRepasLibreMange(dateISO, typeRepas) {
  const d = localStorage.getItem(_CLE_REPAS_LIBRES);
  const all = d ? JSON.parse(d) : {};
  if (!all[dateISO]?.[typeRepas]) return false;
  all[dateISO][typeRepas].mange = !all[dateISO][typeRepas].mange;
  localStorage.setItem(_CLE_REPAS_LIBRES, JSON.stringify(all));
  return all[dateISO][typeRepas].mange;
}


// ------------------------------------------------------------
//  BATCH COOKING — facteurs de réduction personnalisés
//  Structure : { [recetteId]: { [composantIdx]: facteur } }
// ------------------------------------------------------------

const _CLE_BATCH_FACTEURS = 'macrofit_batch_facteurs';

function obtenirBatchFacteurs(recetteId) {
  const d = localStorage.getItem(_CLE_BATCH_FACTEURS);
  const all = d ? JSON.parse(d) : {};
  return all[recetteId] || {};
}

function sauvegarderBatchFacteur(recetteId, composantIdx, facteur) {
  const d = localStorage.getItem(_CLE_BATCH_FACTEURS);
  const all = d ? JSON.parse(d) : {};
  if (!all[recetteId]) all[recetteId] = {};
  all[recetteId][composantIdx] = facteur;
  localStorage.setItem(_CLE_BATCH_FACTEURS, JSON.stringify(all));
}

function reinitialiserBatchFacteur(recetteId, composantIdx) {
  const d = localStorage.getItem(_CLE_BATCH_FACTEURS);
  if (!d) return;
  const all = JSON.parse(d);
  if (all[recetteId]) {
    delete all[recetteId][composantIdx];
    localStorage.setItem(_CLE_BATCH_FACTEURS, JSON.stringify(all));
  }
}


// ------------------------------------------------------------
//  PAS QUOTIDIEN
//  Structure : { "2025-04-11": 8500 }
// ------------------------------------------------------------

const _CLE_PAS_QUOTIDIEN = 'macrofit_pas_quotidien';

function obtenirPasJour(dateISO) {
  const d = localStorage.getItem(_CLE_PAS_QUOTIDIEN);
  const all = d ? JSON.parse(d) : {};
  return all[dateISO] ?? null;
}

function sauvegarderPasJour(dateISO, valeur) {
  const d = localStorage.getItem(_CLE_PAS_QUOTIDIEN);
  const all = d ? JSON.parse(d) : {};
  all[dateISO] = valeur;
  localStorage.setItem(_CLE_PAS_QUOTIDIEN, JSON.stringify(all));
}