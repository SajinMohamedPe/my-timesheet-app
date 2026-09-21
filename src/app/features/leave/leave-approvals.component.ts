import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService } from '../../core/services/api.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { LeaveRequestView, LeaveType } from '../../core/models/models';

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: 'Annual Leave', SICK: 'Sick Leave', TRAINING: 'Deloitte Training',
  INTERNAL: 'Internal / All-Hands / Gems', BANK_HOLIDAY: 'Bank Holiday',
};

@Component({
  selector: 'dtt-leave-approvals',
  imports: [FormsModule, MatIconModule, PageHeaderComponent],
  template: `
  <dtt-page-header icon="fact_check" title="Leave Approvals"
    [crumb]="'Visibility Plan · Leave Approvals · ' + (ctx.selected()?.name ?? 'All domains')" />

  <div class="tabs">
    <button [class.active]="filter()==='PENDING'" (click)="filter.set('PENDING')">Pending ({{ pending().length }})</button>
    <button [class.active]="filter()==='ALL'" (click)="filter.set('ALL')">All</button>
  </div>

  <div class="block">
    <div class="block-h"><mat-icon class="bi">fact_check</mat-icon><span class="bname">Leave requests</span>
      <span class="bdesc">{{ ctx.selected()?.name ?? 'All domains' }}</span></div>
    <div class="block-body flush">
    <table class="dtt">
      <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Duration</th><th>Reason</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>
        @for (r of shown(); track r.id) {
          <tr>
            <td><b>{{ r.userName }}</b><div class="muted small">{{ r.domainName }}</div></td>
            <td>{{ label(r.type) }}</td>
            <td>{{ range(r) }}</td>
            <td>{{ r.days }} day{{ r.days > 1 ? 's' : '' }}{{ r.halfDay ? ' × ½' : '' }} · {{ r.totalHours.toFixed(2) }}h</td>
            <td class="muted">
              {{ r.reason || '—' }}
              @if (r.status === 'REJECTED' && r.decisionReason) { <div class="dec">Reason: {{ r.decisionReason }}</div> }
            </td>
            <td><span class="chip" [class.amber]="r.status==='PENDING'" [class.green]="r.status==='APPROVED'"
              [class.red]="r.status==='REJECTED'" [class.grey]="r.status==='WITHDRAWN' || r.status==='SUPERSEDED'">{{ r.status }}</span></td>
            <td>
              @if (r.status === 'PENDING') {
                <button class="approve" (click)="approve(r)"><mat-icon>check</mat-icon> Approve</button>
                <button class="reject" (click)="openReject(r)"><mat-icon>close</mat-icon> Reject</button>
              } @else if (r.decidedByName) { <span class="muted small">by {{ r.decidedByName }}</span> }
              @else { <span class="muted small">—</span> }
            </td>
          </tr>
        }
        @if (!shown().length) { <tr><td colspan="7" class="muted">No leave requests.</td></tr> }
      </tbody>
    </table>
    </div>
  </div>

  @if (rejecting(); as r) {
    <div class="backdrop" (click)="rejecting.set(null)">
      <div class="rmodal" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <div class="rm-head">
          <div class="icon"><mat-icon>close</mat-icon></div>
          <h3>Reject leave request</h3>
        </div>
        <p class="msg">{{ r.userName }} · {{ label(r.type) }} · {{ range(r) }}</p>
        <label class="rlabel">Reason <span class="opt">(optional, shown to the requester)</span>
          <textarea [(ngModel)]="rejectReason" rows="3" placeholder="e.g. Team coverage needed that week"></textarea>
        </label>
        <div class="rm-foot">
          <button class="btn ghost" (click)="rejecting.set(null)">Cancel</button>
          <button class="btn danger" (click)="confirmReject()">Reject request</button>
        </div>
      </div>
    </div>
  }
  `,
  styles: [`
    .tabs { display: flex; gap: 6px; margin-bottom: 14px; }
    .tabs button { border: 1px solid var(--dtt-line); background: var(--dtt-card); border-radius: 8px; padding: 8px 16px; cursor: pointer; font-weight: 600; font-size: 13px; color: var(--dtt-muted); }
    .tabs button.active { background: var(--dtt-tint-strong); color: var(--dtt-green-dark); border-color: #cfe3a8; }
    button.approve, button.reject { display: inline-flex; align-items: center; gap: 3px; border: none; border-radius: 6px; padding: 6px 10px; cursor: pointer; font-size: 12px; font-weight: 600; margin-right: 6px; color: #fff; }
    button.approve { background: var(--dtt-green); }
    button.reject { background: #b4322f; }
    button mat-icon { font-size: 16px; width: 16px; height: 16px; }
    .small { font-size: 12px; }
    .dec { color: var(--dtt-alert-ink); font-size: 12px; margin-top: 2px; }
    .backdrop { position: fixed; inset: 0; background: rgba(20,22,24,.45); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .rmodal { background: var(--dtt-card); border-radius: 14px; width: 440px; max-width: 100%; box-shadow: 0 24px 60px rgba(0,0,0,.28); padding: 22px; }
    .rm-head { display: flex; align-items: center; gap: 12px; }
    .rm-head h3 { margin: 0; font-size: 19px; }
    .rm-head .icon { width: 40px; height: 40px; border-radius: 11px; background: var(--dtt-alert-soft); color: var(--dtt-alert-ink); display: flex; align-items: center; justify-content: center; }
    .msg { margin: 14px 0 12px; font-size: 14px; }
    .rlabel { display: flex; flex-direction: column; gap: 6px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--dtt-muted); }
    .rlabel .opt { font-weight: 400; text-transform: none; letter-spacing: normal; }
    .rlabel textarea { padding: 9px 11px; border: 1px solid var(--dtt-line); border-radius: 8px; font-size: 14px; font-weight: 400; text-transform: none; letter-spacing: normal; color: var(--dtt-ink); background: var(--dtt-card); resize: vertical; font-family: inherit; }
    .rlabel textarea:focus { outline: none; border-color: var(--dtt-green); }
    .rm-foot { display: flex; justify-content: flex-end; gap: 10px; margin-top: 18px; }
    .btn { border: 1px solid var(--dtt-line); background: var(--dtt-card); border-radius: 9px; padding: 10px 18px; cursor: pointer; font-weight: 600; font-size: 14px; }
    .btn.ghost { color: var(--dtt-muted); }
    .btn.danger { background: #b4322f; color: #fff; border-color: #b4322f; }
    .btn.danger:hover { background: #9c2a27; }
  `],
})
export class LeaveApprovalsComponent implements OnInit {
  ctx = inject(DomainContextService);
  private api = inject(ApiService);

  all = signal<LeaveRequestView[]>([]);
  filter = signal<'PENDING' | 'ALL'>('PENDING');
  rejecting = signal<LeaveRequestView | null>(null);
  rejectReason = '';

  constructor() { effect(() => { this.ctx.selectedId(); this.load(); }); }
  ngOnInit(): void { this.load(); }

  private load(): void {
    const domainId = this.ctx.selectedId() ?? undefined;
    this.api.getLeaveRequests({ scope: 'queue', domainId }).subscribe((l) => this.all.set(l));
  }

  pending = computed(() => this.all().filter((l) => l.status === 'PENDING'));
  shown = computed(() => this.filter() === 'PENDING' ? this.pending() : this.all());

  label(t: LeaveType | string): string { return TYPE_LABEL[t] ?? t; }
  range(r: LeaveRequestView): string {
    const f = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
    return r.startDate === r.endDate ? f(r.startDate) : `${f(r.startDate)} → ${f(r.endDate)}`;
  }
  approve(r: LeaveRequestView): void { this.api.approveLeaveRequest(r.id).subscribe(() => this.load()); }
  openReject(r: LeaveRequestView): void { this.rejectReason = ''; this.rejecting.set(r); }
  confirmReject(): void {
    const r = this.rejecting(); if (!r) return;
    this.api.rejectLeaveRequest(r.id, this.rejectReason.trim() || undefined).subscribe(() => { this.rejecting.set(null); this.load(); });
  }
}
