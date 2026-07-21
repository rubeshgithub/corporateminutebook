import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { loginSuccess } from '../store/authSlice';
import api from '../utils/api';

const SECTION_LABEL: React.CSSProperties = {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#C8952A',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
};

type Props = {
    size?: 'hero' | 'compact';
    eyebrow?: string;
    heading?: string;
    subheading?: string;
};

const OtpForm: React.FC<Props> = ({
    size = 'hero',
    eyebrow = 'Start in 30 seconds',
    heading = 'Get your minute book started',
    subheading = 'Enter your email — we\'ll send a one-time code. No passwords.',
}) => {
    const [step, setStep] = useState<'email' | 'otp'>('email');
    const [email, setEmail] = useState('');
    const [code, setCode] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [info, setInfo] = useState('');
    const dispatch = useDispatch();
    const navigate = useNavigate();

    const requestCode = async (e?: React.FormEvent) => {
        e?.preventDefault();
        setError('');
        setLoading(true);
        try {
            await api.post('/auth/request-otp', { email });
            setInfo(`Code sent to ${email}. Check your inbox.`);
            setStep('otp');
        } catch (err: any) {
            setError(err?.response?.data?.error || 'Failed to send code. Try again.');
        } finally {
            setLoading(false);
        }
    };

    const verifyCode = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const res = await api.post('/auth/verify-otp', { email, code });
            // Backend now sets the httpOnly cookie in the Set-Cookie header
            // — response body only carries public user metadata. Strip any
            // extra one-time flags (justClaimed) so they don't get cached
            // in localStorage across sessions.
            const { _id, name, email: userEmail, role } = res.data;
            dispatch(loginSuccess({ _id, name, email: userEmail, role }));
            navigate('/dashboard');
        } catch (err: any) {
            setError(err?.response?.data?.error || 'Invalid code. Try again.');
        } finally {
            setLoading(false);
        }
    };

    const inputBase: React.CSSProperties = {
        width: '100%',
        padding: size === 'hero' ? '0.875rem 1rem' : '0.7rem 0.85rem',
        fontSize: size === 'hero' ? '1rem' : '0.9rem',
        borderRadius: '0.5rem',
        border: '1.5px solid #cbd5e1',
        outline: 'none',
        boxSizing: 'border-box',
        fontFamily: 'inherit',
    };

    const btn: React.CSSProperties = {
        width: '100%',
        padding: size === 'hero' ? '0.875rem 1rem' : '0.7rem 0.85rem',
        fontSize: size === 'hero' ? '1rem' : '0.9rem',
        borderRadius: '0.5rem',
        background: '#0C3D61',
        color: '#fff',
        border: 'none',
        fontWeight: 700,
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.7 : 1,
    };

    return (
        <div
            style={{
                background: '#fff',
                border: '1px solid #e5e7eb',
                borderRadius: '0.875rem',
                padding: size === 'hero' ? '1.5rem' : '1.25rem',
                boxShadow: '0 8px 24px -8px rgba(12, 61, 97, 0.18)',
            }}
        >
            <div style={{ ...SECTION_LABEL, marginBottom: '0.5rem' }}>{eyebrow}</div>
            <div
                style={{
                    fontFamily: 'Georgia, serif',
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    color: '#0C3D61',
                    marginBottom: '0.5rem',
                }}
            >
                {step === 'email' ? heading : 'Check your email'}
            </div>
            <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '1.125rem', lineHeight: 1.5 }}>
                {step === 'email' ? subheading : `We sent a 6-digit code to ${email}.`}
            </p>

            {error && (
                <div
                    role="alert"
                    style={{
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#991b1b',
                        padding: '0.6rem 0.85rem',
                        borderRadius: '0.5rem',
                        fontSize: '0.85rem',
                        marginBottom: '0.75rem',
                    }}
                >
                    {error}
                </div>
            )}
            {info && step === 'otp' && (
                <div
                    style={{
                        background: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        color: '#166534',
                        padding: '0.6rem 0.85rem',
                        borderRadius: '0.5rem',
                        fontSize: '0.8rem',
                        marginBottom: '0.75rem',
                    }}
                >
                    {info}
                </div>
            )}

            {step === 'email' ? (
                <form onSubmit={requestCode} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <input
                        type="email"
                        required
                        autoFocus={size === 'hero'}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@yourcompany.ca"
                        style={inputBase}
                    />
                    <button type="submit" style={btn} disabled={loading}>
                        {loading ? 'Sending…' : 'Send me a sign-in code →'}
                    </button>
                </form>
            ) : (
                <form onSubmit={verifyCode} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    <input
                        type="text"
                        required
                        autoFocus
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="123456"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        style={{ ...inputBase, textAlign: 'center', letterSpacing: '0.5em', fontSize: '1.25rem' }}
                    />
                    <button type="submit" style={btn} disabled={loading}>
                        {loading ? 'Verifying…' : 'Verify & enter →'}
                    </button>
                    <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.78rem' }}>
                        <button
                            type="button"
                            onClick={() => requestCode()}
                            disabled={loading}
                            style={{ flex: 1, background: 'none', border: 'none', color: '#0C3D61', cursor: 'pointer', padding: '0.25rem', fontWeight: 600 }}
                        >
                            Resend code
                        </button>
                        <button
                            type="button"
                            onClick={() => { setStep('email'); setCode(''); setError(''); setInfo(''); }}
                            style={{ flex: 1, background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.25rem' }}
                        >
                            Change email
                        </button>
                    </div>
                </form>
            )}

            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.875rem', textAlign: 'center' }}>
                By continuing, you agree to our{' '}
                <a href="https://www.corporateregistryservices.ca/terms" style={{ color: '#0C3D61' }}>Terms</a> &amp;{' '}
                <a href="https://www.corporateregistryservices.ca/privacy" style={{ color: '#0C3D61' }}>Privacy</a>.
            </div>
        </div>
    );
};

export default OtpForm;
