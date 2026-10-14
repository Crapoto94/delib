const { createTitulaires } = require('../../src/modules/titulaires/titulaires.service');

// Un service sans chef de service désigné (BF1, XX1, « DSI »…) : le directeur de la direction tient le rôle.
describe('chef de service par défaut : le directeur', () => {
  const tit = createTitulaires({ db: null, audit: null, access: null });
  const data = (rows = []) => ({ rows, postes: new Map(), rts: new Map() });
  const row = (fonction, perimetre, over = {}) => ({ fonction, perimetre, direction_code: 'BF', service_code: null, username: 'x', suppleant: null, vacant: false, ...over });
  const dir = row('directeur', 'direction', { username: 'machevalier' });

  it('service BF1 / XX1 / DSI sans chef désigné : le directeur de la direction', () => {
    const d = data([dir, row('chef_service', 'service', { service_code: 'BF6', username: 'dgaultier' })]);
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'BF', serviceCode: 'BF1' })).toMatchObject({ holders: ['machevalier'], vacant: false, via: 'directeur' });
    const xx = data([row('directeur', 'direction', { direction_code: 'XX', username: 'dirxx' })]);
    expect(tit.resolveIn(xx, 'chef_service', { directionCode: 'XX', serviceCode: 'XX1' })).toMatchObject({ holders: ['dirxx'], via: 'directeur' });
  });

  it('un chef désigné l\'emporte ; un poste de chef déclaré vacant reste vacant (étape contournée)', () => {
    const d = data([dir, row('chef_service', 'service', { service_code: 'BF6', username: 'dgaultier' }), row('chef_service', 'service', { service_code: 'BF7', username: null, vacant: true })]);
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'BF', serviceCode: 'BF6' })).toMatchObject({ holders: ['dgaultier'], via: null });
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'BF', serviceCode: 'BF7' })).toMatchObject({ holders: [], vacant: true });
  });

  it('directeur absent : toujours « non renseigné » ; directeur vacant : l\'étape est contournée', () => {
    expect(tit.resolveIn(data(), 'chef_service', { directionCode: 'BF', serviceCode: 'BF1' })).toMatchObject({ holders: [], vacant: false });
    const vac = data([row('directeur', 'direction', { username: null, vacant: true })]);
    expect(tit.resolveIn(vac, 'chef_service', { directionCode: 'BF', serviceCode: 'BF1' })).toMatchObject({ vacant: true });
  });

  it('un service de la direction ne prend pas le directeur d\'une autre direction', () => {
    const d = data([dir]);
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'XX', serviceCode: 'XX1' })).toMatchObject({ holders: [] });
  });
});

describe('services dont le code se termine par 1', () => {
  const tit = createTitulaires({ db: null, audit: null, access: null });
  const row = (fonction, perimetre, over = {}) => ({ fonction, perimetre, direction_code: 'BF', service_code: null, username: 'x', suppleant: null, vacant: false, ...over });
  const d = { rows: [row('directeur', 'direction', { username: 'machevalier' }), row('chef_service', 'service', { service_code: 'BF1', username: 'quelquun' }), row('chef_service', 'service', { service_code: 'BF8', username: 'fbouatou' })], postes: new Map(), rts: new Map() };

  it('BF1, XX1 : toujours le directeur, même si un chef y est saisi ; BF8 garde son chef', () => {
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'BF', serviceCode: 'BF1' })).toMatchObject({ holders: ['machevalier'], via: 'directeur' });
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'BF', serviceCode: 'XX1' })).toMatchObject({ holders: ['machevalier'], via: 'directeur' });
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'BF', serviceCode: 'BF8' })).toMatchObject({ holders: ['fbouatou'], via: null });
    expect(tit.resolveIn(d, 'chef_service', { directionCode: 'BF', serviceCode: 'hist:11' })).toMatchObject({ holders: ['machevalier'] });
  });
});
