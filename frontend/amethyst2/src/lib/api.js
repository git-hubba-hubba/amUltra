export async function api(path, options = {}) {
 const form=options.body instanceof FormData;
 const response=await fetch(`/api${path}`,{credentials:'same-origin',...options,headers:{...(!form && options.body ? {'Content-Type':'application/json'}:{}),...options.headers},body:options.body ? form ? options.body : JSON.stringify(options.body) : undefined});
 const data=await response.json().catch(()=>({error:'Server returned an invalid response'}));
 if(!response.ok) { const error=new Error(data.error || 'Request failed');error.status=response.status;throw error; }
 return data;
}
