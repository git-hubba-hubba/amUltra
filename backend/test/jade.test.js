import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { app } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { User, Task, Session } from '../src/models.js';
import { JadeRun, JadeDecision, outputs } from '../src/jade/models.js';
import { processNext, stages, getRunRecords, verifiedWorkers } from '../src/jade/runtime.js';
import { prepareSource, sourceBlocks } from '../src/jade/sources.js';
import { callOpus } from '../src/jade/provider.js';
import { workerSchema } from '../src/jade/contracts.js';

process.env.MONGOMS_DOWNLOAD_DIR ||= join(tmpdir(), 'amethyst-mongodb-binaries');
let replica, admin, member, foreign;
const clients = {};
const originalKey = process.env.ANTHROPIC_API_KEY;
const password = 'jade-test-password-strong';
before(async () => {
  process.env.ANTHROPIC_API_KEY = 'test-fixture-no-network';
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri(), { dbName: 'jade_test' });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  [admin, member, foreign] = await User.create([
    { name: 'Admin', email: 'jade-admin@example.test', organization: 'jade-test', role: 'admin', department: '*' },
    { name: 'Sales rep', email: 'jade-member@example.test', organization: 'jade-test', role: 'member', department: 'Sales' },
    { name: 'Foreign', email: 'jade-foreign@example.test', organization: 'foreign', role: 'admin', department: '*' },
  ].map(user => ({ ...user, passwordHash: hashPassword(password), status: 'active' })));
  for (const user of [admin, member, foreign]) {
    clients[user.name] = request.agent(app);
    await clients[user.name].post('/api/auth/login').send({ email: user.email, password }).expect(200);
    await clients[user.name].post('/api/jade/unlock').send({ password: 'jasmine_tea' }).expect(200);
  }
}, { timeout: 180000 });
after(async () => {
  if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = originalKey;
  await mongoose.disconnect(); if (replica) await replica.stop();
});
async function upload(title = 'Sales plan') {
  return (await clients.Admin.post('/api/jade/runs').field('title', title).field('goal', 'Prepare an executive decision presentation')
    .field('department', 'Sales').field('businessContext', 'AT&T Sales. Approved budget is $5000. Sales rep can follow up with customers.')
    .attach('files', Buffer.from('Approved budget is $5000. Follow up with customers.'), 'plan.txt').expect(202)).body;
}
const fact = { statement: 'Approved budget is $5000.', sourceId: 'SOURCE-1', locator: 'line 1', evidence: 'Approved budget is $5000.' };
function providerFixture({ missingCritical = false, failChecks = false, badAssignment = false, badEvidence = false } = {}) {
  return async ({ role, schema, input }) => {
    const base = { summary: `${role} analysis`, facts: [structuredClone(fact)], limitations: [], criticalQuestions: [], timelineSignals: [] };
    if (badEvidence && role === 'files') base.facts[0].evidence = 'Invented budget is $9000.';
    if (missingCritical && role === 'metrics' && !input.clarifications.length) base.criticalQuestions = ['What is the urgent business deadline?'];
    if (schema.properties.checks) return { ...base, checks: input.records.map(record => ({ recordId: record.recordId, status: failChecks ? 'failed' : 'verified', findings: failChecks ? 'Unsupported claims omitted' : 'Matches original source' })) };
    if (role === 'admin_context_check') return { ...base, facts: input.records.flatMap(record => record.data.facts) };
    if (schema.properties.items) return { ...base, items: [
      { kind: 'action_item', title: 'Customer follow-up', description: 'Follow up with customers', priority: 'Medium', businessNeed: 'Sales follow-up', urgency: 'No urgent deadline supplied', sourceIds: ['SOURCE-1'], timelineSignals: [] },
      { kind: 'action_item', title: 'Analyze plan', description: 'Analyze the source plan', priority: 'Low', businessNeed: 'Understand plan', urgency: 'No urgent deadline', sourceIds: ['SOURCE-1'], timelineSignals: [] },
      { kind: 'notification', title: 'Budget recorded', description: 'Approved budget is $5000', priority: 'Medium', businessNeed: 'Budget context', urgency: 'No urgent deadline', sourceIds: ['SOURCE-1'], timelineSignals: [] },
    ] };
    if (schema.properties.assignments) return { ...base, decision: 'approve', feedback: '', designatedWorker: '', assignments: [
      { itemIndex: 0, targetType: 'user', userId: badAssignment ? String(foreign._id) : String(member._id), workerRole: '', rationale: 'Sales department member' },
      { itemIndex: 1, targetType: 'worker', userId: '', workerRole: 'projects', rationale: 'Project analysis' },
    ] };
    if (schema.properties.sections) return { ...base, title: 'Executive sales presentation', sections: [{ title: 'Business context', narrative: 'Source-grounded Sales opportunity.', sourceIds: ['SOURCE-1'] }] };
    if (schema.properties.recommendations) return { ...base, recommendations: ['Review source-grounded budget'] };
    return base;
  };
}
async function drain(provider, maximum = stages.length + 2) {
  for (let index = 0; index < maximum; index++) {
    if (!await processNext({ provider })) {
      const pending = await JadeRun.findOne({ organization: 'jade-test', status: 'awaiting_approval' });
      if (!pending) break;
      await clients.Admin.post(`/api/jade/runs/${pending._id}/approve`).send({ decision: 'approved', reason: 'Reviewed finished iteration', revision: pending.revision }).expect(200);
    }
  }
}

test('Jade uploads enforce authentication, admin rights, organization isolation and hide source bytes', async () => {
  await request(app).get('/api/jade/status').expect(401);
  await clients['Sales rep'].post('/api/jade/runs').expect(403);
  const run = await upload('Permissions fixture');
  assert.equal(run.sources[0].bytes, undefined);
  assert.equal(run.leaseToken, undefined);
  await clients.Foreign.get(`/api/jade/runs/${run._id}`).expect(404);
  await clients.Foreign.get(`/api/jade/runs/${run._id}/presentation.pdf`).expect(404);
  await clients['Sales rep'].post(`/api/jade/runs/${run._id}/retry`).expect(403);
  await clients.Admin.get(`/api/jade/runs/${run._id}/presentation.pdf`).expect(409);
  await JadeRun.updateOne({ _id: run._id }, { $set: { status: 'denied' } });
});

test('Jade password protects every data route, is session-bound, expires and can be relocked', async () => {
  const client = request.agent(app);
  await client.post('/api/auth/login').send({ email: admin.email, password }).expect(200);
  assert.deepEqual((await client.get('/api/jade/access').expect(200)).body, { unlocked: false });
  for (const path of ['/api/jade/status', '/api/jade/runs', `/api/jade/runs/${new mongoose.Types.ObjectId()}/presentation.pdf`]) {
    const response = await client.get(path).expect(403);
    assert.equal(response.body.code, 'JADE_LOCKED');
  }
  await client.post('/api/jade/runs').expect(403);
  await client.post('/api/jade/unlock').send({ password: 'incorrect' }).expect(403);
  await client.get('/api/jade/status').expect(403);
  await client.post('/api/jade/unlock').send({ password: 'jasmine_tea' }).expect(200);
  await client.get('/api/jade/status').expect(200);
  const anotherSession = request.agent(app);
  await anotherSession.post('/api/auth/login').send({ email: admin.email, password }).expect(200);
  await anotherSession.get('/api/jade/status').expect(403);
  await client.post('/api/jade/lock').expect(200);
  await client.get('/api/jade/status').expect(403);
  await client.post('/api/jade/unlock').send({ password: 'jasmine_tea' }).expect(200);
  await Session.updateMany({ user: admin._id }, { $set: { jadeUnlockedUntil: new Date(0) } });
  await client.get('/api/jade/status').expect(403);
  await client.post('/api/auth/logout').expect(200);
  await client.post('/api/auth/login').send({ email: admin.email, password }).expect(200);
  await client.get('/api/jade/status').expect(403);
  await clients.Admin.post('/api/jade/unlock').send({ password: 'jasmine_tea' }).expect(200);
});

test('document-to-workers-to-verification-to-delegation-to-PDF pipeline persists real outputs and creates tasks once', async () => {
  const run = await upload();
  await drain(providerFixture());
  const persisted = await JadeRun.findById(run._id);
  assert.equal(persisted.status, 'completed', persisted.error);
  const records = await getRunRecords(persisted);
  assert.equal(records.length, stages.length);
  assert.equal(verifiedWorkers(records).length, 4);
  assert.equal(verifiedWorkers(records, true).length, 4);
  assert.equal(persisted.taskIds.length, 1);
  const task = await Task.findById(persisted.taskIds[0]);
  assert.equal(String(task.owner), String(member._id));
  assert.equal(task.department, 'Sales');
  assert.equal(task.status, 'todo');
  assert.equal(task.dueDate, undefined);
  assert.match(task.description, /SOURCE-1/);
  assert.equal(await processNext({ provider: providerFixture() }), false);
  assert.equal(await Task.countDocuments({ jadeSource: new RegExp(run._id) }), 1);
  const detail = await clients.Admin.get(`/api/jade/runs/${run._id}`).expect(200);
  assert.equal(detail.body.run.sources[0].text, undefined);
  assert.equal(detail.body.records.length, stages.length);
  const pdf = await clients.Admin.get(`/api/jade/runs/${run._id}/presentation.pdf`).expect(200);
  assert.match(pdf.headers['content-type'], /application\/pdf/);
  assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
});

test('only unclear critical context requires human review; clarification reruns with evidence and stale decisions fail', async () => {
  const run = await upload('Critical context fixture');
  await drain(providerFixture({ missingCritical: true }));
  let persisted = await JadeRun.findById(run._id);
  assert.equal(persisted.status, 'needs_context');
  assert.equal(await Task.countDocuments({ jadeSource: new RegExp(run._id) }), 0);
  await clients['Sales rep'].post(`/api/jade/runs/${run._id}/context`).send({ decision: 'clarified', text: 'Deadline is Friday', revision: 0 }).expect(403);
  const decisions = await Promise.all([1, 2].map(() => clients.Admin.post(`/api/jade/runs/${run._id}/context`).send({ decision: 'clarified', text: 'Deadline is Friday', revision: 0 })));
  assert.deepEqual(decisions.map(result => result.status).sort(), [200, 409]);
  assert.equal(await JadeDecision.countDocuments({ run: run._id }), 1);
  await drain(providerFixture({ missingCritical: true }));
  persisted = await JadeRun.findById(run._id);
  assert.equal(persisted.status, 'completed', persisted.error);
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.clarifications.length, 1);
  assert.equal(await outputs.files.countDocuments({ run: run._id, stage: 'files' }), 2);
});

test('failed verification enters human review and feedback restarts workers', async () => {
  const run = await upload('Failed checks fixture');
  const provider = providerFixture({ failChecks: true });
  for (let index = 0; index <= stages.findIndex(stage => stage.role === 'admin_context_check'); index++) await processNext({ provider });
  const persisted = await JadeRun.findById(run._id);
  assert.equal(persisted.status, 'needs_review');
  assert.equal(verifiedWorkers(await getRunRecords(persisted)).length, 0);
  const context = await outputs.admin_context_check.findOne({ run: run._id });
  assert.equal(context, null);
  await clients.Admin.post(`/api/jade/runs/${run._id}/context`).send({ decision: 'clarified', text: 'Recheck the budget against the uploaded source.', revision: 0 }).expect(200);
  assert.equal((await JadeRun.findById(run._id)).step, 0);
  assert.equal(await JadeDecision.countDocuments({ run: run._id }), 1);
  await JadeRun.updateOne({ _id: run._id }, { $set: { status: 'denied' } });
});

test('fabricated textual evidence and foreign user delegation fail before any task is created', async () => {
  for (const configuration of [{ badEvidence: true }, { badAssignment: true }]) {
    const run = await upload('Invalid evidence/assignment');
    await drain(providerFixture(configuration));
    const persisted = await JadeRun.findById(run._id);
    assert.equal(persisted.status, 'needs_review');
    assert.equal(await Task.countDocuments({ jadeSource: new RegExp(run._id) }), 0);
    await JadeRun.updateOne({ _id: run._id }, { $set: { status: 'denied' } });
  }
});

test('two queue consumers cannot process the same active stage and expired leases recover checkpoints', async () => {
  const run = await upload('Lease fixture');
  let calls = 0;
  const fixture = providerFixture();
  const provider = async args => { calls++; await new Promise(resolve => setTimeout(resolve, 100)); return fixture(args); };
  const results = await Promise.all([processNext({ provider }), processNext({ provider })]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(calls, 1);
  await JadeRun.updateOne({ _id: run._id }, { $set: { status: 'running', leaseUntil: new Date(0), leaseToken: 'expired' } });
  await processNext({ provider: fixture });
  assert.equal((await JadeRun.findById(run._id)).step, 2);
  await JadeRun.updateOne({ _id: run._id }, { $set: { status: 'denied' } });
});

test('spreadsheet conversion preserves row numbers and PDF blocks use actual source bytes', async () => {
  const csv = { name: 'numbers.csv', bytes: Buffer.from('Metric,Value\nSales,5'), sourceId: 'SOURCE-1', purpose: 'input' };
  await prepareSource(csv);
  assert.match(csv.text, /row 2: \["Sales","5"\]/);
  const pdf = { name: 'source.pdf', bytes: Buffer.from('%PDF-1.7 test'), sourceId: 'SOURCE-2', purpose: 'input' };
  await prepareSource(pdf);
  assert.equal(sourceBlocks([pdf])[1].source.data, pdf.bytes.toString('base64'));
});

test('Opus adapter validates model output and rejects truncated/provider failures without leaking secrets', async () => {
  const originalFetch = global.fetch;
  try {
    let requestBody;
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify({ summary: 'Test', facts: [], limitations: [], criticalQuestions: [], timelineSignals: [] }) }] }) };
    };
    const result = await callOpus({ role: 'files', instructions: 'Extract', input: {}, schema: workerSchema });
    assert.equal(result.summary, 'Test');
    assert.equal(requestBody.model, 'claude-opus-5-5');
    assert.equal(requestBody.output_config.format.type, 'json_schema');
    assert.ok(!('temperature' in requestBody));
    global.fetch = async () => ({ ok: true, json: async () => ({ stop_reason: 'max_tokens', content: [] }) });
    await assert.rejects(callOpus({ role: 'files', instructions: '', input: {}, schema: workerSchema }), /did not finish/);
    global.fetch = async () => ({ ok: false, status: 401 });
    await assert.rejects(callOpus({ role: 'files', instructions: '', input: {}, schema: workerSchema }), /HTTP 401/);
  } finally { global.fetch = originalFetch; }
});

test('real FFmpeg audio/video preprocessing retains transcript and sampled-visual coverage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'jade-media-test-'));
  const originalFetch = global.fetch;
  const originalUrl = process.env.JADE_TRANSCRIPTION_URL;
  const originalModel = process.env.JADE_TRANSCRIPTION_MODEL;
  process.env.JADE_TRANSCRIPTION_URL = 'http://localhost/transcriptions';
  process.env.JADE_TRANSCRIPTION_MODEL = 'fixture-transcriber';
  let transcriptions = 0;
  try {
    const exec = promisify(execFile);
    await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', join(directory, 'audio.wav')]);
    global.fetch = async (_url, options) => {
      assert.equal(options.body.get('model'), 'fixture-transcriber');
      assert.ok(options.body.get('file').size > 0);
      transcriptions++;
      return { ok: true, json: async () => ({ text: 'Sales follow-up meeting.' }) };
    };
    const audio = { name: 'meeting.wav', bytes: await readFile(join(directory, 'audio.wav')), sourceId: 'SOURCE-1', purpose: 'input' };
    await prepareSource(audio);
    assert.equal(audio.text, 'Sales follow-up meeting.');
    assert.match(audio.coverage, /Audio transcribed/);
    assert.equal(transcriptions, 1);
    await exec(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=160x120:d=2', '-c:v', 'mpeg4', join(directory, 'silent.mp4')]);
    const video = { name: 'silent.mp4', bytes: await readFile(join(directory, 'silent.mp4')), sourceId: 'SOURCE-2', purpose: 'input' };
    await prepareSource(video);
    assert.ok(video.frames.length > 0 && video.frames.length <= 20);
    assert.match(video.coverage, /Silent video/);
    assert.match(video.coverage, /unsampled scenes/);
    assert.equal(transcriptions, 1);
    assert.ok(sourceBlocks([video]).some(block => block.type === 'image'));
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.JADE_TRANSCRIPTION_URL; else process.env.JADE_TRANSCRIPTION_URL = originalUrl;
    if (originalModel === undefined) delete process.env.JADE_TRANSCRIPTION_MODEL; else process.env.JADE_TRANSCRIPTION_MODEL = originalModel;
    await rm(directory, { recursive: true, force: true });
  }
});

test('Manager feedback returns through Assistant to the designated worker in a new iteration', async () => {
  const run = await upload('Manager reroute fixture');
  const fixture = providerFixture();
  let assistantSawFeedback = false;
  const provider = async args => {
    const data = await fixture(args);
    if (args.role === 'manager' && !args.input.managerFeedback.length) return { ...data, decision: 'revise', feedback: 'Reassess implementation vulnerability in the project plan.', designatedWorker: 'projects', assignments: [] };
    if (args.role === 'assistant' && args.input.managerFeedback.length) assistantSawFeedback = true;
    return data;
  };
  await drain(provider, stages.length * 2 + 4);
  const persisted = await JadeRun.findById(run._id);
  assert.equal(persisted.status, 'completed', persisted.error);
  assert.equal(persisted.revision, 1);
  assert.equal(persisted.managerFeedback[0].workerRole, 'projects');
  assert.equal(assistantSawFeedback, true);
  assert.equal(await outputs.manager.countDocuments({ run: run._id, revision: 0 }), 1);
});

test('MongoDB change streams drive handoffs, admin gates Board work, and Board inputs stay independent', async () => {
  const { MongoStateBus } = await import('../src/jade/runtime.js');
  const bus = new MongoStateBus();
  const fixture = providerFixture();
  const boardInputs = [];
  const provider = async args => {
    if (['finance', 'compliance_governance', 'scale'].includes(args.role) && !args.schema.properties.sections) boardInputs.push(args.input.records.map(record => record.role));
    return fixture(args);
  };
  const stop = bus.subscribe('run.ready', () => processNext({ provider, bus }));
  async function waitFor(id, state) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const run = await JadeRun.findById(id);
      if (run.status === state) return run;
      assert.notEqual(run.status, 'failed', run.error);
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.fail(`Change stream did not reach ${state}`);
  }
  try {
    const run = await upload('Change stream fixture');
    const pending = await waitFor(run._id, 'awaiting_approval');
    assert.equal(await outputs.finance.countDocuments({ run: run._id }), 0);
    await clients['Sales rep'].post(`/api/jade/runs/${run._id}/approve`).send({ decision: 'approved', reason: 'Review', revision: pending.revision }).expect(403);
    await clients.Admin.post(`/api/jade/runs/${run._id}/approve`).send({ decision: 'approved', reason: 'Finished iteration reviewed', revision: pending.revision }).expect(200);
    await clients.Admin.post(`/api/jade/runs/${run._id}/approve`).send({ decision: 'approved', reason: 'Stale decision', revision: pending.revision }).expect(409);
    await waitFor(run._id, 'completed');
    assert.equal(boardInputs.length, 3);
    assert.ok(boardInputs.every(roles => !roles.some(role => ['finance', 'scale', 'compliance_governance'].includes(role))));
  } finally { await stop(); }
});

test('timeline ranking uses communicated temporal evidence, never ordinary business need', async () => {
  const run = await upload('Timeline ranking fixture');
  const fixture = providerFixture();
  const provider = async args => {
    const data = await fixture(args);
    if (args.role === 'assistant') {
      data.items[2].timelineSignals = [{ sourceId: 'BUSINESS', locator: 'Business context', evidence: 'Deadline: Friday.' }];
    }
    return data;
  };
  await JadeRun.updateOne({ _id: run._id }, { $set: { businessContext: 'AT&T Sales. Deadline: Friday.' } });
  for (let index = 0; index <= stages.findIndex(stage => stage.role === 'assistant'); index++) await processNext({ provider });
  const result = await outputs.assistant.findOne({ run: run._id });
  assert.equal(result.data.items[0].kind, 'notification');
  assert.equal(result.data.items[0].importanceRank, 1);
  assert.ok(result.data.items.slice(1).every(item => item.importanceRank === 0));
  await JadeRun.updateOne({ _id: run._id }, { $set: { status: 'denied' } });
});

test('execution lights follow actual stages, revisions and review pauses', async () => {
  const { agentState } = await import('../../frontend/amethyst2/src/lib/jadeExecution.js');
  const records = [{ role: 'files', revision: 0 }];
  assert.equal(agentState('files', { status: 'running', currentAgent: 'files', revision: 0 }, records), 'running');
  assert.equal(agentState('files', { status: 'queued', currentAgent: 'files', revision: 0 }, records), 'completed');
  assert.equal(agentState('files', { status: 'queued', currentAgent: 'files', revision: 1 }, records), 'idle');
  assert.equal(agentState('metrics', { status: 'needs_context', currentAgent: 'metrics', revision: 0 }, records), 'review');
  assert.equal(agentState('metrics', { status: 'failed', currentAgent: 'metrics', revision: 0 }, records), 'failed');
  assert.equal(agentState('scale', null, records), 'idle');
});

test('SSE streams real Mongo transitions, excludes source bytes and closes when Jade locks', { timeout: 15000 }, async () => {
  const run = await upload('Live diagram test');
  await clients.Foreign.get(`/api/jade/runs/${run._id}/events`).expect(404);
  const login = await request(app).post('/api/auth/login').send({ email: admin.email, password }).expect(200);
  const cookie = login.headers['set-cookie'].map(value => value.split(';')[0]).join('; ');
  await request(app).post('/api/jade/unlock').set('Cookie', cookie).send({ password: 'jasmine_tea' }).expect(200);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  let reader;
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/jade/runs/${run._id}/events`, { headers: { Cookie: cookie }, signal: controller.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    async function nextEvent() {
      while (!buffer.includes('\n\n')) {
        const chunk = await reader.read();
        assert.equal(chunk.done, false);
        buffer += decoder.decode(chunk.value, { stream: true });
      }
      const index = buffer.indexOf('\n\n');
      const event = buffer.slice(0, index); buffer = buffer.slice(index + 2);
      if (event.startsWith(':')) return nextEvent();
      return event;
    }
    const snapshot = await nextEvent();
    assert.match(snapshot, /event: run/);
    assert.ok(!snapshot.includes('bytes') && !snapshot.includes('leaseToken'));
    await JadeRun.updateOne({ _id: run._id }, { $set: { status: 'running', currentAgent: 'metrics' } });
    const transition = await nextEvent();
    assert.match(transition, /"currentAgent":"metrics"/);
    assert.match(transition, /"status":"running"/);
    await request(app).post('/api/jade/lock').set('Cookie', cookie).expect(200);
    await JadeRun.updateOne({ _id: run._id }, { $set: { currentAgent: 'projects' } });
    assert.match(await nextEvent(), /event: locked/);
    assert.equal((await reader.read()).done, true);
  } finally {
    clearTimeout(timeout); controller.abort();
    if (reader) await reader.cancel().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }
});
