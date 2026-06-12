import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { CodeBlockWithCopy } from '@/components/ui/CodeBlockWithCopy';
import type { SortRule } from '@/utils/querySearch';

type QueryAdvancedEditorProps = {
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  disabled?: boolean;
};

export function QueryAdvancedEditor({ value, onChange, error, disabled }: QueryAdvancedEditorProps) {
  return (
    <div className="space-y-1">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        rows={10}
        placeholder={`{\n  "query": { "match_all": {} }\n}`}
        className={`min-h-[160px] w-full resize-y rounded border bg-white px-3 py-2 font-mono text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:bg-gray-800 dark:text-gray-100 dark:placeholder:text-gray-500 ${
          error
            ? 'border-red-400 dark:border-red-500'
            : 'border-gray-300 dark:border-gray-600'
        }`}
        aria-label="Advanced search JSON body"
      />
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      <p className="text-[10px] text-gray-500 dark:text-gray-400">
        Full <code className="font-mono">POST /{'{index}'}/_search</code> body. Size, from, sort, and track_total_hits are merged on run.
      </p>
    </div>
  );
}

type SortBarProps = {
  sort: SortRule[];
  sortFields: string[];
  onChange: (sort: SortRule[]) => void;
};

export function QuerySortBar({ sort, sortFields, onChange }: SortBarProps) {
  const [open, setOpen] = useState(sort.length > 0);

  const addRule = () => {
    onChange([...sort, { field: sortFields[0] ?? '_score', order: 'desc' }]);
    setOpen(true);
  };

  const updateRule = (index: number, patch: Partial<SortRule>) => {
    onChange(sort.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const removeRule = (index: number) => {
    onChange(sort.filter((_, i) => i !== index));
  };

  return (
    <div className="rounded border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Sort {sort.length > 0 ? `(${sort.length})` : ''}
      </button>
      {open && (
        <div className="space-y-2 border-t border-gray-200 px-2.5 py-2 dark:border-gray-700">
          {sort.map((rule, index) => (
            <div key={index} className="flex flex-wrap items-center gap-1.5">
              <select
                value={rule.field}
                onChange={(e) => updateRule(index, { field: e.target.value })}
                className="min-w-[120px] rounded border border-gray-300 bg-white px-2 py-1 text-xs font-mono dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="_score">_score</option>
                <option value="_doc">_doc</option>
                {sortFields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select
                value={rule.order}
                onChange={(e) => updateRule(index, { order: e.target.value as 'asc' | 'desc' })}
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
              >
                <option value="asc">asc</option>
                <option value="desc">desc</option>
              </select>
              <button
                type="button"
                onClick={() => removeRule(index)}
                className="rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addRule}
            className="text-xs text-blue-600 hover:underline dark:text-blue-400"
          >
            + Add sort
          </button>
          <p className="text-[10px] text-gray-500 dark:text-gray-400" title="Text fields may need .keyword suffix">
            Tip: sort on keyword subfields (e.g. message.keyword) when sorting text fields.
          </p>
        </div>
      )}
    </div>
  );
}

type RequestPreviewProps = {
  url: string;
  body: Record<string, unknown> | null;
  curl: string;
};

export function QueryRequestPreview({ url, body, curl }: RequestPreviewProps) {
  const [open, setOpen] = useState(false);
  if (!body) return null;

  return (
    <div className="rounded border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-medium text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Request preview
      </button>
      {open && (
        <div className="space-y-2 border-t border-gray-200 px-2.5 py-2 dark:border-gray-700">
          <p className="break-all font-mono text-[10px] text-gray-600 dark:text-gray-400">POST {url}</p>
          <CodeBlockWithCopy text={JSON.stringify(body, null, 2)} label="Request body" />
          <CodeBlockWithCopy text={curl} label="cURL" />
        </div>
      )}
    </div>
  );
}
