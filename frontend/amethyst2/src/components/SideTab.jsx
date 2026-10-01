export default function SideTab({ currObj, currentDisplay, setCurrentDisplay }) {
  return (
    <button className="stMain" aria-current={currentDisplay === currObj.currentDisplayName ? 'page' : undefined} onClick={() => setCurrentDisplay(currObj.currentDisplayName)}>
      <img src={currObj.img} alt="" className="stImg" />
      <span className="stContent">{currObj.title}</span>
    </button>
  );
}
