import { describe, it, expect, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { protect, adminOnly } from '../src/middleware/authMiddleware';
import { makeReq, makeRes } from './helpers';

const SECRET = process.env.JWT_SECRET as string;

describe('protect', () => {
    it('401s when there is no session cookie', () => {
        const req = makeReq();
        const res = makeRes();
        const next = vi.fn();
        protect(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
        expect(req.user).toBeUndefined();
    });

    it('401s on a token signed with the wrong secret', () => {
        const req = makeReq({ cookies: { mb_auth: jwt.sign({ id: 'u1', role: 'business_owner' }, 'wrong') } });
        const res = makeRes();
        const next = vi.fn();
        protect(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('401s on an expired token', () => {
        const req = makeReq({ cookies: { mb_auth: jwt.sign({ id: 'u1', role: 'business_owner' }, SECRET, { expiresIn: -10 }) } });
        const res = makeRes();
        const next = vi.fn();
        protect(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('ignores a Bearer header — the cookie is the only accepted credential', () => {
        const req = makeReq({ headers: { authorization: `Bearer ${jwt.sign({ id: 'u1', role: 'business_owner' }, SECRET)}` } });
        const res = makeRes();
        const next = vi.fn();
        protect(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(401);
    });

    it('populates req.user and calls next on a valid cookie', () => {
        const req = makeReq({ cookies: { mb_auth: jwt.sign({ id: 'u1', role: 'business_owner' }, SECRET) } });
        const res = makeRes();
        const next = vi.fn();
        protect(req, res, next);
        expect(next).toHaveBeenCalledOnce();
        expect(res.status).not.toHaveBeenCalled();
        expect(req.user).toEqual({ id: 'u1', role: 'business_owner' });
    });
});

describe('adminOnly', () => {
    it('403s a non-admin and an unauthenticated request', () => {
        for (const user of [undefined, { id: 'u1', role: 'business_owner' }]) {
            const req = makeReq();
            req.user = user;
            const res = makeRes();
            const next = vi.fn();
            adminOnly(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.statusCode).toBe(403);
        }
    });

    it('passes an admin through', () => {
        const req = makeReq();
        req.user = { id: 'u1', role: 'admin' };
        const next = vi.fn();
        adminOnly(req, makeRes(), next);
        expect(next).toHaveBeenCalledOnce();
    });
});
