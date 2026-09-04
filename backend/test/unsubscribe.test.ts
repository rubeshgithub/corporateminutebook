import { describe, it, expect, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import { unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } from '../src/utils/unsubscribe';
import { withEnv } from './helpers';

const env = withEnv(['BACKEND_PUBLIC_URL']);

describe('CASL unsubscribe tokens', () => {
    afterEach(() => env.restore());

    it('round-trips the email, lower-cased', () => {
        const token = unsubscribeToken('Jane@Example.CA');
        expect(verifyUnsubscribeToken(token)).toBe('jane@example.ca');
    });

    it('rejects a session token even though it is signed with the same secret', () => {
        // Same JWT_SECRET, different purpose — a stolen session cookie must
        // not double as an unsubscribe link, and vice versa.
        const session = jwt.sign({ id: 'abc', role: 'business_owner' }, process.env.JWT_SECRET as string);
        expect(verifyUnsubscribeToken(session)).toBeNull();
    });

    it('rejects a token signed with another secret', () => {
        const forged = jwt.sign({ email: 'x@y.ca', purpose: 'unsubscribe' }, 'not-our-secret');
        expect(verifyUnsubscribeToken(forged)).toBeNull();
    });

    it('rejects garbage and empty input', () => {
        expect(verifyUnsubscribeToken('not-a-jwt')).toBeNull();
        expect(verifyUnsubscribeToken('')).toBeNull();
    });

    it('never expires — the right to withdraw consent has no deadline', () => {
        const token = unsubscribeToken('jane@example.ca');
        const payload = jwt.decode(token) as Record<string, unknown>;
        expect(payload.exp).toBeUndefined();
    });

    it('builds the link on BACKEND_PUBLIC_URL, tolerating a trailing slash', () => {
        env.save();
        process.env.BACKEND_PUBLIC_URL = 'https://api.example.ca/';
        const url = unsubscribeUrl('jane@example.ca');
        expect(url.startsWith('https://api.example.ca/api/email/unsubscribe/')).toBe(true);
        const token = decodeURIComponent(url.split('/unsubscribe/')[1]);
        expect(verifyUnsubscribeToken(token)).toBe('jane@example.ca');
    });

    it('falls back to localhost when BACKEND_PUBLIC_URL is unset', () => {
        env.save();
        delete process.env.BACKEND_PUBLIC_URL;
        expect(unsubscribeUrl('jane@example.ca').startsWith('http://localhost:5000/')).toBe(true);
    });
});
