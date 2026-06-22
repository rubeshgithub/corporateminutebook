import React from 'react';
import { Navigate, Link } from 'react-router-dom';
import { useSelector } from 'react-redux';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';
import OtpForm from './OtpForm';

const TRUST_POINTS = [
    'No passwords — sign in with a one-time code',
    'Bank- and CRA-accepted minute books',
    'CBCA + all 13 provincial and territorial statutes',
    'Same-day delivery, flat-fee pricing',
];

const Login: React.FC = () => {
    const isAuthenticated = useSelector((state: any) => state.auth?.isAuthenticated);
    if (isAuthenticated) return <Navigate to="/dashboard" replace />;

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: '100vh',
                background: '#fff',
                color: '#1a1a1a',
                fontFamily: '"Inter", system-ui, -apple-system, sans-serif',
            }}
        >
            <LandingHeader />

            <main style={{ flex: 1 }}>
                <section
                    style={{
                        background: 'linear-gradient(160deg, #CBE2EF 0%, #DCE9F2 35%, #F1F5F8 100%)',
                        borderBottom: '1px solid #e5e7eb',
                        padding: '4rem 1.5rem',
                    }}
                >
                    <div
                        className="login-grid"
                        style={{
                            maxWidth: '1000px',
                            margin: '0 auto',
                            display: 'grid',
                            gridTemplateColumns: '1.05fr 1fr',
                            gap: '3rem',
                            alignItems: 'center',
                        }}
                    >
                        {/* Left: brand + value props */}
                        <div>
                            <span
                                style={{
                                    display: 'inline-block',
                                    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                                    fontSize: '0.7rem',
                                    fontWeight: 600,
                                    color: '#C8952A',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.1em',
                                    background: 'rgba(200, 149, 42, 0.12)',
                                    padding: '0.3rem 0.7rem',
                                    borderRadius: '4px',
                                    marginBottom: '1rem',
                                }}
                            >
                                Sign in to MinuteBook
                            </span>
                            <h1
                                style={{
                                    fontFamily: 'Georgia, serif',
                                    fontSize: 'clamp(1.75rem, 3vw, 2.4rem)',
                                    fontWeight: 700,
                                    lineHeight: 1.15,
                                    color: '#0C3D61',
                                    marginBottom: '0.875rem',
                                }}
                            >
                                Welcome back. Pick up where you left off.
                            </h1>
                            <div style={{ width: 40, height: 3, background: '#C8952A', marginBottom: '1.25rem', borderRadius: 2 }} />
                            <p
                                style={{
                                    fontSize: '1rem',
                                    lineHeight: 1.7,
                                    color: '#334155',
                                    marginBottom: '1.5rem',
                                    maxWidth: '40ch',
                                }}
                            >
                                Enter your email and we&apos;ll send a one-time sign-in code. New here?
                                {' '}
                                <Link to="/" style={{ color: '#0C3D61', fontWeight: 600 }}>
                                    See what MinuteBook does
                                </Link>
                                {' '}— or just enter your email below; first sign-in creates your account automatically.
                            </p>

                            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                {TRUST_POINTS.map((t) => (
                                    <li
                                        key={t}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '0.6rem',
                                            fontSize: '0.88rem',
                                            color: '#1e293b',
                                        }}
                                    >
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                            <circle cx="12" cy="12" r="10" fill="#C8952A" />
                                            <path d="M7 12.5 L10.5 16 L17 9" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                                        </svg>
                                        {t}
                                    </li>
                                ))}
                            </ul>
                        </div>

                        {/* Right: OTP form */}
                        <div style={{ maxWidth: '420px', width: '100%', justifySelf: 'end' }}>
                            <OtpForm
                                size="hero"
                                eyebrow="Sign in or sign up"
                                heading="Continue with email"
                                subheading="We'll send a 6-digit code to verify it's you."
                            />
                        </div>
                    </div>
                </section>
            </main>

            <LandingFooter />

            <style>{`
                @media (max-width: 900px) {
                    .login-grid {
                        grid-template-columns: 1fr !important;
                        gap: 2rem !important;
                    }
                    .login-grid > div:last-child {
                        justify-self: stretch !important;
                        max-width: 100% !important;
                    }
                }
            `}</style>
        </div>
    );
};

export default Login;
