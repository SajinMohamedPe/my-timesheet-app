// ---------------------------------------------------------------------------
// Domain model for the Deloitte Timesheet System.
// "Domain" = an internal Deloitte engagement/project (e.g. AIM, Fisheries).
// Hierarchy: Domain -> WBS code (effective-dated names) -> time entries.
// ---------------------------------------------------------------------------

export type Role = 'SUPER_ADMIN' | 'DOMAIN_ADMIN' | 'EMPLOYEE';
export type UserType = 'CONTRACTOR' | 'STAFF';

/** A Deloitte engagement/project that scopes users, WBS codes and data. */
export interface Domain {
  id: string;
  name: string;        // e.g. "AIM"
  description: string; // e.g. "Asset & Investment Management"
  active: boolean;
}

/** One effective-dated name for a WBS code. */
export interface WbsName {
  description: string;
  validFrom: string;       // ISO date (inclusive)
  validTo: string | null;  // ISO date (exclusive) or null = current
}

/** A WBS code belongs to a domain. Its display name changes over time. */
export interface WbsCode {
  id: string;
  domainId: string;
  code: string;            // stable identifier, e.g. "WBS-1001"
  clientCode: string;      // "DLT-001" etc (the Code/Description column)
  nameHistory: WbsName[];  // ordered; resolve by date
  active: boolean;
}

export interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  type: UserType;
  domainIds: string[];     // a contractor may span multiple domains
  active: boolean;
}

/** Hours logged against a WBS code on a given day. Saves freely, no approval. */
export interface TimeEntry {
  id: string;
  userId: string;
  domainId: string;
  wbsCodeId: string;
  date: string;            // ISO date
  hours: number;
  notes?: string;
  source: 'IN_APP' | 'UPLOADED';
  updatedAt: string;
  updatedBy: string;       // userId of last editor (for audit)
}

export type LeaveType =
  | 'ANNUAL'
  | 'SICK'
  | 'TRAINING'
  | 'INTERNAL'            // Deloitte Internal Days / Practice Days / All Hands / Gems
  | 'BANK_HOLIDAY';

export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type LeaveDuration = 'FULL' | 'HALF'; // FULL = 8h, HALF = 4h

/** All leave requires domain-admin approval. */
export interface LeaveRequest {
  id: string;
  userId: string;
  domainId: string;
  type: LeaveType;
  date: string;            // ISO date
  duration: LeaveDuration;
  notes?: string;
  status: LeaveStatus;
  requestedAt: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'APPROVE' | 'REJECT';
  entity: 'TIME_ENTRY' | 'LEAVE' | 'WBS' | 'USER' | 'DOMAIN';
  targetUserId?: string;
  targetUserName?: string;
  domainId?: string;
  summary: string;         // human readable, e.g. "8h -> 6h on WBS-1001 (Mon 15 Sep)"
}

// ------------------------- Auth -------------------------

export interface LoginRequest { username: string; password: string; }

export interface AuthUser {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  type: UserType;
  domainIds: string[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

// ------------------------- Reports -------------------------

export interface ProjectSummaryRow {
  name: string;
  wbsCode: string;
  project: string;   // WBS description effective for the period
  hours: number;
  days: number;      // hours / 8
  domainName?: string; // present when scope = all domains
}

export interface ProjectSummary {
  title: string;         // "Project Summary — September 2026"
  month: string;         // "2026-09"
  scope: 'DOMAIN' | 'ALL';
  rows: ProjectSummaryRow[];
  grandTotalHours: number;
  grandTotalDays: number;
}
