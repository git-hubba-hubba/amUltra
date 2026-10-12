import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import { JadeRun, JadeAgent, outputs, ensureRoster } from './models.js';
import { Task, User, Project } from '../models.js';
import { callOpus, providerStatus } from './provider.js';
import { prepareSource, sourceBlocks } from './sources.js';
import { workerSchema, verificationSchema, assistantSchema, managerSchema, boardSchema, presentationSchema, validateSourceReferences } from './contracts.js';
import { requireValue, isAdmin } from '../policy.js';

export const stages = [
  { role: 'files', stage: 'files_translate', schema: workerSchema, instruction: 'Translate source material into context-specific text, preserving exact evidence and how the business information is presented.' },
  { role: 'files', stage: 'files_store', schema: workerSchema, instruction: 'Organize the translated source facts into a persistent source-grounded record. Preserve citations; do not add facts. This record is stored in MongoDB by the runtime.' },
  { role: 'files', stage: 'files_analyze', schema: workerSchema, instruction: 'Analyze the stored source facts for business meaning, dependencies, and uncertainty. Preserve source references and distinguish analysis from facts.' },
  { role: 'files', schema: workerSchema, instruction: 'Rank solely by whether deadlines, dates, or timelines are explicitly communicated. Preserve exact temporal evidence in timelineSignals. Complete Translate → Store → Analyze → Rank.' },
  { role: 'metrics', schema: workerSchema, instruction: 'Extract numerical facts, units, currency, time periods, and their exact evidence. Identify missing baselines. Do not invent metrics or recalculate formulas without inputs.' },
  { role: 'projects', schema: workerSchema, instruction: 'Translate uploaded project proposals into a synopsis. Identify which information should become tasks or notifications for the Assistant. Preserve sources, dependencies, and communicated dates; do not invent owners or deadlines.' },
  { role: 'meetings', schema: workerSchema, instruction: 'Translate uploaded transcripts into a meeting synopsis. Identify decisions, commitments, and information to pass to the Assistant as tasks or notifications. Preserve timestamps and distinguish commitments from suggestions.' },
  ...['context_check_1', 'context_check_2'].map(role => ({ role, schema: verificationSchema,
    instruction: 'Independently compare every assigned worker record against original sources. Return exactly one check per supplied record ID. Failed means factual claims are unsupported or contradictory. Ask human questions only when critical context cannot be understood.' })),
  { role: 'admin_context_check', schema: workerSchema, instruction: 'Format ONLY supplied worker records with existing verified checks into a context package. Copy facts exactly, without changing any fact fields. Describe omitted failed records in limitations.' },
  { role: 'assistant', schema: assistantSchema, instruction: 'Raise action items and notifications from the verified synopsis. Apply Manager feedback and reassign toward its designated worker. Rank only by communicated dates/deadlines/timelines, preserving temporal evidence. Empty items is valid.' },
  { role: 'manager', schema: managerSchema, instruction: 'Assess business success metrics and implementation viability in the supplied company structure. Return decision approve or revise. For revise, give feedback and designate a worker for Assistant reassignment. Review Assistant items and translate them into Board direction. Delegate EVERY action item exactly once to a worker or eligible user from the roster. Notifications are not delegated. Match department and role/capability descriptions. Never invent user IDs. User assignments create tasks; worker assignments perform analysis inside Jade, not real-world execution. Ask criticalQuestions if critical assignment context is unclear.' },
  ...['files', 'metrics', 'projects', 'meetings'].map(role => ({ role, stage: `delegated_${role}`, schema: workerSchema,
    instruction: `Perform assigned ${role} analysis using supplied sources. Record findings and recommendations. Do not claim external business actions have been performed. If there are no assignments, explicitly say so.` })),
  ...['context_check_1', 'context_check_2'].map(role => ({ role, stage: `delegated_${role}`, schema: verificationSchema,
    instruction: 'Independently verify each delegated worker result against original sources. Return exactly one check per assigned record ID; mark unsupported claims failed. Ask questions only about missing critical context.' })),
  { role: 'manager', stage: 'manager_final', schema: managerSchema, instruction: 'Vet the finished worker iteration against supplied AT&T business success metrics, viability in the company structure, oversights, vulnerabilities, and hallucinations. Approve only an implementation-ready idea grounded in supplied context. Return decision revise with precise feedback and a designated worker if the Assistant should reassign and restart worker processing. On approve, retain valid assignments for every Assistant action item. The admin must approve this finished iteration before Board agents receive it.' },
  { role: 'finance', schema: boardSchema, instruction: 'Produce an executive financial statement: known economics, source-backed costs/revenue, gaps, risks, and recommendations. Label hypothetical scenarios as assumptions. Do not invent ROI, savings, valuation, or funding requirements.' },
  { role: 'compliance_governance', schema: boardSchema, instruction: 'Independently assess authorization, approvals, compliance, and security needed to execute the idea against supplied company context and policies. State risks and evidence gaps; do not certify compliance or assume internal AT&T policy access.' },
  { role: 'scale', schema: boardSchema, instruction: 'Produce an executive scale statement with source-grounded deployment considerations, dependencies, management direction, and next steps. Distinguish recommendations from approved execution.' },
  { role: 'scale', stage: 'presentation', schema: presentationSchema, instruction: 'Compile Board statements into an SVP/executive-investor presentation: opportunity, evidence, recorded outcomes/delegation, financial assessment, compliance risks, scale plan, limitations. Preserve citations; never imply forecasts are actual results.' },
];
export const stageName = stage => stage.stage || stage.role;

// Durable StateBus adapter. MongoDB owns hand-offs and atomic leases; events carry IDs.
export class MongoStateBus {
  async publish(event, session) {
    requireValue(event.type === 'run.ready' && mongoose.isValidObjectId(event.payload?.runId), 'Invalid Jade hand-off');
    await JadeRun.updateOne({ _id: event.payload.runId, status: 'running', leaseToken: event.correlationId },
      { $set: { status: 'queued', leaseUntil: null, leaseToken: '' } }, { session });
  }
  subscribe(type, handler) {
    requireValue(type === 'run.ready', 'Unsupported Jade event');
    let busy = false, pending = false, closed = false, stream, reconnect;
    const drain = async () => {
      if (closed || !providerStatus().configured) return;
      if (busy) { pending = true; return; }
      busy = true;
      try {
        do { pending = false; while (!closed && await handler()) {} } while (pending && !closed);
      } catch { console.error('Jade change-stream consumer failed; work remains durable.'); }
      finally { busy = false; }
    };
    const connect = () => {
      if (closed) return;
      stream = JadeRun.collection.watch([{ $match: { $or: [
        { operationType: 'insert' }, { 'updateDescription.updatedFields.status': 'queued' },
      ] } }], { fullDocument: 'default' });
      stream.on('change', () => { void drain(); });
      stream.on('error', () => {
        void stream.close();
        if (!closed) reconnect = setTimeout(connect, 2000);
      });
      void drain();
    };
    connect();
    // Recovery sweep only: normal hand-offs wake through change streams.
    const recovery = setInterval(() => { void drain(); }, 30000); recovery.unref();
    return async () => { closed = true; clearInterval(recovery); clearTimeout(reconnect); await stream?.close(); };
  }
}
export async function getRunRecords(run) {
  const records = (await Promise.all(Object.entries(outputs).map(async ([role, model]) =>
    (await model.find({ run: run._id, revision: run.revision, organization: run.organization }).lean()).map(record => ({ ...record, role }))))).flat();
  return records.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}
const getRecord = (records, stage) => records.find(record => record.stage === stage);
export function verifiedWorkers(records, delegated = false) {
  const checks = records.filter(record => record.role.startsWith('context_check_')).flatMap(record => record.data.checks);
  return records.filter(record => ['files', 'metrics', 'projects', 'meetings'].map(role => delegated ? `delegated_${role}` : role).includes(record.stage)
    && checks.some(check => check.recordId === String(record._id) && check.status === 'verified'));
}
export function validateAssignments(assignments, items, members) {
  const used = new Set();
  for (const assignment of assignments) {
    requireValue(Number.isInteger(assignment.itemIndex) && items[assignment.itemIndex]?.kind === 'action_item', 'Manager assignment must reference an action item.');
    requireValue(!used.has(assignment.itemIndex), 'Manager duplicated an assignment.'); used.add(assignment.itemIndex);
    if (assignment.targetType === 'user') requireValue(members.some(member => String(member._id) === assignment.userId) && !assignment.workerRole, 'Manager selected an ineligible user.');
    else requireValue(['files', 'metrics', 'projects', 'meetings'].includes(assignment.workerRole) && !assignment.userId, 'Invalid worker delegation.');
  }
  requireValue(items.filter(item => item.kind === 'action_item').length === used.size, 'Manager must delegate every action item.');
}
export async function processNext({ provider = callOpus, bus = new MongoStateBus() } = {}) {
  const token = randomUUID();
  const run = await JadeRun.findOneAndUpdate({ $or: [{ status: 'queued' }, { status: 'running', leaseUntil: { $lt: new Date() } }] },
    { $set: { status: 'running', leaseToken: token, leaseUntil: new Date(Date.now() + 300000) } },
    { sort: { createdAt: 1 }, new: true }).select('+sources.bytes +sources.frames');
  if (!run) return false;
  const heartbeat = setInterval(() => {
    void JadeRun.updateOne({ _id: run._id, leaseToken: token, status: 'running' }, { $set: { leaseUntil: new Date(Date.now() + 300000) } }).catch(() => {});
  }, 30000); heartbeat.unref();
  try {
    const stage = stages[run.step]; requireValue(stage, 'Invalid Jade checkpoint');
    await JadeRun.updateOne({ _id: run._id, leaseToken: token }, { $set: { currentAgent: stage.role, error: '' } });
    if (run.step === 0) {
      for (const source of run.sources) await prepareSource(source);
      const storedSize = run.sources.reduce((size, source) => size + (source.bytes?.length || 0) + (source.text?.length || 0) * 3 + (source.frames || []).reduce((total, frame) => total + frame.length, 0), 0);
      requireValue(storedSize < 14 * 1024 * 1024, 'Prepared media/text exceeds storage limits. Split the upload into smaller files.');
      await JadeRun.updateOne({ _id: run._id, leaseToken: token }, { $set: { sources: run.sources.map(source => source.toObject()) } });
    }
    const sources = [...run.sources.map(source => ({ ...source.toObject(), bytes: source.bytes, frames: source.frames })),
      { sourceId: 'BUSINESS', name: 'Supplied business context', text: run.businessContext, purpose: 'business_context', kind: 'text' },
      ...run.clarifications.map((entry, index) => ({ sourceId: `HUMAN-${index + 1}`, name: 'Human clarification', text: entry.text, purpose: 'business_context', kind: 'text' }))];
    const records = await getRunRecords(run);
    let inputs = records;
    if (stage.role.startsWith('context_check_')) {
      const roles = stage.role === 'context_check_1' ? ['files', 'metrics'] : ['projects', 'meetings'];
      inputs = records.filter(record => roles.map(role => stage.stage ? `delegated_${role}` : role).includes(record.stage));
    }
    if (stage.role === 'admin_context_check') {
      requireValue(records.filter(record => ['context_check_1', 'context_check_2'].includes(record.stage)).length === 2, 'Context package requires both saved verification records.');
      inputs = verifiedWorkers(records);
    }
    if (stage.role === 'assistant') inputs = records.filter(record => record.stage === 'admin_context_check');
    if (stage.role === 'manager') inputs = stage.stage === 'manager_final' ? [...records.filter(record => ['assistant', 'manager', 'admin_context_check'].includes(record.stage)), ...verifiedWorkers(records, true)] : records.filter(record => record.stage === 'assistant');
    if (stage.stage?.startsWith('delegated_') && !stage.role.startsWith('context_check_')) inputs = records.filter(record => ['assistant', 'manager', 'admin_context_check'].includes(record.stage));
    if (['finance', 'scale', 'compliance_governance'].includes(stage.role)) {
      inputs = [...records.filter(record => (stage.stage === 'presentation' ? ['admin_context_check', 'assistant', 'manager_final', 'finance', 'compliance_governance', 'scale'] : ['admin_context_check', 'assistant', 'manager_final']).includes(record.stage)), ...verifiedWorkers(records, true)];
    }
    const members = await User.find({ organization: run.organization, department: run.department, status: 'active', loginEnabled: { $ne: false } }).select('name role department').lean();
    const creator = await User.findOne({ _id: run.creator, organization: run.organization, role: 'admin', status: 'active', loginEnabled: { $ne: false } });
    requireValue(creator && (creator.department === '*' || creator.department === run.department), 'The initiating admin no longer has permission to run this workflow.', 403);
    const data = await provider({ role: stage.role, model: run.model, schema: stage.schema, instructions: stage.instruction,
      input: { title: run.title, goal: run.goal, businessContext: run.businessContext,
        sourceDirectory: sources.map(({ sourceId, name, coverage }) => ({ sourceId, name, coverage })),
        records: inputs.map(record => ({ recordId: String(record._id), role: record.role, stage: record.stage, data: record.data })),
        managerFeedback: run.managerFeedback || [], eligibleUsers: stage.role === 'manager' ? members : [], clarifications: run.clarifications.map(entry => entry.text),
        workerAssignments: stage.stage?.startsWith('delegated_') ? getRecord(records, 'manager')?.data.assignments.filter(entry => entry.workerRole === stage.role) : [],
      }, blocks: ['files', 'metrics', 'projects', 'meetings', 'context_check_1', 'context_check_2'].includes(stage.role) ? sourceBlocks(sources) : [],
    });
    validateSourceReferences(data, sources);
    if (stage.role.startsWith('context_check_')) {
      const expected = new Set(inputs.map(record => String(record._id)));
      requireValue(data.checks.length === expected.size && new Set(data.checks.map(check => check.recordId)).size === expected.size
        && data.checks.every(check => expected.has(check.recordId)), 'Context Check must verify each assigned record exactly once.');
    }
    if (stage.role === 'manager' && data.decision === 'approve' && !data.criticalQuestions.length) validateAssignments(data.assignments, getRecord(records, 'assistant').data.items, members);
    if (stage.role === 'manager' && data.decision === 'approve' && !data.criticalQuestions.length) {
      if (!stage.stage && run.managerFeedback.length) requireValue(data.assignments.some(entry => entry.workerRole === run.managerFeedback.at(-1).workerRole), 'Assistant reassignment must include the Manager-designated worker.');
      if (stage.stage === 'manager_final') {
        const initial = getRecord(records, 'manager').data.assignments;
        requireValue(data.assignments.every(entry => initial.some(previous => previous.itemIndex === entry.itemIndex && previous.targetType === entry.targetType && previous.workerRole === entry.workerRole && previous.userId === entry.userId)), 'Changed assignments require Manager revision and a new worker iteration.');
      }
    }
    if (stage.role === 'admin_context_check') {
      const allowed = new Set(inputs.flatMap(record => record.data.facts).map(fact => JSON.stringify(fact)));
      requireValue(data.facts.every(fact => allowed.has(JSON.stringify(fact))), 'Context package introduced a fact outside verified worker records.');
    }
    if (stage.role === 'manager' && data.decision === 'revise') requireValue(data.feedback?.trim() && ['files', 'metrics', 'projects', 'meetings'].includes(data.designatedWorker), 'Manager revision needs feedback and a designated worker.');
    data.rank = data.timelineSignals?.length ? 1 : 0;
    if (data.items) { data.items = data.items.map(item => ({ ...item, importanceRank: item.timelineSignals?.length ? 1 : 0 })).sort((a, b) => b.importanceRank - a.importanceRank); }
    const agent = await JadeAgent.findOne({ organization: run.organization, role: stage.role }); requireValue(agent, 'Jade roster is missing');
    await mongoose.connection.transaction(async session => {
      const current = await JadeRun.findOne({ _id: run._id, status: 'running', leaseToken: token }).session(session);
      requireValue(current, 'Jade lease expired; stale agent output rejected.', 409);
      await outputs[stage.role].create([{ organization: run.organization, department: run.department, run: run._id,
        revision: run.revision, stage: stageName(stage), agentId: agent._id, model: run.model, data, inputRecordIds: inputs.map(record => record._id),
      }], { session });
      const failedChecks = (data.checks || []).filter(check => check.status === 'failed');
      if (failedChecks.length) {
        current.status = 'needs_review'; current.questions = failedChecks.map(check => check.findings || 'A worker output failed verification.');
        current.leaseToken = ''; current.leaseUntil = null;
      } else if (stage.role === 'manager' && data.decision === 'revise' && !data.criticalQuestions.length) {
        current.managerFeedback.push({ text: data.feedback, workerRole: data.designatedWorker, at: new Date() });
        current.managerIteration += 1;
        current.revision += 1; current.step = 0;
        // Bound autonomous revision cycles; human feedback can explicitly restart the workflow.
        if (current.managerIteration >= Math.max(1, Number(process.env.JADE_MAX_MANAGER_ITERATIONS) || 3)) {
          current.status = 'needs_review'; current.questions = ['Manager revisions require human feedback before another iteration.', data.feedback];
          current.leaseToken = ''; current.leaseUntil = null;
        }
      } else if (data.criticalQuestions.length) {
        current.status = 'needs_context'; current.questions = data.criticalQuestions; current.leaseToken = ''; current.leaseUntil = null;
      } else if (run.step === stages.length - 1) {
        current.taskIds = await createDelegatedTasks(current, records, session);
        current.status = 'completed'; current.finishedAt = new Date(); current.leaseToken = ''; current.leaseUntil = null;
      } else if (stage.stage === 'manager_final') {
        current.step += 1; current.status = 'awaiting_approval'; current.questions = [];
        current.leaseToken = ''; current.leaseUntil = null;
      } else current.step += 1;
      await current.save({ session });
      if (current.status === 'running') await bus.publish({ type: 'run.ready', at: new Date().toISOString(), correlationId: token, payload: { runId: run._id } }, session);
    });
  } catch (error) {
    const review = error.status === 400 || error.status === 422;
    const message = error.status ? error.message : 'Jade processing failed. Check source readability, provider configuration, and backend logs.';
    await JadeRun.updateOne({ _id: run._id, leaseToken: token, status: 'running' }, { $set: { status: review ? 'needs_review' : 'failed', questions: review ? [message] : [], error: message, leaseToken: '', leaseUntil: null } });
    console.error('Jade stage failed:', error.name);
  } finally { clearInterval(heartbeat); }
  return true;
}
async function createDelegatedTasks(run, records, session) {
  const manager = getRecord(records, 'manager_final'); const assistant = getRecord(records, 'assistant');
  const creator = await User.findOne({ _id: run.creator, organization: run.organization, role: 'admin', status: 'active', loginEnabled: { $ne: false } }).session(session);
  requireValue(creator && isAdmin(creator, run.department), 'Task delegation authorization was revoked.', 403);
  if (run.project) requireValue(await Project.exists({ _id: run.project, organization: run.organization, department: run.department, archived: false }).session(session), 'Linked project is unavailable.');
  const members = await User.find({ organization: run.organization, department: run.department, status: 'active', loginEnabled: { $ne: false } }).session(session).lean();
  validateAssignments(manager.data.assignments, assistant.data.items, members);
  const ids = [];
  for (const assignment of manager.data.assignments.filter(entry => entry.targetType === 'user')) {
    const item = assistant.data.items[assignment.itemIndex]; const key = `${run._id}:${run.revision}:${assignment.itemIndex}`;
    const task = await Task.findOneAndUpdate({ jadeSource: key }, { $setOnInsert: {
      jadeSource: key, organization: run.organization, department: run.department, project: run.project,
      creator: run.creator, owner: assignment.userId, title: item.title.slice(0, 500), priority: item.priority,
      description: `${item.description}\n\nBusiness need: ${item.businessNeed}\nUrgency: ${item.urgency}\nJade run: ${run.title}\nSources: ${item.sourceIds.join(', ')}\nDelegation: ${assignment.rationale}`.slice(0, 30000), status: 'todo',
    } }, { upsert: true, new: true, session, runValidators: true }); ids.push(task._id);
  }
  return ids;
}
export async function startJadeRuntime() {
  await JadeRun.createCollection();
  const bus = new MongoStateBus(); return bus.subscribe('run.ready', () => processNext({ bus }));
}
export { ensureRoster };
