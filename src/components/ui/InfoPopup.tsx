import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Info } from 'lucide-react';

interface InfoPopupProps {
  /** Section title shown next to the info icon */
  title: string;
  /** Modal title */
  modalTitle: string;
  /** Body content (short, clean explanation) */
  children: React.ReactNode;
  open: boolean;
  onClose: () => void;
  onOpen: () => void;
  /** Optional: override button styling (e.g. light icon on dark cards) */
  buttonClassName?: string;
  /** When "right", popup opens to the right of the button (outside parent). Default: centered modal. */
  placement?: 'center' | 'right';
}

/**
 * Info button that opens a popup with API and calculation details.
 */
export function InfoPopup({ title, modalTitle, children, open, onClose, onOpen, buttonClassName, placement = 'center' }: InfoPopupProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popoverStyle, setPopoverStyle] = useState<{ top: number; left: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  useEffect(() => {
    if (open && placement === 'right' && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const padding = 8;
      const popoverMaxHeight = Math.min(window.innerHeight * 0.9, 680);
      const minTop = 16;
      const maxTop = window.innerHeight - popoverMaxHeight - 16;
      const top = Math.max(minTop, Math.min(rect.top, maxTop));
      setPopoverStyle({
        top,
        left: rect.right + padding
      });
    } else {
      setPopoverStyle(null);
    }
  }, [open, placement]);

  const popoverContent = open && (
    placement === 'right' && popoverStyle ? (
      createPortal(
        <div className="fixed inset-0 z-[9998] pointer-events-none" aria-hidden="true" data-info-popup>
          <div
            className="absolute inset-0 pointer-events-auto"
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            className="absolute w-[min(420px,calc(100vw-2rem))] max-h-[min(90vh,680px)] flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800 pointer-events-auto"
            style={{ top: popoverStyle.top, left: popoverStyle.left, zIndex: 9999 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <div className="flex-shrink-0 flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
              <h2 id={titleId} className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {modalTitle}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 py-3 pb-6 text-xs text-gray-700 dark:text-gray-300">
              {children}
            </div>
          </div>
        </div>,
        document.body
      )
    ) : placement === 'center' ? (
      createPortal(
        <div
          className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div
            className="absolute inset-0 bg-black/50 dark:bg-black/60"
            onClick={onClose}
            aria-hidden="true"
          />
          <div
            className="relative z-[9999] max-h-[85vh] w-full max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
              <h2 id={titleId} className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {modalTitle}
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="max-h-[calc(85vh-8rem)] overflow-y-auto px-4 py-3 text-xs text-gray-700 dark:text-gray-300">
              {children}
            </div>
          </div>
        </div>,
        document.body
      )
    ) : null
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpen}
        className={buttonClassName ?? 'inline-flex items-center gap-1.5 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200'}
        title={`Info: ${title}`}
        aria-label={`Info about ${title}`}
      >
        <Info className="h-4 w-4" />
      </button>

      {popoverContent}
    </>
  );
}
