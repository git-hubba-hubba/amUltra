import { useState } from 'react';
import TaskFreezeSurface from './TaskFreezeSurface';
import { api } from '../lib/api';
import { useResource } from '../lib/useResource';
import Feedback from '../features/shared/Feedback';
import { admin, date, priorities } from '../features/workspace/helpers';

function GeneratedTask({ item, user, members, refresh }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function review(decision, form) {
    setBusy(true); setError('');
    try {
      const values = form ? Object.fromEntries(new FormData(form)) : null;
      await api(`/proposals/${item._id}/review`, { method: 'POST', body: {
        decision, __v: item.__v, ...(values ? { acknowledge: true, draft: { ...values, difficulty: Number(values.difficulty) } } : {}),
      } });
      refresh();
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <article className="panel generated-task">
    <div className="section-heading"><h3>{item.draft.title || `Row ${item.row || ''}: task details needed`}</h3><span className="badge">{item.status === 'approved' ? 'Task created' : item.status === 'denied' ? 'Dismissed' : 'Needs admin review'}</span></div>
    <p>{item.draft.description}</p>
    <small>{item.source} · {item.department} · {date(item.draft.dueDate)}</small>
    {item.status === 'pending' && <><ul>{item.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      {admin(user, item) ? <details><summary>Correct and approve</summary>
        <form className="record-form" onSubmit={event => { event.preventDefault(); review('approved', event.currentTarget); }}>
          <label>Task title<input name="title" defaultValue={item.draft.title} required maxLength={500}/></label>
          <label>Description<textarea name="description" defaultValue={item.draft.description} maxLength={30000}/></label>
          <div className="toolbar"><label>Deadline<input name="dueDate" type="date" defaultValue={item.draft.dueDate?.slice(0, 10)}/></label>
            <label>Priority<select name="priority" defaultValue={item.draft.priority}>{priorities.map(value => <option key={value}>{value}</option>)}</select></label>
            <label>Difficulty<input name="difficulty" type="number" min="1" max="5" required defaultValue={item.draft.difficulty}/></label></div>
          <label>Owner<select name="owner" defaultValue={item.draft.owner || ''}><option value="">Unassigned</option>{members.map(member => <option key={member._id} value={member._id}>{member.name}</option>)}</select></label>
          <label className="check"><input type="checkbox" required/>I reviewed these details, including any intentionally blank fields.</label>
          <div className="button-row"><button disabled={busy}>Approve and create task</button><button type="button" disabled={busy} onClick={() => review('denied')}>Dismiss row</button></div>
        </form>
        <details><summary>Original spreadsheet row</summary><pre>{JSON.stringify(item.original, null, 2)}</pre></details>
      </details> : <p>The responsible admin has been notified in the app.</p>}
    </>}
    {item.task && <TaskFreezeSurface id={item.task}><strong>{item.draft.title}</strong><p>Triple-click to freeze or resume production.</p><a href={`/?task=${item.task}`}>Open task</a></TaskFreezeSurface>}
    {error && <p className="error" role="alert">{error}</p>}
  </article>;
}
export default function FileUploader({ user, members, projects, q = '', onIntakeChanged }) {
  const [batch, setBatch] = useState(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [project, setProject] = useState('');
  const proposals = useResource(batch ? `/proposals?batch=${batch._id}` : '/proposals?status=pending');
  const rows = (proposals.data || []).filter(item => `${item.draft.title} ${item.source}`.toLowerCase().includes(q.toLowerCase()));
  function refresh() { proposals.refresh(); onIntakeChanged?.(); }
  async function upload(event) {
    event.preventDefault(); setBusy(true); setError('');
    const form = event.currentTarget;
    try {
      const result = await api('/imports', { method: 'POST', body: new FormData(form) });
      setBatch(result); onIntakeChanged?.();
      form.elements.file.value = '';
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }
  return <>
    <section className="panel"><h2>Upload → generated tasks</h2><p>Choose an Excel or CSV file. We recognize its columns and create complete tasks automatically. Missing or unclear information goes to the responsible admin.</p>
      <form className="record-form" onSubmit={upload}>
        <label>Project<select name="project" value={project} onChange={event => setProject(event.target.value)}><option value="">No linked project</option>{projects.map(item => <option key={item._id} value={item._id}>{item.title}</option>)}</select></label>
        <label>Department<input name="department" key={project} defaultValue={projects.find(item => item._id === project)?.department || (user.department === '*' ? 'General' : user.department)} required readOnly={!!project}/></label>
        <label>Spreadsheet<input name="file" type="file" accept=".xlsx,.csv" required/></label>
        <button disabled={busy}>{busy ? 'Generating tasks…' : 'Upload and generate tasks'}</button>
      </form>{error && <p className="error" role="alert">{error}</p>}
    </section>
    {batch && <p role="status">{batch.filename}: {proposals.data ? proposals.data.filter(item => item.status === 'approved').length : batch.generated} tasks created · {proposals.data ? proposals.data.filter(item => item.status === 'pending').length : batch.needsReview} need admin review.</p>}
    <div className="section-heading"><h2>{batch ? 'Generated tasks' : 'Tasks needing attention'}</h2>{batch && <button onClick={() => setBatch(null)}>Show all pending tasks</button>}</div>
    <Feedback loading={proposals.loading} error={proposals.error}/>
    {!proposals.loading && !proposals.error && !rows.length && <p>No tasks need attention. Upload a file to get started.</p>}
    {rows.map(item => <GeneratedTask key={`${item._id}:${item.__v}`} item={item} user={user} members={members} refresh={refresh}/>)}
  </>;
}
