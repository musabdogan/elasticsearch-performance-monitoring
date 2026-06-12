import { memo, useEffect, useRef, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import type { AlertInstance } from '../../types/alerts';
import { ALERT_COLORS, ALERT_DETAIL_CONFIG } from '../../config/alerts';
import { formatAlertOpenedAt, formatAlertDuration } from '../../utils/format';

interface AlertDetailModalProps {
  alert: AlertInstance | null;
  onClose: () => void;
}

function CodeBlockWithCopy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onCopy}
        title={copied ? 'Copied!' : 'Copy'}
        aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        className="absolute right-2 top-2 rounded p-1.5 text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre className="font-mono text-xs bg-gray-100 dark:bg-gray-700 p-3 pr-10 rounded-lg overflow-x-auto">
        <code>{text}</code>
      </pre>
    </div>
  );
}

const AlertDetailModal = memo<AlertDetailModalProps>(({ alert, onClose }) => {
  const backdropMouseDownRef = useRef(false);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!alert) return null;

  const colors = ALERT_COLORS[alert.severity];
  const config = ALERT_DETAIL_CONFIG[alert.ruleId];
  const openedAt = alert.firstTriggeredAt || alert.triggeredAt;
  const closedAt = alert.resolvedAt;
  const duration = formatAlertDuration(openedAt, closedAt);
  const hasAffectedIndices = alert.affectedResources && alert.affectedResources.length > 0;
  const whatWasDetected = config?.whatWasDetected ?? alert.description;
  const whatWasDetectedWithIndices =
    hasAffectedIndices
      ? `${whatWasDetected} Affected index(es) are listed below.`
      : whatWasDetected;

  const indices = alert.affectedResources ?? [];

  /** Expands a recommendation that contains index placeholders: intro + one example command using the first affected index. */
  function expandRecommendation(rec: string): string[] {
    if (!indices.length) return [rec];
    const hasPlaceholder = /<index>|<index-name>|\{index\}/i.test(rec);
    if (!hasPlaceholder) return [rec];
    const commandMatch = rec.match(/\b(GET|POST|PUT|DELETE)\s+([\s\S]*)/);
    if (!commandMatch) return [rec];
    const intro = rec.slice(0, rec.indexOf(commandMatch[0])).replace(/\s*:\s*$/, ':').trim();
    const commandTemplate = rec.slice(rec.indexOf(commandMatch[0]));
    const expanded: string[] = [];
    if (intro) expanded.push(intro);
    const exampleCmd = commandTemplate.replace(/<index>|<index-name>|\{index\}/gi, indices[0]);
    expanded.push(exampleCmd);
    return expanded;
  }

  const baseRecommendations = config?.recommendations ?? [];
  const recommendations = baseRecommendations.flatMap((rec) => expandRecommendation(rec));

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onMouseDown={(e) => {
        backdropMouseDownRef.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && backdropMouseDownRef.current) onClose();
        backdropMouseDownRef.current = false;
      }}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col border-l-4 ${colors.border}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className={`font-semibold text-lg ${colors.text}`}>{alert.ruleName}</h3>
              {alert.status === 'resolved' ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-800 dark:bg-green-900/30 dark:text-green-300">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  Solved
                </span>
              ) : (
                <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium text-white ${colors.badge}`}>
                  Active
                </span>
              )}
            </div>
            {alert.clusterName && (
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Cluster: {alert.clusterName}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title="Close"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Event duration */}
          <section>
            <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-2">Event duration</h4>
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-300">
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 dark:text-gray-400">Opened at:</span>
                <span>{formatAlertOpenedAt(openedAt)}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 dark:text-gray-400">Closed at:</span>
                <span>{closedAt ? formatAlertOpenedAt(closedAt) : '—'}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-500 dark:text-gray-400">Duration:</span>
                <span>
                  {duration}
                  {!closedAt && ' (since opened)'}
                </span>
              </div>
            </div>
          </section>

          {/* What was detected */}
          <section>
            <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-2">What was detected</h4>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{whatWasDetectedWithIndices}</p>
          </section>

          {/* Affected resources */}
          {alert.affectedResources && alert.affectedResources.length > 0 && (
            <section>
              <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-2">Affected indices</h4>
              <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1 max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 font-mono list-disc list-inside break-all">
                {alert.affectedResources.map((name) => (
                  <li key={name}>
                    {name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Recommendations */}
          {recommendations.length > 0 && (
            <section>
              <h4 className="font-medium text-sm text-gray-900 dark:text-gray-100 mb-2">Recommendations</h4>
              <ul className="text-sm text-gray-600 dark:text-gray-300 space-y-1.5 list-disc list-inside">
                {recommendations.map((rec, i) => {
                  const isCopyableCommand = /^(GET|POST|PUT|DELETE)\s+/i.test(rec.trim()) || /\r?\n/.test(rec);
                  return (
                    <li key={i} className={isCopyableCommand ? 'list-none -ml-4 mt-2' : 'leading-relaxed'}>
                      {isCopyableCommand ? (
                        <CodeBlockWithCopy text={rec} />
                      ) : (
                        rec
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
});

AlertDetailModal.displayName = 'AlertDetailModal';

export default AlertDetailModal;
