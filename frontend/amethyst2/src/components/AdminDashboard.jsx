import { useEffect } from 'react';
import { GeneratedTask } from './FileUploader';
import { useResource } from '../lib/useResource';
import { admin } from '../features/workspace/helpers';
import Feedback from '../features/shared/Feedback';

export default function AdminDashboard({ user, members, q = '', onChanged }) {
  const proposals = useResource('/proposals?status=pending');
  const refreshProposals = proposals.refresh;
  useEffect(() => {
    const timer = setInterval(refreshProposals, 30000);
    window.addEventListener('focus', refreshProposals);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshProposals); };
  }, [refreshProposals]);
  const pending = (proposals.data || []).filter(item => admin(user, item));
  const matching = pending.filter(item => `${item.draft.title} ${item.draft.description || ''} ${item.source} ${item.department}`.toLowerCase().includes(q.toLowerCase()));
  function refresh() { proposals.refresh(); onChanged?.(); }
  return <section aria-label="Admin Dashboard">
    <h2>Admin Dashboard</h2>
    <p>Review pending task drafts before they appear in current tasks. Approve to create a task, or dismiss the draft.</p>
    <Feedback loading={proposals.loading} error={proposals.error} />
    {proposals.data && <p role="status">{pending.length} tasks awaiting your approval.</p>}
    {proposals.data && !matching.length && <p>{pending.length ? 'No pending tasks match your search.' : 'No tasks awaiting approval.'}</p>}
    {matching.map(item => <GeneratedTask key={`${item._id}:${item.__v}`} item={item} user={user} members={members} refresh={refresh} />)}
  </section>;
}
