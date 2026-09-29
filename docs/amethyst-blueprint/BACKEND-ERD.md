# Backend ERD

Proposed logical relational model. This is a schema specification, not an executed migration. UUID primary keys, organization scope, created_at/updated_at and optimistic version fields apply to business records unless noted. Nullable links are indicated below. Authentication secrets belong to the authentication provider, not these business tables.

## Core work

```mermaid
erDiagram
 ORGANIZATION ||--o{ MEMBERSHIP : contains
 USER ||--o{ MEMBERSHIP : joins
 ORGANIZATION ||--o{ DEPARTMENT : contains
 DEPARTMENT ||--o{ TEAM : contains
 MEMBERSHIP ||--o{ DEPARTMENT_MEMBER : has
 DEPARTMENT ||--o{ DEPARTMENT_MEMBER : includes
 TEAM ||--o{ TEAM_MEMBER : includes
 MEMBERSHIP ||--o{ TEAM_MEMBER : has
 DEPARTMENT ||--o{ PROJECT : manages
 TEAM o|--o{ PROJECT : delivers
 PROJECT o|--o{ TASK : groups
 DEPARTMENT ||--o{ TASK : manages
 MEMBERSHIP o|--o{ TASK : owns
 TASK ||--o{ TASK_CONTRIBUTOR : includes
 MEMBERSHIP ||--o{ TASK_CONTRIBUTOR : contributes
 TASK ||--o{ ACTION_ITEM : contains
 TASK ||--o{ TASK_DEPENDENCY : dependent
 TASK ||--o{ TASK_DEPENDENCY : prerequisite
 TASK ||--o{ TASK_ASSIGNMENT_HISTORY : records
 PROJECT ||--o{ ROADMAP_PHASE : groups
 ROADMAP_PHASE ||--o{ ROADMAP_ITEM : schedules
 TASK o|--o{ ROADMAP_ITEM : links
 ROADMAP_ITEM ||--o{ ROADMAP_DEPENDENCY : successor
 ROADMAP_ITEM ||--o{ ROADMAP_DEPENDENCY : predecessor
 PROJECT o|--o{ EVENT : relates
 TASK o|--o{ EVENT : relates
 EVENT ||--o{ EVENT_ATTENDEE : invites
 MEMBERSHIP ||--o{ EVENT_ATTENDEE : attends
 ORGANIZATION { uuid id PK string name string timezone }
 USER { uuid id PK string auth_subject UK string email string display_name }
 MEMBERSHIP { uuid id PK uuid organization_id FK uuid user_id FK string role string status }
 DEPARTMENT { uuid id PK uuid organization_id FK string name string timezone }
 DEPARTMENT_MEMBER { uuid department_id PK,FK uuid membership_id PK,FK string role }
 TEAM { uuid id PK uuid department_id FK string name }
 TEAM_MEMBER { uuid team_id PK,FK uuid membership_id PK,FK }
 PROJECT { uuid id PK uuid department_id FK uuid team_id FK uuid owner_id FK string title string description string priority string status date start_date date target_date int featured_position }
 TASK { uuid id PK uuid department_id FK uuid project_id FK uuid owner_id FK uuid creator_id FK string title string description string status string priority int difficulty datetime due_at datetime submitted_at datetime completed_at datetime archived_at int version }
 TASK_CONTRIBUTOR { uuid task_id PK,FK uuid membership_id PK,FK }
 ACTION_ITEM { uuid id PK uuid task_id FK uuid owner_id FK string title string details datetime due_at datetime completed_at }
 TASK_DEPENDENCY { uuid task_id PK,FK uuid prerequisite_task_id PK,FK }
 TASK_ASSIGNMENT_HISTORY { uuid id PK uuid task_id FK uuid previous_owner_id FK uuid new_owner_id FK uuid actor_id FK string reason datetime occurred_at }
 ROADMAP_PHASE { uuid id PK uuid project_id FK string label string color int position }
 ROADMAP_ITEM { uuid id PK uuid phase_id FK uuid task_id FK uuid owner_id FK string title string kind date start_date date end_date string status int position }
 ROADMAP_DEPENDENCY { uuid item_id PK,FK uuid prerequisite_item_id PK,FK }
 EVENT { uuid id PK uuid creator_id FK uuid project_id FK uuid task_id FK string title string description string location datetime starts_at datetime ends_at string timezone boolean all_day }
 EVENT_ATTENDEE { uuid event_id PK,FK uuid membership_id PK,FK string response }
```

## Intake, meetings and agent output

```mermaid
erDiagram
 FILE_ASSET ||--o{ IMPORT_BATCH : supplies
 IMPORT_BATCH o|--o{ TASK_PROPOSAL : produces
 MEETING o|--o{ TASK_PROPOSAL : produces
 MEETING ||--o{ TRANSCRIPT : contains
 FILE_ASSET ||--o{ TRANSCRIPT : stores
 MEETING ||--o{ MEETING_ATTENDEE : includes
 TASK_PROPOSAL ||--o{ PROPOSAL_REVIEW : records
 TASK_PROPOSAL o|--o| TASK : publishes
 AGENT_RUN o|--o{ TASK_PROPOSAL : drafts
 AGENT_RUN ||--o{ GENERATED_DOCUMENT : generates
 GENERATED_DOCUMENT ||--o{ GENERATED_SOURCE : cites
 FILE_ASSET { uuid id PK uuid uploader_id FK string object_key string filename string media_type string checksum string scan_status bigint size_bytes }
 IMPORT_BATCH { uuid id PK uuid file_id FK uuid department_id FK uuid uploader_id FK string status json mapping string sheet_name string idempotency_key }
 MEETING { uuid id PK uuid department_id FK uuid project_id FK uuid creator_id FK string title datetime held_at string notes }
 MEETING_ATTENDEE { uuid meeting_id PK,FK uuid membership_id PK,FK }
 TRANSCRIPT { uuid id PK uuid meeting_id FK uuid file_id FK string extracted_text int revision }
 TASK_PROPOSAL { uuid id PK uuid import_batch_id FK uuid meeting_id FK uuid agent_run_id FK uuid department_id FK uuid published_task_id FK json raw_source json normalized_task json warnings string source_locator string status decimal confidence int version }
 PROPOSAL_REVIEW { uuid id PK uuid proposal_id FK uuid reviewer_id FK string decision string reason json before_after datetime reviewed_at }
 AGENT_RUN { uuid id PK uuid requested_by_id FK string purpose string status string model_config json input_versions string idempotency_key string error datetime started_at datetime finished_at }
 GENERATED_DOCUMENT { uuid id PK uuid agent_run_id FK uuid meeting_id FK uuid department_id FK uuid project_id FK string kind date period_start date period_end string body string review_status boolean stale }
 GENERATED_SOURCE { uuid id PK uuid document_id FK uuid task_id FK uuid project_id FK uuid transcript_id FK int source_version string source_locator }
```

A proposal has exactly one origin: import batch or meeting. Its published_task_id is nullable and unique. Each approved proposal creates exactly one task transactionally. Confidence is advisory. Store transcript excerpts or row coordinates in source_locator/raw_source; never discard originals. GENERATED_SOURCE has exactly one non-null source FK. Timeline drafts can use structured JSON payloads on GENERATED_DOCUMENT, validated before creating roadmap records. Job/run retries use unique organization-scoped idempotency keys.

## Cinema, AVP and discussion

```mermaid
erDiagram
 PROJECT o|--o{ CINEMA : proposes
 CINEMA ||--o{ CINEMA_TASK : links
 TASK ||--o{ CINEMA_TASK : submits
 CINEMA ||--o{ REVIEW_ROUND : versions
 REVIEW_ROUND ||--o{ REVIEW_STEP : orders
 REVIEW_STEP ||--o{ REVIEW_EVENT : records
 CINEMA ||--o{ SOW_VERSION : attaches
 FILE_ASSET ||--o{ SOW_VERSION : stores
 TASK ||--o| AVP_ITEM : tracks
 CINEMA o|--o{ AVP_ITEM : references
 AVP_ITEM ||--o{ AVP_NOTE : records
 PROJECT o|--o{ TOPIC : contextualizes
 TOPIC o|--o{ COMMENT : discusses
 TASK o|--o{ COMMENT : discusses
 CINEMA o|--o{ COMMENT : discusses
 COMMENT o|--o{ COMMENT : replies
 CINEMA { uuid id PK uuid department_id FK uuid project_id FK uuid submitter_id FK uuid coordinator_id FK string external_number string title string description string status string execution_status }
 CINEMA_TASK { uuid cinema_id PK,FK uuid task_id PK,FK }
 REVIEW_ROUND { uuid id PK uuid cinema_id FK int round_number json rubric_snapshot json rubric_answers string status datetime submitted_at }
 REVIEW_STEP { uuid id PK uuid round_id FK uuid reviewer_id FK int position string label boolean required string status datetime decided_at }
 REVIEW_EVENT { uuid id PK uuid step_id FK uuid actor_id FK uuid from_reviewer_id FK uuid to_reviewer_id FK string event_type string reason datetime occurred_at }
 SOW_VERSION { uuid id PK uuid cinema_id FK uuid file_id FK int version_number uuid uploaded_by_id FK }
 AVP_ITEM { uuid id PK uuid task_id FK uuid cinema_id FK string workflow_status string use_case_needed datetime substantive_updated_at }
 AVP_NOTE { uuid id PK uuid avp_item_id FK uuid author_id FK string body datetime created_at }
 TOPIC { uuid id PK uuid project_id FK uuid author_id FK string title string body string category datetime archived_at }
 COMMENT { uuid id PK uuid topic_id FK uuid task_id FK uuid cinema_id FK uuid parent_id FK uuid author_id FK string body datetime edited_at datetime archived_at }
```

## Supporting records and database constraints

- `AUDIT_EVENT(id, organization_id, actor_id, entity_type, entity_id, action, before_json, after_json, occurred_at)` is append-only. Entity identity is descriptive audit metadata, not a substitute for domain FKs.
- `ATTACHMENT(id, organization_id, file_id FK, task_id FK NULL, project_id FK NULL, event_id FK NULL)` uses exactly one non-null target. Cinema SOWs and transcripts use their explicit tables.
- `NOTIFICATION(id, organization_id, recipient_id FK, event_key, body, read_at)` and transactional `OUTBOX_EVENT(id, organization_id, event_key UNIQUE, payload, delivered_at)` support reliable in-app updates. External email delivery is a separately configured feature.
- `INVITATION(id, organization_id, department_id FK, email, token_hash, expires_at, accepted_at, invited_by_id FK)` stores hashed single-use tokens. Role changes require authorized admin commands.
- Organization-scoped composite foreign keys `(organization_id, id)` prevent cross-organization relationships, including ownership, files, comments and review handoffs. Every domain FK must use this scope; the diagrams omit repeated organization_id fields for readability.
- Unique `(organization_id,user_id)` memberships, `(project_id,featured_position)` for non-null featured positions 1–3, `(cinema_id,round_number)`, `(round_id,position)`, `(cinema_id,version_number)`, and `AVP_ITEM.task_id`. Cinema external numbers may be duplicated in imported references; use internal UUID identity and flag duplicates for review.
- `difficulty BETWEEN 1 AND 5`; enum/check constraints on priority and lifecycle states; date end >= start; event end > start; milestone start=end; required titles nonempty. Allow task due_at/owner_id and project links to be null where indicated in the brief.
- Roadmap task-linked dates must be synchronized through one service with a documented date-to-timezone conversion; reject edits that conflict with dependencies. Unlinked workstreams retain their own dates. Detect cycles transactionally for task and roadmap dependencies.
- COMMENT has exactly one topic/task/cinema target; parent must have the same target and organization. Enforce in transaction/trigger, not just the UI.
- Claim uses a conditional update where owner_id IS NULL and task is active; one concurrent claimant succeeds. Assignment, publication and review decisions lock/check current version before changing state.
- Index tasks by `(organization_id,owner_id,status,due_at)`, `(organization_id,department_id,priority,due_at)`; projects by scope/priority/date; meetings by held_at; events by time range; proposals by department/status; review steps by reviewer/status; notes/comments by parent/date. Add full-text indexes for task/event/project search.
- Profile queues, countdowns, progress and days since update are derived views, not independently editable copies. Update AVP substantive_updated_at on relevant task changes and AVP notes, in the same transaction.
- Store upload bytes in object storage; database retains metadata and version links. Archive referenced records instead of cascading away approval/source history.

The physical migration must expand omitted shared fields, all membership FKs and composite scope constraints. These diagrams define relationships and invariants; they do not assert that a database has been deployed.
