import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/services/auth.service';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService } from '../../core/services/api.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { currentMonth } from '../../core/util/dates';
import { LeaveRequest, TimeEntry } from '../../core/models/models';
import { effect } from '@angular/core';

@Component({
  selector: 'dtt-home',
  imports: [RouterLink, MatIconModule, PageHeaderComponent],
  template: `
  <dtt-page-header icon="grid_view" [title]="'Welcome, ' + firstName()"
    [crumb]="'Home · ' + (ctx.selected()?.name ?? 'All domains')" />

  <div class="tiles">
    <div class="tile">
      <mat-icon>schedule</mat-icon>
      <div class="v">{{ hoursThisMonth() }}h</div>
      <div class="l">Logged this month</div>
    </div>
    <div class="tile">
      <mat-icon>event_available</mat-icon>
      <div class="v">{{ daysThisMonth() }}</div>
      <div class="l">Days (8h = 1)</div>
    </div>
    <div class="tile">
      <mat-icon>pending_actions</mat-icon>
      <div class="v">{{ pendingLeave() }}</div>
      <div class="l">{{ auth.isAdmin() ? 'Leave to approve' : 'My pending leave' }}</div>
    </div>
    @if (auth.isAdmin()) {
      <div class="tile">
        <mat-icon>groups</mat-icon>
        <div class="v">{{ teamSize() }}</div>
        <div class="l">People in domain</div>
      </div>
    }
  </div>

  @if (rejectedLeaves().length) {
    <div class="notice card">
      <div class="notice-h"><mat-icon>info</mat-icon>
        <span>{{ rejectedLeaves().length }} leave request{{ rejectedLeaves().length > 1 ? 's were' : ' was' }} not approved</span>
      </div>
      <p class="muted">These were declined by your domain admin and have been removed from your timesheet. You can log time on those days or raise the leave again.</p>
      <ul class="rej-list">
        @for (l of rejectedLeaves(); track l.id) {
          <li><span class="rej-date">{{ fmtLeaveDate(l.date) }}</span>
            <span class="rej-type">{{ leaveTypeLabel(l.type) }}</span>
            <span class="rej-hrs muted">{{ l.hours.toFixed(2) }}h</span></li>
        }
      </ul>
    </div>
  }

  <div class="quick card">
    <h3>Quick actions</h3>
    <div class="qa">
      <a routerLink="/timesheets"><mat-icon>grid_on</mat-icon> Log this week</a>
      <a routerLink="/visibility"><mat-icon>visibility</mat-icon> Monthly View</a>
      @if (auth.isAdmin()) {
        <a routerLink="/leave-approvals"><mat-icon>fact_check</mat-icon> Approve leave</a>
        <a routerLink="/reports"><mat-icon>download</mat-icon> Download reports</a>
      }
      <button class="reset" (click)="resetDemo()"><mat-icon>restart_alt</mat-icon> Reset demo data</button>
    </div>
  </div>
  `,
  styles: [`
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 22px; }
    .tile { background: var(--dtt-card); border: 1px solid var(--dtt-line); border-radius: 12px; padding: 20px; }
    .tile mat-icon { color: var(--dtt-green); }
    .tile .v { font-size: 30px; font-weight: 700; margin-top: 8px; }
    .tile .l { color: var(--dtt-muted); font-size: 13px; }
    .notice { margin-bottom: 22px; border-left: 4px solid var(--dtt-alert); }
    .notice-h { display: flex; align-items: center; gap: 8px; font-weight: 700; }
    .notice-h mat-icon { color: var(--dtt-alert); }
    .notice p { margin: 8px 0 12px; font-size: 13px; }
    .rej-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .rej-list li { display: flex; align-items: center; gap: 12px; font-size: 13px; padding: 8px 12px;
      border: 1px solid var(--dtt-line); border-radius: 8px; }
    .rej-date { font-weight: 700; min-width: 110px; }
    .rej-type { flex: 1; }
    .quick h3 { margin: 0 0 14px; }
    .qa { display: flex; gap: 12px; flex-wrap: wrap; }
    .qa a { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid var(--dtt-line);
      border-radius: 8px; text-decoration: none; color: var(--dtt-ink); font-weight: 500; }
    .qa a:hover { background: var(--dtt-hover); }
    .qa mat-icon { color: var(--dtt-green); }
    .qa .reset { display: flex; align-items: center; gap: 8px; padding: 10px 16px; border: 1px solid var(--dtt-line);
      border-radius: 8px; background: var(--dtt-card); color: var(--dtt-muted); font-weight: 500; cursor: pointer; }
    .qa .reset:hover { background: var(--dtt-hover); }
  `],
})
export class HomeComponent implements OnInit {
  auth = inject(AuthService);
  ctx = inject(DomainContextService);
  private api = inject(ApiService);

  private entries = signal<TimeEntry[]>([]);
  private leaves = signal<LeaveRequest[]>([]);
  private team = signal(0);
  private month = currentMonth();

  constructor() {
    // Reload when the selected domain changes.
    effect(() => { this.ctx.selectedId(); this.load(); });
  }
  ngOnInit() { this.load(); }

  private load(): void {
    const domainId = this.ctx.selectedId() ?? undefined;
    this.api.getTimeEntries({ domainId, from: this.month + '-01', to: this.month + '-31' })
      .subscribe((e) => this.entries.set(e));
    const leaveQuery = this.auth.isAdmin() ? { status: 'PENDING', domainId } : { userId: this.auth.user()!.id };
    // Admins: pending queue count. Employees: keep the full list so we can show
    // both their pending count and any rejected-leave notice.
    this.api.getLeave(leaveQuery).subscribe((l) => this.leaves.set(l));
    if (this.auth.isAdmin()) this.api.getUsers(domainId).subscribe((u) => this.team.set(u.length));
  }

  firstName = computed(() => (this.auth.user()?.name ?? '').split(' ')[0]);
  hoursThisMonth = computed(() => this.entries().reduce((s, e) => s + e.hours, 0));
  daysThisMonth = computed(() => Math.round((this.hoursThisMonth() / 8) * 100) / 100);
  pendingLeave = computed(() => this.leaves().filter((l) => l.status === 'PENDING').length);
  teamSize = computed(() => this.team());
  // Rejected leave to flag to the contractor (kept off the timesheet grid).
  rejectedLeaves = computed(() =>
    this.auth.isAdmin() ? [] : this.leaves().filter((l) => l.status === 'REJECTED'),
  );
  fmtLeaveDate(iso: string): string {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short' });
  }
  leaveTypeLabel(t: string): string {
    return ({ ANNUAL: 'Annual leave', SICK: 'Sick leave', TRAINING: 'Deloitte Training',
      INTERNAL: 'Internal / Practice', BANK_HOLIDAY: 'Bank holiday' } as Record<string, string>)[t] ?? t;
  }

  resetDemo(): void {
    if (!confirm('Reset all demo data back to the seed? Anything you entered will be lost.')) return;
    this.api.resetDemo().subscribe(() => location.reload());
  }
}
