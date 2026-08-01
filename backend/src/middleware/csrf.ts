import { Request, Response, NextFunction } from 'express';

/**
 * Origin-based CSRF protection.
 *
 * The auth cookie is `sameSite: 'none'` in production (the SPA and API live on
 * separate Render domains), so the browser attaches it to cross-site requests.
 * Combined with `express.urlencoded`, that means a form on any website could
 * fire an authenticated state-changing POST at this API. CORS does not help:
 * it blocks *reading* the response, not sending the request.
 *
 * The rule: a state-changing request that carries our auth cookie must declare
 * an Origin we recognize. That scopes the check precisely to the attack —
 * ambient cookie authority — and leaves everything else alone:
 *
 *   - The CRS webhook sends no cookie and is HMAC-authenticated → exempt.
 *   - curl / server-to-server callers send no cookie → exempt.
 *   - Public share links are GETs → exempt (safe methods are never checked).
 *
 * Some browsers historically omitted Origin on same-origin form posts, so we
 * fall back to Referer's origin before rejecting.
 */

const AUTH_COOKIE = 'mb_auth';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Origins allowed to drive cookie-authenticated writes. */
function allowedOrigins(): string[] {
    const configured = process.env.FRONTEND_URL;
    return configured ? [configured] : ['http://localhost:5173', 'http://localhost:3000'];
}

function requestOrigin(req: Request): string | null {
    const origin = req.get('origin');
    if (origin) return origin;

    // Fall back to the Referer's origin component.
    const referer = req.get('referer');
    if (!referer) return null;
    try {
        return new URL(referer).origin;
    } catch {
        return null;
    }
}

export const csrfGuard = (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method)) return next();

    // No auth cookie means no ambient authority to abuse.
    const hasAuthCookie = Boolean((req as Request & { cookies?: Record<string, string> }).cookies?.[AUTH_COOKIE]);
    if (!hasAuthCookie) return next();

    const origin = requestOrigin(req);
    if (origin && allowedOrigins().includes(origin)) return next();

    return res.status(403).json({
        error: 'Request blocked: unrecognized origin. Refresh the page and try again.',
    });
};
