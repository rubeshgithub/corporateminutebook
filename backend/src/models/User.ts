import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    email: string;
    name: string;
    role: 'admin' | 'business_owner';
    subscriptionTier: 'free' | 'premium';
    otpCode?: string;
    otpExpiry?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const userSchema: Schema = new Schema(
    {
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        name: { type: String, default: '' },
        role: { type: String, enum: ['admin', 'business_owner'], default: 'business_owner' },
        subscriptionTier: { type: String, enum: ['free', 'premium'], default: 'free' },
        otpCode: { type: String },
        otpExpiry: { type: Date },
    },
    { timestamps: true }
);

export const User = mongoose.model<IUser>('User', userSchema);
