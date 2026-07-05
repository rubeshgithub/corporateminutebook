import express from 'express';
import { orderCompleted } from '../controllers/crsFeedController';

const router = express.Router();

// No auth middleware here — CRS is authenticated via the HMAC signature
// checked inside the controller. The raw request body is captured in
// server.ts's express.json() verify hook so the signature check has
// byte-exact input to hash against.
router.post('/order-completed', orderCompleted);

export default router;
