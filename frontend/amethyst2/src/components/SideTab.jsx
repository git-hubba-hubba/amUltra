export default function SideTab({ currObj, currentDisplay, setCurrentDisplay }) {
  return (
    <button className="stMain" aria-current={currentDisplay === currObj.currentDisplayName ? 'page' : undefined} onClick={() => setCurrentDisplay(currObj.currentDisplayName)}>
      <span className="stContent">{currObj.title}</span>
      <img src={currObj.img} alt="" className="stImg" />
    </button>
  );
}
