import express from 'express';
import { generateDocument, getDocuments, compileMinuteBook, generateInauguralPackage } from '../controllers/documentController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/generate', protect, generateDocument);
router.post('/compile', protect, compileMinuteBook);
router.post('/inaugural', protect, generateInauguralPackage);
router.get('/:companyId', protect, getDocuments);

export default router;
