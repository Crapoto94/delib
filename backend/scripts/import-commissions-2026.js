/**
 * Import de la composition des commissions municipales (juin 2026), depuis le fichier fourni par la Ville :
 * « 20260611_V2Répartition commissions municipales.xlsx » (co-présidences + membres, par commission). Les deux
 * co-président·e·s de chaque commission sont importé·e·s avec la fonction « president » (une commission peut avoir
 * plusieurs président·e·s, cf. commissions.service.js) ; le fichier ne distingue pas de vice-président·e.
 *
 * Les noms sont recopiés tels quels du fichier et rapprochés des élu·e·s déjà en base (Hub) par prénom + nom, en
 * ignorant accents/casse/tirets. Trois orthographes diffèrent entre le fichier et le Hub (voir ALIAS ci-dessous),
 * vérifiées à la main.
 *
 *   node scripts/import-commissions-2026.js              simulation : montre les rapprochements, ne modifie rien
 *   node scripts/import-commissions-2026.js --appliquer   applique (remplace la liste des membres des 4 commissions)
 *
 * Remplacer la liste des membres d'une commission n'affecte qu'elle : sans danger à relancer.
 */
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });
const { loadConfig } = require('../src/config');
const { createLogger } = require('../src/shared/logger');
const { createDb } = require('../src/db/pool');
const { createAudit } = require('../src/modules/audit/audit.service');

// Source : feuille « Feuil1 » du classeur, une colonne par commission (nom sans « La » en tête).
const DONNEES = [
  {
    commission: 'Ville solidaire',
    presidents: ['Malika Zediri', 'Estelle Boufala'],
    membres: ['Abdelhalim Saad', 'Audrey Médeville', 'Guillaume Spiro', 'Francine Colson', 'Jubaïd Ahamed',
      'Sébastien Pralin', 'Kiruthithga Santhalingam', 'Farida Hanaizi', 'Valentin Aubry', 'Rebecca Deprez'],
  },
  {
    commission: 'Ville qui débat',
    presidents: ['Sébastien Scarpinato', 'Sarah Zidelkhile'],
    membres: ['Simon Veissière', 'Ouarda Kirouane', 'Célia Riffaud', 'Léo Janis Tournier', 'Nourdine Khaled',
      'Clément Pecqueux', 'Jean-François Claudon', 'Sarah Ouisti', 'Sarah Lalaaj', 'Kévin Nader', 'Ricka Rarivoson'],
  },
  {
    commission: 'Ville qui émancipe',
    presidents: ['Fenda Diarra', 'Maryse Dorra'],
    membres: ['Alexandra Mortet', 'Fabienne Oudart', 'Claire Milleville', 'Karim Mastouri', 'Djeneba Sangare',
      'Bertrand Quinet', 'Guillaume Ruchaud', 'Catherine Quingué', 'Hocine Hallaf'],
  },
  {
    commission: 'Ville en transition',
    presidents: ['Méhadée Bernard', 'Vincent Garreau'],
    membres: ['Louis Maziere', 'Thomas Miele', 'Théophile Bornet', 'Philippe Malheiro', 'Philippe Bouyssou',
      'Kheira Freih-Bengabou', 'Mounia Chouaf', 'Ayoub Ragbi', 'Bertrand Simonin-Lacroix', 'Laurent Monfret', 'Rodrigue Lohier'],
  },
];

// Orthographe du fichier -> fiche exacte (prénom, nom) dans le Hub, quand elles diffèrent.
const ALIAS = {
  'Kiruthithga Santhalingam': { prenom: 'Kiruththiga', nom: 'SANTHALINGAM' },
  'Sarah Zidelkhile': { prenom: 'Sahra', nom: 'ZIDELKHILE' },
  'Sarah Lalaaj': { prenom: 'Sarah', nom: 'LAALAJ' },
};

const normalise = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-']/g, ' ').replace(/\s+/g, ' ').trim();

async function main() {
  const appliquer = process.argv.includes('--appliquer');
  const config = loadConfig();
  const log = createLogger('warn');
  const db = createDb(config, log);
  const audit = createAudit(db);
  const ctx = { username: 'import-commissions-2026' };

  try {
    const org = await db.get('SELECT id, nom FROM organismes WHERE is_default LIMIT 1');
    if (!org) throw new Error('Aucun organisme par défaut trouvé');
    const elus = await db.all('SELECT id, nom, prenom FROM elus WHERE organisme_id = $1 AND actif', [org.id]);

    const trouverElu = (nomComplet) => {
      const alias = ALIAS[nomComplet];
      if (alias) {
        const e = elus.find((x) => normalise(x.nom) === normalise(alias.nom) && normalise(x.prenom) === normalise(alias.prenom));
        if (e) return e;
      }
      const cible = normalise(nomComplet);
      return elus.find((x) => normalise(`${x.prenom} ${x.nom}`) === cible) || null;
    };

    let totalOk = 0; let totalManquants = 0;
    for (const c of DONNEES) {
      const commission = await db.get('SELECT id, nom FROM commissions WHERE organisme_id = $1 AND nom ILIKE $2', [org.id, `%${c.commission}`]);
      if (!commission) { console.log(`KO — commission introuvable : « ${c.commission} »`); totalManquants++; continue; }

      const membres = []; const manquants = [];
      for (const nomComplet of c.presidents) { const e = trouverElu(nomComplet); if (e) membres.push({ eluId: e.id, nomComplet, fonction: 'president' }); else manquants.push(nomComplet); }
      for (const nomComplet of c.membres) { const e = trouverElu(nomComplet); if (e) membres.push({ eluId: e.id, nomComplet, fonction: 'membre' }); else manquants.push(nomComplet); }

      console.log(`\n${commission.nom} (#${commission.id}) — ${membres.length} rapproché(s), ${manquants.length} introuvable(s)`);
      for (const m of membres) console.log(`  OK ${m.fonction === 'president' ? 'président·e' : 'membre    '} — ${m.nomComplet}`);
      for (const nomComplet of manquants) console.log(`  ?  introuvable dans le Hub — ${nomComplet}`);
      totalOk += membres.length; totalManquants += manquants.length;

      if (appliquer && membres.length) {
        await db.tx(async (q) => {
          await q.run('DELETE FROM commission_membres WHERE commission_id = $1', [commission.id]);
          for (const m of membres) await q.run('INSERT INTO commission_membres (commission_id, elu_id, fonction) VALUES ($1,$2,$3)', [commission.id, m.eluId, m.fonction]);
        });
        await audit.log(ctx, { organismeId: org.id, action: 'commission.membres', entity: 'commissions', entityId: commission.id, after: { source: '20260611_V2Répartition commissions municipales.xlsx', membres: membres.length } });
      }
    }
    console.log(`\n${totalOk} rapprochement(s), ${totalManquants} introuvable(s) au total.`);
    console.log(appliquer ? 'Import appliqué.' : 'Simulation : rien n’a été modifié (relancez avec --appliquer pour écrire en base).');
  } finally {
    await db.close();
  }
}

main().catch((e) => { console.error('ERREUR', e.message); process.exit(1); });
