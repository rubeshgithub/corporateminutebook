import { describe, it, expect } from 'vitest';
import { createEventSchema, updateEventSchema, shareChangeDataSchema, formatShareChangeIssues } from '../src/schemas/event.schema';
import { createCompanySchema, updateCompanySchema } from '../src/schemas/company.schema';
import { deleteAccountSchema, updatePreferencesSchema } from '../src/schemas/auth.schema';

const COMPANY_ID = '507f1f77bcf86cd799439011';

const issuePaths = (r: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
    r.success ? [] : r.error!.issues.map((i) => i.path.join('.'));

describe('createEventSchema', () => {
    it('accepts a plain event and coerces effectiveDate to a Date', () => {
        const r = createEventSchema.safeParse({
            companyId: COMPANY_ID, eventType: 'director_appointed', effectiveDate: '2026-01-15', data: { name: 'Jane' },
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.effectiveDate).toBeInstanceOf(Date);
    });

    it('rejects a malformed company id and an unknown event type', () => {
        expect(createEventSchema.safeParse({ companyId: 'nope', eventType: 'director_appointed', effectiveDate: '2026-01-15' }).success).toBe(false);
        expect(createEventSchema.safeParse({ companyId: COMPANY_ID, eventType: 'coup_detat', effectiveDate: '2026-01-15' }).success).toBe(false);
    });

    it('rejects an unparseable date', () => {
        const r = createEventSchema.safeParse({ companyId: COMPANY_ID, eventType: 'name_changed', effectiveDate: 'yesterday' });
        expect(issuePaths(r)).toContain('effectiveDate');
    });

    it('requires a positive whole share count and a class on share changes, under a data.* path', () => {
        const missing = createEventSchema.safeParse({ companyId: COMPANY_ID, eventType: 'shares_issued', effectiveDate: '2026-01-15' });
        expect(issuePaths(missing)).toEqual(expect.arrayContaining(['data.numberOfShares', 'data.sharesClass']));

        const zero = createEventSchema.safeParse({
            companyId: COMPANY_ID, eventType: 'shares_transferred', effectiveDate: '2026-01-15',
            data: { numberOfShares: 0, sharesClass: 'Class A' },
        });
        expect(issuePaths(zero)).toContain('data.numberOfShares');

        const fractional = createEventSchema.safeParse({
            companyId: COMPANY_ID, eventType: 'shares_cancelled', effectiveDate: '2026-01-15',
            data: { numberOfShares: 1.5, sharesClass: 'Class A' },
        });
        expect(issuePaths(fractional)).toContain('data.numberOfShares');

        const ok = createEventSchema.safeParse({
            companyId: COMPANY_ID, eventType: 'shares_issued', effectiveDate: '2026-01-15',
            data: { numberOfShares: 100, sharesClass: 'Class A', name: 'Jane', extra: 'kept' },
        });
        expect(ok.success).toBe(true);
    });

    it('does not apply the share-count rule to other event types', () => {
        const r = createEventSchema.safeParse({
            companyId: COMPANY_ID, eventType: 'dividend_declared', effectiveDate: '2026-01-15', data: { amount: 5000 },
        });
        expect(r.success).toBe(true);
    });

    it('caps event data at 32 KB and rejects non-object data', () => {
        const big = createEventSchema.safeParse({
            companyId: COMPANY_ID, eventType: 'name_changed', effectiveDate: '2026-01-15', data: { blob: 'x'.repeat(40_000) },
        });
        expect(big.success).toBe(false);
        const str = createEventSchema.safeParse({
            companyId: COMPANY_ID, eventType: 'name_changed', effectiveDate: '2026-01-15', data: 'just a string',
        });
        expect(str.success).toBe(false);
    });
});

describe('shareChangeDataSchema + formatShareChangeIssues', () => {
    it('formats every issue on one line with its path', () => {
        const r = shareChangeDataSchema.safeParse({ numberOfShares: -1, sharesClass: '' });
        expect(r.success).toBe(false);
        if (!r.success) {
            const line = formatShareChangeIssues(r.error);
            expect(line).toContain('numberOfShares:');
            expect(line).toContain('sharesClass:');
        }
    });
});

describe('updateEventSchema', () => {
    it('accepts a bare registryFilingNotApplicable toggle', () => {
        expect(updateEventSchema.safeParse({ registryFilingNotApplicable: true }).success).toBe(true);
    });
    it('rejects a string where a boolean is expected', () => {
        expect(updateEventSchema.safeParse({ registryFilingNotApplicable: 'yes' }).success).toBe(false);
    });
});

const baseCompany = {
    name: 'Acme Widgets Inc.',
    registeredOfficeAddress: { street: '1 Main St', city: 'Calgary', province: 'AB', postalCode: 'T2P 0A1' },
    recordsAddress: {},
    addressForService: {},
};

describe('createCompanySchema', () => {
    it('accepts a minimal company', () => {
        expect(createCompanySchema.safeParse(baseCompany).success).toBe(true);
    });

    it('requires a name', () => {
        const r = createCompanySchema.safeParse({ ...baseCompany, name: '   ' });
        expect(issuePaths(r)).toContain('name');
    });

    it('rejects minDirectors greater than maxDirectors, pointing at maxDirectors', () => {
        const r = createCompanySchema.safeParse({ ...baseCompany, minDirectors: 3, maxDirectors: 1 });
        expect(issuePaths(r)).toContain('maxDirectors');
    });

    it('rejects a shareholder whose class is not defined on the company', () => {
        const r = createCompanySchema.safeParse({
            ...baseCompany,
            shareClasses: [{ name: 'Class A', type: 'Common' }],
            shareholders: [
                { name: 'Jane', sharesClass: 'Class A', numberOfShares: 100 },
                { name: 'Bob',  sharesClass: 'Class Z', numberOfShares: 100 },
            ],
        });
        expect(issuePaths(r)).toEqual(['shareholders.1.sharesClass']);
    });

    it('caps schedule prose at 100K characters', () => {
        const ok = createCompanySchema.safeParse({ ...baseCompany, schedules: [{ name: 'Schedule A', content: 'x'.repeat(100_000) }] });
        expect(ok.success).toBe(true);
        const tooBig = createCompanySchema.safeParse({ ...baseCompany, schedules: [{ name: 'Schedule A', content: 'x'.repeat(100_001) }] });
        expect(issuePaths(tooBig)).toContain('schedules.0.content');
    });

    it('lower-cases and validates the authorizedBy email', () => {
        const r = createCompanySchema.safeParse({
            ...baseCompany, authorizedBy: { name: 'Jane', email: 'Jane@Example.CA', phone: '403-555-0100' },
        });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.authorizedBy?.email).toBe('jane@example.ca');
        const bad = createCompanySchema.safeParse({
            ...baseCompany, authorizedBy: { name: 'Jane', email: 'not-an-email', phone: '' },
        });
        expect(issuePaths(bad)).toContain('authorizedBy.email');
    });
});

describe('updateCompanySchema', () => {
    it('is partial — a single field update is valid', () => {
        expect(updateCompanySchema.safeParse({ name: 'Renamed Inc.' }).success).toBe(true);
    });
    it('still enforces the cross-field rules when both sides are present', () => {
        const r = updateCompanySchema.safeParse({ minDirectors: 5, maxDirectors: 2 });
        expect(issuePaths(r)).toContain('maxDirectors');
    });
});

describe('auth schemas', () => {
    it('deleteAccountSchema normalises the confirmation email', () => {
        const r = deleteAccountSchema.safeParse({ confirmEmail: '  Jane@Example.CA ' });
        expect(r.success).toBe(true);
        if (r.success) expect(r.data.confirmEmail).toBe('jane@example.ca');
    });
    it('deleteAccountSchema rejects a missing or malformed email', () => {
        expect(deleteAccountSchema.safeParse({}).success).toBe(false);
        expect(deleteAccountSchema.safeParse({ confirmEmail: 'jane' }).success).toBe(false);
    });
    it('updatePreferencesSchema requires a real boolean', () => {
        expect(updatePreferencesSchema.safeParse({ reminderOptOut: true }).success).toBe(true);
        expect(updatePreferencesSchema.safeParse({ reminderOptOut: 'true' }).success).toBe(false);
        expect(updatePreferencesSchema.safeParse({}).success).toBe(false);
    });
});
