import { effect, Injectable, signal } from '@angular/core';

const KEY = 'dtt.theme';

/** Light/dark theme, persisted per viewer; stamps data-theme on <html>. */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly dark = signal(this.read());

  constructor() {
    this.stamp(this.dark());               // apply immediately (avoid flash)
    effect(() => {
      const d = this.dark();
      this.stamp(d);
      try { localStorage.setItem(KEY, d ? 'dark' : 'light'); } catch { /* ignore */ }
    });
  }

  toggle(): void { this.dark.set(!this.dark()); }

  private stamp(d: boolean): void {
    document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
  }
  private read(): boolean {
    try {
      const v = localStorage.getItem(KEY);
      if (v) return v === 'dark';
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch { return false; }
  }
}
