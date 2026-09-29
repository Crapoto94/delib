/**
 * Catalogue des tiers de télétransmission (TDT) au contrôle de légalité (TLT-30, D88).
 * L'organisme choisit son fournisseur (défaut : S²LOW) ; chaque fournisseur déclare ses modes, ses champs de connexion et son état
 * d'avancement. Un nouveau fournisseur = une entrée ici + un adaptateur qui respecte le même port que `s2low-simulateur.js`
 * (creer, confirmer, statut, documentsPrefecture, marquerLu, repondre, annuler, bordereau, tampon, classification, testConnexion).
 */
const CHAMPS_STANDARD = [
  { code: 'url', label: 'Adresse du serveur', type: 'url', placeholder: 'https://…' },
  { code: 'utilisateur', label: 'Identifiant technique', type: 'text' },
  { code: 'motDePasse', label: 'Mot de passe', type: 'password' },
];

const FOURNISSEURS = {
  s2low: {
    code: 's2low', nom: 'S²LOW', editeur: 'ADULLACT', defaut: true,
    description: "Tiers de télétransmission open source (module ACTES), très répandu dans les collectivités.",
    modes: { simulation: true, test: true, production: true },
    champs: CHAMPS_STANDARD,
    note: "Les modes « test » et « production » dialoguent avec une instance S²LOW réelle, authentifiée par CERTIFICAT CLIENT P12 (identifiant technique et mot de passe facultatifs). En « test », les actes partent sur l'instance de test ; en « production », ils sont transmis à la préfecture.",
  },
  fast: {
    code: 'fast', nom: 'FAST-Actes', editeur: 'Docaposte',
    description: 'Tiers de télétransmission commercial (Docaposte FAST). Connecteur prévu, pas encore développé.',
    modes: { simulation: false, test: false, production: false },
    champs: CHAMPS_STANDARD,
    note: "Connecteur à développer : sélectionnable dès qu'il sera livré. Le choix reste aujourd'hui sur S²LOW.",
  },
};

const disponible = (f) => Object.values(f.modes).some(Boolean);
const liste = () => Object.values(FOURNISSEURS).map((f) => ({ ...f, disponible: disponible(f) }));

module.exports = { FOURNISSEURS, liste, disponible };
