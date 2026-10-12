import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import Feedback from '../features/shared/Feedback';
import JadeEcosystem from '../components/JadeEcosystem';

const sections = ['Approvals', 'Ecosystem', 'Workers & Verification', 'Board & Directives'];
const labels = { queued: 'Queued', running: 'Processing', needs_context: 'Needs critical context', needs_review: 'Needs human review', awaiting_approval: 'Awaiting admin approval', completed: 'Completed', failed: 'Failed', denied: 'Denied' };
const workerRoles = ['files', 'metrics', 'projects', 'meetings', 'context_check_1', 'context_check_2', 'admin_context_check'];
function useJade(path) {
  const [result, setResult] = useState({ path: null, data: null, error: '' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    let busy = false;
    const fetchData = async () => {
      if (busy) return;
      busy = true;
      try {
        const data = await api(path, { signal: controller.signal });
        if (!controller.signal.aborted) setResult({ path, data, error: '' });
      } catch (error) {
        if (error.code === 'JADE_LOCKED') window.dispatchEvent(new Event('jade-locked'));
        if (!controller.signal.aborted) setResult(previous => ({ path, data: previous.path === path ? previous.data : null, error: error.message }));
      } finally { busy = false; }
    };
    void fetchData();
    const timer = setInterval(fetchData, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [path, revision]);
  return { data: result.path === path ? result.data : null, error: result.path === path ? result.error : '', refresh: () => setRevision(value => value + 1), update: data => setResult({ path, data, error: '' }) };
}

export default function Jade(props) {
  const access = useJade('/jade/access');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [locking, setLocking] = useState(false);
  const updateAccess = access.update;
  useEffect(() => {
    const handleLocked = () => updateAccess({ unlocked: false });
    window.addEventListener('jade-locked', handleLocked);
    return () => window.removeEventListener('jade-locked', handleLocked);
  }, [updateAccess]);
  async function unlock(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const data = await api('/jade/unlock', { method: 'POST', body: { password } }); setPassword(''); access.update(data); access.refresh(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function lock() {
    setLocking(true); setError('');
    try { access.update(await api('/jade/lock', { method: 'POST' })); access.refresh(); }
    catch (failure) { setError(failure.message); } finally { setLocking(false); }
  }
  if (!access.data?.unlocked) return <section className="jade-lock-screen"><div className="panel jade-lock-card">
    <svg className="jade-lock-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" stroke="currentColor" strokeWidth="1.5" /></svg>
    <span className="eyebrow">JADE ECOSYSTEM</span><h1>Jade is locked.</h1><p>Enter the access password to continue.</p>
    <form className="record-form" onSubmit={unlock}><label>Jade password<input type="password" autoComplete="current-password" required maxLength={200} value={password} onChange={event => setPassword(event.target.value)} /></label><button className="primary" disabled={busy}>{busy ? 'Unlocking…' : 'Unlock Jade'}</button></form>
    <Feedback error={error || access.error} />
  </div></section>;
  return <><div className="jade-lock-controls"><Feedback error={error} /><button disabled={locking} onClick={lock}>{locking ? 'Locking…' : 'Lock Jade'}</button></div><JadeWorkspace {...props} /></>;
}

function JadeWorkspace({ user, projects = [], members = [], q = '' }) {
  const [section, setSection] = useState('Ecosystem');
  const [selected, setSelected] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [page, setPage] = useState(1);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const status = useJade('/jade/status');
  const runs = useJade(`/jade/runs?page=${page}`);
  const selectedId = selected || runs.data?.items?.[0]?._id;
  const detail = useJade(selectedId ? `/jade/runs/${selectedId}` : null);
  const [live, setLive] = useState(null);
  const [connection, setConnection] = useState({ id: null, connected: false });
  useEffect(() => {
    if (!selectedId) return;
    const events = new EventSource(`/api/jade/runs/${selectedId}/events`);
    events.addEventListener('run', event => {
      const next = JSON.parse(event.data);
      setLive(previous => previous?._id === next._id && new Date(previous.updatedAt) > new Date(next.updatedAt) ? previous : next);
      setConnection({ id: selectedId, connected: true });
      detail.refresh();
    });
    events.addEventListener('locked', () => window.dispatchEvent(new Event('jade-locked')));
    events.onerror = () => setConnection({ id: selectedId, connected: false });
    events.addEventListener('unavailable', () => setConnection({ id: selectedId, connected: false }));
    return () => events.close();
    // The refresh setter is stable; subscription lifetime follows the analysis.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);
  const connected = connection.id === selectedId && connection.connected;
  const run = live?._id === selectedId && (!detail.data?.run || new Date(live.updatedAt) >= new Date(detail.data.run.updatedAt)) ? live : detail.data?.run;
  const records = detail.data?.records || [];
  const assistantItems = records.find(record => record.stage === 'assistant')?.data.items || [];
  const canManage = user.role === 'admin' && (!run || user.department === '*' || user.department === run.department);
  const userName = id => members.find(member => member._id === id)?.name || 'Assigned user';
  const nameOf = role => status.data?.agents.find(agent => agent.role === role)?.name || role;
  const matches = text => text.toLowerCase().includes(q.toLowerCase());
  const filteredRuns = (runs.data?.items || []).filter(item => matches(`${item.title} ${item.goal} ${item.department}`));
  const refresh = () => { runs.refresh(); detail.refresh(); status.refresh(); };
  return <div className="jade-workspace">
    <header className="jade-hero">
      <span className="eyebrow">JADE ECOSYSTEM</span>
      <h1>From context to clarity.</h1>
      <p>AT&T Call Center, Sales, and FirstNet. Source-backed analysis, delegated work, and executive presentations.</p>
      <div className="jade-hero-actions"><span className="jade-availability"><span aria-hidden="true" />{status.data ? `${status.data.model} · ${status.data.configured ? 'Provider configured' : 'API key required'}` : 'Checking runtime…'}</span>
        {user.role === 'admin' && <button className="primary" onClick={() => setShowUpload(value => !value)} aria-expanded={showUpload}>{showUpload ? 'Close upload' : 'New analysis'}</button>}</div>
    </header>
    <Feedback error={status.error || runs.error} />
    {status.data && !status.data.configured && <p className="jade-config-note" role="status">Set ANTHROPIC_API_KEY in the backend environment and restart the API to enable analysis. Credentials stay on the server.</p>}
    {showUpload && <UploadForm user={user} projects={projects} status={status.data} onCreated={id => { setSelected(id); setShowUpload(false); refresh(); }} />}
    <nav className="jade-sections" aria-label="Jade sections">{sections.map(name => <button key={name} aria-pressed={section === name} onClick={() => setSection(name)}>{name}</button>)}</nav>
    <div className="jade-run-layout">

      <section className="jade-section" aria-label={section}>
        <div className="section-heading"><h2>{section}</h2>{run && <span className="badge">{labels[run.status]}</span>}</div>
        <Feedback loading={!!selected && !detail.data && !detail.error} error={detail.error} />
        {run && <div className="jade-run-summary"><h3>{run.title}</h3><p>{run.goal}</p><small>{run.model} · Revision {run.revision + 1}{run.currentAgent && ` · ${nameOf(run.currentAgent)}`}</small><progress aria-label="Analysis progress" max={status.data?.stageCount || 23} value={run.status === 'completed' ? status.data?.stageCount || 23 : run.step} />
          {run.error && <p className="error" role="alert">{run.error}</p>}
          {run.status === 'failed' && canManage && <RetryButton id={run._id} refresh={refresh} />}
          {run.status === 'completed' && <div className="button-row"><a className="jade-download" href={`/api/jade/runs/${run._id}/presentation.pdf`}>Download executive PDF</a><small>{run.taskIds.length} user task(s) created in Amethyst</small></div>}
          <details><summary>Business context & sources</summary><p>{run.businessContext}</p><ul>{run.sources.map(source => <li key={source.sourceId}>{source.sourceId} · {source.name} · {source.purpose === 'business_context' ? 'Business reference' : 'Input'}{source.coverage && <small> — {source.coverage}</small>}</li>)}</ul></details>
        </div>}
        {run && <div className="jade-stats">{[['Review questions', ['needs_context', 'needs_review'].includes(run.status) ? run.questions.length : 0], ['Critical notifications', assistantItems.filter(item => item.kind === 'notification' && item.priority === 'Critical').length], ['Assistant action items', assistantItems.filter(item => item.kind === 'action_item').length]].map(([label, count]) => <div key={label}><small>{label}</small><strong>{count}</strong></div>)}</div>}
        {section === 'Ecosystem' && <><JadeEcosystem run={run} records={records} connected={connected} selectedAgent={selectedAgent} onSelect={setSelectedAgent} onReview={() => setSection('Approvals')} />
          {selectedAgent && <div className="jade-agent-detail"><h3>{nameOf(selectedAgent)}</h3>{records.filter(record => record.role === selectedAgent).map(record => <Record key={record._id} record={record} name={nameOf(record.role)} userName={userName} />)}{!records.some(record => record.role === selectedAgent) && <p className="muted">No output from this agent for the selected analysis.</p>}</div>}
        </>}
        {section === 'Approvals' && <>{!run ? <p className="muted">Select an analysis awaiting human review or admin approval.</p> : <>
          {['needs_context', 'needs_review'].includes(run.status) && <ContextReview run={run} canManage={canManage} refresh={refresh} />}
          {run.status === 'awaiting_approval' && <IterationApproval run={run} canManage={canManage} refresh={refresh} />}
          {!['needs_context', 'needs_review', 'awaiting_approval'].includes(run.status) && <p className="muted">Review failed checks and critical context, then approve the finished Manager iteration before Board analysis.</p>}
          {records.find(record => record.stage === 'assistant')?.data.items.map((item, index) => <article className="panel" key={index}><div className="section-heading"><h3>{item.title}</h3><span className={`badge ${item.priority}`}>{item.priority}</span></div><span className="eyebrow">{item.kind === 'action_item' ? 'ASSISTANT-RAISED ACTION ITEM' : 'NOTIFICATION'}</span><p>{item.description}</p><small>Timeline rank: {item.importanceRank} · {item.timelineSignals?.length ? item.timelineSignals.map(signal => signal.evidence).join("; ") : "No timeline communicated"}</small><p><strong>Business need:</strong> {item.businessNeed}</p><p><strong>Urgency:</strong> {item.urgency}</p><small>Sources: {item.sourceIds.join(', ')}</small>{records.find(record => record.stage === 'manager')?.data.assignments.filter(assignment => assignment.itemIndex === index).map(assignment => <p key={assignment.itemIndex}>Assignment recorded for {assignment.targetType === 'worker' ? nameOf(assignment.workerRole) : userName(assignment.userId)}: {assignment.rationale}</p>)}</article>)}
          {detail.data.decisions.length > 0 && <details><summary>Human decision history</summary>{detail.data.decisions.map(decision => <p key={decision._id}>{decision.decision} · {new Date(decision.createdAt).toLocaleString()}<br />{decision.reason}</p>)}</details>}
        </>}</>}
        {section === 'Workers & Verification' && <>{!run ? <p className="muted">Select an analysis to inspect worker outputs and verification.</p> : records.filter(record => workerRoles.includes(record.role)).map(record => <Record key={record._id} record={record} name={nameOf(record.role)} userName={userName} />)}{run && !records.some(record => workerRoles.includes(record.role)) && <p className="muted">Worker output will appear as processing advances.</p>}</>}
        {section === 'Board & Directives' && <>{!run ? <p className="muted">Select an analysis to view management delegation and executive statements.</p> : <>{records.filter(record => ['manager', 'finance', 'scale', 'compliance_governance'].includes(record.role)).map(record => <Record key={record._id} record={record} name={record.stage === 'presentation' ? 'Executive presentation' : nameOf(record.role)} userName={userName} />)}{!records.some(record => ['manager', 'finance', 'scale', 'compliance_governance'].includes(record.role)) && <p className="muted">Management direction and Board statements appear after worker verification.</p>}</>}</>}
      </section>
      <aside className="jade-run-list" aria-label="Analysis runs"><div className="section-heading"><h2>Analyses</h2><small>{runs.data?.total ?? '—'} total</small></div>
        {!runs.data && !runs.error && <p>Loading analyses…</p>}
        {runs.data && !filteredRuns.length && <p className="muted">{q ? 'No analyses on this page match your search.' : 'Upload source materials to start an analysis.'}</p>}
        {filteredRuns.map(item => <button className="jade-run-button" key={item._id} aria-pressed={selectedId === item._id} onClick={() => setSelected(item._id)}><strong>{item.title}</strong><small>{labels[item.status]} · {item.department}</small></button>)}
        {runs.data?.pages > 1 && <div className="button-row"><button disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><small>{page} / {runs.data.pages}</small><button disabled={page >= runs.data.pages} onClick={() => setPage(value => value + 1)}>Next</button></div>}
      </aside>
    </div>
  </div>;
}

function UploadForm({ user, projects, status, onCreated }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [department, setDepartment] = useState(user.department === '*' ? '' : user.department);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api('/jade/runs', { method: 'POST', body: new FormData(event.currentTarget) }); onCreated(result._id); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="panel jade-upload"><h2>Start with the evidence.</h2><form className="record-form" onSubmit={submit}>
    <label>Analysis title<input name="title" required maxLength={500} placeholder="FirstNet sales opportunity" /></label>
    <label>Business outcome<textarea name="goal" required maxLength={10000} placeholder="Describe what the executive presentation needs to help decide." /></label>
    <div className="toolbar"><label>Department<input name="department" required maxLength={100} value={department} onChange={event => setDepartment(event.target.value)} readOnly={user.department !== '*'} /></label><label>Linked project<select name="project"><option value="">No linked project</option>{projects.filter(project => project.department === department).map(project => <option key={project._id} value={project._id}>{project.title}</option>)}</select></label></div>
    <label>Business context, urgency & team roles<textarea name="businessContext" required maxLength={30000} placeholder="Describe the business need, known deadlines, goals, relevant policies, and who is qualified to handle the work. Jade uses only this context and your uploaded references." /></label>
    <label>Source documents, spreadsheets or media<input type="file" name="files" required multiple accept={status?.acceptedExtensions} /></label>
    <label>Business model & policy references (optional)<input type="file" name="contextFiles" multiple accept={status?.acceptedExtensions} /></label>
    <small>Up to 3 source files and 3 references. 8 MB per file, 10 MB combined. Audio/video requires a configured transcription service and FFmpeg. Media analysis is limited to 10 minutes with sampled video frames; coverage is recorded.</small>
    <button className="primary" disabled={busy || !status?.configured}>{busy ? 'Uploading…' : 'Upload and run Jade'}</button><Feedback error={error} />
  </form></section>;
}
function ContextReview({ run, canManage, refresh }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [text, setText] = useState('');
  async function decide(decision) {
    setBusy(true); setError('');
    try { await api(`/jade/runs/${run._id}/context`, { method: 'POST', body: { decision, text, revision: run.revision } }); refresh(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="panel jade-context-review"><h3>Worker feedback needs your judgment.</h3><ul>{run.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>{canManage ? <form className="record-form" onSubmit={event => { event.preventDefault(); decide('clarified'); }}><label>Clarification or denial reason<textarea required maxLength={30000} value={text} onChange={event => setText(event.target.value)} /></label><div className="button-row"><button disabled={busy}>Provide context and continue</button><button type="button" disabled={busy || !text.trim()} onClick={() => decide('denied')}>Deny this analysis</button></div><Feedback error={error} /></form> : <p>An authorized department admin must resolve these questions.</p>}</section>;
}
function RetryButton({ id, refresh }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <><button disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await api(`/jade/runs/${id}/retry`, { method: 'POST' }); refresh(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>Retry failed stage</button><Feedback error={error} /></>;
}
function Record({ record, name, userName = () => 'Assigned user' }) {
  const data = record.data;
  return <article className="panel jade-output"><div className="section-heading"><h3>{name}</h3><small>{record.stage.startsWith('delegated_') ? 'Delegated work' : 'Agent output'}</small></div><p>{data.summary}</p>{data.decision && <p>Manager decision: {data.decision}{data.feedback && ` · ${data.feedback}`}{data.designatedWorker && ` · Return to ${data.designatedWorker}`}</p>}
    {data.checks?.map(check => <p key={check.recordId}><span className="badge">{check.status}</span> {check.findings}<br /><small>Record: {check.recordId}</small></p>)}
    {data.recommendations?.length > 0 && <ul>{data.recommendations.map((recommendation, index) => <li key={index}>{recommendation}</li>)}</ul>}
    {data.sections?.map((section, index) => <section key={index}><h4>{section.title}</h4><p>{section.narrative}</p><small>Sources: {section.sourceIds.join(', ')}</small></section>)}
    {data.assignments?.map(assignment => <p key={assignment.itemIndex}>Action {assignment.itemIndex + 1} → {assignment.targetType === 'worker' ? assignment.workerRole : userName(assignment.userId)}<br />{assignment.rationale}</p>)}
    {!!data.facts.length && <details><summary>Source evidence ({data.facts.length})</summary>{data.facts.map((fact, index) => <blockquote key={index}><p>{fact.statement}</p><small>{fact.sourceId} · {fact.locator}</small><p>{fact.evidence}</p></blockquote>)}</details>}
    {!!data.limitations.length && <details><summary>Limitations</summary><ul>{data.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul></details>}
    <small>{new Date(record.createdAt).toLocaleString()} · {record.model}</small>
  </article>;
}

function IterationApproval({ run, canManage, refresh }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function decide(decision) {
    setBusy(true); setError('');
    try { await api(`/jade/runs/${run._id}/approve`, { method: 'POST', body: { decision, reason, revision: run.revision } }); refresh(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="panel"><h3>Approve the finished Manager iteration.</h3><p>Review the Manager's viability assessment and verified worker results before advancing to Finance, Governance, and Scale.</p>{canManage ? <><label>Decision note<textarea value={reason} onChange={event => setReason(event.target.value)} maxLength={30000} /></label><div className="button-row"><button disabled={busy} onClick={() => decide('approved')}>Approve to Board</button><button disabled={busy} onClick={() => decide('denied')}>Deny iteration</button></div><Feedback error={error} /></> : <p>An authorized admin must approve this iteration.</p>}</section>;
}
