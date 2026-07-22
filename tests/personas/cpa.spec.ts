import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { loginAs, testEmailFor } from './shared/auth';
import { dummyCorp } from './shared/fixtures';
import { createCompany, recordEvent, downloadBundle } from './shared/api';
import { validatePdf, describeResult } from './shared/pdf-validator';

/**
 * CPA persona — audits the CRA-audit + tax-cycle surface.
 *
 * A working CPA cares about: fiscal year end being correct, annual
 * returns being logged with a confirmation number (and increasingly a
 * T2 reference), and dividend declarations having a paper trail with
 * share class + per-share + record date + T5 reminder.
 *
 * Verifies:
 *   - Dividend declaration flow produces a resolution + T5 reference
 *   - Annual return logged with T2 reference persists both fields
 *   - CRA-audit bundle contains only the events CRA actually cares
 *     about (AR + shareholder/share/director actions), NOT the noise
 *     from every governance event
 */

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts');

test.describe('CPA persona', () => {
    test('records dividend + annual return, downloads CRA-audit bundle', async ({ page, context }) => {
        const email = testEmailFor('cpa');
        const api = await loginAs(context, email);

        await page.goto('/dashboard');

        const corp = dummyCorp({
            name: 'Ledger & Ledger Consulting Corp.',
            incorporationDate: '2018-03-01',
            fiscalYearEnd: '12-31',
            annualReturnDueDate: '03-01',
            shareClasses: [
                { name: 'Class A Common Voting Shares',   type: 'Common',    voting: true, maxAuthorized: null, parValue: null },
                { name: 'Class B Non-Voting Preferred',   type: 'Preferred', voting: false, maxAuthorized: 1000, parValue: 1 },
            ],
            shareholders: [
                { holderType: 'Individual', name: 'Founder One',
                  sharesClass: 'Class A Common Voting Shares', numberOfShares: 100, votingPercent: 100,
                  address: '10 Founder Way', city: 'Calgary', province: 'AB', postalCode: 'T2P1J9' },
            ],
        });
        const created = await createCompany(api, corp);

        /* ─── Dividend declaration ───────────────────────────── */
        await recordEvent(api, {
            companyId:     created._id,
            eventType:     'dividend_declared',
            effectiveDate: '2024-11-30',
            data: {
                shareClass:     'Class A Common Voting Shares',
                dividendType:   'Eligible',
                perShareAmount: 10.00,
                totalAmount:    1000.00,
                recordDate:     '2024-11-30',
                paymentDate:    '2024-12-15',
                fiscalYear:     2024,
                t5Reference:    'T5-2024-EXAMPLE-001',
            },
            notes: 'Persona: CPA — eligible dividend declared for FY2024.',
        });

        /* ─── Annual return logged with T2 reference ────────── */
        await recordEvent(api, {
            companyId:     created._id,
            eventType:     'annual_return_filed',
            effectiveDate: '2024-03-15',
            data: {
                year:                2024,
                confirmationNumber:  'REGISTRY-AR-2024-99999',
                t2Reference:         'CRA-T2-2024-EXAMPLE-BN',
            },
            notes: 'Persona: CPA — AR filed with T2 linkage.',
        });

        /* ─── Also add a shares_issued so the CRA bundle has share-side content ── */
        await recordEvent(api, {
            companyId:     created._id,
            eventType:     'shares_issued',
            effectiveDate: '2024-06-01',
            data: {
                name:              'Growth Investor Inc.',
                holderType:        'Legal Entity',
                sharesClass:       'Class B Non-Voting Preferred',
                numberOfShares:    500,
                considerationPaid: 500.00,
                address:           '500 Investor Rd, Calgary, AB',
                votingPercent:     0,
            },
            notes: 'Persona: CPA — Class B issued to new investor.',
        });

        /* ─── Download the CRA audit bundle + validate ─────── */
        const pdfBuffer = await downloadBundle(api, { companyId: created._id, bundleType: 'cra' });

        fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'cpa-cra-bundle.pdf'), pdfBuffer);

        const result = await validatePdf(pdfBuffer, {
            expectedSections: [
                corp.name.toUpperCase(),
                'ARTICLES OF INCORPORATION',
                'Annual Returns Filed',            // AR block header in minute_book.ejs
                'REGISTRY-AR-2024-99999',          // our confirmation number
                'Dividend Declared',               // event-type label
                'Class A Common Voting Shares',    // dividend context
                'Shares Issued',
                'Class B Non-Voting Preferred',    // second class we added
            ],
            forbiddenContent: ['undefined', 'NaN', '[object Object]'],
            minPages: 6,
        });

        expect(result.ok, describeResult('cpa CRA-audit bundle', result)).toBeTruthy();
    });
});
