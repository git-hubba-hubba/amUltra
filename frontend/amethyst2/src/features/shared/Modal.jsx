import { useEffect, useRef } from 'react';
export default function Modal({title,onClose,children}) {
 const ref=useRef(null);
 useEffect(()=>{const prior=document.activeElement;const dialog=ref.current;dialog.showModal();return()=>{dialog.close();prior?.focus()}},[]);
 return <dialog ref={ref} className="app-modal" onCancel={e=>{e.preventDefault();onClose()}} aria-label={title}><div className="modal-heading"><h2>{title}</h2><button onClick={onClose} aria-label="Close dialog">×</button></div>{children}</dialog>;
}
