const G = require('../../src/modules/circuit/graph');
const { IVRY_STANDARD, SIMPLE } = require('../../src/modules/circuit/templates');

const clone = (o) => JSON.parse(JSON.stringify(o));
const codes = (r) => r.errors.map((e) => e.code);

describe('conditions', () => {
  const facts = { incidenceFinanciere: true, montant: 60000, typeCode: 'deliberation', urgence: false, custom: { zone: 'nord' } };
  it('évalue les opérateurs et les combinaisons', () => {
    expect(G.evalCondition({ field: 'incidenceFinanciere', op: 'eq', value: true }, facts)).toBe(true);
    expect(G.evalCondition({ field: 'montant', op: 'gt', value: 50000 }, facts)).toBe(true);
    expect(G.evalCondition({ field: 'montant', op: 'lte', value: 1000 }, facts)).toBe(false);
    expect(G.evalCondition({ field: 'typeCode', op: 'in', value: ['voeu', 'deliberation'] }, facts)).toBe(true);
    expect(G.evalCondition({ field: 'custom.zone', op: 'eq', value: 'nord' }, facts)).toBe(true);
    expect(G.evalCondition({ and: [{ field: 'urgence', op: 'eq', value: false }, { not: { field: 'montant', op: 'lt', value: 10 } }] }, facts)).toBe(true);
    expect(G.evalCondition({ or: [{ field: 'urgence', op: 'eq', value: true }, { field: 'montant', op: 'gte', value: 100000 }] }, facts)).toBe(false);
    expect(G.evalCondition(undefined, facts)).toBe(true);
  });
  it('traite les valeurs absentes sans planter (montant null n\'est jamais > seuil)', () => {
    const f = { incidenceFinanciere: null, montant: null };
    expect(G.evalCondition({ field: 'incidenceFinanciere', op: 'eq', value: true }, f)).toBe(false);
    expect(G.evalCondition({ field: 'montant', op: 'gt', value: 0 }, f)).toBe(false);
    expect(G.evalCondition({ field: 'montant', op: 'empty' }, f)).toBe(true);
    expect(G.evalCondition({ field: 'montant', op: 'notEmpty' }, f)).toBe(false);
    expect(G.evalCondition({ field: 'x', op: 'bizarre' }, f)).toBe(false);
  });
});

describe('validation du graphe (CIR-61)', () => {
  it('accepte les deux modèles fournis', () => {
    expect(G.validateGraph(IVRY_STANDARD).ok).toBe(true);
    expect(G.validateGraph(SIMPLE).ok).toBe(true);
    expect(G.validateGraph(IVRY_STANDARD, { groupCodes: new Set(['financier', 'juridique', 'scc']) }).ok).toBe(true);
  });
  it('signale un groupe inconnu de l\'organisme', () => {
    const r = G.validateGraph(IVRY_STANDARD, { groupCodes: new Set(['scc']) });
    expect(codes(r)).toEqual(expect.arrayContaining(['groupe_inconnu']));
  });
  it('refuse une étape inatteignable, une impasse conditionnelle, une boucle et un départ inconnu', () => {
    const g = clone(SIMPLE); g.steps.push({ key: 'orpheline', label: 'Orpheline', resolver: { kind: 'redacteur' } });
    expect(codes(G.validateGraph(g))).toContain('etape_inatteignable');

    const c = clone(IVRY_STANDARD); c.transitions = c.transitions.filter((t) => !t.otherwise);
    expect(codes(G.validateGraph(c))).toContain('sortie_par_defaut');

    const l = clone(SIMPLE); l.transitions.push({ from: 'scc', to: 'chef_service' });
    expect(codes(G.validateGraph(l))).toEqual(expect.arrayContaining(['boucle', 'aucune_sortie']));

    const d = clone(SIMPLE); d.start = 'inconnu';
    expect(codes(G.validateGraph(d))).toContain('depart_invalide');
  });
  it('refuse clés, libellés, résolveurs, modes et conditions invalides', () => {
    const g = clone(SIMPLE);
    g.steps[1].key = 'Chef Service'; g.steps[2].label = ''; g.steps[3].resolver = { kind: 'titulaire', fonction: 'roi' };
    g.transitions[0].to = 'chef_service';
    const r = G.validateGraph(g);
    expect(codes(r)).toEqual(expect.arrayContaining(['cle_invalide', 'libelle_manquant']));
    const h = clone(SIMPLE); h.steps[1].resolver = { kind: 'titulaire', fonction: 'roi' }; h.steps[2].mode = 'majorité'; h.steps[3].slaDays = -2;
    expect(codes(G.validateGraph(h))).toEqual(expect.arrayContaining(['resolveur_fonction', 'mode_invalide', 'sla_invalide']));
    const k = clone(SIMPLE); k.transitions[1].when = { field: 'couleur', op: 'eq', value: 1 }; k.transitions[2].when = { field: 'montant', op: 'presque' };
    expect(codes(G.validateGraph(k))).toEqual(expect.arrayContaining(['condition_champ', 'condition_operateur']));
    const dup = clone(SIMPLE); dup.steps.push({ ...dup.steps[1] });
    expect(codes(G.validateGraph(dup))).toContain('cle_dupliquee');
    expect(codes(G.validateGraph({ steps: 'x' }))).toEqual(['structure']);
    const q = clone(SIMPLE); q.steps[1].mode = 'quorum';
    expect(codes(G.validateGraph(q))).toContain('quorum_invalide');
  });
  it('signale les transitions ambiguës (when + otherwise)', () => {
    const g = clone(IVRY_STANDARD); g.transitions.find((t) => t.otherwise).when = { field: 'montant', op: 'gt', value: 1 };
    expect(codes(G.validateGraph(g))).toContain('transition_ambigue');
  });
});

describe('parcours (CIR-15, CIR-62)', () => {
  const resolve = async (s) => ({ holders: [`h_${s.key}`] });
  const keys = (p) => p.map((x) => x.key);
  it('passe par le service financier si l\'incidence financière est vraie', async () => {
    const p = await G.projectPath(IVRY_STANDARD, { incidenceFinanciere: true }, resolve);
    expect(keys(p)).toEqual(['redaction', 'resp_intermediaire', 'chef_service', 'directeur', 'financier', 'juridique', 'dga', 'dgs', 'scc']);
  });
  it('va directement au juridique sinon (faux ou non renseigné)', async () => {
    expect(keys(await G.projectPath(IVRY_STANDARD, { incidenceFinanciere: false }, resolve))).not.toContain('financier');
    expect(keys(await G.projectPath(IVRY_STANDARD, { incidenceFinanciere: null }, resolve))).not.toContain('financier');
  });
  it('sait reprendre à partir d\'une étape et sauter des étapes', async () => {
    const p = await G.projectPath(IVRY_STANDARD, { incidenceFinanciere: true }, resolve, { fromKey: 'juridique' });
    expect(keys(p)).toEqual(['juridique', 'dga', 'dgs', 'scc']);
    const s = await G.projectPath(IVRY_STANDARD, { incidenceFinanciere: false }, resolve, { skipKeys: new Set(['dga']) });
    expect(s.find((x) => x.key === 'dga')).toMatchObject({ skipped: true, holders: [] });
  });
  it('utilise la première transition vraie, puis « otherwise »', () => {
    const g = clone(IVRY_STANDARD);
    g.transitions.unshift({ from: 'directeur', to: 'dga', when: { field: 'montant', op: 'lt', value: 100 } });
    expect(G.nextKey(g, 'directeur', { montant: 50, incidenceFinanciere: true })).toBe('dga');
    expect(G.nextKey(g, 'directeur', { montant: 500, incidenceFinanciere: true })).toBe('financier');
    expect(G.nextKey(g, 'directeur', { montant: 500, incidenceFinanciere: false })).toBe('juridique');
    expect(G.nextKey(g, 'scc', {})).toBeNull();
  });
});
