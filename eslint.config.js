import js from '@eslint/js'
import ts from 'typescript-eslint'

export default ts.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'skills/**',
      '.local/**',
      '.private/**',
      'coverage/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        FormData: 'readonly',
        URLSearchParams: 'readonly',
        document: 'readonly',
        window: 'readonly',
        AudioContext: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
)
