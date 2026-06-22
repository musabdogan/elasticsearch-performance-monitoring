import { useEffect } from 'react';

/**
 * Close a nested overlay on Escape without closing parent modals/dialogs.
 *
 * Parent shells (e.g. IndexDetailModal) listen on `window` in the bubble phase.
 * Nested overlays must register this hook so Escape is handled in the capture
 * phase and `stopImmediatePropagation()` prevents the parent from closing too.
 *
 * See `.cursor/rules/modal-escape-stack.mdc`.
 */
export function useNestedEscapeClose(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onClose();
    };

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [active, onClose]);
}
