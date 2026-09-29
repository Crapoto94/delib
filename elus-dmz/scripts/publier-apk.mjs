// Publication de l'APK sur l'instance DMZ.
// À lancer depuis elus-dmz APRÈS avoir : `npm run build`, puis dans elus-apk `npx cap sync android` et
// `gradlew assembleDebug` (JDK 21). Le script refuse de publier si l'APK n'a pas été construit à partir du
// build web courant, pour ne jamais annoncer une mise à jour qui ne correspond pas au fichier servi.
//
//   node scripts/publier-apk.mjs [--notes "texte affiché dans l'application"]
//
// Produit : apk/vibedelib-elus.apk (binaire, non versionné) et apk/latest.json (versionné).

import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const racine = dirname(dirname(fileURLToPath(import.meta.url))); // elus-dmz/
const dist = join(racine, 'dist');
const apkSrc = join(racine, 'elus-apk', 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const assetsPublic = join(racine, 'elus-apk', 'android', 'app', 'src', 'main', 'assets', 'public');
const dossierApk = join(racine, 'apk');
const apkDest = join(dossierApk, 'vibedelib-elus.apk');

const notes = (() => { const i = process.argv.indexOf('--notes'); return i >= 0 ? process.argv[i + 1] : ''; })();

const hashJs = (html) => (html.match(/index-[A-Za-z0-9_-]+\.js/) || [null])[0];

async function principal() {
  let version, buildTime;
  try { ({ version, buildTime } = JSON.parse(await readFile(join(dist, 'version.json'), 'utf8'))); }
  catch { throw new Error("dist/version.json est absent : lancez d'abord `npm run build` dans elus-dmz."); }

  const hDist = hashJs(await readFile(join(dist, 'index.html'), 'utf8'));
  let hApk;
  try { hApk = hashJs(await readFile(join(assetsPublic, 'index.html'), 'utf8')); }
  catch { throw new Error('Assets Android absents : lancez `npx cap sync android` dans elus-apk.'); }
  if (!hDist || hDist !== hApk) throw new Error(`L'APK n'embarque pas le build web courant (${hDist} attendu, ${hApk} trouvé). Relancez \`npx cap sync android\` puis \`gradlew assembleDebug\`.`);

  const sApk = await stat(apkSrc).catch(() => null);
  if (!sApk) throw new Error('APK introuvable : lancez `gradlew assembleDebug` (JDK 21) dans elus-apk/android.');
  const sAssets = await stat(join(assetsPublic, 'index.html'));
  if (sApk.mtimeMs < sAssets.mtimeMs) throw new Error("L'APK est plus ancien que les assets synchronisés : relancez `gradlew assembleDebug`.");

  await mkdir(dossierApk, { recursive: true });
  await copyFile(apkSrc, apkDest);
  const manifeste = { version, buildTime, url: '/apk/vibedelib-elus.apk', taille: sApk.size, notes };
  await writeFile(join(dossierApk, 'latest.json'), JSON.stringify(manifeste, null, 2) + '\n', 'utf8');
  console.log(`APK publié : ${apkDest}`);
  console.log(`Manifeste  : ${JSON.stringify(manifeste)}`);
}

principal().catch((e) => { console.error(e.message); process.exit(1); });
