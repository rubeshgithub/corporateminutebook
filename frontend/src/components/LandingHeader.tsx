import React from 'react';
import { Link } from 'react-router-dom';

const LandingHeader: React.FC = () => {
    return (
        <header
            style={{
                position: 'sticky',
                top: 0,
                zIndex: 50,
                background: '#fff',
                borderBottom: '1px solid #E5E7EB',
                backdropFilter: 'saturate(180%) blur(8px)',
            }}
        >
            {/* Parent-brand strip */}
            <div
                style={{
                    background: '#0C3D61',
                    color: '#fff',
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    padding: '0.35rem 1.5rem',
                    textAlign: 'center',
                    letterSpacing: '0.01em',
                }}
            >
                A service of{' '}
                <a
                    href="https://www.corporateregistryservices.ca"
                    style={{ color: '#C8952A', fontWeight: 600, textDecoration: 'none' }}
                >
                    Corporate Registry Services
                </a>
                <span style={{ opacity: 0.65, marginLeft: '0.4rem' }}>
                    — Canadian federal &amp; all 13 provincial registries
                </span>
            </div>
            <div
                style={{
                    maxWidth: '1200px',
                    margin: '0 auto',
                    padding: '0.75rem 1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '1.5rem',
                }}
            >
                {/* Brand */}
                <Link
                    to="/"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                        textDecoration: 'none',
                    }}
                >
                    <svg width="32" height="32" viewBox="0 0 100 100" aria-hidden="true">
                        <rect width="100" height="100" rx="16" fill="#0C3D61" />
                        <path
                            fill="#C8952A"
                            d="M50,9 L53,21 L64,14 L59,27 L73,25 L64,34 L79,40 L66,45 L72,59 L56,52 L54,69 L53,84 L47,84 L46,69 L44,52 L28,59 L34,45 L21,40 L36,34 L27,25 L41,27 L36,14 L47,21 Z"
                        />
                    </svg>
                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
                        <span
                            style={{
                                fontFamily: 'Georgia, serif',
                                fontSize: '1.15rem',
                                fontWeight: 700,
                                color: '#0C3D61',
                            }}
                        >
                            MinuteBook
                        </span>
                        <span
                            style={{
                                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                                fontSize: '0.6rem',
                                fontWeight: 600,
                                color: '#C8952A',
                                textTransform: 'uppercase',
                                letterSpacing: '0.1em',
                                marginTop: '0.15rem',
                            }}
                        >
                            by CRS
                        </span>
                    </div>
                </Link>

                {/* Nav */}
                <nav
                    className="lh-nav"
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '1.5rem',
                    }}
                >
                    {[
                        { label: 'What it is', href: '#what-is' },
                        { label: 'How it works', href: '#how' },
                        { label: 'Pricing', href: '#pricing' },
                        { label: 'FAQ', href: '#faq' },
                    ].map((item) => (
                        <a
                            key={item.href}
                            href={item.href}
                            style={{
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                color: '#1a1a1a',
                                textDecoration: 'none',
                            }}
                        >
                            {item.label}
                        </a>
                    ))}
                </nav>

                {/* Sign-in CTA */}
                <Link
                    to="/login"
                    style={{
                        padding: '0.5rem 1rem',
                        borderRadius: '0.5rem',
                        border: '1.5px solid #0C3D61',
                        color: '#0C3D61',
                        background: 'transparent',
                        fontWeight: 600,
                        fontSize: '0.85rem',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                    }}
                >
                    Sign In
                </Link>
            </div>

            <style>{`
                @media (max-width: 768px) {
                    .lh-nav { display: none !important; }
                }
            `}</style>
        </header>
    );
};

export default LandingHeader;
