import {
  Component, computed, ElementRef, EventEmitter, HostListener, inject, Input, Output, signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

export interface SelectOption { value: string; label: string; sub?: string; }

/**
 * A compact "+ Add …" button that opens a searchable autocomplete list.
 * Type to filter; click (or Enter) to pick. Emits the chosen option's value.
 */
@Component({
  selector: 'dtt-search-select',
  imports: [FormsModule, MatIconModule],
  template: `
  <div class="ss">
    <button class="trigger" (click)="toggle($event)">
      <mat-icon>add</mat-icon><span>{{ triggerLabel }}</span>
    </button>

    @if (open()) {
      <div class="pop" (click)="$event.stopPropagation()">
        <div class="pop-search">
          <mat-icon>search</mat-icon>
          <input #box [(ngModel)]="query" [placeholder]="placeholder"
                 (keydown.enter)="pickFirst()" (keydown.escape)="close()" autocomplete="off" />
        </div>
        <div class="pop-list">
          @for (o of filtered(); track o.value) {
            <button class="opt" (click)="choose(o)">
              <span class="ol">{{ o.label }}</span>
              @if (o.sub) { <span class="os">{{ o.sub }}</span> }
            </button>
          }
          @if (!filtered().length) { <div class="none">No matches</div> }
        </div>
      </div>
    }
  </div>
  `,
  styles: [`
    .ss { position: relative; display: inline-block; }
    .trigger { display: inline-flex; align-items: center; gap: 4px; border: 1px dashed var(--dtt-line);
      background: #fff; border-radius: 8px; padding: 6px 12px; cursor: pointer; color: var(--dtt-muted); font-size: 13px; }
    .trigger:hover { border-color: var(--dtt-green); color: var(--dtt-green-dark); }
    .trigger mat-icon { font-size: 17px; width: 17px; height: 17px; }
    .pop { position: absolute; top: calc(100% + 6px); left: 0; z-index: 50; width: 320px; max-width: 80vw;
      background: #fff; border: 1px solid var(--dtt-line); border-radius: 10px; box-shadow: 0 12px 28px rgba(0,0,0,.14); overflow: hidden; }
    .pop-search { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--dtt-line); }
    .pop-search mat-icon { color: var(--dtt-muted); font-size: 19px; width: 19px; height: 19px; }
    .pop-search input { border: none; outline: none; width: 100%; font-size: 14px; }
    .pop-list { max-height: 260px; overflow: auto; padding: 6px; }
    .opt { display: flex; flex-direction: column; align-items: flex-start; width: 100%; text-align: left;
      border: none; background: transparent; cursor: pointer; padding: 9px 10px; border-radius: 7px; }
    .opt:hover, .opt:first-child { background: #eef4e0; }
    .ol { font-weight: 600; font-size: 14px; }
    .os { font-size: 12px; color: var(--dtt-muted); }
    .none { padding: 14px; color: var(--dtt-muted); font-size: 13px; }
  `],
})
export class SearchSelectComponent {
  private host = inject(ElementRef);

  @Input() options: SelectOption[] = [];
  @Input() placeholder = 'Search…';
  @Input() triggerLabel = 'Add';
  @Output() pick = new EventEmitter<string>();

  open = signal(false);
  query = signal('');

  filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    if (!q) return this.options;
    return this.options.filter(
      (o) => o.label.toLowerCase().includes(q) || (o.sub ?? '').toLowerCase().includes(q),
    );
  });

  toggle(ev: Event) {
    ev.stopPropagation();
    this.open.set(!this.open());
    if (this.open()) {
      this.query.set('');
      setTimeout(() => this.host.nativeElement.querySelector('input')?.focus(), 0);
    }
  }
  close() { this.open.set(false); this.query.set(''); }
  choose(o: SelectOption) { this.pick.emit(o.value); this.close(); }
  pickFirst() { const f = this.filtered(); if (f.length) this.choose(f[0]); }

  @HostListener('document:click', ['$event'])
  onDoc(ev: Event) { if (!this.host.nativeElement.contains(ev.target)) this.close(); }
}
