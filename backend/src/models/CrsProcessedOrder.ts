import mongoose, { Schema, Document } from 'mongoose';

/**
 * Records that we've already ingested a CRS order webhook, keyed by the
 * Stripe checkout session id. Prevents duplicate company records and event
 * writes when Stripe retries webhook delivery, or when the CRS webhook
 * itself retries after a transient failure calling our endpoint.
 */
export interface ICrsProcessedOrder extends Document {
    sessionId:  string;                    // "cs_live_..." — unique per Stripe session
    service:    string;                    // "annual-return", "change-directors", …
    companyId:  mongoose.Types.ObjectId;
    userId:     mongoose.Types.ObjectId;
    eventsCreated: number;
    receivedAt: Date;
}

const crsProcessedOrderSchema: Schema = new Schema(
    {
        sessionId:     { type: String, required: true, unique: true, index: true },
        service:       { type: String, required: true },
        companyId:     { type: Schema.Types.ObjectId, ref: 'Company', required: true },
        userId:        { type: Schema.Types.ObjectId, ref: 'User',    required: true },
        eventsCreated: { type: Number, default: 0 },
        receivedAt:    { type: Date,   default: Date.now },
    },
    { timestamps: false }
);

export const CrsProcessedOrder = mongoose.model<ICrsProcessedOrder>('CrsProcessedOrder', crsProcessedOrderSchema);
