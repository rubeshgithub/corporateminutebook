import React, { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    Box, Typography, Paper, List, ListItem, ListItemText, IconButton, Divider, CircularProgress,
    Chip, Dialog, DialogTitle, DialogContent, DialogActions, Button, Autocomplete, TextField,
    Accordion, AccordionSummary, AccordionDetails, InputAdornment,
    FormGroup, FormControlLabel, Checkbox, Alert
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import api from "../utils/api";
import { useSnackbar } from "../context/SnackbarContext";

interface ComplianceWarning {
    status: 'compliance_warning';
    gaps: string[];
}

interface DocumentRecord {
    _id: string;
    title: string;
    type: string;
    version: number;
    generatedAt: string;
    generatedBy?: { name: string; email: string };
}

interface PreviewState {
    url: string;
    title: string;
    type: string;
    filename: string;
}

const DocumentManagement = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const incomingCompanyId = (location.state as any)?.companyId || '';
    const { showSnackbar } = useSnackbar();
    const [companies, setCompanies] = useState<any[]>([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [busy, setBusy] = useState<{ type: string; mode: 'preview' | 'download' } | null>(null);
    const [history, setHistory] = useState<DocumentRecord[]>([]);
    const [preview, setPreview] = useState<PreviewState | null>(null);
    const [docSearch, setDocSearch] = useState('');
    const [complianceDialog, setComplianceDialog] = useState<{
        open: boolean;
        gaps: string[];
        pendingMode: 'download' | 'preview';
    }>({ open: false, gaps: [], pendingMode: 'download' });

    // Annual resolution wizard state
    const [resolutionDialog, setResolutionDialog] = useState<{ open: boolean; docType: string; pendingMode: 'preview' | 'download' }>({ open: false, docType: '', pendingMode: 'download' });
    const [resYear, setResYear] = useState(new Date().getFullYear() - 1);
    const [resDate, setResDate] = useState(new Date().toISOString().slice(0, 10));
    const [resDirectors, setResDirectors] = useState<string[]>([]);
    const [resCustom, setResCustom] = useState<{ title: string; text: string }[]>([]);

    const templates = [
        { id: 'glossary', name: 'Glossary' },
        { id: 'articles_of_incorporation', name: 'Articles of Incorporation' },
        { id: 'schedule_a', name: 'Schedule A — Share Capital' },
        { id: 'by_laws', name: 'By-Laws No. 1' },
        { id: 'organizational_resolution', name: 'Organizational Resolution (Directors)' },
        { id: 'shareholders_organizational_resolution', name: 'Organizational Resolution (Shareholders)' },
        { id: 'consent_to_act', name: 'Consent to Act as Director' },
        { id: 'annual_director_resolution', name: 'Annual Director Resolution' },
        { id: 'annual_shareholder_resolution', name: 'Annual Shareholder Resolution' },
        { id: 'share_subscription', name: 'Share Subscriptions' },
        { id: 'share_certificate', name: 'Share Certificate' },
        { id: 'share_ledger', name: 'Share Ledgers' },
        { id: 'share_transfer_register', name: 'Share Transfer Register' },
        { id: 'registers', name: 'Corporate Registers' },
    ];

    const titleFor = (type: string) =>
        templates.find((t) => t.id === type)?.name ||
        history.find((h) => h.type === type)?.title ||
        type;

    useEffect(() => {
        const fetchCompanies = async () => {
            try {
                const { data } = await api.get('/companies');
                setCompanies(data);
                if (data.length > 0) {
                    const preselect = incomingCompanyId && data.some((c: any) => c._id === incomingCompanyId)
                        ? incomingCompanyId
                        : data[0]._id;
                    setSelectedCompanyId(preselect);
                }
            } catch (error) {
                console.error('Error fetching companies:', error);
            }
        };
        fetchCompanies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!selectedCompanyId) {
            setHistory([]);
            return;
        }
        const fetchHistory = async () => {
            try {
                const { data } = await api.get(`/documents/${selectedCompanyId}`);
                setHistory(data);
            } catch (error) {
                console.error('Error fetching document history:', error);
                setHistory([]);
            }
        };
        fetchHistory();
    }, [selectedCompanyId]);

    const ANNUAL_RESOLUTION_TYPES = new Set(['annual_director_resolution', 'annual_shareholder_resolution']);

    const generateBlob = async (documentType: string, resolutionData?: object): Promise<Blob> => {
        const response = await api.post(
            '/documents/generate',
            { companyId: selectedCompanyId, documentType, ...(resolutionData ? { resolutionData } : {}) },
            { responseType: 'blob' }
        );
        return new Blob([response.data], { type: 'application/pdf' });
    };

    const openResolutionDialog = (docType: string, mode: 'preview' | 'download') => {
        const company = companies.find((c) => c._id === selectedCompanyId);
        const activeDirectors = (company?.directors || [])
            .filter((d: any) => !d.resignedDate)
            .map((d: any) => d.name || [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ').trim());
        setResDirectors(activeDirectors);
        setResYear(new Date().getFullYear() - 1);
        setResDate(new Date().toISOString().slice(0, 10));
        setResCustom([]);
        setResolutionDialog({ open: true, docType, pendingMode: mode });
    };

    const confirmResolution = async () => {
        const { docType, pendingMode } = resolutionDialog;
        const company = companies.find((c) => c._id === selectedCompanyId);
        const allDirectors = (company?.directors || []).map((d: any) => ({
            name: d.name || [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ').trim(),
            appointedDate: d.appointedDate,
            resignedDate: d.resignedDate,
        }));
        const resolutionData = {
            fiscalYear: resYear,
            resolutionDate: resDate,
            directors: allDirectors.filter((d: { name: string }) => resDirectors.includes(d.name)),
            customResolutions: resCustom.filter((r) => r.title || r.text),
        };
        setResolutionDialog((prev) => ({ ...prev, open: false }));
        if (pendingMode === 'preview') {
            await handlePreviewWithData(docType, resolutionData);
        } else {
            await handleDownloadWithData(docType, resolutionData);
        }
    };

    const handleDownloadWithData = async (documentType: string, resolutionData?: object) => {
        if (!selectedCompanyId) return;
        setBusy({ type: documentType, mode: 'download' });
        try {
            const blob = await generateBlob(documentType, resolutionData);
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `generated_${documentType}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            await refreshHistory();
        } catch (error) {
            console.error('Failed to generate document:', error);
            showSnackbar('Failed to generate document. Make sure all company details are complete.', 'error');
        } finally {
            setBusy(null);
        }
    };

    const handlePreviewWithData = async (documentType: string, resolutionData?: object) => {
        if (!selectedCompanyId) return;
        setBusy({ type: documentType, mode: 'preview' });
        try {
            const blob = await generateBlob(documentType, resolutionData);
            const url = window.URL.createObjectURL(blob);
            setPreview({ url, title: titleFor(documentType), type: documentType, filename: `${documentType}.pdf` });
        } catch (error) {
            console.error('Failed to preview document:', error);
            showSnackbar('Failed to generate preview.', 'error');
        } finally {
            setBusy(null);
        }
    };

    const refreshHistory = async () => {
        try {
            const { data } = await api.get(`/documents/${selectedCompanyId}`);
            setHistory(data);
        } catch (error) {
            console.error('Error refreshing history:', error);
        }
    };

    const handleDownload = async (documentType: string) => {
        if (!selectedCompanyId) return;
        if (ANNUAL_RESOLUTION_TYPES.has(documentType)) { openResolutionDialog(documentType, 'download'); return; }
        await handleDownloadWithData(documentType);
    };

    const parseComplianceError = async (error: any): Promise<ComplianceWarning | null> => {
        if (error.response?.status !== 409) return null;
        try {
            const text = await (error.response.data as Blob).text();
            const parsed = JSON.parse(text);
            if (parsed?.status === 'compliance_warning') return parsed as ComplianceWarning;
        } catch {}
        return null;
    };

    /**
     * Purpose-driven bundle downloads. Each is a filtered slice of the full
     * minute book aimed at a specific audience — a bank credit file, a
     * buyer's due-diligence data room, or a CRA audit response — instead
     * of the everything-in-one compile. Backend filters the event list
     * per bundle type; the render pipeline is shared.
     */
    const [bundleBusy, setBundleBusy] = React.useState<'bank' | 'dd' | 'cra' | null>(null);
    const handleDownloadBundle = async (bundleType: 'bank' | 'dd' | 'cra') => {
        if (!selectedCompanyId) return;
        setBundleBusy(bundleType);
        try {
            const response = await api.post(
                `/documents/bundle/${bundleType}`,
                { companyId: selectedCompanyId },
                { responseType: 'blob' },
            );
            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const filenames = { bank: 'bank_package.pdf', dd: 'due_diligence_package.pdf', cra: 'cra_audit_package.pdf' };
            link.setAttribute('download', filenames[bundleType]);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            await refreshHistory();
        } catch {
            showSnackbar('Failed to generate the bundle. Please try again.', 'error');
        } finally {
            setBundleBusy(null);
        }
    };

    const handleCompileMinuteBook = async (force = false) => {
        if (!selectedCompanyId) return;
        setBusy({ type: 'minute_book', mode: 'download' });
        try {
            const response = await api.post(
                '/documents/compile',
                { companyId: selectedCompanyId, force },
                { responseType: 'blob' }
            );
            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `minute_book.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            await refreshHistory();
        } catch (error: any) {
            const warning = await parseComplianceError(error);
            if (warning) {
                setComplianceDialog({ open: true, gaps: warning.gaps, pendingMode: 'download' });
            } else {
                showSnackbar('Failed to compile minute book. Make sure all company details are complete.', 'error');
            }
        } finally {
            setBusy(null);
        }
    };

    const handlePreviewMinuteBook = async (force = false) => {
        if (!selectedCompanyId) return;
        setBusy({ type: 'minute_book', mode: 'preview' });
        try {
            const response = await api.post(
                '/documents/compile',
                { companyId: selectedCompanyId, force },
                { responseType: 'blob' }
            );
            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            setPreview({
                url,
                title: 'Compiled Minute Book',
                type: 'minute_book',
                filename: 'minute_book.pdf',
            });
            await refreshHistory();
        } catch (error: any) {
            const warning = await parseComplianceError(error);
            if (warning) {
                setComplianceDialog({ open: true, gaps: warning.gaps, pendingMode: 'preview' });
            } else {
                showSnackbar('Failed to compile minute book.', 'error');
            }
        } finally {
            setBusy(null);
        }
    };

    const handlePreview = async (documentType: string) => {
        if (!selectedCompanyId) return;
        if (ANNUAL_RESOLUTION_TYPES.has(documentType)) { openResolutionDialog(documentType, 'preview'); return; }
        await handlePreviewWithData(documentType);
    };

    const handleClosePreview = () => {
        if (preview) window.URL.revokeObjectURL(preview.url);
        setPreview(null);
    };

    const handleDownloadFromPreview = () => {
        if (!preview) return;
        const link = document.createElement('a');
        link.href = preview.url;
        link.setAttribute('download', preview.filename);
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const isBusy = (documentType: string, mode: 'preview' | 'download') =>
        busy?.type === documentType && busy?.mode === mode;

    const isAnyBusy = (documentType: string) => busy?.type === documentType;

    return (
        <Box p={4} display="flex" justifyContent="center">
            <Paper elevation={3} sx={{ p: 4, width: "100%", maxWidth: 800 }}>
                <Typography variant="h5" gutterBottom>
                    Document Vault
                </Typography>
                <Typography variant="subtitle1" gutterBottom color="textSecondary">
                    Preview, generate, and download your corporate documents.
                </Typography>
                <Divider sx={{ my: 2 }} />

                <Autocomplete
                    sx={{ mt: 2, mb: 1 }}
                    options={companies}
                    getOptionLabel={(c: any) => c?.name || ''}
                    isOptionEqualToValue={(opt: any, val: any) => opt._id === val._id}
                    value={companies.find((c) => c._id === selectedCompanyId) || null}
                    onChange={(_e, newValue: any) => setSelectedCompanyId(newValue?._id || '')}
                    noOptionsText={companies.length === 0 ? 'No companies found' : 'No matches'}
                    renderInput={(params) => (
                        <TextField {...params} label="Select Company" placeholder="Type to search…" />
                    )}
                    renderOption={(props, option: any) => (
                        <li {...props} key={option._id}>
                            <Box>
                                <Typography variant="body1">{option.name}</Typography>
                                {option.corporateAccessNumber && (
                                    <Typography variant="caption" color="textSecondary">
                                        CAN: {option.corporateAccessNumber}
                                    </Typography>
                                )}
                            </Box>
                        </li>
                    )}
                />


                <Box
                    sx={{
                        mt: 4,
                        p: 3,
                        borderRadius: 2,
                        background: 'linear-gradient(135deg, #0d1b3d 0%, #1a237e 60%, #283593 100%)',
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                    }}
                >
                    <MenuBookIcon sx={{ fontSize: 48, opacity: 0.9 }} />
                    <Box sx={{ flexGrow: 1 }}>
                        <Typography variant="h6">Compiled Minute Book</Typography>
                        <Typography variant="body2" sx={{ opacity: 0.9 }}>
                            One PDF: cover page, table of contents, articles, by-laws, resolutions, consents, share certificates and registers.
                        </Typography>
                    </Box>
                    <IconButton
                        title="Preview"
                        sx={{ color: 'white', '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' } }}
                        onClick={() => handlePreviewMinuteBook()}
                        disabled={!selectedCompanyId || isAnyBusy('minute_book')}
                    >
                        {isBusy('minute_book', 'preview') ? <CircularProgress size={20} sx={{ color: 'white' }} /> : <VisibilityIcon />}
                    </IconButton>
                    <Button
                        variant="contained"
                        sx={{ bgcolor: 'white', color: '#1a237e', '&:hover': { bgcolor: '#e8eaf6' } }}
                        startIcon={isBusy('minute_book', 'download') ? <CircularProgress size={16} /> : <DownloadIcon />}
                        onClick={() => handleCompileMinuteBook()}
                        disabled={!selectedCompanyId || isAnyBusy('minute_book')}
                    >
                        Generate Minute Book
                    </Button>
                </Box>

                {/* Purpose-driven bundles — each is a curated slice aimed at a
                    specific audience (lender / buyer / CRA), so the person
                    receiving it doesn't have to skim through a hundred-page
                    everything-book to find the five documents they care about. */}
                <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle2" fontWeight={700} color="text.secondary" textTransform="uppercase" letterSpacing={0.6} sx={{ mb: 1.25, fontSize: 11 }}>
                        Purpose-driven bundles
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 1.5 }}>
                        {([
                            {
                                key:  'bank' as const,
                                title: 'Bank / Lender package',
                                body:  'Articles + registers + most-recent annual return. What a credit officer actually needs to open a loan file.',
                                accent: '#1565c0',
                            },
                            {
                                key:  'dd' as const,
                                title: 'Due Diligence package',
                                body:  'Full historical minute book. Every resolution, every filing, in order — buyer\'s counsel edition.',
                                accent: '#8a6d1f',
                            },
                            {
                                key:  'cra' as const,
                                title: 'CRA Audit package',
                                body:  'Annual returns + shareholder + director + share-structure history. What CRA looks at first.',
                                accent: '#2e7d32',
                            },
                        ]).map((b) => (
                            <Box
                                key={b.key}
                                sx={{
                                    p: 2,
                                    borderRadius: 2,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    borderLeft: `4px solid ${b.accent}`,
                                    bgcolor: 'white',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 1,
                                }}
                            >
                                <Typography variant="subtitle2" fontWeight={700} color="text.primary">
                                    {b.title}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ flex: 1, lineHeight: 1.55 }}>
                                    {b.body}
                                </Typography>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={bundleBusy === b.key ? <CircularProgress size={14} /> : <DownloadIcon fontSize="small" />}
                                    onClick={() => handleDownloadBundle(b.key)}
                                    disabled={!selectedCompanyId || bundleBusy !== null}
                                    sx={{
                                        alignSelf: 'flex-start',
                                        textTransform: 'none',
                                        fontWeight: 600,
                                        color: b.accent,
                                        borderColor: b.accent,
                                        '&:hover': { borderColor: b.accent, bgcolor: `${b.accent}0d` },
                                    }}
                                >
                                    Download
                                </Button>
                            </Box>
                        ))}
                    </Box>
                </Box>

                {/* Generate New Document accordion */}
                <Accordion defaultExpanded={false} sx={{ mt: 3 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="h6">Generate New Document</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0 }}>
                        <TextField
                            size="small"
                            fullWidth
                            placeholder="Search documents…"
                            value={docSearch}
                            onChange={(e) => setDocSearch(e.target.value)}
                            sx={{ mb: 1 }}
                            InputProps={{
                                startAdornment: (
                                    <InputAdornment position="start">
                                        <SearchIcon fontSize="small" />
                                    </InputAdornment>
                                ),
                            }}
                        />
                        <List disablePadding>
                            {templates
                                .filter((doc) => doc.name.toLowerCase().includes(docSearch.toLowerCase()))
                                .map((doc) => (
                                    <React.Fragment key={doc.id}>
                                        <ListItem
                                            secondaryAction={
                                                <Box>
                                                    <IconButton
                                                        aria-label="preview"
                                                        onClick={() => handlePreview(doc.id)}
                                                        disabled={isAnyBusy(doc.id) || !selectedCompanyId}
                                                        color="primary"
                                                        title="Preview"
                                                    >
                                                        {isBusy(doc.id, 'preview') ? <CircularProgress size={24} /> : <VisibilityIcon />}
                                                    </IconButton>
                                                    <IconButton
                                                        edge="end"
                                                        aria-label="download"
                                                        onClick={() => handleDownload(doc.id)}
                                                        disabled={isAnyBusy(doc.id) || !selectedCompanyId}
                                                        color="primary"
                                                        title="Download"
                                                    >
                                                        {isBusy(doc.id, 'download') ? <CircularProgress size={24} /> : <DownloadIcon />}
                                                    </IconButton>
                                                </Box>
                                            }
                                        >
                                            <ListItemText
                                                primary={doc.name}
                                                secondary="Format: PDF | Generated from latest company data"
                                            />
                                        </ListItem>
                                        <Divider component="li" />
                                    </React.Fragment>
                                ))}
                            {templates.filter((doc) => doc.name.toLowerCase().includes(docSearch.toLowerCase())).length === 0 && (
                                <Typography variant="body2" color="textSecondary" sx={{ py: 2, textAlign: 'center' }}>
                                    No documents match your search.
                                </Typography>
                            )}
                        </List>
                    </AccordionDetails>
                </Accordion>

                {/* Generation History accordion */}
                <Accordion defaultExpanded={false} sx={{ mt: 1 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="h6">Generation History</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{ pt: 0 }}>
                        {history.length === 0 ? (
                            <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                                No documents generated yet for this company.
                            </Typography>
                        ) : (
                            <List disablePadding>
                                {history.map((record) => (
                                    <React.Fragment key={record._id}>
                                        <ListItem
                                            secondaryAction={
                                                <Box>
                                                    <IconButton
                                                        aria-label="preview"
                                                        onClick={() => handlePreview(record.type)}
                                                        disabled={isAnyBusy(record.type) || !selectedCompanyId}
                                                        color="primary"
                                                        title="Preview latest"
                                                    >
                                                        {isBusy(record.type, 'preview') ? <CircularProgress size={24} /> : <VisibilityIcon />}
                                                    </IconButton>
                                                    <IconButton
                                                        edge="end"
                                                        aria-label="re-download"
                                                        onClick={() => handleDownload(record.type)}
                                                        disabled={isAnyBusy(record.type) || !selectedCompanyId}
                                                        color="primary"
                                                        title="Re-download"
                                                    >
                                                        {isBusy(record.type, 'download') ? <CircularProgress size={24} /> : <DownloadIcon />}
                                                    </IconButton>
                                                </Box>
                                            }
                                        >
                                            <ListItemText
                                                primary={
                                                    <Box display="flex" alignItems="center" gap={1}>
                                                        {record.title}
                                                        <Chip label={`v${record.version}`} size="small" />
                                                    </Box>
                                                }
                                                secondary={
                                                    `${new Date(record.generatedAt).toLocaleString()}` +
                                                    (record.generatedBy ? ` · ${record.generatedBy.name}` : '')
                                                }
                                            />
                                        </ListItem>
                                        <Divider component="li" />
                                    </React.Fragment>
                                ))}
                            </List>
                        )}
                    </AccordionDetails>
                </Accordion>
            </Paper>

            <Dialog open={!!preview} onClose={handleClosePreview} fullWidth maxWidth="lg">
                <DialogTitle>{preview?.title}</DialogTitle>
                <DialogContent dividers sx={{ p: 0, height: '75vh' }}>
                    {preview && (
                        <iframe
                            title={preview.title}
                            src={preview.url}
                            width="100%"
                            height="100%"
                            style={{ border: 'none' }}
                        />
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleClosePreview}>Close</Button>
                    <Button
                        onClick={handleDownloadFromPreview}
                        variant="contained"
                        startIcon={<DownloadIcon />}
                    >
                        Download
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ── Compliance Warning Dialog ── */}
            <Dialog
                open={complianceDialog.open}
                onClose={() => setComplianceDialog((p) => ({ ...p, open: false }))}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <WarningAmberIcon color="warning" />
                    Compliance Issues Detected
                </DialogTitle>
                <DialogContent>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        The minute book cannot be fully compiled because the following compliance gaps exist.
                        You can fix these first or proceed and generate an incomplete minute book.
                    </Alert>
                    <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                        {complianceDialog.gaps.map((gap, i) => (
                            <li key={i}>
                                <Typography variant="body2">{gap}</Typography>
                            </li>
                        ))}
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => {
                            setComplianceDialog((p) => ({ ...p, open: false }));
                            navigate(`/records/${selectedCompanyId}`);
                        }}
                        color="primary"
                    >
                        Fix Issues First
                    </Button>
                    <Button
                        variant="contained"
                        color="warning"
                        onClick={() => {
                            setComplianceDialog((p) => ({ ...p, open: false }));
                            if (complianceDialog.pendingMode === 'preview') {
                                handlePreviewMinuteBook(true);
                            } else {
                                handleCompileMinuteBook(true);
                            }
                        }}
                    >
                        Proceed Anyway
                    </Button>
                </DialogActions>
            </Dialog>

            {/* ── Annual Resolutions Config Dialog ── */}
            <Dialog open={resolutionDialog.open} onClose={() => setResolutionDialog((p) => ({ ...p, open: false }))} maxWidth="sm" fullWidth>
                <DialogTitle>
                    {resolutionDialog.docType === 'annual_director_resolution'
                        ? 'Annual Director Resolution'
                        : 'Annual Shareholder Resolution'}
                </DialogTitle>
                <DialogContent>
                    <Box pt={1} display="flex" flexDirection="column" gap={2.5}>
                        <Box display="flex" gap={2}>
                            <TextField
                                label="Fiscal Year"
                                type="number"
                                size="small"
                                sx={{ width: 140 }}
                                value={resYear}
                                onChange={(e) => setResYear(Number(e.target.value))}
                                helperText="Year the resolutions cover"
                            />
                            <TextField
                                label="Resolution Date"
                                type="date"
                                size="small"
                                sx={{ flex: 1 }}
                                InputLabelProps={{ shrink: true }}
                                value={resDate}
                                onChange={(e) => setResDate(e.target.value)}
                                helperText="Date the resolution is signed"
                            />
                        </Box>

                        <Box>
                            <Typography variant="subtitle2" mb={0.5}>Directors to include</Typography>
                            <FormGroup>
                                {(() => {
                                    const company = companies.find((c) => c._id === selectedCompanyId);
                                    return (company?.directors || []).map((d: Record<string, any>) => {
                                        const name = d.name || [d.firstName, d.middleName, d.lastName].filter(Boolean).join(' ').trim();
                                        return (
                                            <FormControlLabel
                                                key={name}
                                                control={
                                                    <Checkbox
                                                        size="small"
                                                        checked={resDirectors.includes(name)}
                                                        onChange={(e) => setResDirectors((prev) =>
                                                            e.target.checked ? [...prev, name] : prev.filter((n) => n !== name)
                                                        )}
                                                    />
                                                }
                                                label={
                                                    <Typography variant="body2">
                                                        {name}
                                                        {d.resignedDate && <Chip label="resigned" size="small" color="error" sx={{ ml: 1, height: 16, fontSize: 10 }} />}
                                                    </Typography>
                                                }
                                            />
                                        );
                                    });
                                })()}
                            </FormGroup>
                        </Box>

                        <Box>
                            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                                <Typography variant="subtitle2">Additional Resolutions</Typography>
                                <Button size="small" startIcon={<AddIcon />} onClick={() => setResCustom((p) => [...p, { title: '', text: '' }])}>
                                    Add
                                </Button>
                            </Box>
                            {resCustom.map((cr, i) => (
                                <Box key={i} display="flex" gap={1} mb={1.5} alignItems="flex-start">
                                    <Box flex={1} display="flex" flexDirection="column" gap={1}>
                                        <TextField
                                            label="Resolution Title"
                                            size="small"
                                            fullWidth
                                            placeholder="e.g. OFFICER COMPENSATION"
                                            value={cr.title}
                                            onChange={(e) => setResCustom((p) => p.map((r, j) => j === i ? { ...r, title: e.target.value } : r))}
                                        />
                                        <TextField
                                            label="Resolution Text"
                                            size="small"
                                            fullWidth
                                            multiline
                                            rows={2}
                                            placeholder="RESOLVED THAT…"
                                            value={cr.text}
                                            onChange={(e) => setResCustom((p) => p.map((r, j) => j === i ? { ...r, text: e.target.value } : r))}
                                        />
                                    </Box>
                                    <IconButton size="small" onClick={() => setResCustom((p) => p.filter((_, j) => j !== i))} sx={{ mt: 0.5 }}>
                                        <DeleteIcon fontSize="small" />
                                    </IconButton>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setResolutionDialog((p) => ({ ...p, open: false }))}>Cancel</Button>
                    <Button
                        variant="contained"
                        startIcon={resolutionDialog.pendingMode === 'preview' ? <VisibilityIcon /> : <DownloadIcon />}
                        onClick={confirmResolution}
                        disabled={!!busy}
                    >
                        {resolutionDialog.pendingMode === 'preview' ? 'Preview' : 'Download'}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default DocumentManagement;
