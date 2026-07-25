// ============================================================
//  MacroFit — coach-sync.js
//  Envoi des données du jour vers le Google Sheets "Fiche de suivi"
//  partagé par le coach.
//  Phase 1 : lecture seule (diagnostic de structure).
//  Phase 2 : écriture quotidienne (pas, repas respectés, total
//  journalier) — pas de détail par créneau, juste les données globales.
// ============================================================

const COACH_SHEET_ID = '1HI8R8p5Loka7t_SCUoISELKM2qaXBFQb7qwVctli8Yc';
const COACH_SHEET_GID = 1746939284; // onglet visé par l'URL fournie

// Semaine 1 = lundi 15 juin 2026, colonnes B à H. Motif : 7 colonnes de jours
// + 2 colonnes d'écart avant la semaine suivante (période de 9 colonnes).
const COACH_LUNDI_REF = '2026-06-15';
const COACH_COLONNE_DEBUT_S1 = 2; // colonne B (A=1)
const COACH_PERIODE_COLONNES = 9;

const COACH_LIGNE_PAS = 5;
const COACH_LIGNES_REPAS = {
  'Petit-déjeuner'  : 10,
  'Collation matin' : 11, // "Post Workout" dans le Sheets du coach
  'Déjeuner'        : 12,
  'Collation'       : 13, // "Snack" dans le Sheets du coach
  'Dîner'           : 14,
};
const COACH_LIGNE_TOTAL_DEBUT = 52; // 52=Protéines, 53=Glucides, 54=Lipides, 55=Kcal, 56=Fibres

// Convertit un index de colonne 1-based (A=1) en lettre(s) A1
function _sheetsIndexVersColonne(index) {
  let lettre = '';
  while (index > 0) {
    const reste = (index - 1) % 26;
    lettre = String.fromCharCode(65 + reste) + lettre;
    index = Math.floor((index - 1) / 26);
  }
  return lettre;
}

// Calcule la colonne exacte (semaine + jour) correspondant à une date ISO,
// à partir du lundi de référence (Semaine 1 = 2026-06-15).
function _sheetsColonneJour(dateISO) {
  const ref = new Date(COACH_LUNDI_REF + 'T00:00:00');
  const cible = new Date(dateISO + 'T00:00:00');
  const joursDepuisRef = Math.round((cible - ref) / 86400000);
  if (joursDepuisRef < 0) throw new Error('Date antérieure à la semaine 1 du suivi (15 juin 2026)');
  const semaine       = Math.floor(joursDepuisRef / 7) + 1;
  const jourSemaine    = joursDepuisRef % 7; // 0=lundi … 6=dimanche
  const colIndex = COACH_COLONNE_DEBUT_S1 + (semaine - 1) * COACH_PERIODE_COLONNES + jourSemaine;
  return { semaine, jourSemaine, colIndex, colLettre: _sheetsIndexVersColonne(colIndex) };
}

// Récupère le nom de l'onglet correspondant à un gid donné
async function _sheetsObtenirNomFeuille(gid) {
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + COACH_SHEET_ID + '?fields=sheets.properties',
    { headers: { Authorization: 'Bearer ' + _driveAccessToken } }
  );
  if (!res.ok) throw new Error('Lecture des propriétés du Sheets échouée : ' + await _driveExtraireErreur(res));
  const data = await res.json();
  const feuille = data.sheets.find(s => s.properties.sheetId === gid);
  if (!feuille) throw new Error('Aucun onglet ne correspond au gid ' + gid);
  return feuille.properties.title;
}

// Lit des valeurs brutes (non formatées) sur une liste de plages
async function _sheetsLireValeurs(nomFeuille, plages) {
  const params = new URLSearchParams();
  plages.forEach(p => params.append('ranges', nomFeuille + '!' + p));
  params.append('valueRenderOption', 'UNFORMATTED_VALUE');
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + COACH_SHEET_ID + '/values:batchGet?' + params.toString(),
    { headers: { Authorization: 'Bearer ' + _driveAccessToken } }
  );
  if (!res.ok) throw new Error('Lecture des valeurs échouée : ' + await _driveExtraireErreur(res));
  return (await res.json()).valueRanges;
}

// Lit la validation de données (ex. case à cocher) sur une plage précise
async function _sheetsLireValidation(nomFeuille, plage) {
  const params = new URLSearchParams({
    ranges: nomFeuille + '!' + plage,
    fields: 'sheets(data(rowData(values(userEnteredValue,effectiveValue,dataValidation))))',
  });
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + COACH_SHEET_ID + '?' + params.toString(),
    { headers: { Authorization: 'Bearer ' + _driveAccessToken } }
  );
  if (!res.ok) throw new Error('Lecture de la validation de données échouée : ' + await _driveExtraireErreur(res));
  return await res.json();
}

// Diagnostic en lecture seule : ne modifie rien, affiche simplement ce qui
// est trouvé dans les plages qui nous intéressent pour concevoir la suite.
async function sheetsDiagnostiquerStructure() {
  if (!estConnecteGoogleDrive()) {
    const reconnecte = await tenterReconnexionSilencieuseGoogle();
    if (!reconnecte) throw new Error('Non connecté à Google (reconnecte-toi depuis Réglages)');
  }

  const nomFeuille = await _sheetsObtenirNomFeuille(COACH_SHEET_GID);

  const [valeurs, validationRepas] = await Promise.all([
    _sheetsLireValeurs(nomFeuille, ['A1:H14', 'A45:H65']),
    _sheetsLireValidation(nomFeuille, 'A10:H14'),
  ]);

  return { nomFeuille, valeurs, validationRepas };
}

// Diagnostic ciblé : lit la vraie valeur ET la vraie couleur de fond
// stockées dans la cellule Protéines du Total journalier pour une date
// donnée, plus l'objectif utilisé au moment du diagnostic — pour couper
// court à toute ambiguïté sur ce qui est réellement dans le Sheets.
async function sheetsDiagnostiquerCouleurProteines(dateISO) {
  dateISO = dateISO || dateVersISO(new Date());
  await _sheetsAssurerConnexion();
  const nomFeuille = await _sheetsObtenirNomFeuille(COACH_SHEET_GID);
  const { colLettre, colIndex } = _sheetsColonneJour(dateISO);
  const cellule = colLettre + COACH_LIGNE_TOTAL_DEBUT;

  const params = new URLSearchParams({
    ranges: nomFeuille + '!' + cellule,
    fields: 'sheets(data(rowData(values(userEnteredValue,effectiveValue,userEnteredFormat.backgroundColor,effectiveFormat.backgroundColor))))',
  });
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + COACH_SHEET_ID + '?' + params.toString(),
    { headers: { Authorization: 'Bearer ' + _driveAccessToken } }
  );
  if (!res.ok) throw new Error('Lecture échouée : ' + await _driveExtraireErreur(res));
  const data = await res.json();
  const cell = data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0] || {};

  return {
    dateISO, colLettre, colIndex, cellule,
    valeurCellule: cell.effectiveValue,
    couleurEffective: cell.effectiveFormat?.backgroundColor,
    couleurSaisie: cell.userEnteredFormat?.backgroundColor,
    objectifProteinesActuel: OBJECTIFS?.moi?.quotidien?.proteines,
    couleursConnues: {
      vert: COACH_COULEUR_VERT, vertFonce: COACH_COULEUR_VERT_FONCE,
      orange: COACH_COULEUR_ORANGE, rouge: COACH_COULEUR_ROUGE,
    },
  };
}

async function _sheetsAssurerConnexion() {
  if (!estConnecteGoogleDrive()) {
    const reconnecte = await tenterReconnexionSilencieuseGoogle();
    if (!reconnecte) throw new Error('Non connecté à Google (reconnecte-toi depuis Réglages)');
  }
}

// Écrit plusieurs plages en une seule requête. `data` : [{ range, values }, ...]
// (range déjà préfixé avec le nom de la feuille, ex. "'Suivi 2'!AC5")
async function _sheetsEcrireValeurs(data) {
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + COACH_SHEET_ID + '/values:batchUpdate',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + _driveAccessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ valueInputOption: 'USER_ENTERED', data }),
    }
  );
  if (!res.ok) throw new Error('Écriture Sheets échouée : ' + await _driveExtraireErreur(res));
  return res.json();
}

// Envoie une liste de requêtes de mise en forme (spreadsheets.batchUpdate,
// distinct de values:batchUpdate qui ne gère que le contenu des cellules).
async function _sheetsAppliquerFormat(requests) {
  if (!requests.length) return null;
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + COACH_SHEET_ID + ':batchUpdate',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + _driveAccessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    }
  );
  if (!res.ok) throw new Error('Mise en forme échouée : ' + await _driveExtraireErreur(res));
  return res.json();
}

// ------------------------------------------------------------
//  COLORATION À 3 PALIERS (Total journalier du Sheets coach)
//  Vert : écart ≤ tolérance. Orange : écart ≤ 2× la tolérance.
//  Rouge : au-delà. Tolérances fixes, indépendantes du réglage
//  MacroFit (celui-ci reste utilisé ailleurs dans l'app).
// ------------------------------------------------------------
const COACH_COULEUR_VERT       = { red: 0.851, green: 0.918, blue: 0.827 };
const COACH_COULEUR_VERT_FONCE = { red: 0.416, green: 0.659, blue: 0.310 };
const COACH_COULEUR_ORANGE     = { red: 0.996, green: 0.898, blue: 0.804 };
const COACH_COULEUR_ROUGE      = { red: 0.957, green: 0.800, blue: 0.800 };

function _sheetsRequeteCouleurCellule(colIndex0based, ligne1based, couleur) {
  return {
    repeatCell: {
      range: {
        sheetId: COACH_SHEET_GID,
        startRowIndex: ligne1based - 1,
        endRowIndex: ligne1based,
        startColumnIndex: colIndex0based,
        endColumnIndex: colIndex0based + 1,
      },
      cell: { userEnteredFormat: { backgroundColor: couleur } },
      fields: 'userEnteredFormat.backgroundColor',
    },
  };
}

// Tolérances de coloration du Sheets coach — fixes, indépendantes du
// réglage de tolérance de MacroFit (celui-ci reste utilisé ailleurs dans
// l'app pour l'écran Accueil / le badge de conformité des recettes).
const COACH_TOLERANCE_MACRO    = 10;  // ± 10 g pour Protéines / Glucides / Lipides
const COACH_TOLERANCE_CALORIES = 100; // ± 100 kcal

// Ajoute les requêtes de coloration Protéines/Glucides/Lipides/Kcal pour un
// bloc (ligneProteines = ligne de Protéines ; Glucides, Lipides puis Kcal
// sur les 3 lignes suivantes).
function _sheetsAjouterCouleursConformite(requests, colIndex0based, ligneProteines, valeurs, cible) {
  if (!cible) return;
  [
    { val: valeurs.proteines, cible: cible.proteines, ligne: ligneProteines,     tolerance: COACH_TOLERANCE_MACRO,    depassementFavorable: true },
    { val: valeurs.glucides,  cible: cible.glucides,  ligne: ligneProteines + 1, tolerance: COACH_TOLERANCE_MACRO },
    { val: valeurs.lipides,   cible: cible.lipides,   ligne: ligneProteines + 2, tolerance: COACH_TOLERANCE_MACRO },
    { val: valeurs.calories,  cible: cible.calories,  ligne: ligneProteines + 3, tolerance: COACH_TOLERANCE_CALORIES },
  ].forEach(m => {
    if (m.cible === undefined) return;
    let couleur;
    if (m.depassementFavorable && m.val > m.cible) {
      // Dépasser l'objectif de protéines n'est jamais pénalisé, quel que soit l'écart.
      couleur = COACH_COULEUR_VERT_FONCE;
    } else {
      const ecart = Math.abs(m.val - m.cible);
      couleur = ecart <= m.tolerance ? COACH_COULEUR_VERT
              : ecart <= m.tolerance * 2 ? COACH_COULEUR_ORANGE
              : COACH_COULEUR_ROUGE;
    }
    requests.push(_sheetsRequeteCouleurCellule(colIndex0based, m.ligne, couleur));
  });
}

// ------------------------------------------------------------
//  MACROS D'UN REPAS PRÉCIS POUR UN JOUR DONNÉ
//  Réutilise calculerMacrosRecette (js/macros.js) et les mêmes
//  sources de données que l'écran Accueil — aucun nouveau calcul.
// ------------------------------------------------------------
function _macrosRepasDuJour(dateISO, typeRepas) {
  const vide = { proteines: 0, glucides: 0, lipides: 0, calories: 0, fibres: 0 };
  const planningJour = obtenirPlanning()[dateISO]?.moi || {};
  const repasLibres   = obtenirRepasLibreJour(dateISO);
  const journal       = obtenirJournalDuJour(dateISO, 'moi');

  const libre = repasLibres[typeRepas];
  if (libre) {
    return { macros: libre.macros || vide, mange: libre.mange === true };
  }
  const recetteId = planningJour[typeRepas];
  const recette   = recetteId ? RECETTES.find(r => r.id === recetteId) : null;
  if (recette) {
    const entree = journal.find(e => e.typeRepas === typeRepas);
    return { macros: calculerMacrosRecette(recette, INGREDIENTS), mange: entree?.mange === true };
  }
  return { macros: vide, mange: false };
}

// ------------------------------------------------------------
//  INDICATEUR "ENVOYÉ" — par date (pas seulement aujourd'hui, pour
//  pouvoir aussi suivre l'état d'envoi d'un jour passé consulté).
// ------------------------------------------------------------
function obtenirCoachEnvois() {
  try { return JSON.parse(localStorage.getItem('macrofit_coach_envois')) || {}; }
  catch { return {}; }
}

function _coachEnregistrerEnvoi(dateISO) {
  const envois = obtenirCoachEnvois();
  envois[dateISO] = new Date().toISOString();
  localStorage.setItem('macrofit_coach_envois', JSON.stringify(envois));
}

function coachEnvoyePourDate(dateISO) {
  return !!obtenirCoachEnvois()[dateISO];
}

// ------------------------------------------------------------
//  ENVOI — bouton "Envoyer au coach"
//  dateISO : jour à envoyer (par défaut aujourd'hui). Ne touche QUE la
//  colonne calculée pour cette date précise, jamais les autres colonnes —
//  ce qui permet aussi de renvoyer un jour passé en toute sécurité.
// ------------------------------------------------------------
async function sheetsEnvoyerAuCoach(dateISO) {
  dateISO = dateISO || dateVersISO(new Date());
  await _sheetsAssurerConnexion();
  const nomFeuille = await _sheetsObtenirNomFeuille(COACH_SHEET_GID);
  const { colLettre, colIndex } = _sheetsColonneJour(dateISO);
  const colIndex0 = colIndex - 1;
  const cellule = (ligne) => "'" + nomFeuille + "'!" + colLettre + ligne;

  const data = [];

  // Pas quotidien
  const pas = obtenirPasJour(dateISO);
  data.push({ range: cellule(COACH_LIGNE_PAS), values: [[pas ?? '']] });

  // Repas respectés (cases à cocher)
  for (const typeRepas of Object.keys(COACH_LIGNES_REPAS)) {
    const { mange } = _macrosRepasDuJour(dateISO, typeRepas);
    data.push({ range: cellule(COACH_LIGNES_REPAS[typeRepas]), values: [[mange]] });
  }

  // Total journalier (52-56) — uniquement les repas marqués mangés
  const total = _macrosJourValides(dateISO) || { proteines: 0, glucides: 0, lipides: 0, calories: 0, fibres: 0 };
  data.push({
    range: "'" + nomFeuille + "'!" + colLettre + COACH_LIGNE_TOTAL_DEBUT + ':' + colLettre + (COACH_LIGNE_TOTAL_DEBUT + 4),
    values: [[total.proteines], [total.glucides], [total.lipides], [total.calories], [total.fibres]],
  });

  // Coloration Protéines/Glucides/Lipides/Kcal du total (± 10g macros, ± 100 kcal)
  const formatRequests = [];
  _sheetsAjouterCouleursConformite(formatRequests, colIndex0, COACH_LIGNE_TOTAL_DEBUT, total, OBJECTIFS?.moi?.quotidien);

  await _sheetsEcrireValeurs(data);
  await _sheetsAppliquerFormat(formatRequests);
  _coachEnregistrerEnvoi(dateISO);
}
