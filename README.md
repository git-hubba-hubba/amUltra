# Amethyst department workspace

A React workspace backed by Express and MongoDB. Authentication is required. Members can read workspace records, create work in their department, claim unowned tasks, and comment. All signed-in members can read content across departments in their organization immediately. Administrators approve project-specific management rights from the profile page. These grants allow a member to manage the selected project and its linked tasks, roadmap, intake, meetings, and Cinema work without changing their account role. The bootstrapped administrator retains workspace-wide administration; existing department administrators approve grants within their department.

## Run locally

Use Node.js 22.13+ and a MongoDB replica set (or MongoDB Atlas). Replica-set support is required for atomic spreadsheet approvals and transcript processing.

1. Copy `backend/.env.example` to `backend/.env`.
2. Set `MONGODB_URI`, `ADMIN_EMAIL`, and a unique `ADMIN_PASSWORD` of at least 12 characters. Set `ORGANIZATION` for your workspace.
3. Install dependencies with `npm ci --prefix backend` and `npm ci --prefix frontend/amethyst2`.
4. From `backend`, run `npm run bootstrap` once. Remove `ADMIN_PASSWORD` from `.env` afterward.
5. From `backend`, run `npm run dev`.
6. From `frontend/amethyst2`, run `npm run dev` and open http://localhost:5173.

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

For deployment, serve the built frontend and `/api` under the same HTTPS origin, set `NODE_ENV=production` and `APP_ORIGIN`, and use a persistent MongoDB replica set. Database connection credentials belong in environment configuration.

## Screenshot reference data

`backend/data/expert-path-screenshots.js` transcribes the supplied AVP, Cinema, and EP roadmap screenshots. `npm run import:screenshots` from `backend` previews the target; `npm run import:screenshots -- --apply` inserts missing source records. Stable IDs make reruns safe and preserve subsequent edits.

Mapping: 40 roadmap workstreams become Roadmap entries and linked Tasks, eight AVP rows become Tasks plus AVP records, four Cinema rows become draft Cinema requests and project records, and the three EP phases plus the AVP tracker provide the remaining project groupings. The 27 named people are directory profiles with login disabled; an extra technical profile attributes imported source notes. Department grouping uses the roadmap’s Business Care & Sales label, with team labels from the screenshots. Individual departments remain Unspecified.

Each record retains its source file/row, original owner labels, and ambiguity notes. Month-only roadmap dates use month boundaries for chart rendering. AVP dates with no year remain labels and missing deadlines remain unset. The duplicated source Cinema number is retained on both rows with distinct internal IDs. Referenced SOW filenames are shown as unavailable attachments; no document is fabricated. Cinema approval steps must be configured with real login accounts before submission.
