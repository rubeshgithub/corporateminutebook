import { test, expect } from '@playwright/test';
import { request } from '@playwright/test';
import { loginAs, testEmailFor } from './shared/auth';
import { dummyCorp } from './shared/fixtures';
import { createCompany, recordEvent } from './shared/api';
import { API_URL } from './shared/config';

/**
 * Share-viewer persona — the anonymous outsider an owner sends a share
 * link to (a banker, a buyer's counsel, an accountant without a login).
 *
 * This spec is the regression net for two security fixes:
 *
 *   1. PII over-exposure: GET /api/share/:token must return ONLY the
 *      viewer projection (names, dates, share structure, registered
 *      office) — never emails, phones, home addresses, or internal
 *      state like incorporationDocumentFile / notifications / drift.
 *
 *   2. Cross-tenant IDOR: GET /api/incorporation/file/:filename must
 *      404 for any authenticated user who does not own the company the
 *      file belongs to. (Filenames leak — historically via the share
 *      payload itself — so possession must not grant access.)
 *
 * And the flip side: the shared page must still actually render for the
 * viewer with everything SharedCompanyView.tsx displays.
 */

/** Tiny but structurally valid single-page PDF — enough for byte-serving tests. */
const TINY_PDF = Buffer.from(
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n%%EOF\n',
);

/** Corp loaded with distinctive PII markers we can grep the payload for. */
function corpWithPII() {
    return dummyCorp({
        name: 'Share Exposure Test Corp.',
        directors: [
            {
                firstName: 'Dana', lastName: 'Boardmember',
                address: '999 Private Lane', city: 'Calgary', province: 'AB', postalCode: 'T2P1J9',
                residentCanadian: true, appointedDate: '2020-01-15',
                email: 'dana.private@sharetest.local',
                phone: '4035559999',
            },
        ],
        shareholders: [
            {
                holderType: 'Individual', name: 'Sam Holder',
                address: '888 Secret Crescent', city: 'Calgary', province: 'AB', postalCode: 'T2P1J9',
                sharesClass: 'Class A Common Voting Shares', numberOfShares: 100,
                votingPercent: 100,
            },
        ],
    });
}

test.describe('Share-viewer persona', () => {
    test('anonymous share payload renders the view but leaks no PII', async ({ page, context }) => {
        const email = testEmailFor('share-owner');
        const api = await loginAs(context, email);

        const created = await createCompany(api, corpWithPII());
        await recordEvent(api, {
            companyId:     created._id,
            eventType:     'annual_return_filed',
            effectiveDate: '2025-01-15',
            data:          { year: 2024 },
            notes:         'Persona: share-viewer — event so the shared timeline is non-empty.',
        });

        // Attach a real incorporation-document filename so we can prove the
        // share payload no longer discloses it (the old IDOR seed).
        const putDoc = await api.put(`/api/companies/${created._id}`, {
            data: { incorporationDocumentFile: 'deadbeef-0000-4000-8000-000000000000.pdf' },
        });
        expect(putDoc.ok()).toBeTruthy();

        const shareRes = await api.post(`/api/companies/${created._id}/shares`, {
            data: { label: 'Viewer test', expiresInDays: 7 },
        });
        expect(shareRes.status()).toBe(201);
        const share = await shareRes.json();

        /* ─── Anonymous API fetch — exactly what SharedCompanyView does ── */
        const anon = await request.newContext({ baseURL: API_URL });
        const res = await anon.get(`/api/share/${share.token}`);
        expect(res.status()).toBe(200);
        const payload = await res.json();
        const raw = JSON.stringify(payload);

        // Everything SharedCompanyView.tsx actually renders must be present.
        const c = payload.company;
        expect(c.name).toBe('Share Exposure Test Corp.');
        expect(c.corporateAccessNumber).toBeTruthy();
        expect(c.incorporationDate).toBeTruthy();
        expect(c.registeredOfficeAddress.street).toBe('123 Main Street');
        expect(c.registeredOfficeAddress.city).toBe('Calgary');
        expect(c.directors[0].firstName).toBe('Dana');
        expect(c.directors[0].lastName).toBe('Boardmember');
        expect(c.directors[0].appointedDate).toBeTruthy();
        expect(c.officers[0].name).toBe('Alex Officer');
        expect(c.officers[0].title).toBe('President');
        expect(c.shareClasses[0].name).toBe('Class A Common Voting Shares');
        expect(c.shareClasses[0].type).toBe('Common');
        expect(c.shareClasses[0].voting).toBe(true);
        expect(c.shareholders[0].name).toBe('Sam Holder');
        expect(c.shareholders[0].numberOfShares).toBe(100);
        expect(c.shareholders[0].sharesClass).toBe('Class A Common Voting Shares');
        expect(payload.events.length).toBeGreaterThanOrEqual(1);
        expect(payload.share.expiresAt).toBeTruthy();

        // Events are projected too: the raw `data` blob carries director home
        // addresses (auto-generated founding events) and the view never
        // renders it — only label, date, notes, attachment badges.
        for (const ev of payload.events) {
            expect(ev.eventType).toBeTruthy();
            expect(ev.data,   'event data blobs must not be exposed to viewers').toBeUndefined();
            expect(ev.userId, 'internal user ids must not be exposed to viewers').toBeUndefined();
        }

        // The PII we seeded must NOT appear anywhere in the payload.
        expect(raw).not.toContain('dana.private@sharetest.local'); // director email
        expect(raw).not.toContain('4035559999');                   // director phone
        expect(raw).not.toContain('999 Private Lane');             // director home address
        expect(raw).not.toContain('888 Secret Crescent');          // shareholder home address
        expect(raw).not.toContain('authorizer@personatest.local'); // authorizedBy email
        expect(raw).not.toContain('4035550100');                   // authorizedBy phone
        expect(raw).not.toContain(email);                          // owner login email

        // Internal state must not be present as keys on the company object.
        expect(raw).not.toContain('deadbeef-0000-4000-8000');      // incorporationDocumentFile value
        for (const key of [
            'incorporationDocumentFile', 'crsCustomerEmail', 'authorizedBy',
            'notifications', 'drift', 'origin', 'claimedAt', 'email', 'phone',
        ]) {
            expect(c[key], `company.${key} must not be exposed to viewers`).toBeUndefined();
        }
        await anon.dispose();

        /* ─── Browser render — the anonymous shared page still works ───── */
        const viewerContext = await page.context().browser()!.newContext();
        const viewerPage = await viewerContext.newPage();
        await viewerPage.goto(`/share/${share.token}`);
        await expect(viewerPage.getByText('Read-only view', { exact: false })).toBeVisible();
        await expect(viewerPage.getByText('Share Exposure Test Corp.')).toBeVisible();
        await expect(viewerPage.getByText('Dana Boardmember')).toBeVisible();
        await expect(viewerPage.getByText('Sam Holder')).toBeVisible();
        await expect(viewerPage.getByText('123 Main Street', { exact: false })).toBeVisible();
        await viewerContext.close();
    });

    test('incorporation document is owner-only — cross-tenant fetch 404s', async ({ browser }) => {
        /* ─── Victim: company + a real PDF in storage as its incorporation doc ── */
        const victimContext = await browser.newContext();
        const victimApi = await loginAs(victimContext, testEmailFor('share-victim'));
        const company = await createCompany(victimApi, corpWithPII());

        // Seed real bytes into upload storage via the attachment endpoint
        // (same putFile keyspace the incorporation serve reads from).
        const event = await recordEvent(victimApi, {
            companyId:     company._id,
            eventType:     'annual_return_filed',
            effectiveDate: '2025-01-15',
            data:          { year: 2024 },
        });
        const attachRes = await victimApi.post(`/api/events/${event._id}/attach`, {
            multipart: {
                role: 'supporting',
                file: { name: 'certificate.pdf', mimeType: 'application/pdf', buffer: TINY_PDF },
            },
        });
        expect(attachRes.ok()).toBeTruthy();
        const attached = await attachRes.json();
        const fileId = attached.attachments[attached.attachments.length - 1].fileId as string;
        expect(fileId).toMatch(/\.pdf$/);

        const putDoc = await victimApi.put(`/api/companies/${company._id}`, {
            data: { incorporationDocumentFile: fileId },
        });
        expect(putDoc.ok()).toBeTruthy();

        /* ─── Owner can fetch their own incorporation document ───────── */
        const ownerFetch = await victimApi.get(`/api/incorporation/file/${fileId}`);
        expect(ownerFetch.status()).toBe(200);
        expect(ownerFetch.headers()['content-type']).toContain('application/pdf');

        /* ─── Attacker: any other logged-in account must get 404 ─────── */
        const attackerContext = await browser.newContext();
        const attackerApi = await loginAs(attackerContext, testEmailFor('share-attacker'));
        const attackerFetch = await attackerApi.get(`/api/incorporation/file/${fileId}`);
        expect(attackerFetch.status(), 'cross-tenant fetch must 404, not serve the PDF').toBe(404);

        /* ─── Anonymous: no session at all must get 401 ──────────────── */
        const anon = await request.newContext({ baseURL: API_URL });
        const anonFetch = await anon.get(`/api/incorporation/file/${fileId}`);
        expect(anonFetch.status()).toBe(401);

        await anon.dispose();
        await attackerContext.close();
        await victimContext.close();
    });
});
