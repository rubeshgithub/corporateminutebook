import { APIRequestContext } from '@playwright/test';

/**
 * Thin API helpers that mirror what the SPA does — so persona tests
 * stay short + readable ("create company, record event, download bundle")
 * instead of the raw fetch scaffolding.
 *
 * All helpers take the APIRequestContext returned by loginAs() so the
 * session cookie is carried automatically.
 */

export async function createCompany(api: APIRequestContext, corp: any): Promise<any> {
    const res = await api.post('/api/companies', { data: corp });
    if (!res.ok()) throw new Error(`createCompany failed: ${res.status()} — ${await res.text()}`);
    return res.json();
}

export async function recordEvent(api: APIRequestContext, args: {
    companyId:     string;
    eventType:     string;
    effectiveDate: string;
    data?:         Record<string, any>;
    notes?:        string;
}): Promise<any> {
    const res = await api.post('/api/events', { data: args });
    if (!res.ok()) throw new Error(`recordEvent(${args.eventType}) failed: ${res.status()} — ${await res.text()}`);
    return res.json();
}

/**
 * PDF endpoints render a full minute book through Puppeteer — measured at
 * 3–10s warm, longer on the first call of a run while Chrome cold-starts.
 * The global 12s actionTimeout is a good tight bound for UI interactions
 * but sits right on top of that range, so these calls flapped at random.
 * Give the document routes their own realistic ceiling instead of loosening
 * the timeout every other assertion relies on.
 */
const PDF_TIMEOUT_MS = 60_000;

export async function compileMinuteBook(api: APIRequestContext, companyId: string): Promise<Buffer> {
    const res = await api.post('/api/documents/compile', {
        data: { companyId, force: true },   // force skips the compliance gate
        timeout: PDF_TIMEOUT_MS,
    });
    if (!res.ok()) throw new Error(`compileMinuteBook failed: ${res.status()} — ${await res.text()}`);
    return Buffer.from(await res.body());
}

export async function downloadBundle(api: APIRequestContext, args: {
    companyId:  string;
    bundleType: 'bank' | 'dd' | 'cra';
}): Promise<Buffer> {
    const res = await api.post(`/api/documents/bundle/${args.bundleType}`, {
        data: { companyId: args.companyId },
        timeout: PDF_TIMEOUT_MS,
    });
    if (!res.ok()) throw new Error(`downloadBundle(${args.bundleType}) failed: ${res.status()} — ${await res.text()}`);
    return Buffer.from(await res.body());
}

export async function listCompanies(api: APIRequestContext): Promise<any[]> {
    const res = await api.get('/api/companies');
    if (!res.ok()) throw new Error(`listCompanies failed: ${res.status()}`);
    return res.json();
}
