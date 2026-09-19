import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import * as XLSX from 'xlsx';
import { AuthService } from '../../core/services/auth.service';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService, UploadedRow, VisibilityPlan } from '../../core/services/api.service';
import { currentMonth } from '../../core/util/dates';
import { ExportService } from '../../core/services/export.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { LeaveType } from '../../core/models/models';

type Tab = 'LIVE' | 'UPLOADED' | 'DIFF';

interface Cell {
  label: string;
  kind: 'work' | 'leave' | 'bank' | 'empty' | 'pending';
  type?: LeaveType;
}
interface DiffRow { name: string; wbsCode: string; project: string; app: number; uploaded: number; delta: number; }

const LEAVE_COLORS: Record<LeaveType, string> = {
  ANNUAL: 'annual', SICK: 'sick', TRAINING: 'training', INTERNAL: 'internal', BANK_HOLIDAY: 'bank',
};

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
  busy = signal('');

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
    const iso = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const p = this.plan();
    if (!p) return { label: '', kind: 'empty' };
    const row = p.rows.find((r) => r.userId === userId);
    if (!row) return { label: '', kind: 'empty' };
    const leave = row.leaves.find((l) => l.date === iso && l.status !== 'REJECTED');
    if (leave) {
      return {
        label: this.hlabel(leave.hours),   // always show the hours
        kind: leave.status === 'PENDING' ? 'pending' : 'leave',
        type: leave.type,
      };
    }
    const hrs = row.entries.filter((e) => e.date === iso).reduce((s, e) => s + e.hours, 0);
    if (hrs > 0) return { label: this.hlabel(hrs), kind: 'work' };
    if (this.isWeekend(day)) return { label: '', kind: 'bank' };
    return { label: '', kind: 'empty' };
  }
  /** Compact hours label: 8 -> "8h", 7.25 -> "7.25h", 7.5 -> "7.5h". */
  private hlabel(n: number): string {
    return (Number.isInteger(n) ? String(n) : String(+n.toFixed(2))) + 'h';
  }
  cellClass(c: Cell): string {
    if (c.kind === 'work') return 'work';
    if (c.kind === 'bank') return 'bank';
    if (c.kind === 'pending') return 'pending';
    if (c.kind === 'leave' && c.type) return LEAVE_COLORS[c.type];
    return 'empty';
  }

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
