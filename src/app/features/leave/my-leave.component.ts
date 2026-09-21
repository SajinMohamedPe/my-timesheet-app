import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { provideNativeDateAdapter } from '@angular/material/core';
import { ApiService } from '../../core/services/api.service';
import { AuthService } from '../../core/services/auth.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog.component';
import { Domain, LeaveRequestView, LeaveType } from '../../core/models/models';
import { isoDate } from '../../core/util/dates';

type Tab = 'PENDING' | 'ALL';

// Bank Holiday is auto-marked, so it is not a requestable type. Colours match the legend.
const REQUESTABLE: { type: LeaveType; label: string; color: string }[] = [
  { type: 'ANNUAL', label: 'Annual Leave', color: '#e53935' },
  { type: 'SICK', label: 'Sick Leave', color: '#ab30c4' },
  { type: 'TRAINING', label: 'Deloitte Training', color: '#ffcf2e' },
  { type: 'INTERNAL', label: 'Internal / Practice', color: '#1976d2' },
];

@Component({
  selector: 'dtt-my-leave',
  imports: [FormsModule, MatIconModule, MatDatepickerModule, PageHeaderComponent, ConfirmDialogComponent],
  providers: [provideNativeDateAdapter()],
  templateUrl: './my-leave.component.html',
  styleUrl: './my-leave.component.scss',
})
export class MyLeaveComponent implements OnInit {
  private api = inject(ApiService);
  auth = inject(AuthService);

  readonly types = REQUESTABLE;
  requests = signal<LeaveRequestView[]>([]);
  myDomains = signal<Domain[]>([]);
  tab = signal<Tab>('PENDING');
  showForm = signal(false);
  editingId = signal<string | null>(null);
  withdrawTarget = signal<LeaveRequestView | null>(null);
  saving = signal(false);
  error = signal('');

  // Domain is assigned automatically (user's primary domain) — not shown in the form.
  form = { type: 'ANNUAL' as LeaveType, domainId: '', start: null as Date | null, end: null as Date | null, halfDay: false, reason: '' };

  ngOnInit(): void {
    this.api.getDomains().subscribe((d) => {
      this.myDomains.set(d.filter((x) => this.auth.user()?.domainIds.includes(x.id)));
    });
    this.load();
  }

  private load(): void {
    this.api.getLeaveRequests({ scope: 'mine' }).subscribe((r) => this.requests.set(r));
  }

  filtered = computed(() =>
    this.tab() === 'PENDING' ? this.requests().filter((r) => r.status === 'PENDING') : this.requests(),
  );
  pendingCount = computed(() => this.requests().filter((r) => r.status === 'PENDING').length);

  openNew(): void {
    const today = new Date();
    this.form = { type: 'ANNUAL', domainId: this.myDomains()[0]?.id ?? '', start: today, end: today, halfDay: false, reason: '' };
    this.editingId.set(null); this.error.set(''); this.showForm.set(true);
  }
  openEdit(r: LeaveRequestView): void {
    this.form = {
      type: r.type, domainId: r.domainId,
      start: new Date(r.startDate + 'T00:00:00'), end: new Date(r.endDate + 'T00:00:00'),
      halfDay: r.halfDay, reason: r.reason ?? '',
    };
    this.editingId.set(r.id); this.error.set(''); this.showForm.set(true);
  }
  closeForm(): void { this.showForm.set(false); this.editingId.set(null); }

  canSubmit(): boolean {
    const f = this.form;
    return !!f.type && !!f.domainId && !!f.start && !!f.end && f.end >= f.start;
  }

  submit(): void {
    if (!this.canSubmit() || this.saving()) return;
    this.saving.set(true); this.error.set('');
    const f = this.form;
    const payload = {
      domainId: f.domainId, type: f.type, halfDay: f.halfDay, reason: f.reason,
      startDate: isoDate(f.start!), endDate: isoDate(f.end!),
    };
    const done = {
      next: () => { this.saving.set(false); this.closeForm(); this.load(); },
      error: (e: any) => { this.saving.set(false); this.error.set(e?.error?.message ?? 'Could not save the request.'); },
    };
    const id = this.editingId();
    if (id) this.api.updateLeaveRequest(id, payload).subscribe(done);
    else this.api.createLeaveRequest(payload).subscribe(done);
  }

  askWithdraw(r: LeaveRequestView): void { this.withdrawTarget.set(r); }
  confirmWithdraw(): void {
    const r = this.withdrawTarget(); if (!r) return;
    this.api.withdrawLeaveRequest(r.id).subscribe(() => { this.withdrawTarget.set(null); this.load(); });
  }

  typeMeta(t: LeaveType) { return REQUESTABLE.find((x) => x.type === t); }
  typeLabel(t: LeaveType): string { return this.typeMeta(t)?.label ?? t; }
  typeColor(t: LeaveType): string { return this.typeMeta(t)?.color ?? 'var(--dtt-muted)'; }
  fmtDate(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  rangeLabel(r: LeaveRequestView): string {
    return r.startDate === r.endDate ? this.fmtDate(r.startDate) : `${this.fmtDate(r.startDate)} → ${this.fmtDate(r.endDate)}`;
  }
  statusClass(s: string): string { return s.toLowerCase(); }
}
