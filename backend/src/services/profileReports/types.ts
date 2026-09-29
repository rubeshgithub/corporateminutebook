/** Registries whose profile / search reports the importer reads. */
export type Registry = 'ab' | 'bc' | 'on' | 'sk' | 'federal';

export interface ReportAddress {
    street: string;
    city: string;
    province: string;
    postalCode: string;
    country: string;
}

export interface ReportDirector {
    name: string;
    firstName: string;
    middleName: string;
    lastName: string;
    address: string;
    residentCanadian: boolean | null;
    /** Only Ontario reports carry director start dates. */
    appointedDate: string | null;
}

export interface ReportOfficer {
    name: string;
    title: string;
    appointedDate: string | null;
}

export interface ReportShareholder {
    name: string;
    firstName: string;
    middleName: string;
    lastName: string;
    address: string;
    holderType: 'Individual' | 'Legal Entity';
    votingPercent: number | null;
}

export type FilingKind =
    | 'incorporation' | 'registration' | 'annual_return' | 'initial_return'
    | 'change' | 'amendment' | 'revival' | 'status' | 'other';

export interface ReportFiling {
    date: string;          // YYYY-MM-DD
    label: string;         // exactly as the registry names it
    kind: FilingKind;
    year?: number;         // for annual returns
}

export interface ReportAnnualReturn {
    year: number;
    /** Date the return was filed; null when the registry only says "filed". */
    filedOn: string | null;
}

export interface ParsedProfileReport {
    registry: Registry;
    /** 'parser' for the exact per-registry readers, 'ai' for the fallback. */
    source: 'parser' | 'ai';
    registryName: string;
    /** When the registry produced the report (search / generation date). */
    reportDate: string | null;
    corporation: {
        name: string;
        number: string;
        businessNumber: string;
        status: string;
        incorporationDate: string | null;
        entityType: string;
        minDirectors: number | null;
        maxDirectors: number | null;
        email: string;
        /** Set when the report is an extra-provincial registration of a
         *  corporation governed by another jurisdiction. */
        extraProvincial: { homeJurisdiction: string; homeNumber: string; formedOn: string | null } | null;
    };
    registeredOffice: ReportAddress | null;
    recordsOffice: ReportAddress | null;
    directors: ReportDirector[];
    officers: ReportOfficer[];
    shareholders: ReportShareholder[];
    annualReturns: ReportAnnualReturn[];
    /** Years the registry lists as due / overdue (federal). */
    annualReturnsOutstanding: number[];
    /** MM-DD anniversary used for annual filings, when the report states it. */
    annualReturnAnniversary: string | null;
    /** True when the registry explicitly reports no annual return on file (BC "Not Available"). */
    noAnnualReturnOnFile: boolean;
    filings: ReportFiling[];
    nameHistory: Array<{ name: string; from: string | null }>;
    significantIndividuals: Array<{ name: string; address: string; description: string; since: string | null }>;
}

export const emptyCorporation = (): ParsedProfileReport['corporation'] => ({
    name: '', number: '', businessNumber: '', status: '', incorporationDate: null, entityType: '',
    minDirectors: null, maxDirectors: null, email: '', extraProvincial: null,
});
