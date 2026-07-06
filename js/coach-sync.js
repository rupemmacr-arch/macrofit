// ============================================================
//  MacroFit — coach-sync.js
//  Envoi des données du jour vers le Google Sheets "Fiche de suivi"
//  partagé par le coach.
//  Phase 1 : lecture seule (diagnostic de structure).
//  Phase 2 : calcul de colonne + préparation des 25 lignes de détail
//  + écriture quotidienne (pas, repas respectés, macros).
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

// Chaque créneau occupe 7 lignes : 1 ligne titre + 5 métriques + 1 ligne
// vide de séparation avant le créneau suivant (ligneDebut = ligne du titre,
// les 5 métriques commencent à ligneDebut + 1).
const COACH_CRENEAUX_DETAIL = ['Petit-déjeuner', 'Collation matin', 'Déjeuner', 'Collation', 'Dîner']
  .map((id, i) => ({ id, ligneDebut: 57 + i * 7 }));
const COACH_METRIQUES = ['Protéines (g)', 'Glucides (g)', 'Lipides (g)', 'Kcal', 'Fibres (g)'];

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

// ------------------------------------------------------------
//  PRÉPARATION DES LIGNES DE DÉTAIL (une seule fois)
//  N'écrit QUE des libellés en colonne A, lignes 57 à 90 — jamais
//  au-dessus de la ligne 56 existante. Vérifie d'abord que ces
//  lignes sont bien vides avant d'écrire quoi que ce soit.
//  Disposition par créneau : 1 ligne titre + 5 métriques + 1 ligne
//  vide de séparation (sauf après le dernier créneau).
// ------------------------------------------------------------
const COACH_LIGNE_DETAIL_FIN = COACH_CRENEAUX_DETAIL[COACH_CRENEAUX_DETAIL.length - 1].ligneDebut + COACH_METRIQUES.length;

async function sheetsPreparerLignesDetail() {
  await _sheetsAssurerConnexion();
  const nomFeuille = await _sheetsObtenirNomFeuille(COACH_SHEET_GID);
  const plage = 'A57:A' + COACH_LIGNE_DETAIL_FIN;

  const [existant] = await _sheetsLireValeurs(nomFeuille, [plage]);
  const dejaRempli = (existant.values || []).some(row => row.length > 0 && row[0] !== '');
  if (dejaRempli) {
    throw new Error('Les lignes 57 à ' + COACH_LIGNE_DETAIL_FIN + ' contiennent déjà des données — abandon par sécurité, aucune écriture effectuée.');
  }

  const labels = [];
  COACH_CRENEAUX_DETAIL.forEach((c, i) => {
    labels.push([c.id]);
    COACH_METRIQUES.forEach(m => labels.push([m]));
    if (i < COACH_CRENEAUX_DETAIL.length - 1) labels.push(['']); // ligne vide de séparation
  });

  await _sheetsEcrireValeurs([
    { range: "'" + nomFeuille + "'!" + plage, values: labels },
  ]);

  await _sheetsMettreEnGras(COACH_CRENEAUX_DETAIL.map(c => c.ligneDebut));

  return labels.length;
}

// Met en gras la colonne A des lignes indiquées (1-based), comme le titre
// "Total journalier" existant.
async function _sheetsMettreEnGras(lignes1based) {
  const requests = lignes1based.map(ligne => ({
    repeatCell: {
      range: {
        sheetId: COACH_SHEET_GID,
        startRowIndex: ligne - 1,
        endRowIndex: ligne,
        startColumnIndex: 0,
        endColumnIndex: 1,
      },
      cell: { userEnteredFormat: { textFormat: { bold: true } } },
      fields: 'userEnteredFormat.textFormat.bold',
    },
  }));
  const res = await fetch(
    'https://sheets.googleapis.com/v4/spreadsheets/' + COACH_SHEET_ID + ':batchUpdate',
    {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + _driveAccessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    }
  );
  if (!res.ok) throw new Error('Mise en forme (gras) échouée : ' + await _driveExtraireErreur(res));
  return res.json();
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
//  INDICATEUR "ENVOYÉ AUJOURD'HUI"
// ------------------------------------------------------------
function obtenirCoachDernierEnvoi() {
  return localStorage.getItem('macrofit_coach_dernier_envoi') || '';
}

function _coachEnregistrerEnvoi(dateISO) {
  localStorage.setItem('macrofit_coach_dernier_envoi', dateISO);
}

function coachEnvoyeAujourdHui() {
  return obtenirCoachDernierEnvoi() === dateVersISO(new Date());
}

// ------------------------------------------------------------
//  ENVOI QUOTIDIEN — bouton "Envoyer au coach"
//  Ne touche QUE la colonne du jour même (calculée à partir de la
//  date du jour), jamais les colonnes des jours précédents/suivants.
// ------------------------------------------------------------
async function sheetsEnvoyerAuCoach() {
  await _sheetsAssurerConnexion();
  const nomFeuille = await _sheetsObtenirNomFeuille(COACH_SHEET_GID);
  const dateISO    = dateVersISO(new Date());
  const { colLettre } = _sheetsColonneJour(dateISO);
  const cellule = (ligne) => "'" + nomFeuille + "'!" + colLettre + ligne;

  const data = [];

  // Pas quotidien
  const pas = obtenirPasJour(dateISO);
  data.push({ range: cellule(COACH_LIGNE_PAS), values: [[pas ?? '']] });

  // Repas respectés (cases à cocher) + détail macros par créneau
  const detailParCreneau = {};
  for (const typeRepas of Object.keys(COACH_LIGNES_REPAS)) {
    detailParCreneau[typeRepas] = _macrosRepasDuJour(dateISO, typeRepas);
    data.push({ range: cellule(COACH_LIGNES_REPAS[typeRepas]), values: [[detailParCreneau[typeRepas].mange]] });
  }

  // Total journalier (52-56) — uniquement les repas marqués mangés
  const total = _macrosJourValides(dateISO) || { proteines: 0, glucides: 0, lipides: 0, calories: 0, fibres: 0 };
  data.push({
    range: "'" + nomFeuille + "'!" + colLettre + COACH_LIGNE_TOTAL_DEBUT + ':' + colLettre + (COACH_LIGNE_TOTAL_DEBUT + 4),
    values: [[total.proteines], [total.glucides], [total.lipides], [total.calories], [total.fibres]],
  });

  // Détail par créneau — 0 si le repas n'a pas été marqué mangé.
  // ligneDebut = ligne du titre du créneau ; les métriques commencent à ligneDebut + 1.
  COACH_CRENEAUX_DETAIL.forEach(c => {
    const { macros, mange } = detailParCreneau[c.id];
    const vals = mange
      ? [macros.proteines, macros.glucides, macros.lipides, macros.calories, macros.fibres ?? 0]
      : [0, 0, 0, 0, 0];
    const ligneMetriques = c.ligneDebut + 1;
    data.push({
      range: "'" + nomFeuille + "'!" + colLettre + ligneMetriques + ':' + colLettre + (ligneMetriques + 4),
      values: vals.map(v => [v]),
    });
  });

  await _sheetsEcrireValeurs(data);
  _coachEnregistrerEnvoi(dateISO);
}
