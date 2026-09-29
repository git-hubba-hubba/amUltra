import mongoose from 'mongoose';
import { requireValue } from './policy.js';

export function keywordFilter(value) {
  if (!value) return {};
  requireValue(typeof value === 'string' && value.length <= 200, 'Search must be at most 200 characters');
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return { $or: [{ title: { $regex: escaped, $options: 'i' } }, { description: { $regex: escaped, $options: 'i' } }] };
}

export function listFilter(req, kind) {
  const filter = { organization: req.user.organization, archived: false, ...keywordFilter(req.query.q) };
  for (const key of ['department', 'priority', 'difficulty', 'project', 'team', 'status']) {
    if (!req.query[key]) continue;
    requireValue(typeof req.query[key] === 'string', 'Invalid filter');
    let value = req.query[key];
    if (key === 'project') {
      requireValue(mongoose.isValidObjectId(value), 'Invalid project');
      value = new mongoose.Types.ObjectId(value);
    }
    if (key === 'difficulty') {
      value = Number(value);
      requireValue(Number.isInteger(value) && value >= 1 && value <= 5, 'Invalid difficulty');
    }
    filter[key] = value;
  }
  if (kind === 'tasks') {
    const completion = req.query.completion || 'non-completed';
    requireValue(['all', 'completed', 'non-completed'].includes(completion), 'Invalid completion filter');
    const completionStatus = completion === 'completed' ? { status: 'done' } : { status: { $ne: 'done' } };
    if (completion !== 'all') filter.$and = [completionStatus];
  }
  const dates = {};
  for (const key of ['from', 'to']) {
    if (!req.query[key]) continue;
    requireValue(typeof req.query[key] === 'string' && Number.isFinite(Date.parse(req.query[key])), `Invalid ${key} date`);
    dates[key] = new Date(req.query[key]);
  }
  requireValue(!dates.from || !dates.to || dates.from <= dates.to, 'Date range is reversed');
  if (kind === 'events') {
    // Include events spanning the visible week, not just events starting in it.
    if (dates.from) filter.endDate = { $gt: dates.from };
    if (dates.to) filter.startDate = { $lt: dates.to };
  } else if (dates.from || dates.to) {
    filter[kind === 'meetings' ? 'heldAt' : 'dueDate'] = {
      ...(dates.from ? { $gte: dates.from } : {}),
      ...(dates.to ? { $lte: dates.to } : {}),
    };
  }
  return filter;
}

export async function listRecords(req, Model, kind) {
  const filter = listFilter(req, kind);
  const page = Math.max(1, Math.min(10000, Math.floor(Number(req.query.page) || 1)));
  const limit = Math.max(1, Math.min(200, Math.floor(Number(req.query.limit) || 50)));
  const dateKey = kind === 'events' ? 'startDate' : kind === 'meetings' ? 'heldAt' : 'dueDate';
  const sort = req.query.sort === 'priority'
    ? { _priorityOrder: 1, _missingDate: 1, [dateKey]: 1, _id: 1 }
    : req.query.sort === 'date' ? { _missingDate: 1, [dateKey]: 1, _id: 1 } : { createdAt: -1, _id: -1 };
  const [result] = await Model.aggregate([
    { $match: filter },
    { $facet: {
      items: [
        { $addFields: {
          ...(kind === 'tasks' ? { _completedOrder: { $cond: [{ $eq: ['$status', 'done'] }, 1, 0] } } : {}),
          _priorityOrder: { $indexOfArray: [['Critical', 'High', 'Medium', 'Low'], '$priority'] },
          _missingDate: { $cond: [{ $ifNull: [`$${dateKey}`, false] }, 0, 1] },
        } },
        { $sort: kind === 'tasks' ? { _completedOrder: 1, ...sort } : sort }, { $skip: (page - 1) * limit }, { $limit: limit },
        { $unset: ['_priorityOrder', '_missingDate', '_completedOrder'] },
      ],
      counts: [{ $count: 'total' }],
    } },
  ]);
  const total = result.counts[0]?.total || 0;
  return { items: result.items, total, page, pages: Math.ceil(total / limit) };
}
