import { HttpError } from '../policy.js';
const string = { type: 'string' };
const strings = { type: 'array', items: string };
export const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const factSchema = object({ statement: string, sourceId: string, locator: string, evidence: string });
const timelineSignal = object({ sourceId: string, locator: string, evidence: string });
const base = { summary: string, facts: { type: 'array', items: factSchema }, limitations: strings, criticalQuestions: strings, timelineSignals: { type: 'array', items: timelineSignal } };
export const workerSchema = object(base);
export const verificationSchema = object({ ...base, checks: { type: 'array', items: object({
  recordId: string, status: { type: 'string', enum: ['verified', 'failed'] }, findings: string,
}) } });
export const itemSchema = object({ kind: { type: 'string', enum: ['action_item', 'notification'] }, title: string,
  description: string, priority: { type: 'string', enum: ['Critical', 'High', 'Medium', 'Low'] },
  businessNeed: string, urgency: string, sourceIds: strings, timelineSignals: { type: 'array', items: timelineSignal },
});
export const assistantSchema = object({ ...base, items: { type: 'array', items: itemSchema } });
export const assignmentSchema = object({ itemIndex: { type: 'integer' },
  targetType: { type: 'string', enum: ['worker', 'user'] },
  workerRole: { type: 'string', enum: ['', 'files', 'metrics', 'projects', 'meetings'] },
  userId: string, rationale: string,
});
export const managerSchema = object({ ...base, decision: { type: 'string', enum: ['approve', 'revise'] }, feedback: string, designatedWorker: { type: 'string', enum: ['', 'files', 'metrics', 'projects', 'meetings'] }, assignments: { type: 'array', items: assignmentSchema } });
export const boardSchema = object({ ...base, recommendations: strings });
export const presentationSchema = object({ ...base, title: string,
  sections: { type: 'array', items: object({ title: string, narrative: string, sourceIds: strings }) },
});
export function validateSourceReferences(data, sources) {
  const allowed = new Set(sources.map(source => source.sourceId));
  for (const fact of [...data.facts, ...(data.timelineSignals || []), ...(data.items || []).flatMap(item => item.timelineSignals || [])]) {
    if (!allowed.has(fact.sourceId) || !fact.evidence.trim() || !fact.locator.trim()) throw new HttpError(422, 'Agent produced an invalid source citation.');
    const source = sources.find(entry => entry.sourceId === fact.sourceId);
    if (source.text && !source.text.replace(/\s+/g, ' ').includes(fact.evidence.replace(/\s+/g, ' '))) throw new HttpError(422, 'Agent evidence was not found in the cited text source.');
  }
  for (const entry of [...(data.items || []), ...(data.sections || [])]) {
    if (!entry.sourceIds.length || entry.sourceIds.some(id => !allowed.has(id))) throw new HttpError(422, 'Agent output has missing or invalid source references.');
  }
  for (const item of data.items || []) {
    if (!item.title.trim() || !item.description.trim()) throw new HttpError(422, 'Assistant produced an empty item.');
    if (item.priority === 'Critical' && (!item.businessNeed.trim() || !item.urgency.trim())) throw new HttpError(422, 'Critical items require both business need and urgency.');
  }
}
