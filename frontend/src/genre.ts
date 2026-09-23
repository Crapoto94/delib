/**
 * Écriture inclusive des fonctions d'élu (bloc « élu rapporteur »).
 * Le sexe vient du Hub DSI (civilité « M. » / « Mme ») ; à défaut seulement, il est déduit du prénom
 * (comme dans les documents, voir `backend/src/modules/render/render.service.js`).
 * Les fonctions déjà au féminin ou épicènes sont laissées telles quelles.
 */
const FEMININ = new Set([
  'mehadee', 'fenda', 'kheira', 'martine', 'nadia', 'sarah', 'amelie', 'emilie', 'julie', 'marie', 'sophie', 'claire',
  'celine', 'caroline', 'charlotte', 'delphine', 'elodie', 'florence', 'helene', 'isabelle', 'laetitia', 'laure',
  'lucie', 'mélanie', 'melanie', 'nathalie', 'sandrine', 'stephanie', 'stéphanie', 'valerie', 'valérie', 'vanessa',
  'veronique', 'véronique', 'virginie', 'aurelie', 'aurélie', 'camille', 'céline', 'claudine', 'corinne', 'fabienne',
  'genevieve', 'geneviève', 'hélène', 'ingrid', 'jacqueline', 'josette', 'karen', 'linda', 'malika', 'myriam',
]);
const MASCULIN = new Set([
  'pierre', 'philippe', 'jean', 'paul', 'jacques', 'michel', 'andre', 'andré', 'luc', 'marc', 'thierry', 'pascal',
  'olivier', 'laurent', 'david', 'patrick', 'eric', 'éric', 'frédéric', 'frederic', 'stephane', 'stéphane', 'vincent',
  'christophe', 'sebastien', 'sébastien', 'guillaume', 'antoine', 'julien', 'nicolas', 'alexandre', 'benoit', 'benoît',
  'hugo', 'lucas', 'thomas', 'maxime', 'cedric', 'cédric', 'fabrice', 'gregory', 'grégory', 'jerome', 'jérôme',
]);

const sansAccent = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/** Genre déduit du prénom (repli quand le Hub n'a pas fourni la civilité) : masculin par défaut. */
export function prenomFeminin(prenom?: string | null): boolean {
  const p = sansAccent(prenom || '');
  if (!p) return false;
  if (FEMININ.has(p)) return true;
  if (MASCULIN.has(p)) return false;
  return /(?:a|ie|ine|ette|elle|enne|yne|ise|ande|ude)$/.test(p);
}

const CIV_FEMININ = /^(mme|mlle|mle|f|femme|madame)/i;
const CIV_MASCULIN = /^(m\.?|mr|monsieur|homme)/i;

/** Sexe de l'élu : civilité du Hub DSI (« Mme » → féminin) ; à défaut, déduit du prénom. */
export function estFeminin(civilite?: string | null, prenom?: string | null): boolean {
  const c = String(civilite || '').trim();
  if (c) { if (CIV_FEMININ.test(c)) return true; if (CIV_MASCULIN.test(c)) return false; }
  return prenomFeminin(prenom);
}

/** Accorde une fonction d'élu au féminin (Adjoint → Adjointe, Conseiller municipal → Conseillère municipale). */
function feminiser(role: string): string {
  return role
    .replace(/\bVice-président(?![a-zà-ÿ])/g, 'Vice-présidente')
    .replace(/\bPrésident(?![a-zà-ÿ])/g, 'Présidente')
    .replace(/\bAdjoint(?![a-zà-ÿ])/g, 'Adjointe')
    .replace(/\bConseiller(?![a-zà-ÿ])/g, 'Conseillère')
    .replace(/\bmunicipal(?![a-zà-ÿ])/g, 'municipale')
    .replace(/\bdépartemental(?![a-zà-ÿ])/g, 'départementale')
    .replace(/\brégional(?![a-zà-ÿ])/g, 'régionale')
    .replace(/\bmétropolitain(?![a-zà-ÿ])/g, 'métropolitaine');
}

/** Fonction affichée à l'écriture inclusive : au féminin pour une élue, inchangée sinon. */
export function roleInclusif(role?: string | null, prenom?: string | null, civilite?: string | null): string {
  if (!role) return '';
  return estFeminin(civilite, prenom) ? feminiser(role) : role;
}
