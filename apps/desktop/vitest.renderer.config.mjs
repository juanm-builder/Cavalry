import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/renderer/**/*.interaction.test.jsx'],
    setupFiles: ['tests/renderer/setup.js']
  }
});
