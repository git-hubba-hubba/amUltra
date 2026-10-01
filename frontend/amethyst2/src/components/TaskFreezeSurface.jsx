import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { createTripleClickCounter } from '../lib/tripleClick';
import TaskCrystal from './TaskCrystal';

// Resolve the current record at interaction time, including legacy and newly imported tasks.
export default function TaskFreezeSurface({ id, frozen, onChanged, children }) {
  const clicks = useRef(createTripleClickCounter());
  const pending = useRef(false);
  const [updated, setUpdated] = useState(null);
  const [error, setError] = useState('');
  const isFrozen = updated ?? frozen ?? false;
  useEffect(() => {
    const controller = new AbortController();
    api(`/tasks/${id}`, { signal: controller.signal })
      .then(record => { if (!controller.signal.aborted) setUpdated(record.frozen ?? false); })
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [id, frozen]);
  async function tripleClick(event) {
    if (event.target.closest('button, a, input, textarea, select, label, form')) {
      clicks.current.reset(); return;
    }
    if (!clicks.current.click()) return;
    if (pending.current) return;
    pending.current = true; setError('');
    try {
      const record = await api(`/tasks/${id}`);
      const result = await api(`/tasks/${id}`, { method: 'PATCH', body: { frozen: !record.frozen, __v: record.__v } });
      setUpdated(result.frozen); onChanged?.(result);
    } catch (error) { setError(error.message); }
    finally { pending.current = false; }
  }
  return <section className={`task-freeze-surface ${isFrozen ? 'is-frozen' : ''}`} onClick={tripleClick} title="Triple-click to freeze or resume production" data-task-id={id}>
    {children}
    {isFrozen && <><TaskCrystal/><span className="taskFrozenBadge">❄ Production frozen</span></>}
    {error && <p role="alert" className="error">{error}</p>}
  </section>;
}
