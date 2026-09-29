import mongoose, { Schema, Document } from 'mongoose';

export type FirmRole = 'supervisor' | 'member';

export interface IOrganizationInvite {
    _id: mongoose.Types.ObjectId;
    email: string;
    role: FirmRole;
    invitedBy: mongoose.Types.ObjectId;
    invitedAt: Date;
}

/**
 * A firm workspace (e.g. a law office). Membership lives on User
 * (organizationId + organizationRole) so every request resolves it with the
 * same indexed lookup; this document holds the firm's name and the invites
 * that have not been accepted yet. An invite is keyed by email — accepting
 * it requires signing in with that address, which is the proof of ownership.
 */
export interface IOrganization extends Document {
    name: string;
    type: 'law_firm';
    createdBy: mongoose.Types.ObjectId;
    invites: IOrganizationInvite[];
    createdAt: Date;
    updatedAt: Date;
}

const organizationSchema: Schema = new Schema(
    {
        name:      { type: String, required: true, trim: true, maxlength: 120 },
        type:      { type: String, enum: ['law_firm'], default: 'law_firm' },
        createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        invites: [
            {
                email:     { type: String, required: true, lowercase: true, trim: true },
                role:      { type: String, enum: ['supervisor', 'member'], default: 'member' },
                invitedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
                invitedAt: { type: Date, default: Date.now },
            },
        ],
    },
    { timestamps: true }
);

organizationSchema.index({ 'invites.email': 1 });

export const Organization = mongoose.model<IOrganization>('Organization', organizationSchema);
