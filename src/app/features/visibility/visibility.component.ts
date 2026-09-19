import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import * as XLSX from 'xlsx';
import { AuthService } from '../../core/services/auth.service';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService, UploadedRow, VisibilityPlan, WbsCodeView } from '../../core/services/api.service';
import { currentMonth, isIrishBankHoliday, BANK_HOLIDAY_HOURS, isoDate } from '../../core/util/dates';
import { ExportService } from '../../core/services/export.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { LeaveType, LeaveRequest, TimeEntry } from '../../core/models/models';

type Tab = 'LIVE' | 'UPLOADED' | 'DIFF';

interface Cell {
  label: string;
  kind: 'work' | 'leave' | 'bank' | 'empty' | 'pending' | 'mixed';
  type?: LeaveType;
  total: number;
  over8: boolean;
}
interface DiffRow { name: string; wbsCode: string; project: string; app: number; uploaded: number; delta: number; }
interface DaySel { userId: string; name: string; iso: string; label: string; }

const LEAVE_COLORS: Record<LeaveType, string> = {
  ANNUAL: 'annual', SICK: 'sick', TRAINING: 'training', INTERNAL: 'internal', BANK_HOLIDAY: 'bank',
};
const LEAVE_HEX: Record<LeaveType, string> = {
  ANNUAL: '#e53935', SICK: '#ab30c4', TRAINING: '#f4b400', INTERNAL: '#1976d2', BANK_HOLIDAY: '#607d8b',
};
const LEAVE_LABELS: Record<LeaveType, string> = {
  ANNUAL: 'Annual Leave', SICK: 'Sick Leave', TRAINING: 'Deloitte Training',
  INTERNAL: 'Internal / All-Hands / Gems', BANK_HOLIDAY: 'Bank Holiday',
};
const MAX_DAY_HOURS = 8;

@Component({
  selector: 'dtt-visibility',
  imports: [FormsModule, MatIconModule, MatMenuModule, MatDatepickerModule, PageHeaderComponent],
  providers: [provideNativeDateAdapter()],
  templateUrl: './visibility.component.html',
  styleUrl: './visibility.component.scss',
})
export class VisibilityComponent implements OnInit {
  auth = inject(AuthService);
  ctx = inject(DomainContextService);
  private api = inject(ApiService);
  private exporter = inject(ExportService);

  tab = signal<Tab>('LIVE');
  showLegend = signal(true);
  month = signal(currentMonth()); // YYYY-MM
  plan = signal<VisibilityPlan | null>(null);
  uploaded = signal<UploadedRow[]>([]);
  wbs = signal<WbsCodeView[]>([]);
  busy = signal('');
  daySel = signal<DaySel | null>(null); // admin edit modal target

  monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleString('en-IE', { month: 'long', year: 'numeric' });
  });
  daysInMonth = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return Array.from({ length: new Date(y, m, 0).getDate() }, (_, i) => new Date(y, m - 1, i + 1));
  });

  constructor() {
    effect(() => { this.ctx.selectedId(); this.month(); this.load(); });
  }
  ngOnInit(): void { this.load(); }

  private load(): void {
    // Admins scope to the active domain; an employee sees ALL their own domains.
    const domainId = this.auth.isAdmin() ? this.ctx.selectedId() : null;
    this.api.getVisibility(domainId, this.month()).subscribe((p) => this.plan.set(p));
    if (this.auth.isAdmin()) {
      this.api.getUploads(domainId, this.month()).subscribe((u) => this.uploaded.set(u));
      this.api.getWbs(domainId ?? undefined).subscribe((w) => this.wbs.set(w));
    }
  }

  prevMonth(): void { this.shiftMonth(-1); }
  nextMonth(): void { this.shiftMonth(1); }
  /** Jump to any month from the calendar's year view. */
  pickMonth(d: Date, picker: { close: () => void }): void {
    this.month.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    picker.close();
  }
  private shiftMonth(n: number): void {
    const [y, m] = this.month().split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    // Local parts, NOT toISOString (which shifts the month in +UTC timezones).
    this.month.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }

  isWeekend(d: Date): boolean { const g = d.getDay(); return g === 0 || g === 6; }

  cell(userId: string, day: Date): Cell {
    const iso = isoDate(day);
    const empty: Cell = { label: '', kind: 'empty', total: 0, over8: false };
    const p = this.plan();
    if (!p) return empty;
    const row = p.rows.find((r) => r.userId === userId);
    if (!row) return empty;

    // Include BOTH work and leave (no override), so overallocation is visible.
    const work = row.entries.filter((e) => e.date === iso).reduce((s, e) => s + e.hours, 0);
    const activeLeaves = row.leaves.filter((l) => l.date === iso && l.status !== 'REJECTED');
    let leaveHrs = activeLeaves.reduce((s, l) => s + (l.hours || 0), 0);
    const autoBank = isIrishBankHoliday(day) && !activeLeaves.some((l) => l.type === 'BANK_HOLIDAY');
    if (autoBank) leaveHrs += BANK_HOLIDAY_HOURS;
    const total = Math.round((work + leaveHrs) * 100) / 100;
    const over8 = total > MAX_DAY_HOURS;

    if (total <= 0) {
      if (this.isWeekend(day)) return { ...empty, kind: 'bank' };
      return empty;
    }
    const firstLeave = activeLeaves[0];
    const leaveType: LeaveType | undefined = firstLeave?.type ?? (autoBank ? 'BANK_HOLIDAY' : undefined);
    const pending = firstLeave?.status === 'PENDING';
    let kind: Cell['kind'];
    if (work > 0 && leaveHrs > 0) kind = 'mixed';
    else if (work > 0) kind = 'work';
    else kind = pending ? 'pending' : (leaveType === 'BANK_HOLIDAY' ? 'bank' : 'leave');
    return { label: this.hlabel(total), kind, type: leaveType, total, over8 };
  }
  /** Compact hours label: 8 -> "8h", 7.25 -> "7.25h", 7.5 -> "7.5h". */
  private hlabel(n: number): string {
    return (Number.isInteger(n) ? String(n) : String(+n.toFixed(2))) + 'h';
  }
  cellClass(c: Cell): string {
    if (c.kind === 'mixed') return 'mixed';
    if (c.kind === 'work') return 'work';
    if (c.kind === 'bank') return 'bank';
    if (c.kind === 'pending') return 'pending';
    if (c.kind === 'leave' && c.type) return LEAVE_COLORS[c.type];
    return 'empty';
  }
  /** Diagonal split (work green + leave colour) for mixed cells. */
  cellBg(c: Cell): string {
    if (c.kind === 'mixed') {
      const hex = c.type ? LEAVE_HEX[c.type] : '#607d8b';
      return `linear-gradient(135deg, #7cb518 0 52%, ${hex} 52% 100%)`;
    }
    return '';
  }
  rowOver8(userId: string): boolean {
    return this.daysInMonth().some((d) => this.cell(userId, d).over8);
  }

  // ---- Admin day-edit modal ----
  openDay(userId: string, name: string, day: Date): void {
    if (!this.auth.isAdmin()) return;
    this.daySel.set({
      userId, name, iso: isoDate(day),
      label: day.toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    });
  }
  closeDay(): void { this.daySel.set(null); }

  dayEntries = computed<TimeEntry[]>(() => {
    const d = this.daySel(); if (!d) return [];
    const row = this.plan()?.rows.find((r) => r.userId === d.userId);
    return row ? row.entries.filter((e) => e.date === d.iso) : [];
  });
  dayLeaves = computed<LeaveRequest[]>(() => {
    const d = this.daySel(); if (!d) return [];
    const row = this.plan()?.rows.find((r) => r.userId === d.userId);
    return row ? row.leaves.filter((l) => l.date === d.iso) : [];
  });
  autoBankInModal(): boolean {
    const d = this.daySel(); if (!d) return false;
    const day = new Date(d.iso + 'T00:00:00');
    return isIrishBankHoliday(day) && !this.dayLeaves().some((l) => l.type === 'BANK_HOLIDAY' && l.status !== 'REJECTED');
  }
  daySelTotal = computed(() => {
    const w = this.dayEntries().reduce((s, e) => s + e.hours, 0);
    const l = this.dayLeaves().filter((x) => x.status !== 'REJECTED').reduce((s, x) => s + (x.hours || 0), 0);
    const auto = this.autoBankInModal() ? BANK_HOLIDAY_HOURS : 0;
    return Math.round((w + l + auto) * 100) / 100;
  });

  wbsCode(id: string): string { return this.wbs().find((w) => w.id === id)?.code ?? id; }
  wbsName(id: string): string { return this.wbs().find((w) => w.id === id)?.currentName ?? ''; }
  leaveLabel(t: LeaveType): string { return LEAVE_LABELS[t]; }

  saveEntryHours(e: TimeEntry, val: string): void {
    const h = parseFloat(val); if (isNaN(h) || h < 0) return;
    this.api.updateTimeEntry(e.id, { hours: h }).subscribe(() => this.load());
  }
  removeEntry(e: TimeEntry): void { this.api.deleteTimeEntry(e.id).subscribe(() => this.load()); }
  saveLeaveHours(l: LeaveRequest, val: string): void {
    const h = parseFloat(val); if (isNaN(h) || h <= 0) return;
    this.api.updateLeave(l.id, { hours: h }).subscribe(() => this.load());
  }
  removeLeaveRec(l: LeaveRequest): void { this.api.deleteLeave(l.id).subscribe(() => this.load()); }
  approveLeaveRec(l: LeaveRequest): void { this.api.approveLeave(l.id).subscribe(() => this.load()); }
  rejectLeaveRec(l: LeaveRequest): void { this.api.rejectLeave(l.id).subscribe(() => this.load()); }

  // ---- Differences ----
  diffRows = computed<DiffRow[]>(() => {
    const p = this.plan();
    if (!p) return [];
    // Coarse reconciliation for the demo: compare total in-app hours vs uploaded
    // hours per person for the month. Real WBS-level matching is a backend concern.
    const byNameApp = new Map<string, number>();
    for (const row of p.rows) {
      const total = row.entries.reduce((s, e) => s + e.hours, 0);
      if (total) byNameApp.set(row.name, (byNameApp.get(row.name) ?? 0) + total);
    }
    const byNameUp = new Map<string, { hours: number; wbs: string; project: string }>();
    for (const u of this.uploaded()) {
      const cur = byNameUp.get(u.userName) ?? { hours: 0, wbs: u.wbsCode, project: u.project };
      cur.hours += u.hours; byNameUp.set(u.userName, cur);
    }
    const names = new Set([...byNameApp.keys(), ...byNameUp.keys()]);
    const out: DiffRow[] = [];
    for (const name of names) {
      const app = byNameApp.get(name) ?? 0;
      const up = byNameUp.get(name);
      const uploadedHours = up?.hours ?? 0;
      if (app !== uploadedHours) {
        out.push({ name, wbsCode: up?.wbs ?? '—', project: up?.project ?? '(in-app only)', app, uploaded: uploadedHours, delta: app - uploadedHours });
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });

  // ---- Upload ----
  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set('Parsing…');
    file.arrayBuffer().then((buf) => {
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
      const domainId = this.ctx.selectedId()!;
      const rows: Omit<UploadedRow, 'id'>[] = json
        .filter((r) => (r.Name || r.name) && (r.Hours || r.hours))
        .map((r) => ({
          month: this.month(), domainId,
          userName: String(r.Name ?? r.name),
          wbsCode: String(r['WBS Code'] ?? r.wbsCode ?? r.WBS ?? ''),
          project: String(r.Project ?? r.project ?? ''),
          hours: Number(r.Hours ?? r.hours ?? 0),
        }));
      if (!rows.length) { this.busy.set(''); alert('No rows found. Expected columns: Name, WBS Code, Project, Hours'); return; }
      this.api.uploadRows(rows).subscribe(() => { this.busy.set(''); this.load(); this.tab.set('UPLOADED'); });
    }).catch(() => this.busy.set(''));
    input.value = '';
  }

  // ---- Download project summary ----
  download(scope: 'DOMAIN' | 'ALL', format: 'xlsx' | 'pdf'): void {
    this.busy.set('Generating…');
    this.api.getProjectSummary({ scope, domainId: this.ctx.selectedId(), month: this.month() })
      .subscribe((summary) => {
        if (format === 'xlsx') this.exporter.projectSummaryToExcel(summary);
        else this.exporter.projectSummaryToPdf(summary);
        this.busy.set('');
      });
  }
}
