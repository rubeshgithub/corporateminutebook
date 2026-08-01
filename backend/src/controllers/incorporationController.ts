import { Response } from 'express';
import { AuthRequest } from '../middleware/authMiddleware';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import { putFile, getFile } from '../services/uploadStorage';
import { Company } from '../models/Company';

// Memory storage — we only persist to uploadStorage (S3 or disk) after a
// successful parse. Old code wrote to backend/uploads/ directly, which
// meant every Render deploy wiped customer files.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') cb(null, true);
        else cb(new Error('Only PDF files are accepted.'));
    },
});

export const uploadMiddleware = upload.single('incorporationDocument');

// ─── Claude prompt ──────────────────────────────────────────────────────────
const CLAUDE_PARSE_PROMPT = `You are reading a Canadian corporate document — this may be an Alberta Corporate Registry search, a Certificate of Incorporation, Articles of Incorporation, a Notice of Articles (BC), or a similar document from any Canadian provincial or federal registry.

Extract every available field and return ONLY a valid JSON object (no markdown, no explanation, no code fences).
Use null for any field you cannot determine with confidence.

Return this exact structure:
{
  "name": "Full legal corporation name exactly as shown",
  "corporateAccessNumber": "Corporate Access Number / CAN / Incorporation Number / Corporation Number",
  "incorporationDate": "YYYY-MM-DD (use Registration Date if no explicit incorporation date)",
  "registeredOfficeAddress": {
    "street": "Street number and name",
    "city": "City",
    "province": "2-letter code: AB BC ON QC SK MB NS NB PE NL YT NT NU",
    "postalCode": "Postal code",
    "country": "Canada"
  },
  "recordsAddress": {
    "sameAsRegistered": true,
    "street": null,
    "city": null,
    "province": null,
    "postalCode": null,
    "country": "Canada"
  },
  "addressForService": {
    "sameAsRegistered": false,
    "poBox": "PO Box number if present, else null",
    "street": null,
    "city": null,
    "province": null,
    "postalCode": null,
    "country": "Canada"
  },
  "directors": [
    {
      "firstName": "First name",
      "lastName": "Last name",
      "address": "Full street address, City, Province PostalCode",
      "residentCanadian": true,
      "appointedDate": "YYYY-MM-DD — use incorporation/registration date if no explicit appointment date"
    }
  ],
  "shareholders": [
    {
      "name": "Full name (First Middle Last)",
      "holderType": "Individual or Legal Entity",
      "address": "Full address",
      "sharesClass": "",
      "numberOfShares": 100,
      "votingPercent": 100
    }
  ],
  "shareClasses": [
    {
      "name": "Class A Common Voting Shares",
      "type": "Common",
      "voting": true,
      "maxAuthorized": null,
      "parValue": null
    }
  ],
  "restrictions": {
    "restrictedTo": { "has": false, "description": "" },
    "restrictedFrom": { "has": false, "description": "" }
  },
  "minDirectors": 1,
  "maxDirectors": 10,
  "fiscalYearEnd": null
}

Rules:
- Province codes: Alberta=AB, British Columbia=BC, Ontario=ON, Quebec=QC, Saskatchewan=SK, Manitoba=MB, Nova Scotia=NS, New Brunswick=NB, Prince Edward Island=PE, Newfoundland and Labrador=NL, Yukon=YT, Northwest Territories=NT, Nunavut=NU
- If "Records Address" is the same as Registered Office, set recordsAddress.sameAsRegistered=true and leave other recordsAddress fields null
- If "Mailing Address" or "Address for Service" has a PO Box, populate addressForService.poBox and set sameAsRegistered=false
- If share structure says "SEE ATTACHED SCHEDULE A" or similar and no classes are listed, return shareClasses as empty array []
- For shareholders: if "Percent Of Voting Shares" is shown, use it for votingPercent. Set numberOfShares=100 as placeholder when actual number is unknown. Leave sharesClass as empty string when unknown
- "Business Restricted To: NONE" means restrictedTo.has=false. Any actual description means has=true
- Alberta "Registration Date" = incorporationDate
- Director names in Alberta docs appear as: Last Name, First Name, Middle Name — combine as "First Middle Last"
- Return ONLY the JSON object`;

// ─── Parse endpoint ──────────────────────────────────────────────────────────
export const parseIncorporationDocument = async (req: AuthRequest, res: Response) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No PDF file uploaded.' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured on the server. Add it to your .env file.' });
    }

    try {
        const client = new Anthropic({ apiKey });

        // Send PDF directly to Claude — works for both digital and image/scanned PDFs
        const base64Pdf = req.file.buffer.toString('base64');

        const message = await client.messages.create({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 2048,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'document',
                            source: {
                                type: 'base64',
                                media_type: 'application/pdf',
                                data: base64Pdf,
                            },
                        } as any,
                        {
                            type: 'text',
                            text: CLAUDE_PARSE_PROMPT,
                        },
                    ],
                },
            ],
        });

        const rawContent = message.content[0];
        if (rawContent.type !== 'text') {
            return res.status(500).json({ error: 'Unexpected response from AI parser.' });
        }

        let parsedData: Record<string, unknown>;
        try {
            const cleaned = rawContent.text
                .replace(/^```(?:json)?\s*/i, '')
                .replace(/\s*```$/i, '')
                .trim();
            parsedData = JSON.parse(cleaned);
        } catch {
            return res.status(500).json({
                error: 'AI returned an unparseable response. The document format may be unusual — please fill the form manually.',
            });
        }

        // Persist the PDF only after a successful parse — via uploadStorage
        // so S3 (in prod) or disk (in dev) receives the bytes.
        const filename = `${uuidv4()}.pdf`;
        try {
            await putFile(filename, req.file.buffer, 'application/pdf');
        } catch (e: any) {
            console.error('[incorporationController] failed to persist parsed PDF:', e?.message ?? e);
            // Non-fatal for the user — they still get the parsed data. They
            // just won't have the source PDF in their minute book. Ops sees
            // the log line.
        }

        return res.json({ parsedData, tempFile: filename });
    } catch (error: any) {
        console.error('Incorporation parse error:', error?.message || error);
        const msg = error?.message || 'Failed to parse document.';
        // Surface API errors clearly
        if (msg.includes('Could not process PDF') || msg.includes('invalid_request_error')) {
            return res.status(422).json({ error: 'Claude could not read this PDF. Try a different PDF version or fill the form manually.' });
        }
        return res.status(500).json({ error: msg });
    }
};

// ─── Serve stored PDF (auth-protected) ──────────────────────────────────────
export const serveIncorporationDocument = async (req: AuthRequest, res: Response) => {
    const filename = String(req.params.filename);
    // Path-traversal defence held over from the old disk-serve path — the
    // storage layer keys by filename verbatim, so we still reject anything
    // that looks like a subpath even though S3 wouldn't act on it.
    if (filename.includes('/') || filename.includes('\\') || !filename.endsWith('.pdf')) {
        return res.status(400).json({ error: 'Invalid filename.' });
    }
    // `protect` guarantees req.user, but assert it anyway: Mongoose strips
    // undefined keys out of a filter, so a userId that ever went missing
    // would silently widen the ownership query below to every tenant.
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authorized.' });

    // Tenant isolation: filenames are UUIDs but they do leak (e.g. anyone the
    // owner has ever shown the company to could have seen one), so possession
    // of a filename must not grant access. Serve only to the owner of the
    // company the file is attached to; 404 (not 403) so non-owners can't
    // distinguish "exists but not yours" from "doesn't exist".
    const owned = await Company.findOne({
        incorporationDocumentFile: filename,
        userId,
        deletedAt: null,
    }).select('_id').lean();
    if (!owned) return res.status(404).json({ error: 'File not found.' });
    let bytes: Buffer;
    try {
        bytes = await getFile(filename);
    } catch {
        return res.status(404).json({ error: 'File not found.' });
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(bytes);
};
