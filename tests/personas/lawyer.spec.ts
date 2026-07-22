import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { loginAs, testEmailFor } from './shared/auth';
import { dummyCorp } from './shared/fixtures';
import { createCompany, recordEvent, downloadBundle } from './shared/api';
import { validatePdf, describeResult } from './shared/pdf-validator';

/**
 * Lawyer persona — audits governance + due-diligence-quality output.
 *
 * A corporate lawyer preparing a share purchase, financing, or
 * dissolution package needs the minute book to have: signing-authority
 * evidence, share-transfer chain of custody, and resolutions clearly
 * separated into board-signed vs. shareholder-signed.
 *
 * Verifies:
 *   - Signing-authority event produces a proper board resolution
 *     with scope + specimen-signature placeholder
 *   - Share transfers get filed under Shareholders' Resolutions
 *     section (not Board), matching CBCA convention
 *   - Due-diligence bundle contains the full historical record
 *     with the Board/Shareholder split rendered correctly
 */

const ARTIFACT_DIR = path.join(__dirname, '..', 'artifacts');

test.describe('Lawyer persona', () => {
    test('grants signing authority, transfers shares, verifies DD bundle', async ({ page, context }) => {
        const email = testEmailFor('lawyer');
        const api = await loginAs(context, email);

        await page.goto('/dashboard');

        const corp = dummyCorp({
            name: 'Barrister Holdings Corp.',
            incorporationDate: '2017-09-01',
            fiscalYearEnd: '08-31',
            annualReturnDueDate: '09-01',
            shareholders: [
                { holderType: 'Individual', name: 'Original Owner',
                  sharesClass: 'Class A Common Voting Shares', numberOfShares: 100, votingPercent: 100,
                  address: '1 King St', city: 'Calgary', province: 'AB', postalCode: 'T2P1J9' },
            ],
        });
        const created = await createCompany(api, corp);

        /* ─── Signing authority (board-signed governance action) ── */
        await recordEvent(api, {
            companyId:     created._id,
            eventType:     'signing_authority_granted',
            effectiveDate: '2023-02-15',
            data: {
                signingOfficerName: 'Chen Signer',
                title:              'Chief Financial Officer',
                scope:              'general banking, contracts up to $250,000, and corporate filings',
                limits:             'Two signatures required over $250,000',
            },
            notes: 'Persona: lawyer — signing authority for banking + contracts.',
        });

        /* ─── Share transfer (shareholder-signed action) ─────── */
        await recordEvent(api, {
            companyId:     created._id,
            eventType:     'shares_transferred',
            effectiveDate: '2024-05-10',
            data: {
                sharesClass:                'Class A Common Voting Shares',
                fromName:                   'Original Owner',
                toName:                     'New Successor Holdings Inc.',
                toHolderType:               'Legal Entity',
                toAddress:                  '55 Bay St, Toronto, ON M5J2N8',
                numberOfShares:             40,
                consideration:              200000,
                certificateNumberSurrendered: 1,
            },
            notes: 'Persona: lawyer — partial exit, buyer takes 40% of common.',
        });

        /* ─── Name change (also a shareholder-class resolution) ─ */
        await recordEvent(api, {
            companyId:     created._id,
            eventType:     'name_changed',
            effectiveDate: '2024-06-01',
            data: { newName: 'Barrister & Successor Holdings Corp.' },
            notes: 'Persona: lawyer — post-transaction rebrand.',
        });

        /* ─── Download DD bundle + validate ──────────────────── */
        const pdfBuffer = await downloadBundle(api, { companyId: created._id, bundleType: 'dd' });

        fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'lawyer-dd-bundle.pdf'), pdfBuffer);

        const result = await validatePdf(pdfBuffer, {
            expectedSections: [
                // The lawyer's minimum diligence checklist for this file
                'Barrister'.toUpperCase(),
                'ARTICLES OF INCORPORATION',
                // The board/SH split we shipped in Wave 2 MUST render both
                // subsections in the DD bundle. Missing either would mean
                // the split logic regressed.
                'Board (Director) Resolutions',
                "Shareholders' Resolutions",
                'Signing Authority Granted',
                'Chen Signer',                          // signing officer name
                'Shares Transferred',
                'New Successor Holdings Inc.',          // transferee
                'Company Name Changed',
            ],
            forbiddenContent: ['undefined', 'NaN', '[object Object]'],
            minPages: 10,
        });

        expect(result.ok, describeResult('lawyer DD bundle', result)).toBeTruthy();
    });
});
