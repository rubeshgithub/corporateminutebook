/**
 * Startup environment validation.
 *
 * Before this, a missing JWT_SECRET surfaced as a 500 on the first login
 * attempt — in production, hours after the deploy that caused it. Anything
 * the process cannot function without is checked here and fails the boot
 * loudly; anything that only disables a feature produces a warning so the
 * logs say which capability is dormant.
 */

/** Absent → the server cannot serve a single authenticated request. */
const REQUIRED = ['MONGODB_URI', 'JWT_SECRET'] as const;

/** Absent → a specific feature silently no-ops. Worth saying out loud. */
const FEATURE_VARS: Array<{ name: string; disables: string }> = [
    { name: 'ANTHROPIC_API_KEY', disables: 'incorporation-PDF parsing' },
    { name: 'AWS_ACCESS_KEY_ID', disables: 'email sending (SES) and S3 uploads' },
    { name: 'S3_ATTACHMENTS_BUCKET', disables: 'durable attachment storage (falls back to local disk)' },
    { name: 'DOCUSEAL_API_KEY', disables: 'e-signature' },
    { name: 'CRS_FEED_SECRET', disables: 'the CRS order webhook' },
    { name: 'FRONTEND_URL', disables: 'CORS and CSRF origin checks (falls back to localhost)' },
];

export function validateEnv(): void {
    const missing = REQUIRED.filter((name) => !process.env[name]?.trim());

    if (missing.length > 0) {
        console.error(
            `[env] Missing required environment variable(s): ${missing.join(', ')}.\n` +
            '[env] Set them in the host environment (see .env.example) and redeploy.',
        );
        process.exit(1);
    }

    if (process.env.NODE_ENV === 'production' && (process.env.JWT_SECRET as string).length < 32) {
        console.error('[env] JWT_SECRET must be at least 32 characters in production.');
        process.exit(1);
    }

    for (const { name, disables } of FEATURE_VARS) {
        if (!process.env[name]?.trim()) {
            console.warn(`[env] ${name} is not set — ${disables} is disabled.`);
        }
    }
}
