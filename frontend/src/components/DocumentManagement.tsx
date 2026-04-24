import React, { useEffect, useState } from "react";
import { Box, Typography, Paper, List, ListItem, ListItemText, IconButton, Divider, CircularProgress, Select, MenuItem, InputLabel, FormControl } from "@mui/material";
import DownloadIcon from "@mui/icons-material/Download";
import { useSelector } from "react-redux";
import api from "../utils/api";

const DocumentManagement = () => {
    const { user } = useSelector((state: any) => state.auth);
    const [companies, setCompanies] = useState<any[]>([]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
    const [isGenerating, setIsGenerating] = useState<string | null>(null);

    // Document types we support generating natively right now
    const templates = [
        { id: 'articles_of_incorporation', name: 'Articles of Incorporation' },
        { id: 'by_laws', name: 'By-Laws No. 1' }
    ];

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

    const handleDownload = async (documentType: string) => {
        if (!selectedCompanyId) return;

        setIsGenerating(documentType);
        try {
            const response = await api.post('/documents/generate', {
                companyId: selectedCompanyId,
                documentType
            }, {
                responseType: 'blob' // Important for receiving the raw PDF buffer
            });

            // Create a pseudo download link in the browser
            const url = window.URL.createObjectURL(new Blob([response.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `generated_${documentType}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (error) {
            console.error('Failed to generate document:', error);
            alert('Failed to generate document. Make sure the backend form data is complete.');
        } finally {
            setIsGenerating(null);
        }
    };

    return (
        <Box p={4} display="flex" justifyContent="center">
            <Paper elevation={3} sx={{ p: 4, width: "100%", maxWidth: 800 }}>
                <Typography variant="h5" gutterBottom>
                    Document Vault
                </Typography>
                <Typography variant="subtitle1" gutterBottom color="textSecondary">
                    Generate and download your corporate documents instantly.
                </Typography>
                <Divider sx={{ my: 2 }} />

                <FormControl fullWidth margin="normal">
                    <InputLabel id="company-select-label">Select Company</InputLabel>
                    <Select
                        labelId="company-select-label"
                        value={selectedCompanyId}
                        label="Select Company"
                        onChange={(e) => setSelectedCompanyId(e.target.value)}
                    >
                        {companies.length === 0 ? (
                            <MenuItem value="" disabled>No companies found</MenuItem>
                        ) : (
                            companies.map(c => (
                                <MenuItem key={c._id} value={c._id}>{c.name}</MenuItem>
                            ))
                        )}
                    </Select>
                </FormControl>

                <List sx={{ mt: 2 }}>
                    {templates.map((doc) => (
                        <React.Fragment key={doc.id}>
                            <ListItem
                                secondaryAction={
                                    <IconButton
                                        edge="end"
                                        aria-label="download"
                                        onClick={() => handleDownload(doc.id)}
                                        disabled={isGenerating === doc.id || !selectedCompanyId}
                                        color="primary"
                                    >
                                        {isGenerating === doc.id ? <CircularProgress size={24} /> : <DownloadIcon />}
                                    </IconButton>
                                }
                            >
                                <ListItemText
                                    primary={doc.name}
                                    secondary={`Format: PDF | Automatically generated from latest company data`}
                                />
                            </ListItem>
                            <Divider component="li" />
                        </React.Fragment>
                    ))}
                </List>
            </Paper>
        </Box>
    );
};

export default DocumentManagement;
