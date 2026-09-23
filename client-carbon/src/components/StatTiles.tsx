import { Column, Grid, Tile } from '@carbon/react';

export interface StatTile {
  label: string;
  value: string | number;
}

export function StatTiles({ tiles }: { tiles: StatTile[] }) {
  return (
    <Grid condensed narrow style={{ padding: 0, marginInline: 0 }}>
      {tiles.map(t => (
        <Column key={t.label} sm={2} md={2} lg={4}>
          <Tile>
            <div style={{ color: 'var(--cds-text-secondary)', fontSize: '0.875rem' }}>{t.label}</div>
            <div style={{ fontSize: '2rem', lineHeight: 1.25, fontWeight: 400 }}>{t.value}</div>
          </Tile>
        </Column>
      ))}
    </Grid>
  );
}
