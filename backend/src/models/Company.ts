import mongoose, { Schema, Document } from 'mongoose';

export interface ICompany extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    corporateAccessNumber?: string;
    businessNumber?: string;
    incorporationDate?: Date;
    minDirectors?: number;
    maxDirectors?: number;
    registeredOfficeAddress: {
        street: string;
        city: string;
        province: string;
        postalCode: string;
        country: string;
    };
    recordsAddress: {
        sameAsRegistered: boolean;
        street?: string;
        city?: string;
        province?: string;
        postalCode?: string;
        country?: string;
    };
    addressForService: {
        sameAsRegistered: boolean;
        sameAsRecords?: boolean;
        poBox?: string;
        street?: string;
        city?: string;
        province?: string;
        postalCode?: string;
        country?: string;
        email?: string;
    };
    restrictions: {
        // legacy single field (kept for backward compat with existing docs)
        hasRestrictions?: boolean;
        description?: string;
        // new split fields
        restrictedTo?: { has: boolean; description?: string };
        restrictedFrom?: { has: boolean; description?: string };
    };
    authorizedBy: {
        name: string;
        company?: string;
        email: string;
        phone: string;
    };
    schedules: Array<{
        name: string;
        content: string;
    }>;
    shareClasses: Array<{
        name: string;             // e.g. "Class A Common Voting Shares"
        type: 'Common' | 'Preferred';
        voting: boolean;
        maxAuthorized?: number | null;   // null = unlimited
        parValue?: number | null;        // null = no par
        // Detailed rights/restrictions are NOT stored here — they belong in Schedule A (free-text Schedules step), per Canadian standard practice
    }>;
    directors: Array<{
        name: string;             // legacy full-name (kept; auto-built from parts if available)
        firstName?: string;
        middleName?: string;
        lastName?: string;
        address: string;          // street line
        city?: string;
        province?: string;
        postalCode?: string;
        residentCanadian?: boolean;
        appointedDate: Date;
        resignedDate?: Date;
        email?: string;
        phone?: string;
    }>;
    shareholders: Array<{
        name: string;
        sharesClass: string;
        numberOfShares: number;
        holderType?: 'Individual' | 'Legal Entity';
        corporateAccessNumber?: string;
        businessNumber?: string;
        address?: string;         // street line
        city?: string;
        province?: string;
        postalCode?: string;
        votingPercent?: number;
        certificateNumber?: number;
        considerationPaid?: number;
        issuanceDate?: Date;
        email?: string;
        phone?: string;
    }>;
    officers: Array<{
        name: string;
        title: string;
        appointedDate: Date;
        resignedDate?: Date;
        email?: string;
        phone?: string;
    }>;
    fiscalYearEnd?: string; // e.g., "12-31"
    annualReturnDueDate?: string; // MM-DD — anniversary date when annual return is due
    incorporationDocumentFile?: string; // UUID filename stored in uploads/
    // Origin — 'user_created' if the user built this in the MinuteBook wizard,
    // 'crs_seeded' if it was materialized from a CRS paid order and hasn't yet
    // been claimed by the customer logging in via OTP.
    origin: 'user_created' | 'crs_seeded';
    // Email that appeared on the CRS order — matches User.email once claimed.
    crsCustomerEmail?: string;
    // Set at the moment the owning user's first OTP verify completes, i.e.
    // when a crs_seeded company is legitimately taken over by its user.
    claimedAt?: Date | null;
    // Registry signature used as the upsert dedupe key so re-orders and
    // webhook replays don't create duplicate company records.
    registrySignature?: {
        provinceKey: string;   // "ab", "bc", "federal", …
        registryId: string;    // MRAS_ID / BC OrgBook source_id
    };
    deletedAt?: Date | null;
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
        minDirectors: { type: Number },
        maxDirectors: { type: Number },
        registeredOfficeAddress: {
            street: String,
            city: String,
            province: String,
            postalCode: String,
            country: { type: String, default: 'Canada' },
        },
        recordsAddress: {
            sameAsRegistered: { type: Boolean, default: true },
            street: String,
            city: String,
            province: String,
            postalCode: String,
            country: String,
        },
        addressForService: {
            sameAsRegistered: { type: Boolean, default: true },
            sameAsRecords: { type: Boolean, default: false },
            poBox: String,
            street: String,
            city: String,
            province: String,
            postalCode: String,
            country: String,
            email: String,
        },
        restrictions: {
            hasRestrictions: { type: Boolean, default: false },
            description: String,
            restrictedTo: {
                has: { type: Boolean, default: false },
                description: String,
            },
            restrictedFrom: {
                has: { type: Boolean, default: false },
                description: String,
            },
        },
        authorizedBy: {
            name: String,
            company: String,
            email: String,
            phone: String,
        },
        schedules: [
            {
                name: String,
                content: String,
            },
        ],
        shareClasses: [
            {
                name: String,
                type: { type: String, enum: ['Common', 'Preferred'], default: 'Common' },
                voting: { type: Boolean, default: true },
                maxAuthorized: Number,
                parValue: Number,
            },
        ],
        directors: [
            {
                name: String,
                firstName: String,
                middleName: String,
                lastName: String,
                address: String,
                city: String,
                province: String,
                postalCode: String,
                residentCanadian: { type: Boolean, default: true },
                appointedDate: Date,
                resignedDate: Date,
                email: String,
                phone: String,
            },
        ],
        shareholders: [
            {
                name: String,
                sharesClass: String,
                numberOfShares: Number,
                holderType: { type: String, enum: ['Individual', 'Legal Entity'], default: 'Individual' },
                corporateAccessNumber: String,
                businessNumber: String,
                address: String,
                city: String,
                province: String,
                postalCode: String,
                votingPercent: Number,
                certificateNumber: Number,
                considerationPaid: Number,
                issuanceDate: Date,
                email: String,
                phone: String,
            },
        ],
        officers: [
            {
                name: String,
                title: String,
                appointedDate: Date,
                resignedDate: Date,
                email: String,
                phone: String,
            },
        ],
        fiscalYearEnd: { type: String },
        annualReturnDueDate: { type: String },
        incorporationDocumentFile: { type: String },
        origin: { type: String, enum: ['user_created', 'crs_seeded'], default: 'user_created' },
        crsCustomerEmail: { type: String, index: true },
        claimedAt: { type: Date, default: null },
        registrySignature: {
            provinceKey: String,
            registryId:  String,
        },
        deletedAt: { type: Date, default: null },
    },
    { timestamps: true }
);

// Compound index on (provinceKey, registryId) — supports the O(1) dedupe
// lookup the CRS ingest endpoint uses to avoid duplicate companies when
// the same corp gets multiple filings.
companySchema.index({
    'registrySignature.provinceKey': 1,
    'registrySignature.registryId':  1,
});

export const Company = mongoose.model<ICompany>('Company', companySchema);
