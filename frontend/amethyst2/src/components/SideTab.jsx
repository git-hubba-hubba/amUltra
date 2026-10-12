export default function SideTab({ currObj, currentDisplay, setCurrentDisplay }) {
  return (
    <button className="stMain" aria-current={currentDisplay === currObj.currentDisplayName ? 'page' : undefined} onClick={() => setCurrentDisplay(currObj.currentDisplayName)}>
      {currObj.symbol === 'jade' ? <svg className="jade-nav-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 8 5v8l-8 5-8-5V8l8-5Z" stroke="currentColor" strokeWidth="1.6"/><path d="m4 8 8 5 8-5M12 13v8M12 3v10" stroke="currentColor" strokeWidth="1.6"/></svg> : <img src={currObj.img} alt="" className="stImg" />}
      <span className="stContent">{currObj.title}</span>
    </button>
  );
}
