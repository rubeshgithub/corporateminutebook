import ejs from 'ejs';
import puppeteer, { Browser, PDFOptions } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ICompany } from '../models/Company';
import { tryGetFile } from './uploadStorage';

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

// ─── Singleton browser ────────────────────────────────────────────────────────
//
// Chrome takes an exclusive lock on its userDataDir, which used to bite in
// three separate ways:
//
// 1. Two callers in one process racing to launch. Handled by sharing a launch
//    promise: first arrival launches, every subsequent arrival awaits the same
//    promise. The persona suite caught this one — two personas hitting
//    /api/documents/bundle in parallel = one 500.
//
// 2. Two *processes* on one machine. The profile path used to be a single
//    fixed `os.tmpdir()/minutebook_chrome_profile`, which is machine-global,
//    so an in-process singleton could not help: a second backend (a test
//    instance on :5001, a second dev server, a second worker) has its own
//    module state and every PDF request there 500'd with "The browser is
//    already running for <tmpdir>/minutebook_chrome_profile". Fixed by giving
//    each launch its own profile directory, namespaced by pid.
//
// 3. Unrecoverable recovery. The health check nulled out the handle and fell
//    straight through to a fresh launch, without stopping the old Chrome. If
//    that Chrome was alive but wedged (or orphaned when its parent node
//    process was killed) it still held the lock, so the relaunch threw on the
//    same lock and the singleton could never recover. Fixed by closing/killing
//    the old browser first, *and* by launching into a new profile directory so
//    recovery survives even when the kill doesn't land.
//
// One profile dir per launch means nothing ever overwrites the previous one,
// so they are cleaned up on disconnect, on process exit, and — for the process
// that got SIGKILLed and ran no handler at all — by a sweep on next launch.

const PROFILE_ROOT = path.join(os.tmpdir(), 'minutebook_chrome_profiles');

/** Bounded so a wedged Chrome that never answers CDP can't hang a request. */
const BROWSER_HEALTH_TIMEOUT_MS = 5_000;
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;

type BrowserHandle = { browser: Browser; profileDir: string };

let _handle: BrowserHandle | null = null;
let _launching: Promise<Browser> | null = null;
let _swept = false;

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
        p.then(resolve, reject).finally(() => clearTimeout(timer));
    });

/**
 * Remove profile dirs belonging to processes that died without running any
 * cleanup (SIGKILL, hard crash). Never touches a dir whose owning pid is still
 * alive — that is another backend's live profile, and deleting it would break
 * exactly the multi-process case this whole scheme exists to support.
 */
const sweepStaleProfiles = (): void => {
    let entries: string[];
    try {
        entries = fs.readdirSync(PROFILE_ROOT);
    } catch {
        return; // root doesn't exist yet — nothing to sweep
    }
    for (const entry of entries) {
        const owner = /^p(\d+)-/.exec(entry);
        if (!owner) continue;
        const pid = Number(owner[1]);
        if (pid === process.pid) continue;
        try {
            // Signal 0 delivers nothing; it only probes whether the pid exists.
            process.kill(pid, 0);
            continue; // still running — not ours to delete
        } catch (e: any) {
            // EPERM means the process exists but belongs to another user.
            if (e?.code === 'EPERM') continue;
        }
        try {
            fs.rmSync(path.join(PROFILE_ROOT, entry), { recursive: true, force: true });
        } catch {
            // Locked or racing another sweeper. Next launch tries again.
        }
    }
};

/** mkdtemp gives an atomically-unique dir, so two processes (or a relaunch
 *  racing its own predecessor's teardown) can never pick the same path. */
const createProfileDir = (): string => {
    if (!_swept) {
        _swept = true;
        sweepStaleProfiles();
    }
    fs.mkdirSync(PROFILE_ROOT, { recursive: true });
    return fs.mkdtempSync(path.join(PROFILE_ROOT, `p${process.pid}-`));
};

/**
 * Windows keeps handles on the profile open for a moment after Chrome exits,
 * so the first unlink routinely loses that race. rm's own retry loop rides it
 * out; async so the retry delay never blocks the event loop. Anything still
 * locked at the end is left for sweepStaleProfiles() on a later launch.
 */
const removeProfileDir = (profileDir: string): Promise<void> =>
    fs.promises
        .rm(profileDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
        .catch(() => {});

/** Tear down a browser we've given up on. close() first so Chrome releases the
 *  profile lock cleanly; SIGKILL when close hangs or throws, because a wedged
 *  Chrome will never answer a CDP close request. Never rejects. */
const disposeHandle = async (handle: BrowserHandle): Promise<void> => {
    try {
        await withTimeout(handle.browser.close(), BROWSER_CLOSE_TIMEOUT_MS, 'browser close');
    } catch {
        try {
            handle.browser.process()?.kill('SIGKILL');
        } catch {
            // Already exited.
        }
    }
    await removeProfileDir(handle.profileDir);
};

const launchBrowser = async (): Promise<Browser> => {
    const profileDir = createProfileDir();
    try {
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
            userDataDir: profileDir,
        });
        const handle: BrowserHandle = { browser, profileDir };
        // Chrome can die on its own (OOM kill, renderer crash). Drop the
        // singleton the moment it does, so the next caller launches instead of
        // waiting on a health check to discover the corpse.
        browser.on('disconnected', () => {
            if (_handle === handle) _handle = null;
            void removeProfileDir(profileDir);
        });
        _handle = handle;
        return browser;
    } catch (err) {
        await removeProfileDir(profileDir);
        throw err;
    } finally {
        _launching = null;
    }
};

const getBrowser = async (): Promise<Browser> => {
    const current = _handle;
    if (current) {
        try {
            // version() round-trips over CDP, so it catches a Chrome that is
            // alive but not answering — which a connected-flag check wouldn't.
            await withTimeout(current.browser.version(), BROWSER_HEALTH_TIMEOUT_MS, 'browser health check');
            return current.browser;
        } catch (e: any) {
            console.warn(`[documentGenerator] browser unhealthy, recycling: ${e?.message ?? e}`);
            if (_handle === current) _handle = null;
            // Not awaited: a wedged Chrome can burn the full close timeout, and
            // the caller waiting on a PDF shouldn't pay for it. Safe to overlap
            // because the relaunch below claims a brand-new profile dir.
            void disposeHandle(current);
        }
    }
    if (!_launching) {
        _launching = launchBrowser();
    }
    return _launching;
};

// Best-effort teardown on shutdown. Everything here is synchronous — an 'exit'
// handler is the last thing that runs, so a promise queued from it never
// settles. Chrome is killed rather than closed for the same reason, and there
// is no retry loop: whatever the OS still has locked at this instant is left
// for sweepStaleProfiles() on a later launch, which is also what covers the
// SIGKILLed process that runs no handler at all.
process.once('exit', () => {
    const handle = _handle;
    _handle = null;
    if (!handle) return;
    try {
        handle.browser.process()?.kill('SIGKILL');
    } catch {
        // Already exited.
    }
    try {
        fs.rmSync(handle.profileDir, { recursive: true, force: true });
    } catch {
        // Swept on a later launch.
    }
});

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
