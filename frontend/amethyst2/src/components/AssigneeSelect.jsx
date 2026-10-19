export default function AssigneeSelect({ members, defaultValue = [], name = 'assignees' }) {
  return <label>Delegate to members (required)
    <select name={name} multiple required defaultValue={defaultValue} size={Math.min(6, Math.max(3, members.length))}>
      {members.map(member => <option key={member._id} value={member._id}>{member.name} · {member.department}</option>)}
    </select>
    <small>Select one or more members. Hold Command on Mac or Ctrl on Windows to select multiple names.</small>
  </label>;
}
