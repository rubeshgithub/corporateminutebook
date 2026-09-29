import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseProfileReportText, parseRegistryDate, detectRegistry } from '../src/services/profileReports/parsers';
import { buildImportPlan, hasBlocker, missingAnnualReturns } from '../src/services/profileReports/plan';

/*
 * Fixtures are the text layer of real registry reports with names, addresses
 * and numbers replaced by fictional ones; layout is untouched.
 */
const fixture = (name: string) =>
    fs.readFileSync(path.join(__dirname, 'fixtures', 'profile-reports', name), 'utf8');
const parse = (name: string) => {
    const r = parseProfileReportText(fixture(name));
    if (!r) throw new Error(`${name} not recognised`);
    return r;
};
const NOW = new Date('2026-09-29T12:00:00Z');
const codes = (plan: ReturnType<typeof buildImportPlan>) => plan.flags.map((f) => f.code);

describe('parseRegistryDate', () => {
    it('reads every date style the registries print', () => {
        expect(parseRegistryDate('September 13, 2018')).toBe('2018-09-13');
        expect(parseRegistryDate('February 03, 2025 12:05 PM Pacific')).toBe('2025-02-03');
        expect(parseRegistryDate('2026/08/21')).toBe('2026-08-21');
        expect(parseRegistryDate('2026-09-15 3:29 PM')).toBe('2026-09-15');
        expect(parseRegistryDate('13-Dec-2019')).toBe('2019-12-13');
    });

    it('returns null rather than guessing', () => {
        expect(parseRegistryDate('Not Available')).toBeNull();
        expect(parseRegistryDate('')).toBeNull();
        expect(parseRegistryDate('2026/13/40')).toBeNull();
    });
});

describe('detectRegistry', () => {
    it('recognises each registry and nothing else', () => {
        expect(detectRegistry(fixture('federal.txt'))).toBe('federal');
        expect(detectRegistry(fixture('bc-no-annual-report.txt'))).toBe('bc');
        expect(detectRegistry(fixture('ontario-professional.txt'))).toBe('on');
        expect(detectRegistry(fixture('alberta-extra-provincial.txt'))).toBe('ab');
        expect(detectRegistry('Invoice #123\nTotal due: $50')).toBeNull();
    });
});

describe('Corporations Canada corporate profile', () => {
    const r = parse('federal.txt');

    it('reads the corporation', () => {
        expect(r.reportDate).toBe('2026-09-15');
        expect(r.corporation).toMatchObject({
            name: '12345678 Canada Inc.', number: '1234567-8', businessNumber: '123456789RC0001',
            status: 'Active', incorporationDate: '2020-09-13', minDirectors: 1, maxDirectors: 10,
        });
        expect(r.registeredOffice).toEqual({ street: '10 Sample Avenue', city: 'Toronto', province: 'ON', postalCode: 'M5V 1A1', country: 'Canada' });
    });

    it('reads directors, annual filings and the significant-control register', () => {
        expect(r.directors.map((d) => d.name)).toEqual(['Alex Morgan']);
        expect(r.annualReturns).toEqual([{ year: 2024, filedOn: null }, { year: 2025, filedOn: null }]);
        expect(r.annualReturnAnniversary).toBe('09-13');
        expect(r.significantIndividuals).toHaveLength(1);
        expect(r.significantIndividuals[0]).toMatchObject({ name: 'ALEX MORGAN', since: '2020-09-13' });
        expect(r.significantIndividuals[0].description).toContain('More than 75% of the shares');
    });

    it('dates filed-but-undated returns on the anniversary and asks for residency confirmation', () => {
        const plan = buildImportPlan(r, NOW);
        expect(plan.jurisdiction).toBe('federal');
        const ar = plan.events.filter((e) => e.eventType === 'annual_return_filed');
        expect(ar.map((e) => [e.effectiveDate, e.data.year])).toEqual([['2024-09-13', 2024], ['2025-09-13', 2025]]);
        expect(codes(plan)).toEqual(expect.arrayContaining(['residency_check', 'significant_control_on_record', 'shareholders_needed']));
        expect(hasBlocker(plan)).toBe(false);
    });
});

describe('BC company summary', () => {
    it('reads offices and directors, and flags the missing first annual report', () => {
        const r = parse('bc-no-annual-report.txt');
        expect(r.corporation).toMatchObject({ name: '1234500 B.C. LTD.', number: 'BC1234500', businessNumber: '123456780BC0001', status: 'ACTIVE', incorporationDate: '2025-02-03' });
        expect(r.noAnnualReturnOnFile).toBe(true);
        expect(r.registeredOffice?.street).toBe('100 SAMPLE PLACE');
        expect(r.directors.map((d) => [d.firstName, d.lastName])).toEqual([['Dana', 'Rivers']]);

        const plan = buildImportPlan(r, NOW);
        expect(missingAnnualReturns(r, NOW)).toEqual([2026]);
        expect(codes(plan)).toContain('annual_returns_missing');
        expect(codes(plan)).not.toContain('stale_report');
    });

    it('keeps foreign director addresses whole and marks them non-resident', () => {
        const r = parse('bc-foreign-directors.txt');
        expect(r.directors.map((d) => d.name)).toEqual(['Omar Khan', 'Ravi Kumar Patel']);
        expect(r.directors[0].address).toBe('1 SAMPLE ROAD, PARKVIEW, JOHANNESBURG, GAUTENG 2193, SOUTH AFRICA');
        expect(r.annualReturns).toEqual([{ year: 2026, filedOn: '2026-01-05' }]);

        const plan = buildImportPlan(r, NOW);
        expect(plan.company.directors.map((d: any) => d.residentCanadian)).toEqual([false, false]);
        // BC summaries only show the latest report — earlier years are unknown, not missing.
        expect(missingAnnualReturns(r, NOW)).toEqual([]);
        expect(codes(plan)).toEqual(expect.arrayContaining(['stale_report', 'earlier_returns_not_listed']));
    });
});

describe('Ontario profile report', () => {
    const r = parse('ontario-professional.txt');

    it('reads directors and officers with their start dates', () => {
        expect(r.corporation).toMatchObject({ name: 'JANE DOE MEDICINE PROFESSIONAL CORPORATION', number: '1234567', incorporationDate: '2018-09-13', minDirectors: 1, maxDirectors: 5 });
        expect(r.directors).toEqual([expect.objectContaining({ name: 'JANE DOE', appointedDate: '2018-09-13', residentCanadian: true })]);
        expect(r.officers.map((o) => o.title)).toEqual(['President', 'Secretary']);
    });

    it('reads every annual return with its filing date', () => {
        expect(r.annualReturns.map((a) => [a.year, a.filedOn])).toEqual([
            [2019, '2020-02-05'], [2020, '2020-12-20'], [2021, '2024-03-28'], [2022, '2024-03-28'],
            [2023, '2024-03-28'], [2024, '2025-10-01'], [2025, '2026-04-24'],
        ]);
        expect(r.filings.find((f) => f.kind === 'initial_return')?.date).toBe('2018-11-08');
    });

    it('flags late returns, the professional corporation and a stale report', () => {
        const plan = buildImportPlan(r, NOW);
        const late = plan.flags.find((f) => f.code === 'annual_returns_late')!;
        expect(late.message).toContain('2021 and 2022');
        expect(codes(plan)).toEqual(expect.arrayContaining(['professional_corporation', 'stale_report']));
        expect(codes(plan)).not.toContain('director_dates_assumed');
        expect(plan.events.filter((e) => e.eventType === 'annual_return_filed')).toHaveLength(7);
    });
});

describe('Alberta corporate search', () => {
    it('recognises an extra-provincial registration and refuses to build the wrong book', () => {
        const r = parse('alberta-extra-provincial.txt');
        expect(r.corporation.extraProvincial).toEqual({ homeJurisdiction: 'CANADA', homeNumber: '12345670', formedOn: '2020-01-04' });
        expect(r.corporation.incorporationDate).toBe('2020-01-04');
        expect(r.shareholders.map((s) => [s.name, s.votingPercent])).toEqual([['ANNA BROWN', 50], ['LISA MARIE GREEN', 50]]);

        const plan = buildImportPlan(r, NOW);
        expect(plan.jurisdiction).toBe('federal');
        expect(hasBlocker(plan)).toBe(true);
        expect(plan.flags.find((f) => f.code === 'extra_provincial')!.message).toContain('Corporations Canada corporate profile');
    });

    it('re-pairs the column layout and stops at scanned pages instead of inventing gaps', () => {
        const r = parse('alberta-society-scanned.txt');
        expect(r.reportDate).toBe('2026-08-06');
        expect(r.corporation).toMatchObject({ name: 'EXAMPLE SHELTER SOCIETY', number: '500000001', entityType: 'Alberta Society', incorporationDate: '1986-07-07' });
        expect(r.registeredOffice).toEqual({ street: '100 EXAMPLE AVE NW', city: 'EDMONTON', province: 'AB', postalCode: 'T5H 1A1', country: 'Canada' });
        expect(r.filings).toEqual([{ date: '2009-01-27', label: 'Revived / restored', kind: 'revival' }]);

        const plan = buildImportPlan(r, NOW, { unreadPages: [2, 3, 4] });
        expect(codes(plan)).toEqual(expect.arrayContaining(['not_a_business_corporation', 'unread_pages', 'revived']));
        expect(codes(plan)).not.toContain('annual_returns_missing');
        expect(codes(plan)).not.toContain('shareholders_needed');
    });
});

describe('Saskatchewan profile report', () => {
    // Reconstructed from an ISC report in the two layouts a PDF text layer
    // can take: label and value on one line, or on consecutive lines.
    const sameLine = [
        'Saskatchewan', 'Corporate Registry', 'Profile Report',
        'Entity Number: 101234567', 'Page 1 of 2', 'Entity Name: EXAMPLE AIRLINES LTD.', 'Report Date: 18-Apr-2022',
        'Entity Details',
        'Entity Type Business Corporation', 'Entity Subtype NWP Corporation', 'Entity Status Active',
        'Registration Date 13-Dec-2019', 'Entity Number in Home Jurisdiction 2012345678',
        'Home Jurisdiction Alberta, Canada', 'Incorporation/Amalgamation Date in Home Jurisdiction 12-Dec-2019',
        'Registered Office/Mailing Address',
        'Physical Address 100 EXAMPLE AVENUE SW, SUITE 1, CALGARY, Alberta, Canada, T2P 1A1',
        'Event History', 'Type Date',
        'Business Corporation - Amend Articles 01-Dec-2020',
        'Business Corporation - NWP Amalgamation 13-Dec-2019',
    ].join('\n');
    const nextLine = sameLine
        .replace('Entity Status Active', 'Entity Status\nActive')
        .replace('Home Jurisdiction Alberta, Canada', 'Home Jurisdiction\nAlberta, Canada');

    for (const [layout, text] of [['same-line', sameLine], ['next-line', nextLine]] as const) {
        it(`reads an extra-provincial (NWP) registration — ${layout} layout`, () => {
            const r = parseProfileReportText(text)!;
            expect(r.registry).toBe('sk');
            expect(r.reportDate).toBe('2022-04-18');
            expect(r.corporation).toMatchObject({ name: 'EXAMPLE AIRLINES LTD.', number: '101234567', status: 'Active', incorporationDate: '2019-12-12' });
            expect(r.corporation.extraProvincial).toMatchObject({ homeJurisdiction: 'Alberta, Canada', homeNumber: '2012345678' });
            expect(r.registeredOffice).toMatchObject({ street: '100 EXAMPLE AVENUE SW, SUITE 1', city: 'CALGARY', province: 'AB', postalCode: 'T2P 1A1' });
            expect(r.filings.map((f) => [f.date, f.kind])).toEqual([['2019-12-13', 'registration'], ['2020-12-01', 'amendment']]);

            const plan = buildImportPlan(r, NOW);
            expect(plan.jurisdiction).toBe('ab');
            expect(plan.flags.find((f) => f.code === 'extra_provincial')!.message).toContain('Alberta corporate search');
        });
    }
});
