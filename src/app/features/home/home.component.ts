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

  <div class="quick card">
    <h3>Quick actions</h3>
    <div class="qa">
      <a routerLink="/timesheets"><mat-icon>grid_on</mat-icon> Log this week</a>
      <a routerLink="/visibility"><mat-icon>visibility</mat-icon> Visibility Plan</a>
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
    this.api.getLeave(leaveQuery).subscribe((l) =>
      this.leaves.set(this.auth.isAdmin() ? l : l.filter((x) => x.status === 'PENDING')));
    if (this.auth.isAdmin()) this.api.getUsers(domainId).subscribe((u) => this.team.set(u.length));
  }

  firstName = computed(() => (this.auth.user()?.name ?? '').split(' ')[0]);
  hoursThisMonth = computed(() => this.entries().reduce((s, e) => s + e.hours, 0));
  daysThisMonth = computed(() => Math.round((this.hoursThisMonth() / 8) * 100) / 100);
  pendingLeave = computed(() => this.leaves().length);
  teamSize = computed(() => this.team());

  resetDemo(): void {
    if (!confirm('Reset all demo data back to the seed? Anything you entered will be lost.')) return;
    this.api.resetDemo().subscribe(() => location.reload());
  }
}
