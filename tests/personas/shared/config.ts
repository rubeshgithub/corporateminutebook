/**
 * Test-run config. Reads from env with sane localhost defaults so a bare
 * `npm test` works against a locally running dev stack.
 *
 * The API base URL is separate from the SPA base URL because the frontend
 * and backend run on different ports in dev. In staging they may still be
 * on different origins (Render static site vs. web service). Cookie flows
 * work across the two per the CORS + credentials setup on the server.
 */

export const API_URL = process.env.MINUTEBOOK_API_URL ?? 'http://localhost:5000';
export const APP_URL = process.env.MINUTEBOOK_URL     ?? 'http://localhost:5173';

export const TEST_TOKEN = process.env.TEST_MODE_TOKEN;

if (!TEST_TOKEN) {
    // Not throwing — Playwright surfaces this in the first test that tries
    // to log in, with a clear error. Throwing here would hide the failure
    // behind a config-loading error which is less obvious.
    console.warn('[persona-tests] TEST_MODE_TOKEN is not set — persona tests will fail at loginAs().');
}
