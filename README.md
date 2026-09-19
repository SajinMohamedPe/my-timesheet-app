# Deloitte Ireland — Timesheet System (Frontend)

Angular 20 UI for a contractor timesheet system. **This phase is UI-only**: all
API calls are served by an in-browser mock (localStorage-backed) so the app runs
fully offline. The backend contract for a Spring Boot + PostgreSQL API is in
[`API_CONTRACT.md`](./API_CONTRACT.md).

## What it does

- **Weekly time grid** — log a whole week at once; WBS rows grouped by domain
  (engagement) plus an Absence group for leave. 8h = 1 day; weekends auto Bank Holiday.
- **Visibility Plan** — month grid coloured by work / leave type; admin tabs for
  **Live Plan / Uploaded Timesheet / Differences**, xlsx upload, and one-click
  **Project Summary** download (Excel/PDF).
- **Reports** — per-employee and consolidated monthly timesheet exports.
- **Leave approvals** — leave requires domain-admin approval (queue with approve/reject).
- **Admin Panel** — Domains, WBS codes (effective-dated names), Users & Roles.
- **Timesheet Audit** — every admin edit to someone else's data is logged.
- **Roles & tenancy** — Super Admin / Domain Admin / Employee; a "domain" is an
  internal engagement (AIM, Fisheries). Admins are scoped to their domain(s) and
  get a domain switcher when allocated to several.

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

Use **Home → Reset demo data** to restore the seed.

## Going live (real backend)

See [`API_CONTRACT.md`](./API_CONTRACT.md) §5 — set `apiBase` in
`src/environments/environment.ts` and drop `mockApiInterceptor` from
`src/app/app.config.ts`. No component changes needed.

## Structure

```
src/app/
  core/
    models/         domain types
    mock/           localStorage store + request handler + seed  (delete when backend is live)
    interceptors/   auth (token) + mock API
    services/       auth, api client, domain-context (switcher), export (xlsx/pdf)
    guards/         auth / admin / super-admin route guards
  features/
    auth login · shell · home · timesheets (weekly grid) · visibility ·
    reports · leave (approvals) · audit · admin (panel) · coming-soon
```

## Tech

Angular 20 (standalone, signals) · Angular Material (custom Deloitte-green theme) ·
SheetJS (`xlsx`) + jsPDF for client-side exports.
