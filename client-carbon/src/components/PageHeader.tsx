import type { ReactNode } from 'react';
import { Breadcrumb, BreadcrumbItem, Heading, Section } from '@carbon/react';

export interface PageHeaderProps {
  title: string;
  subtitle?: string;
  /** Optional trail; the last entry is the current page. */
  breadcrumbs?: { label: string; href?: string }[];
  /** Right-aligned controls. */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, breadcrumbs, actions }: PageHeaderProps) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      {breadcrumbs && (
        <Breadcrumb noTrailingSlash>
          {breadcrumbs.map((b, i) => (
            <BreadcrumbItem key={b.label} href={b.href} isCurrentPage={i === breadcrumbs.length - 1}>
              {b.label}
            </BreadcrumbItem>
          ))}
        </Breadcrumb>
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <Section>
          <Heading>{title}</Heading>
        </Section>
        {actions && <div style={{ display: 'flex', gap: '0.5rem' }}>{actions}</div>}
      </div>
      {subtitle && (
        <p style={{ color: 'var(--cds-text-secondary)', marginTop: '0.25rem' }}>{subtitle}</p>
      )}
    </div>
  );
}
