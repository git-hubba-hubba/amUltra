import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { app } from '../src/app.js';
import { createSiteAccess } from '../src/site-access.js';

const code = '214723';

test('site lock blocks all application APIs, including signup and login, until unlocked', async () => {
 for (const path of ['/api/tasks', '/api/auth/me', '/api/jade/status', '/api/members']) {
  assert.equal((await request(app).get(path).expect(423)).body.code, 'SITE_LOCKED');
 }
 for (const path of ['/api/auth/login', '/api/auth/signup', '/api/tasks']) await request(app).post(path).send({}).expect(423);
 const client = request.agent(app);
 assert.equal((await client.get('/api/site-access').expect(200)).body.unlocked, false);
 await client.post('/api/site-access/unlock').send({ code: '000000' }).expect(401);
 await client.get('/api/tasks').expect(423);
 const unlocked = await client.post('/api/site-access/unlock').send({ code }).expect(200);
 assert.match(unlocked.headers['set-cookie'][0], /HttpOnly/);
 assert.match(unlocked.headers['set-cookie'][0], /SameSite=Strict/);
 assert.equal((await client.get('/api/site-access').expect(200)).body.unlocked, true);
 // Site access does not grant an account session or admin permissions.
 await client.get('/api/tasks').expect(401);
 await request(app).get('/api/tasks').expect(423);
 await client.post('/api/site-access/lock').expect(200);
 await client.get('/api/tasks').expect(423);
});

test('tampered, expired and forged unlock cookies cannot bypass the lock', async () => {
 let time = Date.now();
 const site = createSiteAccess({ now: () => time });
 const isolated = express();
 isolated.use(express.json(), cookieParser());
 isolated.use('/access', site.router);
 isolated.get('/private', site.requireSiteAccess, (_req, res) => res.json({ ok: true }));
 const client = request.agent(isolated);
 const result = await client.post('/access/unlock').send({ code }).expect(200);
 const cookie = result.headers['set-cookie'][0].split(';')[0];
 await client.get('/private').expect(200);
 await request(isolated).get('/private').set('Cookie', `${cookie}a`).expect(423);
 await request(isolated).get('/private').set('Cookie', `amethyst_site_access=${time + 10000}.${'0'.repeat(64)}`).expect(423);
 time += 12 * 60 * 60 * 1000 + 1;
 await client.get('/private').expect(423);
 assert.equal((await client.get('/access').expect(200)).body.unlocked, false);
});

test('repeated incorrect codes are rate limited and cross-origin unlocks are rejected', async () => {
 const isolated = express();
 isolated.use(express.json(), cookieParser());
 isolated.use('/access', createSiteAccess().router);
 for (let i = 0; i < 5; i++) await request(isolated).post('/access/unlock').send({ code: 'wrong' }).expect(401);
 await request(isolated).post('/access/unlock').send({ code }).expect(429);
 await request(app).post('/api/site-access/unlock').set('Origin', 'https://untrusted.example').send({ code }).expect(403);
});
