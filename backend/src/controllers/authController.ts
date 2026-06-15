import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { sendOtpEmail } from '../services/emailService';

const generateToken = (id: string, role: string) =>
    jwt.sign({ id, role }, process.env.JWT_SECRET as string, { expiresIn: '30d' });

const OTP_TTL_MINUTES = 10;

export const requestOtp = async (req: Request, res: Response) => {
    try {
        const email = (req.body.email as string)?.toLowerCase().trim();
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const code = String(Math.floor(100000 + Math.random() * 900000));
        const expiry = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);

        await User.findOneAndUpdate(
            { email },
            { $set: { otpCode: code, otpExpiry: expiry } },
            { upsert: true, new: true }
        );

        await sendOtpEmail({ to: email, code });

        res.json({ message: 'Code sent. Check your email.' });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
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
        if (!user || !user.otpCode || !user.otpExpiry) {
            return res.status(401).json({ error: 'No code found. Request a new one.' });
        }

        if (new Date() > user.otpExpiry) {
            return res.status(401).json({ error: 'Code has expired. Request a new one.' });
        }

        if (user.otpCode !== code) {
            return res.status(401).json({ error: 'Invalid code.' });
        }

        user.otpCode = undefined;
        user.otpExpiry = undefined;
        if (!user.name) user.name = email.split('@')[0];
        await user.save();

        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            token: generateToken(user._id.toString(), user.role),
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
};
