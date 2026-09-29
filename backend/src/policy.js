export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
export const requireValue = (condition, message, status = 400) => { if (!condition) throw new HttpError(status, message); };
export function isAdmin(user, department, project) {
 const workspaceAdmin = user.role === 'admin' && (user.department === '*' || !department || user.department === department);
 return workspaceAdmin || !!project && (user.projectAdminIds || []).some(id => String(id) === String(project));
}
export const recordProject = (item, kind) => kind === 'projects' || item.constructor?.modelName === 'Project' ? item._id : item.project;
export function canEdit(user, item, kind) {
 return isAdmin(user, item.department, recordProject(item, kind)) || String(item.creator) === String(user._id) || String(item.owner) === String(user._id);
}
export function rankTasks(tasks, now = Date.now()) {
 const priorities = { Critical: 0, High: 1, Medium: 2, Low: 3 };
 const due = t => t.dueDate ? new Date(t.dueDate).getTime() : Infinity;
 return tasks.filter(t => !['done', 'cancelled'].includes(t.status) && !t.archived).sort((a,b) => Number(due(b)<now)-Number(due(a)<now) || priorities[a.priority]-priorities[b.priority] || due(a)-due(b) || b.difficulty-a.difficulty || new Date(a.createdAt)-new Date(b.createdAt) || String(a._id).localeCompare(String(b._id)));
}
export function validateDates(data, kind) {
 for (const key of ['startDate','dueDate','endDate','heldAt']) if (data[key]) requireValue(Number.isFinite(new Date(data[key]).getTime()), `Invalid ${key}`);
 if (data.startDate && data.dueDate) requireValue(new Date(data.dueDate) >= new Date(data.startDate), 'Target date must follow start date');
 if (kind === 'events') { requireValue(data.startDate && data.endDate, 'Start and end are required'); requireValue(new Date(data.endDate) > new Date(data.startDate), 'End must follow start'); try { new Intl.DateTimeFormat('en', { timeZone: data.timezone || 'America/Chicago' }); } catch { throw new HttpError(400, 'Invalid timezone'); } }
 if (kind === 'roadmap') { requireValue(data.startDate && data.dueDate, 'Roadmap dates required'); if(data.kind==='milestone') requireValue(new Date(data.startDate).getTime()===new Date(data.dueDate).getTime(), 'Milestone dates must match'); }
 if (kind === 'tasks') { requireValue(['todo','in_progress','blocked','in_review','done','cancelled'].includes(data.status), 'Invalid task status'); if(data.status==='blocked') requireValue(data.blockedReason?.trim(), 'A blocked reason is required'); }
}
