import { useEffect, useState } from 'react';
import Nav from './Nav';
import MembersDashboard from './MembersDashboard';
import LeftBar from './LeftBar';
import ConceptHub from '../pages/ConceptHub';
import Meetings from '../pages/Meetings';
import Projects from '../pages/Projects';
import Roadmap from '../pages/Roadmap';
import Overview from '../pages/Overview';
import Calendar from './Calendar';
import Profile from './Profile';
import TaskHolder from '../pages/TaskHolder';
import FileUploader from './FileUploader';
import Cinemas from './Cinemas';
import { useResource } from '../lib/useResource';

export default function Dashboard({ user: initialUser, logout }) {
  const [currentDisplay, setCurrentDisplay] = useState('tasks');
  const [search, setSearch] = useState('');
  const session = useResource('/auth/me');
  const notifications = useResource('/notifications');
  const refreshNotifications = notifications.refresh;
  useEffect(() => {
    const timer = setInterval(refreshNotifications, 30000);
    window.addEventListener('focus', refreshNotifications);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshNotifications); };
  }, [refreshNotifications]);
  const alerts = useResource('/intake-alerts');
  const refreshAlerts = alerts.refresh;
  useEffect(() => {
    const timer = setInterval(refreshAlerts, 30000);
    window.addEventListener('focus', refreshAlerts);
    return () => { clearInterval(timer); window.removeEventListener('focus', refreshAlerts); };
  }, [refreshAlerts]);
  const members = useResource('/members');
  const projects = useResource('/projects?limit=200&sort=priority', true);
  const refreshAccess = session.refresh;
  useEffect(() => {
    window.addEventListener('focus', refreshAccess);
    return () => window.removeEventListener('focus', refreshAccess);
  }, [refreshAccess]);
  const context = {
    user: session.data || initialUser,
    q: search,
    members: members.data || [],
    projects: projects.data?.items || [],
    onChanged: projects.refresh,
    onIntakeChanged: refreshAlerts,
    onAccessChanged: session.refresh,
    notifications,
    logout,
  };
  const pages = {
    overview: Overview, meetings: Meetings, projects: Projects, concept: ConceptHub,
    roadmap: Roadmap, tasks: TaskHolder, calendar: Calendar, profile: Profile,
    fileUploader: FileUploader, cinemas: Cinemas, members: MembersDashboard,
  };
  const Page = pages[currentDisplay] || TaskHolder;
  return (
    <div className="dashboard">
      <Nav currentDisplay={currentDisplay} setCurrentDisplay={setCurrentDisplay} search={search} setSearch={setSearch} reviewCount={alerts.data?.count || 0} notificationCount={notifications.data?.unread || 0} />
      <div className="ghadbhadi">
        <aside className="gbLeft">
          <LeftBar currentDisplay={currentDisplay} setCurrentDisplay={setCurrentDisplay} />
        </aside>
        <main className="gbMid">
          {session.error && <p className="error" role="alert">Access: {session.error}</p>}
          {members.error && <p className="error" role="alert">Members: {members.error}</p>}
          {projects.error && <p className="error" role="alert">Projects: {projects.error}</p>}
          <Page key={`${currentDisplay}:${search}`} {...context} />
        </main>
        <div className="gbRight" />
      </div>
    </div>
  );
}
