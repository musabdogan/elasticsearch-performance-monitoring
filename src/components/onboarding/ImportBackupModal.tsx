import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Upload, X } from 'lucide-react';
import { useMonitoring } from '@/context/MonitoringProvider';
import {
  downloadEpmBackup,
  parseBackupText,
  type BackupSource
} from '@/utils/clusterBackup';

const ELASTICVUE_EXPORT_STEPS = [
  'Open Elasticvue (desktop app, browser extension, or web UI).',
  'Click the Settings icon (gear) in the top navigation bar.',
  'Scroll to the section titled "Import/Export elasticvue data".',
  'Under Export, click the blue "DOWNLOAD BACKUP" button.',
  'Save the JSON file to your computer (for example elasticvue_1.15.0_backup.json).',
  'Return here, choose Elasticvue as the source, and upload that file.'
];

const EPM_EXPORT_STEPS = [
  'On the home page, click "Import/Export".',
  'Select Elasticsearch Performance Monitoring as the source.',
  'Click "Export" below to download your saved cluster connections as JSON.',
  'Keep this file safe — it contains cluster URLs and credentials stored in your browser.',
  'To restore on this or another device, upload the file here with Elasticsearch Performance Monitoring selected as the source.'
];

type ImportBackupModalProps = {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
};

export function ImportBackupModal({ open, onClose, onImported }: ImportBackupModalProps) {
  const { clusters, importClusters } = useMonitoring();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<BackupSource>('elasticvue');
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [parsedClusters, setParsedClusters] = useState<ReturnType<typeof parseBackupText>['clusters']>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const resetFileState = () => {
    setFileName(null);
    setPreviewCount(null);
    setParsedClusters([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    resetFileState();
    onClose();
  };

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setFileName(file.name);
      setError(null);
      setPreviewCount(null);
      setParsedClusters([]);

      try {
        const text = await file.text();
        const result = parseBackupText(text, source);
        if (result.error) {
          setError(result.error);
          return;
        }
        if (result.source && result.source !== source) {
          setSource(result.source);
        }
        setParsedClusters(result.clusters);
        setPreviewCount(result.clusters.length);
      } catch {
        setError('Could not read the file. Ensure it is valid JSON or NDJSON.');
      }
    },
    [source]
  );

  const handleImport = async () => {
    if (parsedClusters.length === 0) return;
    setImporting(true);
    try {
      const count = importClusters(
        parsedClusters.map((c) => ({
          label: c.label,
          baseUrl: c.baseUrl,
          authType: c.authType,
          username: c.username,
          password: c.password,
          apiKey: c.apiKey,
          cluster_name: c.cluster_name,
          cluster_uuid: c.cluster_uuid,
          category: c.category
        }))
      );
      if (count > 0) {
        onImported?.();
        handleClose();
      }
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  const steps = source === 'elasticvue' ? ELASTICVUE_EXPORT_STEPS : EPM_EXPORT_STEPS;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
        role="dialog"
        aria-labelledby="import-backup-title"
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
          <h2 id="import-backup-title" className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Import/Export
          </h2>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div>
            <p className="mb-2 text-xs font-medium text-gray-700 dark:text-gray-300">Source</p>
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
              {(
                [
                  { id: 'elasticvue' as const, label: 'Elasticvue' },
                  { id: 'epm' as const, label: 'Elasticsearch Performance Monitoring' }
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => {
                    setSource(opt.id);
                    resetFileState();
                  }}
                  className={`flex-1 px-2 py-2 text-xs font-medium transition-colors ${
                    source === opt.id
                      ? 'bg-blue-600 text-white dark:bg-blue-500'
                      : 'bg-white text-gray-700 hover:bg-gray-50 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-gray-800 dark:text-gray-200">
              {source === 'elasticvue' ? 'How to export from Elasticvue' : 'How to export from this app'}
            </p>
            <ol className="list-decimal list-inside space-y-1 text-xs text-gray-600 dark:text-gray-400">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>

          {source === 'epm' && clusters.length > 0 && (
            <button
              type="button"
              onClick={() => downloadEpmBackup(clusters)}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <Download className="h-3.5 w-3.5" />
              Export ({clusters.length} cluster{clusters.length !== 1 ? 's' : ''})
            </button>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
              Import file
            </label>
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-xs text-gray-600 hover:border-blue-400 hover:bg-blue-50/50 dark:border-gray-600 dark:bg-gray-900/30 dark:text-gray-400 dark:hover:border-blue-500">
              <Upload className="h-4 w-4 shrink-0" />
              <span>{fileName ? fileName : 'Choose JSON backup file'}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                className="sr-only"
                onChange={handleFileChange}
              />
            </label>
            {previewCount != null && previewCount > 0 && (
              <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">
                Found {previewCount} cluster connection{previewCount !== 1 ? 's' : ''} ready to import.
              </p>
            )}
            {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-4 py-3 dark:border-gray-700">
          <button
            type="button"
            onClick={handleClose}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing || parsedClusters.length === 0}
            className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {importing ? 'Importing…' : `Import${previewCount ? ` (${previewCount})` : ''}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
