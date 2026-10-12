import tasksIcon from '../assets/icons/tasks.svg'
import uploadIcon from '../assets/icons/upload.png'
import calendarIcon from '../assets/icons/calendar.png'
import membersIcon from '../assets/icons/members.png'
export default function Nav({ currentDisplay, setCurrentDisplay, search, setSearch, reviewCount = 0, notificationCount = 0 }) {
  return (
    <nav className="navContainer" aria-label="Main navigation">
      <div className="leftNav">
        <button className="navIconButton" title="Tasks" aria-label="Tasks" onClick={() => setCurrentDisplay('tasks')}>
          <img src={tasksIcon} alt="Tasks" className="navIcons" />
        </button>
        <button className="navIconButton" title="File uploader" aria-label="File uploader" onClick={() => setCurrentDisplay('fileUploader')}>
          {reviewCount > 0 && <span className="reviewNotification" role="status" title={`${reviewCount} tasks need your approval`}>{reviewCount}<span className="visuallyHidden"> tasks need your approval</span></span>}
          <img src={uploadIcon} alt="Upload" className="navIcons" />
        </button>
      </div>
      <input type="search" className="navNput" placeholder={currentDisplay === 'jade' ? 'Search Jade' : 'Search Amethyst'} aria-label={currentDisplay === 'jade' ? 'Search Jade analyses and agents' : 'Search Amethyst'} value={search} onChange={event => setSearch(event.target.value)} maxLength={200} />
      <div className="leftNav">
        <button className="navIconButton" title="Calendar" aria-label="Calendar" onClick={() => setCurrentDisplay('calendar')}>
          <img src={calendarIcon} alt="Calendar" className="navIcons" />
        </button>
        <button className="navIconButton" title="My profile" aria-label="My profile" onClick={() => setCurrentDisplay('profile')}>
          {notificationCount > 0 && <span className="reviewNotification" role="status">{notificationCount}<span className="visuallyHidden"> unread task notifications</span></span>}
          <img src={membersIcon} alt="Profile" className="navIcons" />
        </button>
        <p className="currentDisplay" aria-live="polite">{currentDisplay === 'jade' ? 'Jade' : currentDisplay}</p>
      </div>
    </nav>
  );
}
