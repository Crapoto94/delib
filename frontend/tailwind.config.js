/** Jetons issus de stitch/ivryd_lib_r_publique_moderne/DESIGN.md */
export default {
  content: ['./index.html', './elus.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'] },
      colors: {
        primary: { DEFAULT: '#0F2942', hover: '#1E3A8A', deep: '#001428' },
        action: { DEFAULT: '#2563EB', azur: '#38BDF8' },
        ok: { DEFAULT: '#059669', bg: '#ECFDF5', text: '#065F46' },
        warn: { DEFAULT: '#D97706', bg: '#FFFBEB' },
        ko: { DEFAULT: '#E11D48', bg: '#FFF1F2' },
        violet: { DEFAULT: '#7C3AED', bg: '#F5F3FF' },
        indigo2: { DEFAULT: '#4338CA', bg: '#EEF2FF' },
        page: '#F8FAFC', line: '#E2E8F0', ink: '#0F172A', mute: '#64748B', soft: '#EFF4FF',
      },
      borderRadius: { DEFAULT: '0.25rem' },
      boxShadow: { card: '0 1px 3px rgba(15,23,42,.04)', lift: '0 4px 12px rgba(15,41,66,.08)', float: '0 10px 25px -5px rgba(15,23,42,.15)' },
    },
  },
  plugins: [],
};
