/**
 * Taille maximale des pièces jointes (annexes du dossier, pièces d'un dossier simple) :
 * réglée par l'organisme (paramètre `fichiers.taille_max_mo`, défaut 30 Mo) et bornée par la
 * limite technique du serveur (`MAX_UPLOAD_MB`). Aucune valeur ne peut dépasser ce plafond.
 */
const MO = 1024 * 1024;
const KEY = 'fichiers.taille_max_mo';
const DEFAULT_MB = 30;

function createUploadLimit({ settings, config }) {
  const maximumMb = Math.max(1, Math.floor(config.storage.maxUploadBytes / MO));
  const clamp = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return Math.min(DEFAULT_MB, maximumMb);
    return Math.max(1, Math.min(Math.round(n), maximumMb));
  };
  const mb = async (organismeId) => clamp(settings ? (await settings.resolve(organismeId))[KEY]?.value : undefined);
  const bytes = async (organismeId) => (await mb(organismeId)) * MO;
  const info = async (organismeId) => ({ tailleMaxMo: await mb(organismeId), defautMo: Math.min(DEFAULT_MB, maximumMb), maximumMo: maximumMb });
  return { mb, bytes, info, clamp, KEY, DEFAULT_MB, maximumMb };
}

module.exports = { createUploadLimit, KEY, DEFAULT_MB };
