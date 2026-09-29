import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
export function useResource(path, allPages = false) {
 const [result,setResult]=useState({data:null,error:'',key:null});
 const [revision,setRevision]=useState(0);
 const refresh=useCallback(()=>setRevision(v=>v+1),[]);
 const key=`${path}:${revision}:${allPages}`;
 useEffect(()=>{
  const controller=new AbortController();
  async function fetchData() {
   const first=await api(path,{signal:controller.signal});
   if(!allPages || !first.pages || first.pages<=1)return first;
   const items=[...first.items];
   for(let page=2;page<=first.pages;page++) {
    const url=new URL(path,'http://localhost');
    url.searchParams.set('page',String(page));
    const next=await api(url.pathname+url.search,{signal:controller.signal});
    items.push(...next.items);
   }
   return {...first,items,pages:1};
  }
  fetchData()
   .then(data=>{if(!controller.signal.aborted)setResult({data,error:'',key})})
   .catch(error=>{if(!controller.signal.aborted)setResult({data:null,error:error.message,key})});
  return()=>controller.abort();
 },[path,key,allPages]);
 return {data:result.key===key?result.data:null,error:result.key===key?result.error:'',loading:result.key!==key,refresh};
}
