import React, { useEffect, useState } from 'react';
import { useForm, useFieldArray, Controller, FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    Box, Button, TextField, Typography, Paper, Grid, IconButton, CircularProgress,
    Stepper, Step, StepLabel, StepButton, Divider, List, ListItem, ListItemText,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
    MenuItem, FormControlLabel, Switch, RadioGroup, Radio, FormControl, FormLabel,
    Checkbox
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../utils/api';

const toDateInput = (value?: string | Date) => {
    if (!value) return '';
    const d = new Date(value);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
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
        address: z.string().min(1, 'Address is required'),
        residentCanadian: z.boolean().default(true),
        appointedDate: z.string().min(1, 'Appointed Date is required'),
    })).min(1, 'At least one director is required'),
    shareholders: z.array(z.object({
        holderType: z.enum(['Individual', 'Legal Entity']).default('Individual'),
        name: z.string().min(1, 'Shareholder Name is required'),
        corporateAccessNumber: z.string().optional(),
        businessNumber: z.string().optional(),
        address: z.string().optional(),
        sharesClass: z.string().min(1, 'Share Class is required'),
        numberOfShares: z.coerce.number().min(1, 'Must have at least 1 share'),
        votingPercent: z.coerce.number().min(0).max(100).optional(),
    })).min(1, 'At least one shareholder is required'),
    officers: z.array(z.object({
        name: z.string().min(1, 'Officer Name is required'),
        title: z.string().min(1, 'Title is required'),
        appointedDate: z.string().min(1, 'Appointed Date is required'),
    })).min(1, 'At least one officer is required'),
    fiscalYearEnd: z.string().optional(),
});

type CompanyFormValues = z.infer<typeof companySchema>;

const STEPS: Array<{ label: string; fields: FieldPath<CompanyFormValues>[] }> = [
    { label: 'Company', fields: ['name', 'corporateAccessNumber', 'businessNumber', 'incorporationDate', 'fiscalYearEnd', 'minDirectors', 'maxDirectors', 'restrictions', 'authorizedBy'] },
    { label: 'Addresses', fields: ['registeredOfficeAddress', 'recordsAddress', 'addressForService'] },
    { label: 'Directors', fields: ['directors'] },
    { label: 'Officers', fields: ['officers'] },
    { label: 'Share Classes', fields: ['shareClasses'] },
    { label: 'Shareholders', fields: ['shareholders'] },
    { label: 'Schedules', fields: ['schedules'] },
    { label: 'Review', fields: [] },
];

const OFFICER_TITLES = ['President', 'Vice-President', 'Secretary', 'Treasurer', 'CEO', 'CFO', 'COO', 'Chair', 'Other'];
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
    const [loading, setLoading] = useState(isEdit);
    const [lookupLoading, setLookupLoading] = useState(false);
    const [activeStep, setActiveStep] = useState(0);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, setSaving] = useState(false);

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
            shareholders: [{ holderType: 'Individual', name: '', corporateAccessNumber: '', businessNumber: '', address: '', sharesClass: DEFAULT_SHARE_CLASS.name, numberOfShares: 100, votingPercent: 100 }],
            officers: [{ name: '', title: 'President', appointedDate: '' }],
            fiscalYearEnd: '12-31',
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
                            residentCanadian: d.residentCanadian ?? true,
                            appointedDate: toDateInput(d.appointedDate),
                        };
                    }),
                    shareholders: (data.shareholders?.length ? data.shareholders : [{}]).map((s: any) => ({
                        holderType: s.holderType || 'Individual',
                        name: s.name || '',
                        corporateAccessNumber: s.corporateAccessNumber || '',
                        businessNumber: s.businessNumber || '',
                        address: s.address || '',
                        sharesClass: s.sharesClass || DEFAULT_SHARE_CLASS.name,
                        numberOfShares: s.numberOfShares ?? 100,
                        votingPercent: s.votingPercent ?? undefined,
                    })),
                    officers: (data.officers?.length ? data.officers : [{ name: '', title: 'President', appointedDate: '' }]).map((o: any) => ({
                        name: o.name || '',
                        title: o.title || 'President',
                        appointedDate: toDateInput(o.appointedDate),
                    })),
                    fiscalYearEnd: data.fiscalYearEnd || '12-31',
                });
            } catch (error) {
                console.error('Failed to load company:', error);
                alert('Failed to load company. Returning to dashboard.');
                navigate('/dashboard');
            } finally {
                setLoading(false);
            }
        };
        fetchCompany();
    }, [id, isEdit, navigate, reset]);

    const handleRegistryLookup = async () => {
        const accessNumber = getValues('corporateAccessNumber');
        if (!accessNumber) {
            alert('Enter a Corporate Access Number first.');
            return;
        }
        setLookupLoading(true);
        try {
            const { data } = await api.get('/registry/fetch', { params: { accessNumber } });
            setValue('name', data.name || '', { shouldValidate: true });
            setValue('incorporationDate', toDateInput(data.incorporationDate));
            if (data.registeredOfficeAddress) {
                setValue('registeredOfficeAddress.street', data.registeredOfficeAddress.street || '', { shouldValidate: true });
                setValue('registeredOfficeAddress.city', data.registeredOfficeAddress.city || '', { shouldValidate: true });
                setValue('registeredOfficeAddress.province', data.registeredOfficeAddress.province || '', { shouldValidate: true });
                setValue('registeredOfficeAddress.postalCode', data.registeredOfficeAddress.postalCode || '', { shouldValidate: true });
                setValue('registeredOfficeAddress.country', data.registeredOfficeAddress.country || 'Canada');
            }
        } catch (error) {
            console.error('Registry lookup failed:', error);
            alert('Registry lookup failed. Verify the access number and try again.');
        } finally {
            setLookupLoading(false);
        }
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
            alert('Some fields are missing or invalid. Use the step labels to navigate back and fix them.');
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
            alert('Failed to save Company profile. Please try again.');
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
                            <Typography variant="h6" gutterBottom>Company Details</Typography>
                            <Grid container spacing={2}>
                                <Grid item xs={12}>
                                    <Controller name="name" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Company Name" error={!!errors.name} helperText={errors.name?.message} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Box display="flex" gap={1} alignItems="flex-start">
                                        <Controller name="corporateAccessNumber" control={control} render={({ field }) => (
                                            <TextField {...field} fullWidth label="Corporate Access Number (CAN)" />
                                        )} />
                                        <Button
                                            type="button"
                                            variant="outlined"
                                            onClick={handleRegistryLookup}
                                            disabled={lookupLoading}
                                            sx={{ height: 56, whiteSpace: 'nowrap' }}
                                        >
                                            {lookupLoading ? <CircularProgress size={20} /> : 'Lookup'}
                                        </Button>
                                    </Box>
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="businessNumber" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Business Number (BN)" />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="incorporationDate" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Incorporation Date" type="date" InputLabelProps={{ shrink: true }} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={6}>
                                    <Controller name="fiscalYearEnd" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Fiscal Year End (MM-DD)" placeholder="12-31" />
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
                                        <TextField {...field} fullWidth label="Street Address" error={!!errors.registeredOfficeAddress?.street} helperText={errors.registeredOfficeAddress?.street?.message} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <Controller name="registeredOfficeAddress.city" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="City" error={!!errors.registeredOfficeAddress?.city} helperText={errors.registeredOfficeAddress?.city?.message} />
                                    )} />
                                </Grid>
                                <Grid item xs={12} sm={4}>
                                    <Controller name="registeredOfficeAddress.province" control={control} render={({ field }) => (
                                        <TextField {...field} fullWidth label="Province/State" error={!!errors.registeredOfficeAddress?.province} helperText={errors.registeredOfficeAddress?.province?.message} />
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
                                            <TextField {...field} fullWidth label="Street Address" error={!!errors.recordsAddress?.street} helperText={errors.recordsAddress?.street?.message} />
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
                                            <TextField {...field} fullWidth label="Street (if not PO Box)" />
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
                                <Button type="button" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendDirector({ name: '', firstName: '', middleName: '', lastName: '', address: '', residentCanadian: true, appointedDate: '' })}>
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
                                        <Grid item xs={12} sm={6}>
                                            <Controller name={`directors.${index}.address`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Residential Address" error={!!errors.directors?.[index]?.address} helperText={errors.directors?.[index]?.address?.message} />
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
                                <Button type="button" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendOfficer({ name: '', title: 'President', appointedDate: '' })}>
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
                                <Button type="button" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendShareholder({ holderType: 'Individual', name: '', corporateAccessNumber: '', businessNumber: '', address: '', sharesClass: shareClassNames[0] || '', numberOfShares: 100, votingPercent: undefined })}>
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
                                                    <TextField {...f} fullWidth label={holderType === 'Legal Entity' ? 'Registered Office Address' : 'Address'} />
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
                        secondary={`${s.numberOfShares} ${s.sharesClass}${s.votingPercent != null ? ` • ${s.votingPercent}% voting` : ''}`}
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
