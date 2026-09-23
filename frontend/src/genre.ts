/**
 * Écriture inclusive des fonctions d'élu (bloc « élu rapporteur »).
 * Les élus n'ont pas de champ « genre » : il est déduit du prénom, comme dans les documents
 * (voir `backend/src/modules/render/render.service.js`). Les fonctions déjà au féminin ou épicènes
 * sont laissées telles quelles.
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

/** Genre déduit du prénom (les élus n'ont pas de champ « genre ») : masculin par défaut. */
export function prenomFeminin(prenom?: string | null): boolean {
  const p = sansAccent(prenom || '');
  if (!p) return false;
  if (FEMININ.has(p)) return true;
  if (MASCULIN.has(p)) return false;
  return /(?:a|ie|ine|ette|elle|enne|yne|ise|ande|ude)$/.test(p);
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

/** Fonction affichée à l'écriture inclusive : au féminin pour un prénom féminin, inchangée sinon. */
export function roleInclusif(role?: string | null, prenom?: string | null): string {
  if (!role) return '';
  return prenomFeminin(prenom) ? feminiser(role) : role;
}
