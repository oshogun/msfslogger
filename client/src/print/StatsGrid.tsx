interface StatItem {
  label: string;
  value: string | number;
  unit?: string;
  sub?: string;
}

interface Props {
  stats: StatItem[];
}

export function StatsGrid({ stats }: Props) {
  return (
    <div className="stats-grid">
      {stats.map(s => (
        <div key={s.label} className="stat-card">
          <div className="stat-label">{s.label}</div>
          <div className="stat-value">
            {s.value}
            {s.unit && <span className="stat-unit">{s.unit}</span>}
          </div>
          {s.sub && <div className="stat-sub">{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}
