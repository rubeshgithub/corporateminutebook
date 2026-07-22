/**
 * Fixtures — realistic dummy corporation data for each persona. Kept in
 * one place so tests read as narratives ("acme = the CPA's corp",
 * "widgetco = the lawyer's corp") instead of duplicating 40-line objects.
 *
 * Timestamps are baked-in rather than Date.now()-based so a failing run
 * produces the same diff twice in a row and diagnosis stays sane.
 */

const nowSuffix = () => Date.now().toString(36);

interface CorpOverrides {
    name?: string;
    incorporationDate?: string;
    fiscalYearEnd?: string;
    annualReturnDueDate?: string;
    province?: string;
    directors?: any[];
    shareClasses?: any[];
    shareholders?: any[];
    officers?: any[];
}

export function dummyCorp(overrides: CorpOverrides = {}): any {
    const suffix = nowSuffix();
    const province = overrides.province ?? 'AB';
    return {
        name:                  overrides.name ?? `Persona Test Corp ${suffix}`,
        corporateAccessNumber: `TEST${suffix.toUpperCase().slice(0, 8)}`,
        incorporationDate:     overrides.incorporationDate ?? '2020-01-15',
        minDirectors:          1,
        maxDirectors:          10,
        fiscalYearEnd:         overrides.fiscalYearEnd ?? '12-31',
        annualReturnDueDate:   overrides.annualReturnDueDate ?? '01-15',
        registeredOfficeAddress: {
            street:     '123 Main Street',
            city:       'Calgary',
            province,
            postalCode: 'T2P1J9',
            country:    'Canada',
        },
        recordsAddress:    { sameAsRegistered: true },
        addressForService: { sameAsRegistered: true },
        restrictions: {
            restrictedTo:   { has: false },
            restrictedFrom: { has: false },
        },
        authorizedBy: {
            name:  'Test Authorizer',
            email: 'authorizer@personatest.local',
            phone: '4035550100',
        },
        schedules: [],
        shareClasses: overrides.shareClasses ?? [
            { name: 'Class A Common Voting Shares', type: 'Common', voting: true, maxAuthorized: null, parValue: null },
        ],
        directors: overrides.directors ?? [
            {
                firstName: 'Alex', lastName: 'Director',
                address: '123 Main Street', city: 'Calgary', province, postalCode: 'T2P1J9',
                residentCanadian: true, appointedDate: '2020-01-15',
                email: 'alex.director@personatest.local',
            },
        ],
        shareholders: overrides.shareholders ?? [
            {
                holderType: 'Individual', name: 'Alex Shareholder',
                address: '456 Elm Street', city: 'Calgary', province, postalCode: 'T2P1J9',
                sharesClass: 'Class A Common Voting Shares', numberOfShares: 100,
                votingPercent: 100,
            },
        ],
        officers: overrides.officers ?? [
            { name: 'Alex Officer', title: 'President', appointedDate: '2020-01-15' },
        ],
    };
}
