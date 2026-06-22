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
    | 'name_changed';

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
            ],
        },
        effectiveDate: { type: Date, required: true },
        recordedAt: { type: Date, default: Date.now },
        data: { type: Schema.Types.Mixed, default: {} },
        notes: { type: String },
        attachments: { type: [attachmentSchema], default: [] },
        eSign: { type: eSignSchema, default: () => ({ status: 'none' }) },
    },
    { timestamps: false },
);

export const CorporateEvent = mongoose.model<ICorporateEvent>('CorporateEvent', corporateEventSchema);
