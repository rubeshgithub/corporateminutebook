import React from 'react';
import { Box, Typography, Paper, Button } from '@mui/material';
import FiberNewIcon from '@mui/icons-material/FiberNew';
import HistoryEduIcon from '@mui/icons-material/HistoryEdu';
import { useNavigate } from 'react-router-dom';

const card = {
    p: 3, border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'white',
    display: 'flex', flexDirection: 'column', gap: 1.5, flex: '1 1 300px',
} as const;

/** Start of every new minute book: a corporation that was just formed, or one that already has a history. */
const NewCompanyChoice: React.FC = () => {
    const navigate = useNavigate();
    return (
        <Box sx={{ p: 3, bgcolor: '#f5f6fa', minHeight: '100vh' }}>
            <Box mb={2.5}>
                <Typography variant="h5" fontWeight={700} lineHeight={1.2}>Add a corporation</Typography>
                <Typography variant="body2" color="text.secondary" mt={0.3}>
                    Is this corporation new, or does it already have a history?
                </Typography>
            </Box>

            <Box display="flex" gap={2.5} flexWrap="wrap" sx={{ maxWidth: 900 }}>
                <Paper elevation={0} sx={card}>
                    <FiberNewIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={700}>New corporation</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6, flex: 1 }}>
                        Just incorporated. Enter its details or upload the incorporation documents, and we prepare
                        the organizational minute book: by-laws, first resolutions, registers and share certificates.
                    </Typography>
                    <Button variant="outlined" onClick={() => navigate('/builder')}>Start a new minute book</Button>
                </Paper>

                <Paper elevation={0} sx={card}>
                    <HistoryEduIcon color="primary" />
                    <Typography variant="subtitle1" fontWeight={700}>Existing corporation</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.6, flex: 1 }}>
                        Already operating. Upload its current registry profile report and we rebuild its history —
                        directors, officers, annual returns and filings — with a place for every document and proof
                        of filing still needed.
                    </Typography>
                    <Button variant="contained" onClick={() => navigate('/import')}>Upload a profile report</Button>
                </Paper>
            </Box>
        </Box>
    );
};

export default NewCompanyChoice;
