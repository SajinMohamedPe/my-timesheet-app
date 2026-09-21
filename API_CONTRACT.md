# Deloitte Timesheet System — Backend API Contract

This document specifies the backend that the Angular frontend in this repo expects.
It is the single source of truth for building the **Spring Boot + PostgreSQL** API.
Every endpoint here is already called by the frontend against a mock; implementing
this contract and pointing the app at the real base URL (see *Switching off the mock*)
makes the app live with **no frontend changes**.

- Frontend framework: Angular 20 (standalone, signals), Angular Material.
- Auth: JWT (access + refresh).
- DB: Azure Database for PostgreSQL – Flexible Server.
- All JSON, `Content-Type: application/json`, UTF-8. Dates are ISO-8601 (`YYYY-MM-DD`); timestamps are ISO-8601 UTC.
- Base path: `/api`.

---

## 1. Core concepts

- **Domain** = an internal Deloitte engagement/project (e.g. *AIM*, *Fisheries*). It is the tenancy/scoping boundary — **not** a separate company. Everything (users, WBS codes, entries, leave) is scoped to a domain.
- **WBS code** belongs to a domain and has an **effective-dated name history** (the code is stable, e.g. `WBS-1001`; its description changes over time — `Portal Rebuild` → `Deloitte Portal`). Reports must show the name valid on the entry's date.
- **Roles**
  - `SUPER_ADMIN` — sees all domains; the only role that can create/edit/delete domains, **grant/revoke admin**, and **allocate which domain(s) an admin manages**.
  - `DOMAIN_ADMIN` — scoped to allocated domain(s). Manages employees, WBS codes, timesheets and approves leave **within those domains**. May be allocated to multiple domains (frontend shows a domain switcher).
  - `EMPLOYEE` — logs their own time/leave. A contractor may belong to multiple domains.
- **User type**
  - `CONTRACTOR` — logs time in-app.
  - `STAFF` — does not log in-app; their hours arrive via **uploaded** external timesheet (xlsx). The Project Summary **merges** in-app + uploaded, with **in-app winning** on conflict.
- **Approval**: time entries **save freely** (no approval). **Leave always requires approval** by a domain admin (statuses `PENDING`/`APPROVED`/`REJECTED`). Leave is entered as **hours per day, max 7.25** (the standard Deloitte working day). **Editing a leave's hours resets it to `PENDING`** (re-approval). Leave rows can be deleted.
- **Bank Holiday leave is always a full day = 7.25h** (any submitted value is coerced to 7.25 server-side).
- **Irish public (bank) holidays are auto-marked** on the Timesheet and Visibility Plan for every user, as Bank Holiday / 7.25h, without needing a leave record. The frontend computes the Republic-of-Ireland holiday calendar client-side (New Year's Day; St Brigid's Day — 1 Feb if Friday else first Mon in Feb; St Patrick's Day; Easter Monday; first Mon of May/Jun/Aug; last Mon of Oct; Christmas Day; St Stephen's Day) and overlays them (read-only). The backend does **not** need to create these records, but any server-side report/day-count logic must apply the **same holiday calendar** so totals agree. Weekends are also auto-marked Bank Holiday (no hours).
- **Hours convention**: the standard working day is **7.25h** (weekly target 36.25h) and caps leave per day. Note the Project Summary still expresses **days = hours / 8** per the finance spec — the 7.25 cap applies to leave entry, not to the report's day divisor. All hour values display to **2 decimals** (e.g. `8.00`).

---

## 2. Authorization rules (enforce server-side)

Given the caller's JWT (subject = userId, claims include `role`, `domainIds`):

| Area | EMPLOYEE | DOMAIN_ADMIN | SUPER_ADMIN |
|---|---|---|---|
| Read own time/leave | ✅ | ✅ | ✅ |
| Read others' time/leave | ❌ | within allocated domains | all domains |
| Create/edit **own** time | ✅ | ✅ | ✅ |
| Create/edit **others'** time | ❌ | within allocated domains (audited) | all (audited) |
| Approve/reject leave | ❌ | within allocated domains | all |
| CRUD WBS codes | ❌ | within allocated domains | all |
| Add EMPLOYEE users | ❌ | into own domains | any domain |
| Grant/revoke admin, allocate domains | ❌ | ❌ | ✅ |
| CRUD domains | ❌ | ❌ | ✅ |
| Upload timesheet / view differences | ❌ | own domains | all |
| Download reports | ❌ | own domains | all/selected |

"Scoped to domain" means: filter every collection so a `DOMAIN_ADMIN` only ever sees rows whose `domainId ∈ token.domainIds`; a `SUPER_ADMIN` sees all. Reject writes to out-of-scope domains with `403`.

**Active-domain scoping (admins) vs. own-data (employees).** The UI has a domain switcher for admins only. When an admin passes `domainId=<active>`, scope the response to that one domain (this is how an admin views a contractor's timesheet, the visibility plan, approvals, audit and reports for a single engagement). An **employee always sees their own data across all their domains** — never restrict an employee's own timesheet/visibility to a single domain, even if a `domainId` is present.

---

## 3. Data model (PostgreSQL)

```
domain(
  id            uuid pk,
  name          text not null,
  description   text,
  active        boolean not null default true
)

wbs_code(
  id            uuid pk,
  domain_id     uuid fk -> domain(id),
  code          text not null,           -- stable, e.g. 'WBS-1001'
  client_code   text,                    -- e.g. 'DLT-001'
  active        boolean not null default true,
  unique(domain_id, code)
)

wbs_name(                                 -- effective-dated names
  id            uuid pk,
  wbs_code_id   uuid fk -> wbs_code(id),
  description   text not null,
  valid_from    date not null,
  valid_to      date null                 -- null = current
)

app_user(
  id            uuid pk,
  name          text not null,
  username      text not null unique,
  email         text not null,
  password_hash text not null,            -- BCrypt
  role          text not null,            -- SUPER_ADMIN | DOMAIN_ADMIN | EMPLOYEE
  type          text not null,            -- CONTRACTOR | STAFF
  active        boolean not null default true
)

user_domain(                              -- many-to-many: user <-> domain
  user_id       uuid fk -> app_user(id),
  domain_id     uuid fk -> domain(id),
  primary key(user_id, domain_id)
)

time_entry(
  id            uuid pk,
  user_id       uuid fk -> app_user(id),
  domain_id     uuid fk -> domain(id),
  wbs_code_id   uuid fk -> wbs_code(id),
  work_date     date not null,
  hours         numeric(4,2) not null,
  notes         text,
  source        text not null default 'IN_APP',   -- IN_APP | UPLOADED
  updated_at    timestamptz not null,
  updated_by    uuid fk -> app_user(id)
)

leave_request(
  id            uuid pk,
  user_id       uuid fk -> app_user(id),
  domain_id     uuid fk -> domain(id),
  type          text not null,            -- ANNUAL|SICK|TRAINING|INTERNAL|BANK_HOLIDAY
  leave_date    date not null,
  hours         numeric(4,2) not null check (hours > 0 and hours <= 7.25),
  notes         text,
  status        text not null default 'PENDING',
  requested_at  timestamptz not null,
  decided_by    uuid null fk -> app_user(id),
  decided_at    timestamptz null
)

uploaded_timesheet_row(                   -- parsed external export rows
  id            uuid pk,
  month         text not null,            -- 'YYYY-MM'
  domain_id     uuid fk -> domain(id),
  user_name     text not null,            -- match by name (no FK; external source)
  wbs_code      text,
  project       text,
  hours         numeric(6,2) not null
)

audit_entry(
  id            uuid pk,
  at            timestamptz not null,
  actor_id      uuid, actor_name text,
  action        text,                     -- CREATE|UPDATE|DELETE|APPROVE|REJECT
  entity        text,                     -- TIME_ENTRY|LEAVE|WBS|USER|DOMAIN
  target_user_id uuid, target_user_name text,
  domain_id     uuid,
  summary       text
)
```

**WBS rename rule:** never mutate `wbs_name.description` in place. On rename, close the open row (`valid_to = today`) and insert a new row (`valid_from = today, valid_to = null`). Name resolution for a date `d`: the row where `valid_from <= d AND (valid_to IS NULL OR d < valid_to)`.

---

## 4. Endpoints

Response envelope is the bare JSON object/array shown. Errors: `{ "message": "..." }` with the noted HTTP status (`400/401/403/404/405`).

### 4.1 Auth

**POST `/api/auth/login`** — public
```jsonc
// request
{ "username": "alice", "password": "password123" }
// 200
{
  "accessToken": "<jwt>",
  "refreshToken": "<jwt>",
  "user": { "id","name","username","email","role","type","domainIds":["..."] }
}
// 401 { "message": "Invalid credentials" }
```

**POST `/api/auth/refresh`** — body `{ "refreshToken": "<jwt>" }` → same shape as login.

**GET `/api/auth/me`** — returns the `user` object (from token). `401` if not authenticated.

JWT claims: `sub`=userId, `role`, `domainIds` (array), plus standard `exp`/`iat`. Access token ~15 min, refresh ~7 days. Passwords BCrypt-hashed.

### 4.2 Domains

- **GET `/api/domains`** → `Domain[]` (scoped: super=all, others=allocated).
- **POST `/api/domains`** *(SUPER_ADMIN)* — `{ "name","description" }` → `201 Domain`.
- **PUT `/api/domains/{id}`** *(SUPER_ADMIN)* — `{ "name?","description?","active?" }` → `Domain`.
- **DELETE `/api/domains/{id}`** *(SUPER_ADMIN)* → `{ "deleted": true }`.

`Domain = { id, name, description, active }`.

### 4.3 WBS codes

- **GET `/api/wbs?domainId=`** → `WbsCodeView[]` where
  `WbsCodeView = { id, domainId, code, clientCode, active, nameHistory:[{description,validFrom,validTo}], currentName }`.
  Scoped to caller's domains; `domainId` filters further.
- **POST `/api/wbs`** *(admin, own domain)* — `{ "domainId","code","clientCode?","description" }` → `201`. Creates first `wbs_name` (`validFrom=today`).
- **PUT `/api/wbs/{id}`** *(admin, own domain)* — `{ "description?","clientCode?","active?" }`. A changed `description` triggers the **rename rule** (new dated name).
- **DELETE `/api/wbs/{id}`** *(admin, own domain)* → `{ "deleted": true }`.

### 4.4 Users & roles

- **GET `/api/users?domainId=`** → `User[]` scoped to caller's domains.
  `User = { id, name, username, email, role, type, domainIds, active }`.
- **POST `/api/users`** *(admin)* — `{ "name","username","email","type","domainIds" }` → `201 User` (role forced `EMPLOYEE`; domains must be within caller's scope; default password `password123` or send invite in production).
- **PUT `/api/users/{id}`** *(admin)* — `{ "name?","email?","type?","domainIds?","active?" }`.
- **POST `/api/users/{id}/grant-admin`** *(SUPER_ADMIN)* — `{ "domainIds": ["..."] }` sets role `DOMAIN_ADMIN` and allocates domains → `User`.
- **POST `/api/users/{id}/revoke-admin`** *(SUPER_ADMIN)* → sets role `EMPLOYEE` → `User`.

### 4.5 Time entries

- **GET `/api/time-entries?userId=&domainId=&from=&to=`** → `TimeEntry[]`.
  Employees receive only their own; admins receive any within scope. **All query
  filters must be honoured server-side** — the weekly grid relies on `userId`
  (admin viewing one contractor must get only that contractor's rows), `from`/`to`
  (the visible week, `YYYY-MM-DD` inclusive) and, for an admin, `domainId` (the
  active domain in the switcher; an admin's view of a contractor's timesheet is
  scoped to that one domain). An employee's own grid is **not** domain-restricted
  (spans all their domains).
  `TimeEntry = { id, userId, domainId, wbsCodeId, date, hours, notes?, source, updatedAt, updatedBy }`.
- **POST `/api/time-entries`** — `{ "userId?","domainId","wbsCodeId","date","hours","notes?" }`. `userId` defaults to caller; logging for another user requires admin (audited).
- **PUT `/api/time-entries/{id}`** — `{ "hours?","notes?","wbsCodeId?" }`. Owner or in-scope admin. Admin edits to others are audited.
- **DELETE `/api/time-entries/{id}`** → `{ "deleted": true }`.

### 4.6 Leave

- **GET `/api/leave?domainId=&status=&userId=`** → `LeaveRequest[]` (employees: own only).
  `LeaveRequest = { id, userId, domainId, type, date, hours, notes?, status, requestedAt, decidedBy?, decidedAt? }`.
- **POST `/api/leave`** — `{ "userId?","domainId","type","date","hours","notes?" }` → `201` with `status=PENDING`. Clamp `hours` to `(0, 7.25]`.
- **PUT `/api/leave/{id}`** — `{ "hours?","notes?" }`. Owner or in-scope admin. **Changing hours resets `status` to `PENDING`** and clears `decidedBy`/`decidedAt` (re-approval). Admin edits to others are audited.
- **DELETE `/api/leave/{id}`** → `{ "deleted": true }`. Owner or in-scope admin (admin deletes audited).
- **POST `/api/leave/{id}/approve`** *(admin, own domain)* → `LeaveRequest` (`APPROVED`), audited.
- **POST `/api/leave/{id}/reject`** *(admin, own domain)* → `LeaveRequest` (`REJECTED`), audited.

### 4.7 Visibility plan

- **GET `/api/visibility?domainId=&month=YYYY-MM`** →
  ```jsonc
  { "month":"2026-09", "rows":[ { "userId","name","entries":TimeEntry[], "leaves":LeaveRequest[] } ] }
  ```
  The frontend now shows **both** work and leave for a day (they are not mutually exclusive) and computes a **day total = work hours + non-rejected leave hours (+ 7.25 for an auto Irish bank holiday)**. Any day whose total **exceeds 8h** is highlighted and the employee's name flagged so an admin can inspect overallocation. **Admins can click a day cell to open an edit modal** for that person/day; it edits the underlying records via the existing endpoints — `PUT`/`DELETE /api/time-entries/{id}` and `PUT`/`DELETE /api/leave/{id}` plus `approve`/`reject`. No new endpoints are required; the server must keep honouring those for an in-scope admin acting on another user (audited).

  Admins get all in-scope users; employees get **only themselves but across ALL their own domains** (an employee's row must include entries/leave from every domain they belong to — the frontend does not pass `domainId` for employees, and if it did the server must still not hide the employee's own other-domain rows). Frontend colours cells (work / leave type / bank holiday / pending) and auto-marks weekends as Bank Holiday. **Cell display rules the frontend applies (backend just returns the data):** leave takes priority over work on a given day; every non-empty cell shows its hours; leave that is `PENDING` renders as the "Pending" state until approved, then as its leave-type colour.

### 4.8 Uploads (reconciliation)

- **GET `/api/uploads?domainId=&month=`** *(admin)* → `UploadedRow[]` (per-day rows).
  `UploadedRow = { id, domainId, month, workDate, wbsCode, project, associateName, resourceName, hours }`
  — `month` is derived from `workDate` (YYYY-MM); `project` = the WBS L4 name;
  `associateName` = "Last, First"; `resourceName` = "First Last" (used for display and
  for matching to in-app users); `hours` is decimal.
- **POST `/api/uploads`** *(admin)* — `{ "rows": UploadedRow[] (without id) }` → `201 { "inserted": n }`. This is the **save** step: uploading the xlsx persists the rows.
- **PUT `/api/uploads/{id}`** *(admin, own domain)* — `{ "hours?","wbsCode?","project?" }` → `UploadedRow`. Powers inline editing of uploaded records (auto-saves on change).
- **DELETE `/api/uploads/{id}`** *(admin, own domain)* → `{ "deleted": true }`.
  The frontend parses the xlsx client-side — expected columns (header names matched
  loosely, case/space-insensitive): **WBS Code, Work Date, Associate Name, Resource
  Name, Hours, WBS L4 Name**. The backend may alternatively accept the raw file at
  `POST /api/uploads/file` (multipart) and parse server-side — optional.

**Purpose & the two tabs.** Uploaded timesheets are for **staff** users (who don't log in-app); the in-app pipeline is for **contractors**. On the admin Visibility Plan:
- **Uploaded Timesheet** renders the *same grid as Live Plan* (resource rows × day columns, hours per cell) but built only from uploaded rows. Uploading **saves** the rows; an admin can then **click a cell to edit** the uploaded records for that person/day (edit hours, delete) — auto-saved via the `PUT`/`DELETE /api/uploads/{id}` endpoints, mirroring Live Plan and Differences.
- **Differences** compares **in-app (live plan) vs uploaded, per person per day** (matched on normalised name + date), listing only the days where the hours differ (with the signed delta). This is the reconciliation view during the transition; days over 8h are still flagged elsewhere.

### 4.9 Reports

- **GET `/api/reports/project-summary?scope=DOMAIN|ALL&domainId=&month=`** →
  ```jsonc
  {
    "title":"Timesheet Summary — September 2026",
    "month":"2026-09", "scope":"DOMAIN",
    "rows":[ { "name","wbsCode","project","hours","days","domainName?" } ],
    "grandTotalHours": 30, "grandTotalDays": 3.75
  }
  ```
  Rows = **merge** of in-app time entries + uploaded rows (in-app wins per `name+wbsCode`), grouped by WBS, `days = hours/8`. `project` = WBS name effective for the month. `scope=ALL` spans all the caller's domains and includes `domainName`.
- **GET `/api/reports/employee?userId=&month=`** →
  ```jsonc
  {
    "name","month","monthLabel","totalHours","totalDays",
    "entries":[ { "date","wbsCode","project","hours","notes" } ],
    "leaves":[ { "date","type","hours" } ]   // approved only
  }
  ```

**File export (production):** the frontend currently generates `.xlsx`/`.pdf` client-side from the JSON above. For server-side generation, expose
`GET /api/reports/project-summary/export?format=xlsx|pdf&...` and
`GET /api/reports/employee/export?format=xlsx|pdf&...`
returning the file (`Content-Disposition: attachment`). Excel Project Summary layout: grouped by project with a *Project Total* row per group and a *Grand Total* row; columns `Name, [Domain,] WBS Code, Project, Hours, Days`. Consolidated employee export = one worksheet per employee (xlsx) / one section per employee (pdf).

### 4.10 Audit

- **GET `/api/audit?domainId=`** *(admin)* → `AuditEntry[]` (newest first), scoped.
  `AuditEntry = { id, at, actorId, actorName, action, entity, targetUserId?, targetUserName?, domainId?, summary }`.
  Record an entry whenever an **admin edits another user's** time/leave, on leave approve/reject, and on domain/WBS/user changes.

### 4.11 Demo utility (dev only — do not ship)
- **POST `/api/admin/reset`** — reseeds demo data. Omit in production.

---

## 5. Switching the frontend off the mock

`src/environments/environment.ts` holds `{ apiBase, useMock }`. To go live:
1. Set `apiBase` to the real API origin (e.g. `https://<app>.azurewebsites.net/api`).
2. Remove `mockApiInterceptor` from the `withInterceptors([...])` list in `src/app/app.config.ts`.
3. Enable CORS on the backend for the SWA origin; keep the `authInterceptor` (it attaches `Authorization: Bearer <token>`).

No component or service code changes are required — they already call the endpoints above.

---

## 6. Seed data (for parity with the demo)

Domains: **AIM** (`WBS-1001` Deloitte Portal [renamed from *Portal Rebuild* on 2026-07-01], `WBS-1002` Client Onboarding, `WBS-1003` Data Migration, `WBS-1004` Internal Tools) and **Fisheries** (`WBS-2001` Aquamis External, `WBS-2002` Bulk Renewals, `WBS-2003` DIS — Smart Logbooks).
Users: `super` (SUPER_ADMIN), `admin` (DOMAIN_ADMIN, both domains), `alice`/`bob`/`carol` (contractors), `declan` (STAFF, Fisheries — upload only). Demo passwords: `super123`, `admin123`, else `password123`.

---

## 7. Infrastructure notes (for the pipeline agent)

- **DB**: Azure Database for PostgreSQL – Flexible Server. Use Flyway/Liquibase for the schema in §3. Connection via env vars (`SPRING_DATASOURCE_URL/USERNAME/PASSWORD`); enforce SSL.
- **Backend**: Spring Boot (Spring Web, Spring Security + JWT, Spring Data JPA, Validation). Containerize (multi-stage Dockerfile) → push to **Azure Container Registry (ACR)** → run on Azure Container Apps / App Service for Containers.
- **Frontend**: build (`ng build`) → deploy `dist/deloitte-timesheet/browser` to **Azure Static Web Apps**. Configure SWA to proxy `/api/*` to the backend (or set `apiBase` to the backend URL + CORS).
- **CI/CD**: GitHub Actions — one workflow builds/tests/pushes the backend image to ACR and deploys; another builds and deploys the SWA. Use OIDC federation to Azure (no long-lived secrets).
- **Config/secrets**: Azure Key Vault referenced from Container Apps; JWT signing key and DB creds live there.

---

## 8. Presentation-only behaviour (no backend work)

These are handled entirely by the frontend from the JSON already specified above — listed here so the backend agent does **not** try to add endpoints or fields for them:

- **Over-allocation flagging.** Any day whose total (work + non-rejected leave + auto bank holiday) exceeds **8h** is highlighted with an alert style and a "!" badge on the **Live Plan**, **Uploaded Timesheet** and **Differences** grids, and the person's name is flagged. This is computed client-side from `/api/visibility` and `/api/uploads` data. The backend returns raw hours only.
- **Differences / reconciliation.** The per-person-per-day comparison of in-app vs uploaded hours is computed client-side by matching normalised names + dates; no diff endpoint is required.
- **Irish bank-holiday & weekend overlays.** Auto-marked client-side (see §1). The backend stores no records for these, but any server-side report/day-count logic must apply the **same** holiday calendar so totals agree.
- **Dark mode.** A per-viewer theme toggle (persisted in `localStorage`), available to all roles. No backend involvement.
- **2-decimal display, colour legend, name-column wrapping.** Pure formatting.
