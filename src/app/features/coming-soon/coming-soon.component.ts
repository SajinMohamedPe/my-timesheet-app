import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Component({
  selector: 'dtt-coming-soon',
  template: `
  <h2 class="page-title">{{ title() }}</h2>
  <div class="card cs">
    <div class="icon">🚧</div>
    <h3>{{ title() }}</h3>
    <p class="muted">This module is coming soon. It will be built out in a later phase.</p>
    <span class="chip amber">Coming Soon</span>
  </div>
  `,
  styles: [`
    .cs { max-width: 620px; margin: 40px auto; text-align: center; }
    .icon { font-size: 44px; }
    h3 { margin: 12px 0 6px; font-size: 24px; }
    p { margin: 0 auto 18px; max-width: 420px; }
  `],
})
export class ComingSoonComponent {
  private route = inject(ActivatedRoute);
  title = toSignal(this.route.paramMap.pipe(map((p) => p.get('title') ?? 'Coming Soon')), { initialValue: 'Coming Soon' });
}
