import mongoose, { Schema, Document } from 'mongoose';

export interface IActivityLog extends Document {
    userId: mongoose.Types.ObjectId;
    companyId?: mongoose.Types.ObjectId;
    action: string;
    details?: string;
    timestamp: Date;
}

const activityLogSchema: Schema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        companyId: { type: Schema.Types.ObjectId, ref: 'Company' },
        action: { type: String, required: true },
        details: { type: String },
        timestamp: { type: Date, default: Date.now },
    },
    { timestamps: false }
);

export const ActivityLog = mongoose.model<IActivityLog>('ActivityLog', activityLogSchema);
