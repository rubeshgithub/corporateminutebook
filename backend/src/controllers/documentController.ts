import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { DocumentModel } from '../models/Document';
import { ActivityLog } from '../models/ActivityLog';
import { Company } from '../models/Company';
import { generatePDFBuffer, generateMinuteBookPDF } from '../services/documentGenerator';

const TEMPLATE_LABELS: Record<string, string> = {
    articles_of_incorporation: 'Articles of Incorporation',
    by_laws: 'By-Laws No. 1',
    organizational_resolution: 'Organizational Resolution',
    consent_to_act: 'Consent to Act as Director',
    annual_director_resolution: 'Annual Director Resolution',
    annual_shareholder_resolution: 'Annual Shareholder Resolution',
    share_certificate: 'Share Certificate',
    registers: 'Corporate Registers',
};

export const generateDocument = async (req: AuthRequest, res: Response) => {
    try {
        const { companyId, documentType } = req.body;
        const userId = req.user?.id;

        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null });
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }

        if (!TEMPLATE_LABELS[documentType]) {
            return res.status(400).json({
                message: 'Invalid document type. Valid templates are: ' + Object.keys(TEMPLATE_LABELS).join(', '),
            });
        }

        const pdfBuffer = await generatePDFBuffer(company, documentType);

        const previousCount = await DocumentModel.countDocuments({ companyId, type: documentType });
        await DocumentModel.create({
            companyId,
            title: TEMPLATE_LABELS[documentType],
            type: documentType,
            version: previousCount + 1,
            generatedAt: new Date(),
        });

        await ActivityLog.create({
            userId,
            companyId,
            action: 'GENERATED_DOCUMENT',
            details: `Document ${documentType} generated for company ${company.name}.`,
        });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${documentType}.pdf`);
        res.send(pdfBuffer);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const getDocuments = async (req: AuthRequest, res: Response) => {
    try {
        const { companyId } = req.params;
        const userId = req.user?.id;

        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null });
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }

        const documents = await DocumentModel.find({ companyId }).sort({ generatedAt: -1 });
        res.json(documents);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const compileMinuteBook = async (req: AuthRequest, res: Response) => {
    try {
        const { companyId } = req.body;
        const userId = req.user?.id;

        const company = await Company.findOne({ _id: companyId, userId, deletedAt: null });
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }

        const pdfBuffer = await generateMinuteBookPDF(company);

        const previousCount = await DocumentModel.countDocuments({ companyId, type: 'minute_book' });
        await DocumentModel.create({
            companyId,
            title: 'Compiled Minute Book',
            type: 'minute_book',
            version: previousCount + 1,
            generatedAt: new Date(),
        });

        await ActivityLog.create({
            userId,
            companyId,
            action: 'COMPILED_MINUTE_BOOK',
            details: `Compiled Minute Book generated for ${company.name}.`,
        });

        const safeName = company.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${safeName}_minute_book.pdf`);
        res.send(pdfBuffer);
    } catch (error: any) {
        console.error('Failed to compile minute book:', error);
        res.status(500).json({ error: error.message });
    }
};
