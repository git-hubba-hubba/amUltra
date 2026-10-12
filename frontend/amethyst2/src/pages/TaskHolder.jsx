import { useState } from 'react';
import Tasks from '../components/Tasks';
import { GeneratedTask } from '../components/FileUploader';
import { useResource } from '../lib/useResource';
import { RecordDetail } from '../features/workspace/Records';
import { admin, fieldsFor } from '../features/workspace/helpers';
import Modal from '../features/shared/Modal';
import RecordForm from '../features/shared/RecordForm';
import Feedback from '../features/shared/Feedback';

export default function TaskHolder({ user, q, members, projects }) {
  const [department, setDepartment] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('');
  const [completion, setCompletion] = useState('non-completed');
  const [page, setPage] = useState(1);
  const [create, setCreate] = useState(false);
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get('task'));
  const [mode, setMode] = useState('');
  const [selectedDraft, setSelectedDraft] = useState(null);
  const proposals = useResource('/proposals?status=pending&source=notes');
  const refresh = () => { tasks.refresh(); proposals.refresh(); };
  const params = new URLSearchParams({ q, department, priority, completion: 'all', page: '1', limit: '200', sort: 'priority' });
  if (due) params.set('to', new Date(`${due}T23:59:59`).toISOString());
  const tasks = useResource(`/tasks?${params}`, true);
  const pendingTasks = (proposals.data || []).filter(item => admin(user,item)).map(item => ({ ...item.draft, _id: item._id, __v: item.__v, department: item.department, creator: item.creator, project: item.project, createdAt: item.createdAt, status: 'pending_approval', approvalPending: true }));
  const matchingDrafts = pendingTasks.filter(item => (!department || item.department.toLowerCase().includes(department.toLowerCase())) && (!priority || item.priority === priority) && !due && `${item.title} ${item.description}`.toLowerCase().includes((q || '').toLowerCase()));
  const filteredTasks = [...matchingDrafts, ...(tasks.data?.items || [])]
    .filter(task => completion === '' || (completion === 'completed' ? task.status === 'done' : task.status !== 'done'))
    .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done'));
  const pages = Math.max(1, Math.ceil(filteredTasks.length / 24));
  const currentPage = Math.min(page, pages);
  const visibleTasks = filteredTasks.slice((currentPage - 1) * 24, currentPage * 24);
  function filter(setter) {
    return event => { setter(event.target.value); setPage(1); };
  }
  function open(record, mode = '') { if (record.approvalPending) { setSelectedDraft(record._id); return; } setSelected(record._id); setMode(mode); }
  return <>
    <div className="taskNav">
      <div className="taskSlice"><input aria-label="Filter by department" placeholder="Department" value={department} onChange={filter(setDepartment)} /></div>
      <div className="taskSlice"><label className="dateFilter">{due || 'Date'}<input aria-label="Filter by deadline" type="date" value={due} onChange={filter(setDue)} /></label></div>
      <div className="taskSlice"><select aria-label="Filter by priority" value={priority} onChange={filter(setPriority)}><option value="">Priority</option>{['Critical', 'High', 'Medium', 'Low'].map(value => <option key={value}>{value}</option>)}</select></div>
      <div className="taskSlice"><select aria-label="Filter by completion" value={completion} onChange={filter(setCompletion)}><option value="">All tasks</option><option value="completed">Completed</option><option value="non-completed">Non-completed</option></select></div>
    </div>
    <div className="taskTools"><button aria-pressed={completion === ''} onClick={() => { setCompletion(completion === '' ? 'non-completed' : ''); setPage(1); }}>{completion === '' ? 'Hide completed tasks' : 'Show all tasks'}</button><button onClick={() => { setDepartment(''); setDue(''); setPriority(''); setCompletion('non-completed'); setPage(1); }}>Clear filters</button><button onClick={() => setCreate(true)}>＋ New task</button></div>
    <Feedback loading={tasks.loading || proposals.loading} error={tasks.error || proposals.error} empty={!filteredTasks.length} />
    {visibleTasks.map(record => <Tasks key={record._id} record={record} user={user} open={open} refresh={refresh} />)}
    <div className="pagination"><span>{filteredTasks.length} tasks</span><button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>Previous</button><span>Page {currentPage} of {pages}</span><button disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>Next</button></div>
    {selectedDraft && <Modal title="Manager approval" onClose={() => setSelectedDraft(null)}>{proposals.data?.find(item => item._id === selectedDraft) ? <GeneratedTask item={proposals.data.find(item => item._id === selectedDraft)} user={user} members={members} refresh={() => { setSelectedDraft(null); refresh(); }} /> : <Feedback loading={proposals.loading} error={proposals.error} />}</Modal>}
    {create && <Modal title="Create task" onClose={() => setCreate(false)}><RecordForm kind="tasks" fields={fieldsFor('tasks', user, projects, members)} onSaved={() => { setCreate(false); tasks.refresh(); }} /></Modal>}
    {selected && <RecordDetail kind="tasks" id={selected} mode={mode} user={user} members={members} projects={projects} onClose={() => setSelected(null)} refresh={refresh} />}
  </>;
}
