import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService, WbsCodeView } from '../../core/services/api.service';
import {
  Domain, LeaveDuration, LeaveRequest, LeaveType, TimeEntry, User,
} from '../../core/models/models';
import { addDays, fmtRange, isoDate, isWeekend, weekDays, weekStart } from '../../core/util/dates';

interface WbsRow { wbs: WbsCodeView; }
interface DomainGroup { domain: Domain; rows: WbsRow[]; }

const LEAVE_TYPES: { type: LeaveType; label: string }[] = [
  { type: 'ANNUAL', label: 'Annual Leave' },
  { type: 'SICK', label: 'Sick Leave' },
  { type: 'TRAINING', label: 'Deloitte Training' },
  { type: 'INTERNAL', label: 'Internal / All-Hands / Gems' },
  { type: 'BANK_HOLIDAY', label: 'Bank Holiday' },
];

@Component({
  selector: 'dtt-weekly-grid',
  imports: [FormsModule, MatIconModule, MatMenuModule],
  templateUrl: './weekly-grid.component.html',
  styleUrl: './weekly-grid.component.scss',
})
export class WeeklyGridComponent implements OnInit {
  auth = inject(AuthService);
  ctx = inject(DomainContextService);
  private api = inject(ApiService);

  readonly leaveTypes = LEAVE_TYPES;
  weekAnchor = signal(weekStart(new Date()));
  days = computed(() => weekDays(this.weekAnchor()));
  rangeLabel = computed(() => fmtRange(this.days()));

  // Admin can pick whose timesheet to edit.
  users = signal<User[]>([]);
  selectedUserId = signal<string>('');
  selectedUser = computed(() => this.users().find((u) => u.id === this.selectedUserId()));

  private allWbs = signal<WbsCodeView[]>([]);
  private domains = signal<Domain[]>([]);
  private extraRows = signal<Record<string, string[]>>({}); // domainId -> wbsIds added manually
  entries = signal<TimeEntry[]>([]);
  leaves = signal<LeaveRequest[]>([]);
  saving = signal(false);

  ngOnInit(): void {
    this.selectedUserId.set(this.auth.user()!.id);
    if (this.auth.isAdmin()) {
      this.api.getUsers(this.ctx.selectedId() ?? undefined).subscribe((u) => {
        this.users.set(u);
        if (!u.some((x) => x.id === this.selectedUserId())) this.selectedUserId.set(u[0]?.id ?? this.auth.user()!.id);
      });
    } else {
      this.users.set([this.auth.user() as unknown as User]);
    }
    this.api.getDomains().subscribe((d) => this.domains.set(d));
    this.reload();
  }

  reload(): void {
    const from = isoDate(this.days()[0]);
    const to = isoDate(this.days()[6]);
    const userId = this.selectedUserId();
    forkJoin({
      wbs: this.api.getWbs(),
      entries: this.api.getTimeEntries({ userId, from, to }),
      leaves: this.api.getLeave({ userId }),
    }).subscribe(({ wbs, entries, leaves }) => {
      this.allWbs.set(wbs);
      this.entries.set(entries);
      this.leaves.set(leaves);
    });
  }

  changeUser(id: string): void { this.selectedUserId.set(id); this.extraRows.set({}); this.reload(); }
  prevWeek(): void { this.weekAnchor.set(addDays(this.weekAnchor(), -7)); this.reload(); }
  nextWeek(): void { this.weekAnchor.set(addDays(this.weekAnchor(), 7)); this.reload(); }
  isWeekend = isWeekend;

  /** Domains the selected user belongs to, each with its WBS rows for the grid. */
  groups = computed<DomainGroup[]>(() => {
    const user = this.selectedUser();
    if (!user) return [];
    const extra = this.extraRows();
    return this.domains()
      .filter((d) => user.domainIds.includes(d.id))
      .map((domain) => {
        const domainWbs = this.allWbs().filter((w) => w.domainId === domain.id);
        const usedIds = new Set(this.entries().filter((e) => e.domainId === domain.id).map((e) => e.wbsCodeId));
        (extra[domain.id] ?? []).forEach((id) => usedIds.add(id));
        const rows = domainWbs.filter((w) => usedIds.has(w.id)).map((wbs) => ({ wbs }));
        return { domain, rows };
      });
  });

  availableToAdd(domainId: string): WbsCodeView[] {
    const shown = new Set(this.groups().find((g) => g.domain.id === domainId)?.rows.map((r) => r.wbs.id));
    return this.allWbs().filter((w) => w.domainId === domainId && !shown.has(w.id));
  }
  addRow(domainId: string, wbsId: string): void {
    const cur = { ...this.extraRows() };
    cur[domainId] = [...(cur[domainId] ?? []), wbsId];
    this.extraRows.set(cur);
  }

  // ---- Time cells ----
  entryFor(wbsId: string, day: Date): TimeEntry | undefined {
    const d = isoDate(day);
    return this.entries().find((e) => e.wbsCodeId === wbsId && e.date === d);
  }
  hoursFor(wbsId: string, day: Date): number | null {
    return this.entryFor(wbsId, day)?.hours ?? null;
  }
  setHours(row: WbsRow, day: Date, value: string): void {
    const hours = parseFloat(value);
    const existing = this.entryFor(row.wbs.id, day);
    const date = isoDate(day);
    this.saving.set(true);
    const done = () => { this.saving.set(false); this.reload(); };
    if (!value || isNaN(hours) || hours <= 0) {
      if (existing) this.api.deleteTimeEntry(existing.id).subscribe(done); else this.saving.set(false);
      return;
    }
    if (existing) {
      this.api.updateTimeEntry(existing.id, { hours }).subscribe(done);
    } else {
      this.api.createTimeEntry({
        userId: this.selectedUserId(), domainId: row.wbs.domainId, wbsCodeId: row.wbs.id, date, hours,
      }).subscribe(done);
    }
  }

  // ---- Leave cells ----
  leaveFor(type: LeaveType, day: Date): LeaveRequest | undefined {
    const d = isoDate(day);
    return this.leaves().find((l) => l.type === type && l.date === d);
  }
  leaveDisplay(type: LeaveType, day: Date): string {
    const l = this.leaveFor(type, day);
    if (!l) return '';
    const h = l.duration === 'HALF' ? '4' : '8';
    return h;
  }
  leaveStatusClass(type: LeaveType, day: Date): string {
    const l = this.leaveFor(type, day);
    return l ? l.status.toLowerCase() : '';
  }
  setLeave(type: LeaveType, day: Date, value: string): void {
    const existing = this.leaveFor(type, day);
    const date = isoDate(day);
    const domainId = this.ctx.selectedId() ?? this.selectedUser()?.domainIds[0]!;
    this.saving.set(true);
    const done = () => { this.saving.set(false); this.reload(); };
    const num = parseFloat(value);
    if (!value || isNaN(num) || num <= 0) { this.saving.set(false); return; }
    const duration: LeaveDuration = num <= 4 ? 'HALF' : 'FULL';
    if (existing) { this.saving.set(false); return; } // already requested; managed via approvals
    this.api.createLeave({ userId: this.selectedUserId(), domainId, type, date, duration }).subscribe(done);
  }

  // ---- Totals ----
  dayTotal(day: Date): number {
    const d = isoDate(day);
    const t = this.entries().filter((e) => e.date === d).reduce((s, e) => s + e.hours, 0);
    const lv = this.leaves().filter((l) => l.date === d && l.status !== 'REJECTED')
      .reduce((s, l) => s + (l.duration === 'HALF' ? 4 : 8), 0);
    return t + lv;
  }
  rowTotal(wbsId: string): number {
    return this.days().reduce((s, d) => s + (this.hoursFor(wbsId, d) ?? 0), 0);
  }
  leaveRowTotal(type: LeaveType): number {
    return this.days().reduce((s, d) => {
      const l = this.leaveFor(type, d);
      return s + (l && l.status !== 'REJECTED' ? (l.duration === 'HALF' ? 4 : 8) : 0);
    }, 0);
  }
  weekTotal = computed(() => this.days().reduce((s, d) => s + this.dayTotal(d), 0));
}
