module.exports = {
  extends: ['@loopback/eslint-config', 'plugin:prettier/recommended'],
  overrides: [
    {
      files: ['**/*.ts'],
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: __dirname,
      },
    },
    {
      files: ['src/index.ts'],
      // Preserve the generated HOST fallback for an empty environment variable.
      rules: {'@typescript-eslint/prefer-nullish-coalescing': 'off'},
    },
  ],
};
