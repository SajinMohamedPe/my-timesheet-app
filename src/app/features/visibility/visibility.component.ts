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
interface DiffRow { name: string; date: string; app: number; uploaded: number; delta: number; }
interface DaySel { userId: string; name: string; iso: string; label: string; }

const LEAVE_COLORS: Record<LeaveType, string> = {
  ANNUAL: 'annual', SICK: 'sick', TRAINING: 'training', INTERNAL: 'internal', BANK_HOLIDAY: 'bank',
};
const LEAVE_HEX: Record<LeaveType, string> = {
  ANNUAL: '#e53935', SICK: '#ab30c4', TRAINING: '#ffcf2e', INTERNAL: '#1976d2', BANK_HOLIDAY: '#607d8b',
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

  // ---- Uploaded Timesheet (grid like Live Plan, from the uploaded file) ----
  uploadedNames = computed<string[]>(() =>
    [...new Set(this.uploaded().map((u) => u.resourceName))].sort((a, b) => a.localeCompare(b)));
  uploadedHours(name: string, day: Date): number {
    const iso = isoDate(day);
    return Math.round(this.uploaded().filter((u) => u.resourceName === name && u.workDate === iso)
      .reduce((s, u) => s + u.hours, 0) * 100) / 100;
  }
  uploadedTotal(name: string): number {
    return Math.round(this.uploaded().filter((u) => u.resourceName === name)
      .reduce((s, u) => s + u.hours, 0) * 100) / 100;
  }

  // ---- Uploaded edit modal ----
  upSel = signal<{ name: string; iso: string; label: string } | null>(null);
  openUp(name: string, day: Date): void {
    if (!this.auth.isAdmin()) return;
    this.upSel.set({
      name, iso: isoDate(day),
      label: day.toLocaleDateString('en-IE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    });
  }
  closeUp(): void { this.upSel.set(null); }
  upDayRows = computed<UploadedRow[]>(() => {
    const s = this.upSel(); if (!s) return [];
    return this.uploaded().filter((u) => u.resourceName === s.name && u.workDate === s.iso);
  });
  upDayTotal = computed(() => Math.round(this.upDayRows().reduce((sm, u) => sm + u.hours, 0) * 100) / 100);
  saveUploadHours(u: UploadedRow, val: string): void {
    const h = parseFloat(val); if (isNaN(h) || h < 0) return;
    this.api.updateUpload(u.id, { hours: h }).subscribe(() => this.load());
  }
  removeUpload(u: UploadedRow): void { this.api.deleteUpload(u.id).subscribe(() => this.load()); }

  // ---- Differences: per person per day, in-app (live plan) vs uploaded ----
  private norm(s: string): string { return s.toLowerCase().replace(/\s+/g, ' ').trim(); }
  diffRows = computed<DiffRow[]>(() => {
    const p = this.plan();
    if (!p) return [];
    const app = new Map<string, number>();   // norm(name)|date -> in-app work hours
    const upl = new Map<string, number>();    // norm(name)|date -> uploaded hours
    const display = new Map<string, string>();
    for (const row of p.rows) {
      for (const e of row.entries) {
        const k = this.norm(row.name) + '|' + e.date;
        app.set(k, (app.get(k) ?? 0) + e.hours);
        display.set(this.norm(row.name), row.name);
      }
    }
    for (const u of this.uploaded()) {
      const k = this.norm(u.resourceName) + '|' + u.workDate;
      upl.set(k, (upl.get(k) ?? 0) + u.hours);
      display.set(this.norm(u.resourceName), u.resourceName);
    }
    const out: DiffRow[] = [];
    for (const k of new Set([...app.keys(), ...upl.keys()])) {
      const a = Math.round((app.get(k) ?? 0) * 100) / 100;
      const u = Math.round((upl.get(k) ?? 0) * 100) / 100;
      if (Math.abs(a - u) > 0.001) {
        const [nkey, date] = k.split('|');
        out.push({ name: display.get(nkey) ?? nkey, date, app: a, uploaded: u, delta: Math.round((a - u) * 100) / 100 });
      }
    }
    return out.sort((x, y) => x.name.localeCompare(y.name) || x.date.localeCompare(y.date));
  });

  // People with at least one mismatch (rows for the Differences grid)
  diffPeople = computed<string[]>(() => {
    const m = new Map<string, string>();
    for (const d of this.diffRows()) m.set(this.norm(d.name), d.name);
    return [...m.values()].sort((a, b) => a.localeCompare(b));
  });
  /** In-app vs uploaded hours for one person/day (for the Differences grid). */
  diffCell(name: string, day: Date): { inApp: number; up: number; delta: number; differ: boolean } {
    const iso = isoDate(day);
    const row = this.plan()?.rows.find((r) => this.norm(r.name) === this.norm(name));
    const inApp = row
      ? Math.round(row.entries.filter((e) => e.date === iso).reduce((s, e) => s + e.hours, 0) * 100) / 100 : 0;
    const up = Math.round(this.uploaded()
      .filter((u) => this.norm(u.resourceName) === this.norm(name) && u.workDate === iso)
      .reduce((s, u) => s + u.hours, 0) * 100) / 100;
    return { inApp, up, delta: Math.round((inApp - up) * 100) / 100, differ: Math.abs(inApp - up) > 0.001 };
  }
  private appUserId(name: string): string | undefined {
    return this.plan()?.rows.find((r) => this.norm(r.name) === this.norm(name))?.userId;
  }
  /** Click a differing cell → open the same edit modal (if the person logs in-app). */
  openDiffDay(name: string, day: Date): void {
    const uid = this.appUserId(name);
    if (uid) this.openDay(uid, name, day);
  }
  /** Uploaded hours for the day currently open in the edit modal (reconciliation reference). */
  uploadedForSel = computed<number>(() => {
    const d = this.daySel(); if (!d) return 0;
    return Math.round(this.uploaded()
      .filter((u) => this.norm(u.resourceName) === this.norm(d.name) && u.workDate === d.iso)
      .reduce((s, u) => s + u.hours, 0) * 100) / 100;
  });

  // ---- Upload (parse the external xlsx) ----
  private toIso(v: unknown): string {
    if (!v) return '';
    if (v instanceof Date) return isoDate(v);
    const d = new Date(String(v).trim());
    return isNaN(d.getTime()) ? '' : isoDate(d);
  }
  private lastFirstToFirstLast(n: string): string {
    if (n.includes(',')) { const [last, first] = n.split(',').map((x) => x.trim()); return `${first} ${last}`.trim(); }
    return n;
  }
  onFile(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.busy.set('Parsing…');
    file.arrayBuffer().then((buf) => {
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<any>(sheet, { defval: '' });
      const domainId = this.ctx.selectedId()!;
      const pick = (r: any, keys: string[]): any => {
        for (const k of Object.keys(r)) {
          const kn = k.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (keys.includes(kn)) return r[k];
        }
        return '';
      };
      const rows: Omit<UploadedRow, 'id'>[] = json.map((r) => {
        const workDate = this.toIso(pick(r, ['workdate', 'date']));
        const associateName = String(pick(r, ['associatename', 'associate', 'name']) || '').trim();
        let resourceName = String(pick(r, ['resourcename', 'resource']) || '').trim();
        if (!resourceName && associateName) resourceName = this.lastFirstToFirstLast(associateName);
        return {
          domainId, workDate, month: workDate.slice(0, 7),
          wbsCode: String(pick(r, ['wbscode', 'wbs']) || '').trim(),
          project: String(pick(r, ['wbsl4name', 'wbsl4', 'project']) || '').trim(),
          associateName, resourceName,
          hours: Number(pick(r, ['hours', 'hrs']) || 0),
        };
      }).filter((r) => r.resourceName && r.workDate && r.hours > 0);
      if (!rows.length) {
        this.busy.set('');
        alert('No rows found. Expected columns: WBS Code, Work Date, Associate Name, Resource Name, Hours, WBS L4 Name.');
        return;
      }
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
