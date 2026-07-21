import express from 'express';
import { createCompany, getCompanies, getCompany, updateCompany, deleteCompany, getComplianceSummary, getUpsellCandidates } from '../controllers/companyController';
import { protect } from '../middleware/authMiddleware';
import { validateBody } from '../middleware/validate';
import { createCompanySchema, updateCompanySchema } from '../schemas/company.schema';

const router = express.Router();

router.route('/')
    .post(protect, validateBody(createCompanySchema), createCompany)
    .get(protect, getCompanies);

// Must be before /:id to avoid these paths being treated as IDs
router.get('/compliance',        protect, getComplianceSummary);
router.get('/upsell-candidates', protect, getUpsellCandidates);

router.route('/:id')
    .get(protect, getCompany)
    .put(protect, validateBody(updateCompanySchema), updateCompany)
    .delete(protect, deleteCompany);

export default router;
