import mongoose from 'mongoose';
import { Task, Project } from './models.js';
import { requireValue, rankTasks } from './policy.js';
import { keywordFilter } from './queries.js';

export async function getOverview(req, res) {
  const taskFilter = { organization: req.user.organization, archived: false };
  const projectFilter = { ...taskFilter };
  for (const key of ['department', 'team']) {
    if (!req.query[key]) continue;
    requireValue(typeof req.query[key] === 'string', 'Invalid scope');
    taskFilter[key] = projectFilter[key] = req.query[key];
  }
  if (req.query.project) {
    requireValue(mongoose.isValidObjectId(req.query.project), 'Invalid project');
    taskFilter.project = req.query.project;
    projectFilter._id = req.query.project;
  }
  const keyword = keywordFilter(req.query.q);
  const [tasks, projects, projectTasks] = await Promise.all([
    Task.find({ ...taskFilter, ...keyword }).lean(),
    Project.find({ ...projectFilter, ...keyword }).lean(),
    Task.find(taskFilter).select('project status owner dueDate archived priority difficulty createdAt').lean(),
  ]);
  const now = Date.now();
  const ranked = rankTasks(tasks, now);
  const weekly = ranked.filter(t => !t.dueDate || new Date(t.dueDate).getTime() <= now + 7 * 86400000);
  const monthly = ranked.filter(t => !t.dueDate || new Date(t.dueDate).getTime() <= now + 30 * 86400000);
  const summaries = projects.map(project => {
    const related = projectTasks.filter(t => String(t.project) === String(project._id));
    const active = rankTasks(related, now);
    const completed = related.filter(t => t.status === 'done').length;
    return {
      ...project, taskCount: related.length, completed, active: active.length,
      overdue: active.filter(t => t.dueDate && new Date(t.dueDate).getTime() < now).length,
      blocked: active.filter(t => t.status === 'blocked').length,
      unowned: active.filter(t => !t.owner).length,
      progress: related.length ? Math.round(completed / related.length * 100) : 0,
    };
  });
  const statement = (list, days) => {
    const overdue = list.filter(t => t.dueDate && new Date(t.dueDate).getTime() < now).length;
    const upcoming = list.filter(t => t.dueDate && new Date(t.dueDate).getTime() >= now).length;
    const undated = list.filter(t => !t.dueDate).length;
    const blocked = list.filter(t => t.status === 'blocked').length;
    const unowned = list.filter(t => !t.owner).length;
    const urgent = list.filter(t => ['Critical', 'High'].includes(t.priority)).length;
    const count = (n, singular, plural = `${singular}s`) => `${n} ${n === 1 ? singular : plural}`;
    const actions = [];
    if (overdue) actions.push(`Start with ${count(overdue, 'task')} past the deadline. Confirm a new finish date with each owner.`);
    if (blocked) actions.push(`Help move ${count(blocked, 'task')} forward by resolving what is holding ${blocked === 1 ? 'it' : 'them'} up.`);
    if (unowned) actions.push(`Choose someone to handle ${count(unowned, 'task')} with no owner.`);
    if (undated) actions.push(`Set a deadline for ${count(undated, 'task')} with no date.`);
    if (urgent) actions.push(`Give extra attention to ${count(urgent, 'high-priority task')}.`);
    if (!actions.length && list.length) actions.push('Keep the tasks below moving toward their deadlines.');
    return {
      text: list.length
        ? `${count(upcoming, 'task')} due in the next ${days} days. ${overdue ? `${count(overdue, 'task')} already past the deadline. ` : ''}${undated ? `${count(undated, 'task')} still need${undated === 1 ? 's' : ''} a deadline.` : ''}`.trim()
        : `No unfinished tasks are due in the next ${days} days, overdue, or missing a deadline.`,
      actions,
      sources: list.slice(0, 8),
    };
  };
  res.json({
    generatedAt: new Date(now), method: 'Based on current tasks and projects',
    active: ranked.length,
    overdue: ranked.filter(t => t.dueDate && new Date(t.dueDate).getTime() < now).length,
    blocked: ranked.filter(t => t.status === 'blocked').length,
    unowned: ranked.filter(t => !t.owner).length,
    weekly: statement(weekly, 7),
    monthly: statement(monthly, 30),
    projects: summaries,
  });
}
