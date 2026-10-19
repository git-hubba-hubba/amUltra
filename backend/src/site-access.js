import { Router } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { verifyPassword } from './auth.js';

// Server-only salted hash of the owner's site access code.
const defaultHash = 'f53cc270220d2b6d62b4960fac2e165a:46e5e92dfb537e6892e543e6a21b8d2e0207700a74e0385c84fd3386ed9486812b206ec49d188a4dd99061bc29e90c7649a542ce1285cc25d47c414e7fd29005';
const cookieName = 'amethyst_site_access';
const lifetime = 12 * 60 * 60 * 1000;

export function createSiteAccess({ passwordHash = process.env.SITE_ACCESS_CODE_HASH || defaultHash, secret = randomBytes(32), now = Date.now } = {}) {
 const router = Router();
 const sign = value => createHmac('sha256', secret).update(`${passwordHash}:${value}`).digest('hex');
 function unlocked(req) {
  const token = req.cookies?.[cookieName];
  if (typeof token !== 'string' || token.length > 200) return false;
  const parts = token.split('.');
  if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^[a-f0-9]{64}$/.test(parts[1])) return false;
  const expiresAt = Number(parts[0]);
  return expiresAt > now() && expiresAt <= now() + lifetime && timingSafeEqual(Buffer.from(parts[1], 'hex'), Buffer.from(sign(parts[0]), 'hex'));
 }
 router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
 router.get('/', (req, res) => res.json({ unlocked: unlocked(req) }));
 router.post('/unlock', rateLimit({
  windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true,
  standardHeaders: 'draft-8', legacyHeaders: false,
  message: { error: 'Too many incorrect codes. Try again in 15 minutes.' },
 }), (req, res) => {
  if (!verifyPassword(req.body?.code, passwordHash)) return res.status(401).json({ error: 'Incorrect access code.' });
  const expiresAt = String(now() + lifetime);
  res.cookie(cookieName, `${expiresAt}.${sign(expiresAt)}`, {
   httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/',
  });
  res.json({ unlocked: true });
 });
 router.post('/lock', (_req, res) => res.clearCookie(cookieName, { path: '/' }).json({ unlocked: false }));
 function requireSiteAccess(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (!unlocked(req)) return res.status(423).json({ error: 'Enter the site access code to continue.', code: 'SITE_LOCKED' });
  next();
 }
 return { router, requireSiteAccess };
}
