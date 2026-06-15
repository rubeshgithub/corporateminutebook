import React, { useState } from 'react';
import { Box, Button, TextField, Typography, Paper, Alert, CircularProgress } from '@mui/material';
import { useDispatch } from 'react-redux';
import { loginSuccess } from '../store/authSlice';
import { useNavigate } from 'react-router-dom';
import api from '../utils/api';

type Step = 'email' | 'otp';

const Login: React.FC = () => {
    const [step, setStep] = useState<Step>('email');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const handleRequestOtp = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setError('');
        setLoading(true);
        try {
            await api.post('/auth/request-otp', { email });
            setInfo(`A 6-digit code was sent to ${email}`);
            setStep('otp');
        } catch (err: any) {
            setError(err?.response?.data?.error || 'Failed to send code. Try again.');
        } finally {
            setLoading(false);
        }
    };

    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await api.post('/auth/verify-otp', { email, code });
            dispatch(loginSuccess(res.data));
            navigate('/dashboard');
        } catch (err: any) {
            setError(err?.response?.data?.error || 'Invalid code. Try again.');
        } finally {
            setLoading(false);
        }
    };

    const resetToEmail = () => {
        setStep('email');
        setCode('');
        setError('');
        setInfo('');
    };

    return (
        <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
            <Paper elevation={3} sx={{ padding: 4, width: '100%', maxWidth: 400 }}>
                <Typography variant="h5" align="center" gutterBottom>
                    Sign in to MinuteBook
                </Typography>
                <Typography variant="body2" align="center" color="text.secondary" sx={{ mb: 2 }}>
                    {step === 'email'
                        ? 'Enter your email — we\'ll send you a sign-in code.'
                        : `Enter the code sent to ${email}`}
                </Typography>

                {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}
                {info && <Alert severity="success" sx={{ mb: 2 }}>{info}</Alert>}

                {step === 'email' ? (
                    <form onSubmit={handleRequestOtp}>
                        <TextField
                            fullWidth
                            label="Email address"
                            type="email"
                            margin="normal"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoFocus
                            required
                        />
                        <Button
                            fullWidth
                            variant="contained"
                            color="primary"
                            type="submit"
                            sx={{ mt: 2 }}
                            disabled={loading}
                        >
                            {loading ? <CircularProgress size={22} color="inherit" /> : 'Send Code'}
                        </Button>
                    </form>
                ) : (
                    <form onSubmit={handleVerifyOtp}>
                        <TextField
                            fullWidth
                            label="6-digit code"
                            margin="normal"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            inputProps={{ maxLength: 6, inputMode: 'numeric', pattern: '[0-9]*' }}
                            autoFocus
                            required
                        />
                        <Button
                            fullWidth
                            variant="contained"
                            color="primary"
                            type="submit"
                            sx={{ mt: 2 }}
                            disabled={loading}
                        >
                            {loading ? <CircularProgress size={22} color="inherit" /> : 'Verify & Sign In'}
                        </Button>
                        <Button
                            fullWidth
                            variant="text"
                            onClick={() => handleRequestOtp()}
                            sx={{ mt: 1 }}
                            disabled={loading}
                        >
                            Resend code
                        </Button>
                        <Button
                            fullWidth
                            variant="text"
                            onClick={resetToEmail}
                            sx={{ mt: 0.5 }}
                        >
                            Use a different email
                        </Button>
                    </form>
                )}
            </Paper>
        </Box>
    );
};

export default Login;
