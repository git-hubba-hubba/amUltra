import { Router } from 'express';
import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { User, Session, ProjectAccess } from './models.js';
import { requireValue } from './policy.js';
export const hashPassword = password => { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password,salt,64).toString('hex')}`; };
// Match the salt and scrypt output produced by hashPassword before decoding.
const passwordHashFormat = /^[a-f0-9]{32}:[a-f0-9]{128}$/i;
const dummyPasswordHash = hashPassword(randomBytes(32).toString('hex'));
export function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || password.length > 200) return false;
  const hasValidFormat = typeof storedHash === 'string' && passwordHashFormat.test(storedHash);
  // Missing users and damaged credentials still do the same password derivation.
  const [salt, hash] = (hasValidFormat ? storedHash : dummyPasswordHash).split(':');
  const matches = timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
  return hasValidFormat && matches;
}
const digest = value => createHash('sha256').update(value).digest('hex');
export const publicUser = u => ({ _id: u._id, name: u.name, email: u.email, role: u.role, department: u.department, status: u.status, projectAdminIds: u.projectAdminIds || [] });
async function loadAccess(user) {
 // Earlier versions held new accounts pending. Those accounts can now sign in.
 if (user.status === 'pending') {
  await User.updateOne({ _id: user._id, status: 'pending' }, { $set: { status: 'active' } });
  user.status = 'active';
 }
 const grants = await ProjectAccess.find({ organization: user.organization, user: user._id, status: 'approved' })
  .populate({ path: 'project', match: { organization: user.organization, archived: false }, select: '_id' });
 user.projectAdminIds = grants.filter(grant => grant.project).map(grant => String(grant.project._id));
 return user;
}
export async function authenticate(req, res, next) {
 try {
  const token = req.cookies.amethyst;
  requireValue(typeof token === 'string', 'Please log in', 401);
  const session = await Session.findOne({ tokenHash: digest(token), expiresAt: { $gt: new Date() } });
  const user = session && await User.findById(session.user);
  requireValue(user && user.loginEnabled !== false && ['pending', 'active'].includes(user.status), 'Please log in', 401);
  req.user = await loadAccess(user);
  next();
 } catch (error) { next(error); }
}
export const auth = Router();
auth.use(rateLimit({ windowMs: 15*60*1000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }));
auth.post('/signup', async(req,res) => { const {name,email,password,department} = req.body; requireValue(typeof name==='string' && name.trim() && typeof email==='string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && typeof password==='string' && password.length>=12 && password.length<=200, 'Name, valid email and password of 12–200 characters required'); const user = await User.create({ name: name.trim(), email: email.toLowerCase().trim(), passwordHash: hashPassword(password), department: typeof department==='string' && department.trim() && department!=='*' ? department.trim().slice(0,100) : 'General', organization: process.env.ORGANIZATION || 'amethyst', role: 'member', status: 'active' }); res.status(201).json({ message: 'Account created. You can log in now. Request project admin rights from your profile.', user: publicUser(user) }); });
auth.post('/login', async (req, res) => {
  const { email, password } = req.body;
  requireValue(typeof email === 'string' && typeof password === 'string' && password.length <= 200, 'Email and password required');
  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash');
  const valid = verifyPassword(password, user?.passwordHash);
  requireValue(user && user.loginEnabled !== false && valid, 'Invalid email or password', 401);
  await loadAccess(user);
  if (req.cookies.amethyst) await Session.deleteOne({ tokenHash: digest(req.cookies.amethyst) });
  const token = randomBytes(32).toString('hex');
  await Session.create({ user: user._id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 7 * 86400000) });
  res.cookie('amethyst', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 86400000,
    path: '/',
  });
  res.json(publicUser(user));
});
auth.get('/me',authenticate,(req,res)=>res.json(publicUser(req.user)));
auth.post('/logout',async(req,res)=> { if(typeof req.cookies.amethyst==='string') await Session.deleteOne({tokenHash:digest(req.cookies.amethyst)}); res.clearCookie('amethyst',{path:'/'}).json({ok:true}); });
