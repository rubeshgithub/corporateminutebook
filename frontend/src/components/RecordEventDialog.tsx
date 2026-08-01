import React, { useState } from 'react';
import {
    Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent,
    DialogTitle, Divider, FormControl, FormControlLabel, InputLabel, MenuItem,
    Select, Switch, TextField, Typography,
} from '@mui/material';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import api from '../utils/api';
import { useSnackbar } from '../context/SnackbarContext';

type EventType =
    | 'director_appointed' | 'director_resigned' | 'director_address_changed'
    | 'address_changed'
    | 'shares_issued' | 'shares_transferred' | 'shares_cancelled'
    | 'officer_appointed' | 'officer_resigned'
    | 'share_class_added'
    | 'annual_return_filed'
    | 'fiscal_year_end_changed'
    | 'name_changed'
    // Wave 2 additions:
    | 'signing_authority_granted' | 'signing_authority_revoked'
    | 'dividend_declared';

type AttachRole = 'resolution' | 'registry_filing' | 'supporting';

const RESOLUTION_EVENT_TYPES = new Set<EventType>([
    'director_appointed', 'director_resigned', 'director_address_changed',
    'officer_appointed', 'officer_resigned',
    'shares_issued', 'shares_transferred', 'shares_cancelled', 'share_class_added',
    'address_changed', 'name_changed', 'fiscal_year_end_changed',
    'signing_authority_granted', 'signing_authority_revoked', 'dividend_declared',
]);

// Share-change events write into company.shareholders and print on share
// certificates — the backend rejects fractional/zero counts and unknown
// share classes, so catch both here before the round-trip.
const SHARE_CHANGE_EVENT_TYPES = new Set<EventType>([
    'shares_issued', 'shares_transferred', 'shares_cancelled',
]);

// Signing-authority + dividend events are internal governance actions —
// no filing with the corporate registry is expected, so the "attach
// registry filing" prompt stays off for them.
const REGISTRY_ATTACH_EVENT_TYPES = new Set<EventType>([
    'director_appointed', 'director_resigned', 'director_address_changed',
    'address_changed', 'name_changed', 'shares_transferred', 'shares_issued',
    'shares_cancelled', 'share_class_added', 'annual_return_filed',
]);

const EVENT_LABELS: Record<EventType, string> = {
    director_appointed:         'Director Appointed',
    director_resigned:          'Director Resigned',
    director_address_changed:   "Director's Address Changed",
    address_changed:            'Registered Address Changed',
    shares_issued:              'Shares Issued',
    shares_transferred:         'Shares Transferred',
    shares_cancelled:           'Shares Cancelled',
    officer_appointed:          'Officer Appointed',
    officer_resigned:           'Officer Resigned',
    share_class_added:          'Share Class Added',
    annual_return_filed:        'Annual Return Filed',
    fiscal_year_end_changed:    'Fiscal Year End Changed',
    name_changed:               'Company Name Changed',
    signing_authority_granted:  'Signing Authority Granted',
    signing_authority_revoked:  'Signing Authority Revoked',
    dividend_declared:          'Dividend Declared',
};

const PROVINCE_CODES = ['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'];
const OFFICER_TITLES = ['President', 'Vice-President', 'Secretary', 'Treasurer', 'CEO', 'CFO', 'COO', 'Chair', 'Other'];

interface Props {
    open: boolean;
    onClose: () => void;
    companyId: string;
    company: any;
    onSuccess: (event: any) => void;
    /** Preset the event-type dropdown — used by the plain-English change
     *  wizard so a click on "Add a shareholder" opens the dialog already
     *  scoped to `shares_issued` instead of the generic default. */
    initialEventType?: EventType;
}

const RecordEventDialog: React.FC<Props> = ({ open, onClose, companyId, company, onSuccess, initialEventType }) => {
    const { showSnackbar } = useSnackbar();
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [eventType, setEventType] = useState<EventType>(initialEventType ?? 'director_appointed');

    // Re-sync when the launcher opens the dialog with a new preset so
    // sequentially opening different wizard tiles doesn't stick on the
    // first one selected.
    React.useEffect(() => {
        if (open && initialEventType) {
            setEventType(initialEventType);
            setFormData({});
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialEventType]);
    const [effectiveDate, setEffectiveDate] = useState('');
    const [notes, setNotes] = useState('');
    const [formData, setFormData] = useState<Record<string, any>>({});
    const [inlineResolutionFile, setInlineResolutionFile] = useState<File | null>(null);
    const [inlineRegistryFile, setInlineRegistryFile] = useState<File | null>(null);

    const set = (key: string, value: any) => setFormData((prev) => ({ ...prev, [key]: value }));

    const resetForm = () => {
        setEventType('director_appointed');
        setEffectiveDate('');
        setNotes('');
        setFormData({});
        setInlineResolutionFile(null);
        setInlineRegistryFile(null);
        setError('');
    };

    const handleClose = () => {
        if (saving) return;
        resetForm();
        onClose();
    };

    const handleChangeEventType = (type: EventType) => {
        setEventType(type);
        setFormData({});
        setInlineResolutionFile(null);
        setInlineRegistryFile(null);
    };

    const handleSubmit = async () => {
        if (!effectiveDate) { setError('Effective date is required.'); return; }
        if (SHARE_CHANGE_EVENT_TYPES.has(eventType)) {
            if (!formData.sharesClass) {
                setError('Select a share class. If none are listed, record a "Share Class Added" event first.');
                return;
            }
            if (!Number.isInteger(formData.numberOfShares) || formData.numberOfShares < 1) {
                setError('Number of shares must be a whole number of at least 1.');
                return;
            }
        }
        setSaving(true);
        setError('');
        try {
            const { data: newEvent } = await api.post('/events', {
                companyId,
                eventType,
                effectiveDate,
                data: formData,
                notes,
            });

            let finalEvent = newEvent;
            const toUpload: { role: AttachRole; file: File }[] = [];
            if (inlineResolutionFile && RESOLUTION_EVENT_TYPES.has(eventType))
                toUpload.push({ role: 'resolution', file: inlineResolutionFile });
            if (inlineRegistryFile && REGISTRY_ATTACH_EVENT_TYPES.has(eventType))
                toUpload.push({ role: 'registry_filing', file: inlineRegistryFile });
            for (const { role, file } of toUpload) {
                const form = new FormData();
                form.append('file', file);
                form.append('role', role);
                const { data: withAttachment } = await api.post(`/events/${newEvent._id}/attach`, form, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                finalEvent = withAttachment;
            }

            resetForm();
            onClose();
            onSuccess(finalEvent);
            showSnackbar('Event recorded successfully.', 'success');
        } catch (err: any) {
            setError(err?.response?.data?.error || 'Failed to save event.');
        } finally {
            setSaving(false);
        }
    };

    const directorOptions = (company?.directors || []).filter((d: any) => !d.resignedDate);
    const allDirectors = company?.directors || [];
    const shareholderOptions = company?.shareholders || [];
    const officerOptions = (company?.officers || []).filter((o: any) => !o.resignedDate);
    const shareClassOptions = (company?.shareClasses || []).map((sc: any) => sc.name);

    const renderForm = () => {
        switch (eventType) {
            case 'director_appointed':
                return <>
                    <TextField label="First Name" fullWidth size="small" sx={{ mb: 2 }} value={formData.firstName || ''} onChange={(e) => set('firstName', e.target.value)} />
                    <TextField label="Middle Name" fullWidth size="small" sx={{ mb: 2 }} value={formData.middleName || ''} onChange={(e) => set('middleName', e.target.value)} />
                    <TextField label="Last Name" fullWidth size="small" sx={{ mb: 2 }} value={formData.lastName || ''} onChange={(e) => set('lastName', e.target.value)} />
                    <TextField label="Email" type="email" fullWidth size="small" sx={{ mb: 2 }} value={formData.email || ''} onChange={(e) => set('email', e.target.value)} />
                    <TextField label="Residential Address" fullWidth size="small" sx={{ mb: 2 }} value={formData.address || ''} onChange={(e) => set('address', e.target.value)} />
                    <FormControlLabel control={<Switch checked={formData.residentCanadian ?? true} onChange={(e) => set('residentCanadian', e.target.checked)} />} label="Resident Canadian" />
                </>;

            case 'director_resigned':
                return <>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Director</InputLabel>
                        <Select value={formData.directorName || ''} label="Director" onChange={(e) => set('directorName', e.target.value)}>
                            {allDirectors.map((d: any) => {
                                const name = [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ') || d.name;
                                return <MenuItem key={name} value={name}>{name}{d.resignedDate ? ' (resigned)' : ''}</MenuItem>;
                            })}
                        </Select>
                    </FormControl>
                </>;

            case 'director_address_changed':
                return <>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Director</InputLabel>
                        <Select value={formData.directorName || ''} label="Director" onChange={(e) => set('directorName', e.target.value)}>
                            {directorOptions.map((d: any) => {
                                const name = [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ') || d.name;
                                return <MenuItem key={name} value={name}>{name}</MenuItem>;
                            })}
                        </Select>
                    </FormControl>
                    <TextField label="New Address" fullWidth size="small" sx={{ mb: 2 }} value={formData.newAddress || ''} onChange={(e) => set('newAddress', e.target.value)} />
                </>;

            case 'address_changed':
                return <>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Address Type</InputLabel>
                        <Select value={formData.addressType || 'registered'} label="Address Type" onChange={(e) => set('addressType', e.target.value)}>
                            <MenuItem value="registered">Registered Office</MenuItem>
                            <MenuItem value="records">Records Address</MenuItem>
                            <MenuItem value="service">Address for Service</MenuItem>
                        </Select>
                    </FormControl>
                    <TextField label="Street" fullWidth size="small" sx={{ mb: 2 }} value={formData.address?.street || ''} onChange={(e) => set('address', { ...formData.address, street: e.target.value })} />
                    <TextField label="City" fullWidth size="small" sx={{ mb: 2 }} value={formData.address?.city || ''} onChange={(e) => set('address', { ...formData.address, city: e.target.value })} />
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Province</InputLabel>
                        <Select value={formData.address?.province || ''} label="Province" onChange={(e) => set('address', { ...formData.address, province: e.target.value })}>
                            {PROVINCE_CODES.map((p) => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <TextField label="Postal Code" fullWidth size="small" sx={{ mb: 2 }} value={formData.address?.postalCode || ''} onChange={(e) => set('address', { ...formData.address, postalCode: e.target.value })} />
                </>;

            case 'shares_issued':
                return <>
                    <TextField label="Shareholder Name" fullWidth size="small" sx={{ mb: 2 }} value={formData.name || ''} onChange={(e) => set('name', e.target.value)} />
                    <TextField label="Shareholder Email" type="email" fullWidth size="small" sx={{ mb: 2 }} value={formData.email || ''} onChange={(e) => set('email', e.target.value)} />
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Holder Type</InputLabel>
                        <Select value={formData.holderType || 'Individual'} label="Holder Type" onChange={(e) => set('holderType', e.target.value)}>
                            <MenuItem value="Individual">Individual</MenuItem>
                            <MenuItem value="Legal Entity">Legal Entity</MenuItem>
                        </Select>
                    </FormControl>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Share Class</InputLabel>
                        <Select value={formData.sharesClass || ''} label="Share Class" onChange={(e) => set('sharesClass', e.target.value)}>
                            {shareClassOptions.map((n: string) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <TextField label="Number of Shares" type="number" inputProps={{ min: 1, step: 1 }} fullWidth size="small" sx={{ mb: 2 }} value={formData.numberOfShares || ''} onChange={(e) => set('numberOfShares', Number(e.target.value))} />
                    <TextField label="Consideration Paid ($)" type="number" fullWidth size="small" sx={{ mb: 2 }} value={formData.considerationPaid || ''} onChange={(e) => set('considerationPaid', Number(e.target.value))} />
                    <TextField label="Address" fullWidth size="small" sx={{ mb: 2 }} value={formData.address || ''} onChange={(e) => set('address', e.target.value)} />
                    <TextField label="Voting %" type="number" fullWidth size="small" sx={{ mb: 2 }} value={formData.votingPercent || ''} onChange={(e) => set('votingPercent', Number(e.target.value))} />
                </>;

            case 'shares_transferred':
                return <>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>From Shareholder</InputLabel>
                        <Select value={formData.fromName || ''} label="From Shareholder" onChange={(e) => set('fromName', e.target.value)}>
                            {shareholderOptions.map((s: any) => <MenuItem key={s.name + s.sharesClass} value={s.name}>{s.name} ({s.sharesClass})</MenuItem>)}
                        </Select>
                    </FormControl>
                    <TextField label="To Shareholder Name" fullWidth size="small" sx={{ mb: 2 }} value={formData.toName || ''} onChange={(e) => set('toName', e.target.value)} />
                    <TextField label="To Shareholder Email" type="email" fullWidth size="small" sx={{ mb: 2 }} value={formData.toEmail || ''} onChange={(e) => set('toEmail', e.target.value)} />
                    <TextField label="To Shareholder Address" fullWidth size="small" sx={{ mb: 2 }} value={formData.toAddress || ''} onChange={(e) => set('toAddress', e.target.value)} />
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Share Class</InputLabel>
                        <Select value={formData.sharesClass || ''} label="Share Class" onChange={(e) => set('sharesClass', e.target.value)}>
                            {shareClassOptions.map((n: string) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <TextField label="Number of Shares" type="number" inputProps={{ min: 1, step: 1 }} fullWidth size="small" sx={{ mb: 2 }} value={formData.numberOfShares || ''} onChange={(e) => set('numberOfShares', Number(e.target.value))} />
                    <TextField label="Consideration ($)" type="number" fullWidth size="small" sx={{ mb: 2 }} value={formData.consideration || ''} onChange={(e) => set('consideration', Number(e.target.value))} />
                    <TextField label="Certificate No. Surrendered" type="number" fullWidth size="small" sx={{ mb: 2 }} placeholder="Optional" value={formData.certificateNumberSurrendered || ''} onChange={(e) => set('certificateNumberSurrendered', Number(e.target.value))} />
                    <TextField label="Certificate No. Issued" type="number" fullWidth size="small" sx={{ mb: 2 }} placeholder="Optional — leave blank to auto-assign" value={formData.certificateNumberIssued || ''} onChange={(e) => set('certificateNumberIssued', Number(e.target.value))} />
                </>;

            case 'shares_cancelled':
                return <>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Shareholder</InputLabel>
                        <Select value={formData.holderName || ''} label="Shareholder" onChange={(e) => set('holderName', e.target.value)}>
                            {shareholderOptions.map((s: any) => <MenuItem key={s.name + s.sharesClass} value={s.name}>{s.name}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Share Class</InputLabel>
                        <Select value={formData.sharesClass || ''} label="Share Class" onChange={(e) => set('sharesClass', e.target.value)}>
                            {shareClassOptions.map((n: string) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <TextField label="Number of Shares to Cancel" type="number" inputProps={{ min: 1, step: 1 }} fullWidth size="small" sx={{ mb: 2 }} value={formData.numberOfShares || ''} onChange={(e) => set('numberOfShares', Number(e.target.value))} />
                    <TextField label="Certificate Number" type="number" fullWidth size="small" sx={{ mb: 2 }} placeholder="Optional" value={formData.certificateNumber || ''} onChange={(e) => set('certificateNumber', Number(e.target.value))} />
                </>;

            case 'officer_appointed':
                return <>
                    <TextField label="Name" fullWidth size="small" sx={{ mb: 2 }} value={formData.name || ''} onChange={(e) => set('name', e.target.value)} />
                    <TextField label="Email" type="email" fullWidth size="small" sx={{ mb: 2 }} value={formData.email || ''} onChange={(e) => set('email', e.target.value)} />
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Title</InputLabel>
                        <Select value={formData.title || 'President'} label="Title" onChange={(e) => set('title', e.target.value)}>
                            {OFFICER_TITLES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                        </Select>
                    </FormControl>
                </>;

            case 'officer_resigned':
                return <>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Officer</InputLabel>
                        <Select value={formData.officerName || ''} label="Officer" onChange={(e) => set('officerName', e.target.value)}>
                            {officerOptions.map((o: any) => <MenuItem key={o.name} value={o.name}>{o.name} — {o.title}</MenuItem>)}
                        </Select>
                    </FormControl>
                </>;

            case 'share_class_added':
                return <>
                    <TextField label="Class Name (e.g. Class B Preferred)" fullWidth size="small" sx={{ mb: 2 }} value={formData.name || ''} onChange={(e) => set('name', e.target.value)} />
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Type</InputLabel>
                        <Select value={formData.type || 'Common'} label="Type" onChange={(e) => set('type', e.target.value)}>
                            <MenuItem value="Common">Common</MenuItem>
                            <MenuItem value="Preferred">Preferred</MenuItem>
                        </Select>
                    </FormControl>
                    <FormControlLabel control={<Switch checked={formData.voting ?? true} onChange={(e) => set('voting', e.target.checked)} />} label="Voting" sx={{ mb: 2, display: 'flex' }} />
                    <TextField label="Max Authorized (blank = unlimited)" type="number" fullWidth size="small" sx={{ mb: 2 }} value={formData.maxAuthorized || ''} onChange={(e) => set('maxAuthorized', e.target.value ? Number(e.target.value) : null)} />
                    <TextField label="Par Value (blank = no par)" type="number" fullWidth size="small" sx={{ mb: 2 }} value={formData.parValue || ''} onChange={(e) => set('parValue', e.target.value ? Number(e.target.value) : null)} />
                </>;

            case 'annual_return_filed':
                return <>
                    <TextField label="Year" type="number" fullWidth size="small" sx={{ mb: 2 }} value={formData.year || new Date().getFullYear()} onChange={(e) => set('year', Number(e.target.value))} />
                    <TextField label="Registry Confirmation Number" fullWidth size="small" sx={{ mb: 2 }} placeholder="From your registry (e.g. Corporations Canada, OBR, BC Registries)" value={formData.confirmationNumber || ''} onChange={(e) => set('confirmationNumber', e.target.value)} />
                    <TextField label="T2 Reference (optional)" fullWidth size="small" sx={{ mb: 2 }} placeholder="Link to the CRA T2 corporate tax return for the same fiscal year — for CPA audit trails" value={formData.t2Reference || ''} onChange={(e) => set('t2Reference', e.target.value)} />
                </>;

            case 'fiscal_year_end_changed':
                return <>
                    <TextField label="New Fiscal Year End (MM-DD)" fullWidth size="small" sx={{ mb: 2 }} placeholder="e.g. 12-31" value={formData.newFiscalYearEnd || ''} onChange={(e) => set('newFiscalYearEnd', e.target.value)} />
                </>;

            case 'name_changed':
                return <>
                    <TextField label="New Legal Name" fullWidth size="small" sx={{ mb: 2 }} value={formData.newName || ''} onChange={(e) => set('newName', e.target.value)} />
                </>;

            case 'signing_authority_granted':
                return <>
                    <TextField label="Signing Officer Name" fullWidth size="small" sx={{ mb: 2 }} value={formData.signingOfficerName || ''} onChange={(e) => set('signingOfficerName', e.target.value)} />
                    <TextField label="Title / Role" fullWidth size="small" sx={{ mb: 2 }} placeholder="e.g. President, CFO, Attorney-in-Fact" value={formData.title || ''} onChange={(e) => set('title', e.target.value)} />
                    <TextField label="Scope of Authority" fullWidth size="small" sx={{ mb: 2 }} placeholder="e.g. general banking, contracts up to $100k, single-signature payroll" value={formData.scope || ''} onChange={(e) => set('scope', e.target.value)} />
                    <TextField label="Limits (optional)" fullWidth size="small" sx={{ mb: 2 }} placeholder="e.g. Two signatures required over $50,000" value={formData.limits || ''} onChange={(e) => set('limits', e.target.value)} />
                </>;

            case 'signing_authority_revoked':
                return <>
                    <TextField label="Signing Officer Name" fullWidth size="small" sx={{ mb: 2 }} value={formData.signingOfficerName || ''} onChange={(e) => set('signingOfficerName', e.target.value)} />
                    <TextField label="Reason (optional)" fullWidth size="small" sx={{ mb: 2 }} placeholder="e.g. Resigned, retired, replaced" value={formData.reason || ''} onChange={(e) => set('reason', e.target.value)} />
                </>;

            case 'dividend_declared':
                return <>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Share Class</InputLabel>
                        <Select value={formData.shareClass || ''} label="Share Class" onChange={(e) => set('shareClass', e.target.value)}>
                            {shareClassOptions.map((n: string) => <MenuItem key={n} value={n}>{n}</MenuItem>)}
                        </Select>
                    </FormControl>
                    <FormControl fullWidth size="small" sx={{ mb: 2 }}>
                        <InputLabel>Dividend Type</InputLabel>
                        <Select value={formData.dividendType || 'Eligible'} label="Dividend Type" onChange={(e) => set('dividendType', e.target.value)}>
                            <MenuItem value="Eligible">Eligible</MenuItem>
                            <MenuItem value="Non-Eligible">Non-Eligible</MenuItem>
                            <MenuItem value="Capital">Capital Dividend</MenuItem>
                        </Select>
                    </FormControl>
                    <TextField label="Per-Share Amount ($ CAD)" type="number" inputProps={{ step: '0.01' }} fullWidth size="small" sx={{ mb: 2 }} value={formData.perShareAmount ?? ''} onChange={(e) => set('perShareAmount', e.target.value === '' ? null : Number(e.target.value))} />
                    <TextField label="Total Dividend ($ CAD)" type="number" inputProps={{ step: '0.01' }} fullWidth size="small" sx={{ mb: 2 }} placeholder="Optional — computed if per-share and holdings known" value={formData.totalAmount ?? ''} onChange={(e) => set('totalAmount', e.target.value === '' ? null : Number(e.target.value))} />
                    <TextField label="Record Date" type="date" fullWidth size="small" sx={{ mb: 2 }} InputLabelProps={{ shrink: true }} value={formData.recordDate || ''} onChange={(e) => set('recordDate', e.target.value)} />
                    <TextField label="Payment Date" type="date" fullWidth size="small" sx={{ mb: 2 }} InputLabelProps={{ shrink: true }} value={formData.paymentDate || ''} onChange={(e) => set('paymentDate', e.target.value)} />
                    <TextField label="Fiscal Year" type="number" fullWidth size="small" sx={{ mb: 2 }} value={formData.fiscalYear || new Date().getFullYear()} onChange={(e) => set('fiscalYear', Number(e.target.value))} />
                    <TextField label="T5 Reference (optional)" fullWidth size="small" sx={{ mb: 2 }} placeholder="Add later once T5 slips are filed with CRA" value={formData.t5Reference || ''} onChange={(e) => set('t5Reference', e.target.value)} />
                </>;

            default:
                return null;
        }
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle>Record Corporate Event</DialogTitle>
            <DialogContent>
                <Box pt={1}>
                    <FormControl fullWidth size="small" sx={{ mb: 2.5 }}>
                        <InputLabel>Event Type</InputLabel>
                        <Select
                            value={eventType}
                            label="Event Type"
                            onChange={(e) => handleChangeEventType(e.target.value as EventType)}
                        >
                            {(Object.keys(EVENT_LABELS) as EventType[]).map((k) => (
                                <MenuItem key={k} value={k}>{EVENT_LABELS[k]}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <TextField
                        label="Effective Date"
                        type="date"
                        fullWidth
                        size="small"
                        sx={{ mb: 2.5 }}
                        InputLabelProps={{ shrink: true }}
                        value={effectiveDate}
                        onChange={(e) => setEffectiveDate(e.target.value)}
                    />

                    <Divider sx={{ mb: 2.5 }} />

                    {renderForm()}

                    <TextField
                        label="Notes (optional)"
                        fullWidth
                        size="small"
                        multiline
                        rows={2}
                        sx={{ mt: 1 }}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                    />

                    {(RESOLUTION_EVENT_TYPES.has(eventType) || REGISTRY_ATTACH_EVENT_TYPES.has(eventType)) && (
                        <Box mt={2.5}>
                            <Divider sx={{ mb: 2, borderStyle: 'dashed' }} />
                            <Typography variant="caption" fontWeight={600} color="text.secondary" display="block" mb={1.5} textTransform="uppercase" letterSpacing={0.5}>
                                Attach Documents — optional
                            </Typography>

                            {RESOLUTION_EVENT_TYPES.has(eventType) && (
                                <Box mb={1.5}>
                                    <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                        Signed Resolution
                                    </Typography>
                                    <Button
                                        variant="outlined"
                                        component="label"
                                        size="small"
                                        startIcon={<AttachFileIcon sx={{ fontSize: 14 }} />}
                                        color={inlineResolutionFile ? 'success' : 'inherit'}
                                        fullWidth
                                        sx={{ justifyContent: 'flex-start', fontSize: 12, textTransform: 'none', borderStyle: inlineResolutionFile ? 'solid' : 'dashed' }}
                                    >
                                        {inlineResolutionFile ? inlineResolutionFile.name : 'Attach signed resolution (PDF or image)'}
                                        <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                            onChange={(e) => setInlineResolutionFile(e.target.files?.[0] ?? null)} />
                                    </Button>
                                </Box>
                            )}

                            {REGISTRY_ATTACH_EVENT_TYPES.has(eventType) && (
                                <Box>
                                    <Typography variant="caption" color="text.secondary" display="block" mb={0.5}>
                                        {eventType === 'annual_return_filed' ? 'Annual Return Filing Document' : 'Registry Filing Confirmation'}
                                    </Typography>
                                    <Button
                                        variant="outlined"
                                        component="label"
                                        size="small"
                                        startIcon={<AttachFileIcon sx={{ fontSize: 14 }} />}
                                        color={inlineRegistryFile ? 'success' : 'inherit'}
                                        fullWidth
                                        sx={{ justifyContent: 'flex-start', fontSize: 12, textTransform: 'none', borderStyle: inlineRegistryFile ? 'solid' : 'dashed' }}
                                    >
                                        {inlineRegistryFile
                                            ? inlineRegistryFile.name
                                            : eventType === 'annual_return_filed'
                                            ? 'Attach filed annual return document (PDF or image)'
                                            : 'Attach registry filing confirmation (PDF or image)'}
                                        <input type="file" hidden accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"
                                            onChange={(e) => setInlineRegistryFile(e.target.files?.[0] ?? null)} />
                                    </Button>
                                </Box>
                            )}
                        </Box>
                    )}

                    {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={handleClose} disabled={saving}>Cancel</Button>
                <Button variant="contained" onClick={handleSubmit} disabled={saving}>
                    {saving ? <CircularProgress size={18} /> : 'Save Event'}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default RecordEventDialog;
