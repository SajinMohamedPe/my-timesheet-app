import { Component, computed, ElementRef, HostListener, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet, Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { AuthService } from '../../core/services/auth.service';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService } from '../../core/services/api.service';

interface Feature { label: string; icon: string; desc: string; link: string; admin?: boolean; }
interface NavItem { label: string; icon: string; link: string; admin?: boolean; }
interface NavParent { label: string; icon: string; expandable?: boolean; link?: string; children?: NavItem[]; }
interface NavGroup { heading: string; items: NavParent[]; }

@Component({
  selector: 'dtt-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatIconModule, MatMenuModule, FormsModule],
  styleUrl: './shell.component.scss',
  template: `
  <div class="shell" [class.collapsed]="collapsed()">
    <!-- Top bar spans the full width -->
    <header class="topbar">
      <button class="toggle" (click)="collapsed.set(!collapsed())" title="Toggle menu">
        <mat-icon>{{ collapsed() ? 'menu' : 'close' }}</mat-icon>
      </button>

      <div class="brand">
        <div class="bn">Deloitte</div>
        <div class="bs">Account Management</div>
      </div>

      <div class="search" (click)="$event.stopPropagation()">
        <mat-icon>search</mat-icon>
        <input [(ngModel)]="query" (focus)="open.set(true)" (keydown.escape)="close()"
               (keydown.enter)="go(results()[0])" placeholder="Search features, tabs…" />
        @if (open() && query() && results().length) {
          <div class="results">
            @for (r of results(); track r.link) {
              <button class="result" (click)="go(r)">
                <span class="ricon"><mat-icon>{{ r.icon }}</mat-icon></span>
                <span class="rtext"><span class="rt">{{ r.label }}</span><span class="rd">{{ r.desc }}</span></span>
              </button>
            }
          </div>
        }
        @if (open() && query() && !results().length) {
          <div class="results"><div class="empty">No matches for “{{ query() }}”</div></div>
        }
      </div>

      <span class="spacer"></span>

      @if (auth.isAdmin() && ctx.domains().length) {
        <button class="domain-switch" [matMenuTriggerFor]="dmenu" [disabled]="!ctx.hasMultiple()">
          <mat-icon>workspaces</mat-icon>
          <span>{{ ctx.selected()?.name ?? 'All domains' }}</span>
          @if (ctx.hasMultiple()) { <mat-icon class="cx">expand_more</mat-icon> }
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
      <button class="signout" (click)="resetDemo()" title="Reset demo data"><mat-icon>restart_alt</mat-icon></button>
      <button class="signout" (click)="signOut()"><mat-icon>logout</mat-icon><span>Sign Out</span></button>
    </header>

    <div class="body">
      <aside class="sidebar">
        <nav>
          @for (group of nav(); track group.heading) {
            @if (group.heading !== '_') { <div class="nav-group">{{ group.heading }}</div> }
            @for (item of group.items; track item.label) {
              @if (item.expandable) {
                <button class="nav-item parent" (click)="toggleExpand(item.label)" [title]="item.label">
                  <mat-icon class="lead">{{ item.icon }}</mat-icon>
                  <span class="lbl">{{ item.label }}</span>
                  <mat-icon class="caret">{{ expanded().has(item.label) ? 'expand_less' : 'expand_more' }}</mat-icon>
                </button>
                @if (expanded().has(item.label) && !collapsed()) {
                  <div class="children">
                    @for (child of item.children!; track child.label) {
                      <a class="nav-item child" [routerLink]="child.link" routerLinkActive="active" [title]="child.label">
                        <mat-icon class="lead">{{ child.icon }}</mat-icon><span class="lbl">{{ child.label }}</span>
                      </a>
                    }
                  </div>
                }
              } @else {
                <a class="nav-item" [routerLink]="item.link" routerLinkActive="active" [title]="item.label">
                  <mat-icon class="lead">{{ item.icon }}</mat-icon><span class="lbl">{{ item.label }}</span>
                </a>
              }
            }
          }
        </nav>
      </aside>

      <main class="content"><router-outlet /></main>
    </div>
  </div>
  `,
})
export class ShellComponent implements OnInit {
  auth = inject(AuthService);
  ctx = inject(DomainContextService);
  private router = inject(Router);
  private host = inject(ElementRef);
  private api = inject(ApiService);

  collapsed = signal(false);
  query = signal('');
  open = signal(false);
  expanded = signal(new Set<string>(['Time Tracking', 'Project Management']));

  ngOnInit() { this.ctx.load(); }

  // Close the search dropdown when clicking elsewhere.
  @HostListener('document:click', ['$event'])
  onDocClick(ev: Event) {
    if (!this.host.nativeElement.querySelector('.search').contains(ev.target)) this.open.set(false);
  }

  private readonly features: Feature[] = [
    { label: 'Home', icon: 'grid_view', desc: 'Dashboard overview', link: '/home' },
    { label: 'Timesheets', icon: 'grid_on', desc: 'Weekly time entry', link: '/timesheets' },
    { label: 'Visibility Plan', icon: 'visibility', desc: 'Team leave calendar for the month', link: '/visibility' },
    { label: 'Reports', icon: 'bar_chart', desc: 'Download monthly timesheet reports', link: '/reports', admin: true },
    { label: 'Leave Approvals', icon: 'fact_check', desc: 'Approve or reject pending leave', link: '/leave-approvals', admin: true },
    { label: 'Timesheet Audit', icon: 'history', desc: 'History of admin edits', link: '/audit', admin: true },
    { label: 'Admin Panel', icon: 'settings', desc: 'Domains, WBS codes and user roles', link: '/admin', admin: true },
    { label: 'Billing', icon: 'credit_card', desc: 'Invoicing & billing (coming soon)', link: '/coming-soon/Billing', admin: true },
    { label: 'Forecasting', icon: 'insights', desc: 'Capacity forecasting (coming soon)', link: '/coming-soon/Forecasting', admin: true },
    { label: 'Leakage Report', icon: 'travel_explore', desc: 'Revenue leakage (coming soon)', link: '/coming-soon/Leakage Report', admin: true },
    { label: 'Budget Management', icon: 'savings', desc: 'Project budgets (coming soon)', link: '/coming-soon/Budget Management', admin: true },
  ];

  private allowed = computed(() => this.features.filter((f) => !f.admin || this.auth.isAdmin()));

  results = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return [];
    return this.allowed()
      .filter((f) => f.label.toLowerCase().includes(q) || f.desc.toLowerCase().includes(q))
      .slice(0, 6);
  });

  go(f?: Feature) {
    if (!f) return;
    this.router.navigateByUrl(f.link);
    this.query.set(''); this.open.set(false);
  }
  close() { this.open.set(false); this.query.set(''); }
  toggleExpand(label: string) {
    const s = new Set(this.expanded());
    s.has(label) ? s.delete(label) : s.add(label);
    this.expanded.set(s);
  }

  nav = computed<NavGroup[]>(() => {
    const admin = this.auth.isAdmin();
    const tt: NavItem[] = [
      { label: 'Timesheets', icon: 'grid_on', link: '/timesheets' },
      { label: 'Visibility Plan', icon: 'visibility', link: '/visibility' },
    ];
    if (admin) {
      tt.push({ label: 'Leave Approvals', icon: 'fact_check', link: '/leave-approvals' });
      tt.push({ label: 'Reports', icon: 'bar_chart', link: '/reports' });
      tt.push({ label: 'Timesheet Audit', icon: 'history', link: '/audit' });
    }
    const core: NavParent[] = [
      { label: 'Time Tracking', icon: 'schedule', expandable: true, children: tt },
    ];
    // Billing / Forecasting / Leakage are admin & super-admin only.
    if (admin) {
      core.push({ label: 'Billing', icon: 'credit_card', link: '/coming-soon/Billing' });
      core.push({ label: 'Forecasting', icon: 'insights', link: '/coming-soon/Forecasting' });
      core.push({ label: 'Leakage Report', icon: 'travel_explore', link: '/coming-soon/Leakage Report' });
    }
    const groups: NavGroup[] = [
      { heading: '_', items: [{ label: 'Home', icon: 'grid_view', link: '/home' }] },
      { heading: 'CORE', items: core },
    ];
    if (admin) {
      groups.push({ heading: 'PROJECTS', items: [
        { label: 'Project Management', icon: 'inventory_2', expandable: true, children: [
          { label: 'Budget Management', icon: 'savings', link: '/coming-soon/Budget Management' },
        ] },
      ] });
      groups.push({ heading: 'ADMIN', items: [{ label: 'Admin Panel', icon: 'settings', link: '/admin' }] });
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
  resetDemo(): void {
    if (!confirm('Reset all demo data back to the seed? Anything you entered will be lost.')) return;
    this.api.resetDemo().subscribe(() => location.reload());
  }
}
