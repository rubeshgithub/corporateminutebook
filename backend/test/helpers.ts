import { vi } from 'vitest';

/**
 * Minimal Express stand-ins. Enough surface for middleware and helpers that
 * only touch `req.method`, `req.cookies`, `req.get()`, `req.body`,
 * `req.params`, `res.status()`, `res.json()`.
 */

export function makeReq(opts: {
    method?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    body?: unknown;
    params?: Record<string, string>;
} = {}) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.headers ?? {})) headers[k.toLowerCase()] = v;
    return {
        method:  opts.method ?? 'GET',
        cookies: opts.cookies ?? {},
        body:    opts.body,
        params:  opts.params ?? {},
        get:     (name: string) => headers[name.toLowerCase()],
    } as any;
}

export function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((code: number) => { res.statusCode = code; return res; });
    res.json = vi.fn((payload: unknown) => { res.body = payload; return res; });
    return res;
}

/** Snapshot the named env vars so a test can mutate them and put them back. */
export function withEnv(keys: string[]) {
    const saved: Record<string, string | undefined> = {};
    return {
        save() { for (const k of keys) saved[k] = process.env[k]; },
        restore() {
            for (const k of keys) {
                if (saved[k] === undefined) delete process.env[k];
                else process.env[k] = saved[k];
            }
        },
    };
}
