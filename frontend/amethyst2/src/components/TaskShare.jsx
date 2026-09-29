import { useResource } from '../lib/useResource';
import { ActionForm } from '../features/workspace/shared';
import Feedback from '../features/shared/Feedback';

export default function TaskShare({ record, user, onSaved }) {
  const members = useResource('/members');
  const available = (members.data || []).filter(member => member.status === 'active' && member.loginEnabled !== false && member._id !== user._id);
  return <><p>Send a notification with a link to this task.</p><Feedback loading={members.loading} error={members.error} />
    {!members.loading && !members.error && (available.length ? <ActionForm path={`/tasks/${record._id}/share`} onSaved={onSaved} submitLabel="Send notification"><label>Member<select name="recipient" required><option value="">Choose a member</option>{available.map(member => <option key={member._id} value={member._id}>{member.name} · {member.department}</option>)}</select></label></ActionForm> : <p>No other active members are available.</p>)}
  </>;
}
