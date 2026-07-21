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
//  COLORATION SELON LA TOLÉRANCE MACROFIT
//  Vert si l'écart (valeur réelle vs objectif) est dans la tolérance
//  réglée dans MacroFit (Réglages), rouge sinon — même logique que
//  evaluerConformite (js/macros.js), appliquée par macro (P/G/L
//  uniquement, comme dans l'app ; Kcal/Fibres restent neutres).
// ------------------------------------------------------------
const COACH_COULEUR_VERT  = { red: 0.851, green: 0.918, blue: 0.827 };
const COACH_COULEUR_ROUGE = { red: 0.957, green: 0.800, blue: 0.800 };

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

// Ajoute les requêtes de coloration Protéines/Glucides/Lipides pour un bloc
// (ligneProteines = ligne de la première des 3 métriques : Protéines,
// Glucides puis Lipides sur les 2 lignes suivantes).
function _sheetsAjouterCouleursConformite(requests, colIndex0based, ligneProteines, valeurs, cible, tolerance) {
  if (!cible) return;
  [
    { val: valeurs.proteines, cible: cible.proteines, ligne: ligneProteines },
    { val: valeurs.glucides,  cible: cible.glucides,  ligne: ligneProteines + 1 },
    { val: valeurs.lipides,   cible: cible.lipides,   ligne: ligneProteines + 2 },
  ].forEach(m => {
    if (m.cible === undefined) return;
    const conforme = Math.abs(m.val - m.cible) <= tolerance;
    requests.push(_sheetsRequeteCouleurCellule(colIndex0based, m.ligne, conforme ? COACH_COULEUR_VERT : COACH_COULEUR_ROUGE));
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

  // Coloration Protéines/Glucides/Lipides du total selon la tolérance MacroFit
  // (même logique que evaluerConformite, js/macros.js).
  const tolerance    = obtenirTolerance();
  const formatRequests = [];
  _sheetsAjouterCouleursConformite(formatRequests, colIndex0, COACH_LIGNE_TOTAL_DEBUT, total, OBJECTIFS?.moi?.quotidien, tolerance);

  await _sheetsEcrireValeurs(data);
  await _sheetsAppliquerFormat(formatRequests);
  _coachEnregistrerEnvoi(dateISO);
}
