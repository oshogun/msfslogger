import type { ReactNode } from 'react';
import { Tile } from '@carbon/react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <Tile style={{ textAlign: 'center', padding: '3rem 1rem' }}>
      <p style={{ fontSize: '1.25rem' }}>{title}</p>
      {description && (
        <p style={{ color: 'var(--cds-text-secondary)', marginTop: '0.5rem' }}>{description}</p>
      )}
      {action && <div style={{ marginTop: '1rem' }}>{action}</div>}
    </Tile>
  );
}
