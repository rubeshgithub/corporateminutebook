import React from 'react';
import { Box, Dialog, DialogTitle, DialogContent, IconButton, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import PersonRemoveIcon from '@mui/icons-material/PersonRemove';
import HomeIcon from '@mui/icons-material/Home';
import PaidIcon from '@mui/icons-material/Paid';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import BadgeIcon from '@mui/icons-material/Badge';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import CategoryIcon from '@mui/icons-material/Category';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import GavelIcon from '@mui/icons-material/Gavel';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import LockIcon from '@mui/icons-material/Lock';
import DescriptionIcon from '@mui/icons-material/Description';

/**
 * Plain-English event launcher. Instead of showing owners a dropdown of
 * event-type slugs (share_class_added, fiscal_year_end_changed…), we
 * surface the scenarios they actually think in ("I want to add a
 * shareholder", "I need to change my address"). Clicking a tile opens
 * the RecordEventDialog preset to the matching event type.
 *
 * Grouped by frequency-of-use for scanning speed: People first, then
 * Shares/Structure, then Documents/Filings, then Governance.
 */

export type WizardEventType =
    | 'director_appointed' | 'director_resigned' | 'director_address_changed'
    | 'officer_appointed' | 'officer_resigned'
    | 'shares_issued' | 'shares_transferred' | 'shares_cancelled' | 'share_class_added'
    | 'address_changed' | 'name_changed' | 'fiscal_year_end_changed'
    | 'annual_return_filed'
    | 'signing_authority_granted' | 'signing_authority_revoked'
    | 'dividend_declared';

interface Tile {
    eventType: WizardEventType;
    label:     string;
    body:      string;
    icon:      React.ReactNode;
    accent:    string;
}

const TILES: Array<{ section: string; tiles: Tile[] }> = [
    {
        section: 'People',
        tiles: [
            { eventType: 'director_appointed',       label: 'Add a director',              body: "Appoint a new director. Auto-drafts a board resolution.",                       icon: <PersonAddIcon />,             accent: '#1a237e' },
            { eventType: 'director_resigned',        label: 'Remove a director',           body: "Record a director's resignation. Auto-drafts a board resolution.",              icon: <PersonRemoveIcon />,          accent: '#b71c1c' },
            { eventType: 'director_address_changed', label: "Update a director's address", body: "Log the address change and draft the corresponding resolution.",                icon: <HomeIcon />,                  accent: '#4527a0' },
            { eventType: 'officer_appointed',        label: 'Appoint an officer',          body: 'Add an officer (President, CFO, Secretary…) with a board resolution.',          icon: <BadgeIcon />,                 accent: '#0d47a1' },
            { eventType: 'officer_resigned',         label: 'Remove an officer',           body: "Record an officer's resignation with a board resolution.",                      icon: <BadgeOutlinedIcon />,         accent: '#bf360c' },
        ],
    },
    {
        section: 'Shares & structure',
        tiles: [
            { eventType: 'shares_issued',      label: 'Issue shares (add a shareholder)', body: "Issue new shares to a person or entity. Auto-assigns a certificate number.", icon: <PaidIcon />,          accent: '#1b5e20' },
            { eventType: 'shares_transferred', label: 'Transfer shares',                  body: 'Move shares from one shareholder to another.',                                icon: <SwapHorizIcon />,     accent: '#004d40' },
            { eventType: 'shares_cancelled',   label: 'Cancel shares',                    body: 'Cancel shares held by a shareholder (redemption, buy-back).',                 icon: <EventBusyIcon />,     accent: '#880e4f' },
            { eventType: 'share_class_added',  label: 'Add a new share class',            body: 'Create a new class (Class B Preferred, etc.). Requires shareholder consent.', icon: <CategoryIcon />,      accent: '#33691e' },
            { eventType: 'dividend_declared',  label: 'Declare a dividend',               body: 'Declare a dividend on a share class. Prepares T5 tracking.',                  icon: <PaidIcon />,          accent: '#f9a825' },
        ],
    },
    {
        section: 'Address, name & filings',
        tiles: [
            { eventType: 'address_changed',         label: 'Change registered address',   body: 'Update the registered office or records address on file.',                    icon: <HomeIcon />,                 accent: '#e65100' },
            { eventType: 'name_changed',            label: 'Change company name',         body: 'Record a legal name change (requires a shareholder resolution).',             icon: <DriveFileRenameOutlineIcon />, accent: '#6a1b9a' },
            { eventType: 'fiscal_year_end_changed', label: 'Change fiscal year end',      body: 'Update the year-end (drives annual return + FYE reminders).',                 icon: <EventBusyIcon />,            accent: '#4e342e' },
            { eventType: 'annual_return_filed',     label: 'Log an annual return filing', body: 'Record that you filed the annual return with the registry (confirmation #).', icon: <DescriptionIcon />,          accent: '#37474f' },
        ],
    },
    {
        section: 'Governance',
        tiles: [
            { eventType: 'signing_authority_granted', label: 'Grant signing authority',   body: 'Authorise someone to bind the corporation (banking, contracts).',              icon: <LockOpenIcon />, accent: '#00695c' },
            { eventType: 'signing_authority_revoked', label: 'Revoke signing authority',  body: 'Revoke a prior grant of signing authority.',                                   icon: <LockIcon />,     accent: '#795548' },
        ],
    },
];

interface Props {
    open: boolean;
    onClose: () => void;
    onPick: (eventType: WizardEventType) => void;
}

const ChangeWizard: React.FC<Props> = ({ open, onClose, onPick }) => {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
            <DialogTitle sx={{ pb: 1 }}>
                What would you like to do?
                <Typography variant="caption" display="block" color="text.secondary" mt={0.3}>
                    Pick a plain-English action — we'll open the right form with the correct event type + resolution template preselected.
                </Typography>
                <IconButton onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}><CloseIcon /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                {TILES.map((section) => (
                    <Box key={section.section} sx={{ mb: 2.5 }}>
                        <Typography variant="overline" fontWeight={700} color="text.secondary" letterSpacing={0.6} display="block" mb={1}>
                            {section.section}
                        </Typography>
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 1.25 }}>
                            {section.tiles.map((t) => (
                                <Box
                                    key={t.eventType}
                                    onClick={() => onPick(t.eventType)}
                                    sx={{
                                        p: 1.5,
                                        borderRadius: 1.5,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        borderLeft: `4px solid ${t.accent}`,
                                        bgcolor: 'white',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        gap: 1.25,
                                        alignItems: 'flex-start',
                                        transition: 'all 0.15s',
                                        '&:hover': {
                                            bgcolor: `${t.accent}08`,
                                            borderColor: t.accent,
                                            transform: 'translateY(-1px)',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.08)',
                                        },
                                    }}
                                >
                                    <Box sx={{ color: t.accent, mt: 0.25, flexShrink: 0, display: 'flex' }}>{t.icon}</Box>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant="body2" fontWeight={700} color="text.primary" mb={0.25}>{t.label}</Typography>
                                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45 }}>{t.body}</Typography>
                                    </Box>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                ))}
            </DialogContent>
        </Dialog>
    );
};

export default ChangeWizard;
