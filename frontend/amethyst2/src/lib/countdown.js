export function countdown(deadline, now = Date.now()) {
  if (!deadline) return null;
  const target = new Date(deadline).getTime();
  if (!Number.isFinite(target)) return null;
  const remaining = target - now;
  const overdue = remaining < 0;
  const seconds = overdue ? Math.floor(-remaining / 1000) : Math.ceil(remaining / 1000);
  return {
    overdue,
    days: Math.floor(seconds / 86400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  };
}
