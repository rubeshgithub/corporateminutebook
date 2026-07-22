import mongoose, { Schema, Document } from 'mongoose';

/**
 * CompanyShare — a signed, time-limited read-only view of a company's
 * minute book, addressable via an opaque `token`. The whole sharing model
 * (both public links and email-invited CPA/lawyer access) collapses down
 * to a single doc type: the only differences are whether we send the
 * token by email on create, and an optional invitedEmail label.
 *
 *   Public link:      created with no invitedEmail → owner copies the URL.
 *   Invited CPA link: invitedEmail set → we email the URL to that address.
 *
 * Access is not tied to a MinuteBook user account. The token IS the
 * credential. Revoked or expired tokens 410. Owner can revoke at any time.
 */

export interface ICompanyShare extends Document {
    companyId:      mongoose.Types.ObjectId;
    createdBy:      mongoose.Types.ObjectId;   // owner user
    token:          string;                     // opaque URL-safe unique
    label?:         string;                     // user-friendly ("For Acme Bank")
    invitedEmail?:  string;                     // present iff auto-emailed
    permission:     'viewer';                   // future-proof: currently only viewer
    expiresAt:      Date;
    revokedAt?:     Date | null;
    lastAccessedAt?: Date | null;
    accessCount:    number;
    createdAt:      Date;
    updatedAt:      Date;
}

const companyShareSchema = new Schema<ICompanyShare>(
    {
        companyId:      { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        createdBy:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
        token:          { type: String, required: true, unique: true, index: true },
        label:          { type: String },
        invitedEmail:   { type: String, lowercase: true, trim: true },
        permission:     { type: String, enum: ['viewer'], default: 'viewer' },
        expiresAt:      { type: Date, required: true, index: true },
        revokedAt:      { type: Date, default: null },
        lastAccessedAt: { type: Date, default: null },
        accessCount:    { type: Number, default: 0 },
    },
    { timestamps: true },
);

export const CompanyShare = mongoose.model<ICompanyShare>('CompanyShare', companyShareSchema);
