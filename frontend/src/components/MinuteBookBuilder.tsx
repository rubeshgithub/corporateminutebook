import React, { useEffect, useState } from 'react';
import { useForm, useFieldArray, Controller, FieldPath } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    Box, Button, TextField, Typography, Paper, Grid, IconButton, CircularProgress,
    Stepper, Step, StepLabel, StepButton, Divider, List, ListItem, ListItemText,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions,
    MenuItem
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

const companySchema = z.object({
    name: z.string().min(1, 'Company Name is required'),
    corporateAccessNumber: z.string().optional(),
    businessNumber: z.string().optional(),
    incorporationDate: z.string().optional(),
    registeredOfficeAddress: z.object({
        street: z.string().min(1, 'Street is required'),
        city: z.string().min(1, 'City is required'),
        province: z.string().min(1, 'Province is required'),
        postalCode: z.string().min(1, 'Postal Code is required'),
        country: z.string().default('Canada'),
    }),
    directors: z.array(z.object({
        name: z.string().min(1, 'Director Name is required'),
        address: z.string().min(1, 'Address is required'),
        appointedDate: z.string().min(1, 'Appointed Date is required'),
    })).min(1, 'At least one director is required'),
    shareholders: z.array(z.object({
        name: z.string().min(1, 'Shareholder Name is required'),
        sharesClass: z.string().min(1, 'Share Class is required'),
        numberOfShares: z.coerce.number().min(1, 'Must have at least 1 share'),
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
    { label: 'Company', fields: ['name', 'corporateAccessNumber', 'businessNumber', 'incorporationDate', 'fiscalYearEnd'] },
    { label: 'Address', fields: ['registeredOfficeAddress'] },
    { label: 'Directors', fields: ['directors'] },
    { label: 'Officers', fields: ['officers'] },
    { label: 'Shareholders', fields: ['shareholders'] },
    { label: 'Review', fields: [] },
];

const OFFICER_TITLES = ['President', 'Vice-President', 'Secretary', 'Treasurer', 'CEO', 'CFO', 'COO', 'Chair', 'Other'];

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
        control, handleSubmit, reset, getValues, setValue, trigger, formState: { errors }
    } = useForm<CompanyFormValues>({
        resolver: zodResolver(companySchema),
        defaultValues: {
            name: '',
            corporateAccessNumber: '',
            businessNumber: '',
            incorporationDate: '',
            registeredOfficeAddress: {
                street: '', city: '', province: '', postalCode: '', country: 'Canada'
            },
            directors: [{ name: '', address: '', appointedDate: '' }],
            shareholders: [{ name: '', sharesClass: 'Common', numberOfShares: 100 }],
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
                    registeredOfficeAddress: {
                        street: data.registeredOfficeAddress?.street || '',
                        city: data.registeredOfficeAddress?.city || '',
                        province: data.registeredOfficeAddress?.province || '',
                        postalCode: data.registeredOfficeAddress?.postalCode || '',
                        country: data.registeredOfficeAddress?.country || 'Canada',
                    },
                    directors: (data.directors?.length ? data.directors : [{}]).map((d: any) => ({
                        name: d.name || '',
                        address: d.address || '',
                        appointedDate: toDateInput(d.appointedDate),
                    })),
                    shareholders: (data.shareholders?.length ? data.shareholders : [{}]).map((s: any) => ({
                        name: s.name || '',
                        sharesClass: s.sharesClass || 'Common',
                        numberOfShares: s.numberOfShares ?? 100,
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
            if (isEdit) {
                await api.put(`/companies/${id}`, data);
            } else {
                await api.post('/companies', data);
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

    return (
        <Box p={4} display="flex" justifyContent="center">
            <Paper elevation={3} sx={{ p: 4, width: '100%', maxWidth: 800 }}>
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
                            </Grid>
                        </Box>
                    )}

                    {activeStep === 1 && (
                        <Box>
                            <Typography variant="h6" gutterBottom>Registered Office Address</Typography>
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
                        </Box>
                    )}

                    {activeStep === 2 && (
                        <Box>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                <Typography variant="h6">Directors</Typography>
                                <Button type="button" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendDirector({ name: '', address: '', appointedDate: '' })}>
                                    Add Director
                                </Button>
                            </Box>
                            {directorFields.map((field, index) => (
                                <Box key={field.id} mb={3} p={2} border={1} borderColor="grey.300" borderRadius={1}>
                                    <Grid container spacing={2} alignItems="center">
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`directors.${index}.name`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Director Name" error={!!errors.directors?.[index]?.name} helperText={errors.directors?.[index]?.name?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`directors.${index}.address`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Residential Address" error={!!errors.directors?.[index]?.address} helperText={errors.directors?.[index]?.address?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={3}>
                                            <Controller name={`directors.${index}.appointedDate`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Appointed Date" type="date" InputLabelProps={{ shrink: true }} error={!!errors.directors?.[index]?.appointedDate} helperText={errors.directors?.[index]?.appointedDate?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={1} display="flex" justifyContent="center">
                                            <IconButton color="error" onClick={() => removeDirector(index)} disabled={directorFields.length === 1}>
                                                <DeleteIcon />
                                            </IconButton>
                                        </Grid>
                                    </Grid>
                                </Box>
                            ))}
                        </Box>
                    )}

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

                    {activeStep === 4 && (
                        <Box>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                                <Typography variant="h6">Shareholders</Typography>
                                <Button type="button" startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendShareholder({ name: '', sharesClass: 'Common', numberOfShares: 100 })}>
                                    Add Shareholder
                                </Button>
                            </Box>
                            {shareholderFields.map((field, index) => (
                                <Box key={field.id} mb={3} p={2} border={1} borderColor="grey.300" borderRadius={1}>
                                    <Grid container spacing={2} alignItems="center">
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`shareholders.${index}.name`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Shareholder Name" error={!!errors.shareholders?.[index]?.name} helperText={errors.shareholders?.[index]?.name?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={4}>
                                            <Controller name={`shareholders.${index}.sharesClass`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Share Class (e.g., Common)" error={!!errors.shareholders?.[index]?.sharesClass} helperText={errors.shareholders?.[index]?.sharesClass?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={3}>
                                            <Controller name={`shareholders.${index}.numberOfShares`} control={control} render={({ field: f }) => (
                                                <TextField {...f} fullWidth label="Number of Shares" type="number" error={!!errors.shareholders?.[index]?.numberOfShares} helperText={errors.shareholders?.[index]?.numberOfShares?.message} />
                                            )} />
                                        </Grid>
                                        <Grid item xs={12} sm={1} display="flex" justifyContent="center">
                                            <IconButton color="error" onClick={() => removeShareholder(index)} disabled={shareholderFields.length === 1}>
                                                <DeleteIcon />
                                            </IconButton>
                                        </Grid>
                                    </Grid>
                                </Box>
                            ))}
                        </Box>
                    )}

                    {activeStep === 5 && <ReviewStep values={getValues()} />}

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
        </List>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Registered Office</Typography>
        <Typography variant="body2">
            {values.registeredOfficeAddress.street}, {values.registeredOfficeAddress.city},{' '}
            {values.registeredOfficeAddress.province} {values.registeredOfficeAddress.postalCode},{' '}
            {values.registeredOfficeAddress.country}
        </Typography>

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Directors ({values.directors.length})</Typography>
        <List dense>
            {values.directors.map((d, i) => (
                <ListItem key={i} disableGutters>
                    <ListItemText primary={d.name} secondary={`${d.address} — appointed ${d.appointedDate}`} />
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

        <Typography variant="subtitle2" sx={{ mt: 2 }}>Shareholders ({values.shareholders.length})</Typography>
        <List dense>
            {values.shareholders.map((s, i) => (
                <ListItem key={i} disableGutters>
                    <ListItemText primary={s.name} secondary={`${s.numberOfShares} ${s.sharesClass} shares`} />
                </ListItem>
            ))}
        </List>
    </Box>
);

export default MinuteBookBuilder;
