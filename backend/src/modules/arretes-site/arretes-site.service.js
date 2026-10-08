/**
 * Arrêtés « site » : reprise des arrêtés pris par le Maire publiés sur le site internet de la Ville (page de liens PDF).
 * Chaque arrêté devient un acte signé du type « arrêté » (document = le PDF du site), marqué `actes.site = true` : un effacement général
 * des données ne le supprime pas (voir la migration 0086). La reprise est rejouable : un arrêté déjà repris (même adresse de PDF) est ignoré.
 *
 * La date de l'arrêté est lue dans le PDF : la première page est l'accusé de réception de la préfecture, dont l'identifiant porte la date
 * (« 094-219400413-20260902-AR202609_02-AI ») ; à défaut, le mois du dossier du site.
 */
const { E } = require('../../shared/errors');
const { requireOrg } = require('../../db/pool');
const { nextCounter, inspectPdf } = require('../../shared/infra');

const URL_DEFAUT = 'https://www.ivry94.fr/2214/arretes-pris-par-le-maire.htm';
const TAILLE_MAX = 30 * 1024 * 1024;
const decoder = new TextDecoder('utf-8');
let pdfjs = null;

const decodeHtml = (s) => String(s).replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"');

/** Adresse admise pour la reprise : HTTPS, nom de domaine (ni IP, ni localhost) — la page est lue côté serveur. */
function verifierUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw E.badRequest('Adresse invalide'); }
  if (url.protocol !== 'https:') throw E.badRequest('L’adresse de la page doit utiliser HTTPS');
  if (url.username || url.password) throw E.badRequest('Adresse invalide');
  if (/^(localhost|.*\.local|.*\.internal)$/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':') || !url.hostname.includes('.')) throw E.badRequest('L’adresse doit être un nom de domaine public');
  return url;
}

/**
 * Arrêtés listés par la page : liens vers des PDF du dossier « …/Opendata/Arretes/<année>/<mm-mois>/<AAAAMM_NN_Titre>.pdf ».
 * Renvoie [{ url, annee, mois, numero, titre, fichier }], sans doublon, du plus récent au plus ancien.
 */
function lirePage(html, pageUrl) {
  const base = new URL(pageUrl); const vus = new Set(); const out = [];
  const re = /href="([^"]*\/Arretes\/(\d{4})\/(\d{2})-([^"\/]+)\/([^"\/]+?)\.pdf)"/gi;
  let m;
  while ((m = re.exec(html))) {
    let url;
    try { url = new URL(decodeHtml(m[1]), base); } catch { continue; }
    if (url.origin !== base.origin || vus.has(url.href)) continue;   // jamais un autre site que celui de la page
    vus.add(url.href);
    const fichier = decodeURIComponent(m[5]);
    const parts = fichier.split('_');
    const numero = /^AR\d{6}$/i.test(parts[0]) && /^[0-9A-Za-z]+$/.test(parts[1] || '') ? `${parts[0].toUpperCase()}_${parts[1]}` : fichier;
    const reste = (/^AR\d{6}$/i.test(parts[0]) ? parts.slice(2) : parts).join(' ').replace(/\s+/g, ' ').trim();
    const titre = reste ? reste.charAt(0).toUpperCase() + reste.slice(1) : `Arrêté ${numero}`;
    out.push({ url: url.href, annee: Number(m[2]), mois: Number(m[3]), numero, titre, fichier });
  }
  return out.sort((a, b) => b.annee - a.annee || b.mois - a.mois || (b.numero < a.numero ? -1 : 1));
}

/** Date de l'arrêté lue dans le texte des premières pages du PDF (accusé de réception de la préfecture) ; null si introuvable. */
async function dateDuPdf(buffer) {
  try {
    pdfjs = pdfjs || await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, disableFontFace: true, isEvalSupported: false, verbosity: 0 }).promise;
    let texte = '';
    for (let i = 1; i <= Math.min(2, doc.numPages); i++) { const p = await doc.getPage(i); texte += ` ${(await p.getTextContent()).items.map((x) => x.str).join(' ')}`; }
    await doc.destroy();
    const id = /094-\d{9}-(\d{4})(\d{2})(\d{2})-/.exec(texte);
    if (id) return `${id[1]}-${id[2]}-${id[3]}`;
    const ar = /Date de r[ée]ception pr[ée]fecture\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(texte);
    if (ar) return `${ar[3]}-${ar[2]}-${ar[1]}`;
  } catch { /* PDF illisible : on se rabat sur le mois du dossier */ }
  return null;
}

function createArretesSite({ db, audit, storage, refs, settings, log, bus, http = (u, o) => fetch(u, o) }) {
  const jobs = new Map(); // organismeId -> état de la reprise en cours (ou de la dernière)

  const telecharger = async (url, max) => {
    const r = await http(url, { headers: { 'User-Agent': 'VibeDelib-ArretesSite/1.0', Accept: 'text/html,application/pdf' }, redirect: 'follow', signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > max) throw new Error('fichier trop volumineux');
    return buf;
  };

  async function typeArrete(org) {
    const r = await refs.byCode('type_acte', 'arrete', org).catch(() => null);
    if (!r) throw E.conflict('Le type d’acte « arrêté » est introuvable dans les référentiels');
    return r;
  }

  /** Crée l'acte « site » et son document ; renvoie l'identifiant de l'acte. */
  async function creer(org, a, buffer, type) {
    const lue = await dateDuPdf(buffer);
    const date = lue || `${a.annee}-${String(a.mois).padStart(2, '0')}-01`;
    const approximative = !lue;
    const { pages } = await inspectPdf(buffer);
    const nom = `${a.fichier}.pdf`.slice(0, 200);
    const put = await storage.put(buffer, { organismeId: org, ext: 'pdf', categorie: 'arretes-site', nom, titre: a.titre, description: `Arrêté ${a.numero} (site de la Ville)`, auteur: '@site' });
    const natureId = type.meta?.natureCode ? (await refs.byCode('nature', type.meta.natureCode, org).catch(() => null))?.id ?? null : null;
    return db.tx(async (q) => {
      const f = await q.get(
        `INSERT INTO files (organisme_id, storage_key, original_name, mime, size, sha256, pages, created_by) VALUES ($1,$2,$3,'application/pdf',$4,$5,$6,'@site') RETURNING id`,
        [org, put.key, nom, put.size, put.sha256, pages]);
      const maxSuivi = (await q.get('SELECT COALESCE(max(numero_suivi), 0)::int AS m FROM actes WHERE organisme_id = $1', [org])).m;
      const numeroSuivi = await nextCounter(q, org, 'acte', { plancher: maxSuivi });
      const custom = { site: { url: a.url, numero: a.numero, fichier: a.fichier, mois: `${a.annee}-${String(a.mois).padStart(2, '0')}`, dateApproximative: approximative, sha256: put.sha256, repriseLe: new Date().toISOString() } };
      const r = await q.get(
        `INSERT INTO actes (organisme_id, numero_suivi, type_id, titre, redacteur, direction_code, direction_label, nature_id, incidence_financiere, urgence, confidentialite,
           commentaire_initial, custom, statut, signe_at, site, document_source_file_id, document_source_pdf_file_id)
         VALUES ($1,$2,$3,$4,'@site','_site','Site de la Ville',$5,FALSE,FALSE,'normale',$6,$7::jsonb,'signe',$8::timestamptz,TRUE,$9,$9) RETURNING id`,
        [org, numeroSuivi, type.id, a.titre, natureId, `Arrêté ${a.numero} repris du site de la Ville.`, JSON.stringify(custom), `${date}T12:00:00+02:00`, f.id]);
      await q.run('INSERT INTO deliberations (acte_id, ordre, titre) VALUES ($1, 1, $2)', [r.id, a.titre]);
      return r.id;
    }).then(async (id) => { await bus?.emit?.('acte.created', { organismeId: org, acteId: id }); return id; });   // indexation de la recherche (titre, numéro, texte du PDF)
  }

  const svc = {
    URL_DEFAUT, lirePage, dateDuPdf, verifierUrl,

    async url(org) { return String((await settings.resolve(requireOrg(org)))['arretes.site_url']?.value || URL_DEFAUT); },

    async etat(org) {
      const o = requireOrg(org);
      const par = await db.all("SELECT extract(year FROM signe_at AT TIME ZONE 'Europe/Paris')::int AS annee, count(*)::int AS nb FROM actes WHERE organisme_id = $1 AND site GROUP BY 1 ORDER BY 1 DESC", [o]);
      return { url: await svc.url(o), total: par.reduce((n, x) => n + x.nb, 0), parAnnee: par, importation: jobs.get(o) || null };
    },

    /** Lance la reprise en arrière-plan (une seule à la fois par organisme) ; la progression se lit avec `etat`. */
    async lancer(ctx, org, { url } = {}) {
      const o = requireOrg(org);
      if (jobs.get(o)?.etat === 'en_cours') throw E.conflict('Une reprise est déjà en cours');
      const page = verifierUrl(url || await svc.url(o));
      const job = { etat: 'en_cours', url: page.href, total: 0, faits: 0, nouveaux: 0, ignores: 0, erreurs: [], debut: new Date().toISOString(), fin: null, par: ctx.username };
      jobs.set(o, job);
      svc.executer(ctx, o, page, job).catch((e) => { job.etat = 'erreur'; job.message = e.message; job.fin = new Date().toISOString(); log?.error?.({ err: e.message }, 'reprise des arrêtés du site en erreur'); });
      return job;
    },

    async executer(ctx, org, page, job) {
      const html = decoder.decode(await telecharger(page.href, 8 * 1024 * 1024));
      const liste = lirePage(html, page.href);
      if (!liste.length) throw new Error('Aucun arrêté trouvé sur cette page');
      const type = await typeArrete(org);
      const deja = new Set((await db.all("SELECT custom->'site'->>'url' AS u FROM actes WHERE organisme_id = $1 AND site", [org])).map((r) => r.u));
      job.total = liste.length;
      const file = liste.slice(); let i = 0;
      const ouvrier = async () => {
        while (i < file.length) {
          const a = file[i++];
          try {
            if (deja.has(a.url)) job.ignores++;
            else { await creer(org, a, await telecharger(a.url, TAILLE_MAX), type); job.nouveaux++; }
          } catch (e) { if (job.erreurs.length < 100) job.erreurs.push({ url: a.url, message: e.message }); }
          job.faits++;
        }
      };
      await Promise.all(Array.from({ length: 4 }, ouvrier));
      job.etat = 'termine'; job.fin = new Date().toISOString();
      await audit.log(ctx, { organismeId: org, action: 'arretes_site.reprise', entity: 'actes', after: { url: page.href, total: job.total, nouveaux: job.nouveaux, ignores: job.ignores, erreurs: job.erreurs.length } });
    },
  };
  return svc;
}

module.exports = { createArretesSite, lirePage, dateDuPdf, verifierUrl, URL_DEFAUT };
