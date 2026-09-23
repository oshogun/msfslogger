import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function AllFlights() {
  return (
    <>
      <PageHeader title="All flights" />
      <EmptyState title="All flights" description="Placeholder screen, not implemented yet." />
    </>
  );
}
