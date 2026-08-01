import ejs from 'ejs';
import puppeteer, { Browser, PDFOptions } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ICompany } from '../models/Company';
import { tryGetFile } from './uploadStorage';

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// ─── Singleton browser — avoids Windows lockfile conflicts ────────────────────
//
// Concurrent requests must NOT both launch. Two callers each seeing
// `_browser === null` and racing to puppeteer.launch() with the same
// userDataDir crashes the second one — Chrome takes an exclusive lock
// on the profile directory. The persona test suite caught this: two
// personas hitting /api/documents/bundle in parallel = one 500.
//
// Fix: share a launch promise across concurrent callers. First arrival
// starts the launch; every subsequent arrival awaits the same promise.
let _browser: Browser | null = null;
let _browserLaunching: Promise<Browser> | null = null;

const getBrowser = async (): Promise<Browser> => {
    if (_browser) {
        try {
            await _browser.version();
            return _browser;
        } catch {
            _browser = null;
        }
    }
    if (!_browserLaunching) {
        _browserLaunching = puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
            userDataDir: path.join(os.tmpdir(), 'minutebook_chrome_profile'),
        }).then((b) => {
            _browser = b;
            _browserLaunching = null;
            return b;
        }).catch((err) => {
            _browserLaunching = null;
            throw err;
        });
    }
    return _browserLaunching;
};

const renderTemplate = (templateName: string, data: Record<string, unknown>): string => {
    const templatePath = path.join(TEMPLATES_DIR, `${templateName}.ejs`);
    const templateHtml = fs.readFileSync(templatePath, 'utf-8');
    return ejs.render(templateHtml, data, { filename: templatePath });
};

/**
 * Append pages from a stored upload PDF into an existing merged PDFDocument.
 * Returns true on success, false when skipped — callers can log which
 * attachments failed to make it into the compiled minute book, instead of
 * customers opening the output and finding critical resolutions missing.
 *
 * Reads via uploadStorage so the same code works whether files live in S3
 * (production) or on the local disk (dev / legacy migration window).
 */
const appendUploadedDoc = async (merged: PDFDocument, filename?: string): Promise<boolean> => {
    if (!filename) return false;
    const bytes = await tryGetFile(filename);
    if (!bytes) {
        console.warn(`[documentGenerator] attachment file missing, skipped: ${filename}`);
        return false;
    }
    try {
        const uploaded = await PDFDocument.load(bytes);
        const pages = await merged.copyPages(uploaded, uploaded.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
        return true;
    } catch (e: any) {
        // Typically an encrypted or malformed PDF. Log so ops sees it — a
        // silent skip means the customer's compiled minute book has a
        // missing resolution and no one knows why.
        console.warn(`[documentGenerator] attachment PDF invalid/encrypted, skipped: ${filename} — ${e?.message ?? 'unknown error'}`);
        return false;
    }
};

/** Hard cap on any single page's render + PDF cycle so a hung template can't
 *  keep the browser page open forever and starve the pool. */
const PAGE_TIMEOUT_MS = 60_000;

const addHeadersFooters = (
    merged: PDFDocument,
    font: Awaited<ReturnType<PDFDocument['embedFont']>>,
    rightHeaderText: string,
    skipFirstPage = true,
): void => {
    const subtle = rgb(0.45, 0.45, 0.45);
    const sz = 8;
    const totalPages = merged.getPageCount();

    merged.getPages().forEach((page, idx) => {
        if (skipFirstPage && idx === 0) return;
        const { width, height } = page.getSize();
        const pageNum = idx + 1;

        page.drawText(merged.getTitle() || '', { x: 36, y: height - 24, size: sz, font, color: subtle });
        page.drawText(rightHeaderText, {
            x: width - 36 - font.widthOfTextAtSize(rightHeaderText, sz),
            y: height - 24, size: sz, font, color: subtle,
        });

        page.drawText('Confidential', { x: 36, y: 24, size: sz, font, color: subtle });
        const ft = `Page ${pageNum} of ${totalPages}`;
        page.drawText(ft, {
            x: width - 36 - font.widthOfTextAtSize(ft, sz),
            y: 24, size: sz, font, color: subtle,
        });
    });
};

const TEMPLATE_OPTIONS: Record<string, Partial<PDFOptions>> = {
    share_certificate: { landscape: true },
};

export const generatePDFBuffer = async (
    company: ICompany,
    templateName: string,
    events: unknown[] = [],
    extraData: Record<string, unknown> = {},
): Promise<Buffer> => {
    const compiledHtml = renderTemplate(templateName, { company, events, ...extraData });

    const browser = await getBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    try {
        await page.setContent(compiledHtml, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        const pdfBuffer = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
            timeout: PAGE_TIMEOUT_MS,
            ...TEMPLATE_OPTIONS[templateName],
        });
        return Buffer.from(pdfBuffer);
    } finally {
        await page.close().catch(() => {});
    }
};

type EventAttach = { role: string; fileId: string };
type EventLike = { attachments?: EventAttach[] };

export const generateMinuteBookPDF = async (company: ICompany, events: unknown[] = []): Promise<Buffer> => {
    // No shareholders -> no certificate section. An empty certificate render
    // still produces one blank page, which would get stamped and merged.
    const hasShareholders = Array.isArray(company.shareholders) && company.shareholders.length > 0;
    const mainHtml = renderTemplate('minute_book', { company, events });
    const certHtml = hasShareholders ? renderTemplate('share_certificate', { company }) : null;

    const browser = await getBrowser();
    const mainPage = await browser.newPage();
    const certPage = certHtml ? await browser.newPage() : null;
    mainPage.setDefaultTimeout(PAGE_TIMEOUT_MS);
    certPage?.setDefaultTimeout(PAGE_TIMEOUT_MS);
    let mainPdfBytes: Buffer = Buffer.alloc(0);
    let certPdfBytes: Buffer | null = null;
    try {
        await mainPage.setContent(mainHtml, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        mainPdfBytes = Buffer.from(await mainPage.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '0.7in', right: '0.7in', bottom: '0.7in', left: '0.7in' },
            timeout: PAGE_TIMEOUT_MS,
        }));
        if (certPage && certHtml) {
            await certPage.setContent(certHtml, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
            certPdfBytes = Buffer.from(await certPage.pdf({
                format: 'Letter',
                landscape: true,
                printBackground: true,
                margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
                timeout: PAGE_TIMEOUT_MS,
            }));
        }
    } finally {
        await mainPage.close().catch(() => {});
        await certPage?.close().catch(() => {});
    }

    const merged = await PDFDocument.create();
    merged.setTitle(company.name);

    const mainDoc = await PDFDocument.load(mainPdfBytes);
    (await merged.copyPages(mainDoc, mainDoc.getPageIndices())).forEach((p) => merged.addPage(p));

    // Insert uploaded incorporation document after the main book (proof of filing)
    await appendUploadedDoc(merged, (company as any).incorporationDocumentFile);

    // Append uploaded signed resolutions and registry filings from events (chronological)
    for (const ev of events as EventLike[]) {
        for (const att of ev.attachments || []) {
            if (att.role === 'resolution' || att.role === 'registry_filing') {
                await appendUploadedDoc(merged, att.fileId);
            }
        }
    }

    if (certPdfBytes) {
        const certDoc = await PDFDocument.load(certPdfBytes);
        (await merged.copyPages(certDoc, certDoc.getPageIndices())).forEach((p) => merged.addPage(p));
    }

    const font = await merged.embedFont(StandardFonts.Helvetica);
    addHeadersFooters(merged, font, 'Corporate Minute Book', true);

    return Buffer.from(await merged.save());
};

// Inaugural package — portrait templates before the uploaded incorp doc
const INAUGURAL_PRE_INCORP = ['articles_of_incorporation'];
// Inaugural package — portrait templates after the uploaded incorp doc
const INAUGURAL_POST_INCORP = [
    'schedule_a',
    'by_laws',
    'organizational_resolution',
    'shareholders_organizational_resolution',
    'consent_to_act',
    'share_subscription',
];

/**
 * Renders one template on a fresh page, then closes the page in a finally so
 * a mid-render crash never leaks. Uses the shared browser singleton — the
 * old inaugural path launched a whole new browser (~100 MB) per request,
 * with no timeout and no browser.close() in a finally, so a template crash
 * left the Chrome process orphaned. Under real signup load, that's a fast
 * path to OOM on Render.
 */
const renderTemplateToPdf = async (
    browser: Browser,
    templateName: string,
    data: Record<string, unknown>,
    pdfOpts: Partial<PDFOptions> = {},
): Promise<Uint8Array> => {
    const html = renderTemplate(templateName, data);
    const page = await browser.newPage();
    page.setDefaultTimeout(PAGE_TIMEOUT_MS);
    try {
        await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
        return await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '0.7in', right: '0.7in', bottom: '0.7in', left: '0.7in' },
            timeout: PAGE_TIMEOUT_MS,
            ...pdfOpts,
        });
    } finally {
        await page.close().catch(() => {});
    }
};

export const generateInauguralPackagePDF = async (company: ICompany, events: unknown[] = []): Promise<Buffer> => {
    const browser = await getBrowser();

    const preBuffers: Uint8Array[] = [];
    for (const tpl of INAUGURAL_PRE_INCORP) {
        preBuffers.push(await renderTemplateToPdf(browser, tpl, { company }));
    }
    const postBuffers: Uint8Array[] = [];
    for (const tpl of INAUGURAL_POST_INCORP) {
        postBuffers.push(await renderTemplateToPdf(browser, tpl, { company }));
    }

    // Share certificates — landscape. Skipped with no shareholders: an empty
    // render would still inject a blank stamped page into the package.
    const certPdf = Array.isArray(company.shareholders) && company.shareholders.length > 0
        ? await renderTemplateToPdf(browser, 'share_certificate', { company }, {
            landscape: true,
            margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
        })
        : null;

    // Corporate Registers — portrait.
    const regPdf = await renderTemplateToPdf(browser, 'registers', { company, events });

    // Merge: Articles → Uploaded Incorp Doc (proof of filing) → rest of inaugural docs
    const merged = await PDFDocument.create();
    merged.setTitle(company.name);

    for (const buf of preBuffers) {
        const doc = await PDFDocument.load(buf);
        (await merged.copyPages(doc, doc.getPageIndices())).forEach((p) => merged.addPage(p));
    }

    // Insert the filed incorporation document right after the Articles of Incorporation
    await appendUploadedDoc(merged, (company as any).incorporationDocumentFile);

    for (const buf of postBuffers) {
        const doc = await PDFDocument.load(buf);
        (await merged.copyPages(doc, doc.getPageIndices())).forEach((p) => merged.addPage(p));
    }

    if (certPdf) {
        const certDoc = await PDFDocument.load(certPdf);
        (await merged.copyPages(certDoc, certDoc.getPageIndices())).forEach((p) => merged.addPage(p));
    }

    const regDoc = await PDFDocument.load(regPdf);
    (await merged.copyPages(regDoc, regDoc.getPageIndices())).forEach((p) => merged.addPage(p));

    const font = await merged.embedFont(StandardFonts.Helvetica);
    addHeadersFooters(merged, font, 'Organizational Documents', true);

    return Buffer.from(await merged.save());
};
