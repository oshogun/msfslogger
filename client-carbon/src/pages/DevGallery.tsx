import { useState } from 'react';
import { Button } from '@carbon/react';
import { ConfirmModal } from '../components/ConfirmModal';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatTiles } from '../components/StatTiles';
import { StatusTag } from '../components/StatusTag';
import type { StatusKind } from '../components/StatusTag';
import { LegsGallerySection } from '../components/legs/LegsGallerySection';
import { MapsGallerySection, NavdataGallerySection } from '../components/maps';
import { ChartsReplayGallerySection } from '../components/replay';

const KINDS: StatusKind[] = ['planned', 'flown', 'diverted', 'skipped', 'snippet', 'active-trip', 'error',
  'acars-pdc', 'acars-wx', 'acars-freetext', 'acars-position-report', 'acars-dispatch', 'acars-oooi', 'acars-unknown',
];

export function DevGallery() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Component gallery"
        subtitle="Every shared primitive with mock props."
        breadcrumbs={[{ label: 'Home', href: '/' }, { label: 'Gallery' }]}
        actions={<Button kind="danger" onClick={() => setOpen(true)}>Open confirm modal</Button>}
      />
      <h2 className="sabia-heading-03">StatTiles</h2>
      <StatTiles tiles={[
        { label: 'Flights', value: 42 },
        { label: 'Hours', value: '118.4' },
        { label: 'Distance', value: '31,204 nm' },
        { label: 'Airports', value: 17 },
      ]} />
      <h2 className="sabia-heading-03" style={{ marginTop: '2rem' }}>StatusTag</h2>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {KINDS.map(k => <StatusTag key={k} kind={k} />)}
      </div>
      <h2 className="sabia-heading-03" style={{ marginTop: '2rem' }}>EmptyState</h2>
      <EmptyState title="No flights yet" description="Fly something and it will show up here." />
      <LegsGallerySection />
      <MapsGallerySection />
      <NavdataGallerySection />
      <ChartsReplayGallerySection />
      <ConfirmModal
        open={open}
        danger
        title="Delete flight"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => setOpen(false)}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
