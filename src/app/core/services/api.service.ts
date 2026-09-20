import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AuditEntry, Domain, LeaveRequest, ProjectSummary, TimeEntry, User, WbsCode,
} from '../models/models';

export interface WbsCodeView extends WbsCode { currentName: string; }

export interface VisibilityRow {
  userId: string; name: string; entries: TimeEntry[]; leaves: LeaveRequest[];
}
export interface VisibilityPlan { month: string; rows: VisibilityRow[]; }

export interface UploadedRow {
  id: string;
  domainId: string;
  month: string;          // derived from workDate (YYYY-MM)
  workDate: string;       // YYYY-MM-DD
  wbsCode: string;
  project: string;        // WBS L4 name
  associateName: string;  // "Last, First"
  resourceName: string;   // "First Last" — used for display & matching
  hours: number;
}

export interface EmployeeReport {
  name: string; month: string; monthLabel: string; totalHours: number; totalDays: number;
  entries: { date: string; wbsCode: string; project: string; hours: number; notes: string }[];
  leaves: { date: string; type: string; hours: number }[];
}

const base = environment.apiBase;

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // Domains
  getDomains() { return this.http.get<Domain[]>(`${base}/domains`); }
  createDomain(d: Partial<Domain>) { return this.http.post<Domain>(`${base}/domains`, d); }
  updateDomain(id: string, d: Partial<Domain>) { return this.http.put<Domain>(`${base}/domains/${id}`, d); }
  deleteDomain(id: string) { return this.http.delete(`${base}/domains/${id}`); }

  // WBS codes
  getWbs(domainId?: string) {
    return this.http.get<WbsCodeView[]>(`${base}/wbs`, { params: params({ domainId }) });
  }
  createWbs(w: { domainId: string; code: string; clientCode?: string; description: string }) {
    return this.http.post<WbsCode>(`${base}/wbs`, w);
  }
  updateWbs(id: string, w: Partial<{ description: string; clientCode: string; active: boolean }>) {
    return this.http.put<WbsCode>(`${base}/wbs/${id}`, w);
  }
  deleteWbs(id: string) { return this.http.delete(`${base}/wbs/${id}`); }

  // Users
  getUsers(domainId?: string) {
    return this.http.get<User[]>(`${base}/users`, { params: params({ domainId }) });
  }
  createUser(u: Partial<User>) { return this.http.post<User>(`${base}/users`, u); }
  updateUser(id: string, u: Partial<User>) { return this.http.put<User>(`${base}/users/${id}`, u); }
  grantAdmin(id: string, domainIds?: string[]) {
    return this.http.post<User>(`${base}/users/${id}/grant-admin`, { domainIds });
  }
  revokeAdmin(id: string) { return this.http.post<User>(`${base}/users/${id}/revoke-admin`, {}); }

  // Time entries
  getTimeEntries(q: { userId?: string; domainId?: string; from?: string; to?: string }) {
    return this.http.get<TimeEntry[]>(`${base}/time-entries`, { params: params(q) });
  }
  createTimeEntry(e: Partial<TimeEntry>) { return this.http.post<TimeEntry>(`${base}/time-entries`, e); }
  updateTimeEntry(id: string, e: Partial<TimeEntry>) { return this.http.put<TimeEntry>(`${base}/time-entries/${id}`, e); }
  deleteTimeEntry(id: string) { return this.http.delete(`${base}/time-entries/${id}`); }

  // Leave
  getLeave(q: { domainId?: string; status?: string; userId?: string } = {}) {
    return this.http.get<LeaveRequest[]>(`${base}/leave`, { params: params(q) });
  }
  createLeave(l: Partial<LeaveRequest>) { return this.http.post<LeaveRequest>(`${base}/leave`, l); }
  updateLeave(id: string, l: Partial<LeaveRequest>) { return this.http.put<LeaveRequest>(`${base}/leave/${id}`, l); }
  deleteLeave(id: string) { return this.http.delete(`${base}/leave/${id}`); }
  approveLeave(id: string) { return this.http.post<LeaveRequest>(`${base}/leave/${id}/approve`, {}); }
  rejectLeave(id: string) { return this.http.post<LeaveRequest>(`${base}/leave/${id}/reject`, {}); }

  // Visibility
  getVisibility(domainId: string | null, month: string) {
    return this.http.get<VisibilityPlan>(`${base}/visibility`, { params: params({ domainId, month }) });
  }

  // Uploads
  getUploads(domainId: string | null, month: string) {
    return this.http.get<UploadedRow[]>(`${base}/uploads`, { params: params({ domainId, month }) });
  }
  uploadRows(rows: Omit<UploadedRow, 'id'>[]) {
    return this.http.post<{ inserted: number }>(`${base}/uploads`, { rows });
  }

  // Reports
  getProjectSummary(q: { scope: 'DOMAIN' | 'ALL'; domainId?: string | null; month: string }) {
    return this.http.get<ProjectSummary>(`${base}/reports/project-summary`, { params: params(q) });
  }
  getEmployeeReport(userId: string, month: string) {
    return this.http.get<EmployeeReport>(`${base}/reports/employee`, { params: params({ userId, month }) });
  }

  // Audit
  getAudit(domainId?: string | null) {
    return this.http.get<AuditEntry[]>(`${base}/audit`, { params: params({ domainId }) });
  }

  // Reset demo data
  resetDemo() { return this.http.post(`${base}/admin/reset`, {}); }
}

function params(obj: Record<string, unknown>): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  }
  return p;
}
