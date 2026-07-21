import express from 'express';
import rateLimit from 'express-rate-limit';
import { requestOtp, verifyOtp } from '../controllers/authController';

const router = express.Router();

/**
 * OTP protection uses two limiters chained so an attacker can't bypass either
 * dimension: rotating IPs still hit the email cap; a single IP still hits the
 * per-IP cap even without an email. Without this, unlimited SES sends per
 * address = deliverability + reputation damage before we ever detect it.
 */

const otpRequestIpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many code requests from this address. Please try again in 15 minutes.' },
});

const otpRequestEmailLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,   // 1h — per-email is stricter than per-IP
    max: 5,                      // 5 codes/hour per email is more than enough for legitimate resends
    standardHeaders: true,
    legacyHeaders: false,
    // Key on the target email so a single account can't be spammed even
    // across many IPs. Anonymous requests (no email in body) fall back to
    // IP so we still get *some* bucketing.
    keyGenerator: (req) => {
        const email = String(req.body?.email ?? '').toLowerCase().trim();
        return email || `no-email:${req.ip}`;
    },
    message: { error: 'This email has requested too many codes. Please try again in an hour.' },
});

const otpVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});

router.post('/request-otp', otpRequestIpLimiter, otpRequestEmailLimiter, requestOtp);
router.post('/verify-otp', otpVerifyLimiter, verifyOtp);

export default router;
