import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';

// Stub external API call
export const fetchRegistryData = async (req: AuthRequest, res: Response) => {
    try {
        const { accessNumber, jurisdiction } = req.query;

        if (!accessNumber) {
            return res.status(400).json({ error: 'Access number is required' });
        }

        // Mock response from a registry like Alberta Corporate Registry API
        const mockData = {
            name: 'Mock Corporation Ltd.',
            corporateAccessNumber: accessNumber,
            incorporationDate: new Date().toISOString(),
            registeredOfficeAddress: {
                street: '123 Fake Street',
                city: 'Calgary',
                province: 'AB',
                postalCode: 'T2P 1J9',
                country: 'Canada',
            },
            status: 'Active',
        };

        res.json(mockData);
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
