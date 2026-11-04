// Monthly spend aggregation for the admin cost graphs. Oldest month first,
// matching the convention used by the level-graph helper in Admin.tsx.
export interface CostAttempt {
  created_at: string;
  cost_usd: number | null;
}

function bucketedSpend(attempts: CostAttempt[], length: 7 | 10): { period: string; cost: number }[] {
  const totals = new Map<string, number>();
  for (const a of attempts) {
    const period = a.created_at.slice(0, length);
    totals.set(period, (totals.get(period) ?? 0) + (a.cost_usd ?? 0));
  }
  return [...totals.entries()]
    .map(([period, cost]) => ({ period, cost }))
    .sort((a, b) => (a.period < b.period ? -1 : 1));
}

export function monthlySpend(attempts: CostAttempt[]): { month: string; cost: number }[] {
  return bucketedSpend(attempts, 7).map(({ period, cost }) => ({ month: period, cost }));
}

export function dailySpend(attempts: CostAttempt[]): { day: string; cost: number }[] {
  return bucketedSpend(attempts, 10).map(({ period, cost }) => ({ day: period, cost }));
}

export interface LevelDaySpend {
  level: string;
  day: string;
  cost: number;
}

// Trailing day labels ending today: the graph always spans a real time
// range instead of stretching one or two days edge to edge.
export function dayWindow(windowDays = 30, today = new Date()): string[] {
  const out: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Zero-filled trailing window over one aggregated series.
export function fillDayRange(
  rows: { day: string; cost: number }[],
  windowDays = 30,
  today = new Date(),
): { day: string; cost: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.cost]));
  return dayWindow(windowDays, today).map((day) => ({ day, cost: byDay.get(day) ?? 0 }));
}

// One row per day with a zero-filled column per level: the shape a
// multi-line chart consumes (day for the x-axis, one line per level).
export function buildDayMatrix(
  rows: LevelDaySpend[],
  levels: string[],
  days: string[],
): Record<string, string | number>[] {
  const byLevel = new Map<string, Map<string, number>>();
  for (const l of levels) byLevel.set(l, new Map());
  for (const r of rows) {
    const series = byLevel.get(r.level);
    if (!series) continue;
    series.set(r.day, (series.get(r.day) ?? 0) + r.cost);
  }
  return days.map((day) => {
    const row: Record<string, string | number> = { day };
    for (const l of levels) row[l] = byLevel.get(l)?.get(day) ?? 0;
    return row;
  });
}

// Day-grain book spend for one level filter ('ALL' aggregates every level).
export function filterDaySpend(rows: LevelDaySpend[], level: string): { day: string; cost: number }[] {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (level !== 'ALL' && r.level !== level) continue;
    totals.set(r.day, (totals.get(r.day) ?? 0) + r.cost);
  }
  return [...totals.entries()]
    .map(([day, cost]) => ({ day, cost }))
    .sort((a, b) => (a.day < b.day ? -1 : 1));
}
