import { Injectable } from '@angular/core';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ProjectSummary } from '../models/models';
import { EmployeeReport } from './api.service';

/**
 * Client-side report generation for the UI phase. In production the backend
 * exposes GET .../export?format=xlsx|pdf and returns the file; this service can
 * then be swapped for a simple blob download of that response.
 */
@Injectable({ providedIn: 'root' })
export class ExportService {
  // ---------------- Project Summary ----------------

  projectSummaryToExcel(summary: ProjectSummary): void {
    const aoa: (string | number)[][] = [];
    aoa.push([summary.title]);
    const header = summary.scope === 'ALL'
      ? ['Name', 'Domain', 'WBS Code', 'Project', 'Hours', 'Days']
      : ['Name', 'WBS Code', 'Project', 'Hours', 'Days'];
    aoa.push(header);

    // Group by project (WBS description), matching the Excel screenshots.
    const groups = groupByProject(summary);
    for (const g of groups) {
      for (const r of g.rows) {
        aoa.push(summary.scope === 'ALL'
          ? [r.name, r.domainName ?? '', r.wbsCode, r.project, r.hours, round(r.days)]
          : [r.name, r.wbsCode, r.project, r.hours, round(r.days)]);
      }
      const pad = summary.scope === 'ALL' ? ['', '', '', 'Project Total'] : ['', '', 'Project Total'];
      aoa.push([...pad, g.hours, round(g.days)]);
      aoa.push([]);
    }
    const gpad = summary.scope === 'ALL' ? ['', '', '', 'Grand Total'] : ['', '', 'Grand Total'];
    aoa.push([...gpad, summary.grandTotalHours, round(summary.grandTotalDays)]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = header.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Project Summary');
    XLSX.writeFile(wb, fileName('Project_Summary', summary.month, 'xlsx'));
  }

  projectSummaryToPdf(summary: ProjectSummary): void {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(summary.title, 14, 16);
    const groups = groupByProject(summary);
    const body: any[] = [];
    for (const g of groups) {
      for (const r of g.rows) {
        body.push(summary.scope === 'ALL'
          ? [r.name, r.domainName ?? '', r.wbsCode, r.project, r.hours, round(r.days)]
          : [r.name, r.wbsCode, r.project, r.hours, round(r.days)]);
      }
      const pad = summary.scope === 'ALL' ? ['', '', '', 'Project Total'] : ['', '', 'Project Total'];
      body.push([...pad, g.hours, round(g.days)]);
    }
    const gpad = summary.scope === 'ALL' ? ['', '', '', 'Grand Total'] : ['', '', 'Grand Total'];
    body.push([...gpad, summary.grandTotalHours, round(summary.grandTotalDays)]);

    autoTable(doc, {
      startY: 22,
      head: [summary.scope === 'ALL'
        ? ['Name', 'Domain', 'WBS Code', 'Project', 'Hours', 'Days']
        : ['Name', 'WBS Code', 'Project', 'Hours', 'Days']],
      body,
      styles: { fontSize: 9 },
      headStyles: { fillColor: [134, 188, 37] },
    });
    doc.save(fileName('Project_Summary', summary.month, 'pdf'));
  }

  // ---------------- Per-employee report ----------------

  employeeReportsToExcel(reports: EmployeeReport[]): void {
    const wb = XLSX.utils.book_new();
    const usedNames = new Set<string>();
    for (const rep of reports) {
      const aoa: (string | number)[][] = [];
      aoa.push([`${rep.name} — ${rep.monthLabel}`]);
      aoa.push(['Date', 'WBS Code', 'Project', 'Hours', 'Notes']);
      for (const e of rep.entries) aoa.push([e.date, e.wbsCode, e.project, e.hours, e.notes]);
      aoa.push(['', '', 'Total', rep.totalHours, `${round(rep.totalDays)} days`]);
      if (rep.leaves.length) {
        aoa.push([]);
        aoa.push(['Leave']);
        aoa.push(['Date', 'Type', 'Hours']);
        for (const l of rep.leaves) aoa.push([l.date, l.type, l.hours.toFixed(2)]);
      }
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 24 }, { wch: 8 }, { wch: 30 }];
      // Ensure a unique sheet name (Excel rejects duplicates).
      let name = safeSheet(rep.name);
      let n = 2;
      while (usedNames.has(name.toLowerCase())) name = safeSheet(rep.name).slice(0, 25) + ' (' + n++ + ')';
      usedNames.add(name.toLowerCase());
      XLSX.utils.book_append_sheet(wb, ws, name);
    }
    const month = reports[0]?.month ?? '';
    const single = reports.length === 1 ? safeSheet(reports[0].name) + '_' : 'All_Employees_';
    XLSX.writeFile(wb, `${single}Timesheet_${month}.xlsx`);
  }

  employeeReportsToPdf(reports: EmployeeReport[]): void {
    const doc = new jsPDF();
    reports.forEach((rep, idx) => {
      if (idx > 0) doc.addPage();
      doc.setFontSize(14);
      doc.text(`${rep.name} — ${rep.monthLabel}`, 14, 16);
      autoTable(doc, {
        startY: 22,
        head: [['Date', 'WBS Code', 'Project', 'Hours', 'Notes']],
        body: rep.entries.map((e) => [e.date, e.wbsCode, e.project, e.hours, e.notes]),
        foot: [['', '', 'Total', String(rep.totalHours), `${round(rep.totalDays)} days`]],
        styles: { fontSize: 9 },
        headStyles: { fillColor: [134, 188, 37] },
        footStyles: { fillColor: [240, 240, 240], textColor: 20 },
      });
      if (rep.leaves.length) {
        autoTable(doc, {
          head: [['Leave Date', 'Type', 'Hours']],
          body: rep.leaves.map((l) => [l.date, l.type, l.hours.toFixed(2)]),
          styles: { fontSize: 9 },
          headStyles: { fillColor: [110, 110, 110] },
        });
      }
    });
    const month = reports[0]?.month ?? '';
    const single = reports.length === 1 ? safeSheet(reports[0].name) + '_' : 'All_Employees_';
    doc.save(`${single}Timesheet_${month}.pdf`);
  }
}

function groupByProject(summary: ProjectSummary) {
  const byProject = new Map<string, { rows: ProjectSummary['rows']; hours: number; days: number }>();
  for (const r of summary.rows) {
    const key = r.wbsCode + ' ' + r.project;
    const g = byProject.get(key) ?? { rows: [], hours: 0, days: 0 };
    g.rows.push(r); g.hours += r.hours; g.days += r.days;
    byProject.set(key, g);
  }
  return [...byProject.values()];
}

const round = (n: number) => Math.round(n * 10000) / 10000;
// Excel sheet names: non-empty, <=31 chars, no \ / ? * [ ] :
const safeSheet = (s?: string | null) => ((s ?? 'Sheet').replace(/[\\/?*[\]:]/g, '').slice(0, 28) || 'Sheet');
const fileName = (prefix: string, month: string, ext: string) => `${prefix}_${month}.${ext}`;
