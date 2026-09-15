import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Acceptance tests boot the compiled app to preserve decorator metadata.
      // TypeScript source maps map these files back to src in the report.
      include: ['dist/**/*.js'],
      reporter: ['text', 'html', ['lcov', {projectRoot: '../..'}]],
      reportsDirectory: './coverage',
    },
  },
});
