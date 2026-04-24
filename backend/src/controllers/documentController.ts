import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { DocumentModel } from '../models/Document';
import { ActivityLog } from '../models/ActivityLog';
import { Company } from '../models/Company';
import { generatePDFBuffer } from '../services/documentGenerator';

export const generateDocument = async (req: AuthRequest, res: Response) => {
    try {
        const { companyId, documentType } = req.body;
        const userId = req.user?.id;

        const company = await Company.findOne({ _id: companyId, userId });
        if (!company) {
            return res.status(404).json({ message: 'Company not found' });
        }

        // Validate Document Type against available templates
        const validTemplates = ['articles_of_incorporation', 'by_laws'];
        if (!validTemplates.includes(documentType)) {
            return res.status(400).json({ message: 'Invalid document type. Valid templates are: ' + validTemplates.join(', ') })
        }

        // Generate the PDF Buffer
        const pdfBuffer = await generatePDFBuffer(company, documentType);

        // The original code had a DocumentModel.create here, but the new code doesn't.
        // Assuming the intent is to remove the database entry for the document itself
        // and only log the activity.

        await ActivityLog.create({
            userId,
            companyId,
            action: 'GENERATED_DOCUMENT',
            details: `Document ${documentType} generated for company ${company.name}.`,
        });

        // Instead of returning JSON, we stream the PDF back directly
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
        const documents = await DocumentModel.find({ companyId });
        res.json(documents);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
