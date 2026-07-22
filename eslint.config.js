import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const commonRules = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error'
};

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/test-artifacts/**']
  },
  {
    files: ['**/*.{js,mjs,cjs,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node }
    },
    rules: commonRules
  },
  {
    files: ['apps/mac/src/renderer/**/*.{js,jsx}'],
    plugins: { 'react-hooks': hooks },
    rules: {
      ...commonRules,
      ...hooks.configs.recommended.rules
    }
  },
  {
    files: ['**/tests/**/*.{js,mjs,cjs,jsx}'],
    rules: {
      'no-new-func': 'off'
    }
  }
];
