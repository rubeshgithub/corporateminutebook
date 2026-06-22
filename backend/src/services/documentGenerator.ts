import ejs from 'ejs';
import puppeteer, { Browser, PDFOptions } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ICompany } from '../models/Company';

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

// ─── Singleton browser — avoids Windows lockfile conflicts ────────────────────
let _browser: Browser | null = null;

const getBrowser = async (): Promise<Browser> => {
    if (_browser) {
        try {
            // Quick liveness check
            await _browser.version();
            return _browser;
        } catch {
            _browser = null;
        }
    }
    _browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        userDataDir: path.join(os.tmpdir(), 'minutebook_chrome_profile'),
    });
    return _browser;
};

const renderTemplate = (templateName: string, data: Record<string, unknown>): string => {
    const templatePath = path.join(TEMPLATES_DIR, `${templateName}.ejs`);
    const templateHtml = fs.readFileSync(templatePath, 'utf-8');
    return ejs.render(templateHtml, data, { filename: templatePath });
};

/** Append pages from a stored upload PDF into an existing merged PDFDocument. Silently skips if file missing or encrypted. */
const appendUploadedDoc = async (merged: PDFDocument, filename?: string): Promise<void> => {
    if (!filename) return;
    const filePath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(filePath)) return;
    try {
        const uploaded = await PDFDocument.load(fs.readFileSync(filePath));
        const pages = await merged.copyPages(uploaded, uploaded.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
    } catch {
        // encrypted or malformed — skip
    }
};

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
    try {
        await page.setContent(compiledHtml, { waitUntil: 'domcontentloaded' });
        const pdfBuffer = await page.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
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
    const mainHtml = renderTemplate('minute_book', { company, events });
    const certHtml = renderTemplate('share_certificate', { company });

    const browser = await getBrowser();
    const mainPage = await browser.newPage();
    const certPage = await browser.newPage();
    let mainPdfBytes: Buffer = Buffer.alloc(0);
    let certPdfBytes: Buffer = Buffer.alloc(0);
    try {
        await mainPage.setContent(mainHtml, { waitUntil: 'domcontentloaded' });
        mainPdfBytes = Buffer.from(await mainPage.pdf({
            format: 'Letter',
            printBackground: true,
            margin: { top: '0.7in', right: '0.7in', bottom: '0.7in', left: '0.7in' },
        }));
        await certPage.setContent(certHtml, { waitUntil: 'domcontentloaded' });
        certPdfBytes = Buffer.from(await certPage.pdf({
            format: 'Letter',
            landscape: true,
            printBackground: true,
            margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
        }));
    } finally {
        await mainPage.close().catch(() => {});
        await certPage.close().catch(() => {});
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

    const certDoc = await PDFDocument.load(certPdfBytes);
    (await merged.copyPages(certDoc, certDoc.getPageIndices())).forEach((p) => merged.addPage(p));

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

export const generateInauguralPackagePDF = async (company: ICompany, events: unknown[] = []): Promise<Buffer> => {
    const browser = await puppeteer.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const renderPortraitBatch = async (templates: string[]): Promise<Uint8Array[]> => {
        const results: Uint8Array[] = [];
        for (const tpl of templates) {
            const html = renderTemplate(tpl, { company });
            const pg = await browser.newPage();
            await pg.setContent(html, { waitUntil: 'domcontentloaded' });
            const pdf = await pg.pdf({
                format: 'Letter',
                printBackground: true,
                margin: { top: '0.7in', right: '0.7in', bottom: '0.7in', left: '0.7in' },
            });
            results.push(pdf);
            await pg.close();
        }
        return results;
    };

    const preBuffers = await renderPortraitBatch(INAUGURAL_PRE_INCORP);
    const postBuffers = await renderPortraitBatch(INAUGURAL_POST_INCORP);

    // Share certificates — landscape
    const certPg = await browser.newPage();
    await certPg.setContent(renderTemplate('share_certificate', { company }), { waitUntil: 'domcontentloaded' });
    const certPdf = await certPg.pdf({
        format: 'Letter', landscape: true, printBackground: true,
        margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
    });
    await certPg.close();

    // Corporate Registers — portrait
    const regPg = await browser.newPage();
    await regPg.setContent(renderTemplate('registers', { company, events }), { waitUntil: 'domcontentloaded' });
    const regPdf = await regPg.pdf({
        format: 'Letter', printBackground: true,
        margin: { top: '0.7in', right: '0.7in', bottom: '0.7in', left: '0.7in' },
    });
    await regPg.close();

    await browser.close();

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

    const certDoc = await PDFDocument.load(certPdf);
    (await merged.copyPages(certDoc, certDoc.getPageIndices())).forEach((p) => merged.addPage(p));

    const regDoc = await PDFDocument.load(regPdf);
    (await merged.copyPages(regDoc, regDoc.getPageIndices())).forEach((p) => merged.addPage(p));

    const font = await merged.embedFont(StandardFonts.Helvetica);
    addHeadersFooters(merged, font, 'Organizational Documents', true);

    return Buffer.from(await merged.save());
};
