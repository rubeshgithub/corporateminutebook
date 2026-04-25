import express from 'express';
import { createCompany, getCompanies, getCompany, updateCompany, deleteCompany } from '../controllers/companyController';
import { protect } from '../middleware/authMiddleware';

const router = express.Router();

router.route('/')
    .post(protect, createCompany)
    .get(protect, getCompanies);

router.route('/:id')
    .get(protect, getCompany)
    .put(protect, updateCompany)
    .delete(protect, deleteCompany);

export default router;
