import {
  AuditEntry, Domain, LeaveRequest, TimeEntry, User, WbsCode,
} from '../models/models';

// A fixed "today" reference used by seed dates so the demo is deterministic.
export const SEED_TODAY = '2026-09-19';

export interface MockData {
  domains: Domain[];
  wbsCodes: WbsCode[];
  users: User[];
  timeEntries: TimeEntry[];
  leaveRequests: LeaveRequest[];
  audit: AuditEntry[];
  /** userId -> raw uploaded rows (external timesheet) keyed by month */
  uploaded: UploadedRow[];
}

/** A row from an uploaded external (e.g. SAP) timesheet export. */
export interface UploadedRow {
  id: string;
  month: string;      // "2026-09"
  domainId: string;
  userName: string;
  wbsCode: string;
  project: string;
  hours: number;
}

export function buildSeed(): MockData {
  const domains: Domain[] = [
    { id: 'd-aim', name: 'AIM', description: 'Asset & Investment Management', active: true },
    { id: 'd-fish', name: 'Fisheries', description: 'Fisheries Digital Programme', active: true },
  ];

  const wbsCodes: WbsCode[] = [
    {
      id: 'w-1001', domainId: 'd-aim', code: 'WBS-1001', clientCode: 'DLT-001', active: true,
      nameHistory: [
        { description: 'Portal Rebuild', validFrom: '2026-01-01', validTo: '2026-07-01' },
        { description: 'Deloitte Portal', validFrom: '2026-07-01', validTo: null },
      ],
    },
    {
      id: 'w-1002', domainId: 'd-aim', code: 'WBS-1002', clientCode: 'DLT-002', active: true,
      nameHistory: [{ description: 'Client Onboarding', validFrom: '2026-01-01', validTo: null }],
    },
    {
      id: 'w-1003', domainId: 'd-aim', code: 'WBS-1003', clientCode: 'DLT-003', active: true,
      nameHistory: [{ description: 'Data Migration', validFrom: '2026-01-01', validTo: null }],
    },
    {
      id: 'w-1004', domainId: 'd-aim', code: 'WBS-1004', clientCode: 'INT-004', active: true,
      nameHistory: [{ description: 'Internal Tools', validFrom: '2026-01-01', validTo: null }],
    },
    {
      id: 'w-2001', domainId: 'd-fish', code: 'WBS-2001', clientCode: 'FSH-001', active: true,
      nameHistory: [{ description: 'Aquamis External', validFrom: '2026-01-01', validTo: null }],
    },
    {
      id: 'w-2002', domainId: 'd-fish', code: 'WBS-2002', clientCode: 'FSH-002', active: true,
      nameHistory: [{ description: 'Bulk Renewals', validFrom: '2026-01-01', validTo: null }],
    },
    {
      id: 'w-2003', domainId: 'd-fish', code: 'WBS-2003', clientCode: 'FSH-003', active: true,
      nameHistory: [{ description: 'DIS — Smart Logbooks', validFrom: '2026-01-01', validTo: null }],
    },
  ];

  const users: User[] = [
    {
      id: 'u-super', name: 'Super Admin', username: 'super', email: 'super@deloitte.ie',
      role: 'SUPER_ADMIN', type: 'STAFF', domainIds: ['d-aim', 'd-fish'], active: true,
    },
    {
      id: 'u-admin', name: 'Admin User', username: 'admin', email: 'admin@deloitte.ie',
      role: 'DOMAIN_ADMIN', type: 'STAFF', domainIds: ['d-aim', 'd-fish'], active: true,
    },
    {
      id: 'u-alice', name: 'Alice Murphy', username: 'alice', email: 'alice@deloitte.ie',
      role: 'EMPLOYEE', type: 'CONTRACTOR', domainIds: ['d-aim', 'd-fish'], active: true,
    },
    {
      id: 'u-bob', name: 'Bob Kelly', username: 'bob', email: 'bob@deloitte.ie',
      role: 'EMPLOYEE', type: 'CONTRACTOR', domainIds: ['d-aim'], active: true,
    },
    {
      id: 'u-carol', name: 'Carol Byrne', username: 'carol', email: 'carol@deloitte.ie',
      role: 'EMPLOYEE', type: 'CONTRACTOR', domainIds: ['d-fish'], active: true,
    },
    // A STAFF user whose hours arrive only via upload (not logged in-app).
    {
      id: 'u-declan', name: 'Declan Roche', username: 'declan', email: 'declan@deloitte.ie',
      role: 'EMPLOYEE', type: 'STAFF', domainIds: ['d-fish'], active: true,
    },
  ];

  const timeEntries: TimeEntry[] = [
    entry('u-alice', 'd-aim', 'w-1001', '2026-09-17', 7.5, 'API integration'),
    entry('u-alice', 'd-aim', 'w-1002', '2026-09-18', 8, 'Requirements workshop'),
    entry('u-alice', 'd-fish', 'w-2001', '2026-09-16', 4, 'Aquamis sync'),
    entry('u-bob', 'd-aim', 'w-1003', '2026-09-18', 6.5, 'Data migration'),
    entry('u-carol', 'd-fish', 'w-2001', '2026-09-17', 8, 'Aquamis build'),
    entry('u-carol', 'd-fish', 'w-2002', '2026-09-18', 8, 'Bulk renewals'),
  ];

  const leaveRequests: LeaveRequest[] = [
    {
      id: 'l-1', userId: 'u-bob', domainId: 'd-aim', type: 'ANNUAL', date: '2026-09-22',
      hours: 7.25, notes: 'Family day', status: 'PENDING', requestedAt: '2026-09-18T09:00:00Z',
    },
    {
      id: 'l-2', userId: 'u-carol', domainId: 'd-fish', type: 'SICK', date: '2026-09-19',
      hours: 3.63, status: 'PENDING', requestedAt: '2026-09-19T08:30:00Z',
    },
    {
      id: 'l-3', userId: 'u-alice', domainId: 'd-aim', type: 'TRAINING', date: '2026-09-12',
      hours: 7.25, status: 'APPROVED', requestedAt: '2026-09-08T10:00:00Z',
      decidedBy: 'u-admin', decidedAt: '2026-09-09T11:00:00Z',
    },
  ];

  const uploaded: UploadedRow[] = [
    // Declan is STAFF: only appears via upload.
    { id: 'up-1', month: '2026-09', domainId: 'd-fish', userName: 'Declan Roche', wbsCode: 'WBS-2003', project: 'DIS — Smart Logbooks', hours: 160 },
    // Alice appears both in-app and uploaded, with a mismatch -> shows in Differences.
    { id: 'up-2', month: '2026-09', domainId: 'd-aim', userName: 'Alice Murphy', wbsCode: 'WBS-1001', project: 'Deloitte Portal', hours: 8 },
  ];

  return { domains, wbsCodes, users, timeEntries, leaveRequests, audit: [], uploaded };
}

let seq = 0;
function entry(
  userId: string, domainId: string, wbsCodeId: string, date: string, hours: number, notes?: string,
): TimeEntry {
  return {
    id: 't-' + (++seq), userId, domainId, wbsCodeId, date, hours, notes,
    source: 'IN_APP', updatedAt: date + 'T17:00:00Z', updatedBy: userId,
  };
}

// Demo credentials shown on the login screen.
export const DEMO_CREDENTIALS = [
  { username: 'super', password: 'super123', label: 'Super Admin' },
  { username: 'admin', password: 'admin123', label: 'Domain Admin' },
  { username: 'alice / bob / carol', password: 'password123', label: 'Employee' },
];

export const PASSWORDS: Record<string, string> = {
  super: 'super123', admin: 'admin123', alice: 'password123',
  bob: 'password123', carol: 'password123', declan: 'password123',
};
