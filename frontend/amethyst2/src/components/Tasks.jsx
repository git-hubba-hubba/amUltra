import { useEffect, useRef, useState } from 'react';
import { ActionForm } from '../features/workspace/shared';
import { editable } from '../features/workspace/helpers';
import Modal from '../features/shared/Modal';
import { api } from '../lib/api';
import { createTripleClickCounter } from '../lib/tripleClick';
import TaskShare from './TaskShare';
import TaskCrystal from './TaskCrystal';
import TaskActionItem from './TaskActionItem';
import { countdown } from '../lib/countdown';

function Timer({ task }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 1000);
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  const remaining = countdown(task.dueDate, now);
  const deadline = remaining ? new Date(task.dueDate).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  }) : '';
  const closed = task.status === 'done' || task.status === 'cancelled';
  const pad = value => String(value).padStart(2, '0');
  return <div className={`timer ${!closed && remaining?.overdue ? 'overdue' : ''}`}>
    {closed ? <span>{task.status === 'done' ? 'Completed' : 'Cancelled'}</span> : remaining ? <>
      <small>{remaining.overdue ? 'Overdue by' : 'Time remaining'}</small>
      <span className="deadline-countdown">{remaining.days}d {pad(remaining.hours)}h {pad(remaining.minutes)}m {pad(remaining.seconds)}s</span>
    </> : <small>{task.dueDate ? 'Invalid deadline — update this task' : 'No deadline set'}</small>}
    {deadline && <small>Deadline <time dateTime={task.dueDate}>{deadline}</time></small>}
    {task.sourceReference?.dueLabel && <small>Source date: {task.sourceReference.dueLabel}</small>}
  </div>;
}
export default function Tasks({ record: initialRecord, user, open, refresh }) {
  const [updatedRecord, setUpdatedRecord] = useState(null);
  const clicks = useRef(createTripleClickCounter());
  const record = updatedRecord && updatedRecord.__v >= initialRecord.__v ? updatedRecord : initialRecord;
  const [flipped, setFlipped] = useState(false);
  const [dialog, setDialog] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function claim() {
    setBusy(true); setError('');
    try { await api(`/tasks/${record._id}/claim`, { method: 'POST' }); refresh(); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  const ownedByMe = (record.owner?._id || record.owner) === user._id;
  const canEdit = editable(user, record);
  async function toggleFrozen() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const updated = await api(`/tasks/${record._id}`, { method: 'PATCH', body: { frozen: !record.frozen, __v: record.__v } });
      setUpdatedRecord(updated);
      setMessage(updated.frozen ? 'Production on this task is frozen.' : 'Production on this task has resumed.');
      refresh();
    } catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  function tripleClick(event) {
    if (event.target.closest('button, a, input, textarea, select, label, form')) {
      clicks.current.reset();
      return;
    }
    if (clicks.current.click()) toggleFrozen();
  }
  return (
    <>
    <article onClick={tripleClick} data-task-id={record._id} title="Triple-click the card to freeze or resume production" className={`taskMajor ${flipped ? 'flipped' : ''} ${record.status === 'done' ? 'taskCompleted' : ''} ${record.frozen ? 'taskFrozen' : ''}`}>
      {record.frozen && <div className="taskFreezeControls"><span className="taskFrozenBadge">❄ Production frozen</span></div>}
      <div className="taskFlip">
        <div className="taskFace taskFront" inert={flipped}>
          <div className="taskHolder">
            <div className="taskBadge"><span>{record.department}{record.status === 'done' && ' · Completed'}</span><span>{record.priority} · Difficulty {record.difficulty}/5</span></div>
            <h2 className="taskTitle">{record.title}</h2>
            <hr />
            <p className="taskDesc">{record.description || 'Open this task to add details.'}</p>
            <button className="taskFlipButton" onClick={() => setFlipped(true)}>Action items ({record.actionItems?.length || 0}) ↻</button>
          </div>
          <div className="taskManager">
            <Timer task={record} />
            {ownedByMe && <small className="taskOwned" role="status">In your profile queue</small>}
            <div className="tmBtns">
              <div className="organizer">
                <button className="taskImageButton" aria-label="View task" title="View task" onClick={() => open(record)}><svg className="tm-smBtn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg></button>
                <button className="taskImageButton" aria-label="Take ownership" title={ownedByMe ? 'In your profile queue' : record.owner ? 'Already owned' : busy ? 'Adding to your profile…' : 'Take ownership'} disabled={busy || !!record.owner || ['done', 'cancelled'].includes(record.status)} onClick={claim}><svg className="tm-smBtn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><rect x="5" y="4" width="14" height="12" rx="2" /><path d="m5 16-3 4h20l-3-4M9 20h6" /></svg></button>
              </div>
              <div className="organizer">
                <button className="taskImageButton" aria-label="Share task" title="Send task notification" onClick={() => setDialog('share')}><svg className="tm-smBtn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6.7 10.7 10.6-5.4M6.7 13.3l10.6 5.4M20 7v10" /><circle cx="4" cy="12" r="3" /><circle cx="20" cy="4" r="3" /><circle cx="20" cy="20" r="3" /></svg></button>
                <button className="taskImageButton" aria-label="Comment on task" title="Comment" onClick={() => setDialog('comment')}><svg className="tm-smBtn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 3V11.5A8.5 8.5 0 0 1 9.5 3h3a8.5 8.5 0 0 1 8.5 8.5Z" /></svg></button>
              </div>
            </div>
          </div>
          {record.frozen && <TaskCrystal/>}
        </div>
        <div className="taskFace taskBack" inert={!flipped}>
          <div className="section-heading"><div><h2>Action items</h2><p className="action-task-title">{record.title}</p></div><button onClick={() => setFlipped(false)}>Back ↻</button></div>
          <div className="action-progress" role="status">{(record.actionItems || []).filter(action => action.done).length} of {record.actionItems?.length || 0} complete</div>
          <div className="action-list">{record.actionItems?.length ? record.actionItems.map(action => <TaskActionItem key={action._id} action={action} task={record} enabled={canEdit} refresh={setUpdatedRecord} />) : <p className="action-empty">No action items yet. Break this task into small, clear steps.</p>}</div>
          {canEdit ? <ActionForm path={`/tasks/${record._id}/actions`} onSaved={setUpdatedRecord} submitLabel="Add action item"><label>Next action<input name="title" placeholder="Describe the next step…" required maxLength={500} /></label></ActionForm> : <p className="action-empty">The task owner, creator, or project administrator can add and update action items.{!record.owner && !['done', 'cancelled'].includes(record.status) && <> <button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { setUpdatedRecord(await api(`/tasks/${record._id}/claim`, { method: 'POST' })); } catch (error) { setError(error.message); } finally { setBusy(false); } }}>Take ownership to add items</button></>}</p>}
          {record.frozen && <TaskCrystal/>}
        </div>
      </div>
    </article>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {dialog && <Modal title={`${dialog === 'share' ? 'Share task' : 'Comment on task'} · ${record.title}`} onClose={() => setDialog('')}>
      {dialog === 'share' ? <TaskShare record={record} user={user} onSaved={() => { setDialog(''); setMessage('Task notification sent.'); }} /> : <ActionForm path={`/tasks/${record._id}/comments`} submitLabel="Post comment" onSaved={() => { setDialog(''); refresh(); }}><label>Your comment<textarea name="body" required maxLength={10000} /></label></ActionForm>}
    </Modal>}
    </>
  );
}
