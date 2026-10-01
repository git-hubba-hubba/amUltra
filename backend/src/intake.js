import { Router } from 'express';
import multer from 'multer';
import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import mongoose from 'mongoose';
import { Batch, Proposal, Task, Meeting, Project, User, Roadmap } from './models.js';
import { requireValue, isAdmin, canEdit, validateDates } from './policy.js';
import { scope, getItem, validateUser, audit } from './resources.js';
import { detectColumns, nonemptyRow, normalizeRow } from './import-parser.js';
export { normalizeRow } from './import-parser.js';
export const intake=Router();
export const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:1}});
const cellText=value=>value && typeof value==='object' ? value.text || (value.richText ? value.richText.map(x=>x.text).join('') : value.result ?? '') : value;
async function readSheets(file) {
 const filename = file.originalname;
 const sheets = {};
 if (/\.csv$/i.test(filename)) {
  sheets.Sheet1 = parse(file.buffer.toString('utf8'), { bom: true, relax_column_count: true });
 } else if (/\.xlsx$/i.test(filename)) {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(file.buffer);
  requireValue(book.worksheets.reduce((sum, sheet) => sum + sheet.rowCount, 0) <= 5000, 'Upload must contain at most 5000 rows');
  for (const sheet of book.worksheets) {
   sheets[sheet.name] = Array.from({ length: sheet.rowCount }, (_, index) => Array.from(sheet.getRow(index + 1).values.slice(1), value => value instanceof Date ? value.toISOString() : cellText(value)));
  }
 } else requireValue(false, 'Only XLSX and CSV are supported');
 const rowCount = Object.values(sheets).reduce((total, rows) => total + rows.length, 0);
 requireValue(rowCount > 0 && rowCount <= 5000, 'Upload must contain 1–5000 rows');
 return sheets;
}
intake.post('/imports', upload.single('file'), async (req, res) => {
 requireValue(req.file, 'Select an XLSX or CSV file');
 const project = req.body.project ? await getItem(req, Project, req.body.project) : null;
 const department = project?.department || req.body.department || req.user.department;
 const canAssign = isAdmin(req.user, department, project?._id);
 requireValue(department !== '*' && (canAssign || req.user.department === department), 'Department required', 403);
 const filename = req.file.originalname;
 const sheets = await readSheets(req.file);
 const members = await User.find({ organization: req.user.organization, status: { $in: ['active', 'pending'] } }).select('name email');
 const mapping = {}, drafts = [];
 for (const [sheet, rows] of Object.entries(sheets)) {
  const detected = detectColumns(rows);
  mapping[sheet] = detected;
  rows.forEach((row, index) => {
   if (index <= detected.headerRow || !nonemptyRow(row)) return;
   const normalized = normalizeRow(row, detected.mapping, { members, canAssign, userId: req.user._id });
   drafts.push({ ...scope(req), creator: req.user._id, department, project: project?._id,
    source: `${filename} / ${sheet}`, row: index + 1, original: { sheet, cells: row },
    draft: normalized.draft, warnings: [...detected.warnings, ...normalized.warnings] });
  });
 }
 requireValue(drafts.length, 'No task rows were found below the spreadsheet headings');
 let batchId;
 await mongoose.connection.transaction(async session => {
  const [batch] = await Batch.create([{ ...scope(req), creator: req.user._id, department, project: project?._id, filename, sheets: Object.keys(sheets), rows: sheets, mapping, status: 'mapped' }], { session });
  batchId = batch._id;
  const proposals = await Proposal.insertMany(drafts.map(draft => ({ ...draft, batch: batchId })), { session });
  const complete = proposals.filter(proposal => !proposal.warnings.length);
  if (complete.length) {
   const tasks = await Task.insertMany(complete.map(proposal => ({ ...proposal.draft.toObject(), organization: proposal.organization, department: proposal.department, project: proposal.project, creator: proposal.creator, sourceProposal: proposal._id })), { session });
   await Proposal.bulkWrite(complete.map((proposal, index) => ({ updateOne: { filter: { _id: proposal._id }, update: { $set: { status: 'approved', task: tasks[index]._id, reason: 'Automatically generated from a complete row', reviewedAt: new Date() } } } })), { session });
  }
 });
 const items = await Proposal.find({ batch: batchId, organization: req.user.organization }).sort({ row: 1 });
 res.status(201).json({ _id: batchId, filename, items, generated: items.filter(item => item.status === 'approved').length, needsReview: items.filter(item => item.status === 'pending').length });
});
intake.post('/roadmap/import', upload.single('file'), async (req, res) => {
 requireValue(req.file, 'Select an XLSX or CSV file');
 const project = req.body.project ? await getItem(req, Project, req.body.project) : null;
 const department = project?.department || req.body.department || req.user.department;
 requireValue(isAdmin(req.user, department, project?._id), 'Project or department admin required', 403);
 requireValue(department && department !== '*', 'Department required');
 const sheets = await readSheets(req.file);
 const items = [];
 const aliases = {
  title: ['title', 'workstream', 'milestone', 'workstream milestone', 'task'],
  startDate: ['start', 'start date', 'startdate'],
  dueDate: ['target', 'target date', 'due', 'due date', 'duedate', 'end date', 'deadline'],
  phase: ['phase'], kind: ['kind', 'type'], status: ['status'], description: ['description', 'notes'],
  ownerLabel: ['owner', 'assignee'],
 };
 for (const [sheet, rows] of Object.entries(sheets)) {
  if (!rows.some(nonemptyRow)) continue;
  const header = rows.findIndex(nonemptyRow);
  const headings = rows[header].map(value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  const mapping = Object.fromEntries(Object.entries(aliases).map(([field, names]) => [field, headings.findIndex(value => names.includes(value))]));
  requireValue(['title', 'startDate', 'dueDate'].every(field => mapping[field] >= 0), `${sheet}: include Title, Start and Target column headings`);
  rows.forEach((row, index) => {
   if (index <= header || !nonemptyRow(row)) return;
   const value = field => String(row[mapping[field]] ?? '').trim();
   const item = { ...scope(req), creator: req.user._id, department, project: project?._id,
    title: value('title'), description: value('description'), startDate: value('startDate'), dueDate: value('dueDate'),
    phase: value('phase') || 'EP 1.0', kind: value('kind').toLowerCase() || 'workstream', status: value('status') || 'Planned',
    sourceReference: { file: req.file.originalname, row: index + 1, ownerLabel: value('ownerLabel') },
   };
   try {
    requireValue(item.title, 'Title required');
    requireValue(['Planned', 'In Progress', 'Complete'].includes(item.status), 'Status must be Planned, In Progress or Complete');
    validateDates(item, 'roadmap');
    const error = new Roadmap(item).validateSync();
    requireValue(!error, error?.message);
   } catch (error) { requireValue(false, `${sheet}, row ${index + 1}: ${error.message}`); }
   items.push(item);
  });
 }
 requireValue(items.length, 'No roadmap rows found');
 await mongoose.connection.transaction(async session => { await Roadmap.insertMany(items, { session }); });
 res.status(201).json({ filename: req.file.originalname, generated: items.length });
});
// An actionable, persistent notification derived from pending proposals. New admins
// see outstanding work immediately; revoked project grants stop receiving it.
intake.get('/intake-alerts', async (req, res) => {
 const pending = await Proposal.find({ ...scope(req), status: 'pending' }).select('department project source batch warnings');
 const actionable = pending.filter(item => isAdmin(req.user, item.department, item.project));
 res.json({ count: actionable.length, flagged: actionable.filter(item => item.warnings.length).length });
});
intake.get('/proposals', async (req, res) => {
 const filter = { ...scope(req) };
 if (req.query.status) filter.status = String(req.query.status);
 if (req.query.batch) { requireValue(mongoose.isValidObjectId(req.query.batch), 'Invalid upload ID'); filter.batch = req.query.batch; }
 res.json(await Proposal.find(filter).sort({ createdAt: -1, row: 1 }).limit(req.query.batch ? 5000 : 500));
});
intake.patch('/proposals/:id',async(req,res)=> { const proposal=await getItem(req,Proposal,req.params.id); requireValue(isAdmin(req.user,proposal.department,proposal.project),'Project or department admin required',403); requireValue(proposal.status==='pending','Proposal already reviewed',409); requireValue(req.body.__v===proposal.__v,'Proposal changed; refresh',409); const d=req.body.draft; requireValue(d && typeof d.title==='string' && d.title.trim(),'Title required'); requireValue(['Critical','High','Medium','Low'].includes(d.priority),'Valid priority required'); requireValue(Number.isInteger(Number(d.difficulty))&&Number(d.difficulty)>=1&&Number(d.difficulty)<=5,'Difficulty must be 1–5'); if(d.dueDate) requireValue(Number.isFinite(Date.parse(d.dueDate)),'Invalid due date'); if(d.owner) await validateUser(req,d.owner); proposal.draft={title:d.title,description:d.description || '',priority:d.priority,difficulty:Number(d.difficulty),dueDate:d.dueDate || null,owner:d.owner || null}; requireValue(req.body.acknowledge===true,'Confirm you have reviewed the original source and resolved warnings'); proposal.warnings=[]; await proposal.save(); res.json(proposal); });
intake.post('/proposals/:id/review', async (req, res) => {
 const { decision, reason, draft, acknowledge } = req.body;
 requireValue(['approved', 'denied'].includes(decision), 'Invalid decision');
 requireValue(mongoose.isValidObjectId(req.params.id), 'Invalid task draft');
 let result;
 await mongoose.connection.transaction(async session => {
  const proposal = await Proposal.findOne({ ...scope(req), _id: req.params.id }).session(session);
  requireValue(proposal, 'Task draft not found', 404);
  requireValue(isAdmin(req.user, proposal.department, proposal.project), 'Project or department admin required', 403);
  if (proposal.status === 'approved' && decision === 'approved') { result = proposal; return; }
  requireValue(proposal.status === 'pending', 'Already reviewed', 409);
  if (draft) {
   requireValue(req.body.__v === proposal.__v, 'Draft changed; refresh before approving', 409);
   requireValue(acknowledge === true, 'Confirm the missing information has been reviewed');
   requireValue(typeof draft.title === 'string' && draft.title.trim(), 'Task title is required');
   requireValue(['Critical', 'High', 'Medium', 'Low'].includes(draft.priority), 'Valid priority required');
   requireValue(Number.isInteger(Number(draft.difficulty)) && Number(draft.difficulty) >= 1 && Number(draft.difficulty) <= 5, 'Difficulty must be 1–5');
   if (draft.dueDate) requireValue(Number.isFinite(Date.parse(draft.dueDate)), 'Invalid deadline');
   if (draft.owner) await validateUser(req, draft.owner);
   proposal.draft = { title: draft.title.trim(), description: draft.description || '', priority: draft.priority, difficulty: Number(draft.difficulty), dueDate: draft.dueDate || null, owner: draft.owner || null };
   proposal.warnings = [];
  }
  if (decision === 'approved') {
   requireValue(!proposal.warnings.length && proposal.draft.title, 'Review the flagged information before approving');
   if (proposal.draft.owner) await validateUser(req, proposal.draft.owner);
   const [task] = await Task.create([{ ...proposal.draft.toObject(), organization: proposal.organization, department: proposal.department, project: proposal.project, creator: proposal.creator, sourceProposal: proposal._id }], { session });
   proposal.task = task._id;
  }
  proposal.status = decision;
  proposal.reason = String(reason || '');
  proposal.reviewer = req.user._id;
  proposal.reviewedAt = new Date();
  await proposal.save({ session });
  result = proposal;
 });
 await audit(req, 'proposals', result._id, decision);
 res.json(result);
});
intake.post('/meetings/:id/transcript',upload.single('file'),async(req,res)=> { const meeting=await getItem(req,Meeting,req.params.id); requireValue(canEdit(req.user,meeting),'Not permitted',403); requireValue(req.file && /\.(txt|vtt|srt)$/i.test(req.file.originalname),'Upload a TXT, VTT or SRT transcript'); const text=req.file.buffer.toString('utf8'); requireValue(text.length<=500000,'Transcript too long'); const lines=text.split(/\r?\n/).map((body,i)=>({body:body.trim(),line:i+1})).filter(x=>x.body); const candidates=lines.filter(x=>/\b(will|action item|to do|follow up|need to|must)\b/i.test(x.body)).slice(0,100); const summary=lines.filter(x=>/\b(decid|agree|action|will|next|block|risk)\w*\b/i.test(x.body)).slice(0,12).map(x=>`Line ${x.line}: ${x.body}`).join('\n') || lines.slice(0,6).map(x=>`Line ${x.line}: ${x.body}`).join('\n');
 await mongoose.connection.transaction(async session=> { const fresh=await Meeting.findById(meeting._id).session(session); requireValue(fresh.__v===meeting.__v,'Meeting changed; retry',409); fresh.transcript=text;fresh.summary=summary;fresh.generationMethod='Extractive notes: original lines selected by action/decision keywords; review for completeness.'; await fresh.save({session}); await Proposal.deleteMany({meeting:meeting._id,status:'pending'},{session}); if(candidates.length) await Proposal.insertMany(candidates.map(x=>({...scope(req),creator:req.user._id,department:meeting.department,project:meeting.project,meeting:meeting._id,source:`${meeting.title} / transcript line ${x.line}`,original:x.body,draft:{title:x.body.slice(0,500),description:x.body,priority:'Medium',difficulty:3},warnings:['Review suggested task, priority, owner and deadline against transcript']})),{session}); }); res.json(await Meeting.findById(meeting._id)); });
