import { Component, computed, inject, OnInit } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../core/services/auth.service';
import { DomainContextService } from '../../core/services/domain-context.service';

interface NavItem { label: string; icon: string; link?: string; params?: any[]; children?: NavItem[]; }

@Component({
  selector: 'dtt-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatMenuModule],
  styleUrl: './shell.component.scss',
  template: `
  <div class="shell">
    <aside class="sidebar">
      <div class="side-brand">
        <span class="bar"></span>
        <div><div class="bn">Deloitte</div><div class="bs">Account Management</div></div>
      </div>

      <nav>
        @for (group of nav(); track group.label) {
          @if (group.label !== '_') { <div class="nav-group">{{ group.label }}</div> }
          @for (item of group.children!; track item.label) {
            <a class="nav-item" [routerLink]="item.link" [routerLinkActive]="'active'"
               [queryParams]="item.params?.[0]">
              <mat-icon>{{ item.icon }}</mat-icon><span>{{ item.label }}</span>
            </a>
          }
        }
      </nav>
    </aside>

    <div class="main">
      <header class="topbar">
        <div class="search"><mat-icon>search</mat-icon><input placeholder="Search features, tabs…" /></div>
        <span class="spacer"></span>

        @if (ctx.domains().length) {
          <button class="domain-switch" [matMenuTriggerFor]="dmenu"
                  [disabled]="!ctx.hasMultiple()">
            <mat-icon>workspaces</mat-icon>
            <span>{{ ctx.selected()?.name ?? 'All domains' }}</span>
            @if (ctx.hasMultiple()) { <mat-icon>expand_more</mat-icon> }
          </button>
          <mat-menu #dmenu="matMenu">
            @for (d of ctx.domains(); track d.id) {
              <button mat-menu-item (click)="ctx.select(d.id)">
                <mat-icon>{{ d.id === ctx.selectedId() ? 'check' : 'workspaces' }}</mat-icon>
                {{ d.name }} <span class="dm-desc">— {{ d.description }}</span>
              </button>
            }
          </mat-menu>
        }

        <div class="user">
          <div class="avatar">{{ initials() }}</div>
          <div class="who">
            <div class="name">{{ auth.user()?.name }}</div>
            <div class="role">{{ roleLabel() }}</div>
          </div>
        </div>
        <button class="signout" (click)="signOut()"><mat-icon>logout</mat-icon> Sign Out</button>
      </header>

      <div class="content"><router-outlet /></div>
    </div>
  </div>
  `,
})
export class ShellComponent implements OnInit {
  auth = inject(AuthService);
  ctx = inject(DomainContextService);
  private router = inject(Router);

  ngOnInit() { this.ctx.load(); }

  readonly nav = computed<NavItem[]>(() => {
    const admin = this.auth.isAdmin();
    const superAdmin = this.auth.isSuperAdmin();
    const core: NavItem[] = [
      { label: 'Timesheets', icon: 'grid_on', link: '/timesheets' },
      { label: 'Visibility Plan', icon: 'visibility', link: '/visibility' },
    ];
    if (admin) {
      core.push({ label: 'Leave Approvals', icon: 'fact_check', link: '/leave-approvals' });
      core.push({ label: 'Reports', icon: 'bar_chart', link: '/reports' });
      core.push({ label: 'Timesheet Audit', icon: 'history', link: '/audit' });
    }
    core.push({ label: 'Billing', icon: 'credit_card', link: '/coming-soon/Billing' });
    core.push({ label: 'Forecasting', icon: 'insights', link: '/coming-soon/Forecasting' });
    core.push({ label: 'Leakage Report', icon: 'search', link: '/coming-soon/Leakage Report' });

    const groups: NavItem[] = [
      { label: '_', icon: '', children: [{ label: 'Home', icon: 'home', link: '/home' }] },
      { label: 'CORE', icon: '', children: core },
      { label: 'PROJECTS', icon: '', children: [
        { label: 'Budget Management', icon: 'savings', link: '/coming-soon/Budget Management' },
      ] },
    ];
    if (admin) {
      groups.push({ label: 'ADMIN', icon: '', children: [
        { label: superAdmin ? 'Admin Panel' : 'Admin Panel', icon: 'settings', link: '/admin' },
      ] });
    }
    return groups;
  });

  roleLabel(): string {
    const r = this.auth.user()?.role;
    return r === 'SUPER_ADMIN' ? 'SUPER ADMIN' : r === 'DOMAIN_ADMIN' ? 'ADMIN' : 'EMPLOYEE';
  }
  initials(): string {
    return (this.auth.user()?.name ?? '?').split(' ').map((s) => s[0]).slice(0, 2).join('');
  }
  signOut(): void { this.auth.logout(); this.ctx.clear(); this.router.navigateByUrl('/login'); }
}
