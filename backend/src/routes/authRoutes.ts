import express from 'express';
import rateLimit from 'express-rate-limit';
import { requestOtp, verifyOtp } from '../controllers/authController';

const router = express.Router();

const otpRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many code requests. Please try again in 15 minutes.' },
});

const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

router.post('/request-otp', otpRequestLimiter, requestOtp);
router.post('/verify-otp', otpVerifyLimiter, verifyOtp);

export default router;
