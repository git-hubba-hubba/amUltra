import mongoose from 'mongoose';
const { Schema } = mongoose;
const options = { timestamps: true, strict: 'throw', optimisticConcurrency: true };
const scope = { organization: { type: String, required: true }, department: { type: String, required: true } };
export const roster = [
  ['finance', 'Finance', 'board'], ['scale', 'Scale', 'board'],
  ['compliance_governance', 'Compliance / Governance', 'board'],
  ['manager', 'Manager', 'management'], ['assistant', 'Assistant', 'management'],
  ['files', 'Files', 'workers'], ['metrics', 'Metrics', 'workers'],
  ['projects', 'Projects', 'workers'], ['meetings', 'Meetings', 'workers'],
  ['context_check_1', 'Context Check A', 'verification'],
  ['context_check_2', 'Context Check B', 'verification'],
  ['admin_context_check', 'Admin Context Check', 'verification'],
];
export const JadeAgent = mongoose.model('JadeAgent', new Schema({
  organization: { type: String, required: true }, role: { type: String, required: true }, name: String, tier: String,
}, options));
JadeAgent.schema.index({ organization: 1, role: 1 }, { unique: true });
const source = new Schema({
  sourceId: String, name: String, mime: String, kind: String,
  bytes: { type: Buffer, select: false }, text: String, purpose: { type: String, enum: ['input', 'business_context'] },
  frames: { type: [String], select: false }, coverage: String,
}, { _id: false });
export const JadeRun = mongoose.model('JadeRun', new Schema({
  ...scope, creator: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  project: { type: Schema.Types.ObjectId, ref: 'Project' }, title: { type: String, required: true }, goal: String,
  businessContext: String, sources: [source], model: String,
  status: { type: String, enum: ['queued', 'running', 'needs_context', 'needs_review', 'awaiting_approval', 'completed', 'failed', 'denied'], default: 'queued' },
  revision: { type: Number, default: 0 }, step: { type: Number, default: 0 },
  managerFeedback: [{ text: String, workerRole: String, at: Date }],
  managerIteration: { type: Number, default: 0 },
  currentAgent: String, questions: [String], error: String, leaseToken: String, leaseUntil: Date,
  clarifications: [{ author: { type: Schema.Types.ObjectId, ref: 'User' }, text: String, at: Date }],
  taskIds: [{ type: Schema.Types.ObjectId, ref: 'Task' }], finishedAt: Date,
}, options));
JadeRun.schema.index({ status: 1, leaseUntil: 1, createdAt: 1 });
JadeRun.schema.index({ organization: 1, department: 1, createdAt: -1 });
// Each agent owns its output collection. The runtime validates payloads before persistence.
export const outputs = Object.fromEntries(roster.map(([role]) => {
  const schema = new Schema({
    ...scope, run: { type: Schema.Types.ObjectId, ref: 'JadeRun', required: true },
    agentId: { type: Schema.Types.ObjectId, ref: 'JadeAgent', required: true },
    revision: Number, stage: String, data: { type: Schema.Types.Mixed, required: true }, model: String,
    inputRecordIds: [{ type: Schema.Types.ObjectId }],
  }, options);
  schema.index({ run: 1, revision: 1, stage: 1 }, { unique: true });
  return [role, mongoose.model(`JadeOutput_${role}`, schema, `jade_${role}_outputs`)];
}));
export const JadeDecision = mongoose.model('JadeDecision', new Schema({
  ...scope, run: { type: Schema.Types.ObjectId, ref: 'JadeRun', required: true },
  reviewer: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  decision: { type: String, enum: ['clarified', 'approved', 'denied'], required: true }, reason: String, revision: Number,
}, options));
export async function ensureRoster(organization) {
  await JadeAgent.bulkWrite(roster.map(([role, name, tier]) => ({ updateOne: {
    filter: { organization, role }, update: { $setOnInsert: { organization, role, name, tier } }, upsert: true,
  } })));
  return JadeAgent.find({ organization }).lean();
}
