import { APIRequestContext, BrowserContext, request } from '@playwright/test';
import { API_URL, APP_URL, TEST_TOKEN } from './config';

/**
 * Mints an authenticated session for the given test email using the
 * env-guarded /api/auth/test-mint-session endpoint, then attaches the
 * resulting httpOnly cookie to the given browser context so subsequent
 * page loads are authenticated.
 *
 * The paired APIRequestContext returned here re-uses the same cookie —
 * hand it to any helper that needs to call the API on behalf of the
 * persona (create company, record event, download bundle).
 */
export async function loginAs(context: BrowserContext, email: string): Promise<APIRequestContext> {
    if (!TEST_TOKEN) {
        throw new Error(
            'TEST_MODE_TOKEN env var is not set. Set it in your shell + on the backend (TEST_MODE_ENABLED=true) before running persona tests.',
        );
    }

    // A dedicated request context lets Playwright manage its own cookie jar.
    // We call test-mint-session through it — the Set-Cookie header lands in
    // that jar — and then port those cookies into the browser context.
    //
    // The Origin header is not optional: the API's CSRF guard rejects any
    // cookie-authenticated write that doesn't declare a recognized origin.
    // A real browser always sends one on POST; APIRequestContext does not,
    // so we set it explicitly to keep these calls faithful to the SPA.
    const apiContext = await request.newContext({
        baseURL: API_URL,
        extraHTTPHeaders: { Origin: APP_URL },
    });
    const res = await apiContext.post('/api/auth/test-mint-session', {
        data:    { email },
        headers: { 'x-test-token': TEST_TOKEN, 'Content-Type': 'application/json' },
    });
    if (!res.ok()) {
        const body = await res.text();
        throw new Error(`test-mint-session failed: ${res.status()} — ${body}`);
    }
    const userData = await res.json();

    // Copy every cookie the server set into the browser context so page
    // navigations arrive authenticated. Cookie domain must match the
    // browser's origin — for cross-origin dev (5173 + 5000) each cookie
    // is scoped to its origin server, which Playwright honours.
    const { cookies } = await apiContext.storageState();
    if (cookies.length > 0) await context.addCookies(cookies);

    // The SPA's PrivateRoute guard reads user metadata from localStorage
    // (the httpOnly auth cookie is server-side only, so the client can't
    // introspect it directly). Without this, the browser hits /dashboard,
    // the guard sees isAuthenticated=false, and bounces to the Landing
    // page — the test would then fail against copy that has nothing to do
    // with the persona flow. addInitScript runs before every page load in
    // this context, so the SPA sees the user on its very first render.
    await context.addInitScript((user: any) => {
        try { window.localStorage.setItem('user', JSON.stringify(user)); } catch { /* ignore */ }
    }, {
        _id:   userData._id,
        name:  userData.name,
        email: userData.email,
        role:  userData.role,
    });

    return apiContext;
}

/**
 * Convenience wrapper: hand back a fresh test email tied to this run so
 * personas don't collide when tests run concurrently. Reruns of the same
 * suite land the same email (deterministic on the run identifier)
 * unless FRESH_EMAIL is set — useful when you want to test the
 * first-run empty state.
 */
export function testEmailFor(persona: string): string {
    if (process.env.FRESH_EMAIL === 'true') {
        return `${persona}+${Date.now()}@personatest.minutebook.local`;
    }
    return `${persona}@personatest.minutebook.local`;
}
