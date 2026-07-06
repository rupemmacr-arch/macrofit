// ============================================================
//  MacroFit — coach-sync.js
//  Envoi des données du jour vers le Google Sheets "Fiche de suivi"
//  partagé par le coach.
//  Phase 1 : lecture seule (diagnostic de structure), rien n'est
//  encore écrit dans le fichier.
// ============================================================

const COACH_SHEET_ID = '1HI8R8p5Loka7t_SCUoISELKM2qaXBFQb7qwVctli8Yc';
const COACH_SHEET_GID = 1746939284; // onglet visé par l'URL fournie

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
