import { test, expect } from '@playwright/test';
import { loginAs, testEmailFor } from './shared/auth';
import { dummyCorp } from './shared/fixtures';
import { createCompany, recordEvent } from './shared/api';

/**
 * Event-layer validation — share-change hardening.
 *
 * shares_issued / shares_transferred / shares_cancelled write directly into
 * company.shareholders via applyEventToCompany, so their payloads are held
 * to the same strictness company.schema.ts applies to direct shareholder
 * writes: whole positive share counts and a share class that exists on the
 * company. Before this, a fractional count (33.5) printed on certificates
 * and an unknown class rendered fallback certificates with no par-value
 * statement.
 *
 * These tests hit the API directly (no browser) — the same surface a
 * bypassed SPA or curl would use, which is exactly what the boundary
 * schema exists to defend.
 */

test.describe('Share-change event validation', () => {
    test('rejects fractional counts + unknown classes, accepts whole-number issuance', async ({ context }) => {
        const email = testEmailFor('validation');
        const api = await loginAs(context, email);

        const corp = dummyCorp({ name: `Event Validation Corp ${Date.now().toString(36)}` });
        const created = await createCompany(api, corp);

        // Raw POST (not the recordEvent helper) so a 400 can be inspected
        // instead of thrown.
        const post = (data: Record<string, any>, eventType = 'shares_issued') =>
            api.post('/api/events', {
                data: { companyId: created._id, eventType, effectiveDate: '2024-06-01', data },
            });

        /* ─── Fractional share count — the old bare number input allowed 33.5 ── */
        let res = await post({ name: 'Frac Holder', sharesClass: 'Class A Common Voting Shares', numberOfShares: 33.5 });
        expect(res.status()).toBe(400);
        expect((await res.json()).error).toContain('whole number');

        /* ─── Zero and missing counts ────────────────────────────────────────── */
        res = await post({ name: 'Zero Holder', sharesClass: 'Class A Common Voting Shares', numberOfShares: 0 });
        expect(res.status()).toBe(400);

        res = await post({ name: 'No Count Holder', sharesClass: 'Class A Common Voting Shares' });
        expect(res.status()).toBe(400);

        /* ─── Share class that isn't defined on the company ──────────────────── */
        res = await post({ name: 'Ghost Class Holder', sharesClass: 'Class Z Phantom', numberOfShares: 10 });
        expect(res.status()).toBe(400);
        expect((await res.json()).error).toContain('not defined on this company');

        /* ─── Same rules on transfers + cancellations ────────────────────────── */
        res = await post({
            fromName: 'Alex Shareholder', toName: 'Buyer Inc.',
            sharesClass: 'Class A Common Voting Shares', numberOfShares: 12.25,
        }, 'shares_transferred');
        expect(res.status()).toBe(400);

        res = await post({
            holderName: 'Alex Shareholder', sharesClass: 'Class Z Phantom', numberOfShares: 5,
        }, 'shares_cancelled');
        expect(res.status()).toBe(400);

        /* ─── Well-formed issuance still lands + advances the snapshot ───────── */
        const ok = await recordEvent(api, {
            companyId:     created._id,
            eventType:     'shares_issued',
            effectiveDate: '2024-06-01',
            data: {
                name:              'Whole Number Holdings Inc.',
                holderType:        'Legal Entity',
                sharesClass:       'Class A Common Voting Shares',
                numberOfShares:    250,
                considerationPaid: 250.00,
            },
        });
        expect(ok._id).toBeTruthy();

        const companiesRes = await api.get('/api/companies');
        const refreshed = (await companiesRes.json()).find((c: any) => c._id === created._id);
        const holder = refreshed.shareholders.find((s: any) => s.name === 'Whole Number Holdings Inc.');
        expect(holder?.numberOfShares).toBe(250);

        /* ─── Corrections (PUT) are held to the same rules ───────────────────── */
        let put = await api.put(`/api/events/${ok._id}`, {
            data: { data: { ...ok.data, numberOfShares: 99.9 } },
        });
        expect(put.status()).toBe(400);

        put = await api.put(`/api/events/${ok._id}`, {
            data: { data: { ...ok.data, sharesClass: 'Class Z Phantom' } },
        });
        expect(put.status()).toBe(400);

        put = await api.put(`/api/events/${ok._id}`, {
            data: { data: { ...ok.data, numberOfShares: 300 } },
        });
        expect(put.status()).toBe(200);
    });
});
