import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Compiles the e-mail templates once per run, so the specs render what the image ships.
    globalSetup: ['./scripts/build-email-templates.mjs'],
    projects: [
      {
        extends: true,
        test: { name: 'unit', include: ['src/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int-spec.ts', 'tests/**/*.int-spec.ts'],
          // Disposable PostgreSQL and NATS containers start in the hooks.
          testTimeout: 60_000,
          hookTimeout: 120_000,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.spec.ts',
        'src/**/*.int-spec.ts',
        'src/**/*.fixture.ts',
        'src/**/testing/**',
        'src/main.ts',
        'src/migrate.ts',
        'src/telemetry.ts',
      ],
      reporter: ['text', 'lcov'],
    },
  },
});
