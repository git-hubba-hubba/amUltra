# Amethyst department workspace

A React workspace backed by Express and MongoDB. Authentication is required. Members can read workspace records, create work in their department, claim unowned tasks, and comment. All signed-in members can read content across departments in their organization immediately. Administrators approve project-specific management rights from the profile page. These grants allow a member to manage the selected project and its linked tasks, roadmap, intake, meetings, and Cinema work without changing their account role. The bootstrapped administrator retains workspace-wide administration; existing department administrators approve grants within their department.

## Run locally

Use Node.js 22.13+ and a MongoDB replica set (or MongoDB Atlas). Replica-set support is required for atomic spreadsheet approvals and transcript processing.

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `MONGODB_URI`, `ADMIN_EMAIL`, and a unique `ADMIN_PASSWORD` of at least 12 characters. Set `ORGANIZATION` for your workspace.
3. Install dependencies with `npm ci --prefix backend` and `npm ci --prefix frontend/amethyst2`.
4. From `backend`, run `npm run bootstrap` once. Remove `ADMIN_PASSWORD` from `.env` afterward.
5. From the repository root, run `npm run dev` to start both the API and frontend, then open http://localhost:5173.
6. To run them separately, use `npm run dev:backend` and `npm run dev:frontend` in separate terminals. Both must be running for login to work.

Vite forwards `/api` to port 4000. Sign in using the bootstrapped administrator. Other users can sign up and log in immediately. Existing pending accounts become active on their next authenticated visit. New signups cannot choose admin privileges. In **Profile → Requests → Project admin access**, members request rights for a project; administrators approve or deny requests, grant rights directly to a member, or revoke existing grants. Members use **Refresh access** to see newly approved rights while logged in. Approvals never change the member’s account role.

## Frontend structure

The crystal landing opens authentication, which renders the original `components/Dashboard.jsx`. The original `Nav`, `LeftBar`, `SideTab`, `TaskHolder`, `Tasks`, and `Profile` components own the interface. Existing image URLs are retained. API-backed forms, dialogs, and review components are embedded in those containers. The layout keeps the black background, blue main-content border, top icon navigation, left navigation, and wide task cards.


## Automation boundaries

Transcript summaries use keyword-based extraction, and overview statements use deterministic rules. No external language-model service or direct SharePoint connection is configured. Transcript suggestions and incomplete spreadsheet rows require human review. Complete authorized spreadsheet rows publish automatically. Uploaded files and transcript text are data, not executable instructions.

Deletion archives records. Task/project/roadmap deletion requires an approved administrator for the linked project or an existing workspace/department administrator; members can delete their own events, meetings, and topics. Task ownership is claimed atomically; concurrent edits reject stale versions. All API reads and writes are organization-scoped. Project grants are loaded on every authenticated API request, so revocation applies to subsequent requests without logging out. Moving work between projects requires management rights over both scopes. Unlinked work still requires workspace/department administration for restricted actions. Project managers cannot grant themselves access to other projects or create unrelated projects.

## Verification

```sh
npm run lint --prefix frontend/amethyst2
npm run build --prefix frontend/amethyst2
npm test --prefix backend
```

The integration suite starts a temporary MongoDB replica set and may download a MongoDB binary on its first run. It covers authentication, department permissions, organization isolation, claim races, stale edits, intake transactions, approval order/handoffs, calendar overlap, project summaries, transcript proposals, immediate signup access, project-specific grants, revocation, and cross-project permission boundaries.


## Jade ecosystem

Jade is a separate password-locked sidebar workspace. Its system typography and jade-green light/dark profiles apply only while Jade is open; Amethyst retains its existing palette and appearance. Existing organization isolation and account permissions remain intact. Workspace/department admins initiate runs, provide human feedback, and approve finished Manager iterations. Project-specific grants alone do not authorize autonomous Jade runs. User assignments are limited to active, login-enabled users in the run's department.

Supply the business goal, business case, success metrics, implementation constraints, relevant AT&T Call Center/Sales/FirstNet references, and team capabilities when uploading. Jade does not assume access to internal AT&T policy or financial datasets. Configure `ANTHROPIC_API_KEY` in the backend environment. `JADE_MODEL` defaults to `claude-opus-5-5`. Credentials never enter the frontend. Claude's Messages API uses structured outputs, bounded requests, local schema checks, and source-reference validation. No external-action tools are enabled.

The workflow is: Files (Translate → Store → Analyze → Rank), Metrics, Projects, Meetings → Context Check A/B → Admin Context package → Assistant-raised items/notifications → Manager delegation → assigned worker analysis → A/B verification → finished Manager viability review → **admin approval to the Board** → independent Finance, Governance, and Scale statements → executive PDF. The Manager evaluates company success metrics, implementation viability, oversights, vulnerabilities, and hallucinations. It can return feedback to the Assistant, naming a worker; this starts a new worker iteration with the feedback included. Automatic revision cycles are bounded by `JADE_MAX_MANAGER_ITERATIONS` (operational default: 3), after which human feedback is required; human feedback resets that counter. Older output revisions remain stored.

Failed checks go to the **human-review queue**, rather than being silently omitted and advanced. After feedback, processing restarts with the workers. Missing critical context also requests human feedback. A finished Manager iteration always waits for an authorized admin's approve/deny decision before Board processing. Stale or repeated decisions reject with a conflict. Board agents consume the same approved Manager/verified context independently, without reading one another's output. The presentation compiler subsequently combines all three statements.

Rank is based solely on explicitly communicated deadlines, dates, or timelines. Exact temporal evidence is retained. `rank`/`importanceRank` is 1 when such evidence exists and 0 otherwise; ties retain original order. This is a presence ranking, not an invented Critical threshold or a fabricated chronological ordering. Business severity remains separate from temporal rank. Assistant action items are raised work, not approval/denial decision outcomes.

MongoDB is the system of record, with **change streams** waking durable run handoffs through the StateBus adapter. Transactions and atomic leases reject duplicate/stale publication. Startup draining, reconnect draining, and a 30-second recovery sweep handle missed wakeups and expired leases; normal handoffs use change streams. MongoDB replica-set/sharded support is required. Agents retain separate output collections, source references, input-record IDs, model identifiers, revisions, and decision history. Provider failures can be explicitly retried. Text quotations are checked against extracted source text; PDF/image verification is an AI comparison with the original supplied material, not an independent accuracy guarantee.

Manager assignments to users create real Amethyst tasks after successful completion. Worker assignments execute analysis within Jade. Jade does not contact customers, send messages, spend money, deploy systems, or claim those external actions were accomplished. PDF export includes independent Board statements, evidence, limitations, and delegation information. Financial figures require source support; compliance output assesses supplied authorization/security/policy requirements rather than certifying compliance.

Supported uploads: PDF, DOCX text, TXT/MD, CSV/XLSX, VTT/SRT, PNG/JPEG/WebP/GIF, MP3/WAV/M4A, and MP4/MOV/WebM. Limits: three inputs plus three references, 8 MB per file/10 MB combined, 300,000 extracted characters per source, 5,000 spreadsheet rows. DOCX embedded images are not analyzed; spreadsheet formulas use stored results. Audio/video requires an OpenAI-compatible transcription endpoint via `JADE_TRANSCRIPTION_URL`, its actual `JADE_TRANSCRIPTION_MODEL`, and optional `JADE_TRANSCRIPTION_KEY`. Reasoning remains on Opus. `ffmpeg-static` supplies FFmpeg; `JADE_FFMPEG_PATH` can override it. Recordings longer than ten minutes are rejected. Video uses up to twenty sampled frames across its duration, with the coverage limitation retained. Transcription and sampling do not constitute full visual verification of every scene.

Jade's separate access password is checked against a backend-only salted scrypt hash. Unlocking grants access to the current authenticated session for at most eight hours or the remaining session lifetime. **Lock Jade** revokes that session's access; new login sessions require unlocking again. Every Jade data/upload/decision/PDF route enforces the lock and existing permissions. Attempts are rate-limited. Optional `JADE_PASSWORD_HASH` overrides the default. Locking access does not cancel previously authorized background work.

### Resolved specification decisions

| Item | Implemented interpretation |
| --- | --- |
| O1 | Autonomous Board agents; no Scale-to-peer orchestration. |
| O2 | Assistant feeds Manager; Manager feedback returns through Assistant to a designated worker. |
| O3 | Admin approves finished Manager iterations to advance to Board. |
| O4 | Failed verification queues human review; feedback restarts workers. |
| O5 | A checks Files/Metrics; B checks Projects/Meetings, including delegated results. |
| O6 | Completion arrow represents state flow; no additional feature. |
| O7 | Rank depends only on communicated deadlines/dates/timelines. |
| O8 | Projects/Meetings produce synopses identifying work vs notifications for Assistant. |
| O9 | Finance summarizes applicable costs; Scale scopes the project idea; Governance assesses execution authorization, approval, compliance, and security. |
| O10 | Internal label ignored; no audience field added. |
| O11 | Assistant raises action items. |
| O12 | Verification uses supplied AT&T Call Center/Sales/FirstNet business case and original sources. |
| O13 | MongoDB change streams with durable checkpoints and recovery. |
| O14 | Claude Opus 5.5 integration; existing authentication/ODM/hosting structure retained. |
| O15 | Manager vets company success metrics and implementation viability. |
| O16 | Oversights/vulnerabilities/hallucinations trigger Manager-directed worker revision. |

Tests use real temporary MongoDB replica sets and controlled model/transcription responses. They cover the end-to-end pipeline/PDF/tasks, password protection, review/approval gates, Manager feedback, A/B verification, source/rank validation, independent Board inputs, change streams, concurrent consumers, and lease recovery. These tests do not establish live provider access; a live run requires credentials and source materials.

The Jade Ecosystem view displays the Board, Manager/Assistant, workers, separate Context Check A/B, and Admin Context Check as an interactive execution map. The selected analysis streams MongoDB changes through a session-protected server-sent events endpoint. Executing agents glow; completed outputs, human review, and failures have separate states. Clicking a node opens its recorded outputs. If the stream disconnects, the interface identifies reconnection and retains periodic refresh as a fallback. Reduced-motion preferences disable pulsing and arrow animation.
