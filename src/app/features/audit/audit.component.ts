import { Component, inject, OnInit, signal, effect } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService } from '../../core/services/api.service';
import { AuditEntry } from '../../core/models/models';

@Component({
  selector: 'dtt-audit',
  imports: [MatIconModule, DatePipe],
  template: `
  <h2 class="page-title">Timesheet Audit</h2>
  <p class="breadcrumb">Time Tracking · Timesheet Audit · {{ ctx.selected()?.name ?? 'All domains' }}</p>

  <div class="card">
    <p class="muted small">Every admin edit to another person's timesheet or leave is recorded here.</p>
    <table class="dtt">
      <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Affected</th><th>Detail</th></tr></thead>
      <tbody>
        @for (a of entries(); track a.id) {
          <tr>
            <td>{{ a.at | date:'dd MMM y, HH:mm' }}</td>
            <td>{{ a.actorName }}</td>
            <td><span class="chip" [class]="cls(a.action)">{{ a.action }}</span></td>
            <td>{{ a.entity }}</td>
            <td>{{ a.targetUserName ?? '—' }}</td>
            <td class="muted">{{ a.summary }}</td>
          </tr>
        }
        @if (!entries().length) { <tr><td colspan="6" class="muted">No audit records yet. Edit another user's timesheet as an admin to see entries here.</td></tr> }
      </tbody>
    </table>
  </div>
  `,
  styles: [`
    .small { font-size: 12px; margin: 0 0 12px; }
    .chip.create { background: #e5f2d3; color: var(--dtt-green-dark); }
    .chip.update { background: #fdf1d6; color: #9a6b00; }
    .chip.delete { background: #fde3e3; color: #b23; }
    .chip.approve { background: #e5f2d3; color: var(--dtt-green-dark); }
    .chip.reject { background: #fde3e3; color: #b23; }
  `],
})
export class AuditComponent implements OnInit {
  ctx = inject(DomainContextService);
  private api = inject(ApiService);
  entries = signal<AuditEntry[]>([]);

  constructor() { effect(() => { this.ctx.selectedId(); this.load(); }); }
  ngOnInit(): void { this.load(); }

  private load(): void {
    this.api.getAudit(this.ctx.selectedId() ?? undefined).subscribe((a) => this.entries.set(a));
  }
  cls(action: string): string { return action.toLowerCase(); }
}
