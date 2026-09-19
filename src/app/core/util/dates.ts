// Week runs Sunday -> Saturday (matches the SAP reference & calendar screenshots).

// ---------------- Irish public (bank) holidays ----------------
// Republic of Ireland. Computed per year so any month/year works.

function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}
function nthMonday(year: number, month: number, n: number): Date {
  const first = new Date(year, month, 1);
  const offset = (1 - first.getDay() + 7) % 7; // Monday = 1
  return new Date(year, month, 1 + offset + (n - 1) * 7);
}
function lastMonday(year: number, month: number): Date {
  const last = new Date(year, month + 1, 0);
  const offset = (last.getDay() - 1 + 7) % 7;
  return new Date(year, month, last.getDate() - offset);
}

const holidayCache = new Map<number, Set<string>>();
export function irishBankHolidays(year: number): Set<string> {
  if (holidayCache.has(year)) return holidayCache.get(year)!;
  const s = new Set<string>();
  const add = (d: Date) => s.add(isoDate(d));
  add(new Date(year, 0, 1));                       // New Year's Day
  const feb1 = new Date(year, 1, 1);               // St Brigid's Day (since 2023):
  add(feb1.getDay() === 5 ? feb1 : nthMonday(year, 1, 1)); //  1 Feb if Friday, else first Monday
  add(new Date(year, 2, 17));                      // St Patrick's Day
  const em = easterSunday(year); em.setDate(em.getDate() + 1);
  add(em);                                         // Easter Monday
  add(nthMonday(year, 4, 1));                      // May (first Monday)
  add(nthMonday(year, 5, 1));                      // June (first Monday)
  add(nthMonday(year, 7, 1));                      // August (first Monday)
  add(lastMonday(year, 9));                        // October (last Monday)
  add(new Date(year, 11, 25));                     // Christmas Day
  add(new Date(year, 11, 26));                     // St Stephen's Day
  holidayCache.set(year, s);
  return s;
}
export function isIrishBankHoliday(d: Date): boolean {
  return irishBankHolidays(d.getFullYear()).has(isoDate(d));
}
/** Standard working day; also the fixed hours for a Bank Holiday. */
export const BANK_HOLIDAY_HOURS = 7.25;

/** Current month as local YYYY-MM (not UTC). */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function isoDate(d: Date): string {
  // Local Y-M-D (NOT toISOString, which converts to UTC and can shift the day).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
