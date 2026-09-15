module.exports = {
  extends: '@loopback/eslint-config',
  overrides: [
    {
      files: ['src/__tests__/**/*.ts', 'vitest.config.ts'],
      parserOptions: {
        project: './tsconfig.test.json',
      },
    },
  ],
  rules: {
    '@typescript-eslint/prefer-nullish-coalescing': 'off',
  },
};
