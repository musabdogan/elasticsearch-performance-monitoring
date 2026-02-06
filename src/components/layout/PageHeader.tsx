import { ThemeToggle } from '@/components/theme/ThemeToggle';
import { useMonitoring } from '@/context/MonitoringProvider';
import { ClusterSelector } from '@/components/layout/ClusterSelector';

const POLL_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
  { label: '60s', value: 60000 }
];

export function PageHeader() {
  const {
    pollInterval,
    setPollInterval,
    lastUpdated
  } = useMonitoring();

  return (
    <header className="flex-shrink-0 border-b border-gray-200 bg-white px-3 py-2 shadow-sm transition-colors duration-300 dark:border-gray-700 dark:bg-gray-800">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex items-center gap-2 flex-shrink-0">
          <img 
            src="/searchali_logo.png" 
            alt="Searchali" 
            className="h-6 w-auto"
          />
          <span className="text-xs font-semibold text-red-600 dark:text-red-400">
            searchali.com
          </span>
        </div>
        <div className="flex items-center justify-center min-w-0 px-2">
          <h1
            className="font-semibold text-gray-900 dark:text-gray-100 text-center whitespace-nowrap"
            style={{ fontSize: 'clamp(0.625rem, 1.5vw + 0.5rem, 0.875rem)' }}
          >
            Elasticsearch Performance Monitoring
          </h1>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 justify-end pr-6">
          <div className="pr-4">
            <ClusterSelector />
          </div>
          <label className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
            <span className="hidden sm:inline">Interval:</span>
            <select
              className="rounded-lg border border-gray-300 bg-white px-1.5 py-1 text-xs text-gray-900 shadow-sm transition-colors duration-200 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:focus:ring-offset-gray-900"
              value={pollInterval}
              onChange={(event) => setPollInterval(Number(event.target.value))}
            >
              {POLL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <ThemeToggle />
          {lastUpdated && (
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {new Date(lastUpdated).toLocaleTimeString('en-US')}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

