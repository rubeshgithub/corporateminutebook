import { Response } from 'express';
import * as Sentry from '@sentry/node';

/**
 * Standard 500 response.
 *
 * Controllers used to return `error.message` straight to the client, which
 * leaked Mongoose validation internals, AWS SDK errors, and — via the DocuSeal
 * service — full upstream response bodies. The real error still reaches the
 * server log with a context tag for debugging; the client gets a stable,
 * non-revealing message.
 *
 * `context` should name the operation, e.g. 'compileMinuteBook'. It is the
 * grep handle when something shows up in the logs, and the natural place for a
 * Sentry `captureException` call once a DSN is configured.
 */
export function serverError(res: Response, context: string, error: unknown, clientMessage?: string) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    console.error(`[${context}] ${detail}`);
    // No-op when Sentry.init didn't run (no DSN). The context tag is the
    // grouping handle — same string the log line above carries.
    Sentry.captureException(error instanceof Error ? error : new Error(detail), {
        tags: { context },
    });
    return res.status(500).json({
        error: clientMessage ?? 'Something went wrong on our end. Please try again.',
    });
}
