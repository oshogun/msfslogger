import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function FlightDetail() {
  return (
    <>
      <PageHeader title="Flight detail" />
      <EmptyState title="Flight detail" description="Placeholder screen, not implemented yet." />
    </>
  );
}
