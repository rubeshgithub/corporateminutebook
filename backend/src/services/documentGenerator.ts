import ejs from 'ejs';
import puppeteer, { PDFOptions } from 'puppeteer';
import path from 'path';
import fs from 'fs';
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

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    await page.setContent(compiledHtml, { waitUntil: 'networkidle0' });

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
    const compiledHtml = renderTemplate('minute_book', { company });

    const safeName = company.name.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const headerTemplate = `
        <div style="font-size:8pt; width:100%; padding: 0 0.5in; color:#777; display:flex; justify-content:space-between;">
            <span>${safeName}</span>
            <span>Corporate Minute Book</span>
        </div>`;
    const footerTemplate = `
        <div style="font-size:8pt; width:100%; padding: 0 0.5in; color:#777; display:flex; justify-content:space-between;">
            <span>Confidential</span>
            <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
        </div>`;

    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    await page.setContent(compiledHtml, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '0.7in', right: '0.7in', bottom: '0.7in', left: '0.7in' },
        displayHeaderFooter: true,
        headerTemplate,
        footerTemplate,
    });

    await browser.close();

    return Buffer.from(pdfBuffer);
};
