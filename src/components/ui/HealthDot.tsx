import { healthToDotClass, formatHealthLabel } from '@/utils/healthStatus';

type HealthDotProps = {
  health?: string;
  size?: 'sm' | 'md';
  className?: string;
};

/** Elasticsearch index/cluster health indicator (green / yellow / red). */
export function HealthDot({ health, size = 'sm', className = '' }: HealthDotProps) {
  const label = formatHealthLabel(health);
  const sizeClass = size === 'md' ? 'h-2.5 w-2.5' : 'h-2 w-2';

  return (
    <span
      role="img"
      aria-label={`Health: ${label}`}
      title={`Health: ${label}`}
      className={`inline-block shrink-0 rounded-full ${sizeClass} ${healthToDotClass(health)} ${className}`}
    />
  );
}
