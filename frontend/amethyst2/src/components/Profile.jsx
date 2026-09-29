import { api } from '../lib/api';
import { useState } from 'react';
import { useResource } from '../lib/useResource';
import Tasks from './Tasks';
import Cinemas from './Cinemas';
import ProjectAccess from '../features/workspace/ProjectAccess';
import { RecordDetail } from '../features/workspace/Records';
import Feedback from '../features/shared/Feedback';

export default function Profile({ user, q, members, projects, onAccessChanged, logout, notifications }) {
  const [tab, setTab] = useState('Tasks');
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState('');
  const [error, setError] = useState('');
  const queue = useResource('/queue');
  const tasks = (queue.data || []).filter(task => `${task.title} ${task.description}`.toLowerCase().includes(q.toLowerCase()));
  function open(record, mode = '') { setSelected(record._id); setMode(mode); }
  return <>
    <h1>My Profile</h1>
    <div className="profileAdmin">
      <div className="profileNav">
        <img src="https://images.unsplash.com/photo-1511367461989-f85a21fda167?q=80&w=1031&auto=format&fit=crop&ixlib=rb-4.1.0&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fA%3D%3D" alt="" className="myPic" />
        <div className="profileContact"><h2 className="proName">{user.name}</h2><p className="proOcc">{user.department} · {user.role}</p><p>{user.email}</p></div>
      </div>
      <div className="profileSubNav">{['Tasks', 'Cinemas', 'Requests', 'Metrics'].map(name => <button key={name} aria-pressed={tab === name} onClick={() => setTab(name)}>{name}</button>)}</div>
    </div>
    {tab === 'Tasks' && <>
      <section className="panel"><h2>Shared with you</h2><Feedback loading={notifications?.loading} error={notifications?.error} />
        {notifications?.data?.items.length === 0 && <p>No task notifications yet.</p>}
        {notifications?.data?.items.map(notification => <article className="note" key={notification._id}><strong>{notification.sender?.name || 'Member'}</strong> shared {notification.title}{!notification.readAt && <small> · New</small>} <button onClick={async () => {
          setSelected(notification.task); setMode('');
          try { await api(`/notifications/${notification._id}/read`, { method: 'PATCH' }); notifications.refresh(); } catch (error) { setError(error.message); }
        }}>View task</button></article>)}
      </section>
<p className="muted">Your priority queue: overdue tasks, priority, deadline, then difficulty.</p><Feedback loading={queue.loading} error={queue.error} empty={!tasks.length} />{tasks.map(record => <Tasks key={record._id} record={record} user={user} open={open} refresh={queue.refresh} />)}</>}
    {tab === 'Cinemas' && <Cinemas user={user} members={members} projects={projects} q={q} />}
    {tab === 'Requests' && <><ProjectAccess user={user} members={members} projects={projects} onAccessChanged={onAccessChanged} /><details className="panel"><summary>Member directory ({members.filter(member=>member.name!=='Screenshot import').length})</summary><div className="table-scroll"><table><thead><tr><th>Member</th><th>Department</th><th>Access</th></tr></thead><tbody>{members.filter(member=>member.name!=='Screenshot import').map(member=><tr key={member._id}><td>{member.name}</td><td>{member.department}</td><td>{member.loginEnabled===false?'Source directory entry · login disabled':member.role}</td></tr>)}</tbody></table></div></details></>}
    {tab === 'Metrics' && <><Feedback loading={queue.loading} error={queue.error} /><div className="stats">{['Critical', 'High', 'Medium', 'Low'].map(priority => <section key={priority}><h2>{priority}</h2><strong>{tasks.filter(task => task.priority === priority).length}</strong><p>Active owned tasks</p></section>)}</div></>}
    <button className="profileLogout" onClick={async () => { try { await logout(); } catch (error) { setError(error.message); } }}>Log out</button>
    {error && <p className="error" role="alert">{error}</p>}
    {selected && <RecordDetail kind="tasks" id={selected} mode={mode} user={user} members={members} projects={projects} onClose={() => setSelected(null)} refresh={queue.refresh} />}
  </>;
}
