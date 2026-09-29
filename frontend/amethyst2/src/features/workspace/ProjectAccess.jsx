import { useResource } from '../../lib/useResource';
import Feedback from '../shared/Feedback';
import { ActionForm, Members } from './shared';
import { admin, date } from './helpers';

export default function ProjectAccess({ user, members, projects, onAccessChanged }) {
  const access = useResource('/project-access');
  const items = access.data || [];
  const own = items.filter(item => item.user._id === user._id);
  const canApprove = project => user.role === 'admin' && (user.department === '*' || user.department === project.department);
  const reviewable = items.filter(item => canApprove(item.project) && ['pending', 'approved'].includes(item.status));
  const available = projects.filter(project => !admin(user, project, 'projects') && !own.some(item => item.project._id === project._id && ['pending', 'approved'].includes(item.status)));
  const approvable = projects.filter(canApprove);
  function refresh() {
    access.refresh();
    onAccessChanged();
  }
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>Project admin access</h2>
        <button onClick={refresh}>Refresh access</button>
      </div>
      <p>Every signed-in member can read all workspace content. Approval lets you manage one project and its linked work. Your account remains a member account.</p>
      <Feedback loading={access.loading} error={access.error} />
      {own.map(item => (
        <article className="note" key={item._id}>
          <strong>{item.project.title}</strong> <span className="badge">{item.status}</span>
          <p>{item.reason}</p>
          {item.reviewNote && <p>Review: {item.reviewNote}</p>}
          {item.reviewedAt && <small>Reviewed {date(item.reviewedAt)}</small>}
        </article>
      ))}
      {available.length > 0 && <ActionForm path="/project-access" onSaved={refresh} submitLabel="Request project admin access">
        <label>Project<select name="project" required defaultValue="">
          <option value="" disabled>Select a project</option>
          {available.map(project => <option key={project._id} value={project._id}>{project.title} · {project.department}</option>)}
        </select></label>
        <label>Reason<textarea name="reason" required maxLength={2000} /></label>
      </ActionForm>}
      {!projects.length && <p>An administrator must create a project before project admin access can be requested.</p>}
      {user.role === 'admin' && <>
        <h3>Approve project administrators</h3>
        <p>Choose a member and the project they may manage. This grants no rights over other projects.</p>
        {approvable.length > 0 && <ActionForm path="/project-access/grant" onSaved={refresh} submitLabel="Grant project admin access">
          <label>Member<Members members={members.filter(member => member.loginEnabled !== false)} name="user" /></label>
          <label>Project<select name="project" required defaultValue="">
            <option value="" disabled>Select a project</option>
            {approvable.map(project => <option key={project._id} value={project._id}>{project.title}</option>)}
          </select></label>
          <label>Approval note<textarea name="reviewNote" maxLength={2000} /></label>
        </ActionForm>}
        {reviewable.map(item => <article className="note" key={item._id}>
          <strong>{item.user.name} · {item.project.title}</strong> <span className="badge">{item.status}</span>
          <p>{item.reason}</p>
          <ActionForm key={item.__v} path={`/project-access/${item._id}/review`} onSaved={refresh}
            submitLabel={item.status === 'approved' ? 'Revoke project admin access' : 'Save decision'}
            transform={values => ({ ...values, __v: item.__v })}>
            {item.status === 'pending' ? <label>Decision<select name="decision"><option value="approved">Approve</option><option value="denied">Deny</option></select></label>
              : <input type="hidden" name="decision" value="revoked" />}
            <label>Review note<textarea name="reviewNote" maxLength={2000} /></label>
          </ActionForm>
        </article>)}
      </>}
    </section>
  );
}
