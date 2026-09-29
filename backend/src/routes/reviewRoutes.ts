import express from 'express';
import { getReviewQueue, getReviewCompany, reviewMinuteBook, requireCrsReviewer } from '../controllers/approvalController';
import { protect } from '../middleware/authMiddleware';
import { validateParams } from '../middleware/validate';
import { companyIdParam } from '../schemas/approval.schema';

/** CRS review queue — business owners' minute books waiting for a CRS reviewer. */
const router = express.Router();

router.get('/', protect, requireCrsReviewer, getReviewQueue);
router.get('/:id', protect, requireCrsReviewer, validateParams(companyIdParam), getReviewCompany);
router.post('/:id/minute-book', protect, requireCrsReviewer, validateParams(companyIdParam), reviewMinuteBook);

export default router;
