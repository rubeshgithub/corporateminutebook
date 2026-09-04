import { describe, it, expect, vi, beforeEach } from 'vitest';
import { serverError } from '../src/utils/apiError';
import { makeRes } from './helpers';

describe('serverError', () => {
    let error: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { error = vi.spyOn(console, 'error').mockImplementation(() => {}); });

    it('returns a 500 with a stable, non-revealing message', () => {
        const res = makeRes();
        serverError(res, 'compileMinuteBook', new Error('E11000 duplicate key: users.email_1 dup key { email: "jane@example.ca" }'));
        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe('Something went wrong on our end. Please try again.');
        expect(JSON.stringify(res.body)).not.toContain('E11000');
        expect(JSON.stringify(res.body)).not.toContain('jane@example.ca');
    });

    it('logs the real error under the context tag', () => {
        serverError(makeRes(), 'compileMinuteBook', new Error('boom'));
        const line = String(error.mock.calls[0][0]);
        expect(line.startsWith('[compileMinuteBook]')).toBe(true);
        expect(line).toContain('boom');
    });

    it('uses the caller-supplied client message when given', () => {
        const res = makeRes();
        serverError(res, 'ctx', new Error('internal'), 'Failed to generate the minute book.');
        expect(res.body.error).toBe('Failed to generate the minute book.');
    });

    it('copes with non-Error throwables', () => {
        const res = makeRes();
        expect(() => serverError(res, 'ctx', 'a string was thrown')).not.toThrow();
        expect(res.statusCode).toBe(500);
        expect(String(error.mock.calls[0][0])).toContain('a string was thrown');
    });
});
