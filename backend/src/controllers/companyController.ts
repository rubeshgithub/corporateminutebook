import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import { Company } from '../models/Company';
import { ActivityLog } from '../models/ActivityLog';

const ACTIVE = { deletedAt: null };

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
        const companies = await Company.find({ userId, ...ACTIVE });
        res.json(companies);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const getCompany = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const company = await Company.findOne({ _id: req.params.id, userId, ...ACTIVE });
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        res.json(company);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const updateCompany = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const { userId: _ignoreUserId, _id: _ignoreId, deletedAt: _ignoreDeleted, ...updates } = req.body;

        const company = await Company.findOneAndUpdate(
            { _id: req.params.id, userId, ...ACTIVE },
            updates,
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        await ActivityLog.create({
            userId,
            companyId: company._id,
            action: 'UPDATED_COMPANY',
            details: `Company ${company.name} updated.`,
        });

        res.json(company);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};

export const deleteCompany = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user?.id;
        const company = await Company.findOneAndUpdate(
            { _id: req.params.id, userId, ...ACTIVE },
            { deletedAt: new Date() },
            { new: true }
        );

        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }

        await ActivityLog.create({
            userId,
            companyId: company._id,
            action: 'DELETED_COMPANY',
            details: `Company ${company.name} deleted.`,
        });

        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
