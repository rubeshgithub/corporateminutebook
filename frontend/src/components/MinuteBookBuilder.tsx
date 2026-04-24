import React from 'react';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
    Box, Button, TextField, Typography, Paper, Grid, Divider, IconButton
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

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
    fiscalYearEnd: z.string().optional(),
});

type CompanyFormValues = z.infer<typeof companySchema>;

const MinuteBookBuilder: React.FC = () => {
    const navigate = useNavigate();

    const {
        control, handleSubmit, formState: { errors }
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
            fiscalYearEnd: '12-31',
        }
    });

    const {
        fields: directorFields, append: appendDirector, remove: removeDirector
    } = useFieldArray({ control, name: 'directors' });

    const {
        fields: shareholderFields, append: appendShareholder, remove: removeShareholder
    } = useFieldArray({ control, name: 'shareholders' });

    const onSubmit = async (data: CompanyFormValues) => {
        try {
            await api.post('/companies', data);
            navigate('/dashboard');
        } catch (error) {
            console.error('Failed to create company:', error);
            alert('Failed to save Company profile. Please try again.');
        }
    };

    return (
        <Box p={4} display="flex" justifyContent="center">
            <Paper elevation={3} sx={{ p: 4, width: '100%', maxWidth: 800 }}>
                <Typography variant="h4" gutterBottom color="primary">Minute Book Builder</Typography>
                <Typography variant="subtitle1" gutterBottom color="textSecondary" mb={4}>
                    Complete the form below to generate your corporate minute book.
                </Typography>

                <form onSubmit={handleSubmit(onSubmit)}>
                    {/* Section 1: Basic Info */}
                    <Typography variant="h6" gutterBottom>1. Company Details</Typography>
                    <Grid container spacing={2}>
                        <Grid item xs={12}>
                            <Controller name="name" control={control} render={({ field }) => (
                                <TextField {...field} fullWidth label="Company Name" error={!!errors.name} helperText={errors.name?.message} />
                            )} />
                        </Grid>
                        <Grid item xs={12} sm={6}>
                            <Controller name="corporateAccessNumber" control={control} render={({ field }) => (
                                <TextField {...field} fullWidth label="Corporate Access Number (CAN)" />
                            )} />
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

                    <Divider sx={{ my: 4 }} />

                    {/* Section 2: Address */}
                    <Typography variant="h6" gutterBottom>2. Registered Office Address</Typography>
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

                    <Divider sx={{ my: 4 }} />

                    {/* Section 3: Directors */}
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6">3. Directors</Typography>
                        <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendDirector({ name: '', address: '', appointedDate: '' })}>
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

                    <Divider sx={{ my: 4 }} />

                    {/* Section 4: Shareholders */}
                    <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                        <Typography variant="h6">4. Shareholders</Typography>
                        <Button startIcon={<AddIcon />} variant="outlined" size="small" onClick={() => appendShareholder({ name: '', sharesClass: 'Common', numberOfShares: 100 })}>
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

                    <Box display="flex" justifyContent="space-between" mt={4}>
                        <Button variant="outlined" size="large" onClick={() => navigate('/dashboard')}>
                            Cancel
                        </Button>
                        <Button variant="contained" color="primary" size="large" type="submit">
                            Save Company & Generate Book
                        </Button>
                    </Box>
                </form>
            </Paper>
        </Box>
    );
};

export default MinuteBookBuilder;
