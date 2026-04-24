import express from 'express';
import { createCompany, getCompanies } from '../controllers/companyController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.route('/')
    .post(protect, createCompany)
    .get(protect, getCompanies);

export default router;
