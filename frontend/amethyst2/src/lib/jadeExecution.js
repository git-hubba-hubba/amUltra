export function agentState(role, run, records) {
  if (!run) return 'idle';
  if (run.status === 'running' && run.currentAgent === role) return 'running';
  if (run.currentAgent === role && ['needs_context', 'needs_review', 'failed', 'denied'].includes(run.status)) return run.status === 'failed' ? 'failed' : 'review';
  return records.some(record => record.role === role && record.revision === run.revision) ? 'completed' : 'idle';
}
