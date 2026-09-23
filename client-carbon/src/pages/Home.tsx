import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';

export function Home() {
  return (
    <>
      <PageHeader title="Home" />
      <EmptyState title="Home" description="Placeholder screen, not implemented yet." />
    </>
  );
}
