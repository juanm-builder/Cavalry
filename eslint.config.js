import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const commonRules = {
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-unreachable': 'error',
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-dupe-keys': 'error',
  'no-unsafe-optional-chaining': 'error'
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/test-artifacts/**',
      // Cargo build output, including generated Tauri codegen assets that are not parseable JS.
      'apps/desktop/src-tauri/target/**'
    ]
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
    files: ['apps/desktop/src/renderer/**/*.{js,jsx}'],
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
