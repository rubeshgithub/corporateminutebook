import Anthropic from '@anthropic-ai/sdk';
import { PDFParse } from 'pdf-parse';
import { z } from 'zod';
import { filingKind, isUsableReport, parseProfileReportText, parseRegistryDate } from './parsers';
import { emptyCorporation, type ParsedProfileReport, type Registry } from './types';

export * from './types';
export { buildImportPlan, hasBlocker, STALE_AFTER_DAYS, type ImportPlan, type ImportFlag, type ImportEvent } from './plan';

export interface ReadResult {
    report: ParsedProfileReport | null;
    /** 1-based page numbers with no text layer (scanned images). */
    unreadPages: number[];
}

const extractPdfText = async (pdf: Buffer): Promise<{ text: string; pages: string[] }> => {
    const parser = new PDFParse({ data: pdf });
    try {
        const result = await parser.getText();
        return { text: result.text, pages: result.pages.map((p: { text: string }) => p.text ?? '') };
    } finally {
        await parser.destroy();
    }
};

const normalizeNumber = (s: string) => s.replace(/[\s-]/g, '').toUpperCase();

/**
 * Reads a registry profile report. The exact per-registry reader is used
 * whenever it produces a usable record from a fully text-based PDF. AI reads
 * the document only when the exact reader can't: an unrecognised format,
 * missing core facts, or pages that are scanned images. An AI result must
 * agree with any corporation number the exact reader found.
 */
export const readProfileReport = async (pdf: Buffer): Promise<ReadResult> => {
    const { text, pages } = await extractPdfText(pdf);
    const unreadPages = pages
        .map((t, i) => (t.replace(/\s+/g, '').length < 20 ? i + 1 : 0))
        .filter((n) => n > 0);

    const parsed = parseProfileReportText(text);
    const needsAi = !parsed
        || !isUsableReport(parsed)
        || unreadPages.length > 0
        // A Saskatchewan-incorporated company always has directors; none read
        // means the layout differed from the one the reader knows.
        || (parsed.registry === 'sk' && !parsed.corporation.extraProvincial && parsed.directors.length === 0);

    if (needsAi) {
        const ai = await readWithAi(pdf, parsed?.registry ?? null).catch((err) => {
            console.error('[profileReports] AI read failed:', err?.message ?? err);
            return null;
        });
        const agrees = !parsed?.corporation.number
            || (ai && normalizeNumber(ai.corporation.number) === normalizeNumber(parsed.corporation.number));
        if (ai && isUsableReport(ai) && agrees) return { report: ai, unreadPages: [] };
    }
    return { report: parsed, unreadPages };
};

// ─── AI fallback ────────────────────────────────────────────────────────────

const nullableString = z.string().nullish().transform((v) => (v ?? '').trim());
const nullableDate = z.string().nullish().transform((v) => parseRegistryDate(v ?? null));
const address = z.object({
    street: nullableString, city: nullableString, province: nullableString, postalCode: nullableString, country: nullableString,
}).nullish();

const aiSchema = z.object({
    registry: z.enum(['ab', 'bc', 'on', 'sk', 'federal']),
    registryName: nullableString,
    reportDate: nullableDate,
    corporation: z.object({
        name: nullableString, number: nullableString, businessNumber: nullableString, status: nullableString,
        incorporationDate: nullableDate, entityType: nullableString,
        minDirectors: z.number().int().nullish(), maxDirectors: z.number().int().nullish(), email: nullableString,
        extraProvincial: z.object({ homeJurisdiction: nullableString, homeNumber: nullableString, formedOn: nullableDate }).nullish(),
    }),
    registeredOffice: address,
    recordsOffice: address,
    directors: z.array(z.object({
        firstName: nullableString, middleName: nullableString, lastName: nullableString, address: nullableString,
        residentCanadian: z.boolean().nullish(), appointedDate: nullableDate,
    })).default([]),
    officers: z.array(z.object({ name: nullableString, title: nullableString, appointedDate: nullableDate })).default([]),
    shareholders: z.array(z.object({
        name: nullableString, holderType: z.enum(['Individual', 'Legal Entity']).nullish(), address: nullableString,
        votingPercent: z.number().nullish(),
    })).default([]),
    annualReturns: z.array(z.object({ year: z.number().int(), filedOn: nullableDate })).default([]),
    filings: z.array(z.object({ date: nullableDate, label: nullableString })).default([]),
    nameHistory: z.array(z.object({ name: nullableString, from: nullableDate })).default([]),
});

const AI_PROMPT = `You are reading a Canadian corporate registry profile or search report (Alberta, British Columbia, Ontario, Saskatchewan or Corporations Canada).
Return ONLY a JSON object, no prose and no code fences, with exactly this structure:
{
  "registry": "ab" | "bc" | "on" | "sk" | "federal",   // the registry that ISSUED the report
  "registryName": string,
  "reportDate": "YYYY-MM-DD" | null,                    // search / generation / report date
  "corporation": {
    "name": string, "number": string, "businessNumber": string | null, "status": string,
    "incorporationDate": "YYYY-MM-DD" | null,           // for an extra-provincial registration: the date formed in the home jurisdiction
    "entityType": string, "minDirectors": number | null, "maxDirectors": number | null, "email": string | null,
    "extraProvincial": { "homeJurisdiction": string, "homeNumber": string, "formedOn": "YYYY-MM-DD" | null } | null
  },
  "registeredOffice": { "street": string, "city": string, "province": string, "postalCode": string, "country": string } | null,
  "recordsOffice": { ...same shape... } | null,
  "directors": [{ "firstName": string, "middleName": string, "lastName": string, "address": string, "residentCanadian": boolean | null, "appointedDate": "YYYY-MM-DD" | null }],
  "officers": [{ "name": string, "title": string, "appointedDate": "YYYY-MM-DD" | null }],
  "shareholders": [{ "name": string, "holderType": "Individual" | "Legal Entity", "address": string, "votingPercent": number | null }],
  "annualReturns": [{ "year": number, "filedOn": "YYYY-MM-DD" | null }],
  "filings": [{ "date": "YYYY-MM-DD", "label": string }],    // every dated filing / event in the history, label as printed
  "nameHistory": [{ "name": string, "from": "YYYY-MM-DD" | null }]
}
Rules:
- Copy values exactly as printed. Use null or [] when something is not shown — never infer or invent a value.
- Province as a 2-letter code (AB, BC, ON, SK, ...).
- Only list shareholders the report actually lists.`;

const readWithAi = async (pdf: Buffer, hint: Registry | null): Promise<ParsedProfileReport | null> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return null;

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{
            role: 'user',
            content: [
                { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.toString('base64') } } as any,
                { type: 'text', text: hint ? `${AI_PROMPT}\n- This report appears to be from registry "${hint}".` : AI_PROMPT },
            ],
        }],
    });
    const block = message.content[0];
    if (block?.type !== 'text') return null;
    const json = JSON.parse(block.text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    const a = aiSchema.parse(json);

    const corp = { ...emptyCorporation(), ...a.corporation };
    return {
        registry: a.registry,
        source: 'ai',
        registryName: a.registryName,
        reportDate: a.reportDate,
        corporation: {
            ...corp,
            minDirectors: a.corporation.minDirectors ?? null,
            maxDirectors: a.corporation.maxDirectors ?? null,
            extraProvincial: a.corporation.extraProvincial?.homeJurisdiction ? {
                homeJurisdiction: a.corporation.extraProvincial.homeJurisdiction,
                homeNumber: a.corporation.extraProvincial.homeNumber,
                formedOn: a.corporation.extraProvincial.formedOn,
            } : null,
        },
        registeredOffice: a.registeredOffice?.street ? { ...a.registeredOffice, country: a.registeredOffice.country || 'Canada' } : null,
        recordsOffice: a.recordsOffice?.street ? { ...a.recordsOffice, country: a.recordsOffice.country || 'Canada' } : null,
        directors: a.directors.map((d) => ({
            ...d,
            name: [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' '),
            residentCanadian: d.residentCanadian ?? null,
        })),
        officers: a.officers.filter((o) => o.name),
        shareholders: a.shareholders.filter((s) => s.name).map((s) => {
            const w = s.name.split(/\s+/);
            return {
                name: s.name, firstName: w[0] ?? '', middleName: w.slice(1, -1).join(' '), lastName: w.length > 1 ? w[w.length - 1] : '',
                address: s.address, holderType: s.holderType ?? 'Individual', votingPercent: s.votingPercent ?? null,
            };
        }),
        annualReturns: a.annualReturns,
        annualReturnsOutstanding: [],
        annualReturnAnniversary: null,
        noAnnualReturnOnFile: false,
        filings: a.filings
            .filter((f): f is { date: string; label: string } => !!f.date)
            .map((f) => ({ date: f.date, label: f.label, kind: filingKind(f.label) })),
        nameHistory: a.nameHistory.filter((n) => n.name),
        significantIndividuals: [],
    };
};
