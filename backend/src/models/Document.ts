import mongoose, { Schema, Document } from 'mongoose';

export interface IDocument extends Document {
    companyId: mongoose.Types.ObjectId;
    title: string;
    type: string;
    fileUrl?: string;
    version: number;
    generatedAt: Date;
    generatedBy?: mongoose.Types.ObjectId;
}

const documentSchema: Schema = new Schema(
    {
        companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
        title: { type: String, required: true },
        type: { type: String, required: true },
        fileUrl: { type: String },
        version: { type: Number, default: 1 },
        generatedAt: { type: Date, default: Date.now },
        generatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    { timestamps: true }
);

export const DocumentModel = mongoose.model<IDocument>('Document', documentSchema);
