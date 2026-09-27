/**
 * Parapheur — qui signe et comment (règles isolées de `signataire.js`).
 *
 * Deux constats de production motivent ces tests :
 *   - en mode dev, un arrêté collecté est parti au **signataire réel** trouvé dans le document : l'adresse d'essai
 *     doit primer sur tout signataire proposé ;
 *   - le mode de signature (P12 ou manuscrite) est choisi par le collecteur, mais un mode **SMS** en dev enverrait un
 *     message sur un portable réel : il est rabattu sur le paramétrage.
 */
import { describe, it, expect } from 'vitest';
import { signataireOf, signataireEnvoi } from '../../src/modules/parapheur/signataire.js';

const configDev = {
  mode: 'dev', email_test: 'essai@ville.fr', signataire_nom: '', signataire_email: '', signataire_qualite: '',
  signature_mode: 'securise', signataire_telephone: '',
};
const configProd = {
  mode: 'prod', email_test: 'essai@ville.fr', signataire_nom: 'Maire', signataire_email: 'maire@ville.fr', signataire_qualite: 'Maire',
  signature_mode: 'securise', signataire_telephone: '',
};

describe('parapheur — signataire envoyé', () => {
  it('dev : l’adresse d’essai prime sur le signataire proposé, mais le nom demandé est conservé', () => {
    const s = signataireEnvoi(configDev, { nom: 'Berangere SLOCINSKI', email: 'berangere@ville.fr', qualite: 'arrêté (collecteur)' });
    expect(s.email).toBe('essai@ville.fr');
    expect(s.nom).toBe('Berangere SLOCINSKI');
    expect(s.qualite).toBe('arrêté (collecteur)');
  });

  it('dev : le mode de signature demandé est respecté (P12 ou manuscrite)', () => {
    expect(signataireEnvoi(configDev, { nom: 'X', email: 'x@ville.fr', mode: 'simple' }).mode).toBe('simple');
    expect(signataireEnvoi(configDev, { nom: 'X', email: 'x@ville.fr', mode: 'securise' }).mode).toBe('securise');
  });

  it('dev : un mode SMS est rabattu sur le paramétrage (jamais de SMS vers un portable réel)', () => {
    const cfg = { ...configDev, signature_mode: 'simple', signataire_telephone: '+33600000000' };
    const s = signataireEnvoi(cfg, { nom: 'X', email: 'x@ville.fr', mode: 'sms', telephone: '+33612345678' });
    expect(s.mode).toBe('simple');
    expect(s.telephone).toBe('+33600000000');
    expect(s.email).toBe('essai@ville.fr');
  });

  it('prod : le signataire proposé l’emporte (l’élu du document signe réellement)', () => {
    const s = signataireEnvoi(configProd, { nom: 'Berangere SLOCINSKI', email: 'berangere@ville.fr', qualite: 'arrêté (collecteur)', mode: 'simple' });
    expect(s).toMatchObject({ email: 'berangere@ville.fr', nom: 'Berangere SLOCINSKI', mode: 'simple' });
  });

  it('sans proposition : le paramétrage décide (adresse d’essai en dev, signataire en prod)', () => {
    expect(signataireEnvoi(configDev).email).toBe('essai@ville.fr');
    expect(signataireEnvoi(configProd).email).toBe('maire@ville.fr');
    expect(signataireOf(configDev).nom).toBe('Signataire (test)');
  });
});
