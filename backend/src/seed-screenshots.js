import mongoose from 'mongoose';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { User, Task, Project, Roadmap, Cinema, Avp } from './models.js';
import { hashPassword } from './auth.js';
import { roadmapRows, avpRows, cinemaRows, people } from '../data/expert-path-screenshots.js';

const department = 'Business Care & Sales';
const monthStart = label => new Date(`${label}-01T00:00:00.000Z`);
const monthEnd = label => { const [year,month]=label.split('-').map(Number); return new Date(Date.UTC(year,month,0,23,59,59,999)); };
export async function seedScreenshots(organization) {
 const summary = { inserted: {}, existing: {} };
 const keyId = key => new mongoose.Types.ObjectId(createHash('sha256').update(`amethyst-source-v1:${organization}:${key}`).digest('hex').slice(0,24));
 await mongoose.connection.transaction(async session => {
  summary.inserted = {}; summary.existing = {};
  async function put(Model, key, data) {
   const _id=keyId(key);
   const existing=await Model.findById(_id).session(session);
   const counts=existing?summary.existing:summary.inserted;
   counts[Model.modelName]=(counts[Model.modelName]||0)+1;
   if(existing)return existing;
   const [created]=await Model.create([{...data,_id,organization}],{session});
   return created;
  }
  const directory={};
  for(const name of [...people,'Screenshot import']) {
   const matches=await User.find({organization,name,loginEnabled:{$ne:false}}).session(session);
   if(name!=='Screenshot import' && matches.length===1){directory[name]=matches[0]._id;continue;}
   const key=`person:${name}`;
   const user=await put(User,key,{name,department:'Unspecified',role:'member',status:'active',loginEnabled:false,
    email:`${keyId(key)}@directory.invalid`,passwordHash:hashPassword(randomBytes(32).toString('hex')),
    sourceReference:{key,file:'Expert Path screenshots',warnings:['Directory entry only. No email address or login credentials were supplied. Department not specified.']}});
   directory[name]=user._id;
  }
  const creator=directory['Screenshot import'];
  const owner=label=>directory[label];
  const projectSpecs=[
   ['phase1','Expert Path 1.0 — Foundation, Launch & Deploy','EP Squad','2025-04','2027-06'],
   ['phase2','Expert Path 2.0 — By Experts, For Experts','EP Squad','2026-03','2027-03'],
   ['phase3','Expert Path 3.0 — Quality CX by customer need','EP Squad','2026-05','2027-11'],
   ['avp','ChatR — AVP action tracker','ChatR',null,null],
   ...cinemaRows.map((row,index)=>[`cinema${index}`,row.title,'StataPile',null,null]),
  ];
  const projects={};
  for(const [key,title,team,start,end] of projectSpecs) {
   const sourceFile=key.startsWith('phase')?'EPRoadmap.png':key==='avp'?'avpLook.png':'cinemaLook.png';
   const project=await put(Project,`project:${key}`,{title,department,team,creator,priority:'Medium',status:'in_progress',
    description:`Imported grouping from ${sourceFile}. ${key.startsWith('phase')?'Expert Path program; target completion November 2027.':'See linked tasks and source notes.'}`,
    ...(start?{startDate:monthStart(start),dueDate:monthEnd(end)}:{}),
    sourceReference:{key:`project:${key}`,file:sourceFile,startLabel:start,dueLabel:end,warnings:['Project grouping and department association are organizational mappings. Priority was not specified; Medium is a default.']}});
   projects[key]=project._id;
  }
  for(const [index,row] of roadmapRows.entries()) {
   const [phase,title,ownerLabel,start,end,status,warning]=row;
   const key=`roadmap:${index+1}`;
   const milestone=[4,6,9,24,28].includes(index+1);
   const sourceReference={key,file:'EPRoadmap.png',row:index+1,ownerLabel,startLabel:start,dueLabel:end,
    warnings:['Dates are month-level: stored as month boundaries for timeline rendering; milestone markers use the first day as a display anchor.','Transcribed from a small screenshot; verify exact wording against the workbook. Department/team grouping is inferred.',...(warning?[warning]:[]),...(!owner(ownerLabel)?['Group or shared ownership retained as a source label; primary owner needs confirmation.']:[])]};
   const project=projects[`phase${phase[3]}`];
   const data={title,description:`${phase} workstream. Source owner: ${ownerLabel}. Source dates: ${start} → ${end}.`,department,team:ownerLabel==='L&D'?'L&D':'EP Squad',creator,owner:owner(ownerLabel),project,startDate:monthStart(start),dueDate:monthEnd(end),sourceReference};
   await put(Roadmap,key,{...data,phase,kind:milestone?'milestone':'workstream',...(milestone?{dueDate:monthStart(start)}:{}),status});
   await put(Task,`task:${key}`,{...data,priority:'Medium',difficulty:3,status:status==='Complete'?'done':status==='In Progress'?'in_progress':'todo',sourceReference:{...sourceReference,key:`task:${key}`,warnings:[...sourceReference.warnings,'Priority and difficulty were not specified; Medium and 3 are defaults.']}});
  }
  for(const [index,row] of avpRows.entries()) {
   const sourceReference={key:`avp:${index+1}`,file:'avpLook.png',row:index+1,ownerLabel:row.owners,submittedLabel:row.submitted,daysSinceUpdate:row.days,
    warnings:['No deadline or date year is supplied in the screenshot.','Difficulty is not supplied; 3 is a default.',...(row.owners.includes('/')?['Shared source ownership retained as a label; primary owner needs confirmation.']:[])]};
   const task=await put(Task,`task:avp:${index+1}`,{title:row.title,description:row.notes.join('\n'),department,team:'ChatR',creator:directory[row.submitter],owner:owner(row.owners),priority:row.priority,difficulty:3,status:'todo',project:projects.avp,sourceReference});
   await put(Avp,`avp:${index+1}`,{task:task._id,workflowStatus:'ChatR Action Needed',useCaseNeeded:'Unknown',notes:row.notes.map(body=>({author:creator,body})),sourceReference});
  }
  for(const [index,row] of cinemaRows.entries()) {
   const duplicate=cinemaRows.filter(other=>other.number===row.number).length>1;
   const sourceReference={key:`cinema:${index+1}`,file:'cinemaLook.png',row:index+1,number:row.number,ownerLabel:row.owners,
    sowReferences:row.sow?[row.sow]:[],warnings:[
     'No complete approval chain or rubric is supplied. Imported as a draft; notes retain the reported source status.',
     ...(duplicate?['This Cinema number appears on two source rows. Separate internal IDs preserve both requests.']:[]),
     ...(row.sow?['SOW filename is a reference only; the document itself was not provided.']:['No SOW reference was supplied.']),
     ...(!row.owners?['No owner was supplied.']:[]),
    ]};
   await put(Cinema,`cinema:${index+1}`,{title:row.title,description:row.notes,department,team:'StataPile',creator,project:projects[`cinema${index}`],number:`IMPORTED-${keyId(`cinema:${index+1}`)}`,rubric:'Imported source reference. Complete the submission rubric and reviewer list before submitting.',steps:[],status:'draft',priority:'Medium',sourceReference,comments:[{author:creator,body:row.notes}]});
  }
 });
 return summary;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
 if(!process.env.MONGODB_URI)throw new Error('MONGODB_URI is required');
 try {
  await mongoose.connect(process.env.MONGODB_URI,{serverSelectionTimeoutMS:10000});
  const organization=process.env.ORGANIZATION||'amethyst';
  if(!process.argv.includes('--apply'))console.log(JSON.stringify({database:mongoose.connection.name,organization,plan:{directoryEntries:people.length+1,projects:8,tasks:roadmapRows.length+avpRows.length,roadmap:roadmapRows.length,avp:avpRows.length,cinemas:cinemaRows.length},mode:'preview'}));
  else console.log(JSON.stringify({database:mongoose.connection.name,organization,...await seedScreenshots(organization)}));
 } catch(error) { console.error(`Screenshot import failed (${error.name}). No credentials were printed.`);process.exitCode=1; }
 finally {await mongoose.disconnect();}
}
