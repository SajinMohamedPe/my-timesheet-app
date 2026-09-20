import { Component, EventEmitter, Input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * Reusable confirmation modal. Controlled via [open]; emits (confirm)/(cancel).
 * Rendered as an overlay so it works anywhere without MatDialog wiring.
 */
@Component({
  selector: 'dtt-confirm-dialog',
  imports: [MatIconModule],
  template: `
  @if (open) {
    <div class="backdrop" (click)="cancel.emit()">
      <div class="modal" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
        <div class="head">
          <div class="icon" [class.danger]="danger"><mat-icon>{{ danger ? 'delete_forever' : 'help_outline' }}</mat-icon></div>
          <h3>{{ title }}</h3>
        </div>
        <p class="msg">{{ message }}</p>
        @if (detail) { <p class="detail">{{ detail }}</p> }
        <div class="actions">
          <button class="btn ghost" (click)="cancel.emit()">{{ cancelLabel }}</button>
          <button class="btn" [class.danger]="danger" (click)="confirm.emit()">{{ confirmLabel }}</button>
        </div>
      </div>
    </div>
  }
  `,
  styles: [`
    .backdrop { position: fixed; inset: 0; background: rgba(20,22,24,.45); z-index: 100;
      display: flex; align-items: center; justify-content: center; padding: 20px; }
    .modal { background: var(--dtt-card); border-radius: 14px; width: 440px; max-width: 100%;
      box-shadow: 0 24px 60px rgba(0,0,0,.28); padding: 24px; animation: pop .12s ease; }
    @keyframes pop { from { transform: scale(.96); opacity: .6; } to { transform: scale(1); opacity: 1; } }
    .head { display: flex; align-items: center; gap: 12px; }
    .icon { width: 44px; height: 44px; border-radius: 12px; background: var(--dtt-tint); color: var(--dtt-green-dark);
      display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .icon.danger { background: #fdeceb; color: #b4322f; }
    .icon mat-icon { font-size: 24px; width: 24px; height: 24px; }
    h3 { margin: 0; font-size: 19px; }
    .msg { margin: 16px 0 0; font-size: 14px; line-height: 1.5; color: var(--dtt-ink); }
    .detail { margin: 8px 0 0; font-size: 13px; color: var(--dtt-muted); }
    .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 22px; }
    .btn { border: 1px solid var(--dtt-line); background: var(--dtt-card); border-radius: 9px; padding: 10px 18px;
      cursor: pointer; font-weight: 600; font-size: 14px; }
    .btn.ghost { color: var(--dtt-muted); }
    .btn.danger { background: #b4322f; color: #fff; border-color: #b4322f; }
    .btn.danger:hover { background: #9c2a27; }
  `],
})
export class ConfirmDialogComponent {
  @Input() open = false;
  @Input() title = 'Are you sure?';
  @Input() message = '';
  @Input() detail = '';
  @Input() confirmLabel = 'Confirm';
  @Input() cancelLabel = 'Cancel';
  @Input() danger = false;
  @Output() confirm = new EventEmitter<void>();
  @Output() cancel = new EventEmitter<void>();
}
