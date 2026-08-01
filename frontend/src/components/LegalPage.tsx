import React from 'react';
import { Box, Container, Typography, Divider, Alert } from '@mui/material';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

/**
 * Terms of Service and Privacy Policy.
 *
 * These describe what the application actually does — every processor listed
 * in the privacy policy corresponds to a real integration in the codebase
 * (SES/S3, Anthropic PDF parsing, DocuSeal, Google Places, MongoDB Atlas,
 * Render). If an integration is added or removed, update this file in the
 * same change: PIPEDA requires disclosure of cross-border processing, and a
 * policy that lags the code is worse than no policy.
 */

const LAST_UPDATED = 'July 31, 2026';
const CONTACT = 'support@corporateregistryservices.ca';

const H2: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography variant="h6" sx={{ mt: 4, mb: 1, fontWeight: 700, color: '#0C3D61' }}>
        {children}
    </Typography>
);

const P: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography variant="body2" sx={{ mb: 1.5, lineHeight: 1.75, color: '#334155' }}>
        {children}
    </Typography>
);

const Li: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <Typography component="li" variant="body2" sx={{ mb: 0.75, lineHeight: 1.7, color: '#334155' }}>
        {children}
    </Typography>
);

const Shell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#fff' }}>
        <LandingHeader />
        <Container maxWidth="md" sx={{ py: { xs: 4, md: 7 }, flex: 1 }}>
            <Typography variant="h4" sx={{ fontFamily: 'Georgia, serif', fontWeight: 700, color: '#0C3D61' }}>
                {title}
            </Typography>
            <Typography variant="caption" sx={{ color: '#64748b' }}>
                Last updated {LAST_UPDATED}
            </Typography>
            <Divider sx={{ my: 3 }} />
            {children}
            <Divider sx={{ my: 4 }} />
            <Typography variant="body2" sx={{ color: '#64748b' }}>
                Questions about this page? Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
            </Typography>
        </Container>
        <LandingFooter />
    </Box>
);

export const PrivacyPolicy: React.FC = () => (
    <Shell title="Privacy Policy">
        <P>
            This policy explains what MinuteBook (operated by Corporate Registry Services) collects, why we
            collect it, who processes it on our behalf, and the choices you have. It is written to meet our
            obligations under Canada&apos;s <em>Personal Information Protection and Electronic Documents Act</em>{' '}
            (PIPEDA) and applicable provincial privacy legislation.
        </P>

        <H2>What we collect</H2>
        <Box component="ul" sx={{ pl: 3, mb: 2 }}>
            <Li><strong>Account information</strong> — your email address and display name. We do not use passwords; you sign in with a one-time code sent to your email.</Li>
            <Li><strong>Corporate records you enter</strong> — company details, and the names, residential addresses, email addresses, phone numbers, and shareholdings of your directors, officers, and shareholders. This is personal information about people who may not be our users, and you are responsible for having the authority to provide it.</Li>
            <Li><strong>Documents you upload</strong> — certificates of incorporation, signed resolutions, registry filings, and similar records.</Li>
            <Li><strong>Usage and security data</strong> — an activity log of actions taken in your account, and standard server logs including IP address, for security and troubleshooting.</Li>
        </Box>

        <H2>Why we use it</H2>
        <P>
            To operate your account, generate your corporate documents and minute book, track compliance
            deadlines, send you filing reminders, check your public registry listing for changes, and secure
            the service against abuse. We do not sell your information, and we do not use it for advertising.
        </P>

        <H2>Service providers and cross-border processing</H2>
        <P>
            We use the following providers to run the service. Several store or process data in the United
            States. While information is held outside Canada it is subject to the laws of that country,
            including lawful access requests by foreign courts and government agencies.
        </P>
        <Box component="ul" sx={{ pl: 3, mb: 2 }}>
            <Li><strong>MongoDB Atlas</strong> — hosts the database containing your account and corporate records.</Li>
            <Li><strong>Amazon Web Services</strong> — S3 stores your uploaded documents; Simple Email Service delivers sign-in codes, reminders, and share invitations. Processed in the United States.</Li>
            <Li><strong>Anthropic</strong> — when you upload an incorporation document and ask us to read it, the file is sent to Anthropic&apos;s API so its contents can be extracted into form fields. These documents typically contain director names and addresses. Processed in the United States. This step is optional: you can enter company details manually instead.</Li>
            <Li><strong>DocuSeal</strong> — handles electronic signature requests when you choose to send a resolution for signing.</Li>
            <Li><strong>Google</strong> — powers address autocomplete. Text you type into an address field is sent to Google to return suggestions.</Li>
            <Li><strong>Render</strong> — hosts the application servers.</Li>
        </Box>

        <H2>Links you share</H2>
        <P>
            When you create a read-only share link for an accountant, lawyer, or banker, anyone holding that
            link can view the shared record without signing in — the link itself is the credential. Links
            expire on the date you choose (up to 90 days) and you can revoke one at any time from your
            dashboard. Treat share links like passwords and do not post them publicly.
        </P>

        <H2>How we protect it</H2>
        <P>
            Sign-in codes are stored hashed, never in readable form, and expire after ten minutes. Your
            session travels in a cookie that browser scripts cannot read. Traffic is encrypted in transit.
            Access to production systems is limited to personnel who need it. No system is perfectly secure,
            and we cannot guarantee absolute security.
        </P>

        <H2>Retention and deletion</H2>
        <P>
            We keep your corporate records for as long as your account is active, because a minute book is a
            record you are legally required to maintain. When you delete a company it is removed from your
            dashboard and retained in our backups for a limited period before permanent erasure. To request
            deletion of your account and its contents, email us at {CONTACT}.
        </P>

        <H2>Your rights</H2>
        <P>
            You may ask us for a copy of the personal information we hold about you, ask us to correct it, ask
            us to delete it, or withdraw your consent to our use of it — though withdrawing consent may mean we
            can no longer provide the service. Write to {CONTACT} and we will respond within thirty days. If
            you are not satisfied with our response, you may complain to the Office of the Privacy Commissioner
            of Canada.
        </P>

        <H2>Cookies</H2>
        <P>
            We set one cookie, which keeps you signed in. We do not use advertising or third-party tracking
            cookies.
        </P>

        <H2>Changes</H2>
        <P>
            If we change this policy we will update the date at the top of this page, and will notify you by
            email if the change materially affects how we handle your information.
        </P>
    </Shell>
);

export const TermsOfService: React.FC = () => (
    <Shell title="Terms of Service">
        <Alert severity="info" sx={{ mb: 3 }}>
            <strong>MinuteBook is not a law firm and does not provide legal advice.</strong> The documents this
            service generates are templates populated with information you supply. Whether they are correct
            and sufficient for your corporation depends on your circumstances and your governing statute. For
            anything consequential, have a lawyer review the result.
        </Alert>

        <P>
            These terms govern your use of MinuteBook, operated by Corporate Registry Services. By creating an
            account or using the service, you agree to them.
        </P>

        <H2>What the service does</H2>
        <P>
            MinuteBook helps you assemble and maintain a corporate minute book: recording corporate changes,
            generating resolutions and registers, tracking filing deadlines, and compiling everything into a
            single document. It is a record-keeping tool. It does not file anything with a corporate registry
            on your behalf, and it does not determine what your corporation is legally required to do.
        </P>

        <H2>Accuracy is your responsibility</H2>
        <P>
            The documents we generate reflect the information you enter. We do not verify that information
            against registry records, and compliance indicators in the application are informational aids, not
            a legal opinion that your records are complete or correct. You remain responsible for maintaining
            your corporate records as your governing corporate statute requires.
        </P>

        <H2>Your account</H2>
        <P>
            You must provide an email address you control, and you are responsible for activity under your
            account. Tell us promptly at {CONTACT} if you believe your account or a share link has been
            misused. You must have the authority to enter personal information about your directors, officers,
            and shareholders, and to share it with the people you send links to.
        </P>

        <H2>Your content</H2>
        <P>
            Your corporate records and uploaded documents remain yours. You grant us only the permission
            needed to host, process, and display them in order to run the service. We do not claim ownership
            of your records and we do not use them to train artificial intelligence models.
        </P>

        <H2>Acceptable use</H2>
        <P>
            Do not use the service to store unlawful content, impersonate another person or corporation,
            attempt to access another customer&apos;s records, probe or disrupt the service, or resell access
            without our written agreement.
        </P>

        <H2>Fees</H2>
        <P>
            Package pricing is shown on our site and purchased through Corporate Registry Services. Fees are
            stated in Canadian dollars and exclude applicable taxes. Where we introduce recurring plans, the
            price, billing period, and cancellation terms will be disclosed before you are charged.
        </P>

        <H2>Availability</H2>
        <P>
            We aim to keep the service available and backed up, but we do not guarantee uninterrupted access.
            We may modify or discontinue features. We will give reasonable notice before any change that would
            remove your ability to export your records.
        </P>

        <H2>Limitation of liability</H2>
        <P>
            To the extent permitted by law, we are not liable for indirect or consequential losses, including
            lost profits, penalties, or the consequences of a missed filing deadline. Our total liability for
            any claim relating to the service is limited to the amount you paid us in the twelve months before
            the claim arose. Nothing in these terms limits liability that cannot be limited by law.
        </P>

        <H2>Termination</H2>
        <P>
            You may stop using the service and request deletion at any time. We may suspend or terminate an
            account that breaches these terms, and will give notice and a reasonable opportunity to export
            records except where immediate suspension is necessary.
        </P>

        <H2>Governing law</H2>
        <P>
            These terms are governed by the laws of the Province of Alberta and the federal laws of Canada
            applicable there, and the courts of Alberta have jurisdiction over any dispute.
        </P>

        <H2>Changes</H2>
        <P>
            We may update these terms; the date at the top of this page shows when. Material changes will be
            emailed to account holders. Continuing to use the service after a change means you accept it.
        </P>
    </Shell>
);
