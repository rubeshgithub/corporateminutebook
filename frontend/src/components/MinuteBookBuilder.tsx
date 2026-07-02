import React, { useEffect, useState } from 'react';
import { useForm, useFieldArray, Controller, FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    Box, Button, TextField, Typography, Paper, Grid, IconButton, CircularProgress,
    Stepper, Step, StepLabel, StepButton, Divider, List, ListItem, ListItemText,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
    MenuItem, FormControlLabel, Switch, RadioGroup, Radio, FormControl, FormLabel,
    Checkbox, Alert, Chip, Collapse,
    Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
    Select, InputLabel,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../utils/api';
import { useSnackbar } from '../context/SnackbarContext';
import PlacesTextField from './PlacesTextField';

const CONTACT_HINT = 'Providing email and phone allows us to send reminders for resolutions, annual returns, and key corporate deadlines.';

const toDateInput = (value?: string | Date) => {
    if (!value) return '';
    const d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

// Annual return recurs each year on the anniversary of the incorporation date.
// We store it as MM-DD (the reminder trigger date).
const deriveAnnualReturnMMDD = (value?: string | Date) => {
    if (!value) return '';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '';
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${mm}-${dd}`;
};

const buildName = (parts: { firstName?: string; middleName?: string; lastName?: string; name?: string }) => {
    const composed = [parts.firstName, parts.middleName, parts.lastName].filter((p) => p && p.trim()).join(' ').trim();
    return composed || (parts.name || '').trim();
};

const companySchema = z.object({
    name: z.string().min(1, 'Company Name is required'),
    corporateAccessNumber: z.string().optional(),
    businessNumber: z.string().optional(),
    incorporationDate: z.string().optional(),
    minDirectors: z.coerce.number().min(1).optional(),
    maxDirectors: z.coerce.number().min(1).optional(),
    registeredOfficeAddress: z.object({
        street: z.string().min(1, 'Street is required'),
        city: z.string().min(1, 'City is required'),
        province: z.string().min(1, 'Province is required'),
        postalCode: z.string().min(1, 'Postal Code is required'),
        country: z.string().default('Canada'),
    }),
    recordsAddress: z.object({
        sameAsRegistered: z.boolean().default(true),
        street: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().optional(),
    }).superRefine((val, ctx) => {
        if (!val.sameAsRegistered) {
            (['street', 'city', 'province', 'postalCode'] as const).forEach((field) => {
                if (!val[field] || val[field]!.trim() === '') {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [field],
                        message: `${field} is required when Records Address differs from Registered`,
                    });
                }
            });
        }
    }),
    addressForService: z.object({
        sameAsRegistered: z.boolean().default(true),
        sameAsRecords: z.boolean().default(false),
        poBox: z.string().optional(),
        street: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        postalCode: z.string().optional(),
        country: z.string().optional(),
        email: z.string().email('Valid email is required').optional().or(z.literal('')),
    }).superRefine((val, ctx) => {
        if (!val.sameAsRegistered && !val.sameAsRecords) {
            (['city', 'province', 'postalCode'] as const).forEach((field) => {
                if (!val[field] || val[field]!.trim() === '') {
                    ctx.addIssue({
                        code: z.ZodIssueCode.custom,
                        path: [field],
                        message: `${field} is required for Address for Service`,
                    });
                }
            });
        }
    }),
    restrictions: z.object({
        // legacy combined field (kept for backward compat read; not surfaced in new UI)
        hasRestrictions: z.boolean().optional(),
        description: z.string().optional(),
        restrictedTo: z.object({
            has: z.boolean().default(false),
            description: z.string().optional(),
        }).superRefine((val, ctx) => {
            if (val.has && (!val.description || val.description.trim() === '')) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['description'],
                    message: 'Describe what the business is restricted to',
                });
            }
        }),
        restrictedFrom: z.object({
            has: z.boolean().default(false),
            description: z.string().optional(),
        }).superRefine((val, ctx) => {
            if (val.has && (!val.description || val.description.trim() === '')) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    path: ['description'],
                    message: 'Describe what the business is restricted from',
                });
            }
        }),
    }),
    authorizedBy: z.object({
        name: z.string().min(1, 'Authorizer name is required'),
        company: z.string().optional(),
        email: z.string().email('Valid email is required'),
        phone: z.string().min(1, 'Phone number is required'),
    }),
    schedules: z.array(z.object({
        name: z.string().min(1, 'Schedule name is required'),
        content: z.string().min(1, 'Schedule content is required'),
    })).default([]),
    shareClasses: z.array(z.object({
        name: z.string().min(1, 'Class name is required'),
        type: z.enum(['Common', 'Preferred']),
        voting: z.boolean(),
        maxAuthorized: z.coerce.number().min(0).optional().nullable(),
        parValue: z.coerce.number().min(0).optional().nullable(),
    })).min(1, 'At least one share class is required'),
    directors: z.array(z.object({
        name: z.string().optional(),
        firstName: z.string().min(1, 'First name is required'),
        middleName: z.string().optional(),
        lastName: z.string().min(1, 'Last name is required'),
        address: z.string().min(1, 'Street address is required'),
        city: z.string().min(1, 'City is required'),
        province: z.string().min(1, 'Province is required'),
        postalCode: z.string().min(1, 'Postal code is required'),
        residentCanadian: z.boolean().default(true),
        appointedDate: z.string().min(1, 'Appointed Date is required'),
        email: z.string().email('Invalid email').optional().or(z.literal('')),
        phone: z.string().optional(),
    })).min(1, 'At least one director is required'),
    shareholders: z.array(z.object({
        holderType: z.enum(['Individual', 'Legal Entity']).default('Individual'),
        name: z.string().min(1, 'Shareholder Name is required'),
        corporateAccessNumber: z.string().optional(),
        businessNumber: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        province: z.string().optional(),
        postalCode: z.string().optional(),
        sharesClass: z.string().min(1, 'Share Class is required'),
        numberOfShares: z.coerce.number().min(1, 'Must have at least 1 share'),
        votingPercent: z.coerce.number().min(0).max(100).optional(),
        certificateNumber: z.number().optional(),
        considerationPaid: z.coerce.number().min(0).optional(),
        issuanceDate: z.string().optional(),
        email: z.string().email('Invalid email').optional().or(z.literal('')),
        phone: z.string().optional(),
    })).min(1, 'At least one shareholder is required'),
    officers: z.array(z.object({
        name: z.string().min(1, 'Officer Name is required'),
        title: z.string().min(1, 'Title is required'),
        appointedDate: z.string().min(1, 'Appointed Date is required'),
        email: z.string().email('Invalid email').optional().or(z.literal('')),
        phone: z.string().optional(),
    })).min(1, 'At least one officer is required'),
    fiscalYearEnd: z.string().optional(),
    annualReturnDueDate: z.string().optional(),
    incorporationDocumentFile: z.string().optional(),
});

type CompanyFormValues = z.infer<typeof companySchema>;

const STEPS: Array<{ label: string; fields: FieldPath<CompanyFormValues>[] }> = [
    { label: 'Company', fields: ['name', 'corporateAccessNumber', 'businessNumber', 'incorporationDate', 'fiscalYearEnd', 'annualReturnDueDate', 'minDirectors', 'maxDirectors', 'restrictions', 'authorizedBy'] },
    { label: 'Addresses', fields: ['registeredOfficeAddress', 'recordsAddress', 'addressForService'] },
    { label: 'Directors', fields: ['directors'] },
    { label: 'Officers', fields: ['officers'] },
    { label: 'Share Classes', fields: ['shareClasses'] },
    { label: 'Shareholders', fields: ['shareholders'] },
    { label: 'Schedules', fields: ['schedules'] },
    { label: 'Review', fields: [] },
];

const OFFICER_TITLES = ['President', 'Vice-President', 'Secretary', 'Treasurer', 'CEO', 'CFO', 'COO', 'Chair', 'Other'];

interface RegistryHit {
    name:             string;
    businessNumber:   string;
    registryId:       string;
    location:         string;
    status:           'Active' | 'Inactive';
    statusNotes:      string;
    entityType:       string;
    registrationDate: string;
    jurisdiction:     string;
    provinceKey:      string;
    source:           'cbr' | 'orgbook';
}

const JURISDICTIONS: Array<{ value: string; label: string }> = [
    { value: 'all',     label: 'All of Canada' },
    { value: 'federal', label: 'Federal (CBCA)' },
    { value: 'ab',      label: 'Alberta' },
    { value: 'bc',      label: 'British Columbia' },
    { value: 'mb',      label: 'Manitoba' },
    { value: 'nb',      label: 'New Brunswick' },
    { value: 'nl',      label: 'Newfoundland & Labrador' },
    { value: 'ns',      label: 'Nova Scotia' },
    { value: 'nt',      label: 'Northwest Territories' },
    { value: 'nu',      label: 'Nunavut' },
    { value: 'on',      label: 'Ontario' },
    { value: 'pe',      label: 'Prince Edward Island' },
    { value: 'sk',      label: 'Saskatchewan' },
    { value: 'yt',      label: 'Yukon' },
];
const DEFAULT_SHARE_CLASS = {
    name: 'Class A Common Voting Shares',
    type: 'Common' as const,
    voting: true,
    maxAuthorized: 1000 as number | null,
    parValue: null as number | null,
};

const MinuteBookBuilder: React.FC = () => {
    const navigate = useNavigate();
    const { id } = useParams<{ id?: string }>();
    const isEdit = Boolean(id);
    const { showSnackbar } = useSnackbar();
    const [loading, setLoading] = useState(isEdit);

    // Registry search dialog
    const [searchOpen, setSearchOpen]           = useState(false);
    const [searchQuery, setSearchQuery]         = useState('');
    const [searchProvince, setSearchProvince]   = useState('all');
    const [searchLoading, setSearchLoading]     = useState(false);
    const [searchResults, setSearchResults]     = useState<RegistryHit[]>([]);
    const [searchAttempted, setSearchAttempted] = useState(false);
    const [searchError, setSearchError]         = useState('');

    // Set of field paths that were populated from the last registry search.
    // Used to visually highlight those inputs so the client sees exactly
    // what came from the registry vs. what they still need to enter.
    const [regFilledSet, setRegFilledSet] = useState<Set<string>>(new Set());

    // Extra info returned by the registry that we surface for context but
    // deliberately do NOT persist to the DB (kept in component state only).
    const [regInfoLocation, setRegInfoLocation]     = useState('');
    const [regInfoEntityType, setRegInfoEntityType] = useState('');

    const regHighlightSx = (fieldName: string) =>
        regFilledSet.has(fieldName)
            ? {
                  '& .MuiOutlinedInput-root':          { backgroundColor: 'rgba(76, 175, 80, 0.10)' },
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: 'success.light' },
              }
            : undefined;
    const [activeStep, setActiveStep] = useState(0);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, setSaving] = useState(false);

    // Incorporation document upload
    const [uploadParsing, setUploadParsing] = useState(false);
    const [uploadError, setUploadError] = useState('');
    const [parsedFields, setParsedFields] = useState<string[]>([]);
    const [incorpFileName, setIncorpFileName] = useState('');   // original filename for display
    const [showParsed, setShowParsed] = useState(false);

    const {
        control, handleSubmit, reset, getValues, setValue, trigger, watch, formState: { errors }
    } = useForm<CompanyFormValues>({
        resolver: zodResolver(companySchema),
        defaultValues: {
            name: '',
            corporateAccessNumber: '',
            businessNumber: '',
            incorporationDate: '',
            minDirectors: 1,
            maxDirectors: 10,
            registeredOfficeAddress: {
                street: '', city: '', province: '', postalCode: '', country: 'Canada'
            },
            recordsAddress: {
                sameAsRegistered: true,
                street: '', city: '', province: '', postalCode: '', country: 'Canada'
            },
            addressForService: {
                sameAsRegistered: true,
                sameAsRecords: false,
                poBox: '', street: '', city: '', province: '', postalCode: '', country: 'Canada', email: ''
            },
            restrictions: {
                hasRestrictions: false,
                description: '',
                restrictedTo: { has: false, description: '' },
                restrictedFrom: { has: false, description: '' },
            },
            authorizedBy: { name: '', company: '', email: '', phone: '' },
            schedules: [],
            shareClasses: [{ ...DEFAULT_SHARE_CLASS }],
            directors: [{ name: '', firstName: '', middleName: '', lastName: '', address: '', residentCanadian: true, appointedDate: '' }],
            shareholders: [{ holderType: 'Individual', name: '', corporateAccessNumber: '', businessNumber: '', address: '', sharesClass: DEFAULT_SHARE_CLASS.name, numberOfShares: 100, votingPercent: 100, considerationPaid: undefined, issuanceDate: '' }],
            officers: [{ name: '', title: 'President', appointedDate: '' }],
            fiscalYearEnd: '12-31',
            annualReturnDueDate: '',
        }
    });

    const {
        fields: directorFields, append: appendDirector, remove: removeDirector
    } = useFieldArray({ control, name: 'directors' });

    const {
        fields: shareholderFields, append: appendShareholder, remove: removeShareholder
    } = useFieldArray({ control, name: 'shareholders' });

    const {
        fields: officerFields, append: appendOfficer, remove: removeOfficer
    } = useFieldArray({ control, name: 'officers' });

    const {
        fields: scheduleFields, append: appendSchedule, remove: removeSchedule
    } = useFieldArray({ control, name: 'schedules' });

    const {
        fields: shareClassFields, append: appendShareClass, remove: removeShareClass
    } = useFieldArray({ control, name: 'shareClasses' });

    const recordsSame = watch('recordsAddress.sameAsRegistered');
    const serviceSameRegistered = watch('addressForService.sameAsRegistered');
    const serviceSameRecords = watch('addressForService.sameAsRecords');
    const restrictedToHas = watch('restrictions.restrictedTo.has');
    const restrictedFromHas = watch('restrictions.restrictedFrom.has');
    const hasSchedules = scheduleFields.length > 0;
    const watchedShareClasses = watch('shareClasses');
    const watchedIncorporationDate = watch('incorporationDate');

    // Whenever incorporation date changes, derive the Annual Return Due Date (MM-DD)
    // from its anniversary — but never overwrite a value the client has already entered.
    // If the incorporation date came from the registry search, extend the green highlight
    // to the derived annual return field.
    useEffect(() => {
        if (!watchedIncorporationDate) return;
        if (getValues('annualReturnDueDate')) return;
        const mmdd = deriveAnnualReturnMMDD(watchedIncorporationDate);
        if (!mmdd) return;
        setValue('annualReturnDueDate', mmdd);
        setRegFilledSet((prev) => {
            if (!prev.has('incorporationDate')) return prev;
            if (prev.has('annualReturnDueDate')) return prev;
            const next = new Set(prev);
            next.add('annualReturnDueDate');
            return next;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [watchedIncorporationDate]);

    useEffect(() => {
        if (!isEdit) return;
        const fetchCompany = async () => {
            try {
                const { data } = await api.get(`/companies/${id}`);
                reset({
                    name: data.name || '',
                    corporateAccessNumber: data.corporateAccessNumber || '',
                    businessNumber: data.businessNumber || '',
                    incorporationDate: toDateInput(data.incorporationDate),
                    minDirectors: data.minDirectors ?? 1,
                    maxDirectors: data.maxDirectors ?? 10,
                    registeredOfficeAddress: {
                        street: data.registeredOfficeAddress?.street || '',
                        city: data.registeredOfficeAddress?.city || '',
                        province: data.registeredOfficeAddress?.province || '',
                        postalCode: data.registeredOfficeAddress?.postalCode || '',
                        country: data.registeredOfficeAddress?.country || 'Canada',
                    },
                    recordsAddress: {
                        sameAsRegistered: data.recordsAddress?.sameAsRegistered ?? true,
                        street: data.recordsAddress?.street || '',
                        city: data.recordsAddress?.city || '',
                        province: data.recordsAddress?.province || '',
                        postalCode: data.recordsAddress?.postalCode || '',
                        country: data.recordsAddress?.country || 'Canada',
                    },
                    addressForService: {
                        sameAsRegistered: data.addressForService?.sameAsRegistered ?? true,
                        sameAsRecords: data.addressForService?.sameAsRecords ?? false,
                        poBox: data.addressForService?.poBox || '',
                        street: data.addressForService?.street || '',
                        city: data.addressForService?.city || '',
                        province: data.addressForService?.province || '',
                        postalCode: data.addressForService?.postalCode || '',
                        country: data.addressForService?.country || 'Canada',
                        email: data.addressForService?.email || '',
                    },
                    restrictions: {
                        hasRestrictions: data.restrictions?.hasRestrictions ?? false,
                        description: data.restrictions?.description || '',
                        restrictedTo: {
                            has: data.restrictions?.restrictedTo?.has ?? false,
                            description: data.restrictions?.restrictedTo?.description || '',
                        },
                        restrictedFrom: {
                            has: data.restrictions?.restrictedFrom?.has ?? false,
                            description: data.restrictions?.restrictedFrom?.description || '',
                        },
                    },
                    authorizedBy: {
                        name: data.authorizedBy?.name || '',
                        company: data.authorizedBy?.company || '',
                        email: data.authorizedBy?.email || '',
                        phone: data.authorizedBy?.phone || '',
                    },
                    schedules: (data.schedules || []).map((s: any) => ({
                        name: s.name || '',
                        content: s.content || '',
                    })),
                    shareClasses: (data.shareClasses?.length ? data.shareClasses : [{ ...DEFAULT_SHARE_CLASS }]).map((sc: any) => ({
                        name: sc.name || '',
                        type: sc.type || 'Common',
                        voting: sc.voting ?? true,
                        maxAuthorized: sc.maxAuthorized ?? null,
                        parValue: sc.parValue ?? null,
                        description: sc.description || '',
                    })),
                    directors: (data.directors?.length ? data.directors : [{}]).map((d: any) => {
                        // If existing record only has full name, leave parts blank for user to fill
                        const hasParts = d.firstName || d.lastName;
                        return {
                            name: d.name || '',
                            firstName: d.firstName || (hasParts ? '' : (d.name || '').split(' ')[0] || ''),
                            middleName: d.middleName || '',
                            lastName: d.lastName || (hasParts ? '' : (d.name || '').split(' ').slice(1).join(' ') || ''),
                            address: d.address || '',
                            city: d.city || '',
                            province: d.province || '',
                            postalCode: d.postalCode || '',
                            residentCanadian: d.residentCanadian ?? true,
                            appointedDate: toDateInput(d.appointedDate),
                            email: d.email || '',
                            phone: d.phone || '',
                        };
                    }),
                    shareholders: (data.shareholders?.length ? data.shareholders : [{}]).map((s: any) => ({
                        holderType: s.holderType || 'Individual',
                        name: s.name || '',
                        corporateAccessNumber: s.corporateAccessNumber || '',
                        businessNumber: s.businessNumber || '',
                        address: s.address || '',
                        city: s.city || '',
                        province: s.province || '',
                        postalCode: s.postalCode || '',
                        sharesClass: s.sharesClass || DEFAULT_SHARE_CLASS.name,
                        numberOfShares: s.numberOfShares ?? 100,
                        votingPercent: s.votingPercent ?? undefined,
                        certificateNumber: s.certificateNumber ?? undefined,
                        considerationPaid: s.considerationPaid ?? undefined,
                        issuanceDate: toDateInput(s.issuanceDate),
                        email: s.email || '',
                        phone: s.phone || '',
                    })),
                    officers: (data.officers?.length ? data.officers : [{ name: '', title: 'President', appointedDate: '' }]).map((o: any) => ({
                        name: o.name || '',
                        title: o.title || 'President',
                        appointedDate: toDateInput(o.appointedDate),
                        email: o.email || '',
                        phone: o.phone || '',
                    })),
                    fiscalYearEnd: data.fiscalYearEnd || '12-31',
                    annualReturnDueDate: data.annualReturnDueDate || '',
                    incorporationDocumentFile: data.incorporationDocumentFile || '',
                });
                if (data.incorporationDocumentFile) {
                    setIncorpFileName('__existing__');
                }
            } catch (error) {
                console.error('Failed to load company:', error);
                showSnackbar('Failed to load company. Returning to dashboard.', 'error');
                navigate('/dashboard');
            } finally {
                setLoading(false);
            }
        };
        fetchCompany();
    }, [id, isEdit, navigate, reset]);

    const handleIncorpUpload = async (file: File) => {
        setUploadError('');
        setParsedFields([]);
        setShowParsed(false);
        setUploadParsing(true);
        try {
            const formData = new FormData();
            formData.append('incorporationDocument', file);
            const { data } = await api.post('/incorporation/parse', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            const p = data.parsedData;

            // Apply parsed fields to the form
            const applied: string[] = [];

            if (p.name) { setValue('name', p.name, { shouldValidate: true }); applied.push('Company Name'); }
            if (p.corporateAccessNumber) { setValue('corporateAccessNumber', p.corporateAccessNumber); applied.push('Corporate Access Number'); }
            if (p.incorporationDate) { setValue('incorporationDate', p.incorporationDate); applied.push('Incorporation Date'); }
            if (p.fiscalYearEnd) { setValue('fiscalYearEnd', p.fiscalYearEnd); applied.push('Fiscal Year End'); }
            if (p.minDirectors) { setValue('minDirectors', p.minDirectors); applied.push('Min Directors'); }
            if (p.maxDirectors) { setValue('maxDirectors', p.maxDirectors); applied.push('Max Directors'); }

            if (p.registeredOfficeAddress?.street) {
                setValue('registeredOfficeAddress.street', p.registeredOfficeAddress.street, { shouldValidate: true });
                setValue('registeredOfficeAddress.city', p.registeredOfficeAddress.city || '');
                setValue('registeredOfficeAddress.province', p.registeredOfficeAddress.province || '');
                setValue('registeredOfficeAddress.postalCode', p.registeredOfficeAddress.postalCode || '');
                setValue('registeredOfficeAddress.country', p.registeredOfficeAddress.country || 'Canada');
                applied.push('Registered Office Address');
            }

            if (Array.isArray(p.directors) && p.directors.length > 0) {
                const mapped = p.directors.map((d: any) => ({
                    name: `${d.firstName || ''} ${d.lastName || ''}`.trim(),
                    firstName: d.firstName || '',
                    middleName: '',
                    lastName: d.lastName || '',
                    address: d.address || '',
                    residentCanadian: d.residentCanadian ?? true,
                    appointedDate: d.appointedDate || getValue('incorporationDate') || '',
                }));
                setValue('directors', mapped, { shouldValidate: false });
                applied.push(`Directors (${mapped.length})`);
            }

            if (Array.isArray(p.shareClasses) && p.shareClasses.length > 0) {
                const mapped = p.shareClasses.map((sc: any) => ({
                    name: sc.name || '',
                    type: sc.type || 'Common',
                    voting: sc.voting ?? true,
                    maxAuthorized: sc.maxAuthorized ?? null,
                    parValue: sc.parValue ?? null,
                }));
                setValue('shareClasses', mapped, { shouldValidate: false });
                applied.push(`Share Classes (${mapped.length})`);
            }

            if (p.restrictions) {
                if (p.restrictions.restrictedTo) setValue('restrictions.restrictedTo', p.restrictions.restrictedTo);
                if (p.restrictions.restrictedFrom) setValue('restrictions.restrictedFrom', p.restrictions.restrictedFrom);
                if (p.restrictions.restrictedTo?.has || p.restrictions.restrictedFrom?.has) applied.push('Restrictions');
            }

            if (p.recordsAddress) {
                setValue('recordsAddress.sameAsRegistered', p.recordsAddress.sameAsRegistered ?? true);
                if (!p.recordsAddress.sameAsRegistered) {
                    setValue('recordsAddress.street', p.recordsAddress.street || '');
                    setValue('recordsAddress.city', p.recordsAddress.city || '');
                    setValue('recordsAddress.province', p.recordsAddress.province || '');
                    setValue('recordsAddress.postalCode', p.recordsAddress.postalCode || '');
                    setValue('recordsAddress.country', p.recordsAddress.country || 'Canada');
                    applied.push('Records Address');
                }
            }

            if (p.addressForService) {
                const afs = p.addressForService;
                const afsSameAs = afs.sameAsRegistered ?? false;
                setValue('addressForService.sameAsRegistered', afsSameAs);
                setValue('addressForService.sameAsRecords', false);
                if (!afsSameAs) {
                    if (afs.poBox) setValue('addressForService.poBox', afs.poBox);
                    if (afs.street) setValue('addressForService.street', afs.street);
                    if (afs.city) setValue('addressForService.city', afs.city || '');
                    if (afs.province) setValue('addressForService.province', afs.province || '');
                    if (afs.postalCode) setValue('addressForService.postalCode', afs.postalCode || '');
                    setValue('addressForService.country', afs.country || 'Canada');
                    applied.push('Address for Service');
                }
            }

            if (Array.isArray(p.shareholders) && p.shareholders.length > 0) {
                const defaultShareClass = p.shareClasses?.[0]?.name || '';
                const mapped = p.shareholders.map((s: any) => ({
                    holderType: s.holderType || 'Individual',
                    name: s.name || '',
                    corporateAccessNumber: '',
                    businessNumber: '',
                    address: s.address || '',
                    sharesClass: s.sharesClass || defaultShareClass,
                    numberOfShares: s.numberOfShares ?? 100,
                    votingPercent: s.votingPercent ?? undefined,
                    certificateNumber: undefined,
                    considerationPaid: undefined,
                    issuanceDate: '',
                }));
                setValue('shareholders', mapped, { shouldValidate: false });
                applied.push(`Shareholders (${mapped.length})`);
            }

            // Store the temp file reference
            setValue('incorporationDocumentFile', data.tempFile);
            setIncorpFileName(file.name);
            setParsedFields(applied);
            setShowParsed(true);
        } catch (err: any) {
            const msg = err?.response?.data?.error || 'Failed to parse document. Please fill the form manually.';
            setUploadError(msg);
        } finally {
            setUploadParsing(false);
        }
    };

    // helper used in handleIncorpUpload
    const getValue = (field: string) => {
        try { return (getValues as any)(field) || ''; } catch { return ''; }
    };

    // Free-text registry search — accepts company name, Corporate Access Number, or Business Number.
    const runRegistrySearch = async () => {
        const q = searchQuery.trim();
        if (q.length < 2) {
            setSearchError('Enter at least 2 characters — a company name, Corporate Access Number, or Business Number.');
            return;
        }
        setSearchError('');
        setSearchLoading(true);
        setSearchAttempted(true);
        try {
            const { data } = await api.get('/registry/search', { params: { q, province: searchProvince } });
            setSearchResults(data.results ?? []);
        } catch (error) {
            console.error('Registry search failed:', error);
            setSearchResults([]);
            setSearchError('Registry search is temporarily unavailable. Please try again.');
        } finally {
            setSearchLoading(false);
        }
    };

    // Fill the form from a picked search hit and record which fields were populated
    // so the inputs can be visually highlighted.
    const applyRegistryHit = (hit: RegistryHit) => {
        const filled = new Set<string>();

        setValue('name', hit.name, { shouldValidate: true });
        filled.add('name');

        if (hit.registryId)       { setValue('corporateAccessNumber', hit.registryId);            filled.add('corporateAccessNumber'); }
        if (hit.businessNumber)   { setValue('businessNumber', hit.businessNumber);               filled.add('businessNumber'); }
        if (hit.registrationDate) { setValue('incorporationDate', toDateInput(hit.registrationDate)); filled.add('incorporationDate'); }

        // location is "City, Province" (CBR) or "British Columbia" (BC OrgBook)
        const [city = '', prov = ''] = hit.location.split(',').map((s) => s.trim());
        if (city) { setValue('registeredOfficeAddress.city',     city, { shouldValidate: true }); filled.add('registeredOfficeAddress.city'); }
        if (prov) { setValue('registeredOfficeAddress.province', prov, { shouldValidate: true }); filled.add('registeredOfficeAddress.province'); }
        setValue('registeredOfficeAddress.country', 'Canada');

        setRegFilledSet(filled);
        setRegInfoLocation(hit.location ?? '');
        setRegInfoEntityType(hit.entityType ?? '');
        showSnackbar(`Loaded ${hit.name} from the registry. Highlighted fields came from the search — the rest are for you to enter.`, 'success');
        setSearchOpen(false);
    };

    const openRegistrySearch = () => {
        setSearchQuery(getValues('corporateAccessNumber') || getValues('businessNumber') || getValues('name') || '');
        setSearchProvince('all');
        setSearchResults([]);
        setSearchAttempted(false);
        setSearchError('');
        setSearchOpen(true);
    };

    // Build composed `name` from parts before submission
    const prepareForSubmit = (data: CompanyFormValues): CompanyFormValues => {
        const directors = data.directors.map((d) => ({ ...d, name: buildName(d) || d.name || '' }));
        return { ...data, directors };
    };

    const handleNext = async () => {
        const fieldsToValidate = STEPS[activeStep].fields;
        const isValid = fieldsToValidate.length === 0 ? true : await trigger(fieldsToValidate);
        if (isValid) setActiveStep((s) => Math.min(s + 1, STEPS.length - 1));
    };

    const handleBack = () => setActiveStep((s) => Math.max(s - 1, 0));

    const handleStepClick = (step: number) => {
        if (isEdit) setActiveStep(step);
    };

    const handleSaveClick = async () => {
        const isValid = await trigger();
        if (!isValid) {
            showSnackbar('Some fields are missing or invalid. Use the step labels to navigate back and fix them.', 'warning');
            return;
        }
        setConfirmOpen(true);
    };

    const onSubmit = async (data: CompanyFormValues) => {
        setSaving(true);
        try {
            const payload = prepareForSubmit(data);
            if (isEdit) {
                await api.put(`/companies/${id}`, payload);
            } else {
                await api.post('/companies', payload);
            }
            setConfirmOpen(false);
            navigate('/dashboard');
        } catch (error) {
            console.error('Failed to save company:', error);
            showSnackbar('Failed to save company profile. Please try again.', 'error');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight="60vh">
                <CircularProgress />
            </Box>
        );
    }

    const isLastStep = activeStep === STEPS.length - 1;
    const shareClassNames = (watchedShareClasses || []).map((sc: any) => sc?.name).filter((n: string) => n);

    return (
        <Box p={4} display="flex" justifyContent="center">
            <Paper elevation={3} sx={{ p: 4, width: '100%', maxWidth: 900 }}>
                <Typography variant="h4" gutterBottom color="primary">
                    {isEdit ? 'Edit Company' : 'Minute Book Builder'}
                </Typography>
                <Typography variant="subtitle1" gutterBottom color="textSecondary" mb={3}>
                    {isEdit
                        ? 'Update your company details below.'
                        : 'Complete each step to set up your corporate minute book.'}
                </Typography>

                <Stepper activeStep={activeStep} alternativeLabel nonLinear={isEdit} sx={{ mb: 4 }}>
                    {STEPS.map((step, index) => (
                        <Step key={step.label}>
                            {isEdit ? (
                                <StepButton onClick={() => handleStepClick(index)}>{step.label}</StepButton>
                            ) : (
                                <StepLabel>{step.label}</StepLabel>
                            )}
                        </Step>
                    ))}
                </Stepper>

                <form onSubmit={handleSubmit(onSubmit)}>
                    {/* ============ Step 0: Company ============ */}
                    {activeStep === 0 && (
                        <Box>
                            {/* ---- Government Registry Search ---- */}
                            <Box
                                sx={{
                                    mb: 2, p: 2.5, border: '1px solid', borderColor: 'primary.light',
                                    borderRadius: 2, bgcolor: 'primary.50',
                                }}
                            >
                                <Box display="flex" alignItems="center" gap={1.5} mb={0.5}>
                                    <SearchIcon color="primary" />
                                    <Typography variant="subtitle1" fontWeight={600} color="primary.dark">
                                        Find your company in the government registry
                                    </Typography>
                                </Box>
                                <Typography variant="body2" color="text.secondary" mb={1.5}>
                                    Search Canadian federal &amp; provincial registries by <strong>company name</strong>, <strong>Corporate Access Number</strong>, or <strong>Business Number (BN)</strong>. Pick a result and we'll auto-fill the company details below.
                                </Typography>
                                <Button
                                    type="button"
                                    variant="contained"
                                    color="primary"
                                    size="small"
                                    startIcon={<SearchIcon />}
                                    onClick={openRegistrySearch}
                                >
                                    Search Canadian registries
                                </Button>
                            </Box>

                            {/* ---- Incorporation Document Upload ---- */}
                            <Box
                                sx={{
                                    mb: 3, p: 2.5, border: '2px dashed', borderColor: 'primary.light',
                                    borderRadius: 2, bgcolor: 'primary.50', position: 'relative',
                                }}
                            >
                                <Box display="flex" alignItems="center" gap={1.5} mb={1}>
                                    <UploadFileIcon color="primary" />
                                    <Typography variant="subtitle1" fontWeight={600} color="primary.dark">
                                        Or upload your Certificate of Incorporation
                                    </Typography>
                                </Box>
                                <Typography variant="body2" color="text.secondary" mb={1.5}>
                                    We'll read the document and auto-fill the form. Works with Alberta, BC, Ontario, Federal, and other Canadian provinces. The original document will be included in your minute book as proof of filing.
                                </Typography>

                                <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
                                    <Button
                                        component="label"
                                        variant="outlined"
                                        size="small"
                                        startIcon={uploadParsing ? <CircularProgress size={16} /> : <UploadFileIcon />}
                                        disabled={uploadParsing}
                                    >
                                        {uploadParsing ? 'Reading document…' : incorpFileName === '__existing__' ? 'Replace PDF' : 'Choose PDF'}
                                        <input
                                            hidden
                                            type="file"
                                            accept="application/pdf"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) handleIncorpUpload(file);
                                                e.target.value = '';
                                            }}
                                        />
                                    </Button>
                                    {incorpFileName === '__existing__' && !uploadParsing && (
                                        <Box display="flex" alignItems="center" gap={0.5}>
                                            <CheckCircleOutlineIcon sx={{ fontSize: 16, color: 'success.main' }} />
                                            <Typography variant="caption" color="success.dark" fontWeight={600}>
                                                Document attached — will be included in minute book
                                            </Typography>
                                        </Box>
                                    )}
                                    {incorpFileName && incorpFileName !== '__existing__' && !uploadParsing && (
                                        <Typography variant="caption" color="text.secondary">
                                            {incorpFileName}
                                        </Typography>
                                    )}
                                </Box>

                                {uploadError && (
                                    <Alert severity="warning" sx={{ mt: 1.5 }} onClose={() => setUploadError('')}>
                                        {uploadError}
                                    </Alert>
                                )}

                                <Collapse in={showParsed}>
                                    <Alert
                                        severity="success"
                                        icon={<CheckCircleOutlineIcon />}
                                        sx={{ mt: 1.5 }}
                                        onClose={() => setShowParsed(false)}
                                    >
                                        <Typography variant="body2" fontWeight={600} mb={0.5}>
                                            Auto-filled {parsedFields.length} field{parsedFields.length !== 1 ? 's' : ''}:
                                        </Typography>
                                        <Box display="flex" flexWrap="wrap" gap={0.5}>
                                            {parsedFields.map((f) => (
                                                <Chip key={f} label={f} size="small" color="success" variant="outlined" />
                                            ))}
                                        </Box>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                            Review each step and fill in anything that wasn't extracted.
                                        </Typography>
                                    </Alert>
                                </Collapse>
                            </Box>

                            <Typography variant="h6" gutterBottom>Company Details</Typography>
                            <Grid container spacing={2}>
                                <Grid item xs={12}>
                                    <Controller name="name" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Company Name" error={!!errors.name} helperText={errors.name?.message} sx={regHighlightSx('name')} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="corporateAccessNumber" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Corporate Access Number (CAN)" helperText="Or use the government registry search above to fill this in automatically." sx={regHighlightSx('corporateAccessNumber')} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="businessNumber" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Business Number (BN)" sx={regHighlightSx('businessNumber')} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="incorporationDate" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Incorporation Date" type="date" InputLabelProps={{ shrink: true }} sx={regHighlightSx('incorporationDate')} />
                                    )} />
                                </Grid>
                                {(regInfoLocation || regInfoEntityType) && (
                                    <>
                                        {regInfoLocation && (
                                            <Grid item xs={12} sm={6}>
                                                <TextField
                                                    fullWidth
                                                    label="Registered Office Location"
                                                    value={regInfoLocation}
                                                    InputProps={{ readOnly: true }}
                                                    helperText="From registry — not saved"
                                                    sx={{
                                                        '& .MuiOutlinedInput-root':          { backgroundColor: 'rgba(76, 175, 80, 0.10)' },
                                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'success.light' },
                                                    }}
                                                />
                                            </Grid>
                                        )}
                                        {regInfoEntityType && (
                                            <Grid item xs={12} sm={6}>
                                                <TextField
                                                    fullWidth
                                                    label="Business Type"
                                                    value={regInfoEntityType}
                                                    InputProps={{ readOnly: true }}
                                                    helperText="From registry — not saved"
                                                    sx={{
                                                        '& .MuiOutlinedInput-root':          { backgroundColor: 'rgba(76, 175, 80, 0.10)' },
                                                        '& .MuiOutlinedInput-notchedOutline': { borderColor: 'success.light' },
                                                    }}
                                                />
                                            </Grid>
                                        )}
                                    </>
                                )}
                                <Grid item xs={12} sm={6}>
                                    <Controller name="fiscalYearEnd" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Fiscal Year End (MM-DD)" placeholder="12-31" />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="annualReturnDueDate" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Annual Return Due Date (MM-DD)" placeholder="e.g. 06-15 — 30-day reminder will fire" helperText="Defaults to the incorporation anniversary. Leave blank if not applicable." sx={regHighlightSx('annualReturnDueDate')} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="minDirectors" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Minimum Number of Directors" type="number" inputProps={{ min: 1 }} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="maxDirectors" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Maximum Number of Directors" type="number" inputProps={{ min: 1 }} />
                                    )} />
                                </Grid>
                            </Grid>

                            <Divider sx={{ my: 3 }} />
                            <Typography variant="h6" gutterBottom>Restrictions on Business</Typography>
                            <Typography variant="body2" color="textSecondary" mb={2}>
                                Specify if there are any restrictions on what business the corporation may carry on (Restricted To) or may not carry on (Restricted From).
                            </Typography>

                            <Box mb={2}>
                                <Controller
                                    name="restrictions.restrictedTo.has"
                                    control={control}
                                    render={({ field }) => (
                                        <FormControl>
                                            <FormLabel>Is the corporation's business restricted TO certain activities?</FormLabel>
                                            <RadioGroup
                                                row
                                                value={field.value ? 'yes' : 'no'}
                                                onChange={(e) => field.onChange(e.target.value === 'yes')}
                                            >
                                                <FormControlLabel value="no" control={<Radio />} label="No" />
                                                <FormControlLabel value="yes" control={<Radio />} label="Yes" />
                                            </RadioGroup>
                                        </FormControl>
                                    )}
                                />
                                {restrictedToHas && (
                                    <Controller
                                        name="restrictions.restrictedTo.description"
                                        control={control}
                                        render={({ field }) => (
                                            <TextField
                                                {...field}
                                                fullWidth
                                                multiline
                                                minRows={2}
                                                label="Describe what the business is restricted to"
                                                sx={{ mt: 1 }}
                                                error={!!errors.restrictions?.restrictedTo?.description}
                                                helperText={errors.restrictions?.restrictedTo?.description?.message}
                                            />
                                        )}
                                    />
                                )}
                            </Box>

                            <Box>
                                <Controller
                                    name="restrictions.restrictedFrom.has"
                                    control={control}
                                    render={({ field }) => (
                                        <FormControl>
                                            <FormLabel>Is the corporation restricted FROM carrying on certain activities?</FormLabel>
                                            <RadioGroup
                                                row
                                                value={field.value ? 'yes' : 'no'}
                                                onChange={(e) => field.onChange(e.target.value === 'yes')}
                                            >
                                                <FormControlLabel value="no" control={<Radio />} label="No" />
                                                <FormControlLabel value="yes" control={<Radio />} label="Yes" />
                                            </RadioGroup>
                                        </FormControl>
                                    )}
                                />
                                {restrictedFromHas && (
                                    <Controller
                                        name="restrictions.restrictedFrom.description"
                                        control={control}
                                        render={({ field }) => (
                                            <TextField
                                                {...field}
                                                fullWidth
                                                multiline
                                                minRows={2}
                                                label="Describe what the business is restricted from"
                                                sx={{ mt: 1 }}
                                                error={!!errors.restrictions?.restrictedFrom?.description}
                                                helperText={errors.restrictions?.restrictedFrom?.description?.message}
                                            />
                                        )}
                                    />
                                )}
                            </Box>

                            <Divider sx={{ my: 3 }} />
                            <Typography variant="h6" gutterBottom>Corporation Authorized By</Typography>
                            <Typography variant="body2" color="textSecondary" mb={2}>
                                The person who is authorizing the setup of this corporation.
                            </Typography>
                            <Grid container spacing={2}>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="authorizedBy.name" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Name" error={!!errors.authorizedBy?.name} helperText={errors.authorizedBy?.name?.message} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="authorizedBy.company" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Company (optional)" />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="authorizedBy.email" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Email" type="email" error={!!errors.authorizedBy?.email} helperText={errors.authorizedBy?.email?.message} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="authorizedBy.phone" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Phone" error={!!errors.authorizedBy?.phone} helperText={errors.authorizedBy?.phone?.message} />
                                    )} />
                                </Grid>
                            </Grid>
                        </Box>
                    )}

                    {/* ============ Step 1: Addresses ============ */}
                    {activeStep === 1 && (
                        <Box>
                            <Typography variant="h6" gutterBottom>Registered Office Address</Typography>
                            <Typography variant="body2" color="textSecondary" mb={2}>
                                Where the corporation is operating.
                            </Typography>
                            <Grid container spacing={2}>
                                <Grid item xs={12}>
                                    <Controller name="registeredOfficeAddress.street" control={control} render={({ field }) => (
                                        <PlacesTextField {...field} fullWidth label="Street Address" error={!!errors.registeredOfficeAddress?.street} helperText={errors.registeredOfficeAddress?.street?.message}
                                            onPlaceSelected={(addr) => {
                                                setValue('registeredOfficeAddress.city', addr.city, { shouldValidate: true });
                                                setValue('registeredOfficeAddress.province', addr.province, { shouldValidate: true });
                                                setValue('registeredOfficeAddress.postalCode', addr.postalCode, { shouldValidate: true });
                                                setValue('registeredOfficeAddress.country', addr.country || 'Canada');
                                            }}
                                        />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <Controller name="registeredOfficeAddress.city" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="City" error={!!errors.registeredOfficeAddress?.city} helperText={errors.registeredOfficeAddress?.city?.message} sx={regHighlightSx('registeredOfficeAddress.city')} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <Controller name="registeredOfficeAddress.province" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Province/State" error={!!errors.registeredOfficeAddress?.province} helperText={errors.registeredOfficeAddress?.province?.message} sx={regHighlightSx('registeredOfficeAddress.province')} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <Controller name="registeredOfficeAddress.postalCode" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Postal/Zip Code" error={!!errors.registeredOfficeAddress?.postalCode} helperText={errors.registeredOfficeAddress?.postalCode?.message} />
                                    )} />
                                </Grid>
                            </Grid>

                            <Divider sx={{ my: 3 }} />
                            <Typography variant="h6" gutterBottom>Records Address</Typography>
                            <Typography variant="body2" color="textSecondary" mb={1}>
                                Where corporate records are sent or stored.
                            </Typography>
                            <Controller
                                name="recordsAddress.sameAsRegistered"
                                control={control}
                                render={({ field }) => (
                                    <FormControlLabel
                                        control={<Switch checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />}
                                        label="Same as Registered Office Address"
                                    />
                                )}
                            />
                            {!recordsSame && (
                                <Grid container spacing={2} sx={{ mt: 1 }}>
                                    <Grid item xs={12}>
                                        <Controller name="recordsAddress.street" control={control} render={({ field }) => (
                                            <PlacesTextField {...field} fullWidth label="Street Address" error={!!errors.recordsAddress?.street} helperText={errors.recordsAddress?.street?.message}
                                                onPlaceSelected={(addr) => {
                                                    setValue('recordsAddress.city', addr.city, { shouldValidate: true });
                                                    setValue('recordsAddress.province', addr.province, { shouldValidate: true });
                                                    setValue('recordsAddress.postalCode', addr.postalCode, { shouldValidate: true });
                                                    setValue('recordsAddress.country', addr.country || 'Canada');
                                                }}
                                            />
                                        )} />
                                    </Grid>
                                    <Grid item xs={12} sm={4}>
                                        <Controller name="recordsAddress.city" control={control} render={({ field }) => (
                                            <TextField {...field} fullWidth label="City" error={!!errors.recordsAddress?.city} helperText={errors.recordsAddress?.city?.message} />
                                        )} />
                                    </Grid>
                                    <Grid item xs={12} sm={4}>
                                        <Controller name="recordsAddress.province" control={control} render={({ field }) => (
                                            <TextField {...field} fullWidth label="Province/State" error={!!errors.recordsAddress?.province} helperText={errors.recordsAddress?.province?.message} />
                                        )} />
                                    </Grid>
                                    <Grid item xs={12} sm={4}>
                                        <Controller name="recordsAddress.postalCode" control={control} render={({ field }) => (
                                            <TextField {...field} fullWidth label="Postal/Zip Code" error={!!errors.recordsAddress?.postalCode} helperText={errors.recordsAddress?.postalCode?.message} />
                                        )} />
                                    </Grid>
                                </Grid>
                            )}

                            <Divider sx={{ my: 3 }} />
                            <Typography variant="h6" gutterBottom>Address for Service by Mail</Typography>
                            <Typography variant="body2" color="textSecondary" mb={1}>
                                Where legal documents may be served by mail. May be a PO Box.
                            </Typography>
                            <Box display="flex" gap={3}>
                                <Controller
                                    name="addressForService.sameAsRegistered"
                                    control={control}
                                    render={({ field }) => (
                                        <FormControlLabel
                                            control={<Checkbox checked={field.value} onChange={(e) => {
                                                field.onChange(e.target.checked);
                                                if (e.target.checked) setValue('addressForService.sameAsRecords', false);
                                            }} />}
                                            label="Same as Registered"
                                        />
                                    )}
                                />
                                <Controller
                                    name="addressForService.sameAsRecords"
                                    control={control}
                                    render={({ field }) => (
                                        <FormControlLabel
                                            control={<Checkbox checked={field.value} onChange={(e) => {
                                                field.onChange(e.target.checked);
                                                if (e.target.checked) setValue('addressForService.sameAsRegistered', false);
                                            }} />}
                                            label="Same as Records"
                                        />
                                    )}
                                />
                            </Box>
                            {!serviceSameRegistered && !serviceSameRecords && (
                                <Grid container spacing={2} sx={{ mt: 1 }}>
                                    <Grid item xs={12} sm={6}>
                                        <Controller name="addressForService.poBox" control={control} render={({ field }) => (
                                            <TextField {...field} fullWidth label="PO Box (optional)" />
                                        )} />
                                    </Grid>
                                    <Grid item xs={12} sm={6}>
                                        <Controller name="addressForService.street" control={control} render={({ field }) => (
                                            <PlacesTextField {...field} fullWidth label="Street (if not PO Box)"
                                                onPlaceSelected={(addr) => {
                                                    setValue('addressForService.city', addr.city, { shouldValidate: true });
                                                    setValue('addressForService.province', addr.province, { shouldValidate: true });
                                                    setValue('addressForService.postalCode', addr.postalCode, { shouldValidate: true });
                                                    setValue('addressForService.country', addr.country || 'Canada');
                                                }}
                                            />
                                        )} />
                                    </Grid>
                                    <Grid item xs={12} sm={4}>
                                        <Controller name="addressForService.city" control={control} render={({ field }) => (
                                            <TextField {...field} fullWidth label="City" error={!!errors.addressForService?.city} helperText={errors.addressForService?.city?.message} />
                                        )} />
                                    </Grid>
                                    <Grid item xs={12} sm={4}>
                                        <Controller name="addressForService.province" control={control} render={({ field }) => (
                                            <TextField {...field} fullWidth label="Province/State" error={!!errors.addressForService?.province} helperText={errors.addressForService?.province?.message} />
                                        )} />
                                    </Grid>
                                    <Grid item xs={12} sm={4}>
                                        <Controller name="addressForService.postalCode" control={control} render={({ field }) => (
                                            <TextField {...field} fullWidth label="Postal/Zip Code" error={!!errors.addressForService?.postalCode} helperText={errors.addressForService?.postalCode?.message} />
                                        )} />
                                    </Grid>
                                </Grid>
                            )}
                            <Box mt={2}>
                                <Controller name="addressForService.email" control={control} render={({ field }) => (
                                    <TextField {...field} fullWidth label="Email Address for Service (optional)" type="email" error={!!errors.addressForService?.email} helperText={errors.addressForService?.email?.message} />
                                )} />
                            </Box>
                        </Box>
                    )}

                    {/* ============ Step 2: Directors ============ */}
                    {activeStep === 2 && (
                        <Box>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                <Typography variant="h6">Directors</Typography>
                                <Button type="button" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendDirector({ name: '', firstName: '', middleName: '', lastName: '', address: '', city: '', province: '', postalCode: '', residentCanadian: true, appointedDate: '', email: '', phone: '' })}>
                                    Add Director
                                </Button>
                            </Box>
                            {directorFields.map((field, index) => (
                                <Box key={field.id} mb={3} p={2} border={1} borderColor="grey.300" borderRadius={1}>
                                    <Grid container spacing={2}>
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`directors.${index}.firstName`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="First Name" error={!!errors.directors?.[index]?.firstName} helperText={errors.directors?.[index]?.firstName?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`directors.${index}.middleName`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Middle Name (optional)" />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`directors.${index}.lastName`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Last Name" error={!!errors.directors?.[index]?.lastName} helperText={errors.directors?.[index]?.lastName?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12}>
                                            <Controller name={`directors.${index}.address`} control={control} render={({ field: f }) => (
                                                <PlacesTextField {...f} fullWidth label="Street Address"
                                                    error={!!errors.directors?.[index]?.address}
                                                    helperText={errors.directors?.[index]?.address?.message}
                                                    onPlaceSelected={(addr) => {
                                                        setValue(`directors.${index}.city`, addr.city, { shouldValidate: true });
                                                        setValue(`directors.${index}.province`, addr.province, { shouldValidate: true });
                                                        setValue(`directors.${index}.postalCode`, addr.postalCode, { shouldValidate: true });
                                                    }}
                                                />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={5}>
                                            <Controller name={`directors.${index}.city`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="City" error={!!errors.directors?.[index]?.city} helperText={errors.directors?.[index]?.city?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`directors.${index}.province`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Province" error={!!errors.directors?.[index]?.province} helperText={errors.directors?.[index]?.province?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={3}>
                                            <Controller name={`directors.${index}.postalCode`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Postal Code" error={!!errors.directors?.[index]?.postalCode} helperText={errors.directors?.[index]?.postalCode?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={3}>
                                            <Controller name={`directors.${index}.appointedDate`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Appointed Date" type="date" InputLabelProps={{ shrink: true }} error={!!errors.directors?.[index]?.appointedDate} helperText={errors.directors?.[index]?.appointedDate?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={2}>
                                            <Controller name={`directors.${index}.residentCanadian`} control={control} render={({ field: f }) => (
                                                <FormControlLabel
                                                    control={<Checkbox checked={f.value} onChange={(e) => f.onChange(e.target.checked)} />}
                                                    label="Resident Canadian"
                                                />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={1} display="flex" justifyContent="center" alignItems="center">
                                            <IconButton color="error" onClick={() => removeDirector(index)} disabled={directorFields.length === 1}>
                                                <DeleteIcon />
                                            </IconButton>
                                        </Grid>
                                        <Grid item xs={12} sm={5}>
                                            <Controller name={`directors.${index}.email`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Email (optional)" type="email" error={!!errors.directors?.[index]?.email} helperText={errors.directors?.[index]?.email?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={5}>
                                            <Controller name={`directors.${index}.phone`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Phone (optional)" />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12}>
                                            <Typography variant="caption" color="text.secondary">{CONTACT_HINT}</Typography>
                                        </Grid>
                                    </Grid>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {/* ============ Step 3: Officers ============ */}
                    {activeStep === 3 && (
                        <Box>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                <Typography variant="h6">Officers</Typography>
                                <Button type="button" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendOfficer({ name: '', title: 'President', appointedDate: '', email: '', phone: '' })}>
                                    Add Officer
                                </Button>
                            </Box>
                            {officerFields.map((field, index) => (
                                <Box key={field.id} mb={3} p={2} border={1} borderColor="grey.300" borderRadius={1}>
                                    <Grid container spacing={2} alignItems="center">
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`officers.${index}.name`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Officer Name" error={!!errors.officers?.[index]?.name} helperText={errors.officers?.[index]?.name?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`officers.${index}.title`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth select label="Title" error={!!errors.officers?.[index]?.title} helperText={errors.officers?.[index]?.title?.message}>
                                                    {OFFICER_TITLES.map((t) => (
                                                        <MenuItem key={t} value={t}>{t}</MenuItem>
                                                    ))}
                                                </TextField>
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={3}>
                                            <Controller name={`officers.${index}.appointedDate`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Appointed Date" type="date" InputLabelProps={{ shrink: true }} error={!!errors.officers?.[index]?.appointedDate} helperText={errors.officers?.[index]?.appointedDate?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={1} display="flex" justifyContent="center">
                                            <IconButton color="error" onClick={() => removeOfficer(index)} disabled={officerFields.length === 1}>
                                                <DeleteIcon />
                                            </IconButton>
                                        </Grid>
                                        <Grid item xs={12} sm={5}>
                                            <Controller name={`officers.${index}.email`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Email (optional)" type="email" error={!!errors.officers?.[index]?.email} helperText={errors.officers?.[index]?.email?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={5}>
                                            <Controller name={`officers.${index}.phone`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Phone (optional)" />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12}>
                                            <Typography variant="caption" color="text.secondary">{CONTACT_HINT}</Typography>
                                        </Grid>
                                    </Grid>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {/* ============ Step 4: Share Classes ============ */}
                    {activeStep === 4 && (
                        <Box>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                <Typography variant="h6">Authorized Share Capital</Typography>
                                <Button type="button" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendShareClass({ name: '', type: 'Common', voting: true, maxAuthorized: null, parValue: null })}>
                                    Add Share Class
                                </Button>
                            </Box>
                            <Typography variant="body2" color="textSecondary" mb={2}>
                                List the classes of shares the corporation is authorized to issue (e.g. <em>Class A Common Voting Shares</em>, <em>Class D Preferred Non-Voting Shares</em>). The detailed rights, restrictions and conditions for each class belong in <strong>Schedule A — Share Capital</strong> on the Schedules step.
                            </Typography>
                            {shareClassFields.map((field, index) => (
                                <Box key={field.id} mb={3} p={2} border={1} borderColor="grey.300" borderRadius={1}>
                                    <Grid container spacing={2}>
                                        <Grid item xs={12} sm={6}>
                                            <Controller name={`shareClasses.${index}.name`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Class Name (e.g. Class A Common Voting Shares)" error={!!errors.shareClasses?.[index]?.name} helperText={errors.shareClasses?.[index]?.name?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={3}>
                                            <Controller name={`shareClasses.${index}.type`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth select label="Type">
                                                    <MenuItem value="Common">Common</MenuItem>
                                                    <MenuItem value="Preferred">Preferred</MenuItem>
                                                </TextField>
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={2}>
                                            <Controller name={`shareClasses.${index}.voting`} control={control} render={({ field: f }) => (
                                                <FormControlLabel
                                                    control={<Checkbox checked={f.value} onChange={(e) => f.onChange(e.target.checked)} />}
                                                    label="Voting"
                                                />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={1} display="flex" justifyContent="center" alignItems="center">
                                            <IconButton color="error" onClick={() => removeShareClass(index)} disabled={shareClassFields.length === 1}>
                                                <DeleteIcon />
                                            </IconButton>
                                        </Grid>
                                        <Grid item xs={12} sm={6}>
                                            <Controller name={`shareClasses.${index}.maxAuthorized`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Maximum Authorized (blank = unlimited)" type="number" value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value === '' ? null : Number(e.target.value))} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={6}>
                                            <Controller name={`shareClasses.${index}.parValue`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Par Value (blank = no par)" type="number" value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value === '' ? null : Number(e.target.value))} />
                                            )} />
                                        </Grid>
                                    </Grid>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {/* ============ Step 5: Shareholders ============ */}
                    {activeStep === 5 && (
                        <Box>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                <Typography variant="h6">Shareholders</Typography>
                                <Button type="button" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendShareholder({ holderType: 'Individual', name: '', corporateAccessNumber: '', businessNumber: '', address: '', city: '', province: '', postalCode: '', sharesClass: shareClassNames[0] || '', numberOfShares: 100, votingPercent: undefined, considerationPaid: undefined, issuanceDate: '', email: '', phone: '' })}>
                                    Add Shareholder
                                </Button>
                            </Box>
                            {shareholderFields.map((field, index) => {
                                const holderType = watch(`shareholders.${index}.holderType`);
                                return (
                                    <Box key={field.id} mb={3} p={2} border={1} borderColor="grey.300" borderRadius={1}>
                                        <Grid container spacing={2}>
                                            <Grid item xs={12} sm={3}>
                                                <Controller name={`shareholders.${index}.holderType`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth select label="Type">
                                                        <MenuItem value="Individual">Individual</MenuItem>
                                                        <MenuItem value="Legal Entity">Legal Entity</MenuItem>
                                                    </TextField>
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={6}>
                                                <Controller name={`shareholders.${index}.name`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth label={holderType === 'Legal Entity' ? 'Legal Entity Name' : 'Full Name'} error={!!errors.shareholders?.[index]?.name} helperText={errors.shareholders?.[index]?.name?.message} />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={2}>
                                                <Controller name={`shareholders.${index}.votingPercent`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth label="Voting %" type="number" value={f.value ?? ''} onChange={(e) => f.onChange(e.target.value === '' ? undefined : Number(e.target.value))} inputProps={{ min: 0, max: 100, step: 0.01 }} />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={1} display="flex" justifyContent="center" alignItems="center">
                                                <IconButton color="error" onClick={() => removeShareholder(index)} disabled={shareholderFields.length === 1}>
                                                    <DeleteIcon />
                                                </IconButton>
                                            </Grid>
                                            {holderType === 'Legal Entity' && (
                                                <>
                                                    <Grid item xs={12} sm={6}>
                                                        <Controller name={`shareholders.${index}.corporateAccessNumber`} control={control} render={({ field: f }) => (
                                                            <TextField {...f} fullWidth label="Corporate Access Number (CAN)" />
                                                        )} />
                                                    </Grid>
                                                    <Grid item xs={12} sm={6}>
                                                        <Controller name={`shareholders.${index}.businessNumber`} control={control} render={({ field: f }) => (
                                                            <TextField {...f} fullWidth label="Business Number (BN)" />
                                                        )} />
                                                    </Grid>
                                                </>
                                            )}
                                            <Grid item xs={12}>
                                                <Controller name={`shareholders.${index}.address`} control={control} render={({ field: f }) => (
                                                    <PlacesTextField {...f} fullWidth label={holderType === 'Legal Entity' ? 'Street / Registered Office' : 'Street Address'}
                                                        onPlaceSelected={(addr) => {
                                                            setValue(`shareholders.${index}.city`, addr.city, { shouldValidate: true });
                                                            setValue(`shareholders.${index}.province`, addr.province, { shouldValidate: true });
                                                            setValue(`shareholders.${index}.postalCode`, addr.postalCode, { shouldValidate: true });
                                                        }}
                                                    />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={5}>
                                                <Controller name={`shareholders.${index}.city`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth label="City" />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={4}>
                                                <Controller name={`shareholders.${index}.province`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth label="Province" />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={3}>
                                                <Controller name={`shareholders.${index}.postalCode`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth label="Postal Code" />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={6}>
                                                <Controller name={`shareholders.${index}.sharesClass`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth select label="Share Class" error={!!errors.shareholders?.[index]?.sharesClass} helperText={errors.shareholders?.[index]?.sharesClass?.message}>
                                                        {shareClassNames.length === 0 ? (
                                                            <MenuItem value="" disabled>Define a share class first</MenuItem>
                                                        ) : (
                                                            shareClassNames.map((n: string) => (
                                                                <MenuItem key={n} value={n}>{n}</MenuItem>
                                                            ))
                                                        )}
                                                    </TextField>
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={6}>
                                                <Controller name={`shareholders.${index}.numberOfShares`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth label="Number of Shares" type="number" error={!!errors.shareholders?.[index]?.numberOfShares} helperText={errors.shareholders?.[index]?.numberOfShares?.message} />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={6}>
                                                <Controller name={`shareholders.${index}.considerationPaid`} control={control} render={({ field: f }) => (
                                                    <TextField
                                                        {...f}
                                                        fullWidth
                                                        label="Consideration Paid ($)"
                                                        type="number"
                                                        placeholder="Total amount paid for shares"
                                                        value={f.value ?? ''}
                                                        onChange={(e) => f.onChange(e.target.value === '' ? undefined : Number(e.target.value))}
                                                        inputProps={{ min: 0, step: 0.01 }}
                                                    />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={6}>
                                                <Controller name={`shareholders.${index}.issuanceDate`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth label="Share Issuance Date" type="date" InputLabelProps={{ shrink: true }} helperText="Defaults to Incorporation Date if blank" />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={5}>
                                                <Controller name={`shareholders.${index}.email`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth label="Email (optional)" type="email" error={!!errors.shareholders?.[index]?.email} helperText={errors.shareholders?.[index]?.email?.message} />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12} sm={5}>
                                                <Controller name={`shareholders.${index}.phone`} control={control} render={({ field: f }) => (
                                                    <TextField {...f} fullWidth label="Phone (optional)" />
                                                )} />
                                            </Grid>
                                            <Grid item xs={12}>
                                                <Typography variant="caption" color="text.secondary">{CONTACT_HINT}</Typography>
                                            </Grid>
                                        </Grid>
                                    </Box>
                                );
                            })}
                        </Box>
                    )}

                    {/* ============ Step 6: Schedules ============ */}
                    {activeStep === 6 && (
                        <Box>
                            <Typography variant="h6" gutterBottom>Schedules</Typography>
                            <Typography variant="body2" color="textSecondary" mb={1}>
                                Schedules form part of the Articles of Incorporation. Per standard Canadian practice:
                            </Typography>

                            <Box sx={{ mb: 2, p: 1.5, border: '1.5px solid', borderColor: 'primary.main', borderRadius: 1, bgcolor: 'primary.50' }}>
                                <Typography variant="body2" sx={{ color: 'primary.dark', lineHeight: 1.6 }}>
                                    <strong>Schedule A — Share Capital</strong> is automatically generated from the Share Classes you defined in the previous step. It includes the full rights, restrictions, conditions and limitations for each class. You do not need to add it here.
                                </Typography>
                            </Box>

                            <ul style={{ marginTop: 0, color: '#555', fontSize: '0.875rem' }}>
                                <li><strong>Schedule B</strong> — Restrictions on Share Transfer (mandatory for non-distributing corporations)</li>
                                <li><strong>Schedule C / D / …</strong> — Other Provisions, Unanimous Shareholders Agreement, Voting Trust, etc.</li>
                            </ul>

                            <FormControl sx={{ mb: 2, mt: 1 }}>
                                <FormLabel>Do the Articles have schedules other than Schedule A?</FormLabel>
                                <RadioGroup
                                    row
                                    value={hasSchedules ? 'yes' : 'no'}
                                    onChange={(e) => {
                                        if (e.target.value === 'yes' && scheduleFields.length === 0) {
                                            appendSchedule({ name: '', content: '' });
                                        } else if (e.target.value === 'no') {
                                            for (let i = scheduleFields.length - 1; i >= 0; i--) removeSchedule(i);
                                        }
                                    }}
                                >
                                    <FormControlLabel value="no" control={<Radio />} label="No" />
                                    <FormControlLabel value="yes" control={<Radio />} label="Yes" />
                                </RadioGroup>
                            </FormControl>

                            {hasSchedules && (
                                <>
                                    {scheduleFields.map((field, index) => (
                                        <Box key={field.id} mb={3} p={2} border={1} borderColor="grey.300" borderRadius={1}>
                                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                                <Controller name={`schedules.${index}.name`} control={control} render={({ field: f }) => (
                                                    <TextField
                                                        {...f}
                                                        label="Schedule Name"
                                                        size="small"
                                                        sx={{ width: 220 }}
                                                        error={!!errors.schedules?.[index]?.name}
                                                        helperText={errors.schedules?.[index]?.name?.message}
                                                    />
                                                )} />
                                                <IconButton color="error" onClick={() => removeSchedule(index)}>
                                                    <DeleteIcon />
                                                </IconButton>
                                            </Box>
                                            <Controller name={`schedules.${index}.content`} control={control} render={({ field: f }) => (
                                                <TextField
                                                    {...f}
                                                    fullWidth
                                                    multiline
                                                    minRows={5}
                                                    label="Schedule Content"
                                                    placeholder="Paste the text of the schedule here..."
                                                    error={!!errors.schedules?.[index]?.content}
                                                    helperText={errors.schedules?.[index]?.content?.message}
                                                />
                                            )} />
                                        </Box>
                                    ))}
                                    <Button
                                        type="button"
                                        startIcon={<AddIcon />}
                                        variant="outlined"
                                        size="small"
                                        onClick={() => {
                                            appendSchedule({ name: '', content: '' });
                                        }}
                                    >
                                        Add Another Schedule
                                    </Button>
                                </>
                            )}
                        </Box>
                    )}

                    {/* ============ Step 7: Review ============ */}
                    {activeStep === 7 && <ReviewStep values={getValues()} />}

                    <Divider sx={{ my: 4 }} />

                    <Box display="flex" justifyContent="space-between">
                        <Button type="button" variant="outlined" onClick={() => navigate('/dashboard')}>
                            Cancel
                        </Button>
                        <Box display="flex" gap={1}>
                            <Button type="button" disabled={activeStep === 0} onClick={handleBack}>
                                Back
                            </Button>
                            {isEdit && !isLastStep && (
                                <Button type="button" variant="outlined" color="primary" onClick={handleSaveClick}>
                                    Save Changes
                                </Button>
                            )}
                            {isLastStep ? (
                                <Button type="button" variant="contained" color="primary" onClick={handleSaveClick}>
                                    {isEdit ? 'Save Changes' : 'Save Company'}
                                </Button>
                            ) : (
                                <Button type="button" variant="contained" color="primary" onClick={handleNext}>
                                    Next
                                </Button>
                            )}
                        </Box>
                    </Box>
                </form>

                {/* ---- Registry Search Dialog ---- */}
                <Dialog
                    open={searchOpen}
                    onClose={() => setSearchOpen(false)}
                    fullWidth
                    maxWidth="md"
                >
                    <DialogTitle>Search Canadian Corporate Registries</DialogTitle>
                    <DialogContent>
                        <DialogContentText sx={{ mb: 2 }}>
                            Enter your <strong>company name</strong>, <strong>Corporate Access Number</strong>, or <strong>Business Number (BN)</strong>. Choose a jurisdiction to narrow results, or leave it as <em>All of Canada</em>. QC is not covered by the public federal registry API.
                        </DialogContentText>

                        <Box display="flex" gap={1.5} alignItems="flex-start" flexWrap="wrap">
                            <TextField
                                autoFocus
                                label="Name, CAN, or BN"
                                placeholder="e.g. Acme Holdings, 2094832, or 123456789RC0001"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runRegistrySearch(); } }}
                                sx={{ flex: '2 1 260px' }}
                            />
                            <FormControl sx={{ flex: '1 1 180px' }}>
                                <InputLabel id="reg-search-prov-label">Jurisdiction</InputLabel>
                                <Select
                                    labelId="reg-search-prov-label"
                                    label="Jurisdiction"
                                    value={searchProvince}
                                    onChange={(e) => setSearchProvince(e.target.value as string)}
                                >
                                    {JURISDICTIONS.map((j) => (
                                        <MenuItem key={j.value} value={j.value}>{j.label}</MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Button
                                type="button"
                                variant="contained"
                                onClick={runRegistrySearch}
                                disabled={searchLoading}
                                startIcon={searchLoading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon />}
                                sx={{ height: 56 }}
                            >
                                Search
                            </Button>
                        </Box>

                        {searchError && (
                            <Alert severity="warning" sx={{ mt: 2 }}>{searchError}</Alert>
                        )}

                        {searchAttempted && !searchLoading && !searchError && searchResults.length === 0 && (
                            <Alert severity="info" sx={{ mt: 2 }}>
                                No matching records. Try the company's exact registered name, or switch jurisdiction.
                            </Alert>
                        )}

                        {searchResults.length > 0 && (
                            <TableContainer sx={{ mt: 2, maxHeight: 380 }}>
                                <Table size="small" stickyHeader>
                                    <TableHead>
                                        <TableRow>
                                            <TableCell>Company Name</TableCell>
                                            <TableCell>Jurisdiction</TableCell>
                                            <TableCell>Registry ID</TableCell>
                                            <TableCell>BN</TableCell>
                                            <TableCell>Status</TableCell>
                                            <TableCell align="right"></TableCell>
                                        </TableRow>
                                    </TableHead>
                                    <TableBody>
                                        {searchResults.map((hit, i) => (
                                            <TableRow key={`${hit.source}-${hit.registryId}-${i}`} hover>
                                                <TableCell>
                                                    <Typography variant="body2" fontWeight={600}>{hit.name}</Typography>
                                                    {hit.entityType && (
                                                        <Typography variant="caption" color="text.secondary">{hit.entityType}</Typography>
                                                    )}
                                                </TableCell>
                                                <TableCell>{hit.jurisdiction}</TableCell>
                                                <TableCell>{hit.registryId || '—'}</TableCell>
                                                <TableCell>{hit.businessNumber || '—'}</TableCell>
                                                <TableCell>
                                                    <Chip
                                                        label={hit.status}
                                                        size="small"
                                                        color={hit.status === 'Active' ? 'success' : 'default'}
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                                <TableCell align="right">
                                                    <Button size="small" variant="outlined" onClick={() => applyRegistryHit(hit)}>
                                                        Use this
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </TableContainer>
                        )}
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setSearchOpen(false)}>Close</Button>
                    </DialogActions>
                </Dialog>

                <Dialog open={confirmOpen} onClose={() => !saving && setConfirmOpen(false)}>
                    <DialogTitle>{isEdit ? 'Confirm changes' : 'Confirm new company'}</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            {isEdit
                                ? 'Are you sure all the information you have entered is correct? This will update the company record.'
                                : 'Are you sure all the information you have entered is correct? This will create a new company record.'}
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setConfirmOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button
                            onClick={handleSubmit(onSubmit)}
                            variant="contained"
                            color="primary"
                            disabled={saving}
                        >
                            {saving ? <CircularProgress size={20} /> : (isEdit ? 'Save Changes' : 'Create Company')}
                        </Button>
                    </DialogActions>
                </Dialog>
            </Paper>
        </Box>
    );
};

const ReviewStep: React.FC<{ values: CompanyFormValues }> = ({ values }) => (
    <Box>
        <Typography variant="h6" gutterBottom>Review</Typography>
        <Typography variant="body2" color="textSecondary" mb={2}>
            Confirm everything looks right before saving.
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Company</Typography>
        <List dense>
            <ListItem disableGutters><ListItemText primary="Name" secondary={values.name} /></ListItem>
            <ListItem disableGutters><ListItemText primary="Corporate Access Number" secondary={values.corporateAccessNumber || '—'} /></ListItem>
            <ListItem disableGutters><ListItemText primary="Business Number" secondary={values.businessNumber || '—'} /></ListItem>
            <ListItem disableGutters><ListItemText primary="Incorporation Date" secondary={values.incorporationDate || '—'} /></ListItem>
            <ListItem disableGutters><ListItemText primary="Fiscal Year End" secondary={values.fiscalYearEnd || '—'} /></ListItem>
            <ListItem disableGutters><ListItemText primary="Annual Return Due Date" secondary={values.annualReturnDueDate || '—'} /></ListItem>
            <ListItem disableGutters><ListItemText primary="Directors (min/max)" secondary={`${values.minDirectors ?? 1} / ${values.maxDirectors ?? 10}`} /></ListItem>
        </List>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Restrictions</Typography>
        <Typography variant="body2">
            <strong>To:</strong> {values.restrictions?.restrictedTo?.has ? (values.restrictions.restrictedTo.description || '(no description)') : 'None'}
        </Typography>
        <Typography variant="body2">
            <strong>From:</strong> {values.restrictions?.restrictedFrom?.has ? (values.restrictions.restrictedFrom.description || '(no description)') : 'None'}
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Authorized By</Typography>
        <Typography variant="body2">
            {values.authorizedBy.name}
            {values.authorizedBy.company ? ` (${values.authorizedBy.company})` : ''} —{' '}
            {values.authorizedBy.email} • {values.authorizedBy.phone}
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Registered Office</Typography>
        <Typography variant="body2">
            {values.registeredOfficeAddress.street}, {values.registeredOfficeAddress.city},{' '}
            {values.registeredOfficeAddress.province} {values.registeredOfficeAddress.postalCode},{' '}
            {values.registeredOfficeAddress.country}
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Records Address</Typography>
        <Typography variant="body2">
            {values.recordsAddress?.sameAsRegistered
                ? 'Same as Registered Office'
                : `${values.recordsAddress?.street || ''}, ${values.recordsAddress?.city || ''}, ${values.recordsAddress?.province || ''} ${values.recordsAddress?.postalCode || ''}`}
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Address for Service by Mail</Typography>
        <Typography variant="body2">
            {values.addressForService?.sameAsRegistered
                ? 'Same as Registered Office'
                : values.addressForService?.sameAsRecords
                    ? 'Same as Records Address'
                    : `${values.addressForService?.poBox ? 'PO Box ' + values.addressForService.poBox + ', ' : ''}${values.addressForService?.street ? values.addressForService.street + ', ' : ''}${values.addressForService?.city || ''}, ${values.addressForService?.province || ''} ${values.addressForService?.postalCode || ''}`}
            {values.addressForService?.email ? ` • ${values.addressForService.email}` : ''}
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Directors ({values.directors.length})</Typography>
        <List dense>
            {values.directors.map((d, i) => (
                <ListItem key={i} disableGutters>
                    <ListItemText
                        primary={`${d.firstName || ''} ${d.middleName || ''} ${d.lastName || ''}`.replace(/\s+/g, ' ').trim() || d.name}
                        secondary={`${d.address} — appointed ${d.appointedDate}${d.residentCanadian ? ' • Resident Canadian' : ''}`}
                    />
                </ListItem>
            ))}
        </List>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Officers ({values.officers.length})</Typography>
        <List dense>
            {values.officers.map((o, i) => (
                <ListItem key={i} disableGutters>
                    <ListItemText primary={`${o.title} — ${o.name}`} secondary={`Appointed ${o.appointedDate}`} />
                </ListItem>
            ))}
        </List>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Authorized Share Capital ({values.shareClasses.length})</Typography>
        <List dense>
            {values.shareClasses.map((sc, i) => (
                <ListItem key={i} disableGutters>
                    <ListItemText
                        primary={sc.name}
                        secondary={`${sc.type} • ${sc.voting ? 'Voting' : 'Non-Voting'}${sc.maxAuthorized != null ? ' • Max ' + sc.maxAuthorized : ' • Unlimited'}${sc.parValue != null ? ' • Par $' + sc.parValue : ' • No par'}`}
                    />
                </ListItem>
            ))}
        </List>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Shareholders ({values.shareholders.length})</Typography>
        <List dense>
            {values.shareholders.map((s, i) => (
                <ListItem key={i} disableGutters>
                    <ListItemText
                        primary={`${s.name}${s.holderType === 'Legal Entity' && s.corporateAccessNumber ? ` (CAN ${s.corporateAccessNumber})` : ''}`}
                        secondary={[
                            `${s.numberOfShares} ${s.sharesClass}`,
                            s.votingPercent != null ? `${s.votingPercent}% voting` : null,
                            s.considerationPaid != null ? `$${s.considerationPaid} consideration` : null,
                            s.issuanceDate ? `issued ${s.issuanceDate}` : null,
                        ].filter(Boolean).join(' • ')}
                    />
                </ListItem>
            ))}
        </List>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Schedules ({values.schedules?.length || 0})</Typography>
        {values.schedules && values.schedules.length > 0 ? (
            <List dense>
                {values.schedules.map((s, i) => (
                    <ListItem key={i} disableGutters>
                        <ListItemText
                            primary={s.name}
                            secondary={s.content.length > 100 ? `${s.content.slice(0, 100)}…` : s.content}
                        />
                    </ListItem>
                ))}
            </List>
        ) : (
            <Typography variant="body2">None</Typography>
        )}
    </Box>
);

export default MinuteBookBuilder;
