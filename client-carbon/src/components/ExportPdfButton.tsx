import { useState } from 'react';
import { Button, InlineNotification, Tooltip } from '@carbon/react';

const PRINT_NOTE = 'Print output is not part of the prototype';

/**
 * Export PDF is present but inert in the prototype: the button is
 * aria-disabled (so it stays focusable and its tooltip reachable) and a click
 * opens an inline notification explaining why. Render `button` in the action
 * row and `note` wherever the message should appear.
 */
export function useExportPdf(kind: 'ghost' | 'tertiary' = 'ghost') {
  const [noteOpen, setNoteOpen] = useState(false);
  const button = (
    <Tooltip description={PRINT_NOTE} align="top">
      <Button kind={kind} aria-disabled="true" onClick={() => setNoteOpen(true)}>Export PDF</Button>
    </Tooltip>
  );
  const note = noteOpen ? (
    <InlineNotification
      kind="info"
      title="Export PDF"
      subtitle={`${PRINT_NOTE}.`}
      onCloseButtonClick={() => setNoteOpen(false)}
      lowContrast
    />
  ) : null;
  return { button, note };
}
