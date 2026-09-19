/**
 * Tutoriels de première connexion (UX-20 à UX-26). Le backend ne connaît que l'identité et la VERSION de chaque
 * tutoriel et l'avancement de chaque utilisateur ; le contenu et la mise en scène sont côté frontend (Stitch).
 * Augmenter `version` d'un tutoriel le repropose à tous (« Nouveautés »).
 */
const TOURS = [
  { id: 'first-login', version: 1, label: 'Visite guidée de la première connexion' },
];

module.exports = { TOURS, tourById: (id) => TOURS.find((t) => t.id === id) };
