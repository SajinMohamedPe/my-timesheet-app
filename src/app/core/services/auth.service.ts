import { HttpClient } from '@angular/common/http';
import { computed, Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, LoginResponse } from '../models/models';

const TOKEN_KEY = 'dtt.auth';

interface StoredAuth { accessToken: string; refreshToken: string; user: AuthUser; }

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _user = signal<AuthUser | null>(null);
  private _access: string | null = null;
  private _refresh: string | null = null;

  readonly user = this._user.asReadonly();
  readonly isAuthenticated = computed(() => this._user() !== null);
  readonly isAdmin = computed(() => {
    const r = this._user()?.role;
    return r === 'SUPER_ADMIN' || r === 'DOMAIN_ADMIN';
  });
  readonly isSuperAdmin = computed(() => this._user()?.role === 'SUPER_ADMIN');

  constructor(private http: HttpClient) {
    this.restore();
  }

  accessToken(): string | null { return this._access; }

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${environment.apiBase}/auth/login`, { username, password })
      .pipe(tap((res) => this.persist(res)));
  }

  logout(): void {
    this._user.set(null);
    this._access = this._refresh = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }

  private persist(res: LoginResponse): void {
    this._access = res.accessToken;
    this._refresh = res.refreshToken;
    this._user.set(res.user);
    try {
      localStorage.setItem(TOKEN_KEY, JSON.stringify({
        accessToken: res.accessToken, refreshToken: res.refreshToken, user: res.user,
      } as StoredAuth));
    } catch { /* ignore */ }
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(TOKEN_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as StoredAuth;
      this._access = s.accessToken;
      this._refresh = s.refreshToken;
      this._user.set(s.user);
    } catch { /* ignore */ }
  }
}
