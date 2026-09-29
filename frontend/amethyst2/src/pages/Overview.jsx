import { useState } from 'react';
import { useResource } from '../lib/useResource';
import Feedback from '../features/shared/Feedback';
import { RecordDetail } from '../features/workspace/Records';
import { date } from '../features/workspace/helpers';
export default function Overview({q,user,members,projects}) {
 const [summaryIndex, setSummaryIndex] = useState(0);
 const [department,setDepartment]=useState(''),[team,setTeam]=useState(''),[project,setProject]=useState(''),[selected,setSelected]=useState(null);
 const resource=useResource(`/overview?${new URLSearchParams({q,department,team,project})}`),o=resource.data;
 return <><div className="toolbar"><label>Department<input value={department} onChange={e=>setDepartment(e.target.value)} placeholder="All departments"/></label><label>Team<input value={team} onChange={e=>setTeam(e.target.value)} placeholder="All teams"/></label><label>Project<select value={project} onChange={e=>setProject(e.target.value)}><option value="">All projects</option>{projects.map(p=><option key={p._id} value={p._id}>{p.title}</option>)}</select></label></div><Feedback loading={resource.loading} error={resource.error}/>{o&&<><div className="stats">{[['Unfinished tasks',o.active,'◈'],['Overdue',o.overdue,'◷'],['Need help',o.blocked,'⊘'],['Need an owner',o.unowned,'♙']].map(([label,value,icon])=><section key={label}><span>{label}<b>{icon}</b></span><strong>{value}</strong><small>Matching your filters</small></section>)}</div><section className="overview-carousel" role="region" aria-roledescription="carousel" aria-label="Work summaries">
 <div className="overview-carousel-controls"><button aria-label="Previous summary" onClick={()=>setSummaryIndex(index=>(index+1)%2)}>← Previous</button><div className="overview-carousel-tabs">{['This week','This month'].map((label,index)=><button key={label} aria-pressed={summaryIndex===index} aria-controls="overview-summary-slide" onClick={()=>setSummaryIndex(index)}>{label}</button>)}</div><button aria-label="Next summary" onClick={()=>setSummaryIndex(index=>(index+1)%2)}>Next →</button></div>
 <p className="overview-slide-count" role="status">{summaryIndex+1} of 2 · {summaryIndex===0?'Next 7 days':'Next 30 days'}</p>
 <div id="overview-summary-slide" role="group" aria-roledescription="slide" aria-label={`${summaryIndex+1} of 2: ${summaryIndex===0?'This week':'This month'}`}><OverviewSummary key={summaryIndex} period={summaryIndex===0?'weekly':'monthly'} summary={o[summaryIndex===0?'weekly':'monthly']} onOpen={setSelected} /></div>
 </section><div className="section-heading"><h2>Projects at a glance</h2><small>Progress based on completed tasks</small></div><div className="card-grid">{o.projects.map(p=><section className="panel" key={p._id}><span className={`badge ${p.priority}`}>{p.priority}</span><h3>{p.title}</h3><p>{p.department} · {p.team||'All teams'}</p><progress max="100" value={p.progress}/><div className="card-meta"><span>{p.completed} of {p.taskCount} tasks complete</span><strong>{p.progress}%</strong></div><dl className="overview-project-status"><div><dt>Past deadline</dt><dd>{p.overdue}</dd></div><div><dt>Need help</dt><dd>{p.blocked}</dd></div><div><dt>Need an owner</dt><dd>{p.unowned}</dd></div></dl></section>)}</div><p className="muted">{o.method} · Updated {new Date(o.generatedAt).toLocaleString()}</p></>}{selected&&<RecordDetail kind="tasks" id={selected} user={user} members={members} projects={projects} onClose={()=>setSelected(null)} refresh={resource.refresh}/>}</>;
}


function OverviewSummary({ period, summary, onOpen }) {
  const [expanded, setExpanded] = useState(false);
  const tasks = expanded ? summary.sources : summary.sources.slice(0, 3);
  const sentences = summary.text.match(/[^.!?]+[.!?]*/g) || [summary.text];
  return <section className="panel overview-summary">
    <header><span className="eyebrow">{period === 'weekly' ? 'NEXT 7 DAYS' : 'NEXT 30 DAYS'}</span><h2>{period === 'weekly' ? 'This week’s focus' : 'This month’s focus'}</h2></header>
    <div className="overview-snapshot" aria-label="Summary">{sentences.map((sentence, index) => <p key={index}>{sentence.trim()}</p>)}</div>
    {summary.actions?.length > 0 && <section className="overview-next"><h3>Next steps</h3><ul>{summary.actions.map(action => {
      const split = action.indexOf('. ');
      return <li key={action}>{split < 0 ? action : <details><summary>{action.slice(0, split + 1)}</summary><p>{action.slice(split + 2)}</p></details>}</li>;
    })}</ul></section>}
    {summary.sources.length > 0 && <section className="overview-task-section"><h3>Priority tasks <span>{summary.sources.length}</span></h3><div className="focus-list">{tasks.map((task, index) => <button key={task._id} onClick={() => onOpen(task._id)}><span className="rank">{String(index + 1).padStart(2, '0')}</span><span className="overview-task-copy"><strong>{task.title}</strong><small>{task.department}</small><small>{task.dueDate ? `Due ${date(task.dueDate)}` : 'Needs a deadline'}</small></span><span className={`badge ${task.priority}`}>{task.priority}</span></button>)}</div>{summary.sources.length > 3 && <button className="overview-expand" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer tasks' : `Show ${summary.sources.length - 3} more tasks`}</button>}</section>}
  </section>;
}
