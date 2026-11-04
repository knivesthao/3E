import { describe, expect, it } from 'vitest';
import { buildDayMatrix, dailySpend, dayWindow, fillDayRange, filterDaySpend, monthlySpend } from './costs';

describe('monthlySpend', () => {
  it('aggregates attempt costs by month, oldest first', () => {
    const rows = monthlySpend([
      { created_at: '2026-11-02T10:00:00Z', cost_usd: 0.02 },
      { created_at: '2026-10-15T10:00:00Z', cost_usd: 0.01 },
      { created_at: '2026-11-20T10:00:00Z', cost_usd: 0.03 },
      { created_at: '2026-10-20T10:00:00Z', cost_usd: null },
    ]);
    expect(rows).toEqual([
      { month: '2026-10', cost: 0.01 },
      { month: '2026-11', cost: 0.05 },
    ]);
  });

  it('returns an empty list when there are no attempts', () => {
    expect(monthlySpend([])).toEqual([]);
  });
});

describe('dailySpend', () => {
  it('aggregates attempt costs by day, oldest first', () => {
    const rows = dailySpend([
      { created_at: '2026-11-04T10:00:00Z', cost_usd: 0.02 },
      { created_at: '2026-11-03T10:00:00Z', cost_usd: 0.01 },
      { created_at: '2026-11-04T15:00:00Z', cost_usd: 0.03 },
      { created_at: '2026-11-03T20:00:00Z', cost_usd: null },
    ]);
    expect(rows).toEqual([
      { day: '2026-11-03', cost: 0.01 },
      { day: '2026-11-04', cost: 0.05 },
    ]);
  });
});

describe('fillDayRange', () => {
  it('zero-fills a trailing window ending today', () => {
    const rows = fillDayRange([{ day: '2026-11-04', cost: 0.02 }], 3, new Date('2026-11-04T12:00:00Z'));
    expect(rows).toEqual([
      { day: '2026-11-02', cost: 0 },
      { day: '2026-11-03', cost: 0 },
      { day: '2026-11-04', cost: 0.02 },
    ]);
  });
});

describe('dayWindow and buildDayMatrix', () => {
  it('labels a trailing window and pivots levels into zero-filled columns', () => {
    const days = dayWindow(3, new Date('2026-11-04T12:00:00Z'));
    expect(days).toEqual(['2026-11-02', '2026-11-03', '2026-11-04']);
    const matrix = buildDayMatrix(
      [
        { level: 'A1', day: '2026-11-04', cost: 0.02 },
        { level: 'B2', day: '2026-11-04', cost: 0.05 },
        { level: 'C1', day: '2026-11-04', cost: 0.09 },
      ],
      ['A1', 'B2'],
      days,
    );
    expect(matrix).toEqual([
      { day: '2026-11-02', A1: 0, B2: 0 },
      { day: '2026-11-03', A1: 0, B2: 0 },
      { day: '2026-11-04', A1: 0.02, B2: 0.05 },
    ]);
  });
});

describe('filterDaySpend', () => {
  const rows = [
    { level: 'A1', day: '2026-11-04', cost: 0.02 },
    { level: 'B2', day: '2026-11-04', cost: 0.05 },
    { level: 'A1', day: '2026-11-03', cost: 0.01 },
  ];
  it('keeps one level in day order', () => {
    expect(filterDaySpend(rows, 'A1')).toEqual([
      { day: '2026-11-03', cost: 0.01 },
      { day: '2026-11-04', cost: 0.02 },
    ]);
  });
  it('sums every level per day for ALL', () => {
    expect(filterDaySpend(rows, 'ALL')).toEqual([
      { day: '2026-11-03', cost: 0.01 },
      { day: '2026-11-04', cost: 0.07 },
    ]);
  });
});
