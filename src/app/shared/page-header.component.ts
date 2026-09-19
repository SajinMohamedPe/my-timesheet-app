import { Component, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'dtt-page-header',
  imports: [MatIconModule],
  template: `
  <div class="ph">
    <div class="ph-icon"><mat-icon>{{ icon }}</mat-icon></div>
    <div class="ph-text">
      <h2>{{ title }}</h2>
      @if (crumb) { <div class="crumb">{{ crumb }}</div> }
    </div>
    <span class="ph-spacer"></span>
    <ng-content></ng-content>
  </div>
  `,
  styles: [`
    .ph { display: flex; align-items: center; gap: 14px; margin-bottom: 22px; }
    .ph-icon { width: 46px; height: 46px; border-radius: 12px; flex-shrink: 0;
      background: linear-gradient(135deg, #86bc25, #6a9a17); color: #fff;
      display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(134,188,37,.3); }
    .ph-icon mat-icon { font-size: 24px; width: 24px; height: 24px; }
    .ph-text h2 { margin: 0; font-size: 22px; font-weight: 600; line-height: 1.15; }
    .crumb { color: var(--dtt-muted); font-size: 13px; margin-top: 2px; }
    .ph-spacer { flex: 1; }
  `],
})
export class PageHeaderComponent {
  @Input() icon = 'dashboard';
  @Input() title = '';
  @Input() crumb = '';
}
