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

/**
 * Absent in production → the app boots but is silently broken. FRONTEND_URL
 * backs both the CORS allowlist and the CSRF origin check, so without it every
 * authenticated write from the real SPA is rejected as a foreign origin. Fail
 * loudly at boot instead of serving an app where saving anything 403s.
 */
const REQUIRED_IN_PRODUCTION = ['FRONTEND_URL'] as const;

/** Absent → a specific feature silently no-ops. Worth saying out loud. */
const FEATURE_VARS: Array<{ name: string; disables: string }> = [
    { name: 'ANTHROPIC_API_KEY', disables: 'incorporation-PDF parsing' },
    { name: 'AWS_ACCESS_KEY_ID', disables: 'email sending (SES) and S3 uploads' },
    { name: 'S3_ATTACHMENTS_BUCKET', disables: 'durable attachment storage (falls back to local disk)' },
    { name: 'DOCUSEAL_API_KEY', disables: 'e-signature' },
    { name: 'CRS_FEED_SECRET', disables: 'the CRS order webhook' },
    // Only reached outside production — in production it is fatal above.
    { name: 'FRONTEND_URL', disables: 'CORS and CSRF origin checks (falls back to localhost)' },
];

export function validateEnv(): void {
    const isProd = process.env.NODE_ENV === 'production';
    const required = [...REQUIRED, ...(isProd ? REQUIRED_IN_PRODUCTION : [])];
    const missing = required.filter((name) => !process.env[name]?.trim());

    if (missing.length > 0) {
        console.error(
            `[env] Missing required environment variable(s): ${missing.join(', ')}.\n` +
            '[env] Set them in the host environment (see .env.example) and redeploy.',
        );
        process.exit(1);
    }

    // Deliberately a warning, not a fatal. A short secret is weaker than we'd
    // like but the server still functions correctly with it — refusing to boot
    // would turn a security nit into an outage on an already-running deploy.
    if (isProd && (process.env.JWT_SECRET as string).length < 32) {
        console.warn(
            '[env] JWT_SECRET is shorter than 32 characters. Rotate it to a longer random value:\n' +
            '[env]   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"\n' +
            '[env] Note that rotating it signs every user out.',
        );
    }

    for (const { name, disables } of FEATURE_VARS) {
        if (!process.env[name]?.trim()) {
            console.warn(`[env] ${name} is not set — ${disables} is disabled.`);
        }
    }
}
