import jwt from 'jsonwebtoken';

/**
 * Signed unsubscribe tokens for reminder emails (CASL).
 *
 * Every commercial electronic message needs a working unsubscribe mechanism
 * that keeps working indefinitely — CASL gives recipients the right to
 * withdraw consent at any time, so these tokens deliberately never expire.
 * The token is a JWT over the recipient email with a distinct `purpose`
 * claim so a session token can never be replayed as an unsubscribe (or
 * vice versa).
 */

const PURPOSE = 'unsubscribe';

export function unsubscribeToken(email: string): string {
    return jwt.sign({ email: email.toLowerCase(), purpose: PURPOSE }, process.env.JWT_SECRET as string);
}

/** Returns the email the token was minted for, or null if invalid. */
export function verifyUnsubscribeToken(token: string): string | null {
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET as string) as { email?: string; purpose?: string };
        if (payload.purpose !== PURPOSE || !payload.email) return null;
        return payload.email;
    } catch {
        return null;
    }
}

/**
 * The link must point at the backend, not the SPA — it has to work from a
 * mail client with no session and render a confirmation without JS.
 * BACKEND_PUBLIC_URL is the backend's own public origin (the SPA's
 * VITE_API_URL counterpart); falls back to localhost for dev.
 */
export function unsubscribeUrl(email: string): string {
    const base = (process.env.BACKEND_PUBLIC_URL || 'http://localhost:5000').replace(/\/+$/, '');
    return `${base}/api/email/unsubscribe/${encodeURIComponent(unsubscribeToken(email))}`;
}
