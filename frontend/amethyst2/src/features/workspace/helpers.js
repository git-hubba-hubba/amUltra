export const priorities = ['Critical','High','Medium','Low'];
export const date = value => value ? new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}) : 'Not scheduled';
export const admin = (user, record, kind) => (user.role==='admin' && (user.department==='*'||user.department===record.department)) || (user.projectAdminIds || []).includes(kind==='projects'?record._id:record.project);
export const editable = (user, record, kind) => admin(user,record,kind)||record.creator===user._id||record.owner===user._id;
export function fieldsFor(kind,user,projects=[],members=[]) {
 const field=(name,label,type='text',extra={})=>({name,label,type,...extra});
 const fields=[field('title','Title','text',{required:true}),field('description','Description','textarea'),field('department','Department','text',{required:true,default:user.department==='*'?'General':user.department})];
 if(['tasks','projects','events','roadmap','meetings','topics'].includes(kind)&&kind!=='projects')fields.push(field('project','Project','text',{options:projects.map(p=>({value:p._id,label:p.title,department:p.department}))}));
 if(['tasks','projects'].includes(kind))fields.push(field('team','Team'),field('priority','Priority','text',{options:priorities,required:true,default:'Medium'}),field('status','Status','text',{options:[{value:'todo',label:'To do'},{value:'in_progress',label:'In progress'},{value:'blocked',label:'Blocked'},{value:'in_review',label:'In review'},{value:'done',label:'Completed'},{value:'cancelled',label:'Cancelled'}],required:true,default:'todo'}));
 if(kind==='tasks')fields.push(field('difficulty','Difficulty (1–5)','number',{min:1,max:5,default:3,required:true}),field('blockedReason','Blocker'));
 if(['tasks','projects','roadmap','events'].includes(kind))fields.push(field('startDate','Start','datetime-local',{required:['roadmap','events'].includes(kind)}),field(kind==='events'?'endDate':'dueDate',kind==='events'?'End':'Deadline','datetime-local',{required:['roadmap','events'].includes(kind)}));
 if(['projects','roadmap'].includes(kind))fields.push(field('owner','Owner','text',{options:members.filter(m=>m.status==='active').map(m=>({value:m._id,label:m.name}))}));
 if(kind==='projects')fields.push(field('featured','Featured position (1–3)','number',{min:1,max:3}));
 if(kind==='events')fields.push(field('location','Location'),field('timezone','Timezone','text',{default:'America/Chicago',required:true}));
 if(kind==='meetings')fields.push(field('heldAt','Meeting date','datetime-local',{required:true}),field('notes','Meeting notes','textarea'));
 if(kind==='topics')fields.push(field('category','Category','text',{default:'Ideas'}));
 if(kind==='roadmap')fields.push(field('phase','Phase','text',{options:['EP 1.0','EP 2.0','EP 3.0'],required:true}),field('kind','Type','text',{options:['workstream','milestone'],required:true}),field('status','Status','text',{options:['Planned','In Progress','Complete'],required:true}));
 return fields;
}
