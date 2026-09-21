# Deloitte Ireland — Timesheet System (Frontend)

Angular 20 UI for a **contractor timesheet system** for Deloitte Ireland.
**This phase is UI-only**: every API call is served by an in-browser mock
(localStorage-backed), so the app runs fully offline with realistic data.

- Backend spec (Spring Boot + PostgreSQL): [`API_CONTRACT.md`](./API_CONTRACT.md)
- Full project/agent context (what it is, every screen, all decisions):
  [`AGENT_CONTEXT.md`](./AGENT_CONTEXT.md)

## What it does

- **Weekly time grid** — log a whole week (Sun–Sat) at once. WBS charge codes are
  grouped by domain (engagement) with a collapsible Absence/Leave group.
  Hours show to 2 decimals; time saves automatically.
- **Leave** — entered as hours (max **7.25/day**); every leave opens a review
  modal and goes to the **domain admin for approval** (pending cells are amber).
- **Visibility Plan** — colour-coded month grid; admin tabs for **Live Plan /
  Uploaded Timesheet / Differences**, xlsx upload, and one-click **Project
  Summary** download (Excel/PDF, this domain or all domains). Days over **8h**
  are flagged (alert tint + "!" badge) across all three grids; admins click a
  cell to edit that person/day inline.
- **Reports** — per-employee and consolidated monthly exports (Excel/PDF).
- **Leave approvals** — domain-admin queue with approve/reject.
- **Admin Panel** — Domains, WBS codes (with **effective-dated names**), Users & Roles.
- **Timesheet Audit** — logs every admin edit to someone else's data.
- **Roles & scoping** — Super Admin / Domain Admin / Employee. A "domain" is an
  internal Deloitte engagement (**AIM**, **Fisheries**); admins are scoped to
  their domain(s) and get a switcher when they hold several.
- **Dark mode** — per-user theme toggle (top bar), remembered across sessions,
  defaults to the OS preference. Available to every role.

## Run locally

```bash
npm install
npm start          # ng serve → http://localhost:4200
```

### Demo logins
| Username | Password | Role |
|---|---|---|
| `super` | `super123` | Super Admin (all domains) |
| `admin` | `admin123` | Domain Admin (AIM + Fisheries) |
| `alice` / `bob` / `carol` | `password123` | Employee (contractors) |
| `declan` | `password123` | Staff (upload-only) |

Restore the seed anytime via the ⟳ icon (top bar) or **Home → Reset demo data**.

## Going live (real backend)

See [`API_CONTRACT.md`](./API_CONTRACT.md) §5 — set `apiBase` in
`src/environments/environment.ts` and remove `mockApiInterceptor` from
`src/app/app.config.ts`. No component changes needed.

## Structure

```
src/app/
  core/
    models/         domain types (+ MAX_LEAVE_HOURS_PER_DAY)
    mock/           localStorage store + request handler + seed  (delete when backend is live)
    interceptors/   auth (token) + mock API
    services/       auth, api client, domain-context (switcher), export (xlsx/pdf)
    guards/         auth / admin / super-admin route guards
    util/           Sun–Sat week helpers
  shared/           page-header, search-select (autocomplete), confirm-dialog (modal)
  features/
    auth · shell · home · timesheets (weekly grid) · visibility ·
    reports · leave (approvals) · audit · admin (panel) · coming-soon
```

## Tech

Angular 20 (standalone, signals) · Angular Material (custom Deloitte-green theme) ·
SheetJS (`xlsx`) + jsPDF for client-side exports.

## Build

```bash
npx ng build       # validates all templates & types
```
