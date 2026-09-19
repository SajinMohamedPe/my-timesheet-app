import { Routes } from '@angular/router';
import { authGuard, adminGuard, superAdminGuard } from './core/guards/guards';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/auth/login.component').then((m) => m.LoginComponent) },
  {
    path: '',
    loadComponent: () => import('./features/shell/shell.component').then((m) => m.ShellComponent),
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      { path: 'home', loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent) },
      { path: 'timesheets', loadComponent: () => import('./features/timesheets/weekly-grid.component').then((m) => m.WeeklyGridComponent) },
      { path: 'visibility', loadComponent: () => import('./features/visibility/visibility.component').then((m) => m.VisibilityComponent) },
      { path: 'reports', loadComponent: () => import('./features/reports/reports.component').then((m) => m.ReportsComponent), canActivate: [adminGuard] },
      { path: 'audit', loadComponent: () => import('./features/audit/audit.component').then((m) => m.AuditComponent), canActivate: [adminGuard] },
      { path: 'leave-approvals', loadComponent: () => import('./features/leave/leave-approvals.component').then((m) => m.LeaveApprovalsComponent), canActivate: [adminGuard] },
      { path: 'admin', loadComponent: () => import('./features/admin/admin-panel.component').then((m) => m.AdminPanelComponent), canActivate: [adminGuard] },
      {
        path: 'coming-soon/:title',
        loadComponent: () => import('./features/coming-soon/coming-soon.component').then((m) => m.ComingSoonComponent),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
