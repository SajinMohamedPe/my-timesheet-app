import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService } from '../../core/services/api.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { LeaveRequest, User } from '../../core/models/models';

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: 'Annual Leave', SICK: 'Sick Leave', TRAINING: 'Deloitte Training',
  INTERNAL: 'Internal / All-Hands / Gems', BANK_HOLIDAY: 'Bank Holiday',
};

@Component({
  selector: 'dtt-leave-approvals',
  imports: [MatIconModule, PageHeaderComponent],
  template: `
  <dtt-page-header icon="fact_check" title="Leave Approvals"
    [crumb]="'Time Tracking · Leave Approvals · ' + (ctx.selected()?.name ?? 'All domains')" />

  <div class="tabs">
    <button [class.active]="filter()==='PENDING'" (click)="filter.set('PENDING')">Pending ({{ pending().length }})</button>
    <button [class.active]="filter()==='ALL'" (click)="filter.set('ALL')">All</button>
  </div>

  <div class="block">
    <div class="block-h"><mat-icon class="bi">fact_check</mat-icon><span class="bname">Leave requests</span>
      <span class="bdesc">{{ ctx.selected()?.name ?? 'All domains' }}</span></div>
    <div class="block-body flush">
    <table class="dtt">
      <thead><tr><th>Employee</th><th>Type</th><th>Date</th><th>Duration</th><th>Notes</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        @for (l of shown(); track l.id) {
          <tr>
            <td>{{ nameOf(l.userId) }}</td>
            <td>{{ label(l.type) }}</td>
            <td>{{ l.date }}</td>
            <td>{{ l.hours.toFixed(2) }}h</td>
            <td class="muted">{{ l.notes || '—' }}</td>
            <td><span class="chip" [class.amber]="l.status==='PENDING'" [class.green]="l.status==='APPROVED'" [class.red]="l.status==='REJECTED'">{{ l.status }}</span></td>
            <td>
              @if (l.status === 'PENDING') {
                <button class="approve" (click)="approve(l)"><mat-icon>check</mat-icon> Approve</button>
                <button class="reject" (click)="reject(l)"><mat-icon>close</mat-icon> Reject</button>
              } @else { <span class="muted small">by {{ nameOf(l.decidedBy ?? '') }}</span> }
            </td>
          </tr>
        }
        @if (!shown().length) { <tr><td colspan="7" class="muted">No leave requests.</td></tr> }
      </tbody>
    </table>
    </div>
  </div>
  `,
  styles: [`
    .tabs { display: flex; gap: 6px; margin-bottom: 14px; }
    .tabs button { border: 1px solid var(--dtt-line); background: #fff; border-radius: 8px; padding: 8px 16px; cursor: pointer; font-weight: 600; font-size: 13px; color: var(--dtt-muted); }
    .tabs button.active { background: #eaf2da; color: var(--dtt-green-dark); border-color: #cfe3a8; }
    button.approve, button.reject { display: inline-flex; align-items: center; gap: 3px; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; font-weight: 600; margin-right: 6px; color: #fff; }
    button.approve { background: var(--dtt-green); }
    button.reject { background: #b4322f; }
    button mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .small { font-size: 12px; }
  `],
})
export class LeaveApprovalsComponent implements OnInit {
  ctx = inject(DomainContextService);
  private api = inject(ApiService);

  all = signal<LeaveRequest[]>([]);
  users = signal<User[]>([]);
  filter = signal<'PENDING' | 'ALL'>('PENDING');

  constructor() { effect(() => { this.ctx.selectedId(); this.load(); }); }
  ngOnInit(): void { this.load(); }

  private load(): void {
    const domainId = this.ctx.selectedId() ?? undefined;
    this.api.getLeave({ domainId }).subscribe((l) => this.all.set(l));
    this.api.getUsers(domainId).subscribe((u) => this.users.set(u));
  }

  pending = computed(() => this.all().filter((l) => l.status === 'PENDING'));
  shown = computed(() => this.filter() === 'PENDING' ? this.pending() : this.all());

  nameOf(id: string): string { return this.users().find((u) => u.id === id)?.name ?? id; }
  label(t: string): string { return TYPE_LABEL[t] ?? t; }
  approve(l: LeaveRequest): void { this.api.approveLeave(l.id).subscribe(() => this.load()); }
  reject(l: LeaveRequest): void { this.api.rejectLeave(l.id).subscribe(() => this.load()); }
}
