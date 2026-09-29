import express from 'express';
import { createCompany, getCompanies, getCompany, updateCompany, deleteCompany, getComplianceSummary, getUpsellCandidates, resolveDrift, moveCompanyToFirm } from '../controllers/companyController';
import { submitForApproval, approveMinuteBook, requestChanges, reopenMinuteBook } from '../controllers/approvalController';
import { protect } from '../middleware/authMiddleware';
import { validateBody, validateParams } from '../middleware/validate';
import { createCompanySchema, updateCompanySchema } from '../schemas/company.schema';
import { approvalNoteSchema, requestChangesSchema, companyIdParam } from '../schemas/approval.schema';

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

// User acknowledgment: "I've reconciled the drift with the registry."
router.post('/:id/resolve-drift', protect, resolveDrift);
router.post('/:id/move-to-firm', protect, moveCompanyToFirm);

// Minute book approval: firm books by a supervisor, personal books by a CRS reviewer.
router.post('/:id/approval/submit',          protect, validateParams(companyIdParam), validateBody(approvalNoteSchema),   submitForApproval);
router.post('/:id/approval/approve',         protect, validateParams(companyIdParam), validateBody(approvalNoteSchema),   approveMinuteBook);
router.post('/:id/approval/request-changes', protect, validateParams(companyIdParam), validateBody(requestChangesSchema), requestChanges);
router.post('/:id/approval/reopen',          protect, validateParams(companyIdParam), validateBody(approvalNoteSchema),   reopenMinuteBook);

export default router;
