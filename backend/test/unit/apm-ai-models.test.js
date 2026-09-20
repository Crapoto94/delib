const { normalizeModels } = require('../../src/adapters/apm-ai');

describe('liste des modèles de l’IA interne', () => {
  it('garde le NOM des modèles actifs (celui que /ai/query attend), pas leur identifiant numérique', () => {
    const body = [
      { id: 1, name: 'Interne Gemma RGPD++', model: 'gemma4:e4b', is_active: true, is_default: true },
      { id: 5, name: 'gpt-oss-20b', model: 'openai/gpt-oss-20b', active: true },
      { id: 9, name: 'Ancien modèle', is_active: false },
      { id: 12, name: 'Faster-Whisper STT (local)', is_active: true, capabilities: ['stt'] }, // transcription : pas pour une consigne
    ];
    expect(normalizeModels(body)).toEqual(['Interne Gemma RGPD++', 'gpt-oss-20b']);
  });
  it('accepte les autres formes de réponse : chaînes, { models }, { data }', () => {
    expect(normalizeModels(['a', 'b'])).toEqual(['a', 'b']);
    expect(normalizeModels({ models: [{ name: 'x' }] })).toEqual(['x']);
    expect(normalizeModels({ data: [{ id: 3 }] })).toEqual(['3']);
    expect(normalizeModels({})).toEqual([]);
  });
});
