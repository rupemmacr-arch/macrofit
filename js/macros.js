// ============================================================
//  MacroFit — macros.js
//  Toutes les fonctions de calcul nutritionnel.
//  Ce fichier ne touche jamais localStorage directement —
//  il reçoit des données en entrée et retourne des résultats.
// ============================================================


// ------------------------------------------------------------
//  RATIO CRU/CUIT
//  Renvoie le ratio cru→cuit d'un ingrédient.
//  Toutes les quantités stockées dans les recettes sont en
//  grammes CRU. Le flag peseCuit sur une ligne est purement
//  un choix d'affichage/saisie — la valeur stockée est
//  toujours le poids cru équivalent.
// ------------------------------------------------------------
function getRatioCuisson(ingredient) {
  return ingredient?.cuisson?.ratio_cru_vers_cuit ?? 1.0;
}

// Convertit un poids saisi par l'utilisateur en poids CRU
// selon l'état du toggle et le ratio de l'ingrédient.
function poidsVers100gCru(poidsSaisi, peseCuit, ingredient) {
  if (!peseCuit) return poidsSaisi;
  const ratio = getRatioCuisson(ingredient);
  return ratio > 0 ? poidsSaisi / ratio : poidsSaisi;
}


// ------------------------------------------------------------
//  CALCUL DES MACROS D'UNE RECETTE
//  Prend une recette et la liste des ingrédients,
//  retourne les macros totales calculées.
//  NB : ligne.quantite est TOUJOURS en grammes CRU.
// ------------------------------------------------------------
function calculerMacrosRecette(recette, ingredients) {
  const totaux = { proteines: 0, glucides: 0, lipides: 0, calories: 0, fibres: 0 };

  recette.ingredients.forEach(ligne => {
    const ingredient = ingredients.find(ing => ing.id === ligne.ingredientId);
    if (!ingredient) return;

    const ratio = ligne.quantite / 100;
    totaux.proteines += ingredient.pour100g.proteines * ratio;
    totaux.glucides  += ingredient.pour100g.glucides  * ratio;
    totaux.lipides   += ingredient.pour100g.lipides   * ratio;
    totaux.calories  += ingredient.pour100g.calories  * ratio;
    totaux.fibres    += (ingredient.pour100g.fibres ?? 0) * ratio;
  });

  return {
    proteines : Math.round(totaux.proteines * 10) / 10,
    glucides  : Math.round(totaux.glucides  * 10) / 10,
    lipides   : Math.round(totaux.lipides   * 10) / 10,
    calories  : Math.round(totaux.calories),
    fibres    : Math.round(totaux.fibres    * 10) / 10,
  };
}


// Variante de calculerMacrosRecette qui applique un coefficient
// par catégorie d'ingrédient (utilisé pour les repas en ×2).
function calculerMacrosAvecCoeff(recette, ingredients, coefficients) {
  const totaux = { proteines: 0, glucides: 0, lipides: 0, calories: 0, fibres: 0 };
  recette.ingredients.forEach(ligne => {
    const ingredient = ingredients.find(ing => ing.id === ligne.ingredientId);
    if (!ingredient) return;
    const coeff = coefficients?.[ingredient.categorie] ?? 1;
    const ratio = (ligne.quantite * coeff) / 100;
    totaux.proteines += ingredient.pour100g.proteines * ratio;
    totaux.glucides  += ingredient.pour100g.glucides  * ratio;
    totaux.lipides   += ingredient.pour100g.lipides   * ratio;
    totaux.calories  += ingredient.pour100g.calories  * ratio;
    totaux.fibres    += (ingredient.pour100g.fibres ?? 0) * ratio;
  });
  return {
    proteines : Math.round(totaux.proteines * 10) / 10,
    glucides  : Math.round(totaux.glucides  * 10) / 10,
    lipides   : Math.round(totaux.lipides   * 10) / 10,
    calories  : Math.round(totaux.calories),
    fibres    : Math.round(totaux.fibres    * 10) / 10,
  };
}


// ------------------------------------------------------------
//  CALCUL DES MACROS D'UNE JOURNÉE
//  Additionne les macros de toutes les recettes du jour.
// ------------------------------------------------------------
function calculerMacrosJour(recettesIds, toutesLesRecettes, tousLesIngredients) {
  const totaux = { proteines: 0, glucides: 0, lipides: 0, calories: 0, fibres: 0 };

  recettesIds.forEach(id => {
    const recette = toutesLesRecettes.find(r => r.id === id);
    if (!recette) return;

    const macros = calculerMacrosRecette(recette, tousLesIngredients);
    totaux.proteines += macros.proteines;
    totaux.glucides  += macros.glucides;
    totaux.lipides   += macros.lipides;
    totaux.calories  += macros.calories;
    totaux.fibres    += macros.fibres ?? 0;
  });

  return {
    proteines : Math.round(totaux.proteines * 10) / 10,
    glucides  : Math.round(totaux.glucides  * 10) / 10,
    lipides   : Math.round(totaux.lipides   * 10) / 10,
    calories  : Math.round(totaux.calories),
    fibres    : Math.round(totaux.fibres    * 10) / 10,
  };
}


// ------------------------------------------------------------
//  ÉCARTS PAR RAPPORT AUX OBJECTIFS
//  Retourne la différence entre macros actuelles et cibles.
//  Positif = excès, négatif = manque.
// ------------------------------------------------------------
function calculerEcarts(macrosActuelles, macrosCibles) {
  return {
    proteines : Math.round((macrosActuelles.proteines - macrosCibles.proteines) * 10) / 10,
    glucides  : Math.round((macrosActuelles.glucides  - macrosCibles.glucides)  * 10) / 10,
    lipides   : Math.round((macrosActuelles.lipides   - macrosCibles.lipides)   * 10) / 10,
    calories  : Math.round( macrosActuelles.calories  - macrosCibles.calories),
    fibres    : Math.round(((macrosActuelles.fibres ?? 0) - (macrosCibles.fibres ?? 0)) * 10) / 10,
  };
}


// ------------------------------------------------------------
//  CONFORMITÉ D'UNE RECETTE
//  Compare les macros calculées aux objectifs du repas.
//  Retourne 'vert', 'orange' ou 'rouge' + un message.
// ------------------------------------------------------------
function evaluerConformite(macrosCalculees, objectifsCibles, tolerance = 3) {
  const ecarts = calculerEcarts(macrosCalculees, objectifsCibles);
  const problemes = [];

  if (Math.abs(ecarts.proteines) > tolerance) {
    problemes.push(`${ecarts.proteines > 0 ? '+' : ''}${ecarts.proteines}g protéines`);
  }
  if (Math.abs(ecarts.glucides) > tolerance) {
    problemes.push(`${ecarts.glucides > 0 ? '+' : ''}${ecarts.glucides}g glucides`);
  }
  if (Math.abs(ecarts.lipides) > tolerance) {
    problemes.push(`${ecarts.lipides > 0 ? '+' : ''}${ecarts.lipides}g lipides`);
  }

  if (problemes.length === 0) {
    return { statut: 'vert',   message: 'Conforme aux objectifs' };
  } else if (problemes.length === 1) {
    return { statut: 'orange', message: `Écart : ${problemes[0]}` };
  } else {
    return { statut: 'rouge',  message: `Écarts : ${problemes.join(', ')}` };
  }
}


// ------------------------------------------------------------
//  POURCENTAGE D'AVANCEMENT
//  Pour les barres de progression de l'écran d'accueil.
//  Plafonné à 100% pour ne pas dépasser la barre.
// ------------------------------------------------------------
function calculerPourcentage(valeurActuelle, valeurCible) {
  if (valeurCible === 0) return 0;
  const pct = (valeurActuelle / valeurCible) * 100;
  return Math.min(Math.round(pct), 100);
}


// ------------------------------------------------------------
//  MACROS PAR INGRÉDIENT (pour une quantité donnée)
//  Utile pour l'affichage détail d'une recette.
// ------------------------------------------------------------
function calculerMacrosIngredient(ingredient, quantiteEnGrammes) {
  const ratio = quantiteEnGrammes / 100;
  return {
    proteines : Math.round(ingredient.pour100g.proteines * ratio * 10) / 10,
    glucides  : Math.round(ingredient.pour100g.glucides  * ratio * 10) / 10,
    lipides   : Math.round(ingredient.pour100g.lipides   * ratio * 10) / 10,
    calories  : Math.round(ingredient.pour100g.calories  * ratio),
    fibres    : Math.round((ingredient.pour100g.fibres ?? 0) * ratio * 10) / 10,
  };
}


// ------------------------------------------------------------
//  FORMATAGE POUR L'AFFICHAGE
//  Transforme un objet macros en texte lisible.
//  Ex : { proteines: 26, glucides: 31, lipides: 15 }
//    → "26g P · 31g G · 15g L"
// ------------------------------------------------------------
function formaterMacros(macros) {
  return `${macros.proteines}g P · ${macros.glucides}g G · ${macros.lipides}g L · ${macros.fibres ?? 0}g F · ${macros.calories} kcal`;
}

function formaterMacrosCourt(macros) {
  return `${macros.proteines}g · ${macros.glucides}g · ${macros.lipides}g`;
}


// ------------------------------------------------------------
//  OPTIMISEUR DE RECETTE — 3 options classées par priorité
//
//  Toutes les options sont évaluées via un score de gap :
//    gap = |P - cibleP| + |G - cibleG| + |L - cibleL|
//  Une option n'est retenue que si elle RÉDUIT le gap.
// ------------------------------------------------------------

// Score de gap : somme des écarts absolus P / G / L
function _gapScore(macros, cibles) {
  return (
    Math.abs(macros.proteines - cibles.proteines) +
    Math.abs(macros.glucides  - cibles.glucides)  +
    Math.abs(macros.lipides   - cibles.lipides)
  );
}

// Score pondéré : la macro la plus déviée a un poids ×3.
// Garantit que les candidats qui corrigent l'écart dominant sont classés en premier.
function _gapScorePondere(macros, cibles, dominante) {
  return (
    Math.abs(macros.proteines - cibles.proteines) * (dominante === 'proteines' ? 3 : 1) +
    Math.abs(macros.glucides  - cibles.glucides)  * (dominante === 'glucides'  ? 3 : 1) +
    Math.abs(macros.lipides   - cibles.lipides)   * (dominante === 'lipides'   ? 3 : 1)
  );
}

// Retourne la macro dont l'écart absolu est le plus grand (ex: 'lipides')
function _dominantMacro(macros, cibles) {
  const ecarts = [
    { macro: 'proteines', val: Math.abs(macros.proteines - cibles.proteines) },
    { macro: 'glucides',  val: Math.abs(macros.glucides  - cibles.glucides)  },
    { macro: 'lipides',   val: Math.abs(macros.lipides   - cibles.lipides)   },
  ];
  return ecarts.sort((a, b) => b.val - a.val)[0].macro;
}

// Catégories adjacentes pour le fallback d'échange
const _CATS_ADJACENTES = {
  'Viandes, Oeufs & Poissons': ['Produits Laitiers'],
  'Céréales & Féculents':      ['Fruits & Légumes'],
  'Fruits & Légumes':          ['Céréales & Féculents', 'Produits Sucrés'],
  'Produits Laitiers':         ['Viandes, Oeufs & Poissons', 'Matières Grasses'],
  'Matières Grasses':          ['Produits Laitiers', 'Condiments & Épices'],
  'Condiments & Épices':       ['Matières Grasses'],
  'Produits Sucrés':           ['Fruits & Légumes'],
  'Boissons':                  [],
};

// Calcule les macros en remplaçant la contribution d'un ingrédient
// (évite de refaire calculerMacrosRecette() pour chaque test)
function _macrosAvecDelta(base, ingAncien, ingNouveau, quantite) {
  const ratio = quantite / 100;
  return {
    proteines: Math.round((base.proteines
      - ingAncien.pour100g.proteines * ratio
      + ingNouveau.pour100g.proteines * ratio) * 10) / 10,
    glucides: Math.round((base.glucides
      - ingAncien.pour100g.glucides * ratio
      + ingNouveau.pour100g.glucides * ratio) * 10) / 10,
    lipides: Math.round((base.lipides
      - ingAncien.pour100g.lipides * ratio
      + ingNouveau.pour100g.lipides * ratio) * 10) / 10,
    calories: Math.round(base.calories
      - ingAncien.pour100g.calories * ratio
      + ingNouveau.pour100g.calories * ratio),
  };
}

// ── Helpers : listes de tous les candidats triés par gapScore ──

function _candidatsAjustement(recette, macrosCibles, ingredients, _tol) {
  const macrosBase  = calculerMacrosRecette(recette, ingredients);
  const dominante   = _dominantMacro(macrosBase, macrosCibles);
  const gapBase     = _gapScorePondere(macrosBase, macrosCibles, dominante);
  const results     = [];

  recette.ingredients.forEach((ligne, idx) => {
    const ing = ingredients.find(i => i.id === ligne.ingredientId);
    if (!ing) return;
    const qBase = ligne.quantite;
    const qMin  = Math.max(10, Math.round(qBase * 0.50));
    const qMax  = Math.round(qBase * 1.50);
    const cb    = { p: ing.pour100g.proteines * qBase / 100, g: ing.pour100g.glucides * qBase / 100, l: ing.pour100g.lipides * qBase / 100 };
    let bestQty = -1, bestGap = gapBase;
    for (let q = qMin; q <= qMax; q += 5) {
      if (q === qBase) continue;
      const tm = {
        proteines: Math.round((macrosBase.proteines - cb.p + ing.pour100g.proteines * q / 100) * 10) / 10,
        glucides:  Math.round((macrosBase.glucides  - cb.g + ing.pour100g.glucides  * q / 100) * 10) / 10,
        lipides:   Math.round((macrosBase.lipides   - cb.l + ing.pour100g.lipides   * q / 100) * 10) / 10,
      };
      const g = _gapScorePondere(tm, macrosCibles, dominante);
      if (g < bestGap) { bestGap = g; bestQty = q; }
    }
    if (bestQty >= 0) results.push({ key: String(ligne.ingredientId), ligneIdx: idx, ingredientId: ligne.ingredientId, qty: bestQty, gapScore: _gapScore({ proteines: macrosBase.proteines - cb.p + ing.pour100g.proteines * bestQty / 100, glucides: macrosBase.glucides - cb.g + ing.pour100g.glucides * bestQty / 100, lipides: macrosBase.lipides - cb.l + ing.pour100g.lipides * bestQty / 100 }, macrosCibles), scorePondere: bestGap });
  });

  return results.sort((a, b) => a.scorePondere - b.scorePondere);
}

function _candidatsEchange(recette, macrosCibles, ingredients, _tol) {
  const macrosBase  = calculerMacrosRecette(recette, ingredients);
  const dominante   = _dominantMacro(macrosBase, macrosCibles);
  const gapBase     = _gapScorePondere(macrosBase, macrosCibles, dominante);
  const idsPresents = new Set(recette.ingredients.map(l => l.ingredientId));
  const seen        = new Set();
  const results     = [];

  for (const phase of [1, 2]) {
    recette.ingredients.forEach((ligne, idx) => {
      const ingA = ingredients.find(i => i.id === ligne.ingredientId);
      if (!ingA) return;
      const cats = phase === 1 ? [ingA.categorie] : (_CATS_ADJACENTES[ingA.categorie] || []);
      ingredients.forEach(cand => {
        if (idsPresents.has(cand.id)) return;
        if (!cats.includes(cand.categorie)) return;
        const key = ingA.id + '_' + cand.id;
        if (seen.has(key)) return;
        seen.add(key);
        const tm = _macrosAvecDelta(macrosBase, ingA, cand, ligne.quantite);
        const gP = _gapScorePondere(tm, macrosCibles, dominante);
        if (gP < gapBase) results.push({ key, ligneIdx: idx, ingAncienId: ingA.id, candidatId: cand.id, qty: ligne.quantite, gapScore: _gapScore(tm, macrosCibles), scorePondere: gP });
      });
    });
  }

  return results.sort((a, b) => a.scorePondere - b.scorePondere);
}

function _candidatsAjout(recette, macrosCibles, ingredients, tol) {
  const macrosBase  = calculerMacrosRecette(recette, ingredients);
  const ecarts      = calculerEcarts(macrosBase, macrosCibles);
  const idsPresents = new Set(recette.ingredients.map(l => l.ingredientId));
  const ingNeutre   = { pour100g: { proteines: 0, glucides: 0, lipides: 0, calories: 0 } };

  const deficits = [
    { macro: 'proteines', gap: -ecarts.proteines },
    { macro: 'glucides',  gap: -ecarts.glucides  },
    { macro: 'lipides',   gap: -ecarts.lipides   },
  ].filter(d => d.gap > tol).sort((a, b) => b.gap - a.gap);
  const cibleDef = deficits[0] || { macro: 'proteines', gap: 20 };

  const dominante = _dominantMacro(macrosBase, macrosCibles);
  const results = [];
  ingredients.forEach(ing => {
    if (idsPresents.has(ing.id)) return;
    const densite = ing.pour100g[cibleDef.macro] / 100;
    if (densite === 0) return;
    const qty = Math.max(20, Math.min(250, Math.round(cibleDef.gap / densite)));
    const tm  = _macrosAvecDelta(macrosBase, ingNeutre, ing, qty);
    const gP  = _gapScorePondere(tm, macrosCibles, dominante);
    if (gP < _gapScorePondere(macrosBase, macrosCibles, dominante))
      results.push({ key: String(ing.id), ingId: ing.id, qty, gapScore: _gapScore(tm, macrosCibles), scorePondere: gP });
  });

  return results.sort((a, b) => a.scorePondere - b.scorePondere);
}

// ── Helpers : construction du résultat à partir d'un candidat ──

function _appliquerCandidatAjustement(recette, macrosCibles, ingredients, tol, c) {
  const ra         = JSON.parse(JSON.stringify(recette));
  const ing        = ingredients.find(i => i.id === c.ingredientId);
  const av         = ra.ingredients[c.ligneIdx].quantite;
  const macrosBase = calculerMacrosRecette(recette, ingredients);
  ra.ingredients[c.ligneIdx].quantite = c.qty;
  const nm = calculerMacrosRecette(ra, ingredients);

  const impactMacros = {
    proteines: Math.round((nm.proteines - macrosBase.proteines) * 10) / 10,
    glucides:  Math.round((nm.glucides  - macrosBase.glucides)  * 10) / 10,
    lipides:   Math.round((nm.lipides   - macrosBase.lipides)   * 10) / 10,
  };

  const dom      = _dominantMacro(macrosBase, macrosCibles);
  const contrib  = ing ? Math.round(ing.pour100g[dom] * av / 100 * 10) / 10 : 0;
  const pctTotal = (ing && macrosBase[dom] > 0) ? Math.round(contrib / macrosBase[dom] * 100) : 0;
  const domNoms  = { proteines: 'protéines', glucides: 'glucides', lipides: 'lipides' };
  const raison   = (ing && contrib > 0)
    ? 'Source principale de ' + domNoms[dom] + ' (' + contrib + 'g, ' + pctTotal + '% du total)'
    : '';

  return { type: 'ajustement', label: 'Ajustement des quantités',
    modifications: [{ nom: ing ? ing.nom : '?', avant: av, apres: c.qty, statut: 'modifié', raison }],
    impactMacros,
    recetteAjustee: ra, nouvellesMacros: nm,
    conformite: evaluerConformite(nm, macrosCibles, tol),
    gapScore: c.gapScore, valid: true, key: c.key };
}

function _appliquerCandidatEchange(recette, macrosCibles, ingredients, tol, c) {
  const ra         = JSON.parse(JSON.stringify(recette));
  const ingA       = ingredients.find(i => i.id === c.ingAncienId);
  const cand       = ingredients.find(i => i.id === c.candidatId);
  const macrosBase = calculerMacrosRecette(recette, ingredients);
  ra.ingredients[c.ligneIdx].ingredientId = c.candidatId;
  const nm = calculerMacrosRecette(ra, ingredients);

  const impactMacros = {
    proteines: Math.round((nm.proteines - macrosBase.proteines) * 10) / 10,
    glucides:  Math.round((nm.glucides  - macrosBase.glucides)  * 10) / 10,
    lipides:   Math.round((nm.lipides   - macrosBase.lipides)   * 10) / 10,
  };

  return { type: 'echange', label: "Échange d'ingrédient",
    modifications: [{ nom: (ingA ? ingA.nom : '?') + ' → ' + (cand ? cand.nom : '?'), avant: c.qty, apres: c.qty, statut: 'échangé',
      ancienNom: ingA ? ingA.nom : '?', nouveauNom: cand ? cand.nom : '?' }],
    impactMacros,
    recetteAjustee: ra, nouvellesMacros: nm,
    conformite: evaluerConformite(nm, macrosCibles, tol),
    gapScore: c.gapScore, valid: true, key: c.key };
}

// ── Suppression d'ingrédient optionnel (condiments, matières grasses, petites quantités) ──

function _candidatsSuppression(recette, macrosCibles, ingredients) {
  const macrosBase = calculerMacrosRecette(recette, ingredients);
  const dominante  = _dominantMacro(macrosBase, macrosCibles);
  const gapBase    = _gapScorePondere(macrosBase, macrosCibles, dominante);
  const ingNeutre  = { pour100g: { proteines: 0, glucides: 0, lipides: 0, calories: 0 } };
  const results    = [];

  recette.ingredients.forEach((ligne, idx) => {
    const ing = ingredients.find(i => i.id === ligne.ingredientId);
    if (!ing) return;
    const optional = ing.categorie === 'Condiments & Épices' ||
                     ing.categorie === 'Matières Grasses'    ||
                     ligne.quantite <= 30;
    if (!optional) return;
    const tm = _macrosAvecDelta(macrosBase, ing, ingNeutre, ligne.quantite);
    const gP = _gapScorePondere(tm, macrosCibles, dominante);
    if (gP < gapBase) results.push({ key: String(ing.id), ligneIdx: idx, ingredientId: ing.id, qty: 0, gapScore: _gapScore(tm, macrosCibles), scorePondere: gP });
  });

  return results.sort((a, b) => a.scorePondere - b.scorePondere);
}

function _appliquerCandidatSuppression(recette, macrosCibles, ingredients, tol, c) {
  const ra         = JSON.parse(JSON.stringify(recette));
  const ing        = ingredients.find(i => i.id === c.ingredientId);
  const av         = ra.ingredients[c.ligneIdx].quantite;
  const macrosBase = calculerMacrosRecette(recette, ingredients);
  ra.ingredients.splice(c.ligneIdx, 1);
  const nm = calculerMacrosRecette(ra, ingredients);

  const impactMacros = {
    proteines: Math.round((nm.proteines - macrosBase.proteines) * 10) / 10,
    glucides:  Math.round((nm.glucides  - macrosBase.glucides)  * 10) / 10,
    lipides:   Math.round((nm.lipides   - macrosBase.lipides)   * 10) / 10,
  };

  return { type: 'suppression', label: "Suppression d'ingrédient",
    modifications: [{ nom: ing ? ing.nom : '?', avant: av, apres: 0, statut: 'supprimé' }],
    impactMacros,
    recetteAjustee: ra, nouvellesMacros: nm,
    conformite: evaluerConformite(nm, macrosCibles, tol),
    gapScore: c.gapScore, valid: true, key: c.key };
}

function _optionEpuisee(type, recette, macrosCibles, ingredients, tol) {
  const labels = {
    ajustement:  'Ajustement des quantités',
    echange:     "Échange d'ingrédient",
    suppression: "Suppression d'ingrédient",
  };
  const nm = calculerMacrosRecette(recette, ingredients);
  return { type, label: labels[type] || type, modifications: [],
    recetteAjustee: JSON.parse(JSON.stringify(recette)),
    nouvellesMacros: nm, conformite: evaluerConformite(nm, macrosCibles, tol),
    impactMacros: { proteines: 0, glucides: 0, lipides: 0 },
    gapScore: _gapScore(nm, macrosCibles), valid: false, exhausted: true, key: null };
}

// ── Point d'entrée principal ──
// excludedKeys : { ajustement: Set<key>, echange: Set<key>, suppression: Set<key> }
// (omit or pass empty sets for initial load)
function genererOptions(recette, macrosCibles, ingredients, tolerance, excludedKeys) {
  const tol  = tolerance ?? 3;
  const excl = excludedKeys || { ajustement: new Set(), echange: new Set(), suppression: new Set() };

  function pick(type, candidats, appliquer) {
    const c = candidats.find(x => !excl[type].has(x.key));
    return c ? appliquer(c) : _optionEpuisee(type, recette, macrosCibles, ingredients, tol);
  }

  const cA  = _candidatsAjustement(recette, macrosCibles, ingredients, tol);
  const cE  = _candidatsEchange(recette, macrosCibles, ingredients, tol);
  const cS  = _candidatsSuppression(recette, macrosCibles, ingredients);

  return [
    pick('ajustement',  cA, c => _appliquerCandidatAjustement(recette, macrosCibles, ingredients, tol, c)),
    pick('echange',     cE, c => _appliquerCandidatEchange(recette, macrosCibles, ingredients, tol, c)),
    pick('suppression', cS, c => _appliquerCandidatSuppression(recette, macrosCibles, ingredients, tol, c)),
  ];
}

// Rétrocompatibilité
function optimiserRecette(recette, macrosCibles, ingredients) {
  return genererOptions(recette, macrosCibles, ingredients, 3)[0];
}