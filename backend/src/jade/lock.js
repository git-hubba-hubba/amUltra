import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { verifyPassword } from '../auth.js';
import { Session } from '../models.js';
import { requireValue } from '../policy.js';

// Salted scrypt hash of the owner's Jade password. Never shipped to the browser.
const defaultPasswordHash = '3f6d8ca2629409ff02777c2f853365be:b073334d3ba4a0da9d419af21fce5f0b7ec4fdeaf31a0bc4e93d115621d87d65f987c394dcd8640601d08211585e08077f3c1d83338004f464b82b371928f630';
const unlocked = req => req.session?.jadeUnlockedUntil > new Date();
export const jadeLock = Router();
jadeLock.use((_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next(); });
jadeLock.get('/access', (req, res) => res.json({ unlocked: unlocked(req) }));
jadeLock.post('/unlock', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10,
  keyGenerator: req => String(req.user._id), skipSuccessfulRequests: true,
  standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many password attempts. Try again in 15 minutes.' },
}), async (req, res) => {
  requireValue(verifyPassword(req.body.password, process.env.JADE_PASSWORD_HASH || defaultPasswordHash), 'Incorrect Jade password.', 403);
  const until = new Date(Math.min(Date.now() + 8 * 60 * 60 * 1000, req.session.expiresAt.getTime()));
  await Session.updateOne({ _id: req.session._id }, { $set: { jadeUnlockedUntil: until } });
  res.json({ unlocked: true });
});
jadeLock.post('/lock', async (req, res) => {
  await Session.updateOne({ _id: req.session._id }, { $unset: { jadeUnlockedUntil: '' } });
  res.json({ unlocked: false });
});
export function requireJadeUnlock(req, res, next) {
  if (!unlocked(req)) return res.status(403).json({ error: 'Unlock Jade to continue.', code: 'JADE_LOCKED' });
  next();
}
