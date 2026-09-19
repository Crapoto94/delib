const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    testTimeout: 90000,
    hookTimeout: 120000,
    pool: 'forks',
    environment: 'node',
    globals: true,
  },
});
