import { z } from 'zod';
import {
    shortString, mediumString, xlString,
    emailField, phoneField, postalField,
    optionalIsoDate, addressBlock,
} from './common';

/**
 * Company schema is intentionally permissive on nested arrays (share classes,
 * shareholders, directors, officers, schedules) — the Mongoose model already
 * enforces the shape, and full parity would require duplicating hundreds of
 * lines of frontend Zod. Focus here is on the top-level primitives and
 * length caps that block obvious abuse (10 MB strings, wrong scalar type).
 *
 * Cross-field rules (like minDirectors <= maxDirectors) live in refine().
 */

const personName = shortString.min(1, 'Name is required.');

const shareClass = z.object({
    name:          shortString.min(1),
    type:          z.enum(['Common', 'Preferred']),
    voting:        z.boolean().optional(),
    maxAuthorized: z.number().int().nullable().optional(),
    parValue:      z.number().nullable().optional(),
});

const director = z.object({
    name:             shortString.optional(),
    firstName:        shortString.optional(),
    middleName:       shortString.optional(),
    lastName:         shortString.optional(),
    address:          shortString.optional(),
    city:             shortString.optional(),
    province:         shortString.optional(),
    postalCode:       postalField.optional(),
    residentCanadian: z.boolean().optional(),
    appointedDate:    optionalIsoDate,
    resignedDate:     optionalIsoDate,
    email:            emailField.optional().or(z.literal('')),
    phone:            phoneField.optional(),
});

const shareholder = z.object({
    name:                shortString.min(1),
    holderType:          z.enum(['Individual', 'Legal Entity']).optional(),
    corporateAccessNumber: shortString.optional(),
    sharesClass:         shortString.min(1),
    numberOfShares:      z.number().int().nonnegative().optional(),
    votingPercent:       z.number().min(0).max(100).optional(),
    address:             shortString.optional(),
    city:                shortString.optional(),
    province:            shortString.optional(),
    postalCode:          postalField.optional(),
    certificateNumber:   z.number().int().positive().optional(),
    considerationPaid:   z.number().nonnegative().optional(),
    issuanceDate:        optionalIsoDate,
});

const officer = z.object({
    name:          personName,
    title:         shortString,
    appointedDate: optionalIsoDate,
    resignedDate:  optionalIsoDate,
});

const schedule = z.object({
    name:    shortString.min(1),
    // Schedule A / B free-text can be long-form legal prose (share class
    // terms, rights, restrictions) that legitimately runs many pages.
    content: xlString,
});

const authorizedBy = z.object({
    name:    personName,
    company: shortString.optional(),
    email:   emailField,
    phone:   phoneField,
});

const restrictions = z.object({
    hasRestrictions: z.boolean().optional(),
    description:     mediumString.optional(),
    restrictedTo:    z.object({ has: z.boolean(), description: mediumString.optional() }).optional(),
    restrictedFrom:  z.object({ has: z.boolean(), description: mediumString.optional() }).optional(),
}).partial();

const companyCore = z.object({
    name:                    shortString.min(1, 'Company name is required.'),
    corporateAccessNumber:   shortString.optional(),
    businessNumber:          shortString.optional(),
    incorporationDate:       optionalIsoDate,
    minDirectors:            z.number().int().positive().optional(),
    maxDirectors:            z.number().int().positive().optional(),
    fiscalYearEnd:           shortString.optional(),           // MM-DD
    annualReturnDueDate:     shortString.optional(),           // MM-DD
    registeredOfficeAddress: addressBlock,
    recordsAddress:          addressBlock.extend({ sameAsRegistered: z.boolean().optional() }).partial(),
    addressForService:       addressBlock.extend({
        sameAsRegistered: z.boolean().optional(),
        sameAsRecords:    z.boolean().optional(),
        poBox:            shortString.optional(),
        email:            emailField.optional().or(z.literal('')),
    }).partial(),
    restrictions:            restrictions.optional(),
    authorizedBy:            authorizedBy.optional(),
    schedules:               z.array(schedule).max(50).optional(),
    shareClasses:            z.array(shareClass).max(20).optional(),
    directors:               z.array(director).max(100).optional(),
    shareholders:            z.array(shareholder).max(500).optional(),
    officers:                z.array(officer).max(50).optional(),
    incorporationDocumentFile: shortString.optional(),
});

/** Cross-field checks that Mongoose won't enforce for us. */
const withCrossFieldRules = <T extends z.ZodObject<any>>(schema: T) => schema.superRefine((data: any, ctx) => {
    if (
        typeof data.minDirectors === 'number' &&
        typeof data.maxDirectors === 'number' &&
        data.minDirectors > data.maxDirectors
    ) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['maxDirectors'],
            message: 'Maximum directors must be greater than or equal to minimum.',
        });
    }

    // Every shareholder must reference a share class that actually exists on
    // the company — otherwise the compiled minute book prints certificates
    // for undefined classes. Skips if either side is absent (partial update).
    if (Array.isArray(data.shareholders) && Array.isArray(data.shareClasses)) {
        const classNames = new Set(data.shareClasses.map((c: any) => c.name));
        data.shareholders.forEach((sh: any, i: number) => {
            if (sh?.sharesClass && !classNames.has(sh.sharesClass)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['shareholders', i, 'sharesClass'],
                    message: `Share class "${sh.sharesClass}" is not defined on this company.`,
                });
            }
        });
    }
});

export const createCompanySchema = withCrossFieldRules(companyCore);
export const updateCompanySchema = withCrossFieldRules(companyCore.partial());

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
