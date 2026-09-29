import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectColumns, normalizeRow } from '../src/import-parser.js';
const members = [{ _id: 'alice', name: 'Alice', email: 'alice@example.test' }];
const rows = [['Program notes'], [], ['Action', 'Notes', 'Priority', 'Due Date', 'Owner', 'Difficulty'], ['Deliver release', 'Checklist', 'High', '2027-02-28', 'Alice', 3]];
test('detects spreadsheet headings after titles and blank rows', () => {
 const detection = detectColumns(rows);
 assert.equal(detection.headerRow, 2);
 assert.equal(normalizeRow(rows[3], detection.mapping, { members, userId: 'alice' }).warnings.length, 0);
});
test('missing fields, impossible dates, unknown headers and duplicates stay flagged', () => {
 const mapping = detectColumns(rows).mapping;
 const missing = normalizeRow(['Task'], mapping);
 for (const field of ['deadline', 'owner', 'difficulty', 'priority', 'description']) assert.ok(missing.warnings.some(w => w.toLowerCase().includes(field)));
 assert.ok(normalizeRow(['Task', 'Notes', 'Low', '2027-02-30', 'Alice', 2], mapping, { members, userId: 'alice' }).warnings.includes('Invalid deadline'));
 assert.equal(detectColumns([['arbitrary row']]).headerRow, -1);
 assert.ok(detectColumns([['Action', 'Due', 'Deadline']]).warnings.length > 0);
});
test('resolved imported owners still require assignment permission', () => {
 const mapping = detectColumns(rows).mapping;
 assert.ok(normalizeRow(rows[3], mapping, { members, userId: 'bob' }).warnings.some(w => w.includes('admin approval')));
 assert.equal(normalizeRow(rows[3], mapping, { members, canAssign: true }).warnings.length, 0);
});
