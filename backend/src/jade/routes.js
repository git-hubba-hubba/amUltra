import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { JadeRun, JadeDecision, roster } from './models.js';
import { providerStatus } from './provider.js';
import { acceptedExtensions, validateUpload, mediaStatus } from './sources.js';
import { stages, ensureRoster, getRunRecords } from './runtime.js';
import { buildPresentation } from './pdf.js';
import { requireValue, isAdmin } from '../policy.js';
import { Project, Session } from '../models.js';
import { jadeLock, requireJadeUnlock } from './lock.js';
export const jade = Router();
jade.use(jadeLock, requireJadeUnlock);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 6, fields: 10, fieldSize: 100000 } });
const scope = req => ({ organization: req.user.organization });
async function getRun(req) {
  requireValue(mongoose.isValidObjectId(req.params.id), 'Invalid Jade run ID');
  const run = await JadeRun.findOne({ ...scope(req), _id: req.params.id });
  requireValue(run, 'Jade run not found', 404); return run;
}
function canManage(req, department) {
  requireValue(req.user.role === 'admin' && isAdmin(req.user, department), 'A workspace or department admin is required to manage Jade.', 403);
}
function publicRun(run) {
  const data = run.toObject ? run.toObject() : run;
  delete data.leaseToken; delete data.leaseUntil;
  data.sources = data.sources.map(({ sourceId, name, purpose, kind, coverage }) => ({ sourceId, name, purpose, kind, coverage }));
  return data;
}
jade.get('/status', async (req, res) => {
  const active = await JadeRun.aggregate([{ $match: { ...scope(req), status: 'running' } }, { $group: { _id: '$currentAgent', count: { $sum: 1 } } }]);
  res.json({ ...providerStatus(), mediaReady: await mediaStatus(),
  domains: ['AT&T Call Center', 'Sales', 'FirstNet'], acceptedExtensions,
  stageCount: stages.length, agents: roster.map(([role, name, tier]) => ({ role, name, tier, activeRuns: active.find(entry => entry._id === role)?.count || 0 })),
  });
});
jade.get('/runs', async (req, res) => {
  const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
  requireValue(Number.isInteger(page), 'Invalid page');
  const filter = scope(req);
  if (req.query.status) { requireValue(['queued', 'running', 'needs_context', 'needs_review', 'awaiting_approval', 'completed', 'failed', 'denied'].includes(req.query.status), 'Invalid status'); filter.status = req.query.status; }
  const [runs, total] = await Promise.all([JadeRun.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 30).limit(30), JadeRun.countDocuments(filter)]);
  res.json({ items: runs.map(publicRun), total, page, pages: Math.ceil(total / 30) });
});
jade.post('/runs', (req, res, next) => { canManage(req); next(); }, upload.fields([{ name: 'files', maxCount: 3 }, { name: 'contextFiles', maxCount: 3 }]), async (req, res) => {
  requireValue(providerStatus().configured, 'Set ANTHROPIC_API_KEY in the backend environment before starting Jade.', 503);
  const { title, goal, department, businessContext, project } = req.body;
  requireValue(typeof title === 'string' && title.trim() && title.length <= 500, 'A title of 1–500 characters is required');
  requireValue(typeof goal === 'string' && goal.trim() && goal.length <= 10000, 'Describe the business outcome (up to 10,000 characters)');
  requireValue(typeof department === 'string' && department.trim() && department !== '*' && department.length <= 100, 'A department is required');
  canManage(req, department);
  requireValue(typeof businessContext === 'string' && businessContext.trim() && businessContext.length <= 30000, 'Supply business needs, urgency, and role context (up to 30,000 characters)');
  const files = req.files.files || []; const contextFiles = req.files.contextFiles || [];
  requireValue(files.length, 'Upload at least one source document, spreadsheet, or media file');
  const allFiles = [...files, ...contextFiles];
  requireValue(allFiles.reduce((size, file) => size + file.buffer.length, 0) <= 10 * 1024 * 1024, 'Combined uploads must be at most 10 MB');
  allFiles.forEach(validateUpload);
  if (allFiles.some(file => /\.(mp3|wav|m4a|mp4|mov|webm)$/i.test(file.originalname))) requireValue(await mediaStatus(), 'Configure FFmpeg before uploading audio/video.', 503);
  if (project) { requireValue(mongoose.isValidObjectId(project), 'Invalid project'); requireValue(await Project.exists({ _id: project, ...scope(req), department, archived: false }), 'Project must be active and in the selected department', 404); }
  await ensureRoster(req.user.organization);
  const run = await JadeRun.create({ ...scope(req), creator: req.user._id, title: title.trim(), goal: goal.trim(), department, project: project || undefined,
    businessContext: `Business domains: AT&T Call Center, Sales, FirstNet.\n${businessContext.trim()}`, model: providerStatus().model,
    sources: allFiles.map((file, index) => ({ sourceId: `SOURCE-${index + 1}`, name: file.originalname.slice(0, 255),
      mime: file.mimetype, bytes: file.buffer, purpose: index < files.length ? 'input' : 'business_context' })),
  });
  res.status(202).json(publicRun(run));
});
jade.get('/runs/:id', async (req, res) => {
  const run = await getRun(req);
  const [records, decisions] = await Promise.all([getRunRecords(run), JadeDecision.find({ ...scope(req), run: run._id }).sort({ createdAt: 1 }).select('-__v')]);
  res.json({ run: publicRun(run), records, decisions });
});
// Subscribe before taking the snapshot so a transition cannot fall between them.
jade.get('/runs/:id/events', async (req, res) => {
  const run = await getRun(req);
  const stream = JadeRun.collection.watch([{ $match: { 'documentKey._id': run._id } }], { fullDocument: 'updateLookup', maxAwaitTimeMS: 100 });
  try { await stream.tryNext(); } catch (error) { await stream.close(); throw error; }
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  let closed = false;
  let timer;
  const close = () => {
    if (closed) return;
    closed = true; clearInterval(timer);
    void stream.close().catch(() => {});
    res.end();
  };
  const send = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  req.on('close', close);
  void (async () => {
    try {
      while (!closed) {
        const change = await stream.next();
        if (closed) break;
        if (!change.fullDocument || change.fullDocument.organization !== req.user.organization) return close();
        const valid = await Session.exists({ _id: req.session._id, expiresAt: { $gt: new Date() }, jadeUnlockedUntil: { $gt: new Date() } });
        if (!valid) { send('locked', {}); return close(); }
        send('run', publicRun(change.fullDocument));
      }
    } catch { if (!closed) { send('unavailable', {}); close(); } }
  })();
  send('run', publicRun(await getRun(req)));
  if (closed) return;
  timer = setInterval(async () => {
    try {
      const valid = await Session.exists({ _id: req.session._id, expiresAt: { $gt: new Date() }, jadeUnlockedUntil: { $gt: new Date() } });
      if (!valid) { send('locked', {}); close(); }
      else if (!closed) res.write(': heartbeat\n\n');
    } catch { close(); }
  }, 5000);
});
jade.post('/runs/:id/context', async (req, res) => {
  const run = await getRun(req); canManage(req, run.department);
  requireValue(['clarified', 'denied'].includes(req.body.decision), 'Choose clarified or denied');
  const text = req.body.text;
  requireValue(typeof text === 'string' && text.trim() && text.length <= 30000, 'Provide context or a denial reason (up to 30,000 characters)');
  requireValue(Number.isInteger(req.body.revision), 'Current revision required');
  await mongoose.connection.transaction(async session => {
    const updated = await JadeRun.findOneAndUpdate({ _id: run._id, ...scope(req), status: { $in: ['needs_context', 'needs_review'] }, revision: req.body.revision },
      req.body.decision === 'denied' ? { $set: { status: 'denied', finishedAt: new Date() } } : {
        $set: { status: 'queued', step: 0, questions: [], error: '', currentAgent: '', managerIteration: 0 }, $inc: { revision: 1 },
        $push: { clarifications: { author: req.user._id, text: text.trim(), at: new Date() } },
      }, { session, new: true });
    requireValue(updated, 'This context request has already changed; refresh before deciding.', 409);
    await JadeDecision.create([{ ...scope(req), department: run.department, run: run._id, reviewer: req.user._id,
      decision: req.body.decision, reason: text.trim(), revision: req.body.revision }], { session });
  });
  res.json({ ok: true });
});
jade.post('/runs/:id/approve', async (req, res) => {
  const run = await getRun(req); canManage(req, run.department);
  requireValue(['approved', 'denied'].includes(req.body.decision), 'Choose approved or denied');
  requireValue(Number.isInteger(req.body.revision), 'Current iteration required');
  requireValue(typeof req.body.reason === 'string' && req.body.reason.length <= 30000, 'Provide an approval or denial note');
  await mongoose.connection.transaction(async session => {
    const updated = await JadeRun.findOneAndUpdate({ _id: run._id, ...scope(req), status: 'awaiting_approval', revision: req.body.revision },
      { $set: { status: req.body.decision === 'approved' ? 'queued' : 'denied', ...(req.body.decision === 'denied' ? { finishedAt: new Date() } : {}) } }, { session });
    requireValue(updated, 'This Manager iteration has already changed. Refresh before deciding.', 409);
    await JadeDecision.create([{ ...scope(req), department: run.department, run: run._id, reviewer: req.user._id,
      decision: req.body.decision, reason: req.body.reason, revision: req.body.revision }], { session });
  });
  res.json({ ok: true });
});
jade.post('/runs/:id/retry', async (req, res) => {
  const run = await getRun(req); canManage(req, run.department);
  requireValue(providerStatus().configured, 'Configure ANTHROPIC_API_KEY before retrying.', 503);
  const updated = await JadeRun.findOneAndUpdate({ _id: run._id, ...scope(req), status: 'failed' }, { $set: { status: 'queued', error: '', leaseToken: '', leaseUntil: null } }, { new: true });
  requireValue(updated, 'Only failed runs can be retried.', 409); res.json(publicRun(updated));
});
jade.get('/runs/:id/presentation.pdf', async (req, res) => {
  const run = await getRun(req); requireValue(run.status === 'completed', 'The presentation is available after the run completes.', 409);
  const pdf = await buildPresentation(run, await getRunRecords(run));
  res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="jade-${run._id}.pdf"`, 'Cache-Control': 'private, no-store' }).send(pdf);
});
