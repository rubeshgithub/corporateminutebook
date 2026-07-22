import React, { useEffect, useState } from 'react';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
    DialogTitle, Divider, FormControl, IconButton, InputLabel, MenuItem, Select,
    Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LinkIcon from '@mui/icons-material/Link';
import MailIcon from '@mui/icons-material/Mail';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import api from '../utils/api';
import { useSnackbar } from '../context/SnackbarContext';

interface ShareRecord {
    id:            string;
    token:         string;
    url:           string;
    label?:        string;
    invitedEmail?: string;
    expiresAt:     string;
    revokedAt?:    string | null;
    lastAccessedAt?: string | null;
    accessCount:   number;
    createdAt:     string;
    status:        'active' | 'expired' | 'revoked';
}

interface Props {
    open: boolean;
    onClose: () => void;
    companyId: string;
    companyName: string;
}

/**
 * Share dialog: create + manage read-only links for a company. Two paths in
 * one form — leave the email blank to get a copyable public link, or fill
 * it in to email the link to a CPA / lawyer / partner. Same token type
 * either way; the email is just a delivery mechanism.
 */
const ShareDialog: React.FC<Props> = ({ open, onClose, companyId, companyName }) => {
    const { showSnackbar } = useSnackbar();
    const [shares, setShares] = useState<ShareRecord[]>([]);
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [label, setLabel] = useState('');
    const [invitedEmail, setInvitedEmail] = useState('');
    const [expiresInDays, setExpiresInDays] = useState<number>(7);
    const [error, setError] = useState('');

    const load = async () => {
        setLoading(true);
        try {
            const res = await api.get(`/companies/${companyId}/shares`);
            setShares(res.data);
        } catch {
            setError('Failed to load existing shares.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { if (open) load(); }, [open, companyId]);   // eslint-disable-line react-hooks/exhaustive-deps

    const handleCreate = async () => {
        setError('');
        setCreating(true);
        try {
            const body: any = { expiresInDays };
            if (label.trim())        body.label = label.trim();
            if (invitedEmail.trim()) body.invitedEmail = invitedEmail.trim();
            const res = await api.post(`/companies/${companyId}/shares`, body);
            setShares((prev) => [{ ...res.data, status: 'active', accessCount: 0 }, ...prev]);
            setLabel('');
            setInvitedEmail('');
            if (res.data.invitedEmail) {
                showSnackbar(`Share link sent to ${res.data.invitedEmail}.`, 'success');
            } else {
                showSnackbar('Share link created — copy it from the list below.', 'success');
            }
        } catch (e: any) {
            setError(e?.response?.data?.error || 'Failed to create share link.');
        } finally {
            setCreating(false);
        }
    };

    const handleCopy = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            showSnackbar('Copied to clipboard.', 'success');
        } catch {
            showSnackbar('Copy failed — select and copy manually.', 'error');
        }
    };

    const handleRevoke = async (id: string) => {
        try {
            await api.delete(`/shares/${id}`);
            setShares((prev) => prev.map((s) => s.id === id ? { ...s, status: 'revoked' as const, revokedAt: new Date().toISOString() } : s));
            showSnackbar('Share revoked.', 'success');
        } catch {
            showSnackbar('Failed to revoke.', 'error');
        }
    };

    const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>
                Share {companyName}
                <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.25 }}>
                    Read-only access. The recipient can view records + download the minute book, but not edit anything.
                </Typography>
            </DialogTitle>
            <DialogContent dividers>
                {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

                <Box sx={{ p: 2, bgcolor: '#fafafa', borderRadius: 1, border: '1px solid', borderColor: 'divider', mb: 2 }}>
                    <Typography variant="subtitle2" fontWeight={700} mb={1.5}>Create a share link</Typography>
                    <TextField
                        label="Label (optional)"
                        placeholder="e.g. For Acme Bank, or CPA year-end review"
                        fullWidth
                        size="small"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        sx={{ mb: 1.5 }}
                    />
                    <TextField
                        label="Email (leave blank for a copyable link)"
                        placeholder="cpa@example.com"
                        type="email"
                        fullWidth
                        size="small"
                        value={invitedEmail}
                        onChange={(e) => setInvitedEmail(e.target.value)}
                        sx={{ mb: 1.5 }}
                        helperText="If filled, we'll email the link with a brief invitation. Otherwise, copy the URL from the list below."
                    />
                    <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
                        <InputLabel>Expires</InputLabel>
                        <Select value={expiresInDays} label="Expires" onChange={(e) => setExpiresInDays(Number(e.target.value))}>
                            <MenuItem value={1}>In 1 day</MenuItem>
                            <MenuItem value={7}>In 7 days</MenuItem>
                            <MenuItem value={14}>In 14 days</MenuItem>
                            <MenuItem value={30}>In 30 days</MenuItem>
                            <MenuItem value={90}>In 90 days</MenuItem>
                        </Select>
                    </FormControl>
                    <Button
                        variant="contained"
                        fullWidth
                        onClick={handleCreate}
                        disabled={creating}
                        startIcon={creating ? <CircularProgress size={16} /> : (invitedEmail ? <MailIcon /> : <LinkIcon />)}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                    >
                        {creating ? 'Creating…' : (invitedEmail ? 'Create link + send email' : 'Create link')}
                    </Button>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Typography variant="subtitle2" fontWeight={700} mb={1}>Existing shares</Typography>
                {loading ? (
                    <Box display="flex" justifyContent="center" py={2}><CircularProgress size={20} /></Box>
                ) : shares.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">No shares yet.</Typography>
                ) : (
                    <Stack spacing={1}>
                        {shares.map((s) => (
                            <Box
                                key={s.id}
                                sx={{
                                    p: 1.25, borderRadius: 1, border: '1px solid',
                                    borderColor: s.status === 'active' ? 'divider' : '#f5f5f5',
                                    bgcolor:     s.status === 'active' ? 'white' : '#fafafa',
                                    opacity:     s.status === 'active' ? 1 : 0.65,
                                }}
                            >
                                <Box display="flex" alignItems="center" gap={1} flexWrap="wrap" mb={0.5}>
                                    {s.invitedEmail
                                        ? <Chip icon={<MailIcon sx={{ fontSize: 12 }} />} label={s.invitedEmail} size="small" sx={{ height: 20, fontSize: 10.5, fontWeight: 600, bgcolor: '#e8eaf6', color: '#3949ab' }} />
                                        : <Chip icon={<LinkIcon sx={{ fontSize: 12 }} />} label="Public link" size="small" sx={{ height: 20, fontSize: 10.5, fontWeight: 600, bgcolor: '#f1f8e9', color: '#33691e' }} />
                                    }
                                    {s.label && <Chip label={s.label} size="small" sx={{ height: 20, fontSize: 10, bgcolor: '#f5f5f5' }} />}
                                    <Chip
                                        label={s.status === 'active' ? `Expires ${fmtDate(s.expiresAt)}` : s.status === 'expired' ? 'Expired' : 'Revoked'}
                                        size="small"
                                        sx={{
                                            height: 20, fontSize: 10, ml: 'auto',
                                            bgcolor: s.status === 'active' ? 'transparent' : '#eeeeee',
                                            color:   s.status === 'active' ? 'text.secondary' : 'text.disabled',
                                            border:  s.status === 'active' ? '1px solid' : 'none',
                                            borderColor: 'divider',
                                        }}
                                    />
                                </Box>
                                {s.status === 'active' && (
                                    <Box display="flex" alignItems="center" gap={0.5}>
                                        <TextField
                                            value={s.url}
                                            size="small"
                                            InputProps={{ readOnly: true, sx: { fontSize: 11, fontFamily: 'monospace', bgcolor: '#fafafa' } }}
                                            fullWidth
                                        />
                                        <Tooltip title="Copy URL">
                                            <IconButton size="small" onClick={() => handleCopy(s.url)}>
                                                <ContentCopyIcon sx={{ fontSize: 15 }} />
                                            </IconButton>
                                        </Tooltip>
                                        <Tooltip title="Revoke">
                                            <IconButton size="small" onClick={() => handleRevoke(s.id)} sx={{ '&:hover': { color: 'error.main' } }}>
                                                <DeleteOutlineIcon sx={{ fontSize: 15 }} />
                                            </IconButton>
                                        </Tooltip>
                                    </Box>
                                )}
                                {(s.accessCount > 0 || s.lastAccessedAt) && (
                                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10, mt: 0.4, display: 'block' }}>
                                        {s.accessCount} view{s.accessCount === 1 ? '' : 's'}
                                        {s.lastAccessedAt ? ` · last ${new Date(s.lastAccessedAt).toLocaleString('en-CA')}` : ''}
                                    </Typography>
                                )}
                            </Box>
                        ))}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Close</Button>
            </DialogActions>
        </Dialog>
    );
};

export default ShareDialog;
