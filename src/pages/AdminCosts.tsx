import { useEffect, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { getCostsOverview } from '../lib/api';
import type { CostsLevelDay } from '../lib/api';
import { buildDayMatrix, dayWindow } from '../lib/costs';
import { Alert, Button } from '../components/ui';

// One line per CEFR level: the graph answers "what does all of A1 cost"
// instead of pricing single comics. Lazy-loaded by the Dashboard so the
// chart library never ships to students.
const LEVEL_COLORS = ['#134e4a', '#b45309', '#1e40af', '#0f766e', '#9a3412', '#475569'];

export default function CostsSection() {
  const [levelRows, setLevelRows] = useState<CostsLevelDay[]>([]);
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCostsOverview()
      .then((res) => {
        setLevelRows(res.by_level_day ?? []);
      })
      .catch(() => setError('Could not load costs.'));
  }, []);

  const levels = [...new Set(levelRows.map((r) => r.level))].sort();
  const days = dayWindow(30);
  const candidates = levelFilter === 'ALL' ? levels : levels.filter((l) => l === levelFilter);
  const shown = candidates.filter((l) => levelRows.some((r) => r.level === l && r.cost > 0));
  const data = buildDayMatrix(levelRows, shown, days);
  const totals = new Map(shown.map((l) => [l, levelRows.filter((r) => r.level === l).reduce((a, r) => a + r.cost, 0)]));
  const total = [...totals.values()].reduce((a, t) => a + t, 0);
  const colorOf = (level: string) => LEVEL_COLORS[levels.indexOf(level) % LEVEL_COLORS.length] ?? LEVEL_COLORS[0];

  return (
    <>
      {error && <Alert>{error}</Alert>}
      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Cost level filter">
        {['ALL', ...levels].map((l) => (
          <Button key={l} variant={levelFilter === l ? 'primary' : 'secondary'} onClick={() => setLevelFilter(l)}>
            {l}
          </Button>
        ))}
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-stone-600">No book-attributable spend in the last 30 days.</p>
      ) : (
        <div
          role="img"
          aria-label={`Book AI spend by level, last 30 days: ${shown
            .map((l) => `${l} $${(totals.get(l) ?? 0).toFixed(4)}`)
            .join(', ')}`}
        >
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data} margin={{ top: 16, right: 24, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#e7e5e4" strokeDasharray="3 3" />
              <XAxis
                dataKey="day"
                tickFormatter={(d: string) => d.slice(5)}
                minTickGap={28}
                tick={{ fontSize: 12, fill: '#57534e' }}
                tickMargin={8}
              />
              <YAxis
                tickFormatter={(v: number) => `$${Number(v).toFixed(2)}`}
                width={64}
                tick={{ fontSize: 12, fill: '#57534e' }}
              />
              <Tooltip
                formatter={(value) => `$${Number(value).toFixed(4)}`}
                labelFormatter={(day) => `Day ${String(day)}`}
                contentStyle={{ fontSize: 14 }}
              />
              <Legend wrapperStyle={{ fontSize: 14 }} />
              {shown.map((l) => (
                <Line
                  key={l}
                  type="monotone"
                  dataKey={l}
                  name={l}
                  stroke={colorOf(l)}
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <p className="mt-1 text-sm text-stone-600">
        Total{levelFilter === 'ALL' ? '' : ` ${levelFilter}`} book spend, last 30 days: <strong>${total.toFixed(2)}</strong>
      </p>
    </>
  );
}
