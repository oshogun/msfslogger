import { Tag } from '@carbon/react';

type TagColor = 'green' | 'blue' | 'magenta' | 'gray' | 'red' | 'purple' | 'teal' | 'cyan' | 'warm-gray' | 'cool-gray' | 'outline';

/** One colour per meaning, so a status reads the same on every screen. */
const KINDS = {
  planned: 'cool-gray',
  flown: 'green',
  diverted: 'red',
  skipped: 'gray',
  snippet: 'cool-gray',
  'active-trip': 'purple',
  error: 'red',
  'acars-pdc': 'blue',
  'acars-wx': 'teal',
  'acars-freetext': 'gray',
  'acars-position-report': 'cyan',
  'acars-dispatch': 'purple',
  'acars-oooi': 'green',
  'acars-unknown': 'cool-gray',
} as const satisfies Record<string, TagColor>;

export type StatusKind = keyof typeof KINDS;

export interface StatusTagProps {
  kind: StatusKind;
  /** Defaults to the kind, capitalised. */
  children?: string;
}

export function StatusTag({ kind, children }: StatusTagProps) {
  const text = children ?? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/-/g, ' ');
  return <Tag type={KINDS[kind]} size="md">{text}</Tag>;
}
