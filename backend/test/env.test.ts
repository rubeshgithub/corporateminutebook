import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { validateEnv } from '../src/config/env';
import { withEnv } from './helpers';

const env = withEnv([
    'NODE_ENV', 'MONGODB_URI', 'JWT_SECRET', 'FRONTEND_URL', 'S3_ATTACHMENTS_BUCKET',
    'ANTHROPIC_API_KEY', 'AWS_ACCESS_KEY_ID', 'DOCUSEAL_API_KEY', 'CRS_FEED_SECRET',
    'SENTRY_DSN', 'BACKEND_PUBLIC_URL',
]);

const LONG_SECRET = 'x'.repeat(48);

describe('validateEnv', () => {
    let exit: MockInstance;
    let error: MockInstance;
    let warn: MockInstance;

    beforeEach(() => {
        env.save();
        // A boot-time failure must never continue past process.exit — model
        // that by throwing, and assert on the throw.
        exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
            throw new Error(`process.exit(${code})`);
        }) as never);
        error = vi.spyOn(console, 'error').mockImplementation(() => {});
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        for (const k of ['FRONTEND_URL', 'S3_ATTACHMENTS_BUCKET', 'ANTHROPIC_API_KEY', 'AWS_ACCESS_KEY_ID',
            'DOCUSEAL_API_KEY', 'CRS_FEED_SECRET', 'SENTRY_DSN', 'BACKEND_PUBLIC_URL']) {
            delete process.env[k];
        }
        process.env.MONGODB_URI = 'mongodb://localhost/test';
        process.env.JWT_SECRET = LONG_SECRET;
    });
    afterEach(() => env.restore());

    it('exits when a required var is missing in any environment', () => {
        process.env.NODE_ENV = 'development';
        delete process.env.MONGODB_URI;
        expect(() => validateEnv()).toThrow('process.exit(1)');
        expect(exit).toHaveBeenCalledWith(1);
        expect(error).toHaveBeenCalledWith(expect.stringContaining('MONGODB_URI'));
    });

    it('treats a whitespace-only value as missing', () => {
        process.env.NODE_ENV = 'development';
        process.env.JWT_SECRET = '   ';
        expect(() => validateEnv()).toThrow('process.exit(1)');
        expect(error).toHaveBeenCalledWith(expect.stringContaining('JWT_SECRET'));
    });

    it('boots in development without the production-only vars, warning about each dormant feature', () => {
        process.env.NODE_ENV = 'development';
        expect(() => validateEnv()).not.toThrow();
        expect(exit).not.toHaveBeenCalled();
        const warned = warn.mock.calls.map((c) => String(c[0]));
        for (const name of ['FRONTEND_URL', 'S3_ATTACHMENTS_BUCKET', 'SENTRY_DSN', 'ANTHROPIC_API_KEY']) {
            expect(warned.some((w) => w.includes(name))).toBe(true);
        }
    });

    it('refuses to boot in production without FRONTEND_URL and S3_ATTACHMENTS_BUCKET', () => {
        process.env.NODE_ENV = 'production';
        expect(() => validateEnv()).toThrow('process.exit(1)');
        const msg = String(error.mock.calls[0][0]);
        expect(msg).toContain('FRONTEND_URL');
        expect(msg).toContain('S3_ATTACHMENTS_BUCKET');
    });

    it('boots in production with everything set, and only warns about a short JWT secret', () => {
        process.env.NODE_ENV = 'production';
        process.env.FRONTEND_URL = 'https://app.example.ca';
        process.env.S3_ATTACHMENTS_BUCKET = 'bucket';
        process.env.JWT_SECRET = 'short';
        expect(() => validateEnv()).not.toThrow();
        expect(exit).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('shorter than 32'));
    });

    it('does not warn about the secret length when it is long enough', () => {
        process.env.NODE_ENV = 'production';
        process.env.FRONTEND_URL = 'https://app.example.ca';
        process.env.S3_ATTACHMENTS_BUCKET = 'bucket';
        validateEnv();
        const warned = warn.mock.calls.map((c) => String(c[0]));
        expect(warned.some((w) => w.includes('shorter than 32'))).toBe(false);
    });
});
