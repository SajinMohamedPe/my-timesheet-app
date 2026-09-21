import { Component, computed, effect, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
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
import {
  addDays, BANK_HOLIDAY_HOURS, fmtRange, isIrishBankHoliday, isoDate, isWeekend, weekDays, weekStart,
} from '../../core/util/dates';

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
  imports: [FormsModule, RouterLink, MatIconModule, MatMenuModule, MatDatepickerModule, PageHeaderComponent, SearchSelectComponent, ConfirmDialogComponent],
  providers: [provideNativeDateAdapter()],
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
  private extraLeave = signal<Set<LeaveType>>(new Set()); // leave rows added via picker
  collapsedGroups = signal<Set<string>>(new Set()); // group keys that are collapsed
  entries = signal<TimeEntry[]>([]);
  leaves = signal<LeaveRequest[]>([]);
  saving = signal(false);
  justSaved = signal(false);

  /** Entries autosave per cell; Save re-syncs and confirms. */
  save(): void {
    this.reload();
    this.justSaved.set(true);
    setTimeout(() => this.justSaved.set(false), 2500);
  }

  constructor() {
    // Admins: when the active domain changes, reload the (domain-scoped) user
    // list and reset to a user in that domain. Employees have no switcher.
    effect(() => {
      const domainId = this.ctx.selectedId();
      if (!this.auth.isAdmin()) return;
      this.api.getUsers(domainId ?? undefined).subscribe((u) => {
        this.users.set(u);
        if (!u.some((x) => x.id === this.selectedUserId())) {
          this.selectedUserId.set(u[0]?.id ?? this.auth.user()!.id);
        }
        this.extraRows.set({}); this.extraLeave.set(new Set());
        this.reload();
      });
    });
  }

  ngOnInit(): void {
    this.selectedUserId.set(this.auth.user()!.id);
    if (!this.auth.isAdmin()) {
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
  /** Jump to the week containing any picked date. */
  pickWeek(d: Date | null): void { if (d) { this.weekAnchor.set(weekStart(d)); this.reload(); } }
  isWeekend = isWeekend;

  /**
   * Domains shown in the grid.
   * - Employee viewing their own sheet: ALL their domains (they work across
   *   projects, so no single-domain restriction).
   * - Admin viewing anyone: only the currently selected domain (anti-clutter;
   *   an AIM admin never sees a contractor's Fisheries rows).
   */
  groups = computed<DomainGroup[]>(() => {
    const user = this.selectedUser();
    if (!user) return [];
    const extra = this.extraRows();
    const activeDomain = this.ctx.selectedId();
    return this.domains()
      .filter((d) => user.domainIds.includes(d.id))
      .filter((d) => !this.auth.isAdmin() || !activeDomain || d.id === activeDomain)
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
    // Only leave types with data IN THE VISIBLE WEEK (plus rows added via the
    // picker this session) — so deleting a week's leave removes its row.
    const weekIsos = new Set(this.days().map((d) => isoDate(d)));
    const vis = this.visibleDomainIdSet();
    const withData = new Set(
      this.leaves()
        .filter((l) => weekIsos.has(l.date) && vis.has(l.domainId) && l.status === 'APPROVED')
        .map((l) => l.type),
    );
    this.extraLeave().forEach((t) => withData.add(t));
    // Irish public holidays are auto-marked, so always show the Bank Holiday row
    // when the visible week contains one.
    if (this.days().some((d) => isIrishBankHoliday(d))) withData.add('BANK_HOLIDAY');
    return this.leaveTypes.filter((lt) => withData.has(lt.type));
  });

  isIrishHoliday(day: Date): boolean { return isIrishBankHoliday(day); }
  /** A Bank-Holiday cell that is auto-filled (Irish holiday, no explicit record). */
  autoBankHoliday(day: Date): boolean {
    return isIrishBankHoliday(day) && !this.leaveFor('BANK_HOLIDAY', day);
  }

  // ---- Formatting (always 2 decimals) ----
  fmtCell(n: number | null): string { return n == null ? '' : n.toFixed(2); }
  fmtTotal(n: number): string { return n ? n.toFixed(2) : ''; }

  // ---- Per-group totals (for the grouped-block layout) ----
  private weekIsoSet = computed(() => new Set(this.days().map((d) => isoDate(d))));
  groupTotal(domainId: string): number {
    const iso = this.weekIsoSet();
    return Math.round(
      this.entries().filter((e) => e.domainId === domainId && iso.has(e.date))
        .reduce((s, e) => s + e.hours, 0) * 100) / 100;
  }
  absenceTotal(): number {
    return Math.round(this.visibleLeaveTypes().reduce((s, lt) => s + this.leaveRowTotal(lt.type), 0) * 100) / 100;
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

  // ---- Leave cells (editable; hours up to 7.25; edits re-trigger approval) ----
  leaveFor(type: LeaveType, day: Date): LeaveRequest | undefined {
    const d = isoDate(day);
    const vis = this.visibleDomainIdSet();
    // Only APPROVED leave appears on the timesheet grid, and it is read-only.
    // Pending/rejected are managed on the My Leave screen, not here.
    return this.leaves().find((l) => l.type === type && l.date === d && vis.has(l.domainId) && l.status === 'APPROVED');
  }
  leaveHours(type: LeaveType, day: Date): number | null {
    const l = this.leaveFor(type, day);
    if (l) return l.hours;
    if (type === 'BANK_HOLIDAY' && isIrishBankHoliday(day)) return BANK_HOLIDAY_HOURS; // auto
    return null;
  }
  // ---- Reusable in-app modal (charge-code row deletes) ----
  dialog = signal<{
    title: string; message: string; detail?: string; confirmLabel: string;
    danger: boolean; onConfirm: () => void; onCancel?: () => void;
  } | null>(null);

  runDialog(): void { const d = this.dialog(); this.dialog.set(null); d?.onConfirm(); }
  closeDialog(): void { const d = this.dialog(); this.dialog.set(null); d?.onCancel?.(); }

  askRemoveWbs(row: WbsRow): void {
    const count = this.days().map((d) => this.entryFor(row.wbs.id, d)).filter(Boolean).length;
    this.dialog.set({
      title: 'Delete charge code row?',
      message: `This will delete the entire ${row.wbs.code} — ${row.wbs.currentName} row for ${this.rangeLabel()}, including ${count} time ${count === 1 ? 'entry' : 'entries'} logged against it this week.`,
      detail: 'The whole record will be removed and this action cannot be undone.',
      confirmLabel: 'Delete record', danger: true,
      onConfirm: () => this.doRemoveWbs(row),
    });
  }
  private doRemoveWbs(row: WbsRow): void {
    this.saving.set(true);
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
  }

  // ---- Totals (scoped to the domains currently shown in the grid) ----
  private visibleDomainIdSet = computed(() => new Set(this.groups().map((g) => g.domain.id)));

  dayTotal(day: Date): number {
    const d = isoDate(day);
    const vis = this.visibleDomainIdSet();
    const t = this.entries().filter((e) => e.date === d && vis.has(e.domainId)).reduce((s, e) => s + e.hours, 0);
    let lv = this.leaves().filter((l) => l.date === d && l.status === 'APPROVED' && vis.has(l.domainId))
      .reduce((s, l) => s + (l.hours || 0), 0);
    if (this.autoBankHoliday(day)) lv += BANK_HOLIDAY_HOURS; // auto Irish bank holiday
    return Math.round((t + lv) * 100) / 100;
  }
  rowTotal(wbsId: string): number {
    return Math.round(this.days().reduce((s, d) => s + (this.hoursFor(wbsId, d) ?? 0), 0) * 100) / 100;
  }
  leaveRowTotal(type: LeaveType): number {
    return Math.round(this.days().reduce((s, d) => {
      const l = this.leaveFor(type, d);
      if (l) return s + (l.status !== 'REJECTED' ? (l.hours || 0) : 0);
      if (type === 'BANK_HOLIDAY' && isIrishBankHoliday(d)) return s + BANK_HOLIDAY_HOURS; // auto
      return s;
    }, 0) * 100) / 100;
  }
  weekTotal = computed(() => Math.round(this.days().reduce((s, d) => s + this.dayTotal(d), 0) * 100) / 100);
}
