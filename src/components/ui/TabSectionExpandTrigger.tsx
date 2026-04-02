import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Expandable tab section title (pairs with `tab-section-card` / `tab-section-header` in `index.css`).
 * Chevron + label share a wide hit target; `suffix` (InfoPopup, badges) stays beside the title.
 * Same row as title + search: parent `.tab-section-header.tab-section-header-split`, tools in `.tab-section-inline-tools`, and set `fillHitArea={false}` (no full-width spacer).
 */
export type TabSectionExpandTriggerProps = {
  expanded: boolean;
  onToggle: () => void;
  label: ReactNode;
  /** Info icon, loading text — not inside the toggle button */
  suffix?: ReactNode;
  /** When true (default), the toggle grows with flex-1 for a full-row hit area */
  fillHitArea?: boolean;
  /**
   * When true (default), the wrapper can grow (`flex-1`) so the clickable spacer
   * reaches the next sibling controls (e.g. Search input in split headers).
   */
  grow?: boolean;
  ariaControls?: string;
  buttonClassName?: string;
};

const BTN_FULL =
  // Important: do NOT use flex-1 on the button.
  // If the button grows, the suffix (Info / All Clear) gets pushed to the far right.
  // We keep the button shrink-to-content and provide the wide hit area via a spacer.
  'flex min-h-9 min-w-0 items-center gap-1 rounded px-1 py-1 text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset';
const BTN_COMPACT =
  'flex items-center gap-1 rounded p-0.5 -m-0.5 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700/50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-inset';

export function TabSectionExpandTrigger({
  expanded,
  onToggle,
  label,
  suffix,
  fillHitArea = true,
  grow = true,
  ariaControls,
  buttonClassName
}: TabSectionExpandTriggerProps) {
  const wrapClass = fillHitArea
    ? `flex min-w-0 w-full items-center gap-2${grow ? ' flex-1' : ''}`
    : 'flex min-w-0 items-center gap-2';
  const btnClass = `${fillHitArea ? BTN_FULL : BTN_COMPACT}${buttonClassName ? ` ${buttonClassName}` : ''}`;

  return (
    <div className={wrapClass}>
      <button
        type="button"
        className={btnClass}
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={ariaControls}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden />
        )}
        {typeof label === 'string' ? (
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</span>
        ) : (
          label
        )}
      </button>
      {suffix != null ? <div className="flex shrink-0 flex-wrap items-center gap-2">{suffix}</div> : null}
      {fillHitArea ? (
        // Clickable empty space on the right side.
        // This keeps `suffix` visually next to the title while still allowing full-row toggling.
        <div className="flex-1 min-h-9 self-stretch cursor-pointer" onClick={onToggle} aria-hidden />
      ) : null}
    </div>
  );
}
