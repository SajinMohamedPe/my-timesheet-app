import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { forkJoin } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService, WbsCodeView } from '../../core/services/api.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { SearchSelectComponent, SelectOption } from '../../shared/search-select.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import {
  Domain, LeaveRequest, LeaveType, MAX_LEAVE_HOURS_PER_DAY, TimeEntry, User,
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

const LEAVE_KEY: Record<LeaveType, string> = {
  ANNUAL: 'annual', SICK: 'sick', TRAINING: 'training', INTERNAL: 'internal', BANK_HOLIDAY: 'bank',
};

@Component({
  selector: 'dtt-weekly-grid',
  imports: [FormsModule, MatIconModule, MatMenuModule, PageHeaderComponent, SearchSelectComponent, ConfirmDialogComponent],
  templateUrl: './weekly-grid.component.html',
  styleUrl: './weekly-grid.component.scss',
})
export class WeeklyGridComponent implements OnInit {
  auth = inject(AuthService);
  ctx = inject(DomainContextService);
  private api = inject(ApiService);

  readonly leaveTypes = LEAVE_TYPES;
  readonly maxLeave = MAX_LEAVE_HOURS_PER_DAY;
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
  private extraLeave = signal<Set<LeaveType>>(new Set()); // leave rows added via picker
  collapsedGroups = signal<Set<string>>(new Set()); // group keys that are collapsed
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

  changeUser(id: string): void {
    this.selectedUserId.set(id); this.extraRows.set({}); this.extraLeave.set(new Set()); this.reload();
  }
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
  /** Options for the "Add charge code" searchable dropdown. */
  wbsOptions(domainId: string): SelectOption[] {
    return this.availableToAdd(domainId).map((w) => ({ value: w.id, label: w.code, sub: w.currentName }));
  }
  addRow(domainId: string, wbsId: string): void {
    const cur = { ...this.extraRows() };
    cur[domainId] = [...(cur[domainId] ?? []), wbsId];
    this.extraRows.set(cur);
  }

  // ---- Collapsible groups ----
  toggleGroup(key: string): void {
    const s = new Set(this.collapsedGroups());
    s.has(key) ? s.delete(key) : s.add(key);
    this.collapsedGroups.set(s);
  }
  isCollapsed(key: string): boolean { return this.collapsedGroups().has(key); }

  // ---- Leave rows (only show added / existing types) ----
  visibleLeaveTypes = computed(() => {
    const withData = new Set(this.leaves().map((l) => l.type));
    this.extraLeave().forEach((t) => withData.add(t));
    return this.leaveTypes.filter((lt) => withData.has(lt.type));
  });
  leaveOptions = computed<SelectOption[]>(() => {
    const shown = new Set(this.visibleLeaveTypes().map((lt) => lt.type));
    return this.leaveTypes.filter((lt) => !shown.has(lt.type)).map((lt) => ({ value: lt.type, label: lt.label }));
  });
  addLeaveRow(type: string): void {
    const s = new Set(this.extraLeave());
    s.add(type as LeaveType);
    this.extraLeave.set(s);
  }

  // ---- Formatting (always 2 decimals) ----
  fmtCell(n: number | null): string { return n == null ? '' : n.toFixed(2); }
  fmtTotal(n: number): string { return n ? n.toFixed(2) : ''; }

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

  // ---- Leave cells (editable; hours up to 7.25; edits re-trigger approval) ----
  leaveFor(type: LeaveType, day: Date): LeaveRequest | undefined {
    const d = isoDate(day);
    return this.leaves().find((l) => l.type === type && l.date === d);
  }
  leaveHours(type: LeaveType, day: Date): number | null {
    return this.leaveFor(type, day)?.hours ?? null;
  }
  leaveStatusClass(type: LeaveType, day: Date): string {
    const l = this.leaveFor(type, day);
    return l ? l.status.toLowerCase() : '';
  }
  leaveStatusLabel(type: LeaveType, day: Date): string {
    const l = this.leaveFor(type, day);
    return l ? l.status : '';
  }
  leaveKey(type: LeaveType): string { return LEAVE_KEY[type]; }
  setLeave(type: LeaveType, day: Date, value: string): void {
    const existing = this.leaveFor(type, day);
    const date = isoDate(day);
    const domainId = this.ctx.selectedId() ?? this.selectedUser()?.domainIds[0]!;
    this.saving.set(true);
    const done = () => { this.saving.set(false); this.reload(); };
    let num = parseFloat(value);
    if (!value || isNaN(num) || num <= 0) {
      if (existing) this.api.deleteLeave(existing.id).subscribe(done); else this.saving.set(false);
      return;
    }
    num = Math.min(this.maxLeave, Math.round(num * 100) / 100); // cap at 7.25
    if (existing) {
      this.api.updateLeave(existing.id, { hours: num }).subscribe(done); // resets to PENDING
    } else {
      this.api.createLeave({ userId: this.selectedUserId(), domainId, type, date, hours: num }).subscribe(done);
    }
  }

  // ---- Remove rows (confirmed via in-app modal) ----
  confirmState = signal<
    | { kind: 'wbs'; row: WbsRow; title: string; message: string; detail: string }
    | { kind: 'leave'; type: LeaveType; title: string; message: string; detail: string }
    | null
  >(null);

  askRemoveWbs(row: WbsRow): void {
    const count = this.days().map((d) => this.entryFor(row.wbs.id, d)).filter(Boolean).length;
    this.confirmState.set({
      kind: 'wbs', row,
      title: 'Delete charge code row?',
      message: `This will delete the entire ${row.wbs.code} — ${row.wbs.currentName} row for ${this.rangeLabel()}, including ${count} time ${count === 1 ? 'entry' : 'entries'} logged against it this week.`,
      detail: 'The whole record will be removed and this action cannot be undone.',
    });
  }
  askRemoveLeave(type: LeaveType): void {
    const label = this.leaveTypes.find((l) => l.type === type)?.label ?? 'leave';
    const count = this.days().map((d) => this.leaveFor(type, d)).filter(Boolean).length;
    this.confirmState.set({
      kind: 'leave', type,
      title: 'Delete leave row?',
      message: `This will delete the entire ${label} row for ${this.rangeLabel()}, including ${count} leave ${count === 1 ? 'request' : 'requests'} this week (approved or pending).`,
      detail: 'The whole record will be removed and this action cannot be undone.',
    });
  }
  cancelConfirm(): void { this.confirmState.set(null); }

  performConfirm(): void {
    const state = this.confirmState();
    if (!state) return;
    this.confirmState.set(null);
    this.saving.set(true);
    if (state.kind === 'wbs') {
      const row = state.row;
      const toDelete = this.days().map((d) => this.entryFor(row.wbs.id, d)).filter((e): e is TimeEntry => !!e);
      const after = () => {
        const cur = { ...this.extraRows() };
        cur[row.wbs.domainId] = (cur[row.wbs.domainId] ?? []).filter((id) => id !== row.wbs.id);
        this.extraRows.set(cur);
        this.saving.set(false); this.reload();
      };
      if (!toDelete.length) { after(); return; }
      let done = 0;
      toDelete.forEach((e) => this.api.deleteTimeEntry(e.id).subscribe(() => { if (++done === toDelete.length) after(); }));
    } else {
      const type = state.type;
      const toDelete = this.days().map((d) => this.leaveFor(type, d)).filter((l): l is LeaveRequest => !!l);
      const after = () => {
        const s = new Set(this.extraLeave()); s.delete(type); this.extraLeave.set(s);
        this.saving.set(false); this.reload();
      };
      if (!toDelete.length) { after(); return; }
      let done = 0;
      toDelete.forEach((l) => this.api.deleteLeave(l.id).subscribe(() => { if (++done === toDelete.length) after(); }));
    }
  }

  // ---- Totals ----
  dayTotal(day: Date): number {
    const d = isoDate(day);
    const t = this.entries().filter((e) => e.date === d).reduce((s, e) => s + e.hours, 0);
    const lv = this.leaves().filter((l) => l.date === d && l.status !== 'REJECTED')
      .reduce((s, l) => s + (l.hours || 0), 0);
    return Math.round((t + lv) * 100) / 100;
  }
  rowTotal(wbsId: string): number {
    return Math.round(this.days().reduce((s, d) => s + (this.hoursFor(wbsId, d) ?? 0), 0) * 100) / 100;
  }
  leaveRowTotal(type: LeaveType): number {
    return Math.round(this.days().reduce((s, d) => {
      const l = this.leaveFor(type, d);
      return s + (l && l.status !== 'REJECTED' ? (l.hours || 0) : 0);
    }, 0) * 100) / 100;
  }
  weekTotal = computed(() => Math.round(this.days().reduce((s, d) => s + this.dayTotal(d), 0) * 100) / 100);
}
