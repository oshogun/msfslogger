import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Override() {
  return (
    <>
      <PageHeader title="Override" />
      <EmptyState title="Override" description="Placeholder screen, not implemented yet." />
    </>
  );
}
