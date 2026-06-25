import clsx from 'clsx';
import { TASK_NAME_LIST_VISIBLE } from '@/utils/searchDiagnosis';

type TruncatedNameListProps = {
  names: string[];
  visibleCount?: number;
  className?: string;
  onNameClick?: (name: string) => void;
};

export function TruncatedNameList({
  names,
  visibleCount = TASK_NAME_LIST_VISIBLE,
  className,
  onNameClick
}: TruncatedNameListProps) {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) {
    return <span className="text-xs text-gray-400">—</span>;
  }

  const visible = unique.slice(0, visibleCount);
  const hidden = unique.length - visible.length;
  const fullTitle = unique.join(', ');

  return (
    <span
      className={clsx('block max-w-[140px]', className)}
      title={hidden > 0 ? fullTitle : visible.length === 1 ? visible[0] : fullTitle}
    >
      <span className="block truncate">
        {visible.map((name, i) => (
          <span key={name}>
            {i > 0 && ', '}
            {onNameClick ? (
              <button
                type="button"
                className="entity-name-link text-left font-mono text-xs"
                onClick={() => onNameClick(name)}
              >
                {name}
              </button>
            ) : (
              <span className="font-mono text-xs text-gray-800 dark:text-gray-200">{name}</span>
            )}
          </span>
        ))}
      </span>
      {hidden > 0 && (
        <button
          type="button"
          className="entity-name-link focus:outline-none focus:underline text-left mt-0.5 text-xs text-gray-500 dark:text-gray-400"
          title={fullTitle}
        >
          +{hidden} more
        </button>
      )}
    </span>
  );
}
