import React from 'react';

const COL_HEADING: React.CSSProperties = {
    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
    fontSize: '0.7rem',
    fontWeight: 600,
    color: '#C8952A',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    marginBottom: '0.875rem',
};

const LINK: React.CSSProperties = {
    display: 'block',
    fontSize: '0.85rem',
    color: '#cbd5e1',
    textDecoration: 'none',
    marginBottom: '0.5rem',
};

const LandingFooter: React.FC = () => {
    return (
        <footer
            style={{
                background: '#0C3D61',
                color: '#cbd5e1',
                padding: '3rem 1.5rem 1.5rem',
                marginTop: 'auto',
            }}
        >
            <div
                style={{
                    maxWidth: '1200px',
                    margin: '0 auto',
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr',
                    gap: '2.5rem',
                }}
                className="lf-grid"
            >
                {/* Brand column */}
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
                        <svg width="28" height="28" viewBox="0 0 100 100" aria-hidden="true">
                            <rect width="100" height="100" rx="16" fill="#C8952A" />
                            <path
                                fill="#0C3D61"
                                d="M50,9 L53,21 L64,14 L59,27 L73,25 L64,34 L79,40 L66,45 L72,59 L56,52 L54,69 L53,84 L47,84 L46,69 L44,52 L28,59 L34,45 L21,40 L36,34 L27,25 L41,27 L36,14 L47,21 Z"
                            />
                        </svg>
                        <span style={{ fontFamily: 'Georgia, serif', fontSize: '1.05rem', fontWeight: 700, color: '#fff' }}>
                            MinuteBook by CRS
                        </span>
                    </div>
                    <p style={{ fontSize: '0.8rem', lineHeight: 1.65, maxWidth: '34ch', color: '#94a3b8' }}>
                        Compliance-ready Canadian corporate minute books — built in minutes, not weeks. Compliant with the
                        CBCA and all 13 provincial and territorial corporate statutes.
                    </p>
                </div>

                <div>
                    <div style={COL_HEADING}>Product</div>
                    <a href="#what-is" style={LINK}>What it is</a>
                    <a href="#how" style={LINK}>How it works</a>
                    <a href="#included" style={LINK}>What&apos;s included</a>
                    <a href="#pricing" style={LINK}>Pricing</a>
                </div>

                <div>
                    <div style={COL_HEADING}>Company</div>
                    <a href="https://www.corporateregistryservices.ca" style={LINK}>CRS Home</a>
                    <a href="https://www.corporateregistryservices.ca/about" style={LINK}>About</a>
                    <a href="https://www.corporateregistryservices.ca/contact" style={LINK}>Contact</a>
                    <a href="https://www.corporateregistryservices.ca/minute-books" style={LINK}>Minute Books Info</a>
                </div>

                <div>
                    <div style={COL_HEADING}>Legal</div>
                    <a href="https://www.corporateregistryservices.ca/privacy" style={LINK}>Privacy</a>
                    <a href="https://www.corporateregistryservices.ca/terms" style={LINK}>Terms</a>
                    <a href="https://www.corporateregistryservices.ca/disclaimer" style={LINK}>Disclaimer</a>
                </div>
            </div>

            <div
                style={{
                    maxWidth: '1200px',
                    margin: '2.5rem auto 0',
                    paddingTop: '1.5rem',
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    fontSize: '0.75rem',
                    color: '#94a3b8',
                    display: 'flex',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                }}
            >
                <div>© {new Date().getFullYear()} Corporate Registry Services. All rights reserved.</div>
                <div>support@corporateregistryservices.ca</div>
            </div>

            <style>{`
                @media (max-width: 768px) {
                    .lf-grid { grid-template-columns: 1fr 1fr !important; gap: 2rem !important; }
                }
                @media (max-width: 480px) {
                    .lf-grid { grid-template-columns: 1fr !important; }
                }
            `}</style>
        </footer>
    );
};

export default LandingFooter;
