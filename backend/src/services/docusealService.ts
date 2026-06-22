import axios from 'axios';
import jwt from 'jsonwebtoken';

const BASE_URL = 'https://api.docuseal.co';

const headers = () => ({
    'X-Auth-Token': process.env.DOCUSEAL_API_KEY || '',
    'Content-Type': 'application/json',
});

export interface DocuSealSubmission {
    submissionId: number;
    signingUrl: string;
    status: string;
}

const docusealError = (err: unknown, step: string): never => {
    const e = err as any;
    const body = e?.response?.data;
    const detail = body ? JSON.stringify(body) : e?.message ?? String(err);
    console.error(`[DocuSeal] ${step} error:`, detail);
    throw new Error(`DocuSeal ${step}: ${detail}`);
};

export const createESignRequest = async (opts: {
    pdfBuffer: Buffer;
    documentName: string;
    recipientName: string;
    recipientEmail: string;
}): Promise<DocuSealSubmission> => {
    const { pdfBuffer, documentName, recipientName, recipientEmail } = opts;

    if (!process.env.DOCUSEAL_API_KEY) {
        throw new Error('DOCUSEAL_API_KEY environment variable is not set.');
    }

    // Step 1 — create template from PDF; fields go inside documents with a role attribute
    const templateRes = await axios.post(`${BASE_URL}/templates/pdf`, {
        name: documentName,
        documents: [{
            name: `${documentName}.pdf`,
            file: pdfBuffer.toString('base64'),
            fields: [
                {
                    name: 'Signature',
                    type: 'signature',
                    role: 'First Party',
                    required: true,
                    areas: [{ x: 0.05, y: 0.82, w: 0.38, h: 0.07, page: 1 }],
                },
                {
                    name: 'Date Signed',
                    type: 'date',
                    role: 'First Party',
                    required: true,
                    areas: [{ x: 0.55, y: 0.82, w: 0.35, h: 0.07, page: 1 }],
                },
            ],
        }],
        submitters: [{ name: 'First Party' }],
    }, { headers: headers() }).catch((err) => docusealError(err, 'template creation'));

    const templateId: number = templateRes.data.id;

    // Step 2 — create submission (DocuSeal emails the recipient automatically)
    const submissionRes = await axios.post(`${BASE_URL}/submissions`, {
        template_id: templateId,
        send_email:  true,
        submitters:  [{
            role:  'First Party',
            email: recipientEmail,
            name:  recipientName,
        }],
    }, { headers: headers() }).catch((err) => docusealError(err, 'submission creation'));

    // POST /submissions returns an array of submitter objects; each has its own id (submitter)
    // and a submission_id pointing to the parent submission used for status checks.
    const sub = Array.isArray(submissionRes.data) ? submissionRes.data[0] : submissionRes.data;
    const submissionId: number = sub.submission_id ?? sub.id;

    return {
        submissionId,
        signingUrl: sub.embed_src || (sub.slug ? `https://docuseal.com/s/${sub.slug}` : '') || sub.signing_url || '',
        status:     sub.status || 'pending',
    };
};

// Create a template from a PDF without any pre-placed fields — the builder handles placement.
export const createTemplateOnly = async (pdfBuffer: Buffer, documentName: string): Promise<number> => {
    if (!process.env.DOCUSEAL_API_KEY) throw new Error('DOCUSEAL_API_KEY environment variable is not set.');
    const res = await axios.post(`${BASE_URL}/templates/pdf`, {
        name: documentName,
        documents: [{ name: `${documentName}.pdf`, file: pdfBuffer.toString('base64') }],
        submitters: [{ name: 'First Party' }],
    }, { headers: headers() }).catch((err) => docusealError(err, 'template creation'));
    return res.data.id as number;
};

// Create a template with standard signature/date fields pre-placed — used by the builder so
// the sender doesn't have to drag fields from scratch every time.
export const createTemplateWithFields = async (pdfBuffer: Buffer, documentName: string): Promise<number> => {
    if (!process.env.DOCUSEAL_API_KEY) throw new Error('DOCUSEAL_API_KEY environment variable is not set.');
    const res = await axios.post(`${BASE_URL}/templates/pdf`, {
        name: documentName,
        documents: [{
            name: `${documentName}.pdf`,
            file: pdfBuffer.toString('base64'),
            fields: [
                {
                    name: 'Signature',
                    type: 'signature',
                    role: 'First Party',
                    required: true,
                    areas: [{ x: 0.05, y: 0.82, w: 0.38, h: 0.07, page: 1 }],
                },
                {
                    name: 'Date Signed',
                    type: 'date',
                    role: 'First Party',
                    required: true,
                    areas: [{ x: 0.55, y: 0.82, w: 0.35, h: 0.07, page: 1 }],
                },
            ],
        }],
        submitters: [{ name: 'First Party' }],
    }, { headers: headers() }).catch((err) => docusealError(err, 'template creation'));
    return res.data.id as number;
};

// Sign a JWT for the DocuSeal embedded builder component.
export const createBuilderToken = (opts: {
    templateId:     number;
    userEmail:      string;
    recipientName:  string;
    recipientEmail: string;
}): string => {
    if (!process.env.DOCUSEAL_API_KEY) throw new Error('DOCUSEAL_API_KEY environment variable is not set.');
    const { templateId, userEmail, recipientName, recipientEmail } = opts;
    return jwt.sign(
        {
            user_email:  userEmail,
            template_id: templateId,
            submitters:  [{ role: 'First Party', name: recipientName, email: recipientEmail }],
        },
        process.env.DOCUSEAL_API_KEY,
        { algorithm: 'HS256', expiresIn: '1h' },
    );
};

// Tries GET /submissions/:id first; if DocuSeal returns 404 (submitter ID stored by mistake),
// falls back to GET /submitters/:id which works with a submitter ID.
export const getSubmissionStatus = async (id: number) => {
    try {
        const res = await axios.get(`${BASE_URL}/submissions/${id}`, { headers: headers() });
        return res.data;
    } catch (subErr: any) {
        if (subErr?.response?.status !== 404) {
            const body = subErr?.response?.data;
            throw new Error(`DocuSeal status: ${body ? JSON.stringify(body) : subErr.message}`);
        }
        // 404 — the stored id is likely a submitter id; try the submitters endpoint
        try {
            const res = await axios.get(`${BASE_URL}/submitters/${id}`, { headers: headers() });
            // Normalise submitter response to look like a submission response
            const d = res.data;
            return {
                status:    d.status,
                documents: d.documents ?? [],
            };
        } catch (submitterErr: any) {
            const body = submitterErr?.response?.data;
            throw new Error(`DocuSeal status (submitter fallback): ${body ? JSON.stringify(body) : submitterErr.message}`);
        }
    }
};
