import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { csrfGuard } from '../src/middleware/csrf';
import { makeReq, makeRes, withEnv } from './helpers';

const env = withEnv(['FRONTEND_URL']);
const APP = 'https://app.example.ca';

function run(reqOpts: Parameters<typeof makeReq>[0]) {
    const req = makeReq(reqOpts);
    const res = makeRes();
    const next = vi.fn();
    csrfGuard(req, res, next);
    return { res, next };
}

describe('csrfGuard', () => {
    beforeEach(() => { env.save(); process.env.FRONTEND_URL = APP; });
    afterEach(() => env.restore());

    it('lets safe methods through regardless of origin or cookie', () => {
        for (const method of ['GET', 'HEAD', 'OPTIONS']) {
            const { next, res } = run({ method, cookies: { mb_auth: 't' }, headers: { origin: 'https://evil.example' } });
            expect(next).toHaveBeenCalledOnce();
            expect(res.status).not.toHaveBeenCalled();
        }
    });

    it('lets cookie-less writes through — no ambient authority to abuse', () => {
        const { next } = run({ method: 'POST', headers: { origin: 'https://evil.example' } });
        expect(next).toHaveBeenCalledOnce();
    });

    it('allows a cookie-authenticated write from the configured SPA origin', () => {
        const { next } = run({ method: 'POST', cookies: { mb_auth: 't' }, headers: { origin: APP } });
        expect(next).toHaveBeenCalledOnce();
    });

    it('blocks a cookie-authenticated write from a foreign origin with 403', () => {
        const { next, res } = run({ method: 'POST', cookies: { mb_auth: 't' }, headers: { origin: 'https://evil.example' } });
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
        expect(res.body.error).toMatch(/unrecognized origin/i);
    });

    it('blocks a cookie-authenticated write that declares no origin at all', () => {
        const { next, res } = run({ method: 'DELETE', cookies: { mb_auth: 't' } });
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('falls back to the Referer origin when Origin is absent', () => {
        const ok = run({ method: 'POST', cookies: { mb_auth: 't' }, headers: { referer: `${APP}/dashboard?x=1` } });
        expect(ok.next).toHaveBeenCalledOnce();

        const bad = run({ method: 'POST', cookies: { mb_auth: 't' }, headers: { referer: 'https://evil.example/page' } });
        expect(bad.next).not.toHaveBeenCalled();
        expect(bad.res.statusCode).toBe(403);
    });

    it('treats an unparseable Referer as no origin', () => {
        const { next, res } = run({ method: 'POST', cookies: { mb_auth: 't' }, headers: { referer: 'not a url' } });
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(403);
    });

    it('matches the origin exactly — a look-alike host is foreign', () => {
        const { next } = run({ method: 'POST', cookies: { mb_auth: 't' }, headers: { origin: 'https://app.example.ca.evil.example' } });
        expect(next).not.toHaveBeenCalled();
    });

    it('defaults to the Vite dev origins when FRONTEND_URL is unset', () => {
        delete process.env.FRONTEND_URL;
        const { next } = run({ method: 'POST', cookies: { mb_auth: 't' }, headers: { origin: 'http://localhost:5173' } });
        expect(next).toHaveBeenCalledOnce();
    });
});
