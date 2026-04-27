import React, { useEffect, useState } from "react";
import {
    Box, Typography, Paper, List, ListItem, ListItemText, IconButton, Divider, CircularProgress,
    Chip, Dialog, DialogTitle, DialogContent, DialogActions, Button, Autocomplete, TextField
} from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import VisibilityIcon from "@mui/icons-material/Visibility";
import MenuBookIcon from "@mui/icons-material/MenuBook";
import api from "../utils/api";

interface DocumentRecord {
    _id: string;
    title: string;
    type: string;
    version: number;
    generatedAt: string;
}

interface PreviewState {
    url: string;
    title: string;
    type: string;
    filename: string;
}

const DocumentManagement = () => {
    const [companies, setCompanies] = useState<any[]>([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [busy, setBusy] = useState<{ type: string; mode: 'preview' | 'download' } | null>(null);
    const [history, setHistory] = useState<DocumentRecord[]>([]);
    const [preview, setPreview] = useState<PreviewState | null>(null);

    const templates = [
        { id: 'glossary', name: 'Glossary' },
        { id: 'articles_of_incorporation', name: 'Articles of Incorporation' },
        { id: 'by_laws', name: 'By-Laws No. 1' },
        { id: 'organizational_resolution', name: 'Organizational Resolution (Directors)' },
        { id: 'shareholders_organizational_resolution', name: 'Organizational Resolution (Shareholders)' },
        { id: 'consent_to_act', name: 'Consent to Act as Director' },
        { id: 'annual_director_resolution', name: 'Annual Director Resolution' },
        { id: 'annual_shareholder_resolution', name: 'Annual Shareholder Resolution' },
        { id: 'share_certificate', name: 'Share Certificate' },
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
                if (data.length > 0) setSelectedCompanyId(data[0]._id);
            } catch (error) {
                console.error('Error fetching companies:', error);
            }
        };
        fetchCompanies();
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

    const generateBlob = async (documentType: string): Promise<Blob> => {
        const response = await api.post(
            '/documents/generate',
            { companyId: selectedCompanyId, documentType },
            { responseType: 'blob' }
        );
        return new Blob([response.data], { type: 'application/pdf' });
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
        setBusy({ type: documentType, mode: 'download' });
        try {
            const blob = await generateBlob(documentType);
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
            alert('Failed to generate document. Make sure the backend form data is complete.');
        } finally {
            setBusy(null);
        }
    };

    const handleCompileMinuteBook = async () => {
        if (!selectedCompanyId) return;
        setBusy({ type: 'minute_book', mode: 'download' });
        try {
            const response = await api.post(
                '/documents/compile',
                { companyId: selectedCompanyId },
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
        } catch (error) {
            console.error('Failed to compile minute book:', error);
            alert('Failed to compile minute book. Make sure all company details are complete.');
        } finally {
            setBusy(null);
        }
    };

    const handlePreviewMinuteBook = async () => {
        if (!selectedCompanyId) return;
        setBusy({ type: 'minute_book', mode: 'preview' });
        try {
            const response = await api.post(
                '/documents/compile',
                { companyId: selectedCompanyId },
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
        } catch (error) {
            console.error('Failed to preview minute book:', error);
            alert('Failed to compile minute book.');
        } finally {
            setBusy(null);
        }
    };

    const handlePreview = async (documentType: string) => {
        if (!selectedCompanyId) return;
        setBusy({ type: documentType, mode: 'preview' });
        try {
            const blob = await generateBlob(documentType);
            const url = window.URL.createObjectURL(blob);
            setPreview({
                url,
                title: titleFor(documentType),
                type: documentType,
                filename: `generated_${documentType}.pdf`,
            });
            await refreshHistory();
        } catch (error) {
            console.error('Failed to preview document:', error);
            alert('Failed to generate preview.');
        } finally {
            setBusy(null);
        }
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
                        onClick={handlePreviewMinuteBook}
                        disabled={!selectedCompanyId || isAnyBusy('minute_book')}
                    >
                        {isBusy('minute_book', 'preview') ? <CircularProgress size={20} sx={{ color: 'white' }} /> : <VisibilityIcon />}
                    </IconButton>
                    <Button
                        variant="contained"
                        sx={{ bgcolor: 'white', color: '#1a237e', '&:hover': { bgcolor: '#e8eaf6' } }}
                        startIcon={isBusy('minute_book', 'download') ? <CircularProgress size={16} /> : <DownloadIcon />}
                        onClick={handleCompileMinuteBook}
                        disabled={!selectedCompanyId || isAnyBusy('minute_book')}
                    >
                        Generate Minute Book
                    </Button>
                </Box>

                <Typography variant="h6" sx={{ mt: 4 }}>Generate New Document</Typography>
                <List>
                    {templates.map((doc) => (
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
                </List>

                <Typography variant="h6" sx={{ mt: 4 }}>Generation History</Typography>
                {history.length === 0 ? (
                    <Typography variant="body2" color="textSecondary" sx={{ mt: 1 }}>
                        No documents generated yet for this company.
                    </Typography>
                ) : (
                    <List>
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
                                        secondary={`Generated ${new Date(record.generatedAt).toLocaleString()}`}
                                    />
                                </ListItem>
                                <Divider component="li" />
                            </React.Fragment>
                        ))}
                    </List>
                )}
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
        </Box>
    );
};

export default DocumentManagement;
