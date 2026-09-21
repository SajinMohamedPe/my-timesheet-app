import { Component, ElementRef, EventEmitter, HostListener, Input, Output, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

export interface ColorOption { value: string; label: string; color: string; }

/** A small dropdown whose options carry a colour swatch (e.g. leave types). */
@Component({
  selector: 'dtt-color-select',
  imports: [MatIconModule],
  template: `
  <button type="button" class="cs-btn" (click)="toggle($event)">
    @if (selected(); as s) { <span class="cs-dot" [style.background]="s.color"></span><span class="cs-lbl">{{ s.label }}</span> }
    @else { <span class="cs-ph">{{ placeholder }}</span> }
    <mat-icon>{{ open() ? 'expand_less' : 'expand_more' }}</mat-icon>
  </button>
  @if (open()) {
    <div class="cs-panel">
      @for (o of options; track o.value) {
        <button type="button" class="cs-opt" [class.on]="o.value === value" (click)="pick(o)">
          <span class="cs-dot" [style.background]="o.color"></span>{{ o.label }}
          @if (o.value === value) { <mat-icon class="chk">check</mat-icon> }
        </button>
      }
    </div>
  }
  `,
  styles: [`
    :host { position: relative; display: block; }
    .cs-btn { width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 11px; cursor: pointer;
      border: 1px solid var(--dtt-line); border-radius: 8px; background: var(--dtt-card); color: var(--dtt-ink);
      font-size: 14px; font-weight: 600; }
    .cs-btn:hover { border-color: var(--dtt-green); }
    .cs-btn mat-icon { margin-left: auto; color: var(--dtt-muted); font-size: 20px; width: 20px; height: 20px; }
    .cs-ph { color: var(--dtt-muted); font-weight: 400; }
    .cs-lbl { flex: 1; text-align: left; }
    .cs-dot { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
    .cs-panel { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 30; background: var(--dtt-card);
      border: 1px solid var(--dtt-line); border-radius: 10px; box-shadow: 0 12px 30px rgba(0,0,0,.18); padding: 6px; }
    .cs-opt { width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 10px; cursor: pointer;
      border: none; background: transparent; border-radius: 7px; font-size: 14px; color: var(--dtt-ink); text-align: left; }
    .cs-opt:hover { background: var(--dtt-hover); }
    .cs-opt.on { font-weight: 700; }
    .cs-opt .chk { margin-left: auto; color: var(--dtt-green-dark); font-size: 18px; width: 18px; height: 18px; }
  `],
})
export class ColorSelectComponent {
  @Input() options: ColorOption[] = [];
  @Input() value = '';
  @Input() placeholder = 'Select…';
  @Output() valueChange = new EventEmitter<string>();
  open = signal(false);
  private host = inject(ElementRef);

  selected(): ColorOption | undefined { return this.options.find((o) => o.value === this.value); }
  toggle(e: Event): void { e.stopPropagation(); this.open.update((v) => !v); }
  pick(o: ColorOption): void { this.value = o.value; this.valueChange.emit(o.value); this.open.set(false); }

  @HostListener('document:click', ['$event'])
  onDoc(e: Event): void { if (!this.host.nativeElement.contains(e.target)) this.open.set(false); }
}
