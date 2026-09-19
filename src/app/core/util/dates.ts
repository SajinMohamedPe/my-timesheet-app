// Week runs Sunday -> Saturday (matches the SAP reference & calendar screenshots).

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The Sunday that starts the week containing `date`. */
export function weekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay()); // getDay(): 0 = Sunday
  return d;
}

export function weekDays(start: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function isWeekend(d: Date): boolean {
  const g = d.getDay();
  return g === 0 || g === 6;
}

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
export function dayLetter(d: Date): string { return DOW[d.getDay()]; }

export function fmtDayName(d: Date): string {
  return d.toLocaleDateString('en-IE', { weekday: 'short' });
}

export function fmtRange(days: Date[]): string {
  const end = days[6];
  return `Week ending ${end.toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
