import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService, EmployeeReport } from '../../core/services/api.service';
import { ExportService } from '../../core/services/export.service';
import { PageHeaderComponent } from '../../shared/page-header.component';
import { currentMonth, isIrishBankHoliday } from '../../core/util/dates';
import { User } from '../../core/models/models';

@Component({
  selector: 'dtt-reports',
  imports: [FormsModule, MatIconModule, PageHeaderComponent],
  template: `
  <dtt-page-header icon="bar_chart" title="Reports" crumb="Visibility Plan · Reports" />

  <div class="block">
    <div class="block-h"><mat-icon class="bi">download</mat-icon><span class="bname">Generate Report</span>
      <span class="bdesc">monthly timesheet — per employee or consolidated</span></div>
    <div class="block-body">
    <div class="controls">
      <div class="field">
        <label>EMPLOYEE</label>
        <select [(ngModel)]="selected">
          <option value="ALL">All Employees — Consolidated</option>
          @for (u of users(); track u.id) { <option [value]="u.id">{{ u.name }}</option> }
        </select>
      </div>
      <div class="field">
        <label>MONTH</label>
        <input type="month" [(ngModel)]="month" (ngModelChange)="loadOver()" />
      </div>
      <button class="btn excel" (click)="download('xlsx')"><mat-icon>download</mat-icon> Download Excel</button>
      <button class="btn pdf" (click)="download('pdf')"><mat-icon>picture_as_pdf</mat-icon> Download PDF</button>
    </div>

    @if (selected === 'ALL') {
      <div class="note"><mat-icon>info</mat-icon> All employees combined into a <b>single file</b> — one sheet per employee (Excel) or one section per employee (PDF).</div>
    }
    </div>
  </div>

  <div class="block">
    <div class="block-h"><mat-icon class="bi">groups</mat-icon><span class="bname">Quick download</span>
      <span class="bdesc">individual employees</span></div>
    <div class="block-body">
    <div class="cards">
      @for (u of users(); track u.id) {
        <div class="qcard" [class.warn]="overUsers().has(u.id)">
          <span class="ava">{{ u.name[0] }}</span>
          <div class="info">
            <div class="n">{{ u.name }}
              @if (overUsers().has(u.id)) { <mat-icon class="warnico" title="Has a day over 8h this month">warning</mat-icon> }
            </div>
            <div class="s">
              @if (overUsers().has(u.id)) { <span class="chip alert">Over 8h</span> }
              @else { <span class="chip green">{{ u.active ? 'Active' : 'Inactive' }}</span> }
            </div>
          </div>
          <div class="acts">
            <button (click)="one(u.id,'xlsx')">XLS</button>
            <button (click)="one(u.id,'pdf')">PDF</button>
          </div>
        </div>
      }
    </div>
    </div>
  </div>
  @if (busy()) { <p class="muted">{{ busy() }}</p> }
  `,
  styleUrl: './reports.component.scss',
})
export class ReportsComponent implements OnInit {
  private api = inject(ApiService);
  private ctx = inject(DomainContextService);
  private exporter = inject(ExportService);

  users = signal<User[]>([]);
  overUsers = signal<Set<string>>(new Set()); // users with any day > 8h this month
  selected = 'ALL';
  month = currentMonth();
  busy = signal('');

  constructor() { effect(() => { this.ctx.selectedId(); this.load(); }); }
  ngOnInit(): void { this.load(); }

  private load(): void {
    this.api.getUsers(this.ctx.selectedId() ?? undefined).subscribe((u) => this.users.set(u));
    this.loadOver();
  }

  /** Flag employees who have any day over 8h (work + leave) in the selected month. */
  loadOver(): void {
    this.api.getVisibility(this.ctx.selectedId(), this.month).subscribe((plan) => {
      const over = new Set<string>();
      for (const row of plan.rows) {
        const byDate = new Map<string, { w: number; l: number; bank: boolean }>();
        for (const e of row.entries) {
          const x = byDate.get(e.date) ?? { w: 0, l: 0, bank: false }; x.w += e.hours; byDate.set(e.date, x);
        }
        for (const lv of row.leaves) {
          if (lv.status === 'REJECTED') continue;
          const x = byDate.get(lv.date) ?? { w: 0, l: 0, bank: false };
          x.l += lv.hours || 0; if (lv.type === 'BANK_HOLIDAY') x.bank = true; byDate.set(lv.date, x);
        }
        for (const [date, x] of byDate) {
          let total = x.w + x.l;
          if (isIrishBankHoliday(new Date(date + 'T00:00:00')) && !x.bank) total += 7.25;
          if (total > 8) { over.add(row.userId); break; }
        }
      }
      this.overUsers.set(over);
    });
  }

  download(format: 'xlsx' | 'pdf'): void {
    if (this.selected === 'ALL') this.consolidated(format);
    else this.one(this.selected, format);
  }

  one(userId: string, format: 'xlsx' | 'pdf'): void {
    this.busy.set('Generating…');
    this.api.getEmployeeReport(userId, this.month).subscribe((rep) => {
      if (format === 'xlsx') this.exporter.employeeReportsToExcel([rep]);
      else this.exporter.employeeReportsToPdf([rep]);
      this.busy.set('');
    });
  }

  consolidated(format: 'xlsx' | 'pdf'): void {
    this.busy.set('Generating…');
    const calls = this.users().map((u) => this.api.getEmployeeReport(u.id, this.month));
    forkJoin(calls).subscribe((reports: EmployeeReport[]) => {
      if (format === 'xlsx') this.exporter.employeeReportsToExcel(reports);
      else this.exporter.employeeReportsToPdf(reports);
      this.busy.set('');
    });
  }
}
