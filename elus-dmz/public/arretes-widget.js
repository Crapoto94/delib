/*
 * Affichage des arrêtés signés (pages publiques) — script autonome, sans dépendance.
 *
 * Liste des arrêtés des derniers mois :
 *   <div id="arretes"></div>
 *   <script src="https://VOTRE-ESPACE-ELUS/arretes-widget.js" data-cible="#arretes"></script>
 *
 * Moteur de recherche (sans limite de durée : texte de l'objet ou numéro, année, dates) :
 *   <div id="arretes"></div>
 *   <script src="https://VOTRE-ESPACE-ELUS/arretes-widget.js" data-cible="#arretes" data-mode="recherche"></script>
 *
 * Options (attributs du <script>) : data-cible (sélecteur, défaut #arretes), data-mode (liste | recherche),
 * data-par-page (1 à 50, défaut 10), data-mois (période, mode liste).
 * Le script lit l'API publique du serveur dont il est issu (/api/v1/public/arretes), pagine, regroupe par mois (une rupture par mois,
 * avec la date de chaque arrêté) et ouvre la liste des annexes dans une fenêtre. Chaque lien est un jeton chiffré non devinable.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var base = new URL(script.src).origin;
  var cible = document.querySelector(script.getAttribute('data-cible') || '#arretes');
  if (!cible) return;
  if (cible.getAttribute('data-vd')) return; // déjà initialisé (script inclus deux fois)
  cible.setAttribute('data-vd', '1');
  var recherche = script.getAttribute('data-mode') === 'recherche';
  var parPage = Math.min(50, Math.max(1, parseInt(script.getAttribute('data-par-page'), 10) || 10));
  var mois = parseInt(script.getAttribute('data-mois'), 10) || null;
  var page = 1;
  var filtres = {};

  var CSS = '.vd-d{font:14px/1.45 system-ui,sans-serif;color:#1f2937}.vd-d ul{list-style:none;margin:0;padding:0}'
    + '.vd-d h2.vd-s{font-size:15px;font-weight:700;margin:22px 0 8px;padding:8px 12px;background:#eef2ff;border-left:4px solid #4338ca;border-radius:0 4px 4px 0;color:#312e81;text-transform:capitalize}'
    + '.vd-d li.vd-i{border:1px solid #e5e7eb;border-radius:6px;padding:12px;margin-bottom:8px;background:#fff}.vd-d .vd-t{font-weight:600}.vd-d .vd-m{font-size:12px;color:#6b7280;margin-top:2px}'
    + '.vd-d .vd-a{margin-top:8px;display:flex;flex-wrap:wrap;gap:10px;align-items:center}.vd-d a,.vd-d button.vd-l{color:#1d4ed8}.vd-d button{font:inherit;cursor:pointer}'
    + '.vd-d button.vd-l{background:none;border:0;padding:0;text-decoration:underline}.vd-d .vd-b{border:1px solid #d1d5db;background:#f9fafb;border-radius:4px;padding:3px 10px}'
    + '.vd-d .vd-b:disabled{opacity:.5;cursor:default}.vd-d nav{display:flex;gap:12px;align-items:center;justify-content:center;margin-top:12px;font-size:13px}'
    + '.vd-d form.vd-f{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;align-items:end;margin-bottom:8px;padding:12px;border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb}'
    + '.vd-d form.vd-f label{display:flex;flex-direction:column;gap:2px;font-size:12px;color:#6b7280}.vd-d form.vd-f input,.vd-d form.vd-f select{font:inherit;color:#1f2937;padding:5px 6px;border:1px solid #d1d5db;border-radius:4px;background:#fff}'
    + '.vd-d form.vd-f .vd-q{grid-column:1/-1;display:flex;flex-direction:row;gap:10px}.vd-d form.vd-f .vd-q input{flex:1}.vd-d .vd-p{background:#4338ca;color:#fff;border:0;border-radius:4px;padding:6px 14px}'
    + '.vd-o{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999}'
    + '.vd-o>div{background:#fff;border-radius:6px;max-width:520px;width:100%;max-height:85vh;overflow:auto;padding:18px;font:14px/1.45 system-ui,sans-serif}'
    + '.vd-o li{margin:6px 0}.vd-o ul{list-style:none;margin:0;padding:0}.vd-o a{color:#1d4ed8}.vd-o .vd-x{float:right;background:none;border:0;font-size:20px;cursor:pointer}';
  var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

  var racine = document.createElement('div'); racine.className = 'vd-d'; cible.appendChild(racine);
  var zoneForm = null; var zoneListe = racine;
  if (recherche) { zoneForm = document.createElement('div'); zoneListe = document.createElement('div'); racine.appendChild(zoneForm); racine.appendChild(zoneListe); }

  function el(tag, attrs, enfants) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] == null) return;
      if (k === 'text') e.textContent = attrs[k]; else if (k.slice(0, 2) === 'on') e[k] = attrs[k]; else e.setAttribute(k, attrs[k]);
    });
    (enfants || []).forEach(function (c) { if (c) e.appendChild(c); });
    return e;
  }
  var fmt = function (o) { return function (v) { return new Intl.DateTimeFormat('fr-FR', Object.assign({ timeZone: 'Europe/Paris' }, o)).format(new Date(v)); }; };
  var jour = fmt({ dateStyle: 'long' }); var moisAn = fmt({ month: 'long', year: 'numeric' });
  var lien = function (u) { return base + u; };

  function modaleAnnexes(item) {
    var fermer = function () { document.removeEventListener('keydown', touche); o.remove(); };
    var touche = function (e) { if (e.key === 'Escape') fermer(); };
    var liste = el('ul', {}, item.annexes.map(function (a) { return el('li', {}, [el('a', { href: lien(a.url), target: '_blank', rel: 'noopener', text: a.titre })]); }));
    var o = el('div', { 'class': 'vd-o', onclick: function (e) { if (e.target === o) fermer(); } }, [el('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Annexes' }, [
      el('button', { 'class': 'vd-x', 'aria-label': 'Fermer', text: '×', onclick: fermer }),
      el('strong', { text: 'Annexes (' + item.annexes.length + ')' }),
      el('div', { text: (item.numero ? item.numero + ' — ' : '') + item.titre, style: 'font-size:12px;color:#6b7280;margin:4px 0 8px' }),
      liste])]);
    document.addEventListener('keydown', touche); document.body.appendChild(o);
  }

  function dessiner(data) {
    zoneListe.textContent = '';
    // une rupture par mois (les résultats arrivent du plus récent au plus ancien)
    var groupes = []; var index = {};
    data.items.forEach(function (i) {
      var cle = moisAn(i.date);
      if (!index[cle]) { index[cle] = { libelle: cle, items: [] }; groupes.push(index[cle]); }
      index[cle].items.push(i);
    });
    if (!groupes.length) zoneListe.appendChild(el('p', { text: recherche ? 'Aucun arrêté ne correspond à cette recherche.' : 'Aucun arrêté sur cette période.' }));
    else if (recherche) zoneListe.appendChild(el('p', { 'class': 'vd-m', text: data.total + ' arrêté' + (data.total > 1 ? 's' : '') }));
    groupes.forEach(function (g) {
      zoneListe.appendChild(el('h2', { 'class': 'vd-s', text: g.libelle }));
      zoneListe.appendChild(el('ul', {}, g.items.map(function (i) {
        var meta = ['Signé le ' + jour(i.date), i.signataire].filter(Boolean).join(' · ');
        var actions = [el('a', { href: lien(i.pdf), target: '_blank', rel: 'noopener', text: 'Arrêté (PDF)' })];
        if (i.annexes.length) actions.push(el('button', { type: 'button', 'class': 'vd-l', text: i.annexes.length + ' annexe' + (i.annexes.length > 1 ? 's' : ''), onclick: function () { modaleAnnexes(i); } }));
        return el('li', { 'class': 'vd-i' }, [el('div', { 'class': 'vd-t', text: (i.numero ? i.numero + ' — ' : '') + i.titre }), el('div', { 'class': 'vd-m', text: meta }), el('div', { 'class': 'vd-a' }, actions)]);
      })));
    });
    var pages = Math.max(1, Math.ceil(data.total / parPage));
    if (pages > 1) {
      zoneListe.appendChild(el('nav', { 'aria-label': 'Pagination' }, [
        el('button', { 'class': 'vd-b', type: 'button', text: '‹ Précédent', onclick: function () { charger(page - 1); }, disabled: page <= 1 ? 'disabled' : null }),
        el('span', { text: 'Page ' + page + ' sur ' + pages }),
        el('button', { 'class': 'vd-b', type: 'button', text: 'Suivant ›', onclick: function () { charger(page + 1); }, disabled: page >= pages ? 'disabled' : null })]));
    }
  }

  function charger(p) {
    page = p;
    var q = new URLSearchParams({ page: String(p), limit: String(parPage) });
    if (mois && !recherche) q.set('mois', String(mois));
    Object.keys(filtres).forEach(function (k) { if (filtres[k]) q.set(k, filtres[k]); });
    fetch(base + '/api/v1/public/arretes' + (recherche ? '/recherche' : '') + '?' + q.toString())
      .then(function (r) {
        if (r.status === 404) throw new Error(recherche ? 'La recherche des arrêtés n’est pas activée.' : 'La publication des arrêtés n’est pas activée.');
        if (r.status === 400) throw new Error('Critères de recherche invalides.');
        if (!r.ok) throw new Error('Arrêtés momentanément indisponibles.');
        return r.json();
      })
      .then(dessiner)
      .catch(function (e) { zoneListe.textContent = ''; zoneListe.appendChild(el('p', { role: 'alert', text: e.message })); });
  }

  function formulaire(f) {
    var champ = function (libelle, ctrl) { return el('label', {}, [el('span', { text: libelle }), ctrl]); };
    var opt = function (v, t) { return el('option', { value: v, text: t }); };
    var q = el('input', { id: 'vd-q', type: 'search', placeholder: 'Objet ou numéro de l’arrêté…', 'aria-label': 'Texte recherché', maxlength: '200' });
    var annee = el('select', { id: 'vd-annee' }, [opt('', 'Toutes les années')].concat(f.annees.map(function (a) { return opt(a.annee, a.annee + ' (' + a.nb + ')'); })));
    var du = el('input', { id: 'vd-du', type: 'date' }); var au = el('input', { id: 'vd-au', type: 'date' });
    var form = el('form', { 'class': 'vd-f', role: 'search', onsubmit: function (e) {
      e.preventDefault();
      filtres = { q: q.value.trim(), annee: annee.value, dateDebut: du.value, dateFin: au.value };
      if (filtres.q && filtres.q.length < 2) { zoneListe.textContent = ''; zoneListe.appendChild(el('p', { role: 'alert', text: 'Saisissez au moins 2 caractères.' })); return; }
      charger(1);
    } }, [
      el('div', { 'class': 'vd-q' }, [q, el('button', { 'class': 'vd-p', type: 'submit', text: 'Rechercher' })]),
      champ('Année', annee), champ('Signé du', du), champ('au', au),
      el('button', { 'class': 'vd-b', type: 'button', text: 'Réinitialiser', onclick: function () { form.reset(); filtres = {}; charger(1); } })]);
    zoneForm.textContent = ''; zoneForm.appendChild(form);
  }

  if (recherche) {
    fetch(base + '/api/v1/public/arretes/recherche/filtres')
      .then(function (r) { if (r.status === 404) throw new Error('La recherche des arrêtés n’est pas activée.'); if (!r.ok) throw new Error('Recherche momentanément indisponible.'); return r.json(); })
      .then(function (f) { formulaire(f); charger(1); })
      .catch(function (e) { zoneListe.appendChild(el('p', { role: 'alert', text: e.message })); });
  } else {
    charger(1);
  }
})();
