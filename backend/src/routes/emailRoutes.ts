import express from 'express';
import { unsubscribe } from '../controllers/emailPreferencesController';

const router = express.Router();

// Public by design: the signed token in the URL is the credential, and the
// recipient may have no session (or no account at all). POST is RFC 8058
// one-click unsubscribe — cookie-less, so the CSRF guard passes it through.
router.get('/unsubscribe/:token', unsubscribe);
router.post('/unsubscribe/:token', unsubscribe);

export default router;
