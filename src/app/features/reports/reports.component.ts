import { Component, computed, inject, OnInit, signal, effect } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { forkJoin } from 'rxjs';
import { DomainContextService } from '../../core/services/domain-context.service';
import { ApiService, EmployeeReport } from '../../core/services/api.service';
import { ExportService } from '../../core/services/export.service';
import { User } from '../../core/models/models';

@Component({
  selector: 'dtt-reports',
  imports: [FormsModule, MatIconModule],
  template: `
  <h2 class="page-title">Time Tracking</h2>
  <p class="breadcrumb">Time Tracking · Reports</p>

  <div class="card">
    <h3>Generate Report</h3>
    <p class="muted">Download monthly timesheet reports per employee or for all employees.</p>

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
        <input type="month" [(ngModel)]="month" />
      </div>
      <button class="btn excel" (click)="download('xlsx')"><mat-icon>download</mat-icon> Download Excel</button>
      <button class="btn pdf" (click)="download('pdf')"><mat-icon>picture_as_pdf</mat-icon> Download PDF</button>
    </div>

    @if (selected === 'ALL') {
      <div class="note"><mat-icon>info</mat-icon> All employees combined into a <b>single file</b> — one sheet per employee (Excel) or one section per employee (PDF).</div>
    }
  </div>

  <div class="quick">
    <div class="qtitle">QUICK DOWNLOAD — INDIVIDUAL</div>
    <div class="cards">
      @for (u of users(); track u.id) {
        <div class="qcard">
          <span class="ava">{{ u.name[0] }}</span>
          <div class="info"><div class="n">{{ u.name }}</div><div class="s chip green">{{ u.active ? 'Active' : 'Inactive' }}</div></div>
          <div class="acts">
            <button (click)="one(u.id,'xlsx')">XLS</button>
            <button (click)="one(u.id,'pdf')">PDF</button>
          </div>
        </div>
      }
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
  selected = 'ALL';
  month = new Date().toISOString().slice(0, 7);
  busy = signal('');

  constructor() { effect(() => { this.ctx.selectedId(); this.load(); }); }
  ngOnInit(): void { this.load(); }

  private load(): void {
    this.api.getUsers(this.ctx.selectedId() ?? undefined).subscribe((u) => this.users.set(u));
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
