import { Router } from 'express';
import mongoose from 'mongoose';
import { models, User, Task, Project, Audit, Cinema, Avp, Notification } from './models.js';
import { requireValue, isAdmin, canEdit, validateDates, rankTasks, recordProject } from './policy.js';
import { listRecords } from './queries.js';
import { getOverview } from './overview.js';
export const resources = Router();
export const scope = req => ({ organization: req.user.organization, archived: false });
export async function audit(req, resource, id, action, detail) { await Audit.create({organization:req.user.organization,actor:req.user._id,resource,resourceId:id,action,detail}); }
export async function getItem(req, Model, id) { requireValue(mongoose.isValidObjectId(id),'Invalid record ID'); const item=await Model.findOne({...scope(req),_id:id}); requireValue(item,'Record not found',404); return item; }
export async function validateUser(req, id) { requireValue(mongoose.isValidObjectId(id),'Invalid member'); const user=await User.findOne({_id:id,organization:req.user.organization,status:{$in:['active','pending']}}); requireValue(user,'Active member not found'); return user; }
const fields = {
 tasks: ['frozen','title','description','department','team','priority','difficulty','status','startDate','dueDate','project','blockedReason'],
 projects: ['title','description','department','team','priority','status','startDate','dueDate','featured'],
 events: ['title','description','department','startDate','endDate','timezone','location','allDay','project'],
 topics: ['title','description','department','category','project'],
 meetings: ['title','description','department','heldAt','notes','project'],
 roadmap: ['title','description','department','project','phase','kind','startDate','dueDate','status'],
};
const adminOnly = new Set(['projects','roadmap']);
function pick(body, kind) { const result={}; for(const key of fields[kind]) if(Object.hasOwn(body,key)) result[key]=body[key]==='' && ['startDate','dueDate','endDate','project','featured'].includes(key) ? null : body[key]; return result; }
resources.get('/members',async(req,res)=> { const users=await User.find({organization:req.user.organization}).select('name email role department status loginEnabled sourceReference'); res.json(users.map(user=>({...user.toObject(),email:user.loginEnabled===false?'':user.email,status:user.status==='pending'?'active':user.status}))); });
resources.get('/notifications', async (req, res) => {
 const filter = { organization: req.user.organization, recipient: req.user._id };
 const [items, unread] = await Promise.all([Notification.find(filter).sort({createdAt:-1}).limit(100).populate('sender','name'), Notification.countDocuments({...filter, readAt:null})]);
 res.json({items, unread});
});
resources.patch('/notifications/:id/read', async (req, res) => {
 requireValue(mongoose.isValidObjectId(req.params.id), 'Invalid notification ID');
 const item = await Notification.findOneAndUpdate({_id:req.params.id, organization:req.user.organization, recipient:req.user._id}, {$set:{readAt:new Date()}}, {new:true});
 requireValue(item, 'Notification not found', 404);
 res.json(item);
});
resources.post('/tasks/:id/share', async (req, res) => {
 const task = await getItem(req, Task, req.params.id);
 const recipient = await validateUser(req, req.body.recipient);
 requireValue(recipient.loginEnabled !== false && recipient.status === 'active', 'Choose a member with an active login');
 requireValue(String(recipient._id) !== String(req.user._id), 'Choose another member');
 const notification = await Notification.create({organization:req.user.organization, recipient:recipient._id, sender:req.user._id, task:task._id, title:task.title});
 res.status(201).json(notification);
});
resources.get('/queue',async(req,res)=>res.json(rankTasks(await Task.find({...scope(req),owner:req.user._id}).lean())));
resources.get('/overview', getOverview);
resources.get('/audit/:kind/:id',async(req,res)=> { requireValue(models[req.params.kind],'Unknown resource'); await getItem(req,models[req.params.kind],req.params.id); res.json(await Audit.find({organization:req.user.organization,resource:req.params.kind,resourceId:req.params.id}).sort({createdAt:-1}).limit(100)); });
resources.post('/tasks/:id/claim',async(req,res)=> { const task=await getItem(req,Task,req.params.id); requireValue(!['done','cancelled'].includes(task.status),'Task is closed',409); const claimed=await Task.findOneAndUpdate({...scope(req),_id:task._id,owner:null,status:{$nin:['done','cancelled']}},{$set:{owner:req.user._id},$inc:{__v:1},$push:{assignmentHistory:{actor:req.user._id,next:req.user._id,at:new Date()}}},{new:true}); requireValue(claimed,'This task is already owned',409); await audit(req,'tasks',task._id,'claim'); res.json(claimed); });
resources.post('/tasks/:id/assign',async(req,res)=> { const task=await getItem(req,Task,req.params.id); requireValue(isAdmin(req.user,task.department,task.project),'Project or department admin required',403); const user=await validateUser(req,req.body.owner); task.assignmentHistory.push({actor:req.user._id,previous:task.owner,next:user._id,at:new Date()}); task.owner=user._id; await task.save(); await audit(req,'tasks',task._id,'assign',{owner:user._id}); res.json(task); });
resources.post('/tasks/:id/actions',async(req,res)=> { const task=await getItem(req,Task,req.params.id); requireValue(canEdit(req.user,task),'Only owner, creator or admin can update action items',403); requireValue(typeof req.body.title==='string' && req.body.title.trim(),'Action title required'); task.actionItems.push({title:req.body.title.trim(),creator:req.user._id}); await task.save(); res.status(201).json(task); });
resources.patch('/tasks/:id/actions/:action',async(req,res)=> { const task=await getItem(req,Task,req.params.id); requireValue(canEdit(req.user,task),'Not permitted',403); const item=task.actionItems.id(req.params.action); requireValue(item,'Action item not found',404); requireValue(typeof req.body.done==='boolean','Done must be a boolean'); item.done=req.body.done; await task.save(); res.json(task); });
resources.post('/:kind/:id/comments',async(req,res)=> { const Model=models[req.params.kind]; requireValue(Model,'Unknown resource',404); const item=await getItem(req,Model,req.params.id); requireValue(typeof req.body.body==='string' && req.body.body.trim(),'Comment required'); if(req.body.parent) requireValue(item.comments.id(req.body.parent),'Parent comment not found'); item.comments.push({author:req.user._id,body:req.body.body.trim(),parent:req.body.parent || undefined}); await item.save(); res.status(201).json(item); });
resources.get('/:kind',async(req,res,next)=> { const Model=models[req.params.kind]; if(!Model) return next(); res.json(await listRecords(req,Model,req.params.kind)); });
resources.get('/:kind/:id',async(req,res,next)=> { const Model=models[req.params.kind]; if(!Model) return next(); res.json(await getItem(req,Model,req.params.id)); });
async function validateProjectLink(req, data) {
 if (!data.project) return;
 const project = await getItem(req, Project, data.project);
 requireValue(project.department === data.department, 'Department must match the linked project');
}
resources.post('/:kind', async (req, res, next) => {
 const kind = req.params.kind;
 if (!fields[kind]) return next();
 const data = pick(req.body, kind);
 if (kind === 'tasks' && Object.hasOwn(data, 'frozen')) requireValue(typeof data.frozen === 'boolean', 'Frozen must be a boolean');
 requireValue(typeof data.department === 'string' && data.department.trim() && data.department !== '*', 'Department required');
 await validateProjectLink(req, data);
 requireValue(isAdmin(req.user, data.department, data.project) || (req.user.department === data.department && !adminOnly.has(kind)), 'Project or department permission required', 403);
 requireValue(!Object.hasOwn(req.body, 'owner') || ['projects', 'roadmap'].includes(kind), 'Use the admin assignment action', 403);
 if (Object.hasOwn(req.body, 'owner') && ['projects', 'roadmap'].includes(kind)) {
  requireValue(isAdmin(req.user, data.department, data.project), 'Admin assignment required', 403);
  if (req.body.owner) await validateUser(req, req.body.owner);
  data.owner = req.body.owner || null;
 }
 validateDates({ ...data, status: data.status || 'todo' }, kind);
 const item = await models[kind].create({ ...data, organization: req.user.organization, creator: req.user._id });
 await audit(req, kind, item._id, 'create');
 res.status(201).json(item);
});
resources.patch('/:kind/:id', async (req, res, next) => {
 const kind = req.params.kind;
 if (!fields[kind]) return next();
 const item = await getItem(req, models[kind], req.params.id);
 const managesItem = isAdmin(req.user, item.department, recordProject(item, kind));
 const freezeOnly = kind === 'tasks' && Object.hasOwn(req.body, 'frozen') && Object.keys(req.body).every(key => ['frozen', '__v'].includes(key));
 requireValue(freezeOnly || (canEdit(req.user, item, kind) && (!adminOnly.has(kind) || managesItem)), 'Not permitted', 403);
 requireValue(Number.isInteger(req.body.__v) && req.body.__v === item.__v, 'Record changed; refresh before saving', 409);
 requireValue(!Object.hasOwn(req.body, 'owner') || ['projects', 'roadmap'].includes(kind), 'Use admin assignment', 403);
 const data = pick(req.body, kind);
 if (kind === 'tasks' && Object.hasOwn(data, 'frozen')) requireValue(typeof data.frozen === 'boolean', 'Frozen must be a boolean');
 if (Object.hasOwn(req.body, 'owner') && ['projects', 'roadmap'].includes(kind)) {
  requireValue(managesItem, 'Admin assignment required', 403);
  if (req.body.owner) await validateUser(req, req.body.owner);
  data.owner = req.body.owner || null;
 }
 if (Object.hasOwn(data, 'department')) requireValue(typeof data.department === 'string' && data.department.trim() && data.department !== '*', 'Department required');
 if (data.department && data.department !== item.department) {
  requireValue(isAdmin(req.user, item.department) && isAdmin(req.user, data.department), 'Admin access to both departments required', 403);
 }
 // Reparenting a record must not expand a project manager's authority.
 if (Object.hasOwn(data, 'project') && String(data.project || '') !== String(item.project || '')) {
  requireValue(isAdmin(req.user, item.department, item.project) && isAdmin(req.user, data.department || item.department, data.project), 'Admin access to both projects required to move work', 403);
 }
 if (kind === 'tasks' && !managesItem) {
  for (const key of ['priority', 'difficulty']) requireValue(data[key] === undefined || data[key] === item[key], 'Admin required to change tier', 403);
 }
 const combined = { ...item.toObject(), ...data };
 if (Object.hasOwn(data, 'project') || Object.hasOwn(data, 'department')) await validateProjectLink(req, combined);
 validateDates(combined, kind);
 if (kind === 'tasks' && data.status) data.completedAt = data.status === 'done' ? new Date() : null;
 Object.assign(item, data);
 await item.save();
 if (kind === 'tasks') await Avp.updateOne({ task: item._id }, { $set: { updatedAt: new Date() } });
 await audit(req, kind, item._id, 'update', data);
 res.json(item);
});
resources.delete('/:kind/:id', async (req, res, next) => {
 const kind = req.params.kind;
 if (!fields[kind]) return next();
 const item = await getItem(req, models[kind], req.params.id);
 requireValue(isAdmin(req.user, item.department, recordProject(item, kind)) || (['events', 'topics', 'meetings'].includes(kind) && String(item.creator) === String(req.user._id)), 'Admin required to archive', 403);
 item.archived = true;
 await item.save();
 await audit(req, kind, item._id, 'archive');
 res.json({ ok: true });
});
