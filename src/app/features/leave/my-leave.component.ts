import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter, MAT_DATE_LOCALE } from '@angular/material/core';
import { forkJoin } from 'rxjs';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { ColorSelectComponent, ColorOption } from '../../shared/color-select.component';
import { Domain, LeaveRequestView, LeaveType } from '../../core/models/models';
import { isoDate, isIrishBankHoliday } from '../../core/util/dates';

type Tab = 'PENDING' | 'ALL';
interface SelDay { date: string; type: LeaveType; halfDay: boolean; }

// Bank Holiday is auto-marked, so it is not a requestable type. Colours match the legend.
const REQUESTABLE: ColorOption[] = [
  { value: 'ANNUAL', label: 'Annual Leave', color: '#e53935' },
  { value: 'SICK', label: 'Sick Leave', color: '#ab30c4' },
  { value: 'TRAINING', label: 'Deloitte Training', color: '#ffcf2e' },
  { value: 'INTERNAL', label: 'Internal / Practice', color: '#1976d2' },
];

@Component({
  selector: 'dtt-my-leave',
  imports: [FormsModule, MatIconModule, MatDatepickerModule, PageHeaderComponent, ConfirmDialogComponent, ColorSelectComponent],
  providers: [provideNativeDateAdapter(), { provide: MAT_DATE_LOCALE, useValue: 'en-GB' }],
  templateUrl: './my-leave.component.html',
  styleUrl: './my-leave.component.scss',
})
export class MyLeaveComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);

  readonly typeOptions = REQUESTABLE;
  requests = signal<LeaveRequestView[]>([]);
  myDomains = signal<Domain[]>([]);
  tab = signal<Tab>('PENDING');
  showForm = signal(false);
  editingId = signal<string | null>(null);
  withdrawTarget = signal<LeaveRequestView | null>(null);
  saving = signal(false);
  error = signal('');

  // Builder state: pick a type + range, "Add days" appends working days to `selected`.
  draftType = signal<LeaveType>('ANNUAL');
  draftStart = signal<Date | null>(null);
  draftEnd = signal<Date | null>(null);
  selected = signal<SelDay[]>([]);
  reason = '';

  // ngModel bridges for the Material datepickers (which need a plain two-way binding).
  get draftStartModel(): Date | null { return this.draftStart(); }
  set draftStartModel(v: Date | null) { this.draftStart.set(v); }
  get draftEndModel(): Date | null { return this.draftEnd(); }
  set draftEndModel(v: Date | null) { this.draftEnd.set(v); }

  ngOnInit(): void {
    this.api.getDomains().subscribe((d) => {
      this.myDomains.set(d.filter((x) => this.auth.user()?.domainIds.includes(x.id)));
    });
    this.load();
  }
  private load(): void { this.api.getLeaveRequests({ scope: 'mine' }).subscribe((r) => this.requests.set(r)); }

  filtered = computed(() =>
    this.tab() === 'PENDING' ? this.requests().filter((r) => r.status === 'PENDING') : this.requests(),
  );
  pendingCount = computed(() => this.requests().filter((r) => r.status === 'PENDING').length);
  private domainId = computed(() => this.myDomains()[0]?.id ?? '');

  // ---- Builder ----
  openNew(): void {
    const today = new Date();
    this.draftType.set('ANNUAL'); this.draftStart.set(today); this.draftEnd.set(today);
    this.selected.set([]); this.reason = '';
    this.editingId.set(null); this.error.set(''); this.showForm.set(true);
  }
  openEdit(r: LeaveRequestView): void {
    this.draftType.set(r.type); this.draftStart.set(null); this.draftEnd.set(null);
    this.selected.set(r.perDay.map((d) => ({ date: d.date, type: r.type, halfDay: d.halfDay })));
    this.reason = r.reason ?? '';
    this.editingId.set(r.id); this.error.set(''); this.showForm.set(true);
  }
  closeForm(): void { this.showForm.set(false); this.editingId.set(null); }

  private workingDays(start: Date, end: Date): string[] {
    const out: string[] = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue;
      if (isIrishBankHoliday(d)) continue;
      out.push(isoDate(d));
    }
    return out;
  }
  canAdd = computed(() => {
    const s = this.draftStart(), e = this.draftEnd();
    return !!s && !!e && e >= s;
  });
  addDays(): void {
    const s = this.draftStart(), e = this.draftEnd();
    if (!s || !e || e < s) return;
    const existing = new Set(this.selected().map((x) => x.date));
    const add: SelDay[] = this.workingDays(s, e)
      .filter((date) => !existing.has(date))
      .map((date) => ({ date, type: this.draftType(), halfDay: false }));
    if (!add.length) { this.error.set('Those days are already added (or the range has no working days).'); return; }
    this.error.set('');
    this.selected.set([...this.selected(), ...add].sort((a, b) => a.date.localeCompare(b.date)));
  }
  removeDay(date: string): void { this.selected.set(this.selected().filter((d) => d.date !== date)); }
  setHalf(date: string, half: boolean): void {
    this.selected.set(this.selected().map((d) => d.date === date ? { ...d, halfDay: half } : d));
  }
  totalHours = computed(() => this.selected().reduce((s, d) => s + (d.halfDay ? 4 : 7.25), 0));
  // Count of distinct requests that will be created (one per leave type).
  requestCount = computed(() => new Set(this.selected().map((d) => d.type)).size);

  canSubmit(): boolean { return this.selected().length > 0 && !!this.domainId(); }
  submit(): void {
    if (!this.canSubmit() || this.saving()) return;
    this.saving.set(true); this.error.set('');
    const domainId = this.domainId();
    const done = () => { this.saving.set(false); this.closeForm(); this.load(); };
    const fail = (e: any) => { this.saving.set(false); this.error.set(e?.error?.message ?? 'Could not save.'); };

    const id = this.editingId();
    if (id) {
      const days = this.selected().map((d) => ({ date: d.date, halfDay: d.halfDay }));
      this.api.updateLeaveRequest(id, { type: this.draftType(), reason: this.reason, days }).subscribe({ next: done, error: fail });
      return;
    }
    // New: group selected days by leave type -> one request (submission) per type.
    const byType = new Map<LeaveType, { date: string; halfDay: boolean }[]>();
    for (const d of this.selected()) {
      const g = byType.get(d.type) ?? []; g.push({ date: d.date, halfDay: d.halfDay }); byType.set(d.type, g);
    }
    const calls = [...byType.entries()].map(([type, days]) =>
      this.api.createLeaveRequest({ domainId, type, reason: this.reason, days }));
    forkJoin(calls).subscribe({ next: done, error: fail });
  }

  askWithdraw(r: LeaveRequestView): void { this.withdrawTarget.set(r); }
  confirmWithdraw(): void {
    const r = this.withdrawTarget(); if (!r) return;
    this.api.withdrawLeaveRequest(r.id).subscribe(() => { this.withdrawTarget.set(null); this.load(); });
  }

  // ---- Display helpers ----
  typeMeta(t: LeaveType | string) { return REQUESTABLE.find((x) => x.value === t); }
  typeLabel(t: LeaveType): string { return this.typeMeta(t)?.label ?? t; }
  typeColor(t: LeaveType | string): string { return this.typeMeta(t)?.color ?? 'var(--dtt-muted)'; }
  fmtDate(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }
  rangeLabel(r: LeaveRequestView): string {
    return r.startDate === r.endDate ? this.fmtDate(r.startDate) : `${this.fmtDate(r.startDate)} → ${this.fmtDate(r.endDate)}`;
  }
  statusClass(s: string): string { return s.toLowerCase(); }
}
