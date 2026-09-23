import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Modal } from '@carbon/react';

/**
 * Carbon's Modal renders where it is declared, inside the page content, so Tab
 * leaving its focus sentinels walks through <body> and the shell's own controls
 * before wrapping back. Mounting it under <body> keeps the trap self-contained.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}

/**
 * Carbon's Modal returns focus on close only to a launcher it is handed by ref,
 * and the launchers here are ordinary buttons elsewhere in the page. This
 * remembers the element focused when `open` turned true and returns the ref to
 * pass as the Modal's `launcherButtonRef`.
 */
export function useLauncherRef(open: boolean) {
  const launcher = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) launcher.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;
  return launcher;
}

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  /** Renders the confirm button as a danger action. */
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open, title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel,
}: ConfirmModalProps) {
  const launcherRef = useLauncherRef(open);
  return (
    <ModalPortal>
    <Modal
      open={open}
      launcherButtonRef={launcherRef}
      size="xs"
      selectorPrimaryFocus=".cds--modal-footer .cds--btn--primary"
      danger={danger}
      modalHeading={title}
      primaryButtonText={confirmLabel}
      secondaryButtonText="Cancel"
      onRequestSubmit={onConfirm}
      onRequestClose={onCancel}
    >
      <p>{message}</p>
    </Modal>
    </ModalPortal>
  );
}
