import { defineConfig } from '@playwright/test';

/**
 * MinuteBook persona test config. Tests hit the API directly for setup
 * (creating corp, recording events) and use the browser for verification
 * pages + navigation flows. Screenshots + videos captured on failure so
 * a broken persona run leaves you a scrollable timeline of what went
 * wrong instead of just "test failed."
 */

export default defineConfig({
    testDir:  './personas',
    timeout:  90_000,
    expect:   { timeout: 15_000 },
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ],
    outputDir: 'test-results',
    use: {
        baseURL:    process.env.MINUTEBOOK_URL     ?? 'http://localhost:5173',
        actionTimeout: 12_000,
        screenshot: 'only-on-failure',
        video:      'retain-on-failure',
        trace:      'retain-on-failure',
    },
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
});
