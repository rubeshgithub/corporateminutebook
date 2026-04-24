import mongoose, { Schema, Document } from 'mongoose';

export interface IUser extends Document {
    email: string;
    passwordHash: string;
    name: string;
    role: 'admin' | 'business_owner';
    subscriptionTier: 'free' | 'premium';
    createdAt: Date;
    updatedAt: Date;
}

const userSchema: Schema = new Schema(
    {
        email: { type: String, required: true, unique: true, lowercase: true, trim: true },
        passwordHash: { type: String, required: true },
        name: { type: String, required: true },
        role: { type: String, enum: ['admin', 'business_owner'], default: 'business_owner' },
        subscriptionTier: { type: String, enum: ['free', 'premium'], default: 'free' },
    },
    { timestamps: true }
);

export const User = mongoose.model<IUser>('User', userSchema);
