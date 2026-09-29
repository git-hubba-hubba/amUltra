import { Router } from 'express';
import mongoose from 'mongoose';
import { Project, ProjectAccess } from './models.js';
import { requireValue, isAdmin } from './policy.js';
import { getItem, validateUser, audit } from './resources.js';

export const projectAccess = Router();

// Project managers can manage work, but cannot grant themselves wider access.
function requireApprover(req, project) {
  requireValue(isAdmin(req.user, project.department), 'A workspace or department administrator must approve project admin rights', 403);
}

projectAccess.get('/project-access', async (req, res) => {
  const items = await ProjectAccess.find({ organization: req.user.organization })
    .populate({ path: 'project', match: { organization: req.user.organization, archived: false }, select: 'title department' })
    .populate({ path: 'user', match: { organization: req.user.organization }, select: 'name email department' })
    .sort({ updatedAt: -1 });
  res.json(items.filter(item => item.project && item.user));
});

projectAccess.post('/project-access', async (req, res) => {
  const project = await getItem(req, Project, req.body.project);
  requireValue(!isAdmin(req.user, project.department, project._id), 'You already administer this project', 409);
  const filter = { organization: req.user.organization, project: project._id, user: req.user._id };
  let item = await ProjectAccess.findOne(filter);
  requireValue(!item || ['denied', 'revoked'].includes(item.status), 'A request already exists for this project', 409);
  if (!item) item = new ProjectAccess(filter);
  item.status = 'pending';
  item.reason = String(req.body.reason || '');
  item.reviewNote = '';
  item.reviewer = undefined;
  item.reviewedAt = undefined;
  await item.save();
  await audit(req, 'project-access', item._id, 'requested', { project: project._id, user: req.user._id });
  res.status(201).json(item);
});

projectAccess.post('/project-access/grant', async (req, res) => {
  const project = await getItem(req, Project, req.body.project);
  requireApprover(req, project);
  const user = await validateUser(req, req.body.user);
  requireValue(user.loginEnabled !== false, 'Project administrators must have a login account');
  const filter = { organization: req.user.organization, project: project._id, user: user._id };
  let item = await ProjectAccess.findOne(filter);
  requireValue(item?.status !== 'approved', 'This member already has project admin rights', 409);
  if (!item) item = new ProjectAccess(filter);
  item.status = 'approved';
  item.reviewer = req.user._id;
  item.reviewNote = String(req.body.reviewNote || '');
  item.reviewedAt = new Date();
  await item.save();
  await audit(req, 'project-access', item._id, 'approved', { project: project._id, user: user._id });
  res.status(201).json(item);
});

projectAccess.post('/project-access/:id/review', async (req, res) => {
  requireValue(mongoose.isValidObjectId(req.params.id), 'Invalid request ID');
  const item = await ProjectAccess.findOne({ _id: req.params.id, organization: req.user.organization });
  requireValue(item, 'Request not found', 404);
  const project = await getItem(req, Project, item.project);
  requireApprover(req, project);
  requireValue(Number.isInteger(req.body.__v) && req.body.__v === item.__v, 'Request changed; refresh before reviewing', 409);
  const choices = item.status === 'pending' ? ['approved', 'denied'] : item.status === 'approved' ? ['revoked'] : [];
  requireValue(choices.includes(req.body.decision), 'This decision is not valid for the current request', 409);
  item.status = req.body.decision;
  item.reviewer = req.user._id;
  item.reviewNote = String(req.body.reviewNote || '');
  item.reviewedAt = new Date();
  await item.save();
  await audit(req, 'project-access', item._id, item.status, { project: project._id, user: item.user });
  res.json(item);
});
