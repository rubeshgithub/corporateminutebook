import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Company } from '../models/Company';
import { ActivityLog } from '../models/ActivityLog';

export const createCompany = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const companyData = req.body;

        const company = await Company.create({
            ...companyData,
            userId,
        });

        await ActivityLog.create({
            userId,
            companyId: company._id,
            action: 'CREATED_COMPANY',
            details: `Company ${company.name} created.`,
        });

        res.status(201).json(company);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const getCompanies = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const companies = await Company.find({ userId });
        res.json(companies);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
