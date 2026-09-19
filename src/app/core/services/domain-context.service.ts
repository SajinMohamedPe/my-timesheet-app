import { computed, effect, Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { Domain } from '../models/models';

const SELECTED_KEY = 'dtt.selectedDomain';

/**
 * Tracks which domains the current user can see and which one is "active"
 * (the domain switcher). All scoped screens read `selectedId()`.
 */
@Injectable({ providedIn: 'root' })
export class DomainContextService {
  private readonly _domains = signal<Domain[]>([]);
  private readonly _selectedId = signal<string | null>(this.readStored());

  readonly domains = this._domains.asReadonly();
  readonly selectedId = this._selectedId.asReadonly();
  readonly selected = computed(() =>
    this._domains().find((d) => d.id === this._selectedId()) ?? null);
  readonly hasMultiple = computed(() => this._domains().length > 1);

  constructor(private http: HttpClient) {
    effect(() => {
      const id = this._selectedId();
      try { id ? localStorage.setItem(SELECTED_KEY, id) : localStorage.removeItem(SELECTED_KEY); }
      catch { /* ignore */ }
    });
  }

  load(): void {
    this.http.get<Domain[]>(`${environment.apiBase}/domains`).subscribe((domains) => {
      this._domains.set(domains);
      const current = this._selectedId();
      if (!current || !domains.some((d) => d.id === current)) {
        this._selectedId.set(domains[0]?.id ?? null);
      }
    });
  }

  select(id: string): void { this._selectedId.set(id); }

  clear(): void { this._domains.set([]); this._selectedId.set(null); }

  private readStored(): string | null {
    try { return localStorage.getItem(SELECTED_KEY); } catch { return null; }
  }
}
