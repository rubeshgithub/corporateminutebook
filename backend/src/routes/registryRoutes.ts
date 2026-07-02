import express from 'express';
import { fetchRegistryData, searchRegistry } from '../controllers/registryController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.get('/search', protect, searchRegistry);
router.get('/fetch',  protect, fetchRegistryData);

export default router;
