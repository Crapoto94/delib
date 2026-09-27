/**
 * Collecteurs — choix du transport d'accès au dossier source (section 13).
 *
 * Ce qui est vérifié ici : le chemin UNC mène bien au transport « partage réseau » (et non au dossier local), la
 * décomposition serveur/partage/dossier est juste, et un chemin ordinaire reste un dossier local. La mise en œuvre
 * Windows (PowerShell) et Linux (smbclient) n'est pas exercée : elle demande un vrai partage.
 */
import { describe, it, expect } from 'vitest';
import { choisirPartage, decouperUNC } from '../../src/modules/collecteurs/partage.js';

describe('collecteurs — source dossier', () => {
  it('un chemin UNC devient un partage réseau, quel que soit le système', () => {
    const p = choisirPartage({ cible: '\\\\srv-arretes\\arretes\\2026', utilisateur: 'IVRY\\svc', motDePasse: 'secret' });
    expect(p.type).toBe('smb');
    // Le mot de passe ne doit jamais se retrouver dans une méthode publique : rien à vérifier ici, sinon que l'objet
    // expose bien le contrat attendu par le service.
    for (const m of ['tester', 'listerSousDossiers', 'listerFichiers', 'lire', 'deplace', 'copier', 'supprimer', 'ecrire']) {
      expect(typeof p[m]).toBe('function');
    }
  });

  it('un chemin ordinaire reste un dossier local', () => {
    expect(choisirPartage({ cible: '/mnt/arretes' }).type).toBe('local');
    expect(choisirPartage({ cible: 'C:\\depot\\arretes' }).type).toBe('local');
  });

  it('décompose un chemin UNC en partage et dossier', () => {
    expect(decouperUNC('\\\\srv\\partage\\dossier\\sous')).toEqual({ share: '//srv/partage', base: 'dossier/sous' });
    expect(decouperUNC('\\\\srv\\partage')).toEqual({ share: '//srv/partage', base: '' });
    expect(decouperUNC('//srv/partage/2026')).toEqual({ share: '//srv/partage', base: '2026' });
    expect(() => decouperUNC('\\\\srv')).toThrow(/UNC invalide/);
  });

  it('refuse une cible vide', () => {
    expect(() => choisirPartage({ cible: '   ' })).toThrow(/Aucun dossier source/);
  });
});
