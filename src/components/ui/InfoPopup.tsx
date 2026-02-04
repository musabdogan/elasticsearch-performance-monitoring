import { useEffect } from 'react';
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
}

/**
 * Info button that opens a popup with API and calculation details.
 */
export function InfoPopup({ title, modalTitle, children, open, onClose, onOpen }: InfoPopupProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [open, onClose]);

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1.5 rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
        title={`Info: ${title}`}
        aria-label={`Info about ${title}`}
      >
        <Info className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="info-popup-title"
        >
          <div
            className="absolute inset-0 bg-black/50 dark:bg-black/60"
            onClick={onClose}
            aria-hidden="true"
          />
          <div className="relative max-h-[85vh] w-full max-w-md overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-600 dark:bg-gray-800">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-600">
              <h2 id="info-popup-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
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
        </div>
      )}
    </>
  );
}
