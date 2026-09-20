/**
 * Organisation des responsables (D66 à D68, D70) : on part de l'ORGANISATION — DGS, postes de DGA, directions, services — et on
 * regarde, rôle par rôle, qui valide. Chaque rôle est soit tenu par quelqu'un, soit VACANT (déclaré, ou vacant dans l'organigramme RH),
 * soit implicite (service qui porte le nom de sa direction : le responsable est le directeur ; direction rattachée directement à la DGS :
 * pas de DGA), soit NON RENSEIGNÉ — et c'est ce dernier cas qu'il faut traiter, car le circuit serait alors bloqué.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');

const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();

function createOrganisation({ db, titulaires, dir }) {
  /** Directions qui relèvent de l'organisme : celles qui lui sont rattachées, ou — pour la collectivité par défaut — celles qui ne le sont à aucune autre. */
  async function directionsOf(org, chart) {
    const o = await db.get('SELECT is_default FROM organismes WHERE id = $1', [org]);
    const att = await db.all('SELECT direction_code, organisme_id FROM organisme_directions');
    const mine = new Set(att.filter((r) => r.organisme_id === org).map((r) => r.direction_code));
    const others = new Set(att.filter((r) => r.organisme_id !== org).map((r) => r.direction_code));
    return chart.filter((d) => (o?.is_default ? !others.has(d.code) : mine.has(d.code)));
  }

  return {
    /** Vue d'ensemble : chaque direction et chaque service avec ses rôles, leur état, et les postes à renseigner. */
    async view(organismeId) {
      const org = requireOrg(organismeId);
      const [data, chartAll, postes] = await Promise.all([titulaires.loadResolution(org), dir.organisationChart(), titulaires.postes(org)]);
      const chart = await directionsOf(org, chartAll);
      const nodes = new Map(chartAll.map((d) => [d.code, d]));
      const rhv = (d, s) => { const n = nodes.get(d); const sn = s ? (n?.services || []).find((x) => x.code === s) : null; return { direction: !!n?.vacant, service: !!sn?.vacant }; };
      const rows = (fonction, directionCode, serviceCode) => data.rows.filter((r) => r.fonction === fonction && (fonction === 'dgs' ? true : (serviceCode ? r.service_code === serviceCode : r.direction_code === directionCode && !r.service_code)))
        .map((r) => ({ id: r.id, username: r.username, suppleant: r.suppleant, vacant: r.vacant }));
      const role = (fonction, scope, rh = null) => {
        const r = titulaires.resolveIn(data, fonction, scope, rhv);
        const statut = r.direct === 'dgs' ? 'direct_dgs' : r.vacant ? 'vacant' : r.holders.length ? (r.via === 'directeur' ? 'implicite' : 'personne') : 'non_renseigne';
        return { fonction, statut, holders: r.holders, via: r.via, poste: r.poste, titulaires: fonction === 'dga' ? [] : rows(fonction, scope.directionCode, scope.serviceCode), rh };
      };
      // « MERIEM KHAROUM » -> « Meriem KHAROUM » (l'annuaire RH écrit « PRÉNOM NOM » en capitales)
      const nomComplet = (x) => { const [p1, ...r] = String(x || '').trim().split(/\s+/); return r.length ? `${p1.toLowerCase().replace(/(^|-)(\p{L})/gu, (m, a1, b1) => a1 + b1.toUpperCase())} ${r.join(' ').toUpperCase()}` : (x || null); };
      const rhOf = (n) => (n ? { responsable: n.responsable ? nomComplet(n.responsable) : null, poste: n.poste || null, vacant: !!n.vacant } : null);
      const directions = chart.map((d) => {
        const rt = data.rts.get(d.code);
        const poste = rt?.dga_poste_id ? postes.find((p) => p.id === rt.dga_poste_id) : null;
        const dga = rt ? role('dga', { directionCode: d.code }) : { fonction: 'dga', statut: 'non_defini', holders: [], via: null, poste: null, titulaires: [], rh: null };
        const directeur = role('directeur', { directionCode: d.code }, rhOf(d));
        const services = (d.services || []).map((sv) => {
          const memeNom = norm(sv.label) === norm(d.label);
          return { code: sv.code, label: sv.label, memeNom, chef: role('chef_service', { directionCode: d.code, serviceCode: sv.code, serviceSameAsDirection: memeNom }, rhOf(sv)) };
        });
        const manques = [dga, directeur, ...services.map((x) => x.chef)].filter((x) => x.statut === 'non_renseigne' || x.statut === 'non_defini').length;
        return { code: d.code, label: d.label, rattachement: rt ? { type: rt.rattachement, posteId: rt.dga_poste_id, poste: poste?.libelle ?? null } : null, dga, directeur, services, manques };
      });
      const dgNode = await dir.directionGenerale(null).catch(() => null);
      const dgs = { ...role('dgs', {}, rhOf(dgNode)), directionGenerale: dgNode ? { code: dgNode.code, label: dgNode.label } : null };
      const resume = {
        directions: directions.length, services: directions.reduce((n, d) => n + d.services.length, 0),
        manques: directions.reduce((n, d) => n + d.manques, 0) + (dgs.statut === 'non_renseigne' ? 1 : 0),
        vacants: directions.reduce((n, d) => n + [d.dga, d.directeur, ...d.services.map((x) => x.chef)].filter((x) => x.statut === 'vacant').length, 0) + (dgs.statut === 'vacant' ? 1 : 0),
        sansRattachement: directions.filter((d) => !d.rattachement).length,
      };
      return { dgs, postesDga: postes, directions, resume };
    },

    /** Désigne le responsable indiqué par l'organigramme RH : retrouve son identifiant de connexion (jamais d'ambiguïté tolérée). */
    async adopter(ctx, organismeId, { fonction, directionCode, serviceCode }) {
      const org = requireOrg(organismeId);
      if (!['directeur', 'chef_service', 'dgs'].includes(fonction)) throw E.badRequest('Seuls le DGS et les responsables de direction et de service figurent dans l\'organigramme RH');
      const chart = await dir.organisationChart();
      const d = fonction === 'dgs' ? await dir.directionGenerale(null) : chart.find((x) => x.code === directionCode);
      const node = fonction === 'chef_service' ? (d?.services || []).find((x) => x.code === serviceCode) : d;
      if (!node) throw E.notFound('Direction ou service introuvable dans l\'organigramme RH');
      if (node.vacant || !node.responsable) throw E.conflict('Ce poste est vacant dans l\'organigramme RH : il n\'y a personne à désigner');
      const logins = await dir.loginsByName(node.responsable);
      if (logins.length !== 1) throw E.conflict(logins.length ? `Plusieurs agents portent le nom « ${node.responsable} » : désignez le bon à la main` : `Le responsable « ${node.responsable} » n'a été retrouvé ni dans l'annuaire RH ni dans l'Active Directory : désignez-le à la main`);
      return titulaires.add(ctx, org, { fonction, username: logins[0], directionCode: fonction === 'dgs' ? undefined : directionCode, serviceCode: fonction === 'chef_service' ? serviceCode : undefined });
    },
  };
}

module.exports = { createOrganisation };
