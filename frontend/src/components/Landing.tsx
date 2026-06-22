import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate, Navigate } from 'react-router-dom';
import { loginSuccess } from '../store/authSlice';
import api from '../utils/api';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

/* ---------- shared style helpers ---------- */
const SECTION_LABEL: React.CSSProperties = {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#C8952A',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
};

const H2: React.CSSProperties = {
    fontFamily: 'Georgia, serif',
    fontSize: 'clamp(1.5rem, 2.5vw, 2rem)',
    fontWeight: 700,
    color: '#1a1a1a',
    marginTop: '0.5rem',
    marginBottom: '1rem',
    lineHeight: 1.2,
};

const GOLD_LINE: React.CSSProperties = {
    width: '40px',
    height: '3px',
    background: '#C8952A',
    marginBottom: '1.25rem',
    borderRadius: '2px',
};

const CARD: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: '0.75rem',
    padding: '1.5rem',
};

/* ---------- inline OTP form ---------- */
const InlineOtpForm: React.FC<{ size?: 'hero' | 'compact' }> = ({ size = 'hero' }) => {
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
            dispatch(loginSuccess(res.data));
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
            <div style={{ ...SECTION_LABEL, marginBottom: '0.5rem' }}>Start in 30 seconds</div>
            <div
                style={{
                    fontFamily: 'Georgia, serif',
                    fontSize: '1.15rem',
                    fontWeight: 700,
                    color: '#0C3D61',
                    marginBottom: '0.5rem',
                }}
            >
                {step === 'email' ? 'Get your minute book started' : 'Check your email'}
            </div>
            <p style={{ fontSize: '0.85rem', color: '#475569', marginBottom: '1.125rem', lineHeight: 1.5 }}>
                {step === 'email'
                    ? 'Enter your email — we\'ll send a one-time code. No passwords.'
                    : `We sent a 6-digit code to ${email}.`}
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

/* ---------- content data ---------- */
const WHEN_NEEDED = [
    { title: 'CRA Audit', body: 'The Canada Revenue Agency can request your corporate records at any time. A gap in your minute book can trigger reassessments and penalties.' },
    { title: 'Bank Financing', body: 'Every business loan, line of credit, or commercial mortgage requires the lender to review a current, complete minute book.' },
    { title: 'Sale or Acquisition', body: 'Due-diligence counsel will examine every resolution and register before closing. Gaps delay deals — or kill them.' },
    { title: 'Issuing Shares', body: 'Adding a shareholder, issuing options, or transferring shares all require resolutions and updated registers.' },
    { title: 'Annual Compliance', body: 'Directors\' and shareholders\' resolutions must be recorded every fiscal year. Most owners are years behind without knowing.' },
    { title: 'Statutory Inspection', body: 'Under the CBCA and provincial statutes, shareholders and directors are entitled to inspect the minute book at the registered office.' },
];

const HOW_STEPS = [
    { n: '01', title: 'Enter your company', body: 'Type your corporation\'s name and jurisdiction, or upload your articles of incorporation — our AI extracts the details automatically.' },
    { n: '02', title: 'We assemble everything', body: 'We generate jurisdiction-correct articles, by-laws, organizational resolutions, share registers, certificates, and consents — properly formatted and ready to sign.' },
    { n: '03', title: 'Download or e-sign', body: 'Receive a single merged PDF and individual documents. Send for e-signature through DocuSeal or print, sign, and store at your registered office.' },
];

const INCLUDED = [
    'Articles of Incorporation',
    'Corporate By-Laws',
    'Organizational Resolutions of Directors',
    'Organizational Resolutions of Shareholders',
    'Register of Directors and Officers',
    'Register of Shareholders',
    'Register of Share Transfers',
    'Share Subscription Agreements',
    'Share Certificates',
    'Consents to Act as Director',
    'Annual Directors\' Resolutions',
    'Annual Shareholders\' Resolutions',
    'Notice of Registered Office',
    'Compiled Minute Book PDF',
];

const PACKAGES = [
    { name: 'Standard', age: 'Up to 2 years old', price: '$299', body: 'Full minute book prepared from your incorporation documents — registers, share certificates, by-laws, and organizational resolutions.', highlight: false },
    { name: 'Established', age: '2 – 5 years old', price: '$749', body: 'Government document retrieval for all filings since incorporation, plus complete minute book preparation and compilation.', highlight: true },
    { name: 'Legacy', age: '5+ years old', price: '$1,399', body: 'Full corporate history retrieval and comprehensive minute book reconstruction covering all years of activity.', highlight: false },
];

const FAQS = [
    { q: 'What is a corporate minute book?', a: 'A corporate minute book is the official, statutory record of a corporation\'s legal existence and governance. Under the Canada Business Corporations Act (s. 20) and equivalent provincial statutes, every corporation is required to maintain one at its registered office. It contains the articles of incorporation, by-laws, every resolution passed by directors or shareholders, registers of directors and shareholders, and share certificates.' },
    { q: 'Is a minute book legally required in Canada?', a: 'Yes. Federal corporations are required to maintain a minute book under s. 20 of the CBCA. Every province and territory has equivalent legislation. Failure to maintain one is a corporate offence and exposes directors to personal liability in certain circumstances.' },
    { q: 'What happens if I don\'t have a minute book?', a: 'You may be unable to obtain financing (banks require it for any loan or mortgage), unable to sell your business (due-diligence will fail), exposed to CRA reassessment, in breach of statute, and personally liable as a director in some cases. Most owners only discover the gap when it costs them a transaction.' },
    { q: 'Do I need a lawyer to prepare one?', a: 'No. A minute book is a statutory record-keeping requirement, not a legal opinion. Generating the standard organizational documents and registers is mechanical work — exactly what MinuteBook automates. If your situation involves complex shareholder agreements or litigation, you should consult counsel; for the core minute book itself, you do not.' },
    { q: 'Which jurisdictions do you cover?', a: 'All 13 Canadian jurisdictions: federal (CBCA), Alberta, British Columbia, Manitoba, New Brunswick, Newfoundland and Labrador, Northwest Territories, Nova Scotia, Nunavut, Ontario, Prince Edward Island, Québec, Saskatchewan, and Yukon. Every document is generated against the correct statute for your corporation.' },
    { q: 'How long does it take?', a: 'For a newly incorporated company with no prior filings, you can have your minute book in your inbox within 10 minutes. For established corporations requiring document retrieval from government registries, allow 1 – 3 business days.' },
    { q: 'What if I already have some documents?', a: 'Upload what you have. The system identifies gaps and only generates what\'s missing. You\'ll get the full assembled minute book as a single document.' },
];

/* ---------- page component ---------- */
const Landing: React.FC = () => {
    const isAuthenticated = useSelector((state: any) => state.auth?.isAuthenticated);

    useEffect(() => {
        document.title = 'MinuteBook — Court-Ready Canadian Corporate Minute Books in Minutes';
        const setMeta = (name: string, content: string) => {
            let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
            if (!el) {
                el = document.createElement('meta');
                el.name = name;
                document.head.appendChild(el);
            }
            el.content = content;
        };
        setMeta(
            'description',
            'Generate a complete, legally compliant Canadian corporate minute book in minutes — articles, by-laws, registers, certificates, and resolutions. CBCA + all 13 provinces. Flat-fee pricing from $299. No lawyer required.'
        );
        setMeta(
            'keywords',
            'corporate minute book Canada, minute book generator, CBCA minute book, Ontario minute book, Alberta minute book, BC minute book, minute book template, corporate records Canada'
        );

        // JSON-LD for FAQs
        const ldScript = document.createElement('script');
        ldScript.type = 'application/ld+json';
        ldScript.text = JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQS.map((f) => ({
                '@type': 'Question',
                name: f.q,
                acceptedAnswer: { '@type': 'Answer', text: f.a },
            })),
        });
        document.head.appendChild(ldScript);
        return () => { ldScript.remove(); };
    }, []);

    if (isAuthenticated) return <Navigate to="/dashboard" replace />;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#fff', color: '#1a1a1a', fontFamily: '"Inter", system-ui, -apple-system, sans-serif' }}>
            <LandingHeader />

            <main style={{ flex: 1 }}>

                {/* ===== HERO ===== */}
                <section
                    style={{
                        background: 'linear-gradient(160deg, #CBE2EF 0%, #DCE9F2 35%, #F1F5F8 100%)',
                        borderBottom: '1px solid #e5e7eb',
                        padding: '3.5rem 1.5rem 4rem',
                    }}
                >
                    <div
                        style={{
                            maxWidth: '1200px',
                            margin: '0 auto',
                            display: 'grid',
                            gridTemplateColumns: '1.15fr 1fr',
                            gap: '3rem',
                            alignItems: 'center',
                        }}
                        className="lp-hero"
                    >
                        <div>
                            <span
                                style={{
                                    ...SECTION_LABEL,
                                    display: 'inline-block',
                                    background: 'rgba(200, 149, 42, 0.12)',
                                    padding: '0.3rem 0.7rem',
                                    borderRadius: '4px',
                                    marginBottom: '1.25rem',
                                }}
                            >
                                Court-Ready Corporate Records · All 13 Jurisdictions
                            </span>
                            <h1
                                style={{
                                    fontFamily: 'Georgia, serif',
                                    fontSize: 'clamp(2rem, 4vw, 3.1rem)',
                                    fontWeight: 700,
                                    lineHeight: 1.1,
                                    color: '#0C3D61',
                                    marginBottom: '1.25rem',
                                }}
                            >
                                Your Corporate Minute Book,{' '}
                                <span style={{ color: '#C8952A' }}>Built in 10 Minutes</span> — Not 10 Hours.
                            </h1>
                            <div style={GOLD_LINE} />
                            <p
                                style={{
                                    fontSize: '1.08rem',
                                    lineHeight: 1.7,
                                    color: '#334155',
                                    marginBottom: '1.75rem',
                                    maxWidth: '46ch',
                                }}
                            >
                                Skip the $2,000 lawyer bill and the two-week wait. Generate a complete, statutorily
                                compliant minute book — articles, by-laws, registers, certificates, and resolutions —
                                for any Canadian corporation. Flat fee, instant delivery, no calls.
                            </p>

                            {/* Trust pills */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.5rem' }}>
                                {[
                                    'CBCA + provincial statutes',
                                    'Bank & CRA accepted',
                                    'Delivered same day',
                                ].map((t) => (
                                    <span
                                        key={t}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '0.4rem',
                                            fontSize: '0.78rem',
                                            fontWeight: 500,
                                            color: '#0C3D61',
                                            background: '#fff',
                                            border: '1px solid #dbe5ee',
                                            padding: '0.35rem 0.65rem',
                                            borderRadius: '999px',
                                        }}
                                    >
                                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#C8952A' }} />
                                        {t}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Right column: inline OTP */}
                        <div>
                            <InlineOtpForm size="hero" />
                        </div>
                    </div>
                </section>

                {/* ===== WHAT IS ===== */}
                <section id="what-is" style={{ padding: '4.5rem 1.5rem', scrollMarginTop: '4rem' }}>
                    <div style={{ maxWidth: '780px', margin: '0 auto' }}>
                        <div style={SECTION_LABEL}>What it is</div>
                        <h2 style={H2}>What is a corporate minute book?</h2>
                        <div style={GOLD_LINE} />
                        <p style={{ fontSize: '1.02rem', lineHeight: 1.8, color: '#475569', marginBottom: '1rem' }}>
                            A corporate minute book is the official, statutory record of your corporation&apos;s existence
                            and internal governance. Under <em>section 20 of the Canada Business Corporations Act</em> —
                            and equivalent provisions in every provincial corporate statute — every corporation in
                            Canada is <strong>legally required</strong> to maintain one at its registered office and make
                            it available for inspection by shareholders, directors, and regulatory authorities.
                        </p>
                        <p style={{ fontSize: '1.02rem', lineHeight: 1.8, color: '#475569', marginBottom: '1rem' }}>
                            The minute book contains the articles of incorporation, by-laws, every directors&apos; and
                            shareholders&apos; resolution, registers of directors, officers, and shareholders, and copies
                            of all share certificates issued. It is the document a CRA auditor, a bank&apos;s lawyer, or a
                            prospective buyer will ask for — and the document that, when missing or incomplete, will
                            cost you a financing, kill a transaction, or trigger a reassessment.
                        </p>
                        <p style={{ fontSize: '1.02rem', lineHeight: 1.8, color: '#475569' }}>
                            Most lawyers charge $1,500 to $3,000 to prepare one. The substantive work is, however,
                            mechanical: standard organizational resolutions, jurisdiction-specific registers, and properly
                            formatted certificates. <strong>That is what we automate.</strong>
                        </p>
                    </div>
                </section>

                {/* ===== WHEN YOU NEED IT ===== */}
                <section style={{ background: '#F1F5F8', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', padding: '4.5rem 1.5rem' }}>
                    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                            <div style={SECTION_LABEL}>When you need it</div>
                            <h2 style={{ ...H2, textAlign: 'center' }}>Six moments your minute book will be demanded</h2>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                            {WHEN_NEEDED.map((item, i) => (
                                <div key={item.title} style={CARD}>
                                    <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.5rem', color: '#C8952A', fontWeight: 700, lineHeight: 1 }}>
                                        {String(i + 1).padStart(2, '0')}
                                    </div>
                                    <h3 style={{ fontFamily: 'Georgia, serif', fontSize: '1.05rem', fontWeight: 600, color: '#0C3D61', margin: '0.75rem 0 0.5rem' }}>
                                        {item.title}
                                    </h3>
                                    <p style={{ fontSize: '0.85rem', lineHeight: 1.65, color: '#475569', margin: 0 }}>
                                        {item.body}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ===== HOW IT WORKS ===== */}
                <section id="how" style={{ padding: '4.5rem 1.5rem', scrollMarginTop: '4rem' }}>
                    <div style={{ maxWidth: '1100px', margin: '0 auto' }}>
                        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                            <div style={SECTION_LABEL}>How it works</div>
                            <h2 style={{ ...H2, textAlign: 'center' }}>Three steps. Same day delivery.</h2>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1.5rem' }}>
                            {HOW_STEPS.map((s) => (
                                <div key={s.n} style={{ ...CARD, borderTop: '4px solid #C8952A' }}>
                                    <div style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: '0.75rem', color: '#C8952A', fontWeight: 700, letterSpacing: '0.15em' }}>
                                        STEP {s.n}
                                    </div>
                                    <h3 style={{ fontFamily: 'Georgia, serif', fontSize: '1.15rem', fontWeight: 700, color: '#0C3D61', margin: '0.5rem 0 0.5rem' }}>
                                        {s.title}
                                    </h3>
                                    <p style={{ fontSize: '0.9rem', lineHeight: 1.65, color: '#475569', margin: 0 }}>
                                        {s.body}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ===== WHAT'S INCLUDED ===== */}
                <section id="included" style={{ background: '#F1F5F8', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', padding: '4.5rem 1.5rem' }}>
                    <div style={{ maxWidth: '1000px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem', alignItems: 'start' }} className="lp-included">
                        <div>
                            <div style={SECTION_LABEL}>What&apos;s included</div>
                            <h2 style={H2}>Every document your corporation needs — in one delivery.</h2>
                            <div style={GOLD_LINE} />
                            <p style={{ fontSize: '0.95rem', lineHeight: 1.75, color: '#475569', marginBottom: '1rem' }}>
                                Each document is generated against your corporation&apos;s specific governing statute,
                                properly formatted with your particulars, and ready to sign. Delivered as a single merged
                                PDF and individual files.
                            </p>
                            <p style={{ fontSize: '0.95rem', lineHeight: 1.75, color: '#475569' }}>
                                Need e-signature? We integrate with DocuSeal to send the package to your directors and
                                shareholders directly.
                            </p>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
                            {INCLUDED.map((doc) => (
                                <div key={doc} style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', fontSize: '0.88rem', color: '#1e293b' }}>
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                                        <circle cx="12" cy="12" r="10" fill="#C8952A" />
                                        <path d="M7 12.5 L10.5 16 L17 9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                    {doc}
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ===== PRICING ===== */}
                <section id="pricing" style={{ padding: '4.5rem 1.5rem', scrollMarginTop: '4rem' }}>
                    <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
                        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                            <div style={SECTION_LABEL}>Pricing</div>
                            <h2 style={{ ...H2, textAlign: 'center' }}>Flat fees. No hourly billing. No surprises.</h2>
                            <p style={{ fontSize: '0.9rem', color: '#64748b', maxWidth: '50ch', margin: '0 auto' }}>
                                All packages include government document retrieval where required, professional preparation,
                                and digital delivery.
                            </p>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
                            {PACKAGES.map((p) => (
                                <div
                                    key={p.name}
                                    style={{
                                        background: p.highlight ? '#0C3D61' : '#fff',
                                        color: p.highlight ? '#fff' : '#1a1a1a',
                                        border: `2px solid ${p.highlight ? '#0C3D61' : '#e5e7eb'}`,
                                        borderRadius: '0.875rem',
                                        padding: '1.75rem 1.5rem',
                                        position: 'relative',
                                    }}
                                >
                                    {p.highlight && (
                                        <div
                                            style={{
                                                position: 'absolute', top: '-0.875rem', left: '50%', transform: 'translateX(-50%)',
                                                background: '#C8952A', color: '#fff', fontSize: '0.65rem',
                                                fontFamily: 'ui-monospace, monospace', textTransform: 'uppercase',
                                                letterSpacing: '0.08em', padding: '0.25rem 0.75rem', borderRadius: '9999px',
                                                whiteSpace: 'nowrap',
                                            }}
                                        >
                                            Most common
                                        </div>
                                    )}
                                    <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: p.highlight ? 'rgba(255,255,255,0.7)' : '#94a3b8', marginBottom: '0.35rem' }}>
                                        {p.age}
                                    </div>
                                    <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', fontWeight: 700, marginBottom: '0.25rem' }}>
                                        {p.name}
                                    </div>
                                    <div style={{ fontSize: '2rem', fontWeight: 800, color: p.highlight ? '#fff' : '#C8952A', marginBottom: '0.85rem' }}>
                                        {p.price}<span style={{ fontSize: '0.85rem', fontWeight: 400, opacity: 0.75 }}> + tax</span>
                                    </div>
                                    <p style={{ fontSize: '0.83rem', lineHeight: 1.65, color: p.highlight ? 'rgba(255,255,255,0.85)' : '#475569', margin: 0 }}>
                                        {p.body}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ===== COMPARISON ===== */}
                <section style={{ background: '#F1F5F8', borderTop: '1px solid #e5e7eb', borderBottom: '1px solid #e5e7eb', padding: '4.5rem 1.5rem' }}>
                    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
                        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
                            <div style={SECTION_LABEL}>How we compare</div>
                            <h2 style={{ ...H2, textAlign: 'center' }}>MinuteBook vs. the alternatives</h2>
                        </div>
                        <div style={{ overflowX: 'auto' }}>
                            <table
                                style={{
                                    width: '100%',
                                    borderCollapse: 'collapse',
                                    background: '#fff',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '0.75rem',
                                    overflow: 'hidden',
                                    fontSize: '0.88rem',
                                }}
                            >
                                <thead>
                                    <tr style={{ background: '#0C3D61', color: '#fff', textAlign: 'left' }}>
                                        <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}></th>
                                        <th style={{ padding: '0.85rem 1rem', fontWeight: 700, color: '#C8952A' }}>MinuteBook by CRS</th>
                                        <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>Hire a Lawyer</th>
                                        <th style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>DIY Templates</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {[
                                        ['Typical cost', '$299 – $1,399', '$1,500 – $3,000+', '$0 – $99'],
                                        ['Turnaround', 'Same day', '2 – 6 weeks', 'Hours of self-work'],
                                        ['Statute-correct for your jurisdiction', 'Yes', 'Yes', 'Often no'],
                                        ['Government document retrieval', 'Included', 'Extra fee', 'Not included'],
                                        ['Risk of errors / omissions', 'Low', 'Low', 'High'],
                                        ['Updates as company changes', 'Self-serve, anytime', 'Bill on every change', 'Manual rework'],
                                    ].map((row, i) => (
                                        <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                                            <td style={{ padding: '0.75rem 1rem', fontWeight: 600, color: '#0C3D61' }}>{row[0]}</td>
                                            <td style={{ padding: '0.75rem 1rem', background: '#fffbf0', color: '#0C3D61', fontWeight: 600 }}>{row[1]}</td>
                                            <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>{row[2]}</td>
                                            <td style={{ padding: '0.75rem 1rem', color: '#475569' }}>{row[3]}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                {/* ===== FAQ ===== */}
                <section id="faq" style={{ padding: '4.5rem 1.5rem', scrollMarginTop: '4rem' }}>
                    <div style={{ maxWidth: '780px', margin: '0 auto' }}>
                        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                            <div style={SECTION_LABEL}>Questions, answered</div>
                            <h2 style={{ ...H2, textAlign: 'center' }}>Frequently asked questions</h2>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                            {FAQS.map((f) => (
                                <details
                                    key={f.q}
                                    style={{
                                        background: '#fff',
                                        border: '1px solid #e5e7eb',
                                        borderRadius: '0.6rem',
                                        padding: '1rem 1.25rem',
                                    }}
                                >
                                    <summary
                                        style={{
                                            cursor: 'pointer',
                                            fontWeight: 600,
                                            fontSize: '0.95rem',
                                            color: '#0C3D61',
                                            listStyle: 'none',
                                        }}
                                    >
                                        {f.q}
                                    </summary>
                                    <p style={{ marginTop: '0.75rem', fontSize: '0.88rem', lineHeight: 1.75, color: '#475569' }}>
                                        {f.a}
                                    </p>
                                </details>
                            ))}
                        </div>
                    </div>
                </section>

                {/* ===== FINAL CTA ===== */}
                <section style={{ background: 'linear-gradient(160deg, #0C3D61 0%, #1d5a85 100%)', padding: '5rem 1.5rem', color: '#fff' }}>
                    <div style={{ maxWidth: '900px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem', alignItems: 'center' }} className="lp-cta">
                        <div>
                            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.6rem, 2.8vw, 2.25rem)', fontWeight: 700, lineHeight: 1.2, marginBottom: '1rem' }}>
                                Get your minute book in your inbox before lunch.
                            </h2>
                            <p style={{ fontSize: '1rem', lineHeight: 1.7, color: 'rgba(255,255,255,0.85)' }}>
                                No calls, no quotes, no waiting. Enter your email and you&apos;ll be inside the app in 30 seconds.
                            </p>
                        </div>
                        <InlineOtpForm size="compact" />
                    </div>
                </section>

            </main>

            <LandingFooter />

            <style>{`
                @media (max-width: 900px) {
                    .lp-hero, .lp-included, .lp-cta {
                        grid-template-columns: 1fr !important;
                        gap: 2rem !important;
                    }
                }
                summary::-webkit-details-marker { display: none; }
                summary::before {
                    content: '+ ';
                    color: #C8952A;
                    font-weight: 700;
                    margin-right: 0.25rem;
                }
                details[open] summary::before {
                    content: '− ';
                }
            `}</style>
        </div>
    );
};

export default Landing;
