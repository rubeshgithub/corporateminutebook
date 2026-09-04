import { defineConfig } from 'vitest/config';

/**
 * Frontend unit tests — colocated `*.test.ts(x)` files under src/. jsdom
 * gives the store slices a real localStorage; component rendering tests
 * can be added on top without further config.
 */
export default defineConfig({
    test: {
        environment: 'jsdom',
        include: ['src/**/*.test.{ts,tsx}'],
        restoreMocks: true,
    },
});
