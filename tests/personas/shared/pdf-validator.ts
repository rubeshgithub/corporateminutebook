import pdf from 'pdf-parse';

/**
 * v1 PDF validator — text-based structural checks. Reads the whole PDF
 * as text and asserts expected section headings are present.
 *
 * v1.1 will add layout checks via pdfjs-dist (per-word coordinates):
 *   - signature blocks split across pages
 *   - table rows extending past bottom margin
 *   - widow / orphan lines
 *   - empty pages with a "PAGE INTENTIONALLY LEFT BLANK" pattern that
 *     shouldn't exist in the compiled book
 *
 * The public API takes a Buffer + a list of "expected content" markers
 * plus optional "forbidden content" markers (like error strings that
 * shouldn't ever appear in a real render).
 */

export interface PdfCheck {
    /** Substrings that MUST appear somewhere in the PDF text. */
    expectedSections: string[];
    /** Substrings that MUST NOT appear (e.g. leaked error strings). */
    forbiddenContent?: string[];
    /** Minimum expected page count. Compiled minute book without content
     *  is a bug — set a reasonable floor per bundle type. */
    minPages?: number;
}

export interface PdfCheckResult {
    ok:              boolean;
    pageCount:       number;
    textLength:      number;
    missingSections: string[];
    foundForbidden:  string[];
    tooFewPages:     boolean;
}

export async function validatePdf(buffer: Buffer, check: PdfCheck): Promise<PdfCheckResult> {
    const data = await pdf(buffer);
    const text = data.text;

    const missingSections = check.expectedSections.filter((s) => !text.includes(s));
    const foundForbidden  = (check.forbiddenContent ?? []).filter((s) => text.includes(s));
    const tooFewPages     = check.minPages !== undefined && data.numpages < check.minPages;

    return {
        ok:              missingSections.length === 0 && foundForbidden.length === 0 && !tooFewPages,
        pageCount:       data.numpages,
        textLength:      text.length,
        missingSections,
        foundForbidden,
        tooFewPages,
    };
}

/** Pretty-print a check result for test failure messages. */
export function describeResult(name: string, r: PdfCheckResult): string {
    const bits: string[] = [`${name}: ${r.ok ? 'OK' : 'FAILED'} (${r.pageCount} pages, ${r.textLength} chars)`];
    if (r.tooFewPages)             bits.push(`  · Too few pages (${r.pageCount})`);
    if (r.missingSections.length)  bits.push(`  · Missing sections: ${r.missingSections.join(', ')}`);
    if (r.foundForbidden.length)   bits.push(`  · Contains forbidden strings: ${r.foundForbidden.join(', ')}`);
    return bits.join('\n');
}
