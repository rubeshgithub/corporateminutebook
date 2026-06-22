import express from 'express';
import { createCompany, getCompanies, getCompany, updateCompany, deleteCompany, getComplianceSummary } from '../controllers/companyController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.route('/')
    .post(protect, createCompany)
    .get(protect, getCompanies);

// Must be before /:id to avoid "compliance" being treated as an ID
router.get('/compliance', protect, getComplianceSummary);

router.route('/:id')
    .get(protect, getCompany)
    .put(protect, updateCompany)
    .delete(protect, deleteCompany);

export default router;
