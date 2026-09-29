import { useState } from 'react';
import { api } from '../lib/api';

export default function TaskActionItem({ action, task, enabled, refresh }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function toggle(event) {
    setBusy(true);
    setError('');
    try {
      const updated = await api(`/tasks/${task._id}/actions/${action._id}`, { method: 'PATCH', body: { done: event.target.checked } });
      refresh(updated);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }
  return <div className={`action-item ${action.done ? 'action-done' : ''}`}><label className="check"><input type="checkbox" checked={action.done} disabled={!enabled || busy} onChange={toggle} /><span>{action.title}</span></label>{error && <p className="error" role="alert">{error}</p>}</div>;
}
