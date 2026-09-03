import mongoose, { Schema, Document } from 'mongoose';

export type CorporateEventType =
    | 'director_appointed'
    | 'director_resigned'
    | 'director_address_changed'
    | 'address_changed'
    | 'shares_issued'
    | 'shares_transferred'
    | 'shares_cancelled'
    | 'officer_appointed'
    | 'officer_resigned'
    | 'share_class_added'
    | 'annual_return_filed'
    | 'fiscal_year_end_changed'
    | 'name_changed'
    | 'voluntary_dissolution_filed'
    | 'revival_filed'
    // Wave 2 additions:
    | 'signing_authority_granted'    // bank-critical: identifies who can bind the corp
    | 'signing_authority_revoked'
    | 'dividend_declared';           // T5-critical: pairs the declaration with a resolution

export type AttachmentRole = 'resolution' | 'registry_filing' | 'supporting';

export type ESignStatus = 'none' | 'pending' | 'completed' | 'expired';

export interface IEventAttachment {
    role: AttachmentRole;
    fileId: string;
    originalName: string;
    uploadedAt: Date;
}

export interface IESign {
    submissionId?: number;
    signingUrl?: string;
    status: ESignStatus;
    sentAt?: Date;
}

export interface ICorporateEvent extends Document {
    companyId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    eventType: CorporateEventType;
    effectiveDate: Date;
    recordedAt: Date;
    data: Record<string, unknown>;
    notes?: string;
    attachments: IEventAttachment[];
    eSign: IESign;
    /** Soft-delete marker. Nulled events stay in the DB but are filtered from
     *  reads + PDF compilation. Applying an inverse to the company snapshot
     *  isn't safe (most events are lossy — they don't preserve pre-state), so
     *  the deletion is a bookkeeping action, not a state rewind. The UI
     *  warns the user to correct the company directly if needed. */
    deletedAt?: Date | null;
    /** True when the user has confirmed no separate registry filing is
     *  expected for this event — e.g. share issuances recorded at
     *  incorporation (already in the Articles), or shareholders in
     *  provinces that don't record them at the registry level.
     *  Compliance gap detection + minute-book "Registry Filing" column
     *  treat this as satisfied rather than pending. */
    registryFilingNotApplicable?: boolean;
}

const attachmentSchema = new Schema<IEventAttachment>(
    {
        role: { type: String, enum: ['resolution', 'registry_filing', 'supporting'], required: true },
        fileId: { type: String, required: true },
        originalName: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const eSignSchema = new Schema<IESign>(
    {
        submissionId: { type: Number },
        signingUrl:   { type: String },
        status:       { type: String, enum: ['none', 'pending', 'completed', 'expired'], default: 'none' },
        sentAt:       { type: Date },
    },
    { _id: false },
);

const corporateEventSchema = new Schema<ICorporateEvent>(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        eventType: {
            type: String,
            required: true,
            enum: [
                'director_appointed', 'director_resigned', 'director_address_changed',
                'address_changed', 'shares_issued', 'shares_transferred', 'shares_cancelled',
                'officer_appointed', 'officer_resigned', 'share_class_added',
                'annual_return_filed', 'fiscal_year_end_changed', 'name_changed',
                'voluntary_dissolution_filed', 'revival_filed',
                'signing_authority_granted', 'signing_authority_revoked', 'dividend_declared',
            ],
        },
        effectiveDate: { type: Date, required: true },
        recordedAt: { type: Date, default: Date.now },
        data: { type: Schema.Types.Mixed, default: {} },
        notes: { type: String },
        attachments: { type: [attachmentSchema], default: [] },
        eSign: { type: eSignSchema, default: () => ({ status: 'none' }) },
        deletedAt: { type: Date, default: null, index: true },
        registryFilingNotApplicable: { type: Boolean, default: false },
    },
    { timestamps: false },
);

// The dominant read shape: find({ companyId, deletedAt: null }) sorted by
// effectiveDate (both directions — vault, compile, share view). The compound
// serves filter + sort in one index walk.
corporateEventSchema.index({ companyId: 1, deletedAt: 1, effectiveDate: 1 });

export const CorporateEvent = mongoose.model<ICorporateEvent>('CorporateEvent', corporateEventSchema);
