import { WbsCode } from '../models/models';
import { buildSeed, MockData } from './seed';

const STORAGE_KEY = 'dtt.mockdb.v2';

/**
 * localStorage-backed store for the mock API. Survives page refresh so the
 * demo behaves like a real app. `reset()` restores the seed.
 */
export class MockDb {
  private data: MockData;

  constructor() {
    this.data = this.load();
  }

  get<T extends keyof MockData>(key: T): MockData[T] {
    return this.data[key];
  }

  /** Persist after mutating any collection. */
  save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable (private mode) — keep working in-memory */
    }
  }

  reset(): void {
    this.data = buildSeed();
    this.save();
  }

  private load(): MockData {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as MockData;
    } catch {
      /* ignore */
    }
    const seed = buildSeed();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
    } catch { /* ignore */ }
    return seed;
  }
}

/** Resolve the WBS description effective on a given ISO date. */
export function resolveWbsName(wbs: WbsCode, isoDate: string): string {
  const match = wbs.nameHistory.find(
    (n) => n.validFrom <= isoDate && (n.validTo === null || isoDate < n.validTo),
  );
  // Fall back to the most recent name if nothing matches the date.
  return (match ?? wbs.nameHistory[wbs.nameHistory.length - 1]).description;
}

export function currentWbsName(wbs: WbsCode): string {
  return resolveWbsName(wbs, '9999-12-31');
}

export function uid(prefix: string): string {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}
