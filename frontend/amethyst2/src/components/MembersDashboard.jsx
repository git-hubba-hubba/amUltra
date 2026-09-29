import { useState } from 'react';
import { useResource } from '../lib/useResource';
import Feedback from '../features/shared/Feedback';

export default function MembersDashboard({ user, q = '' }) {
  const members = useResource('/members');
  const access = useResource('/project-access');
  const [role, setRole] = useState('all');
  const [department, setDepartment] = useState('');
  const [showDirectory, setShowDirectory] = useState(false);
  const people = (members.data || []).filter(member => member.name !== 'Screenshot import').map(member => ({
    ...member,
    email: member.loginEnabled === false || /@directory\.invalid$/i.test((member.email || '').trim()) ? '' : member.email,
  }));
  const grantsFor = member => (access.data || []).filter(grant => grant.status === 'approved' && grant.user?._id === member._id).map(grant => grant.project);
  const rows = people.filter(member => showDirectory || member.loginEnabled !== false).map(member => ({ ...member, projects: grantsFor(member) })).filter(member => {
    const isAdmin = member.loginEnabled !== false && (member.role === 'admin' || member.projects.length > 0);
    return (!department || member.department === department) && (role === 'all' || (role === 'admin' ? isAdmin : !isAdmin)) && `${member.name} ${member.email} ${member.department} ${member.projects.map(project => project.title).join(' ')}`.toLowerCase().includes(q.toLowerCase());
  }).sort((a, b) => a.name.localeCompare(b.name));
  return <>
    <div className="section-heading"><div><h1>Members</h1><p className="muted">Find your team and see who manages each department or project.</p></div><button onClick={() => { members.refresh(); access.refresh(); }}>Refresh</button></div>
    <div className="toolbar"><label>Department<select value={department} onChange={event => setDepartment(event.target.value)}><option value="">All departments</option>{[...new Set(people.map(member => member.department))].sort().map(name => <option key={name} value={name}>{name === '*' ? 'All departments' : name}</option>)}</select></label><label>Role<select value={role} onChange={event => setRole(event.target.value)}><option value="all">All roles</option><option value="admin">Administrators</option><option value="member">Members</option></select></label><label className="check"><input type="checkbox" checked={showDirectory} onChange={event => setShowDirectory(event.target.checked)} />Include imported directory entries</label></div>
    <Feedback loading={members.loading || access.loading} error={members.error || access.error} />
    {!members.loading && !access.loading && !members.error && !access.error && <><p className="muted">{rows.length} {rows.length === 1 ? 'member' : 'members'} matching your filters</p><div className="table-scroll"><table><thead><tr><th>Member</th><th>Department</th><th>Role and admin scope</th><th>Account</th></tr></thead><tbody>{rows.map(member => <tr key={member._id}><td><strong>{member.name}{member._id === user._id ? ' (you)' : ''}</strong>{member.email && <small>{member.email}</small>}</td><td>{member.department === '*' ? 'All departments' : member.department}</td><td>{member.loginEnabled === false ? 'Directory entry' : <>{member.role === 'admin' ? <span className="badge">{member.department === '*' ? 'Workspace admin' : `Department admin · ${member.department}`}</span> : !member.projects.length && <span>Member</span>}{member.projects.length > 0 && <div><strong>Project admin</strong><ul>{member.projects.map(project => <li key={project._id}>{project.title}</li>)}</ul></div>}</>}</td><td>{member.loginEnabled === false ? 'No login account' : member.status === 'active' ? 'Active' : 'Pending'}</td></tr>)}</tbody></table></div>{rows.length === 0 && <p>No members match these filters.</p>}</>}
  </>;
}
