import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../core/services/auth.service';
import { ThemeService } from '../../core/services/theme.service';
import { DEMO_CREDENTIALS } from '../../core/mock/seed';

@Component({
  selector: 'dtt-login',
  imports: [FormsModule, MatIconModule],
  styleUrl: './login.component.scss',
  template: `
  <div class="login">
    <button class="theme-toggle" (click)="theme.toggle()" [title]="theme.dark() ? 'Switch to light mode' : 'Switch to dark mode'">
      <mat-icon>{{ theme.dark() ? 'light_mode' : 'dark_mode' }}</mat-icon>
    </button>
    <div class="panel-left">
      <div class="brand">
        <span class="bar"></span>
        <div>
          <div class="brand-name">Deloitte</div>
          <div class="brand-sub">Account Management</div>
        </div>
      </div>

      <h1>Sign In</h1>
      <p class="muted">Use your local credentials to continue.</p>

      <form (ngSubmit)="submit()">
        <label>USERNAME</label>
        <input name="username" [(ngModel)]="username" placeholder="Enter username" autocomplete="username" />

        <label>PASSWORD</label>
        <input name="password" type="password" [(ngModel)]="password" placeholder="Enter password" autocomplete="current-password" />

        @if (error()) { <div class="error">{{ error() }}</div> }

        <button type="submit" [disabled]="loading()">{{ loading() ? 'Signing in…' : 'Sign In' }}</button>
      </form>

      <div class="demo">
        <div class="demo-title">DEMO CREDENTIALS</div>
        @for (c of demo; track c.label) {
          <div class="demo-row">
            <span class="u">{{ c.username }}</span>
            <span class="p">{{ c.password }}</span>
            <span class="r">{{ c.label }}</span>
          </div>
        }
        <p class="muted small">Admin is a <b>role</b>, not a separate account. A Super Admin grants admin rights and domain access.</p>
      </div>
    </div>

    <div class="panel-right">
      <div class="chart">
        @for (h of bars; track $index) { <span [style.height.%]="h"></span> }
      </div>
      <div class="right-title">Deloitte Ireland<br/>Timesheet System</div>
    </div>
  </div>
  `,
})
export class LoginComponent {
  theme = inject(ThemeService);
  private auth = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  loading = signal(false);
  error = signal('');
  demo = DEMO_CREDENTIALS;
  bars = [40, 55, 48, 70, 62, 85, 95, 72, 60, 78, 66, 52, 74, 58, 44, 62, 50, 40];

  submit(): void {
    this.error.set('');
    this.loading.set(true);
    this.auth.login(this.username, this.password).subscribe({
      next: () => { this.loading.set(false); this.router.navigateByUrl('/home'); },
      error: (e) => { this.loading.set(false); this.error.set(e?.error?.message ?? 'Login failed'); },
    });
  }
}
