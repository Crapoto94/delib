/**
 * Jetons issus de stitch/ivryd_lib_r_publique_moderne/DESIGN.md (UI-03, D99).
 * Toutes les couleurs sont des variables CSS (canaux RGB) définies dans src/index.css, en thème clair et en thème sombre :
 * aucun écran n'a de couleur en dur, et le mode sombre s'applique partout d'un seul mouvement.
 */
const v = (n) => `rgb(var(--c-${n}) / <alpha-value>)`;

export default {
  content: ['./index.html', './elus.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'] },
      colors: {
        // « primary » = fond plein (boutons, bandeaux) avec texte blanc ; « head » = titres et texte de marque (clair en thème sombre)
        primary: { DEFAULT: v('primary'), hover: v('primary-hover'), deep: v('primary-deep') },
        head: v('head'),
        // « action / ok / warn / ko » = texte, bordures, pastilles ; « -solid » = fond plein avec texte blanc ; « -bg » = teinte de fond
        action: { DEFAULT: v('action'), solid: v('action-solid'), azur: v('azur') },
        ok: { DEFAULT: v('ok'), solid: v('ok-solid'), bg: v('ok-bg'), text: v('ok-text') },
        warn: { DEFAULT: v('warn'), solid: v('warn-solid'), bg: v('warn-bg') },
        ko: { DEFAULT: v('ko'), solid: v('ko-solid'), bg: v('ko-bg') },
        violet: { DEFAULT: v('violet'), bg: v('violet-bg') },
        indigo2: { DEFAULT: v('indigo'), bg: v('indigo-bg') },
        page: v('page'), surface: v('surface'), line: v('line'), ink: v('ink'), mute: v('mute'), soft: v('soft'),
        nav: { from: v('nav-from'), to: v('nav-to') },
        side: { DEFAULT: v('side'), text: v('side-text') },
        slate: { 50: v('s50'), 100: v('s100'), 200: v('s200'), 300: v('s300'), 400: v('s400'), 500: v('s500'), 600: v('s600'), 700: v('s700'), 800: '#1E293B', 900: '#0F172A' },
      },
      borderColor: { DEFAULT: v('line') },
      borderRadius: { DEFAULT: '0.25rem' },
      boxShadow: {
        card: '0 1px 2px rgb(15 41 66 / .06), 0 2px 6px rgb(15 41 66 / .06)',
        lift: '0 6px 16px rgb(15 41 66 / .12)',
        float: '0 12px 30px -6px rgb(15 23 42 / .28)',
      },
    },
  },
  plugins: [],
};
