import { useState } from 'react';
import { api } from '../lib/api';
import Modal from '../features/shared/Modal';

export default function RoadmapUpload({ user, projects, onSaved }) {
  const [open, setOpen] = useState(false);
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const allowedProjects = projects.filter(item => user.role === 'admin' && (user.department === '*' || user.department === item.department) || user.projectAdminIds?.includes(item._id));
  if (user.role !== 'admin' && !user.projectAdminIds?.length) return null;

  async function upload(event) {
    event.preventDefault();
    const body = new FormData(event.currentTarget);
    const file = body.get('file');
    if (file.size > 10 * 1024 * 1024) { setError('Choose a file smaller than 10 MB.'); return; }
    setBusy(true); setError('');
    try {
      const response = await api('/roadmap/import', { method: 'POST', body });
      setResult(response); setOpen(false); onSaved();
    } catch (error) { setError(error.message); } finally { setBusy(false); }
  }

  return <>
    <button className="primary" onClick={() => { setError(''); setOpen(true); }}>＋ Add roadmap from file</button>
    {result && <span role="status">{result.filename}: {result.generated} roadmap entries added.</span>}
    {open && <Modal title="Add roadmap from file" onClose={() => { if (!busy) setOpen(false); }}>
      <p>Upload an Excel (.xlsx) or CSV file with Title, Start and Target columns. Use dates such as 2027-01-31. Each row adds a workstream or milestone to the roadmap.</p>
      <p>Optional columns: Phase (EP 1.0, EP 2.0, EP 3.0), Type (workstream or milestone), Status (Planned, In Progress, Complete), Description and Owner. Milestones need matching Start and Target dates. Owner names are displayed as source labels.</p>
      <form className="record-form" onSubmit={upload}>
        <fieldset disabled={busy}>
          <label>Project<select name="project" value={project} required={user.role !== 'admin'} onChange={event => setProject(event.target.value)}><option value="">{user.role === 'admin' ? 'No linked project' : 'Select a project'}</option>{allowedProjects.map(item => <option key={item._id} value={item._id}>{item.title}</option>)}</select></label>
          <label>Department<input name="department" key={project} defaultValue={projects.find(item => item._id === project)?.department || (user.department === '*' ? 'General' : user.department)} required readOnly={!!project || user.department !== '*'}/></label>
          <label>Spreadsheet (up to 10 MB)<input type="file" name="file" accept=".xlsx,.csv" required/></label>
          <button className="primary" type="submit">{busy ? 'Generating roadmap…' : 'Generate roadmap'}</button>
        </fieldset>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>}
  </>;
}
