import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { app } from '../src/app.js';
import { hashPassword } from '../src/auth.js';
import { User, Task, Proposal, Batch, Cinema, Project, Event, Session, ProjectAccess } from '../src/models.js';

// Tests use real mongod processes and transactions; no database methods are mocked.
process.env.MONGOMS_DOWNLOAD_DIR ||= join(tmpdir(), 'amethyst-mongodb-binaries');
process.env.ORGANIZATION = 'amethyst';
const password = 'test-only-strong-password';
let replica;
let users;
const clients = {};
const id = value => String(value._id || value);

before(async () => {
  replica = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replica.getUri(), { dbName: 'amethyst_integration' });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const specs = [
    { name: 'Admin', email: 'admin@example.test', role: 'admin', department: '*' },
    { name: 'Department admin', email: 'department@example.test', role: 'admin', department: 'Engineering' },
    { name: 'Alice', email: 'alice@example.test', department: 'Engineering' },
    { name: 'Bob', email: 'bob@example.test', department: 'Engineering' },
    { name: 'Foreign admin', email: 'foreign@example.test', role: 'admin', department: '*', organization: 'other-org' },
  ];
  users = await User.create(specs.map(user => ({ organization: 'amethyst', role: 'member', status: 'active', passwordHash: hashPassword(password), ...user })));
  for (const user of users) {
    const client = request.agent(app);
    await client.post('/api/auth/login').send({ email: user.email, password }).expect(200);
    clients[user.name] = client;
  }
}, { timeout: 180000 });

after(async () => {
  await mongoose.disconnect();
  if (replica) await replica.stop();
});

const createTask = (overrides = {}) => Task.create({ organization: 'amethyst', department: 'Engineering', creator: users[0]._id, title: 'Test task', ...overrides });

test('signup enables immediate workspace reads without granting admin rights; logout remains enforced', async () => {
  await request(app).get('/api/tasks').expect(401);
  const client = request.agent(app);
  const signup = await client.post('/api/auth/signup').send({ name: 'New member', email: 'new@example.test', password, department: 'Engineering', role: 'admin', status: 'pending', organization: 'other-org', projectAdminIds: [id(users[0])] }).expect(201);
  assert.equal(signup.body.user.role, 'member');
  assert.equal(signup.body.user.status, 'active');
  assert.deepEqual(signup.body.user.projectAdminIds, []);
  assert.equal((await User.findById(signup.body.user._id)).organization, 'amethyst');
  assert.equal(signup.body.user.passwordHash, undefined);
  const login = await client.post('/api/auth/login').send({ email: 'new@example.test', password }).expect(200);
  assert.match(login.headers['set-cookie'][0], /HttpOnly/);
  assert.match(login.headers['set-cookie'][0], /SameSite=Strict/);
  await client.get('/api/auth/me').expect(200);
  for (const path of ['tasks', 'projects', 'events', 'topics', 'meetings', 'roadmap', 'cinemas', 'avp', 'overview', 'queue', 'members', 'proposals', 'project-access']) {
    await client.get(`/api/${path}`).expect(200);
  }
  await client.patch(`/api/members/${signup.body.user._id}`).send({ role: 'admin' }).expect(404);
  await client.post('/api/auth/logout').expect(200);
  await client.get('/api/auth/me').expect(401);
  assert.equal(await Session.countDocuments({ user: signup.body.user._id }), 0);
});

test('malformed stored passwords return a generic login rejection without creating sessions', async t => {
  const validHash = hashPassword(password);
  const user = await User.create({ organization: 'amethyst', name: 'Malformed password fixture', email: 'malformed-password@example.test', department: 'Engineering', status: 'active', passwordHash: validHash });
  const [salt, hash] = validHash.split(':');
  const cases = [
    ['legacy string without separator', 'legacy-password-value'],
    ['truncated hash', `${salt}:${hash.slice(0, -2)}`],
    ['nonhex hash', `${salt}:${'z'.repeat(128)}`],
    ['missing hash', undefined],
  ];
  try {
    for (const [name, passwordHash] of cases) {
      await t.test(name, async () => {
        await User.collection.updateOne({ _id: user._id }, passwordHash === undefined ? { $unset: { passwordHash: '' } } : { $set: { passwordHash } });
        const response = await request(app).post('/api/auth/login').send({ email: user.email, password }).expect(401);
        assert.deepEqual(response.body, { error: 'Invalid email or password' });
        assert.equal(response.headers['set-cookie'], undefined);
        assert.equal(await Session.countDocuments({ user: user._id }), 0);
      });
    }
  } finally {
    await Session.deleteMany({ user: user._id });
    await User.deleteOne({ _id: user._id });
  }
});

test('unknown email and incorrect password return the same rejection without creating sessions', async () => {
  const sessionCount = await Session.countDocuments();
  for (const email of ['unknown-login@example.test', users[2].email]) {
    const response = await request(app).post('/api/auth/login').send({ email, password: 'incorrect-test-password' }).expect(401);
    assert.deepEqual(response.body, { error: 'Invalid email or password' });
    assert.equal(response.headers['set-cookie'], undefined);
  }
  assert.equal(await Session.countDocuments(), sessionCount);
});

test('all resource access and reference validation stay inside the current organization', async () => {
  const foreign = await createTask({ organization: 'other-org', creator: users[4]._id, title: 'Foreign secret' });
  const task = await createTask();
  await clients.Alice.get(`/api/tasks/${foreign._id}`).expect(404);
  await clients.Admin.patch(`/api/tasks/${foreign._id}`).send({ title: 'Changed', __v: 0 }).expect(404);
  await clients.Admin.post(`/api/tasks/${task._id}/assign`).send({ owner: users[4]._id }).expect(400);
  const results = await clients.Alice.get('/api/tasks?q=Foreign').expect(200);
  assert.equal(results.body.total, 0);
  const members = await clients.Alice.get('/api/members').expect(200);
  assert.ok(!members.body.some(user => user._id === id(users[4])));
  const foreignProject = await Project.create({ organization: 'other-org', department: 'Engineering', creator: users[4]._id, title: 'Hidden project' });
  await clients.Alice.post('/api/tasks').send({ title: 'Bad reference', department: 'Engineering', project: id(foreignProject) }).expect(404);
});

test('only a department admin can assign tasks, including create and PATCH bypass attempts', async () => {
  const task = await createTask();
  await clients.Alice.post(`/api/tasks/${task._id}/assign`).send({ owner: users[3]._id }).expect(403);
  await clients.Alice.post('/api/tasks').send({ title: 'Bypass', department: 'Engineering', owner: users[3]._id }).expect(403);
  await clients.Alice.patch(`/api/tasks/${task._id}`).send({ owner: users[3]._id, __v: 0 }).expect(403);
  await clients.Admin.post(`/api/tasks/${task._id}/assign`).send({ owner: users[2]._id }).expect(200);
  assert.equal(id((await Task.findById(task._id)).owner), id(users[2]));
  const otherDepartment = await createTask({ department: 'Finance' });
  await clients['Department admin'].post(`/api/tasks/${otherDepartment._id}/assign`).send({ owner: users[2]._id }).expect(403);
});

test('simultaneous task claims produce one owner and one conflict without lost ownership', async () => {
  const task = await createTask();
  const responses = await Promise.all([clients.Alice.post(`/api/tasks/${task._id}/claim`), clients.Bob.post(`/api/tasks/${task._id}/claim`)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
  const persisted = await Task.findById(task._id);
  assert.equal(persisted.assignmentHistory.length, 1);
  assert.ok([id(users[2]), id(users[3])].includes(id(persisted.owner)));
  const ownerClient = id(persisted.owner) === id(users[2]) ? clients.Alice : clients.Bob;
  const queue = await ownerClient.get('/api/queue').expect(200);
  assert.ok(queue.body.some(item => item._id === id(task)));
});

test('task edits reject stale versions, invalid difficulty, missing blocked reasons, and member tier changes', async () => {
  const task = await createTask({ owner: users[2]._id });
  await clients.Admin.patch(`/api/tasks/${task._id}`).send({ __v: 0, difficulty: 2.5 }).expect(400);
  await clients.Alice.patch(`/api/tasks/${task._id}`).send({ __v: 0, priority: 'Critical' }).expect(403);
  await clients.Alice.patch(`/api/tasks/${task._id}`).send({ __v: 0, status: 'blocked' }).expect(400);
  await clients.Alice.patch(`/api/tasks/${task._id}`).send({ __v: 0, status: 'in_progress' }).expect(200);
  await clients.Alice.patch(`/api/tasks/${task._id}`).send({ __v: 0, title: 'Lost edit' }).expect(409);
  const action = await clients.Alice.post(`/api/tasks/${task._id}/actions`).send({ title: 'Review rubric' }).expect(201);
  await clients.Alice.patch(`/api/tasks/${task._id}/actions/${action.body.actionItems[0]._id}`).send({ done: true }).expect(200);
  await clients.Bob.post(`/api/tasks/${task._id}/actions`).send({ title: 'Unauthorized change' }).expect(403);
  await clients.Bob.post(`/api/tasks/${task._id}/comments`).send({ body: 'Context from another teammate' }).expect(201);
  await clients.Admin.delete(`/api/tasks/${task._id}`).expect(200);
  await clients.Alice.get(`/api/tasks/${task._id}`).expect(404);
});

test('upload automatically generates complete tasks and flags incomplete rows for one-step admin approval', async () => {
  const beforeAlerts = (await clients.Admin.get('/api/intake-alerts').expect(200)).body.count;
  const csv = 'Action,Notes,Priority,Due,Owner,Difficulty\nPublish release,Release checklist,High,2027-01-04,Alice,2\nClarify requirement,,Tejas,9-Sep,Unknown person,\n';
  const upload = await clients.Alice.post('/api/imports').field('department', 'Engineering').attach('file', Buffer.from(csv), 'schedule.csv').expect(201);
  assert.equal(upload.body.generated, 1);
  assert.equal(upload.body.needsReview, 1);
  const proposals = await Proposal.find({ batch: upload.body._id }).sort({ row: 1 });
  assert.equal(proposals.length, 2);
  assert.equal(proposals[0].status, 'approved');
  assert.ok(proposals[1].warnings.some(warning => warning.includes('Deadline')));
  assert.equal(await Task.countDocuments({ sourceProposal: { $in: proposals.map(proposal => proposal._id) } }), 1);
  assert.equal((await clients.Admin.get('/api/intake-alerts').expect(200)).body.count, beforeAlerts + 1);
  assert.equal((await clients.Bob.get('/api/intake-alerts').expect(200)).body.count, 0);
  await clients.Alice.post(`/api/proposals/${proposals[1]._id}/review`).send({ decision: 'approved' }).expect(403);
  await clients.Admin.post(`/api/proposals/${proposals[1]._id}/review`).send({ decision: 'approved' }).expect(400);
  const body = { decision: 'approved', __v: 0, acknowledge: true, draft: { title: 'Clarified requirement', description: 'Reviewed original row', priority: 'Medium', difficulty: 3, dueDate: '2027-09-09', owner: id(users[2]) } };
  const responses = await Promise.all([1, 2].map(() => clients.Admin.post(`/api/proposals/${proposals[1]._id}/review`).send(body)));
  assert.deepEqual(responses.map(response => response.status), [200, 200]);
  assert.equal(await Task.countDocuments({ sourceProposal: proposals[1]._id }), 1);
  assert.equal(id((await Task.findOne({ sourceProposal: proposals[1]._id })).owner), id(users[2]));
  assert.equal((await clients.Admin.get('/api/intake-alerts').expect(200)).body.count, beforeAlerts);
  assert.equal((await Batch.findById(upload.body._id)).status, 'mapped');
});

test('invalid imported task validation rolls back the entire approval transaction', async () => {
  const proposal = await Proposal.create({ organization: 'amethyst', department: 'Engineering', creator: users[2]._id, source: 'invalid-source.csv', draft: { title: 'Invalid task', priority: 'Medium', difficulty: 9 }, warnings: [] });
  await clients.Admin.post(`/api/proposals/${proposal._id}/review`).send({ decision: 'approved' }).expect(400);
  assert.equal((await Proposal.findById(proposal._id)).status, 'pending');
  assert.equal(await Task.countDocuments({ sourceProposal: proposal._id }), 0);
});

test('Cinema approval is ordered, supports reviewer handoff, and retains decision history', async () => {
  const created = await clients.Alice.post('/api/cinemas').send({ title: 'Project proposal', department: 'Engineering', rubric: 'Value: faster review. Scope: one team.', reviewers: [id(users[3]), id(users[2])] }).expect(201);
  const url = `/api/cinemas/${created.body._id}`;
  await clients.Alice.post(`${url}/sow`).attach('file', Buffer.from('Project scope'), 'scope.txt').expect(201);
  await clients.Alice.post(`${url}/submit`).send({}).expect(200);
  await clients.Alice.post(`${url}/decision`).send({ decision: 'approved', reason: 'Attempted out of order' }).expect(403);
  await clients.Bob.post(`${url}/decision`).send({ decision: 'handoff', reviewer: id(users[1]), reason: 'Department review needed' }).expect(200);
  await clients.Bob.post(`${url}/decision`).send({ decision: 'approved', reason: 'No longer reviewer' }).expect(403);
  const first = await clients['Department admin'].post(`${url}/decision`).send({ decision: 'approved', reason: 'Scope reviewed' }).expect(200);
  assert.equal(first.body.currentStep, 1);
  assert.equal(first.body.status, 'in_review');
  const final = await clients.Alice.post(`${url}/decision`).send({ decision: 'approved', reason: 'Delivery approved' }).expect(200);
  assert.equal(final.body.status, 'approved');
  assert.deepEqual(final.body.steps.map(step => step.status), ['approved', 'approved']);
  assert.deepEqual(final.body.history.map(entry => entry.event), ['submitted', 'handoff', 'approved', 'approved']);
  await clients.Alice.post(`${url}/sow`).attach('file', Buffer.from('Changed scope'), 'scope.txt').expect(409);
  await clients['Foreign admin'].get(`${url}/files`).expect(404);
});

test('Cinema revision preserves its earlier round and restarts ordered approval', async () => {
  const created = await clients.Alice.post('/api/cinemas').send({ title: 'Revise proposal', department: 'Engineering', rubric: 'Original rubric', reviewers: [id(users[3])] }).expect(201);
  const url = `/api/cinemas/${created.body._id}`;
  await clients.Alice.post(`${url}/submit`).send({}).expect(200);
  await clients.Bob.post(`${url}/decision`).send({ decision: 'changes_requested', reason: 'Add success criteria' }).expect(200);
  const revised = await clients.Alice.post(`${url}/submit`).send({ rubric: 'Updated rubric with success criteria' }).expect(200);
  assert.equal(revised.body.round, 2);
  assert.equal(revised.body.previousRounds[0].rubric, 'Original rubric');
  assert.equal(revised.body.currentStep, 0);
  assert.equal(revised.body.steps[0].status, 'pending');
  assert.equal((await Cinema.findById(created.body._id)).status, 'in_review');
});

test('calendar queries include events crossing week boundaries and reject invalid date ranges', async () => {
  const event = await clients.Alice.post('/api/events').send({ title: 'Long workshop', department: 'Engineering', startDate: '2027-01-03T12:00:00Z', endDate: '2027-01-05T12:00:00Z', timezone: 'America/Chicago' }).expect(201);
  await clients.Alice.post('/api/events').send({ title: 'Invalid event', department: 'Engineering', startDate: '2027-01-05T12:00:00Z', endDate: '2027-01-04T12:00:00Z' }).expect(400);
  const visible = await clients.Alice.get('/api/events?from=2027-01-04T00:00:00Z&to=2027-01-11T00:00:00Z').expect(200);
  assert.ok(visible.body.items.some(item => item._id === event.body._id));
  await clients.Alice.get('/api/events?from=invalid').expect(400);
  await clients.Alice.get('/api/events?from=2027-02-01&to=2027-01-01').expect(400);
  await clients.Alice.patch(`/api/events/${event.body._id}`).send({ __v: 0, title: 'Updated workshop' }).expect(200);
  await clients.Alice.delete(`/api/events/${event.body._id}`).expect(200);
  assert.equal((await Event.findById(event.body._id)).archived, true);
});

test('priority sorting happens before pagination, owner references are checked, and overview summarizes project tasks', async () => {
  const important = await clients.Admin.post('/api/projects').send({ title: 'Priority.1 project', department: 'Engineering', priority: 'Critical', owner: id(users[2]) }).expect(201);
  for (let i = 0; i < 4; i++) await clients.Admin.post('/api/projects').send({ title: `Newer low project ${i}`, department: 'Engineering', priority: 'Low' }).expect(201);
  const sorted = await clients.Alice.get('/api/projects?sort=priority&limit=2').expect(200);
  assert.equal(sorted.body.items[0]._id, important.body._id);
  assert.ok(sorted.body.pages >= 3);
  await clients.Admin.post('/api/projects').send({ title: 'Bad owner', department: 'Engineering', owner: id(users[4]) }).expect(400);
  await clients.Alice.post('/api/projects').send({ title: 'Member project', department: 'Engineering', owner: id(users[2]) }).expect(403);
  await createTask({ title: 'Done deliverable', project: important.body._id, status: 'done' });
  await createTask({ title: 'Open deliverable', project: important.body._id, status: 'blocked', blockedReason: 'Waiting' });
  const overview = await clients.Alice.get(`/api/overview?project=${important.body._id}`).expect(200);
  assert.equal(overview.body.projects[0].progress, 50);
  assert.equal(overview.body.projects[0].blocked, 1);
  assert.equal(overview.body.projects[0].title, 'Priority.1 project');
  assert.match(overview.body.weekly.text, /1 task still needs a deadline/);
  assert.ok(overview.body.weekly.actions.some(action => action.includes('holding it up')));
  assert.equal(overview.body.weekly.sources.length, 1);
  assert.equal((await clients.Alice.get('/api/tasks?q=Open%20deliverable').expect(200)).body.total, 1);
  assert.equal((await clients.Alice.get('/api/projects?q=Priority.1').expect(200)).body.total, 1);
  assert.equal((await clients.Alice.get('/api/projects?q=PriorityX1').expect(200)).body.total, 0);
});

test('transcript processing creates traceable proposals and never publishes tasks automatically', async () => {
  const created = await clients.Alice.post('/api/meetings').send({ title: 'Weekly meeting', department: 'Engineering', heldAt: '2027-01-04T15:00:00Z' }).expect(201);
  const beforeTasks = await Task.countDocuments();
  const transcript = 'Alice: We agreed to validate the release.\nBob: I will write the checklist.\nAlice: There is a risk with timing.';
  const result = await clients.Alice.post(`/api/meetings/${created.body._id}/transcript`).attach('file', Buffer.from(transcript), 'meeting.txt').expect(200);
  assert.match(result.body.summary, /Line 2: Bob: I will/);
  assert.match(result.body.generationMethod, /Extractive/);
  const suggestions = await Proposal.find({ meeting: created.body._id });
  assert.equal(suggestions.length, 1);
  assert.match(suggestions[0].source, /transcript line 2/);
  assert.ok(suggestions[0].warnings.length > 0);
  assert.equal(await Task.countDocuments(), beforeTasks);
});

test('cross-origin mutation requests are rejected', async () => {
  await clients.Alice.post('/api/tasks').set('Origin', 'https://untrusted.example').send({ title: 'Injected', department: 'Engineering' }).expect(403);
  await clients.Alice.post('/api/tasks').set('Sec-Fetch-Site', 'cross-site').send({ title: 'Injected', department: 'Engineering' }).expect(403);
});

test('legacy pending accounts can log in and read other departments without account activation', async () => {
  const user = await User.create({ organization: 'amethyst', name: 'Legacy reader', email: 'legacy-reader@example.test', department: 'Engineering', status: 'pending', passwordHash: hashPassword(password) });
  const task = await createTask({ title: 'Finance read access', department: 'Finance' });
  const client = request.agent(app);
  const result = await client.post('/api/auth/login').send({ email: user.email, password }).expect(200);
  assert.equal(result.body.status, 'active');
  assert.equal(result.body.role, 'member');
  assert.deepEqual(result.body.projectAdminIds, []);
  await client.get(`/api/tasks/${task._id}`).expect(200);
  await client.post(`/api/tasks/${task._id}/assign`).send({ owner: id(user) }).expect(403);
  assert.equal((await User.findById(user._id)).status, 'active');
});

test('project admin approval is scoped, cannot be self-granted, and revocation applies to an existing session', async () => {
  const project = await Project.create({ organization: 'amethyst', department: 'Engineering', creator: users[0]._id, title: 'Managed project' });
  const other = await Project.create({ organization: 'amethyst', department: 'Engineering', creator: users[0]._id, title: 'Other project' });
  const task = await createTask({ project: project._id });
  const otherTask = await createTask({ project: other._id });
  const unlinked = await createTask();
  const ownOther = await createTask({ project: other._id, creator: users[2]._id });
  const requestResult = await clients.Alice.post('/api/project-access').send({ project: id(project), reason: 'Lead delivery', user: id(users[3]), status: 'approved' }).expect(201);
  const accessId = requestResult.body._id;
  assert.equal(requestResult.body.user, id(users[2]));
  assert.equal(requestResult.body.status, 'pending');
  await clients.Alice.post('/api/project-access').send({ project: id(project) }).expect(409);
  await clients.Alice.post(`/api/project-access/${accessId}/review`).send({ __v: 0, decision: 'approved' }).expect(403);
  await clients.Bob.post('/api/project-access/grant').send({ project: id(project), user: id(users[2]) }).expect(403);
  await clients['Foreign admin'].post(`/api/project-access/${accessId}/review`).send({ __v: 0, decision: 'approved' }).expect(404);
  const approved = await clients['Department admin'].post(`/api/project-access/${accessId}/review`).send({ __v: 0, decision: 'approved' }).expect(200);
  const me = await clients.Alice.get('/api/auth/me').expect(200);
  assert.equal(me.body.role, 'member');
  assert.deepEqual(me.body.projectAdminIds, [id(project)]);
  assert.equal((await User.findById(users[2]._id)).role, 'member');
  await clients.Alice.post(`/api/tasks/${task._id}/assign`).send({ owner: id(users[3]) }).expect(200);
  const fresh = await Task.findById(task._id);
  await clients.Alice.patch(`/api/tasks/${task._id}`).send({ __v: fresh.__v, priority: 'Critical' }).expect(200);
  await clients.Alice.patch(`/api/projects/${project._id}`).send({ __v: 0, title: 'Managed by approved member' }).expect(200);
  await clients.Alice.post('/api/roadmap').send({ title: 'Delivery milestone', department: 'Engineering', project: id(project), startDate: '2027-01-01', dueDate: '2027-02-01' }).expect(201);
  await clients.Alice.post('/api/avp').send({ task: id(task) }).expect(201);
  await clients.Alice.post(`/api/tasks/${otherTask._id}/assign`).send({ owner: id(users[3]) }).expect(403);
  await clients.Alice.post(`/api/tasks/${unlinked._id}/assign`).send({ owner: id(users[3]) }).expect(403);
  await clients.Alice.delete(`/api/projects/${other._id}`).expect(403);
  await clients.Alice.post('/api/projects').send({ title: 'Unapproved new project', department: 'Engineering' }).expect(403);
  await clients.Alice.post('/api/project-access/grant').send({ project: id(project), user: id(users[3]) }).expect(403);
  const current = await Task.findById(task._id);
  await clients.Alice.patch(`/api/tasks/${task._id}`).send({ __v: current.__v, project: id(other) }).expect(403);
  await clients.Alice.patch(`/api/tasks/${task._id}`).send({ __v: current.__v, project: '' }).expect(403);
  await clients.Alice.patch(`/api/tasks/${ownOther._id}`).send({ __v: 0, project: id(project) }).expect(403);
  await clients.Alice.get(`/api/tasks/${otherTask._id}`).expect(200);
  await clients.Admin.post(`/api/project-access/${accessId}/review`).send({ __v: 0, decision: 'revoked' }).expect(409);
  await clients.Admin.post(`/api/project-access/${accessId}/review`).send({ __v: approved.body.__v, decision: 'revoked' }).expect(200);
  assert.deepEqual((await clients.Alice.get('/api/auth/me').expect(200)).body.projectAdminIds, []);
  await clients.Alice.post(`/api/tasks/${task._id}/assign`).send({ owner: id(users[2]) }).expect(403);
  await clients.Alice.get(`/api/tasks/${task._id}`).expect(200);
  const again = await clients.Alice.post('/api/project-access').send({ project: id(project), reason: 'New request' }).expect(201);
  await clients.Admin.post(`/api/project-access/${accessId}/review`).send({ __v: again.body.__v, decision: 'denied' }).expect(200);
  await clients.Alice.post(`/api/tasks/${task._id}/assign`).send({ owner: id(users[2]) }).expect(403);
});

test('project grants cover intake, transcript proposals and Cinema without expanding department access', async () => {
  const project = await Project.create({ organization: 'amethyst', department: 'Finance', creator: users[0]._id, title: 'Finance scoped project' });
  await clients['Department admin'].post('/api/project-access/grant').send({ project: id(project), user: id(users[2]) }).expect(403);
  const grant = await clients.Admin.post('/api/project-access/grant').send({ project: id(project), user: id(users[2]) }).expect(201);
  await clients.Admin.post('/api/project-access/grant').send({ project: id(project), user: id(users[4]) }).expect(400);
  const foreignProject = await Project.create({ organization: 'other-org', department: 'Finance', creator: users[4]._id, title: 'Foreign private project' });
  await clients.Alice.post('/api/project-access').send({ project: id(foreignProject) }).expect(404);
  const foreignAccess = await clients['Foreign admin'].get('/api/project-access').expect(200);
  assert.ok(!foreignAccess.body.some(item => item._id === grant.body._id));
  const csv = 'Action,Priority\nReview finance launch,High\n';
  const batch = await clients.Alice.post('/api/imports').field('project', id(project)).attach('file', Buffer.from(csv), 'project.csv').expect(201);
  const proposal = await Proposal.findOne({ batch: batch.body._id });
  assert.equal(id(proposal.project), id(project));
  const approved = await clients.Alice.post(`/api/proposals/${proposal._id}/review`).send({ decision: 'approved', __v: proposal.__v, acknowledge: true, draft: { title: proposal.draft.title, description: 'Reviewed import', priority: 'High', difficulty: 3 } }).expect(200);
  const task = await Task.findById(approved.body.task);
  assert.equal(id(task.project), id(project));
  const unrelated = await Proposal.create({ organization: 'amethyst', department: 'Finance', creator: users[0]._id, source: 'unlinked.csv', draft: { title: 'Not in project', priority: 'Medium', difficulty: 3 }, warnings: [] });
  await clients.Alice.post(`/api/proposals/${unrelated._id}/review`).send({ decision: 'approved' }).expect(403);
  await clients.Alice.patch(`/api/proposals/${unrelated._id}`).send({ __v: 0, acknowledge: true, draft: { title: 'Bypass', priority: 'Medium', difficulty: 3, project: id(project) } }).expect(403);
  const meeting = await clients.Admin.post('/api/meetings').send({ title: 'Finance meeting', department: 'Finance', project: id(project), heldAt: '2027-01-01T12:00:00Z' }).expect(201);
  await clients.Alice.post(`/api/meetings/${meeting.body._id}/transcript`).attach('file', Buffer.from('We will review the budget.'), 'finance.txt').expect(200);
  const suggestion = await Proposal.findOne({ meeting: meeting.body._id });
  assert.equal(id(suggestion.project), id(project));
  await clients.Alice.patch(`/api/proposals/${suggestion._id}`).send({ __v: 0, acknowledge: true, draft: { title: 'Review budget', priority: 'High', difficulty: 2 } }).expect(200);
  await clients.Alice.post(`/api/proposals/${suggestion._id}/review`).send({ decision: 'approved' }).expect(200);
  const cinema = await clients.Admin.post('/api/cinemas').send({ title: 'Scoped Cinema', department: 'Finance', task: id(task), rubric: 'Review scope', reviewers: [id(users[3])] }).expect(201);
  assert.equal(cinema.body.project, id(project));
  await clients.Alice.post(`/api/cinemas/${cinema.body._id}/sow`).attach('file', Buffer.from('Project SOW'), 'scope.txt').expect(201);
  await clients.Alice.post(`/api/cinemas/${cinema.body._id}/submit`).send({}).expect(200);
  await clients.Alice.post(`/api/cinemas/${cinema.body._id}/decision`).send({ decision: 'approved', reason: 'Project admin review' }).expect(200);
  await clients.Bob.get(`/api/cinemas/${cinema.body._id}/files`).expect(200);
  await clients.Alice.post('/api/tasks').send({ title: 'Wrong department', department: 'Engineering', project: id(project) }).expect(400);
  await clients.Admin.delete(`/api/projects/${project._id}`).expect(200);
  assert.ok(!(await clients.Alice.get('/api/auth/me').expect(200)).body.projectAdminIds.includes(id(project)));
  await clients.Alice.post(`/api/tasks/${task._id}/assign`).send({ owner: id(users[3]) }).expect(403);
});

test('screenshot data maps to linked components, disables directory logins, and reruns without duplicates', async () => {
  const { seedScreenshots } = await import('../src/seed-screenshots.js');
  const counts = await seedScreenshots('screenshot-test');
  assert.equal(counts.inserted.Task, 48);
  assert.equal(counts.inserted.Roadmap, 40);
  assert.equal(await mongoose.models.Roadmap.countDocuments({ organization: 'screenshot-test', kind: 'milestone' }), 5);
  assert.equal(counts.inserted.Cinema, 4);
  assert.equal(counts.inserted.Project, 8);
  assert.equal(counts.inserted.Avp, 8);
  assert.equal(counts.inserted.User, 28);
  const row = await mongoose.models.Roadmap.findOne({ organization: 'screenshot-test', phase: 'EP 3.0' });
  assert.ok(row.project);
  assert.equal((await Project.findById(row.project)).title, 'Expert Path 3.0 — Quality CX by customer need');
  const avpTask = await Task.findOne({ organization: 'screenshot-test', 'sourceReference.file': 'avpLook.png' });
  assert.equal(avpTask.dueDate, undefined);
  assert.ok(avpTask.sourceReference.submittedLabel);
  const duplicateNumbers = await Cinema.find({ organization: 'screenshot-test', 'sourceReference.number': '260416-4183' });
  assert.equal(duplicateNumbers.length, 2);
  assert.notEqual(duplicateNumbers[0].number, duplicateNumbers[1].number);
  assert.equal(duplicateNumbers[0].status, 'draft');
  assert.equal(duplicateNumbers[0].steps.length, 0);
  assert.equal(await mongoose.models.File.countDocuments({ organization: 'screenshot-test' }), 0);
  const directory = await User.findOne({ organization: 'screenshot-test', name: 'Rachel' });
  assert.equal(directory.loginEnabled, false);
  // Even a valid stored password must not turn a directory entry into a login.
  directory.passwordHash = hashPassword(password);
  await directory.save();
  await request(app).post('/api/auth/login').send({ email: directory.email, password }).expect(401);
  avpTask.title = 'User-edited source task';
  await avpTask.save();
  const repeat = await seedScreenshots('screenshot-test');
  assert.deepEqual(repeat.inserted, {});
  assert.equal((await Task.findById(avpTask._id)).title, 'User-edited source task');
  await clients.Alice.get(`/api/tasks/${avpTask._id}`).expect(404);
});

test('XLSX imports all worksheets, preserves empty-row positions, and routes missing data to scoped admins', async () => {
  const { default: ExcelJS } = await import('exceljs');
  const book = new ExcelJS.Workbook();
  const first = book.addWorksheet('Work');
  first.addRow(['Weekly plan']);
  first.addRow([]);
  first.addRow(['Task', 'Details', 'Priority', 'Deadline', 'Assigned to', 'Complexity']);
  first.addRow(['Workbook task', 'All fields supplied', 'Low', new Date('2027-06-01T00:00:00Z'), 'Alice', 2]);
  first.getCell('D4').numFmt = 'yyyy-mm-dd';
  const second = book.addWorksheet('Needs review');
  second.addRow(['Action', 'Notes', 'Priority', 'Due Date', 'Owner', 'Difficulty']);
  second.addRow(['Needs a deadline', 'Check schedule', 'Medium', '', 'Bob', 4]);
  const result = await clients.Admin.post('/api/imports').field('department', 'Engineering').attach('file', Buffer.from(await book.xlsx.writeBuffer()), 'multi.xlsx').expect(201);
  assert.equal(result.body.generated, 1);
  assert.equal(result.body.needsReview, 1);
  assert.equal(result.body.items.find(row => row.status === 'approved').row, 4);
  assert.ok(result.body.items.find(row => row.status === 'pending').warnings.includes('Missing deadline'));
  const empty = await clients.Admin.post('/api/imports').field('department', 'Engineering').attach('file', Buffer.from('Task,Priority\n'), 'empty.csv').expect(400);
  assert.match(empty.body.error, /No task rows/);
});

test('task sharing delivers a private notification without assigning ownership', async () => {
  const task = await createTask();
  const response = await clients.Alice.post(`/api/tasks/${task._id}/share`).send({recipient:id(users[3]), sender:id(users[0])}).expect(201);
  assert.equal(response.body.sender, id(users[2]));
  assert.equal((await Task.findById(task._id)).owner, undefined);
  const inbox = await clients.Bob.get('/api/notifications').expect(200);
  assert.ok(inbox.body.items.some(item => item._id === response.body._id));
  assert.ok(inbox.body.unread > 0);
  const senderInbox = await clients.Alice.get('/api/notifications').expect(200);
  assert.ok(!senderInbox.body.items.some(item => item._id === response.body._id));
  await clients.Alice.patch(`/api/notifications/${response.body._id}/read`).expect(404);
  await clients.Bob.patch(`/api/notifications/${response.body._id}/read`).expect(200);
  await clients.Alice.post(`/api/tasks/${task._id}/share`).send({recipient:id(users[4])}).expect(400);
  await clients['Foreign admin'].post(`/api/tasks/${task._id}/share`).send({recipient:id(users[4])}).expect(404);
  const directory = await User.create({name:'Share directory',email:'share-directory@example.test',passwordHash:hashPassword(password),organization:'amethyst',department:'Engineering',status:'active',loginEnabled:false});
  await clients.Alice.post(`/api/tasks/${task._id}/share`).send({recipient:id(directory)}).expect(400);
});

test('completion filtering and ordering apply before task pagination', async () => {
  const marker = 'Completion sorting fixture';
  const done = await createTask({ title: marker, status: 'done', priority: 'Critical' });
  const active = await createTask({ title: marker, status: 'todo', priority: 'Low' });
  const cancelled = await createTask({ title: marker, status: 'cancelled', priority: 'Medium' });
  const base = `/api/tasks?q=${encodeURIComponent(marker)}&sort=priority`;
  const first = await clients.Alice.get(`${base}&completion=all&limit=2`).expect(200);
  assert.deepEqual(first.body.items.map(id), [id(cancelled), id(active)]);
  const second = await clients.Alice.get(`${base}&completion=all&limit=2&page=2`).expect(200);
  assert.deepEqual(second.body.items.map(id), [id(done)]);
  const defaultList = await clients.Alice.get(base).expect(200);
  assert.equal(defaultList.body.total, 2);
  assert.ok(defaultList.body.items.every(task => task.status !== 'done'));
  const completed = await clients.Alice.get(`${base}&completion=completed`).expect(200);
  assert.deepEqual(completed.body.items.map(id), [id(done)]);
  const incomplete = await clients.Alice.get(`${base}&completion=non-completed`).expect(200);
  assert.equal(incomplete.body.total, 2);
  assert.ok(incomplete.body.items.every(task => task.status !== 'done'));
  await clients.Alice.get(`${base}&completion=invalid`).expect(400);
});

test('roadmap uploads create entries atomically and enforce admin scope', async () => {
  const { Roadmap } = await import('../src/models.js');
  const csv = 'Title,Start,Target,Phase,Type,Status\nImported launch,2027-01-01,2027-02-01,EP 2.0,workstream,Planned\nImported milestone,2027-02-01,2027-02-01,EP 2.0,milestone,Complete';
  await clients.Bob.post('/api/roadmap/import').field('department', 'Engineering').attach('file', Buffer.from(csv), 'roadmap.csv').expect(403);
  await clients['Department admin'].post('/api/roadmap/import').field('department', 'Sales').attach('file', Buffer.from(csv), 'roadmap.csv').expect(403);
  const response = await clients.Admin.post('/api/roadmap/import').field('department', 'Engineering').attach('file', Buffer.from(csv), 'roadmap.csv').expect(201);
  assert.equal(response.body.generated, 2);
  const rows = await Roadmap.find({ title: /^Imported / });
  assert.equal(rows.length, 2);
  assert.equal(rows.find(row => row.kind === 'milestone').status, 'Complete');
  const count = await Roadmap.countDocuments();
  const invalid = csv.replace('Imported milestone,2027-02-01,2027-02-01', 'Imported milestone,2027-02-01,2027-03-01');
  const failed = await clients.Admin.post('/api/roadmap/import').field('department', 'Engineering').attach('file', Buffer.from(invalid), 'roadmap.csv').expect(400);
  assert.match(failed.body.error, /row 3.*Milestone dates/);
  assert.equal(await Roadmap.countDocuments(), count);
  await clients.Admin.post('/api/roadmap/import').field('department', 'Engineering').attach('file', Buffer.from('Title\nMissing dates'), 'roadmap.csv').expect(400);
});

test('any workspace member can freeze and resume while other edits remain protected', async () => {
  const task = await createTask({ creator: users[2]._id, title: 'Freeze production', status: 'in_progress' });
  const path = `/api/tasks/${id(task)}`;
  await request(app).patch(path).send({ frozen: true, __v: task.__v }).expect(401);
  for (const extra of [{ title: 'Unauthorized edit' }, { status: 'done' }, { owner: id(users[3]) }, { department: 'Sales' }]) {
    await clients.Bob.patch(path).send({ frozen: true, __v: task.__v, ...extra }).expect(403);
  }
  await clients['Foreign admin'].patch(path).send({ frozen: true, __v: task.__v }).expect(404);
  await clients.Alice.patch(path).send({ frozen: 'yes', __v: task.__v }).expect(400);
  await clients.Bob.patch(path).send({ frozen: 'yes', __v: task.__v }).expect(400);
  const frozen = await clients.Bob.patch(path).send({ frozen: true, __v: task.__v }).expect(200);
  assert.equal(frozen.body.frozen, true);
  assert.equal(frozen.body.status, 'in_progress');
  assert.equal((await clients.Alice.get(path).expect(200)).body.frozen, true);
  await clients.Alice.patch(path).send({ frozen: false, __v: task.__v }).expect(409);
  const resumed = await clients.Bob.patch(path).send({ frozen: false, __v: frozen.body.__v }).expect(200);
  assert.equal(resumed.body.frozen, false);
  assert.equal(resumed.body.status, 'in_progress');
});

test('legacy tasks without a frozen field and newly created tasks can freeze and resume', async () => {
  const legacy = await createTask({ title: 'Legacy freeze coverage', creator: users[2]._id });
  await Task.collection.updateOne({ _id: legacy._id }, { $unset: { frozen: '' } });
  const created = await clients.Alice.post('/api/tasks').send({ title: 'New freeze coverage', department: 'Engineering' }).expect(201);
  for (const taskId of [id(legacy), created.body._id]) {
    const path = `/api/tasks/${taskId}`;
    const before = await clients.Alice.get(path).expect(200);
    const frozen = await clients.Alice.patch(path).send({ frozen: true, __v: before.body.__v }).expect(200);
    assert.equal((await clients.Alice.get(path)).body.frozen, true);
    const resumed = await clients.Bob.patch(path).send({ frozen: false, __v: frozen.body.__v }).expect(200);
    assert.equal(resumed.body.frozen, false);
  }
});
