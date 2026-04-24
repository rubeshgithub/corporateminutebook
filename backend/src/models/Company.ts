import mongoose, { Schema, Document } from 'mongoose';

export interface ICompany extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    corporateAccessNumber?: string;
    businessNumber?: string;
    incorporationDate?: Date;
    registeredOfficeAddress: {
        street: string;
        city: string;
        province: string;
        postalCode: string;
        country: string;
    };
    directors: Array<{
        name: string;
        address: string;
        appointedDate: Date;
        resignedDate?: Date;
    }>;
    shareholders: Array<{
        name: string;
        sharesClass: string;
        numberOfShares: number;
    }>;
    fiscalYearEnd?: string; // e.g., "12-31"
    createdAt: Date;
    updatedAt: Date;
}

const companySchema: Schema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        name: { type: String, required: true },
        corporateAccessNumber: { type: String },
        businessNumber: { type: String },
        incorporationDate: { type: Date },
        registeredOfficeAddress: {
            street: String,
            city: String,
            province: String,
            postalCode: String,
            country: { type: String, default: 'Canada' },
        },
        directors: [
            {
                name: String,
                address: String,
                appointedDate: Date,
                resignedDate: Date,
            },
        ],
        shareholders: [
            {
                name: String,
                sharesClass: String,
                numberOfShares: Number,
            },
        ],
        fiscalYearEnd: { type: String },
    },
    { timestamps: true }
);

export const Company = mongoose.model<ICompany>('Company', companySchema);
