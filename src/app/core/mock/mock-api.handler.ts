import {
  AuditEntry, AuthUser, Domain, LeaveRequest, LeaveRequestView, ProjectSummary, ProjectSummaryRow,
  TimeEntry, User, WbsCode, HALF_DAY_HOURS, MAX_LEAVE_HOURS_PER_DAY,
} from '../models/models';
import { currentWbsName, MockDb, resolveWbsName, uid } from './mock-db';
import { isIrishBankHoliday, isoDate } from '../util/dates';
import { PASSWORDS } from './seed';

export interface MockResult { status: number; body: unknown; }

const MAX_LEAVE = 7.25;
const clampLeave = (h: unknown): number => {
  const n = Number(h) || 0;
  return Math.max(0, Math.min(MAX_LEAVE, Math.round(n * 100) / 100));
};

const ok = (body: unknown = null): MockResult => ({ status: 200, body });
const created = (body: unknown): MockResult => ({ status: 201, body });
const err = (status: number, message: string): MockResult => ({ status, body: { message } });

/** Decode the fake token "mock.<userId>.<ts>" -> userId. */
function userIdFromToken(auth: string | null): string | null {
  if (!auth) return null;
  const token = auth.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  return parts.length === 3 && parts[0] === 'mock' ? parts[1] : null;
}

function toAuthUser(u: User): AuthUser {
  return {
    id: u.id, name: u.name, username: u.username, email: u.email,
    role: u.role, type: u.type, domainIds: u.domainIds,
  };
}

/** Domains the given user may see. */
function visibleDomainIds(db: MockDb, u: User): string[] {
  if (u.role === 'SUPER_ADMIN') return db.get('domains').map((d) => d.id);
  return u.domainIds;
}

function isAdmin(u: User): boolean {
  return u.role === 'SUPER_ADMIN' || u.role === 'DOMAIN_ADMIN';
}

export interface ParsedReq {
  method: string;
  path: string;          // e.g. /api/domains
  segments: string[];    // ['api','domains',...]
  query: URLSearchParams;
  body: any;
  auth: string | null;
}

export function handleMockRequest(db: MockDb, req: ParsedReq): MockResult {
  const { method, segments, query, body } = req;
  const p = segments;

  // ---------------- Auth (no token required) ----------------
  if (p[1] === 'auth') {
    if (method === 'POST' && p[2] === 'login') return login(db, body);
    const uid1 = userIdFromToken(req.auth);
    const me = db.get('users').find((u) => u.id === uid1);
    if (!me) return err(401, 'Not authenticated');
    if (p[2] === 'me') return ok(toAuthUser(me));
    if (method === 'POST' && p[2] === 'refresh') return ok(issueTokens(me));
  }

  // ---------------- Everything else requires auth ----------------
  const currentId = userIdFromToken(req.auth);
  const me = db.get('users').find((u) => u.id === currentId);
  if (!me) return err(401, 'Not authenticated');

  switch (p[1]) {
    case 'domains':      return domainsRoute(db, me, req);
    case 'wbs':          return wbsRoute(db, me, req);
    case 'users':        return usersRoute(db, me, req);
    case 'time-entries': return timeEntriesRoute(db, me, req);
    case 'leave':        return leaveRoute(db, me, req);
    case 'leave-requests': return leaveRequestsRoute(db, me, req);
    case 'visibility':   return ok(visibility(db, me, query));
    case 'uploads':      return uploadsRoute(db, me, req);
    case 'reports':      return reportsRoute(db, me, req);
    case 'audit':        return ok(scopedAudit(db, me, query));
    case 'admin':
      if (method === 'POST' && p[2] === 'reset') { db.reset(); return ok({ reset: true }); }
      return err(404, 'Not found');
  }
  return err(404, 'Not found: ' + req.path);
}

// ------------------------- Auth -------------------------

function issueTokens(u: User) {
  const ts = Date.now();
  return {
    accessToken: `mock.${u.id}.${ts}`,
    refreshToken: `mock.${u.id}.${ts + 1}`,
    user: toAuthUser(u),
  };
}

function login(db: MockDb, body: { username?: string; password?: string }): MockResult {
  const username = (body?.username ?? '').trim().toLowerCase();
  const password = body?.password ?? '';
  const u = db.get('users').find((x) => x.username === username && x.active);
  if (!u || PASSWORDS[username] !== password) return err(401, 'Invalid credentials');
  return ok(issueTokens(u));
}

// ------------------------- Domains -------------------------

function domainsRoute(db: MockDb, me: User, req: ParsedReq): MockResult {
  const { method, segments: p, body } = req;
  const domains = db.get('domains');

  if (method === 'GET' && !p[2]) {
    const ids = visibleDomainIds(db, me);
    return ok(domains.filter((d) => ids.includes(d.id)));
  }
  // Mutations are Super Admin only.
  if (me.role !== 'SUPER_ADMIN') return err(403, 'Super Admin only');

  if (method === 'POST') {
    const d: Domain = { id: uid('d'), name: body.name, description: body.description ?? '', active: true };
    domains.push(d);
    audit(db, me, 'CREATE', 'DOMAIN', `Created domain ${d.name}`, d.id);
    db.save();
    return created(d);
  }
  if (method === 'PUT' && p[2]) {
    const d = domains.find((x) => x.id === p[2]);
    if (!d) return err(404, 'Domain not found');
    Object.assign(d, { name: body.name ?? d.name, description: body.description ?? d.description, active: body.active ?? d.active });
    audit(db, me, 'UPDATE', 'DOMAIN', `Updated domain ${d.name}`, d.id);
    db.save();
    return ok(d);
  }
  if (method === 'DELETE' && p[2]) {
    const i = domains.findIndex((x) => x.id === p[2]);
    if (i < 0) return err(404, 'Domain not found');
    const [removed] = domains.splice(i, 1);
    audit(db, me, 'DELETE', 'DOMAIN', `Deleted domain ${removed.name}`, removed.id);
    db.save();
    return ok({ deleted: true });
  }
  return err(405, 'Method not allowed');
}

// ------------------------- WBS codes -------------------------

function wbsRoute(db: MockDb, me: User, req: ParsedReq): MockResult {
  const { method, segments: p, query, body } = req;
  const wbs = db.get('wbsCodes');

  if (method === 'GET' && !p[2]) {
    const domainId = query.get('domainId');
    const ids = visibleDomainIds(db, me);
    return ok(
      wbs
        .filter((w) => ids.includes(w.domainId))
        .filter((w) => !domainId || w.domainId === domainId)
        .map((w) => ({ ...w, currentName: currentWbsName(w) })),
    );
  }
  if (!isAdmin(me)) return err(403, 'Admin only');

  if (method === 'POST') {
    const today = new Date().toISOString().slice(0, 10);
    const w: WbsCode = {
      id: uid('w'), domainId: body.domainId, code: body.code, clientCode: body.clientCode ?? '',
      active: true, nameHistory: [{ description: body.description, validFrom: today, validTo: null }],
    };
    if (!canAccessDomain(db, me, w.domainId)) return err(403, 'Not your domain');
    wbs.push(w);
    audit(db, me, 'CREATE', 'WBS', `Created ${w.code} (${body.description})`, undefined, w.domainId);
    db.save();
    return created(w);
  }
  if (method === 'PUT' && p[2]) {
    const w = wbs.find((x) => x.id === p[2]);
    if (!w) return err(404, 'WBS not found');
    if (!canAccessDomain(db, me, w.domainId)) return err(403, 'Not your domain');
    // Renaming creates a new effective-dated name (preserving history).
    if (body.description && body.description !== currentWbsName(w)) {
      const today = new Date().toISOString().slice(0, 10);
      const open = w.nameHistory.find((n) => n.validTo === null);
      if (open) open.validTo = today;
      w.nameHistory.push({ description: body.description, validFrom: today, validTo: null });
      audit(db, me, 'UPDATE', 'WBS', `Renamed ${w.code} -> ${body.description}`, undefined, w.domainId);
    }
    if (body.clientCode !== undefined) w.clientCode = body.clientCode;
    if (body.active !== undefined) w.active = body.active;
    db.save();
    return ok(w);
  }
  if (method === 'DELETE' && p[2]) {
    const i = wbs.findIndex((x) => x.id === p[2]);
    if (i < 0) return err(404, 'WBS not found');
    if (!canAccessDomain(db, me, wbs[i].domainId)) return err(403, 'Not your domain');
    const [removed] = wbs.splice(i, 1);
    audit(db, me, 'DELETE', 'WBS', `Deleted ${removed.code}`, undefined, removed.domainId);
    db.save();
    return ok({ deleted: true });
  }
  return err(405, 'Method not allowed');
}

function canAccessDomain(db: MockDb, me: User, domainId: string): boolean {
  return visibleDomainIds(db, me).includes(domainId);
}

// ------------------------- Users & roles -------------------------

function usersRoute(db: MockDb, me: User, req: ParsedReq): MockResult {
  const { method, segments: p, query, body } = req;
  const users = db.get('users');

  if (method === 'GET' && !p[2]) {
    const domainId = query.get('domainId');
    const ids = visibleDomainIds(db, me);
    let list = users.filter((u) => u.domainIds.some((d) => ids.includes(d)));
    if (domainId) list = list.filter((u) => u.domainIds.includes(domainId));
    return ok(list);
  }
  if (!isAdmin(me)) return err(403, 'Admin only');

  // Domain Admin can add EMPLOYEE users to their own domain.
  if (method === 'POST' && !p[2]) {
    const domainIds: string[] = body.domainIds ?? [];
    if (!domainIds.every((d) => canAccessDomain(db, me, d))) return err(403, 'Not your domain');
    const u: User = {
      id: uid('u'), name: body.name, username: body.username, email: body.email,
      role: 'EMPLOYEE', type: body.type ?? 'CONTRACTOR', domainIds, active: true,
    };
    users.push(u);
    PASSWORDS[u.username] = 'password123';
    audit(db, me, 'CREATE', 'USER', `Added user ${u.name}`, u.id);
    db.save();
    return created(u);
  }
  if (method === 'PUT' && p[2]) {
    const u = users.find((x) => x.id === p[2]);
    if (!u) return err(404, 'User not found');
    Object.assign(u, {
      name: body.name ?? u.name, email: body.email ?? u.email,
      type: body.type ?? u.type, domainIds: body.domainIds ?? u.domainIds,
      active: body.active ?? u.active,
    });
    audit(db, me, 'UPDATE', 'USER', `Updated user ${u.name}`, u.id);
    db.save();
    return ok(u);
  }
  // Grant/revoke admin + domain allocation = Super Admin only.
  if (method === 'POST' && (p[3] === 'grant-admin' || p[3] === 'revoke-admin')) {
    if (me.role !== 'SUPER_ADMIN') return err(403, 'Super Admin only');
    const u = users.find((x) => x.id === p[2]);
    if (!u) return err(404, 'User not found');
    if (p[3] === 'grant-admin') {
      u.role = 'DOMAIN_ADMIN';
      if (Array.isArray(body?.domainIds) && body.domainIds.length) u.domainIds = body.domainIds;
    } else {
      u.role = 'EMPLOYEE';
    }
    audit(db, me, p[3] === 'grant-admin' ? 'UPDATE' : 'UPDATE', 'USER',
      `${p[3] === 'grant-admin' ? 'Granted admin to' : 'Revoked admin from'} ${u.name}`, u.id);
    db.save();
    return ok(u);
  }
  return err(405, 'Method not allowed');
}

// ------------------------- Time entries -------------------------

function timeEntriesRoute(db: MockDb, me: User, req: ParsedReq): MockResult {
  const { method, segments: p, query, body } = req;
  const entries = db.get('timeEntries');

  if (method === 'GET') {
    const userId = query.get('userId');
    const domainId = query.get('domainId');
    const from = query.get('from');
    const to = query.get('to');
    const ids = visibleDomainIds(db, me);
    let list = entries.filter((e) => ids.includes(e.domainId));
    if (!isAdmin(me)) list = list.filter((e) => e.userId === me.id); // employees see only their own
    if (userId) list = list.filter((e) => e.userId === userId);
    if (domainId) list = list.filter((e) => e.domainId === domainId);
    if (from) list = list.filter((e) => e.date >= from);
    if (to) list = list.filter((e) => e.date <= to);
    return ok(list);
  }
  if (method === 'POST') {
    // Employees log for themselves; admins may log/edit for anyone in-domain.
    const targetUser = body.userId ?? me.id;
    if (targetUser !== me.id && !isAdmin(me)) return err(403, 'Cannot log for others');
    const e: TimeEntry = {
      id: uid('t'), userId: targetUser, domainId: body.domainId, wbsCodeId: body.wbsCodeId,
      date: body.date, hours: Number(body.hours) || 0, notes: body.notes,
      source: 'IN_APP', updatedAt: new Date().toISOString(), updatedBy: me.id,
    };
    entries.push(e);
    if (me.id !== targetUser) auditEntryEdit(db, me, e, 'CREATE');
    db.save();
    return created(e);
  }
  if (method === 'PUT' && p[2]) {
    const e = entries.find((x) => x.id === p[2]);
    if (!e) return err(404, 'Entry not found');
    if (e.userId !== me.id && !isAdmin(me)) return err(403, 'Forbidden');
    const before = e.hours;
    Object.assign(e, {
      hours: body.hours ?? e.hours, notes: body.notes ?? e.notes,
      wbsCodeId: body.wbsCodeId ?? e.wbsCodeId, updatedAt: new Date().toISOString(), updatedBy: me.id,
    });
    if (me.id !== e.userId) auditEntryEdit(db, me, e, 'UPDATE', before);
    db.save();
    return ok(e);
  }
  if (method === 'DELETE' && p[2]) {
    const i = entries.findIndex((x) => x.id === p[2]);
    if (i < 0) return err(404, 'Entry not found');
    if (entries[i].userId !== me.id && !isAdmin(me)) return err(403, 'Forbidden');
    const [removed] = entries.splice(i, 1);
    if (me.id !== removed.userId) auditEntryEdit(db, me, removed, 'DELETE');
    db.save();
    return ok({ deleted: true });
  }
  return err(405, 'Method not allowed');
}

// ------------------------- Leave -------------------------

function leaveRoute(db: MockDb, me: User, req: ParsedReq): MockResult {
  const { method, segments: p, query, body } = req;
  const leave = db.get('leaveRequests');

  if (method === 'GET') {
    const status = query.get('status');
    const domainId = query.get('domainId');
    const ids = visibleDomainIds(db, me);
    let list = leave.filter((l) => ids.includes(l.domainId));
    if (!isAdmin(me)) list = list.filter((l) => l.userId === me.id);
    if (domainId) list = list.filter((l) => l.domainId === domainId);
    if (status) list = list.filter((l) => l.status === status);
    return ok(list);
  }
  if (method === 'POST' && !p[2]) {
    const sid = uid('lr');
    const hrs = body.type === 'BANK_HOLIDAY' ? 7.25 : clampLeave(body.hours); // bank holiday = full day
    const l: LeaveRequest = {
      id: uid('l'), submissionId: sid, userId: body.userId ?? me.id, domainId: body.domainId,
      type: body.type, date: body.date, hours: hrs, halfDay: hrs <= HALF_DAY_HOURS,
      startDate: body.date, endDate: body.date,
      notes: body.notes, status: 'PENDING', requestedAt: new Date().toISOString(),
    };
    leave.push(l);
    db.save();
    return created(l);
  }
  // Editing a leave's hours resets it to PENDING (needs re-approval).
  if (method === 'PUT' && p[2]) {
    const l = leave.find((x) => x.id === p[2]);
    if (!l) return err(404, 'Leave not found');
    if (l.userId !== me.id && !isAdmin(me)) return err(403, 'Forbidden');
    l.hours = l.type === 'BANK_HOLIDAY' ? 7.25 : clampLeave(body.hours ?? l.hours);
    if (body.notes !== undefined) l.notes = body.notes;
    l.status = 'PENDING';
    l.decidedBy = undefined; l.decidedAt = undefined;
    if (me.id !== l.userId) {
      const who = db.get('users').find((u) => u.id === l.userId);
      audit(db, me, 'UPDATE', 'LEAVE', `Changed ${l.type} leave to ${l.hours.toFixed(2)}h for ${who?.name ?? l.userId} (${l.date}) — re-submitted`, l.userId, l.domainId);
    }
    db.save();
    return ok(l);
  }
  if (method === 'DELETE' && p[2]) {
    const i = leave.findIndex((x) => x.id === p[2]);
    if (i < 0) return err(404, 'Leave not found');
    if (leave[i].userId !== me.id && !isAdmin(me)) return err(403, 'Forbidden');
    const [removed] = leave.splice(i, 1);
    if (me.id !== removed.userId) {
      const who = db.get('users').find((u) => u.id === removed.userId);
      audit(db, me, 'DELETE', 'LEAVE', `Removed ${removed.type} leave for ${who?.name ?? removed.userId} (${removed.date})`, removed.userId, removed.domainId);
    }
    db.save();
    return ok({ deleted: true });
  }
  if (method === 'POST' && (p[3] === 'approve' || p[3] === 'reject')) {
    if (!isAdmin(me)) return err(403, 'Admin only');
    const l = leave.find((x) => x.id === p[2]);
    if (!l) return err(404, 'Leave not found');
    if (!canAccessDomain(db, me, l.domainId)) return err(403, 'Not your domain');
    l.status = p[3] === 'approve' ? 'APPROVED' : 'REJECTED';
    l.decidedBy = me.id;
    l.decidedAt = new Date().toISOString();
    const who = db.get('users').find((u) => u.id === l.userId);
    audit(db, me, p[3] === 'approve' ? 'APPROVE' : 'REJECT', 'LEAVE',
      `${p[3] === 'approve' ? 'Approved' : 'Rejected'} ${l.type} leave for ${who?.name ?? l.userId} (${l.date})`,
      l.userId, l.domainId);
    db.save();
    return ok(l);
  }
  return err(405, 'Method not allowed');
}

// ------------------------- Leave requests (range submissions) -------------------------

/** Working days in [start,end] inclusive, skipping weekends + Irish bank holidays. */
function expandWorkingDays(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;      // weekend
    if (isIrishBankHoliday(d)) continue;       // Irish public holiday
    out.push(isoDate(d));
  }
  return out;
}

/** Build a sorted, de-duped {date,halfDay} list from either body.days or a start/end range. */
function normaliseDays(body: any): { date: string; halfDay: boolean }[] {
  const map = new Map<string, boolean>();
  if (Array.isArray(body?.days)) {
    for (const d of body.days) { if (d?.date) map.set(d.date, !!d.halfDay); }
  } else if (body?.startDate && body?.endDate && body.endDate >= body.startDate) {
    for (const date of expandWorkingDays(body.startDate, body.endDate)) map.set(date, !!body.halfDay);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, halfDay]) => ({ date, halfDay }));
}

function toLeaveView(db: MockDb, rows: LeaveRequest[]): LeaveRequestView {
  const first = rows[0];
  const user = db.get('users').find((u) => u.id === first.userId);
  const dom = db.get('domains').find((d) => d.id === first.domainId);
  const decider = first.decidedBy ? db.get('users').find((u) => u.id === first.decidedBy) : undefined;
  return {
    id: first.submissionId, userId: first.userId, userName: user?.name ?? first.userId,
    domainId: first.domainId, domainName: dom?.name ?? first.domainId, type: first.type,
    startDate: first.startDate, endDate: first.endDate, halfDay: first.halfDay,
    hoursPerDay: first.hours, days: rows.length, totalHours: Math.round(rows.reduce((s, r) => s + r.hours, 0) * 100) / 100,
    perDay: [...rows].sort((a, b) => a.date.localeCompare(b.date)).map((r) => ({ date: r.date, halfDay: r.halfDay })),
    reason: first.reason, status: first.status, requestedAt: first.requestedAt,
    decidedBy: first.decidedBy, decidedByName: decider?.name, decidedAt: first.decidedAt,
    decisionReason: first.decisionReason,
  };
}
function leaveViewFor(db: MockDb, submissionId: string): LeaveRequestView | null {
  const rows = db.get('leaveRequests').filter((l) => l.submissionId === submissionId);
  return rows.length ? toLeaveView(db, rows) : null;
}
function groupLeaveViews(db: MockDb, rows: LeaveRequest[]): LeaveRequestView[] {
  const groups = new Map<string, LeaveRequest[]>();
  for (const r of rows) { const g = groups.get(r.submissionId) ?? []; g.push(r); groups.set(r.submissionId, g); }
  return [...groups.values()].map((g) => toLeaveView(db, g));
}
/** Who may decide a request: never your own; an admin's own request needs a Super Admin. */
function canDecide(db: MockDb, me: User, row: LeaveRequest): boolean {
  if (row.userId === me.id) return false;
  if (me.role === 'SUPER_ADMIN') return true;
  if (me.role !== 'DOMAIN_ADMIN' || !me.domainIds.includes(row.domainId)) return false;
  const requester = db.get('users').find((u) => u.id === row.userId);
  // Domain admins approve employees only; another admin's request goes to a Super Admin.
  return !!requester && requester.role === 'EMPLOYEE';
}

function leaveRequestsRoute(db: MockDb, me: User, req: ParsedReq): MockResult {
  const { method, segments: p, query, body } = req;
  const leave = db.get('leaveRequests');

  if (method === 'GET' && !p[2]) {
    const scope = query.get('scope');       // 'mine' | 'queue'
    const status = query.get('status');
    const domainId = query.get('domainId');
    const ids = visibleDomainIds(db, me);
    let rows = leave.filter((l) => ids.includes(l.domainId));
    if (scope === 'queue' && isAdmin(me)) {
      rows = rows.filter((l) => canDecide(db, me, l));   // requests this admin may act on
    } else {
      rows = rows.filter((l) => l.userId === me.id);      // 'mine' (default)
    }
    if (domainId) rows = rows.filter((l) => l.domainId === domainId);
    let views = groupLeaveViews(db, rows);
    if (status) views = views.filter((v) => v.status === status);
    views.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt) || b.startDate.localeCompare(a.startDate));
    return ok(views);
  }

  if (method === 'POST' && !p[2]) {
    const userId = body.userId ?? me.id;
    const domainId = body.domainId as string;
    if (!domainId || !body.type) return err(400, 'Missing required fields');
    const who = db.get('users').find((u) => u.id === userId);
    if (!who || !who.domainIds.includes(domainId)) return err(400, 'User is not in that domain');
    // Accept either an explicit per-day list (preferred) or a start/end range.
    const dayList = normaliseDays(body);
    if (!dayList.length) return err(400, 'No working days selected');
    const submissionId = uid('lr');
    const requestedAt = new Date().toISOString();
    const startDate = dayList[0].date, endDate = dayList[dayList.length - 1].date;
    for (const d of dayList) {
      const halfDay = body.type === 'BANK_HOLIDAY' ? false : d.halfDay;
      leave.push({
        id: uid('l'), submissionId, userId, domainId, type: body.type, date: d.date,
        hours: halfDay ? HALF_DAY_HOURS : MAX_LEAVE_HOURS_PER_DAY, halfDay,
        startDate, endDate, reason: body.reason, status: 'PENDING', requestedAt,
      });
    }
    db.save();
    return created(leaveViewFor(db, submissionId));
  }

  // Edit a PENDING request (replaces its per-day rows).
  if (method === 'PUT' && p[2]) {
    const rows = leave.filter((l) => l.submissionId === p[2]);
    if (!rows.length) return err(404, 'Request not found');
    const first = rows[0];
    if (first.userId !== me.id && !isAdmin(me)) return err(403, 'Forbidden');
    if (first.status !== 'PENDING') return err(400, 'Only pending requests can be edited');
    const type = body.type ?? first.type;
    const reason = body.reason !== undefined ? body.reason : first.reason;
    const dayList = normaliseDays(body);
    if (!dayList.length) return err(400, 'No working days selected');
    const startDate = dayList[0].date, endDate = dayList[dayList.length - 1].date;
    for (let i = leave.length - 1; i >= 0; i--) if (leave[i].submissionId === p[2]) leave.splice(i, 1);
    for (const d of dayList) {
      const halfDay = type === 'BANK_HOLIDAY' ? false : d.halfDay;
      leave.push({
        id: uid('l'), submissionId: p[2], userId: first.userId, domainId: first.domainId, type, date: d.date,
        hours: halfDay ? HALF_DAY_HOURS : MAX_LEAVE_HOURS_PER_DAY, halfDay,
        startDate, endDate, reason, status: 'PENDING', requestedAt: first.requestedAt,
      });
    }
    db.save();
    return ok(leaveViewFor(db, p[2]));
  }

  if (method === 'POST' && p[3] === 'withdraw') {
    const rows = leave.filter((l) => l.submissionId === p[2]);
    if (!rows.length) return err(404, 'Request not found');
    if (rows[0].userId !== me.id && !isAdmin(me)) return err(403, 'Forbidden');
    if (rows[0].status !== 'PENDING') return err(400, 'Only pending requests can be withdrawn');
    rows.forEach((r) => (r.status = 'WITHDRAWN'));
    db.save();
    return ok(leaveViewFor(db, p[2]));
  }

  if (method === 'POST' && (p[3] === 'approve' || p[3] === 'reject')) {
    if (!isAdmin(me)) return err(403, 'Admin only');
    const rows = leave.filter((l) => l.submissionId === p[2]);
    if (!rows.length) return err(404, 'Request not found');
    const first = rows[0];
    if (!canDecide(db, me, first)) return err(403, 'You cannot decide this request');
    if (first.status !== 'PENDING') return err(400, 'Request already decided');
    const decidedAt = new Date().toISOString();
    if (p[3] === 'approve') {
      const dates = new Set(rows.map((r) => r.date));
      rows.forEach((r) => { r.status = 'APPROVED'; r.decidedBy = me.id; r.decidedAt = decidedAt; });
      // New approval supersedes any earlier APPROVED leave on the same user+day.
      for (const other of leave) {
        if (other.submissionId !== p[2] && other.userId === first.userId
          && other.status === 'APPROVED' && dates.has(other.date)) other.status = 'SUPERSEDED';
      }
    } else {
      rows.forEach((r) => { r.status = 'REJECTED'; r.decidedBy = me.id; r.decidedAt = decidedAt; r.decisionReason = body.reason; });
    }
    const who = db.get('users').find((u) => u.id === first.userId);
    const range = first.startDate === first.endDate ? first.startDate : `${first.startDate} to ${first.endDate}`;
    audit(db, me, p[3] === 'approve' ? 'APPROVE' : 'REJECT', 'LEAVE',
      `${p[3] === 'approve' ? 'Approved' : 'Rejected'} ${first.type} leave request for ${who?.name ?? first.userId} (${range})`,
      first.userId, first.domainId);
    db.save();
    return ok(leaveViewFor(db, p[2]));
  }
  return err(405, 'Method not allowed');
}

// ------------------------- Visibility plan -------------------------

function visibility(db: MockDb, me: User, query: URLSearchParams) {
  const domainId = query.get('domainId');
  const month = query.get('month') ?? '2026-09'; // YYYY-MM
  const ids = visibleDomainIds(db, me);
  const scopeIds = domainId ? [domainId] : ids;

  const users = db.get('users').filter((u) => u.domainIds.some((d) => scopeIds.includes(d)));
  const scopedUsers = isAdmin(me) ? users : users.filter((u) => u.id === me.id);

  const rows = scopedUsers.map((u) => {
    const entries = db.get('timeEntries').filter(
      (e) => e.userId === u.id && scopeIds.includes(e.domainId) && e.date.startsWith(month),
    );
    const leaves = db.get('leaveRequests').filter(
      (l) => l.userId === u.id && scopeIds.includes(l.domainId) && l.date.startsWith(month)
        && l.status !== 'WITHDRAWN' && l.status !== 'SUPERSEDED', // show pending + approved (+ rejected still filtered client-side)
    );
    return { userId: u.id, name: u.name, entries, leaves };
  });
  return { month, rows };
}

// ------------------------- Uploads -------------------------

function uploadsRoute(db: MockDb, me: User, req: ParsedReq): MockResult {
  const { method, segments: p, query, body } = req;
  const uploaded = db.get('uploaded');
  if (!isAdmin(me)) return err(403, 'Admin only');

  if (method === 'GET') {
    const domainId = query.get('domainId');
    const month = query.get('month');
    const ids = visibleDomainIds(db, me);
    return ok(uploaded
      .filter((r) => ids.includes(r.domainId))
      .filter((r) => !domainId || r.domainId === domainId)
      .filter((r) => !month || r.month === month));
  }
  if (method === 'POST' && !p[2]) {
    // body.rows = UploadedRow[] (already parsed client-side from the xlsx)
    const rows = (body.rows ?? []) as any[];
    for (const r of rows) uploaded.push({ ...r, id: uid('up') });
    db.save();
    return created({ inserted: rows.length });
  }
  if (method === 'PUT' && p[2]) {
    const r = uploaded.find((x) => x.id === p[2]);
    if (!r) return err(404, 'Uploaded row not found');
    if (!canAccessDomain(db, me, r.domainId)) return err(403, 'Not your domain');
    if (body.hours !== undefined) r.hours = Math.round((Number(body.hours) || 0) * 100) / 100;
    if (body.wbsCode !== undefined) r.wbsCode = body.wbsCode;
    if (body.project !== undefined) r.project = body.project;
    db.save();
    return ok(r);
  }
  if (method === 'DELETE' && p[2]) {
    const i = uploaded.findIndex((x) => x.id === p[2]);
    if (i < 0) return err(404, 'Uploaded row not found');
    if (!canAccessDomain(db, me, uploaded[i].domainId)) return err(403, 'Not your domain');
    uploaded.splice(i, 1);
    db.save();
    return ok({ deleted: true });
  }
  return err(405, 'Method not allowed');
}

// ------------------------- Reports -------------------------

function reportsRoute(db: MockDb, me: User, req: ParsedReq): MockResult {
  const { segments: p, query } = req;
  if (p[2] === 'project-summary') return ok(projectSummary(db, me, query));
  if (p[2] === 'employee') return ok(employeeReport(db, me, query));
  return err(404, 'Unknown report');
}

/** Merge in-app (contractor) + uploaded (staff) hours, grouped by WBS. */
function projectSummary(db: MockDb, me: User, query: URLSearchParams): ProjectSummary {
  const scope = (query.get('scope') as 'DOMAIN' | 'ALL') ?? 'DOMAIN';
  const month = query.get('month') ?? '2026-09';
  const domainId = query.get('domainId');
  const ids = visibleDomainIds(db, me);
  const scopeIds = scope === 'ALL' ? ids : (domainId ? [domainId] : ids.slice(0, 1));

  const domains = db.get('domains');
  const wbs = db.get('wbsCodes');
  const users = db.get('users');
  const monthEnd = month + '-28';

  // key = userName|wbsCode -> row
  const map = new Map<string, ProjectSummaryRow>();
  const add = (name: string, code: string, project: string, hours: number, domName: string) => {
    const key = name + '|' + code;
    const existing = map.get(key);
    if (existing) { existing.hours += hours; existing.days = existing.hours / 8; }
    else map.set(key, { name, wbsCode: code, project, hours, days: hours / 8, domainName: domName });
  };

  // In-app entries (contractors)
  for (const e of db.get('timeEntries')) {
    if (!scopeIds.includes(e.domainId) || !e.date.startsWith(month)) continue;
    const u = users.find((x) => x.id === e.userId);
    const w = wbs.find((x) => x.id === e.wbsCodeId);
    if (!u || !w) continue;
    add(u.name, w.code, resolveWbsName(w, e.date), e.hours, domainName(domains, w.domainId));
  }
  // Uploaded rows (staff): aggregate per-day rows by resource+WBS for the month,
  // then add unless that person+WBS is already present in-app (in-app wins).
  const upAgg = new Map<string, { name: string; code: string; project: string; hours: number; dom: string }>();
  for (const r of db.get('uploaded')) {
    if (!scopeIds.includes(r.domainId) || r.month !== month) continue;
    const key = r.resourceName + '|' + r.wbsCode;
    const cur = upAgg.get(key) ?? { name: r.resourceName, code: r.wbsCode, project: r.project, hours: 0, dom: domainName(domains, r.domainId) };
    cur.hours += r.hours;
    upAgg.set(key, cur);
  }
  for (const a of upAgg.values()) {
    if (map.has(a.name + '|' + a.code)) continue;
    add(a.name, a.code, a.project, a.hours, a.dom);
  }

  const rows = [...map.values()].sort(
    (a, b) => a.project.localeCompare(b.project) || a.name.localeCompare(b.name),
  );
  const grandTotalHours = rows.reduce((s, r) => s + r.hours, 0);
  // Make the scope visible in the title so it shows as the export's heading
  // (single domain by name, or "All Domains" for the multi-domain export).
  const scopeLabel = scope === 'ALL'
    ? 'All Domains'
    : (scopeIds[0] ? domainName(domains, scopeIds[0]) : 'All Domains');
  return {
    title: `Timesheet Summary — ${scopeLabel} — ${monthLabel(month)}`,
    month, scope, rows,
    grandTotalHours, grandTotalDays: grandTotalHours / 8,
  };
}

function employeeReport(db: MockDb, me: User, query: URLSearchParams) {
  const userId = query.get('userId')!;
  const month = query.get('month') ?? '2026-09';
  const ids = visibleDomainIds(db, me);
  const wbs = db.get('wbsCodes');
  const u = db.get('users').find((x) => x.id === userId);
  const entries = db.get('timeEntries')
    .filter((e) => e.userId === userId && ids.includes(e.domainId) && e.date.startsWith(month))
    .map((e) => {
      const w = wbs.find((x) => x.id === e.wbsCodeId)!;
      return { date: e.date, wbsCode: w.code, project: resolveWbsName(w, e.date), hours: e.hours, notes: e.notes ?? '' };
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const leaves = db.get('leaveRequests')
    .filter((l) => l.userId === userId && ids.includes(l.domainId) && l.date.startsWith(month) && l.status === 'APPROVED')
    .map((l) => ({ date: l.date, type: l.type, hours: l.hours }));
  const totalHours = entries.reduce((s, e) => s + e.hours, 0);
  return {
    name: u?.name ?? userId, month, monthLabel: monthLabel(month),
    entries, leaves, totalHours, totalDays: totalHours / 8,
  };
}

function domainName(domains: Domain[], id: string): string {
  return domains.find((d) => d.id === id)?.name ?? id;
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-IE', { month: 'long', year: 'numeric' });
}

// ------------------------- Audit -------------------------

function scopedAudit(db: MockDb, me: User, query: URLSearchParams): AuditEntry[] {
  const ids = visibleDomainIds(db, me);
  const domainId = query.get('domainId');
  return db.get('audit')
    .filter((a) => !a.domainId || ids.includes(a.domainId))
    .filter((a) => !domainId || a.domainId === domainId)
    .sort((a, b) => b.at.localeCompare(a.at));
}

function audit(
  db: MockDb, actor: User, action: AuditEntry['action'], entity: AuditEntry['entity'],
  summary: string, targetUserId?: string, domainId?: string,
): void {
  const target = targetUserId ? db.get('users').find((u) => u.id === targetUserId) : undefined;
  db.get('audit').push({
    id: uid('a'), at: new Date().toISOString(), actorId: actor.id, actorName: actor.name,
    action, entity, targetUserId, targetUserName: target?.name, domainId, summary,
  });
}

function auditEntryEdit(
  db: MockDb, actor: User, e: TimeEntry, action: 'CREATE' | 'UPDATE' | 'DELETE', before?: number,
): void {
  const w = db.get('wbsCodes').find((x) => x.id === e.wbsCodeId);
  const detail = action === 'UPDATE' && before !== undefined
    ? `${before}h -> ${e.hours}h on ${w?.code} (${e.date})`
    : `${e.hours}h on ${w?.code} (${e.date})`;
  audit(db, actor, action, 'TIME_ENTRY', detail, e.userId, e.domainId);
}
