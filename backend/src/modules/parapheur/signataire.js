/**
 * Parapheur — qui signe, et comment.
 *
 * Ces deux règles sont isolées ici parce qu'elles sont délicates et testables seules :
 *
 *   - en **mode dev**, tous les envois vont vers une **adresse d'essai unique** : elle prime sur tout signataire
 *     proposé par un appelant. Sans cette règle, un arrêté collecté partait au signataire réel trouvé dans le document
 *     alors qu'on croyait tester (constaté en production) ;
 *   - le **mode de signature** (P12 « securise », manuscrite « simple », SMS) peut être demandé par l'appelant
 *     (le collecteur d'arrêtés le règle) ; en dev, seul le SMS est rabattu sur le paramétrage, car il enverrait un
 *     message sur un portable réel.
 */
const MODES_SIGNATURE = ['securise', 'simple', 'sms'];

/** Signataire du paramétrage : adresse d'essai en dev, signataire réel en prod. */
const signataireOf = (cfg) => (cfg.mode === 'dev'
  ? { nom: cfg.signataire_nom || 'Signataire (test)', email: cfg.email_test || null, qualite: cfg.signataire_qualite || null, mode: cfg.signature_mode || 'securise', telephone: cfg.signataire_telephone || null }
  : { nom: cfg.signataire_nom || null, email: cfg.signataire_email || null, qualite: cfg.signataire_qualite || null, mode: cfg.signature_mode || 'securise', telephone: cfg.signataire_telephone || null });

/** Signataire réellement envoyé au parapheur (voir l'en-tête pour les règles). */
const signataireEnvoi = (cfg, demande = null) => {
  const base = signataireOf(cfg);
  if (!demande) return base;
  const s = { ...base, ...demande };
  if (cfg.mode === 'dev') {
    s.email = base.email;                    // adresse d'essai unique : jamais remplacée
    s.nom = demande.nom || base.nom;         // …mais on garde le nom demandé, pour voir qui aurait signé
    s.qualite = demande.qualite || base.qualite;
    if (demande.mode === 'sms') { s.mode = base.mode; s.telephone = base.telephone; }
  }
  return s;
};

module.exports = { signataireOf, signataireEnvoi, MODES_SIGNATURE };
