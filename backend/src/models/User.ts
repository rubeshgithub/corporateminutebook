import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    email: string;
    name: string;
    role: 'admin' | 'business_owner';
    subscriptionTier: 'free' | 'premium';
    // OTP is stored as a bcrypt hash, never plaintext — a database leak must
    // not hand an attacker a working login code for every account.
    otpHash?: string;
    otpExpiry?: Date;
    // Wrong-code counter for the current code. Guards against brute force of
    // a 6-digit code from many IPs, which per-IP rate limiting cannot see.
    otpAttempts?: number;
    /** @deprecated plaintext OTP from before hashing — no longer read or written. */
    otpCode?: string;
    // Origin — 'self_signup' if the user requested an OTP themselves,
    // 'crs_seeded' if the user record was created by the CRS ingest endpoint
    // from a customer's paid order (no OTP verified yet).
    origin: 'self_signup' | 'crs_seeded';
    // First successful OTP verify — for crs_seeded accounts this is the
    // moment they "claim" any pre-populated companies attached to them.
    firstLoggedInAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const userSchema: Schema = new Schema(
    {
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        name: { type: String, default: '' },
        role: { type: String, enum: ['admin', 'business_owner'], default: 'business_owner' },
        subscriptionTier: { type: String, enum: ['free', 'premium'], default: 'free' },
        otpHash: { type: String },
        otpExpiry: { type: Date },
        otpAttempts: { type: Number, default: 0 },
        otpCode: { type: String },   // legacy plaintext field, cleared on next code request
        origin: { type: String, enum: ['self_signup', 'crs_seeded'], default: 'self_signup' },
        firstLoggedInAt: { type: Date, default: null },
    },
    { timestamps: true }
);

export const User = mongoose.model<IUser>('User', userSchema);
