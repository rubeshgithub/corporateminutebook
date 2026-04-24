import express from 'express';
import { fetchRegistryData } from '../controllers/registryController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.get('/fetch', protect, fetchRegistryData);

export default router;
