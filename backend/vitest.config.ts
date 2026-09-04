import { defineConfig } from 'vitest/config';

/**
 * Unit tests live in backend/test/ — outside tsconfig's `src` rootDir so
 * `npm run build` never emits them. They cover the pure, DB-free layers
 * (auth middleware, CSRF guard, env validation, Zod contracts, share
 * redaction, error helper). Anything that needs Mongo or Puppeteer belongs
 * in the Playwright persona suite under tests/.
 */
export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        restoreMocks: true,
        env: {
            // Every signing helper reads this at call time. Long enough to
            // pass the production length check in env.ts.
            JWT_SECRET: 'unit-test-secret-0123456789abcdef0123456789abcdef',
        },
    },
});
