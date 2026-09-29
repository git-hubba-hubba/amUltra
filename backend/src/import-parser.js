const aliases = {
  title: ['title', 'task', 'task title', 'task name', 'action', 'action item', 'request', 'request description', 'workstream milestone'],
  description: ['description', 'task description', 'details', 'notes', 'comments'],
  priority: ['priority', 'priority level', 'tier'],
  difficulty: ['difficulty', 'difficulty level', 'complexity'],
  dueDate: ['due', 'due date', 'deadline', 'finish date', 'finish', 'target date', 'target end', 'end date'],
  owner: ['owner', 'assignee', 'assigned to', 'task owner', 'responsible', 'owner email'],
};
const key = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export const nonemptyRow = row => row.some(cell => String(cell ?? '').trim());
export function detectColumns(rows) {
  let best = null;
  for (let index = 0; index < Math.min(25, rows.length); index++) {
    const row = rows[index] || [];
    const mapping = {};
    const warnings = [];
    for (const [field, names] of Object.entries(aliases)) {
      const matches = row.flatMap((cell, column) => names.includes(key(cell)) ? [column] : []);
      mapping[field] = matches[0] ?? -1;
      if (matches.length > 1) warnings.push(`Multiple ${field} columns found; verify the source row`);
    }
    // Some exports use Description as their only task-title column.
    if (mapping.title < 0 && mapping.description >= 0 && key(row[mapping.description]) === 'description') {
      mapping.title = mapping.description;
      mapping.description = -1;
    }
    const count = Object.values(mapping).filter(column => column >= 0).length;
    const score = count + (mapping.title >= 0 ? 2 : 0);
    if (count && (!best || score > best.score)) best = { headerRow: index, mapping, warnings, score };
  }
  if (best) return best;
  return { headerRow: -1, mapping: Object.fromEntries(Object.keys(aliases).map(field => [field, -1])), warnings: ['Column headings could not be recognized; review the original row'] };
}
function deadline(value) {
  const text = String(value ?? '').trim();
  if (!text) return { warning: 'Missing deadline' };
  let year, month, day;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  const us = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (iso) [, year, month, day] = iso.map(Number);
  else if (us) [, month, day, year] = us.map(Number);
  else return { warning: 'Deadline must include a year and use YYYY-MM-DD or MM/DD/YYYY' };
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { warning: 'Invalid deadline' };
  if (text.includes('T')) {
    const time = new Date(text);
    if (!Number.isFinite(time.getTime())) return { warning: 'Invalid deadline' };
    return { value: time };
  }
  // Date-only spreadsheets mean the end of the specified UTC day.
  date.setUTCHours(23, 59, 59, 999);
  return { value: date };
}
export function normalizeRow(row, mapping, { members = [], canAssign = false, userId } = {}) {
  const read = field => String(row[mapping[field]] ?? '').trim();
  const warnings = [];
  const title = read('title'), description = read('description');
  if (!title) warnings.push('Missing task title');
  if (title.length > 500) warnings.push('Task title exceeds 500 characters');
  if (!description) warnings.push('Missing description or notes');
  if (description.length > 30000) warnings.push('Description exceeds 30,000 characters');
  const rawPriority = read('priority');
  const priority = ['Critical', 'High', 'Medium', 'Low'].find(value => value.toLowerCase() === rawPriority.toLowerCase());
  if (!priority) warnings.push(rawPriority ? `Unknown priority: ${rawPriority}` : 'Missing priority');
  const rawDifficulty = read('difficulty');
  const validDifficulty = rawDifficulty !== '' && Number.isInteger(Number(rawDifficulty)) && Number(rawDifficulty) >= 1 && Number(rawDifficulty) <= 5;
  if (!validDifficulty) warnings.push(rawDifficulty ? 'Difficulty must be 1–5' : 'Missing difficulty');
  const due = deadline(row[mapping.dueDate]);
  if (due.warning) warnings.push(due.warning);
  const rawOwner = read('owner');
  let owner;
  if (!rawOwner) warnings.push('Missing owner');
  else {
    const matches = members.filter(member => [member.name, member.email, String(member._id)].some(value => String(value).toLowerCase() === rawOwner.toLowerCase()));
    if (matches.length !== 1) warnings.push(`Resolve owner: ${rawOwner}`);
    else {
      owner = matches[0]._id;
      if (!canAssign && String(owner) !== String(userId)) warnings.push('Assigning this owner requires admin approval');
    }
  }
  return { draft: { title, description, priority: priority || 'Medium', difficulty: validDifficulty ? Number(rawDifficulty) : 3, dueDate: due.value, owner }, warnings };
}
