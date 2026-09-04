import React, { useEffect, useState } from 'react';
import {
    Box, Typography, Paper, Button, Switch, FormControlLabel, Divider, TextField,
    Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Alert, Link, CircularProgress,
} from '@mui/material';
import { useDispatch } from 'react-redux';
import { useNavigate, Link as RouterLink } from 'react-router-dom';
import api from '../utils/api';
import { logout } from '../store/authSlice';
import { useSnackbar } from '../context/SnackbarContext';

interface Profile {
    _id: string;
    name: string;
    email: string;
    role: string;
    reminderOptOut: boolean;
    createdAt?: string;
}

/**
 * Account page — the self-service half of the privacy policy.
 *
 *   - Reminder emails: in-app CASL opt-out / opt-in. The emailed unsubscribe
 *     link only turns reminders off; this is where they come back on.
 *   - Delete account: permanent erasure of everything the user owns. Gated
 *     by retyping the account email, and the backend checks it again.
 */
const AccountPage: React.FC = () => {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { showSnackbar } = useSnackbar();

    const [profile, setProfile] = useState<Profile | null>(null);
    const [loadError, setLoadError] = useState(false);
    const [savingPrefs, setSavingPrefs] = useState(false);

    const [deleteOpen, setDeleteOpen] = useState(false);
    const [confirmEmail, setConfirmEmail] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        api.get('/auth/me')
            .then(({ data }) => { if (!cancelled) setProfile(data); })
            .catch(() => {
                if (cancelled) return;
                setLoadError(true);
                showSnackbar('Could not load your account details.', 'error');
            });
        return () => { cancelled = true; };
    }, [showSnackbar]);

    const toggleReminders = async (remindersOn: boolean) => {
        if (!profile) return;
        setSavingPrefs(true);
        try {
            const { data } = await api.patch('/auth/preferences', { reminderOptOut: !remindersOn });
            setProfile({ ...profile, reminderOptOut: data.reminderOptOut });
            showSnackbar(remindersOn ? 'Reminder emails turned on.' : 'Reminder emails turned off.', 'success');
        } catch {
            showSnackbar('Could not save your preference. Please try again.', 'error');
        } finally {
            setSavingPrefs(false);
        }
    };

    const closeDelete = () => {
        if (deleting) return;
        setDeleteOpen(false);
        setConfirmEmail('');
        setDeleteError(null);
    };

    const emailMatches = !!profile && confirmEmail.trim().toLowerCase() === profile.email.toLowerCase();

    const confirmDelete = async () => {
        if (!emailMatches) return;
        setDeleting(true);
        setDeleteError(null);
        try {
            await api.delete('/auth/account', { data: { confirmEmail: confirmEmail.trim() } });
            dispatch(logout());
            navigate('/');
            showSnackbar('Your account and all of its records have been deleted.', 'success');
        } catch (err: any) {
            setDeleteError(err?.response?.data?.error || 'Deletion failed. Nothing was removed — please try again.');
            setDeleting(false);
        }
    };

    const memberSince = profile?.createdAt
        ? new Date(profile.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
        : null;

    return (
        <Box sx={{ p: 3, bgcolor: '#f5f6fa', minHeight: '100vh' }}>
            <Box mb={2.5}>
                <Typography variant="h5" fontWeight={700} lineHeight={1.2}>Account</Typography>
                <Typography variant="body2" color="text.secondary" mt={0.3}>
                    Your sign-in details, email preferences, and data controls
                </Typography>
            </Box>

            {loadError && (
                <Alert severity="error" sx={{ mb: 2.5 }}>
                    Your account details could not be loaded. Refresh the page to try again.
                </Alert>
            )}

            <Box sx={{ maxWidth: 720 }}>
                {/* Profile */}
                <Paper elevation={0} sx={{ p: 2.5, mb: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white' }}>
                    <Typography variant="subtitle1" fontWeight={700} mb={1.5}>Profile</Typography>
                    {!profile && !loadError ? (
                        <Box display="flex" alignItems="center" gap={1.5} py={1}>
                            <CircularProgress size={18} />
                            <Typography variant="body2" color="text.secondary">Loading…</Typography>
                        </Box>
                    ) : profile && (
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, rowGap: 1, columnGap: 2 }}>
                            <Typography variant="body2" color="text.secondary">Email</Typography>
                            <Typography variant="body2" fontWeight={600}>{profile.email}</Typography>
                            <Typography variant="body2" color="text.secondary">Name</Typography>
                            <Typography variant="body2">{profile.name || '—'}</Typography>
                            {memberSince && (
                                <>
                                    <Typography variant="body2" color="text.secondary">Member since</Typography>
                                    <Typography variant="body2">{memberSince}</Typography>
                                </>
                            )}
                        </Box>
                    )}
                    <Typography variant="caption" color="text.secondary" display="block" mt={2}>
                        You sign in with a one-time code sent to this email. There is no password to manage.
                    </Typography>
                </Paper>

                {/* Email preferences */}
                <Paper elevation={0} sx={{ p: 2.5, mb: 2.5, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white' }}>
                    <Typography variant="subtitle1" fontWeight={700} mb={0.5}>Email preferences</Typography>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={!!profile && !profile.reminderOptOut}
                                disabled={!profile || savingPrefs}
                                onChange={(e) => toggleReminders(e.target.checked)}
                            />
                        }
                        label={
                            <Box>
                                <Typography variant="body2" fontWeight={600}>Filing-deadline reminders</Typography>
                                <Typography variant="caption" color="text.secondary">
                                    An email about 30 days before each company&apos;s fiscal year-end and annual-return due date.
                                </Typography>
                            </Box>
                        }
                        sx={{ alignItems: 'flex-start', ml: 0, mt: 1, '& .MuiSwitch-root': { mt: -0.5 } }}
                    />
                    <Typography variant="caption" color="text.secondary" display="block" mt={1.5}>
                        Sign-in codes, share invitations, and documents you request are always sent — they are part of
                        using the service, not marketing.
                    </Typography>
                </Paper>

                {/* Danger zone */}
                <Paper elevation={0} sx={{ p: 2.5, border: '1px solid #ef9a9a', borderRadius: 2, bgcolor: 'white' }}>
                    <Typography variant="subtitle1" fontWeight={700} color="#c62828" mb={0.5}>Delete account</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6 }}>
                        Permanently erases your account and every company in it — recorded events, uploaded documents,
                        generated-document history, and share links. This cannot be undone, and a minute book is a record
                        your corporation is legally required to keep, so{' '}
                        <Link component={RouterLink} to="/documents" underline="hover">download your compiled minute books</Link>
                        {' '}first.
                    </Typography>
                    <Divider sx={{ my: 2 }} />
                    <Button
                        variant="outlined"
                        color="error"
                        disabled={!profile}
                        onClick={() => setDeleteOpen(true)}
                        sx={{ textTransform: 'none', fontWeight: 600 }}
                    >
                        Delete my account…
                    </Button>
                    <Typography variant="caption" color="text.secondary" display="block" mt={1.5}>
                        How we handle your data is described in the{' '}
                        <Link component={RouterLink} to="/privacy" underline="hover">privacy policy</Link>.
                    </Typography>
                </Paper>
            </Box>

            <Dialog open={deleteOpen} onClose={closeDelete} maxWidth="sm" fullWidth>
                <DialogTitle>Delete your account?</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        This permanently deletes <strong>{profile?.email}</strong> and all of its corporate records.
                        Type your email address to confirm.
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        size="small"
                        label="Your email"
                        placeholder={profile?.email}
                        value={confirmEmail}
                        onChange={(e) => setConfirmEmail(e.target.value)}
                        disabled={deleting}
                        inputProps={{ autoComplete: 'off', spellCheck: false }}
                    />
                    {deleteError && <Alert severity="error" sx={{ mt: 2 }}>{deleteError}</Alert>}
                </DialogContent>
                <DialogActions sx={{ px: 3, pb: 2 }}>
                    <Button onClick={closeDelete} disabled={deleting}>Cancel</Button>
                    <Button
                        onClick={confirmDelete}
                        color="error"
                        variant="contained"
                        disabled={!emailMatches || deleting}
                        startIcon={deleting ? <CircularProgress size={14} color="inherit" /> : undefined}
                    >
                        {deleting ? 'Deleting…' : 'Delete everything'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default AccountPage;
