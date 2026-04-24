import ejs from 'ejs';
import puppeteer from 'puppeteer';
import path from 'path';
import fs from 'fs';
import { ICompany } from '../models/Company';

/**
 * Generates a PDF buffer from an EJS template and company data.
 */
export const generatePDFBuffer = async (company: ICompany, templateName: string): Promise<Buffer> => {
    const templatePath = path.join(__dirname, '..', 'templates', `${templateName}.ejs`);

    // Read and render EJS template
    const templateHtml = fs.readFileSync(templatePath, 'utf-8');
    const compiledHtml = ejs.render(templateHtml, { company });

    // Launch Puppeteer and generate PDF
    // Note: --no-sandbox is often required depending on the hosting environment (like Docker)
    const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    await page.setContent(compiledHtml, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
        format: 'Letter',
        printBackground: true,
        margin: { top: '1in', right: '1in', bottom: '1in', left: '1in' }
    });

    await browser.close();

    return Buffer.from(pdfBuffer);
};
