import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { loginAs, testEmailFor } from './shared/auth';
import { dummyCorp } from './shared/fixtures';
import { createCompany, recordEvent, compileMinuteBook } from './shared/api';
import { validatePdf, describeResult } from './shared/pdf-validator';

/**
 * Business Owner persona — the "does the happy path work?" run.
 *
 * Simulates a founder who signs up, creates their corporation, records
 * a couple of routine changes (a director change + address change),
 * and downloads the compiled minute book to hand to their accountant.
 *
 * Verifies:
 *   - Dashboard renders after login
 *   - Company creation via API + shows up in listing
 *   - Event recording succeeds
 *   - Compile-minute-book endpoint returns a PDF with the expected
 *     top-level structure (articles, directors, share ledger, etc.)
 *   - PDF has at least a reasonable page count
 */

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts');

test.describe('Business Owner persona', () => {
    test('creates a company, records events, and compiles a minute book', async ({ page, context }) => {
        const email = testEmailFor('owner');
        const api = await loginAs(context, email);

        /* ─── Dashboard smoke ────────────────────────────────── */
        await page.goto('/dashboard');
        await expect(page.getByText(/Corporate Dashboard/i)).toBeVisible();

        /* ─── Create the corporation via API ─────────────────── */
        const corp = dummyCorp({
            name:              'Prairie Owner Ventures Ltd.',
            incorporationDate: '2019-06-01',
            fiscalYearEnd:     '12-31',
            annualReturnDueDate: '06-01',
        });
        const created = await createCompany(api, corp);
        expect(created._id).toBeTruthy();

        /* ─── Verify the dashboard now shows it ──────────────── */
        await page.reload();
        await expect(page.getByText(corp.name)).toBeVisible();

        /* ─── Record two events an owner would routinely add ── */
        await recordEvent(api, {
            companyId:     created._id,
            eventType:     'director_appointed',
            effectiveDate: '2024-04-10',
            data: {
                firstName: 'Sam', lastName: 'Newcomer',
                address: '789 Elgin St', residentCanadian: true,
                email: 'sam.newcomer@personatest.local',
            },
            notes: 'Persona: owner — routine addition.',
        });

        await recordEvent(api, {
            companyId:     created._id,
            eventType:     'address_changed',
            effectiveDate: '2024-05-15',
            data: {
                addressType: 'registered',
                address:  { street: '999 New Way', city: 'Calgary', province: 'AB', postalCode: 'T2P2G8', country: 'Canada' },
            },
            notes: 'Persona: owner — moved offices.',
        });

        /* ─── Compile + validate PDF ────────────────────────── */
        const pdfBuffer = await compileMinuteBook(api, created._id);

        // Save the artifact so a failed run leaves a diagnosable PDF on disk.
        fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
        const artifactPath = path.join(ARTIFACT_DIR, 'business-owner-minute-book.pdf');
        fs.writeFileSync(artifactPath, pdfBuffer);

        const result = await validatePdf(pdfBuffer, {
            expectedSections: [
                corp.name.toUpperCase(),   // company name renders as ALL CAPS in the header
                'ARTICLES OF INCORPORATION',
                'CORPORATE RESOLUTIONS',   // section VIII header (case-preserving inside minute_book.ejs)
                'Board (Director) Resolutions',
                'Sam Newcomer',           // the director we appointed should show up
            ],
            forbiddenContent: ['undefined', '[object Object]', 'null null'],
            minPages: 8,   // a real minute book has articles + registers + resolutions
        });

        expect(result.ok, describeResult('business-owner minute book', result)).toBeTruthy();
    });
});
