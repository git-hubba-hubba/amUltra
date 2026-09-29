import Records from '../features/workspace/Records';

export default function Calendar(props) {
  return <Records kind="events" {...props} />;
}
