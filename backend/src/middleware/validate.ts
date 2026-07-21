import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Generic Zod body validator. Runs before the controller so `req.body` reaches
 * the handler already parsed/coerced and typed to the schema's inferred shape.
 *
 * Why: every write endpoint was assigning `req.body` straight to Mongoose. Any
 * curl / mobile / malicious client could push malformed docs into the DB.
 * Frontend Zod alone doesn't help — it's trivially bypassed. This middleware
 * is the API's actual contract.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
    return (req: Request, res: Response, next: NextFunction) => {
        const parsed = schema.safeParse(req.body);
        if (!parsed.success) {
            const first = parsed.error.issues[0];
            const path = first?.path?.join('.') || 'body';
            return res.status(400).json({
                error: first ? `${path}: ${first.message}` : 'Invalid request body.',
                issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
            });
        }
        // Replace body with the coerced/stripped output so controllers see the
        // typed shape rather than whatever the client sent.
        req.body = parsed.data;
        next();
    };
}

/** Same idea for req.params (typically for id checks). */
export function validateParams<T>(schema: ZodSchema<T>) {
    return (req: Request, res: Response, next: NextFunction) => {
        const parsed = schema.safeParse(req.params);
        if (!parsed.success) {
            return res.status(400).json({ error: 'Invalid URL parameter.' });
        }
        (req as any).validatedParams = parsed.data;
        next();
    };
}

/** Convenience: consistent Zod error-response shape when caught elsewhere. */
export function zodErrorResponse(err: ZodError): { error: string; issues: Array<{ path: string; message: string }> } {
    const first = err.issues[0];
    const path = first?.path?.join('.') || 'body';
    return {
        error: first ? `${path}: ${first.message}` : 'Invalid input.',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
}
