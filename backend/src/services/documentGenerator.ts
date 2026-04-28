import ejs from 'ejs';
import puppeteer, { PDFOptions } from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { ICompany } from '../models/Company';

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

const TEMPLATE_OPTIONS: Record<string, Partial<PDFOptions>> = {
    share_certificate: { landscape: true },
};

const renderTemplate = (templateName: string, data: Record<string, unknown>): string => {
    const templatePath = path.join(TEMPLATES_DIR, `${templateName}.ejs`);
    const templateHtml = fs.readFileSync(templatePath, 'utf-8');
    return ejs.render(templateHtml, data, { filename: templatePath });
};

export const generatePDFBuffer = async (company: ICompany, templateName: string): Promise<Buffer> => {
    const compiledHtml = renderTemplate(templateName, { company });

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
    const page = await browser.newPage();

    await page.setContent(compiledHtml, { waitUntil: 'domcontentloaded' });

    const pdfBuffer = await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
        ...TEMPLATE_OPTIONS[templateName],
    });

    await browser.close();

    return Buffer.from(pdfBuffer);
};

export const generateMinuteBookPDF = async (company: ICompany): Promise<Buffer> => {
    const mainHtml = renderTemplate('minute_book', { company });
    const certHtml = renderTemplate('share_certificate', { company });

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

    // Main book — portrait, no puppeteer header/footer (we'll overlay with pdf-lib so numbering is continuous across the merged doc)
    const mainPage = await browser.newPage();
    await mainPage.setContent(mainHtml, { waitUntil: 'domcontentloaded' });
    const mainPdfBytes = await mainPage.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.7in', right: '0.7in', bottom: '0.7in', left: '0.7in' },
    });

    // Share certificates — landscape, no header/footer
    const certPage = await browser.newPage();
    await certPage.setContent(certHtml, { waitUntil: 'domcontentloaded' });
    const certPdfBytes = await certPage.pdf({
        format: 'Letter',
        landscape: true,
        printBackground: true,
        margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' },
    });

    await browser.close();

    // Merge with pdf-lib
    const merged = await PDFDocument.create();
    const mainDoc = await PDFDocument.load(mainPdfBytes);
    const certDoc = await PDFDocument.load(certPdfBytes);

    const mainPages = await merged.copyPages(mainDoc, mainDoc.getPageIndices());
    const certPages = await merged.copyPages(certDoc, certDoc.getPageIndices());
    mainPages.forEach((p) => merged.addPage(p));
    certPages.forEach((p) => merged.addPage(p));

    // Overlay running header (company name + 'Corporate Minute Book') and footer (page X of Y) on every page except the cover
    const font = await merged.embedFont(StandardFonts.Helvetica);
    const totalPages = merged.getPageCount();
    const subtle = rgb(0.45, 0.45, 0.45);
    const headerSize = 8;
    const footerSize = 8;

    merged.getPages().forEach((page, idx) => {
        if (idx === 0) return; // skip cover
        const { width, height } = page.getSize();
        const pageNum = idx + 1;

        // Header
        page.drawText(company.name, {
            x: 36, y: height - 24, size: headerSize, font, color: subtle,
        });
        const rightHeader = 'Corporate Minute Book';
        const rightHeaderWidth = font.widthOfTextAtSize(rightHeader, headerSize);
        page.drawText(rightHeader, {
            x: width - 36 - rightHeaderWidth, y: height - 24, size: headerSize, font, color: subtle,
        });

        // Footer
        page.drawText('Confidential', {
            x: 36, y: 24, size: footerSize, font, color: subtle,
        });
        const footerText = `Page ${pageNum} of ${totalPages}`;
        const footerWidth = font.widthOfTextAtSize(footerText, footerSize);
        page.drawText(footerText, {
            x: width - 36 - footerWidth, y: 24, size: footerSize, font, color: subtle,
        });
    });

    return Buffer.from(await merged.save());
};
