import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateBody, validateParams, zodErrorResponse } from '../src/middleware/validate';
import { shortString, objectId } from '../src/schemas/common';
import { makeReq, makeRes } from './helpers';

const schema = z.object({ name: shortString.min(1, 'Name is required.'), count: z.number().int() });

describe('validateBody', () => {
    it('replaces req.body with the parsed, trimmed output and calls next', () => {
        const req = makeReq({ body: { name: '  Acme  ', count: 3, stray: 'dropped' } });
        const res = makeRes();
        const next = vi.fn();
        validateBody(schema)(req, res, next);
        expect(next).toHaveBeenCalledOnce();
        expect(req.body).toEqual({ name: 'Acme', count: 3 });
    });

    it('400s with the first issue as "path: message" plus the full issue list', () => {
        const req = makeReq({ body: { name: '', count: 1.5 } });
        const res = makeRes();
        const next = vi.fn();
        validateBody(schema)(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.body.error).toBe('name: Name is required.');
        expect(res.body.issues.map((i: { path: string }) => i.path)).toEqual(['name', 'count']);
    });

    it('400s on a non-object body without throwing', () => {
        const req = makeReq({ body: 'text' });
        const res = makeRes();
        const next = vi.fn();
        expect(() => validateBody(schema)(req, res, next)).not.toThrow();
        expect(res.statusCode).toBe(400);
    });
});

describe('validateParams', () => {
    it('stores the parsed params on req.validatedParams', () => {
        const req = makeReq({ params: { id: '507f1f77bcf86cd799439011' } });
        const next = vi.fn();
        validateParams(z.object({ id: objectId }))(req, makeRes(), next);
        expect(next).toHaveBeenCalledOnce();
        expect(req.validatedParams).toEqual({ id: '507f1f77bcf86cd799439011' });
    });

    it('400s with a generic message on a bad id', () => {
        const req = makeReq({ params: { id: 'nope' } });
        const res = makeRes();
        const next = vi.fn();
        validateParams(z.object({ id: objectId }))(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ error: 'Invalid URL parameter.' });
    });
});

describe('zodErrorResponse', () => {
    it('mirrors the validateBody shape', () => {
        const r = schema.safeParse({});
        expect(r.success).toBe(false);
        if (!r.success) {
            const out = zodErrorResponse(r.error);
            expect(out.error.startsWith('name: ')).toBe(true);
            expect(out.issues.length).toBe(2);
        }
    });
});
