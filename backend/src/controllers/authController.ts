import { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { sendOtpEmail } from '../services/emailService';
import { AuthRequest } from '../middleware/authMiddleware';
import { serverError } from '../utils/apiError';

const generateToken = (id: string, role: string) =>
    jwt.sign({ id, role }, process.env.JWT_SECRET as string, { expiresIn: '30d' });

const OTP_TTL_MINUTES = 10;
/** Wrong guesses allowed per issued code before it is burned. */
const OTP_MAX_ATTEMPTS = 5;
const OTP_BCRYPT_ROUNDS = 10;
const AUTH_COOKIE = 'mb_auth';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;   // matches the JWT expiry

/**
 * Cookie config. In production the SPA and API are on separate Render
 * domains, which is cross-origin — the cookie has to be sameSite: 'none'
 * with secure: true to be sent on those XHRs. In dev we run on
 * http://localhost, so sameSite: 'lax' + secure: false is the working
 * combo. NODE_ENV=production drives the switch.
 */
function setAuthCookie(res: Response, token: string) {
    const isProd = process.env.NODE_ENV === 'production';
    res.cookie(AUTH_COOKIE, token, {
        httpOnly: true,
        secure:   isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge:   COOKIE_MAX_AGE_MS,
        path:     '/',
    });
}

function clearAuthCookie(res: Response) {
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie(AUTH_COOKIE, {
        httpOnly: true,
        secure:   isProd,
        sameSite: isProd ? 'none' : 'lax',
        path:     '/',
    });
}

export const requestOtp = async (req: Request, res: Response) => {
    try {
        const email = (req.body.email as string)?.toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Email is required' });

        // crypto.randomInt is a CSPRNG — Math.random() is seeded predictably
        // and its output can be reconstructed from observed values.
        const code = String(crypto.randomInt(100_000, 1_000_000));
        const expiry = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

        await User.findOneAndUpdate(
            { email },
            {
                $set: {
                    otpHash: await bcrypt.hash(code, OTP_BCRYPT_ROUNDS),
                    otpExpiry: expiry,
                    otpAttempts: 0,
                },
                $unset: { otpCode: '' },   // drop any legacy plaintext code
            },
            { upsert: true, new: true }
        );

        await sendOtpEmail({ to: email, code });

        res.json({ message: 'Code sent. Check your email.' });
    } catch (error: any) {
        serverError(res, 'requestOtp', error);
    }
};

export const verifyOtp = async (req: Request, res: Response) => {
    try {
        const email = (req.body.email as string)?.toLowerCase().trim();
        const code = (req.body.code as string)?.trim();

        if (!email || !code) {
            return res.status(400).json({ error: 'Email and code are required' });
        }

        const user = await User.findOne({ email });
        if (!user || !user.otpHash || !user.otpExpiry) {
            return res.status(401).json({ error: 'No code found. Request a new one.' });
        }

        if (new Date() > user.otpExpiry) {
            return res.status(401).json({ error: 'Code has expired. Request a new one.' });
        }

        // Burn the code once it has been guessed at too many times, so a
        // distributed attacker can't walk the 1M-code space with one code.
        if ((user.otpAttempts ?? 0) >= OTP_MAX_ATTEMPTS) {
            user.otpHash = undefined;
            user.otpExpiry = undefined;
            user.otpAttempts = 0;
            await user.save();
            return res.status(401).json({ error: 'Too many incorrect attempts. Request a new code.' });
        }

        // bcrypt.compare is constant-time for a given hash.
        if (!(await bcrypt.compare(code, user.otpHash))) {
            user.otpAttempts = (user.otpAttempts ?? 0) + 1;
            await user.save();
            return res.status(401).json({ error: 'Invalid code.' });
        }

        user.otpHash = undefined;
        user.otpExpiry = undefined;
        user.otpAttempts = 0;
        if (!user.name) user.name = email.split('@')[0];

        // First successful OTP verify is the "claim" moment for accounts that
        // were seeded from a paid CRS order. We stamp firstLoggedInAt on the
        // user and mark every crs_seeded company they own as claimed, so the
        // dashboard can distinguish "still an anonymous seed" from "the real
        // owner is now signed in."
        const isFirstLogin = user.origin === 'crs_seeded' && !user.firstLoggedInAt;
        if (isFirstLogin) {
            user.firstLoggedInAt = new Date();
            await Company.updateMany(
                { userId: user._id, origin: 'crs_seeded', claimedAt: null },
                { $set: { claimedAt: new Date() } },
            );
        }
        await user.save();

        // Token now rides in an httpOnly cookie — no longer returned in the
        // body. XSS in the SPA can't read it. The client keeps user metadata
        // in localStorage as a cache for UI; the cookie is the source of
        // truth, and any 401 bounces to login.
        setAuthCookie(res, generateToken(user._id.toString(), user.role));

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            justClaimed: isFirstLogin,  // frontend uses this to show a welcome flash
        });
    } catch (error: any) {
        serverError(res, 'verifyOtp', error);
    }
};

export const logout = (_req: Request, res: Response) => {
    clearAuthCookie(res);
    res.json({ ok: true });
};

/**
 * POST /api/auth/test-mint-session — CI/persona-test session bypass.
 *
 * Guarded by BOTH:
 *   - TEST_MODE_ENABLED=true (env)
 *   - x-test-token header matching TEST_MODE_TOKEN (env)
 *
 * When either check fails we 404 (env off) or 401 (bad token), so a
 * production instance without the env vars is completely opaque to any
 * request that hits this endpoint. Existing users are reused when
 * present; otherwise a bare user is materialized so persona tests can
 * hit any email without pre-seeding.
 *
 * This is the only way the automated persona test suite can log in
 * without going through the OTP + SES round-trip.
 */
export const testMintSession = async (req: Request, res: Response) => {
    if (process.env.TEST_MODE_ENABLED !== 'true') {
        return res.status(404).json({ error: 'Not found.' });
    }
    const expectedToken = process.env.TEST_MODE_TOKEN;
    const providedToken = req.header('x-test-token');
    if (!expectedToken || providedToken !== expectedToken) {
        return res.status(401).json({ error: 'Invalid test token.' });
    }

    const email = String(req.body?.email ?? '').toLowerCase().trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email is required.' });
    }

    let user = await User.findOne({ email });
    if (!user) {
        user = await User.create({
            email,
            name:             email.split('@')[0],
            role:             'business_owner',
            subscriptionTier: 'free',
        });
    }

    setAuthCookie(res, generateToken(user._id.toString(), user.role));
    return res.json({
        _id:   user._id,
        name:  user.name,
        email: user.email,
        role:  user.role,
        testSession: true,
    });
};

/**
 * Returns the current user's public profile — used by the SPA on boot to
 * decide whether the cached user in localStorage is still logged in
 * server-side. If the cookie is missing/expired, `protect` returns 401
 * and the frontend clears its cache.
 */
export const me = async (req: AuthRequest, res: Response) => {
    try {
        const user = await User.findById(req.user!.id).select('_id name email role');
        if (!user) return res.status(404).json({ error: 'User not found.' });
        res.json({ _id: user._id, name: user.name, email: user.email, role: user.role });
    } catch (error: any) {
        serverError(res, 'me', error);
    }
};
