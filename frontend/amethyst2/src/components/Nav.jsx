export default function Nav({ currentDisplay, setCurrentDisplay, search, setSearch, reviewCount = 0, notificationCount = 0 }) {
  return (
    <nav className="navContainer" aria-label="Main navigation">
      <div className="leftNav">
        <button className="navIconButton" title="Tasks" aria-label="Tasks" onClick={() => setCurrentDisplay('tasks')}>
          <img src="https://png.pngtree.com/png-vector/20230906/ourmid/pngtree-the-graphic-design-of-a-triangle-logo-vector-png-image_7071472.png" alt="Tasks" className="navIcons" />
        </button>
        <button className="navIconButton" title="File uploader" aria-label="File uploader" onClick={() => setCurrentDisplay('fileUploader')}>
          {reviewCount > 0 && <span className="reviewNotification" role="status" title={`${reviewCount} tasks need your approval`}>{reviewCount}<span className="visuallyHidden"> tasks need your approval</span></span>}
          <img src="https://uxwing.com/wp-content/themes/uxwing/download/file-and-folder-type/file-upload-export-dual-tone-icon.png" alt="Upload" className="navIcons" />
        </button>
      </div>
      <input type="search" className="navNput" placeholder="Search Amethyst" aria-label="Search Amethyst" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} />
      <div className="leftNav">
        <button className="navIconButton" title="Calendar" aria-label="Calendar" onClick={() => setCurrentDisplay('calendar')}>
          <img src="https://cdn-icons-png.flaticon.com/512/1513/1513520.png" alt="Calendar" className="navIcons" />
        </button>
        <button className="navIconButton" title="My profile" aria-label="My profile" onClick={() => setCurrentDisplay('profile')}>
          {notificationCount > 0 && <span className="reviewNotification" role="status">{notificationCount}<span className="visuallyHidden"> unread task notifications</span></span>}
          <img src="https://cdn-icons-png.flaticon.com/512/1361/1361913.png" alt="Profile" className="navIcons" />
        </button>
        <p className="currentDisplay" aria-live="polite">{currentDisplay}</p>
      </div>
    </nav>
  );
}
