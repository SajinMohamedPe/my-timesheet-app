# Agent Context — Deloitte Timesheet System

Hand this file to any AI agent (or new developer) so they have full context without
re-explaining the project. It covers **what the project is**, **how every screen
works**, and **the decisions we deliberately made**. For the exact backend API,
see [`API_CONTRACT.md`](./API_CONTRACT.md).

> Status: **frontend, UI-only phase.** All data is served by an in-browser mock
> (localStorage). No real backend exists yet; `API_CONTRACT.md` specifies the
> Spring Boot + PostgreSQL API to build next.

---

## 1. What the project is

A **timesheet-logging web app for Deloitte Ireland**, used primarily by
**contractors** to log the hours they work against projects. The payoff is a
downloadable **Project Summary** (Excel/PDF) that shows, per project, which
people worked on it and for how many hours/days — replacing a manual process
where an admin hand-mapped each contractor's hours across projects.

- **Single company** (Deloitte). It is **not** multi-tenant/multi-company.
- **"Domain" = an internal Deloitte engagement/project.** Current domains:
  **AIM** and **Fisheries**. A domain is the scoping/security boundary.
- **Hierarchy:** `Domain → WBS code → time entry`. A WBS code (e.g. `WBS-1001`)
  belongs to a domain and has a human name ("Deloitte Portal") that **changes
  over time** (effective-dated).
- **Tech:** Angular 20 (standalone components, signals), Angular Material with a
  custom Deloitte-green theme, SheetJS + jsPDF for client-side exports.

### Roles
| Role | Can do |
|---|---|
| **Super Admin** | Everything across all domains. **Only** role that can create/edit/delete domains, **grant/revoke admin**, and **allocate which domain(s) an admin manages**. |
| **Domain Admin** | Scoped to allocated domain(s). Manages employees, WBS codes and timesheets; approves leave. May hold several domains (a **domain switcher** appears). |
| **Employee** (contractor) | Logs their own time & leave. May belong to multiple domains. |

### User types
- **Contractor** — logs time in-app.
- **Staff** — does *not* log in-app; their hours are **uploaded** by an admin
  from an external export (xlsx). The Project Summary **merges** both sources,
  with **in-app data winning** on conflict.

---

## 2. Architecture & where things live

```
src/app/
  core/
    models/models.ts            All domain types + MAX_LEAVE_HOURS_PER_DAY (7.25)
    mock/
      seed.ts                   Seed data (AIM + Fisheries, users, entries, leave, uploads)
      mock-db.ts                localStorage-backed store; resolveWbsName() (effective-dated)
      mock-api.handler.ts       Implements every /api/* endpoint with role/domain scoping
    interceptors/
      mock-api.interceptor.ts   Serves /api/* from the mock (REMOVE to go live)
      auth.interceptor.ts       Attaches Bearer token
    services/
      auth.service.ts           JWT-style auth (signals); login/logout/restore
      api.service.ts            Typed HttpClient wrapper for all endpoints
      domain-context.service.ts The domain switcher state (selectedId)
      export.service.ts         Client-side Excel/PDF generation
      theme.service.ts          Dark/light toggle (signal); persists dtt.theme; OS default
    guards/guards.ts            authGuard / adminGuard / superAdminGuard
    util/dates.ts               Sun–Sat week helpers; isoDate() uses LOCAL date parts;
                                irishBankHolidays()/isIrishBankHoliday(); BANK_HOLIDAY_HOURS=7.25
  shared/
    page-header.component.ts    Gradient icon chip + title + breadcrumb
    search-select.component.ts  Reusable type-to-filter autocomplete ("Add …")
    confirm-dialog.component.ts Reusable modal (deletes + leave review)
  features/
    auth/        login
    shell/       top bar (toggle, brand, search palette, domain switcher, user) + sidebar
    home/        dashboard tiles + quick actions + reset
    timesheets/  the weekly grid (core screen)
    visibility/  Visibility Plan + Live/Uploaded/Differences + upload + summary download
    reports/     per-employee & consolidated exports
    leave/       leave approvals queue (admin)
    audit/       timesheet audit log (admin)
    admin/       Admin Panel: Domains / WBS Codes / Users & Roles
    coming-soon/ placeholder for Billing/Forecasting/Leakage/Budget (admin-only)
```

**Swapping to the real backend:** set `apiBase` in
`src/environments/environment.ts` to the API URL and remove `mockApiInterceptor`
from `withInterceptors([...])` in `src/app/app.config.ts`. No component/service
changes needed — they already call the endpoints in `API_CONTRACT.md`.

**Mock store versioning:** `mock-db.ts` uses a `STORAGE_KEY` (currently `v3`).
Bump it whenever the seed/model shape changes so stale localStorage is discarded.

**Theming:** all colours are CSS custom-property tokens in `src/styles.scss`
(light `:root` + `:root[data-theme="dark"]`, plus `color-scheme`). `ThemeService`
stamps `data-theme` on `<html>` and persists the choice; a toggle is in the top
bar (and on the login screen) for **every** role. Never hard-code hex in
components — use the `--dtt-*` tokens so both themes work.

---

## 3. How each screen works

### Login (`/login`)
Split panel; local username/password. Demo credentials are listed on the page.
On success the mock issues a fake JWT (`mock.<userId>.<ts>`) stored in
localStorage; guards then allow entry. Real backend: JWT access+refresh.

### Shell (app frame)
- **Green square (top-left)** toggles the sidebar (☰ collapsed / ✕ open).
- **Brand** "Deloitte / Account Management" as dark text in the top bar.
- **Search** is a command palette: typing filters features (icon + title +
  description) and navigates on click/Enter. Admin-only features are hidden for
  employees.
- **Domain switcher** (top-right, **admins only**) sets the active domain that
  all scoped screens filter by. Hidden for employees (see decision #3).
- **Dark-mode toggle** (top bar, all roles) flips light/dark via `ThemeService`.
- **Reset demo data** ⟳ icon (also on Home) reseeds the mock.
- **Sidebar** groups: CORE (Time Tracking → Timesheets, Visibility Plan, and for
  admins Leave Approvals/Reports/Timesheet Audit; plus Billing/Forecasting/
  Leakage for admins), PROJECTS (admin only), ADMIN (admin only).

### Home (`/home`)
Dashboard: hours logged this month, days (÷8), pending leave (own, or to-approve
for admins), team size (admins). Quick-action links + Reset demo data.

### Weekly Timesheet grid (`/timesheets`) — the core screen
- Replaces the old calendar/list/Log-Time screens. Shows **one week (Sun–Sat)**.
- **Rows = WBS charge codes, grouped by domain** (AIM, Fisheries), plus a
  collapsible **Absence / Leave** group. Columns = the 7 days; right column = weekly total; footer = daily totals + grand total.
- **Time cells:** type hours (2-decimal display, e.g. `8.00`); autosave on
  change; empty/0 deletes the entry. **Time saves freely — no approval.**
- **Add charge code / Add leave type:** searchable autocomplete pickers; the
  Absence group only lists leave types you've added or that have data this week.
- **Leave cells:** editable, capped at **7.25h/day**. Entering or editing leave
  opens a **review modal** ("… will be sent to your domain admin for review")
  before submitting. **All leave requires approval**; editing a leave resets it
  to Pending. Pending cells have an **amber background**; a thin left accent
  shows approved (green) / rejected (red). Leave text is black + bold.
- **Delete:** every WBS and leave row has an always-visible trash icon → opens a
  confirmation modal explaining the **whole record** for the week will be removed.
- **Admins** get an employee selector to view/edit anyone's timesheet in their
  domain; admin edits to others are recorded in the audit log. For admins the
  grid is **scoped to the active domain** (only that domain's group, WBS options,
  leave rows and totals). For an employee's own grid, all their domains show.

### Visibility Plan (`/visibility`)
- Month grid, one row per person, cells colour-coded by the legend (on-site
  chargeable = green, annual = red, sick = magenta, training = **yellow**,
  internal = blue, bank holiday = blue-grey, pending = amber hatch). A day cell
  shows **both** work and non-rejected leave (a mixed day is a split gradient).
  Employees see only themselves — but across **all** their own domains.
- **Auto-marked days:** weekends **and** every **Irish public (bank) holiday**
  are pre-filled as Bank Holiday (7.25h) with no leave record needed
  (`dates.ts` computes the Republic-of-Ireland calendar client-side).
- **Over-8h flagging (anomaly styling):** any day whose total (work + leave +
  auto bank holiday) exceeds 8h is drawn with a **crimson alert tint + pulsing
  "!" badge** (a deliberate non-legend colour — see decision #14), and the
  person's name is flagged. The **same** treatment marks Differences mismatches,
  so an anomaly reads identically on every grid.
- **Day-edit modal (admins):** clicking any day cell opens a modal to edit that
  person/day — add/edit/delete time and leave and approve/reject leave inline.
  It uses the existing `PUT`/`DELETE /api/time-entries|leave/{id}` endpoints
  (no new endpoints); admin edits to others are audited.
- **Admins** get three tabs + tools:
  - **Live Plan** — data logged in this app.
  - **Uploaded Timesheet** — the *same grid* (resource rows × day columns) built
    only from external xlsx rows (for staff who don't log in-app). "Upload
    Timesheet" parses the file client-side — columns matched loosely
    (case/space-insensitive): **WBS Code, Work Date, Associate Name, Resource
    Name, Hours, WBS L4 Name** — and posts one row per person/day. Cells are
    click-to-edit (auto-saved via `PUT`/`DELETE /api/uploads/{id}`).
  - **Differences** — reconciliation: per person **per day**, lists only where
    in-app vs uploaded hours differ (with the signed delta).
  - **Download Project Summary** — Excel/PDF, scope = this domain or all my
    domains (see §4).

### Reports (`/reports`, admin)
Per-employee or **All Employees — Consolidated** monthly report; Excel (one sheet
per employee) or PDF (one section per employee). Quick per-person XLS/PDF cards.
Generated client-side now; backend export endpoints are documented for later.

### Leave Approvals (`/leave-approvals`, admin)
Queue of leave requests for the current domain; Pending tab + All; Approve/Reject
(records to audit). Shows requester, type, date, hours, status.

### Timesheet Audit (`/audit`, admin)
Chronological log of admin edits to other people's time/leave, plus leave
approve/reject and domain/WBS/user changes. Scoped to the current domain.

### Admin Panel (`/admin`, admin)
Three tabs:
- **Domains** (Super Admin) — CRUD AIM/Fisheries/etc.
- **WBS Codes** — scoped to the selected domain; add/rename/delete. **Renaming
  creates a new effective-dated name** (history preserved).
- **Users & Roles** — add employees to your domain; **Super Admin** grants/
  revokes admin and allocates domains via a **"Manage domains" modal** (tick the
  domain(s) an admin manages; works to grant *and* to re-allocate an existing
  admin at any time, many-to-many). The super admin sees all users here
  regardless of the active domain, so any admin can be found and re-allocated.

### Coming Soon (`/coming-soon/:title`, admin only)
Placeholder pages for Billing, Forecasting, Leakage Report, Budget Management.
Route-guarded and hidden from employees.

---

## 4. Decisions we deliberately made (the important ones)

These were resolved through requirements interviews; keep them unless explicitly changed.

1. **"Domain" means an internal Deloitte engagement (AIM, Fisheries), not a
   separate company.** The app is single-company (Deloitte). Branding is fixed
   Deloitte (no per-tenant branding).
2. **Three roles**; **only Super Admin** grants admin rights and allocates
   domains to admins. Domain Admins can add employees to their own domain but
   cannot mint admins.
3. **The domain switcher is role-aware** (it's fundamentally an admin
   anti-clutter/security boundary, not a restriction for contractors):
   - **Admins** hold one or more domains and get the switcher; it scopes
     *everything* to the active domain — visibility, reports, approvals, audit,
     admin panel, **and** any contractor's timesheet they open (only that
     domain's WBS rows, leave rows and totals). An AIM admin never sees a
     contractor's Fisheries data.
   - **Employees** have **no switcher**; their *own* weekly grid and visibility
     span **all** their domains (grouped), because a contractor legitimately
     works across projects in one week and shouldn't have to switch to finish a
     timesheet.
4. **Time entries save freely (no approval). Leave always requires approval**,
   routed to the domain admin's queue. Editing a leave re-triggers approval.
5. **Leave is entered as hours, max 7.25/day** (the standard Deloitte working
   day; weekly target 36.25h). **Note:** the Project Summary still computes
   **days = hours / 8** per the finance spec — the 7.25 cap is for leave entry,
   not the report's day divisor.
6. **All hour values display to 2 decimals** (`8.00`).
7. **WBS names are effective-dated.** The code is stable; the description has a
   validity range. Reports show the name valid on the entry's date, so historical
   reports stay correct after a rename.
8. **User type Contractor vs Staff.** Contractors log in-app; staff hours are
   uploaded. The **Project Summary merges** both, **in-app wins** on conflict;
   the **Differences** tab surfaces mismatches (a transition/reconciliation aid).
9. **Two reports:** the **Project Summary** (grouped by WBS: Name, WBS Code,
   Project, Hours, Days; Project Total + Grand Total; scope = current domain or
   all my domains; leave excluded — project work only) and the **per-employee
   monthly report** (detail rows + a leave section).
10. **Weekly grid** replaces the old calendar/list/Log-Time screens; week runs
    **Sun–Sat**; weekends **and Irish bank holidays** auto Bank Holiday (7.25h);
    groups are collapsible; "Add" uses searchable autocompletes; whole-row delete
    and leave-entry both use confirmation/review modals.
11. **Access:** Billing / Forecasting / Leakage Report / Budget Management (and
    the whole PROJECTS group) are **admin & super-admin only** — hidden from
    employee nav + search and route-guarded.
12. **Exports** are generated **client-side** for now (SheetJS/jsPDF); the
    backend export endpoints are specified for production.
13. **Extensibility:** nothing is hard-coded — domains, WBS codes and users are
    all data managed in the Admin Panel; adding a new engagement is a data
    operation, not a code change.
14. **Over-8h anomalies use a dedicated alert colour, not a legend colour.**
    After several iterations the chosen signal is a **crimson tint + a "!" badge
    + a pulse** (crimson is close to, but deliberately distinct from, Annual
    Leave red; the "!" and pulse keep it from reading as leave). The **same**
    styling is reused for Differences mismatches so an anomaly looks identical on
    Live Plan, Uploaded and Differences. Tokens: `--dtt-alert*` in `styles.scss`.
15. **Dark mode for everyone.** A per-user theme toggle (persisted, OS-default)
    is available to all roles. Everything is themed through `--dtt-*` tokens so
    no component hard-codes colours; this is frontend-only (no backend).

---

## 5. Running & demo credentials

```bash
npm install
npm start        # http://localhost:4200
```

| Username | Password | Role |
|---|---|---|
| `super` | `super123` | Super Admin (all domains) |
| `admin` | `admin123` | Domain Admin (AIM + Fisheries) |
| `alice` / `bob` / `carol` | `password123` | Employee (contractors) |
| `declan` | `password123` | Staff (Fisheries; upload-only in reports) |

Reset seed anytime via the ⟳ icon (top bar) or Home → Reset demo data.

---

## 6. Conventions for an agent working here

- Angular **standalone components + signals**; prefer `inject()`; no NgModules.
- Keep the mock (`core/mock/*`) and `API_CONTRACT.md` **in sync** — the contract
  is derived from the exact endpoints the app calls.
- New scoped data must carry a `domainId` and be filtered by the caller's role.
- Match the existing look: `.card`, `.chip`, the shared `dtt-page-header`,
  `dtt-search-select`, `dtt-confirm-dialog`, and the grouped-`.block` language.
- **Theme with tokens, never raw hex** — use the `--dtt-*` custom properties
  (green, ink, line, card, tint, alert…) so light **and** dark both work; every
  colour is defined in both `:root` blocks in `styles.scss`.
- Money/label colours aside, **hour values are always 2-decimal**; leave text is
  black + bold (pending = amber background).
- Run `npx ng build` before committing; the build validates all templates/types.
