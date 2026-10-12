import { agentState } from '../lib/jadeExecution';

const nodes = [
  ['finance', 'Finance', 'Cost executive summary', 8, 50, 23, 90],
  ['scale', 'Scale', 'Scope of scale · presentation', 38.5, 50, 23, 90],
  ['compliance_governance', 'Compliance / Governance', 'Authorization · compliance · security', 69, 50, 23, 90],
  ['manager', 'Manager', 'Vets viability · delegates · returns feedback', 18, 300, 26, 95],
  ['files', 'Files', 'Translate · store · analyze · rank', 5, 510, 20, 85],
  ['metrics', 'Metrics', 'Quantitative evidence', 28.5, 510, 20, 85],
  ['projects', 'Projects', 'Proposal synopsis · tasks & notifications', 52, 510, 20, 85],
  ['meetings', 'Meetings', 'Transcript synopsis · tasks & notifications', 75.5, 510, 20, 85],
  ['context_check_1', 'Context Check A', 'Verifies Files & Metrics', 10, 650, 35, 85],
  ['context_check_2', 'Context Check B', 'Verifies Projects & Meetings', 55, 650, 35, 85],
  ['admin_context_check', 'Admin Context Check', 'Formats verified state for Assistant', 34, 815, 32, 85],
];
const connections = [
  ['manager', 'M600 315H440'],
  ['assistant', 'M440 365H600'],
  ['files', 'M310 395V480H150V510'],
  ['metrics', 'M310 480H385V510'],
  ['projects', 'M310 480H620V510'],
  ['meetings', 'M620 480H855V510'],
  ['context_check_1', 'M150 595V625H275V650'],
  ['context_check_1', 'M385 595V625H275'],
  ['context_check_2', 'M620 595V625H725V650'],
  ['context_check_2', 'M855 595V625H725'],
  ['admin_context_check', 'M275 735V775H500V815'],
  ['admin_context_check', 'M725 735V775H500'],
  ['assistant', 'M660 860H970V440H770V415'],
  ['approval', 'M310 300V270'],
  ['finance', 'M310 210V180H195V140'],
  ['scale', 'M310 180H500V140'],
  ['compliance_governance', 'M500 180H805V140'],
];
const symbols = {
  finance: ['M12 3v18', 'M17 6H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H6'],
  scale: ['M4 16l6-6 4 4 6-10', 'M15 4h5v5'],
  compliance_governance: ['M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z', 'M8 12l3 3 5-6'],
  manager: ['M4 6h16v5H4z', 'M12 11v5M5 16h14M5 16v5M12 16v5M19 16v5'],
  files: ['M6 3h8l4 4v14H6z', 'M14 3v5h4M9 12h6M9 16h6'],
  metrics: ['M4 20h16M7 16v-5M12 16V5M17 16V8'],
  projects: ['M3 7h7l2-3h9v16H3z'],
  meetings: ['M3 4h18v13H9l-5 4v-4H3z', 'M7 8h10M7 12h7'],
  context_check_1: ['M4 4h16v16H4z', 'M7 12l3 3 7-7'],
  context_check_2: ['M4 4h16v16H4z', 'M7 12l3 3 7-7'],
  admin_context_check: ['M6 4h12v17H6z', 'M9 4V2h6v2M9 12l2 2 4-5'],
  approval: ['M4 4h16v16H4z', 'M7 12l3 3 7-7'],
  assistant: ['M5 7h14v13H5z', 'M12 3v4M8 11v2M16 11v2M9 16h6'],
  notifications: ['M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z', 'M10 21h4'],
  action_items: ['M9 5h12M9 12h12M9 19h12M3 4l1 1 2-2M3 11l1 1 2-2M3 18l1 1 2-2'],
};
function AgentSymbol({ role }) {
  return <span className="jade-agent-symbol" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{symbols[role].map((d, index) => <path key={index} d={d} />)}</svg>{role.startsWith('context_check_') && <b>{role.endsWith('1') ? 'A' : 'B'}</b>}</span>;
}
const position = (left, top, width, height) => ({ left: `${left}%`, top: `${top / 950 * 100}%`, width: `${width}%`, height: `${height / 950 * 100}%` });
const stateLabels = { idle: 'Waiting', running: 'Executing', completed: 'Complete', review: 'Needs review', failed: 'Failed' };
export default function JadeEcosystem({ run, records, connected, selectedAgent, onSelect, onReview }) {
  const state = role => agentState(role, run, records);
  const approval = run?.status === 'awaiting_approval' ? 'review' : run?.step >= 19 && run?.status !== 'denied' ? 'completed' : 'idle';
  const assistantItems = records.find(record => record.stage === 'assistant' && record.revision === run?.revision)?.data.items || [];
  const node = (role, title, subtitle, left, top, width, height) => <button key={role} className={`jade-map-node is-${state(role)}`} style={position(left, top, width, height)} title={`${title} · ${subtitle}`} aria-label={`${title}: ${stateLabels[state(role)]}`} aria-pressed={selectedAgent === role} onClick={() => onSelect(role)}>
    <span className="jade-node-state"><i aria-hidden="true" />{<span className="jade-state-text">{stateLabels[state(role)]}</span>}</span><AgentSymbol role={role} /><strong className="jade-node-label">{title}</strong>
  </button>;
  return <div className="jade-ecosystem">
    <div className="jade-map-heading"><span className={`jade-live ${connected ? 'is-connected' : ''}`}><i aria-hidden="true" />{!run ? 'No analysis selected' : connected ? 'Live execution' : 'Reconnecting · periodic updates'}</span></div>
    <div className="jade-map-legend" aria-label="Execution states">{['idle', 'running', 'completed', 'review', 'failed'].map(value => <span key={value} className={`is-${value}`}><i aria-hidden="true" />{stateLabels[value]}</span>)}</div>
    <div className="jade-map-scroll" tabIndex={0} role="region" aria-label="Jade ecosystem flow diagram">
      <div className="jade-map-canvas">
        <div className="jade-map-tier jade-map-board"><h3>Board</h3></div>
        <div className="jade-map-tier jade-map-management"><h3>Management</h3></div>
        <div className="jade-map-tier jade-map-workers"><h3>Workers & verification</h3></div>
        <svg className="jade-map-connectors" viewBox="0 0 1000 950" preserveAspectRatio="none" aria-hidden="true">
          <defs><marker id="jade-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke" /></marker></defs>
          {connections.map(([role, d], index) => <path key={index} d={d} markerEnd="url(#jade-arrow)" className={state(role) === 'running' || role === 'approval' && approval === 'review' ? 'is-flowing' : ''} />)}
        </svg>
        {nodes.map(values => node(...values))}
        <button className={`jade-map-node jade-map-approval is-${approval}`} style={position(19, 210, 24, 60)} aria-label={`Admin approval: ${stateLabels[approval]}`} title="Admin approval" onClick={onReview}><AgentSymbol role="approval" /><strong className="jade-node-label">Admin approval</strong><small className="jade-node-label">{approval === 'review' ? 'Needs approval' : approval === 'completed' ? 'Approved' : 'Waiting'}</small></button>
        <div className={`jade-map-assistant is-${state('assistant')}`} style={position(60, 215, 34, 200)}>
          <button className="jade-assistant-title" aria-label={`Assistant: ${stateLabels[state('assistant')]}`} title="Assistant" aria-pressed={selectedAgent === 'assistant'} onClick={() => onSelect('assistant')}><AgentSymbol role="assistant" /><strong className="jade-node-label">Assistant</strong><span className="jade-node-state"><i aria-hidden="true" /><span className="jade-state-text">{stateLabels[state('assistant')]}</span></span></button>
          <button aria-label={`Notifications: ${assistantItems.filter(item => item.kind === 'notification').length} recorded`} title="Notifications" onClick={() => onSelect('assistant')}><AgentSymbol role="notifications" /><strong className="jade-node-label">Notifications</strong><span>{assistantItems.filter(item => item.kind === 'notification').length}<span className="jade-node-label"> recorded</span></span></button>
          <button aria-label={`Action items: ${assistantItems.filter(item => item.kind === 'action_item').length} recorded`} title="Action items" onClick={() => onSelect('assistant')}><AgentSymbol role="action_items" /><strong className="jade-node-label">Action items</strong><span>{assistantItems.filter(item => item.kind === 'action_item').length}<span className="jade-node-label"> recorded</span></span></button>
        </div>

      </div>
    </div>
    <p className="jade-map-announcement" role="status" aria-live="polite">{run?.status === 'running' ? `Executing: ${nodes.find(node => node[0] === run.currentAgent)?.[1] || 'Assistant'}.` : run?.status === 'awaiting_approval' ? 'Waiting for admin approval before Board analysis.' : run?.status === 'completed' ? 'Analysis complete. Executive PDF is ready.' : run?.status === 'failed' ? 'Execution stopped. Review the error before retrying.' : ['needs_context', 'needs_review'].includes(run?.status) ? 'Execution paused for human feedback.' : run?.status === 'queued' ? 'Queued for the next execution stage.' : run?.status === 'denied' ? 'This analysis was denied.' : 'Ready for your first analysis.'}</p>
  </div>;
}
