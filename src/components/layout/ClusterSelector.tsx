import { ChevronDown, ChevronUp, Edit2, MoreVertical, Plus, Server, Trash2, Check, Eye, EyeOff, Copy, Wifi, Search, X, Shield, Globe, Code } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { useMonitoring } from '@/context/MonitoringProvider';
import { checkClusterHealth, getClusterHealth } from '@/services/elasticsearch';
import { InfoPopup } from '@/components/ui/InfoPopup';
import type { AuthType, ClusterConnection, ClusterCategory, CreateClusterInput } from '@/types/app';
import { hasSearchTerms, matchesParsedTermsInAnyText, parseSearchTerms } from '@/utils/search';

/** Category config: either Icon or emoji (generic horse face for Other). */
const CLUSTER_CATEGORIES: {
  id: ClusterCategory;
  label: string;
  Icon?: React.ComponentType<React.SVGAttributes<SVGSVGElement>>;
  emoji?: string;
  iconColor: string;
}[] = [
  { id: 'production', label: 'Production', Icon: Shield, iconColor: 'text-emerald-600 dark:text-emerald-400' },
  { id: 'staging', label: 'Staging', Icon: Copy, iconColor: 'text-amber-500 dark:text-amber-400' },
  { id: 'dev', label: 'Dev', Icon: Code, iconColor: 'text-blue-500 dark:text-blue-400' },
  { id: 'region', label: 'Region', Icon: Globe, iconColor: 'text-violet-500 dark:text-violet-400' },
  { id: 'other', label: 'Other', emoji: '🐴', iconColor: 'text-slate-500 dark:text-slate-400' }
];

const API_KEY_JSON_BODY = `{
  "name": "searchali-elasticsearch-monitoring",
  "role_descriptors": {
    "monitoring": {
      "cluster": ["monitor", "monitor_snapshot"],
      "indices": [
        {
          "names": ["*"],
          "privileges": ["monitor", "view_index_metadata"]
        }
      ]
    }
  }
}`;

const API_KEY_KIBANA_SNIPPET = `POST _security/api_key
{
  "name": "searchali-elasticsearch-monitoring",
  "role_descriptors": {
    "monitoring": {
      "cluster": ["monitor", "monitor_snapshot"],
      "indices": [
        {
          "names": ["*"],
          "privileges": ["monitor", "view_index_metadata"]
        }
      ]
    }
  }
}`;

const MONITORING_USER_KIBANA_SNIPPET = `POST _security/user/searchali_monitoring_user
{
  "password": "searchali_monitoring_password",
  "roles": ["remote_monitoring_collector", "snapshot_user"]
}`;

function getMonitoringUserCurlSnippet(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, '');
  return `curl -u elastic:YOUR_ELASTIC_PASSWORD -X POST "${base}/_security/user/searchali_monitoring_user" -H "Content-Type: application/json" -d'
{
  "password": "searchali_monitoring_password",
  "roles": ["remote_monitoring_collector", "snapshot_user"]
}'`;
}

function ApiKeyCodeBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };
  return (
    <div className="relative group min-w-0">
      <pre className="bg-gray-100 dark:bg-gray-700 rounded-lg p-3 pr-10 text-xs font-mono whitespace-pre overflow-x-auto max-w-full break-all">
        {text}
      </pre>
      <button
        type="button"
        onClick={onCopy}
        title={copied ? 'Copied!' : `Copy ${label}`}
        className="absolute top-2 right-2 p-1.5 rounded text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-600 transition-colors"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

const initialForm: CreateClusterInput = {
  label: '',
  baseUrl: '',
  authType: 'none',
  username: '',
  password: '',
  apiKey: '',
  category: undefined
};

type HealthStatus = 'green' | 'yellow' | 'red' | 'loading' | 'unreachable';

/** Full class names kept so Tailwind purge does not drop these colors. */
const HEALTH_DOT_CLASS: Record<HealthStatus, string> = {
  loading: 'bg-gray-300 dark:bg-gray-500 animate-pulse',
  green: 'bg-green-500',
  yellow: 'bg-amber-500',
  red: 'bg-red-500',
  unreachable: 'bg-gray-400 dark:bg-gray-500'
};

export function ClusterSelector() {
  const {
    clusters,
    activeCluster,
    setActiveCluster,
    addCluster,
    updateCluster,
    updateClusterUuid,
    updateClusterName,
    deleteCluster,
    reorderClusters
  } = useMonitoring();
  const [form, setForm] = useState<CreateClusterInput>(initialForm);
  const [showDropdown, setShowDropdown] = useState(false);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [copiedCluster, setCopiedCluster] = useState<string | null>(null);
  const [testConnectionLoading, setTestConnectionLoading] = useState(false);
  const [testConnectionResult, setTestConnectionResult] = useState<{ success: boolean; error?: string; clusterUri?: string } | null>(null);
  const [clusterHealth, setClusterHealth] = useState<Record<string, { status: HealthStatus; cluster_name?: string; cluster_uuid?: string }>>({});
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<HealthStatus | 'unknown' | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<ClusterCategory | null>(null);
  const [openReorderForLabel, setOpenReorderForLabel] = useState<string | null>(null);
  const [apiKeyInfoOpen, setApiKeyInfoOpen] = useState(false);
  const [basicAuthInfoOpen, setBasicAuthInfoOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const onboardingTourRunRef = useRef(false);

  useEffect(() => {
    const onRunChanged = (e: Event) => {
      const ev = e as CustomEvent<{ run?: boolean }>;
      onboardingTourRunRef.current = ev.detail?.run === true;
    };
    window.addEventListener('onboardingTourRunChanged', onRunChanged as EventListener);
    return () => window.removeEventListener('onboardingTourRunChanged', onRunChanged as EventListener);
  }, []);

  const monitoringUserCurlSnippet = useMemo(() => {
    const baseUrl = (form.baseUrl?.trim() || 'https://localhost:9200').replace(/\/$/, '');
    return getMonitoringUserCurlSnippet(baseUrl);
  }, [form.baseUrl]);

  const apiKeyCurlSnippet = useMemo(() => {
    const baseUrl = (form.baseUrl?.trim() || 'https://localhost:9200').replace(/\/$/, '');
    return `curl -X POST "${baseUrl}/_security/api_key" \\
  -H "Content-Type: application/json" \\
  -u "elastic:YOUR_PASSWORD" \\
  -d '${API_KEY_JSON_BODY.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()}'`;
  }, [form.baseUrl]);

  const authType = form.authType ?? 'none';
  const isAuthCredentialsMissing =
    authType === 'basic'
      ? !form.username?.trim() || !form.password?.trim()
      : authType === 'apiKey'
        ? !form.apiKey?.trim()
        : false;

  const filteredClusters = useMemo(() => {
    const parsed = parseSearchTerms(filter);
    let list = clusters;
    if (hasSearchTerms(parsed)) {
      list = list.filter(
        (c) =>
          matchesParsedTermsInAnyText([c.label, c.baseUrl], parsed)
      );
    }
    if (statusFilter) {
      list = list.filter((c) => {
        const s = clusterHealth[c.label]?.status ?? 'loading';
        if (statusFilter === 'unknown') return s === 'loading' || s === 'unreachable';
        return s === statusFilter;
      });
    }
    if (categoryFilter) {
      list = list.filter((c) => c.category === categoryFilter);
    }
    return list;
  }, [clusters, filter, statusFilter, categoryFilter, clusterHealth]);

  const totalFiltered = filteredClusters.length;

  /** Status counts for badge icons: green, yellow, red, unknown (loading + unreachable) */
  const statusCounts = useMemo(() => {
    let green = 0;
    let yellow = 0;
    let red = 0;
    let unknown = 0;
    clusters.forEach((c) => {
      const s = clusterHealth[c.label]?.status ?? 'loading';
      if (s === 'green') green++;
      else if (s === 'yellow') yellow++;
      else if (s === 'red') red++;
      else unknown++; // loading, unreachable
    });
    return { total: clusters.length, green, yellow, red, unknown };
  }, [clusters, clusterHealth]);

  const handleClose = () => {
    setShowDropdown(false);
    setOpenReorderForLabel(null);
    setIsAddingNew(false);
    setEditingLabel(null);
    setForm(initialForm);
    setFormError(null);
    setShowPassword(false);
    setShowApiKey(false);
    setApiKeyInfoOpen(false);
    setBasicAuthInfoOpen(false);
    setCopiedCluster(null);
    setTestConnectionResult(null);
    setStatusFilter(null);
    setCategoryFilter(null);
    // Keep clusterHealth so status badges retain data
  };

  const handleCopyUrl = async (cluster: ClusterConnection) => {
    try {
      await navigator.clipboard.writeText(cluster.baseUrl);
      setCopiedCluster(cluster.label);
      // Hide check after 2 seconds
      setTimeout(() => {
        setCopiedCluster(null);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy URL:', err);
    }
  };

  const handleEdit = (cluster: ClusterConnection) => {
    const authType: AuthType =
      cluster.authType ?? (cluster.apiKey?.trim() ? 'apiKey' : cluster.username && cluster.password ? 'basic' : 'none');
    setForm({
      label: cluster.label,
      baseUrl: cluster.baseUrl,
      authType,
      username: cluster.username || '',
      password: cluster.password || '',
      apiKey: cluster.apiKey || '',
      cluster_uuid: cluster.cluster_uuid,
      category: cluster.category
    });
    setEditingLabel(cluster.label);
    setIsAddingNew(true);
    setFormError(null);
  };

  // Close reorder menu when clicking outside
  useEffect(() => {
    if (openReorderForLabel === null) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inMenu = (target as Element).closest?.('[data-reorder-menu]');
      if (!inMenu) setOpenReorderForLabel(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openReorderForLabel]);

  // Close dropdown when clicking outside (ignore clicks inside info popups portaled to body)
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const inDropdown = dropdownRef.current?.contains(target);
      const inInfoPopup = (target as Element).closest?.('[data-info-popup]');
      if (dropdownRef.current && !inDropdown && !inInfoPopup) {
        // During first-cluster onboarding, keep the cluster popup open even if user clicks outside.
        if (onboardingTourRunRef.current && clusters.length === 0) return;
        handleClose();
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  // Handle ESC key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    if (showDropdown) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [showDropdown]);

  // Stable key: only changes when the set of cluster labels changes (add/remove), not when cluster_name/cluster_uuid updates
  const clusterLabelsKey = useMemo(
    () => clusters.map((c) => c.label).sort().join(','),
    [clusters]
  );

  // Fetch health for all clusters when dropdown opens (so status is fresh) or when cluster list changes
  useEffect(() => {
    if (clusters.length === 0 || !showDropdown) return;
    const abort = new AbortController();
    let cancelled = false;
    const list = clusters;
    setClusterHealth((prev) => {
      const next = { ...prev };
      list.forEach((c) => { next[c.label] = next[c.label] ?? { status: 'loading' }; });
      return next;
    });
    list.forEach((cluster) => {
      getClusterHealth(cluster, abort.signal)
        .then((health) => {
          if (cancelled) return;
          const raw = String(health?.status ?? '').toLowerCase();
          const status: HealthStatus =
            raw === 'green' || raw === 'yellow' || raw === 'red' ? raw : 'unreachable';
          setClusterHealth((prev) => ({
            ...prev,
            [cluster.label]: { status, cluster_name: health.cluster_name, cluster_uuid: health.cluster_uuid }
          }));
          if (health.cluster_name) updateClusterName(cluster.label, health.cluster_name);
          if (health.cluster_uuid) updateClusterUuid(cluster.label, health.cluster_uuid);
        })
        .catch(() => {
          if (cancelled) return;
          setClusterHealth((prev) => ({
            ...prev,
            [cluster.label]: { status: 'unreachable' as const }
          }));
        });
    });
    return () => {
      cancelled = true;
      abort.abort();
    };
  }, [clusterLabelsKey, showDropdown]);

  // Listen for custom event from welcome screen
  useEffect(() => {
    const handleOpenClusterSelector = () => {
      openDropdown();
    };

    window.addEventListener('openClusterSelector', handleOpenClusterSelector);
    return () => window.removeEventListener('openClusterSelector', handleOpenClusterSelector);
  }, []);

  const handleCancel = () => {
    if (clusters.length === 0) {
      handleClose();
    } else {
      setIsAddingNew(false);
      setEditingLabel(null);
      setForm(initialForm);
      setFormError(null);
      setShowPassword(false);
      setShowApiKey(false);
      setApiKeyInfoOpen(false);
      setBasicAuthInfoOpen(false);
      setTestConnectionResult(null);
    }
  };

  const handleTestConnection = async () => {
    const baseUrl = form.baseUrl?.trim().replace(/\/$/, '');
    if (!baseUrl) {
      setFormError('URL:PORT is required to test connection.');
      return;
    }
    try {
      new URL(baseUrl);
    } catch {
      setFormError('Invalid URL format. Use http://host:port or https://host:port');
      return;
    }
    setFormError(null);
    setTestConnectionResult(null);
    setTestConnectionLoading(true);
    try {
      const authType = form.authType ?? (form.apiKey?.trim() ? 'apiKey' : form.username && form.password ? 'basic' : 'none');
      const cluster: ClusterConnection = {
        label: form.label || baseUrl,
        baseUrl,
        authType,
        username: form.username || '',
        password: form.password || '',
        apiKey: form.apiKey || ''
      };
      const result = await checkClusterHealth(cluster);
      setTestConnectionResult(result);
    } finally {
      setTestConnectionLoading(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.baseUrl) {
      setFormError('URL:PORT is required.');
      return;
    }

    const auth = form.authType ?? 'none';
    if (auth === 'basic' && (!form.username?.trim() || !form.password?.trim())) {
      setFormError('Username and password are required for Basic auth. Use No authorization if the cluster has no auth.');
      return;
    }
    if (auth === 'apiKey' && !form.apiKey?.trim()) {
      setFormError('API key is required. Use No authorization if the cluster has no auth.');
      return;
    }

    try {
      const url = new URL(form.baseUrl);
      if (!['http:', 'https:'].includes(url.protocol)) {
        setFormError('URL must start with http:// or https://');
        return;
      }
    } catch {
      setFormError('Invalid URL format. Use http://host:port or https://host:port');
      return;
    }

    if (editingLabel) {
      updateCluster(editingLabel, form);
    } else {
      addCluster(form);
    }
    handleCancel();
  };

  const openDropdown = () => {
    if (clusters.length === 0) {
      setIsAddingNew(true);
    }
    setShowDropdown(true);
  };

  const toggleDropdown = () => {
    if (showDropdown) handleClose();
    else openDropdown();
  };

  const moveCluster = (clusterLabel: string, direction: 'up' | 'down') => {
    const idx = clusters.findIndex((c) => c.label === clusterLabel);
    if (idx < 0) return;
    if (direction === 'up' && idx === 0) return;
    if (direction === 'down' && idx >= clusters.length - 1) return;
    const next = [...clusters];
    const swap = direction === 'up' ? idx - 1 : idx + 1;
    [next[idx], next[swap]] = [next[swap], next[idx]];
    reorderClusters(next);
  };

  const handleStatusBadgeClick = (status: HealthStatus | 'unknown' | 'all') => {
    if (!showDropdown) setShowDropdown(true);
    const nextFilter = status === 'all' ? null : status;
    setStatusFilter((prev) => (prev === nextFilter ? null : nextFilter));
  };

  return (
    <div className={`relative ${showDropdown ? 'z-[100]' : ''}`} ref={dropdownRef}>
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
          <Server className="h-3 w-3" />
          <span className="font-medium">Clusters:</span>
        </div>
        <button
          type="button"
          onClick={toggleDropdown}
          className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
            showDropdown
              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-900/20 dark:text-blue-300'
              : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-100 hover:shadow dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600'
          }`}
        >
          <span className="max-w-[120px] truncate">
            {activeCluster?.label || 'Select cluster'}
          </span>
          <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${showDropdown ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Dropdown Panel */}
      {showDropdown && (
        <div className="absolute left-0 top-full z-[9999] mt-2 w-[720px] max-w-[calc(100vw-2rem)] origin-top-left animate-dropdown overflow-hidden">
          <div className="rounded-xl bg-white/95 shadow-xl backdrop-blur-sm dark:bg-gray-800/95 overflow-hidden ring-1 ring-black/5 dark:ring-white/10">
            {/* Header */}
            <div className="px-3 py-2.5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                {isAddingNew ? (editingLabel ? 'Edit Cluster' : 'New Cluster') : 'Clusters'}
              </h3>
            </div>

            {/* Content - no horizontal scroll */}
            <div className="px-3 pb-3 min-w-0 overflow-hidden">
              {!isAddingNew ? (
                <>
                  {/* Top bar: ADD CLUSTER, status badges (total / green / yellow / red / unknown), Filter */}
                  <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setIsAddingNew(true)}
                        data-tour="cluster-add-button"
                        className="flex items-center gap-1 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
                      >
                        <Plus className="h-4 w-4" />
                        Add cluster
                      </button>
                      {/* Round status badges: green, yellow, red, unknown — click filters list by that status; total count shown in table header */}
                      {clusters.length > 0 && (
                        <div className="flex items-center gap-1" role="group" aria-label="Cluster status counts">
                          <button
                            type="button"
                            onClick={() => handleStatusBadgeClick('green')}
                            title={`Green: ${statusCounts.green} cluster(s)`}
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold tabular-nums transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                              statusFilter === 'green'
                                ? 'border-emerald-600 bg-emerald-500 text-white dark:bg-emerald-600'
                                : 'border-emerald-400 bg-emerald-100 text-emerald-800 dark:border-emerald-600 dark:bg-emerald-900/50 dark:text-emerald-200'
                            }`}
                          >
                            {statusCounts.green}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatusBadgeClick('yellow')}
                            title={`Yellow: ${statusCounts.yellow} cluster(s)`}
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold tabular-nums transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                              statusFilter === 'yellow'
                                ? 'border-amber-600 bg-amber-500 text-white dark:bg-amber-600'
                                : 'border-amber-400 bg-amber-100 text-amber-800 dark:border-amber-600 dark:bg-amber-900/50 dark:text-amber-200'
                            }`}
                          >
                            {statusCounts.yellow}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatusBadgeClick('red')}
                            title={`Red: ${statusCounts.red} cluster(s)`}
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold tabular-nums transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                              statusFilter === 'red'
                                ? 'border-red-600 bg-red-500 text-white dark:bg-red-600'
                                : 'border-red-400 bg-red-100 text-red-800 dark:border-red-600 dark:bg-red-900/50 dark:text-red-200'
                            }`}
                          >
                            {statusCounts.red}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStatusBadgeClick('unknown')}
                            title={`Unknown / loading: ${statusCounts.unknown} cluster(s)`}
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold tabular-nums transition-all hover:scale-110 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                              statusFilter === 'unknown'
                                ? 'border-slate-500 bg-slate-500 text-white dark:bg-slate-400'
                                : 'border-slate-300 bg-slate-100 text-slate-600 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {statusCounts.unknown}
                          </button>
                        </div>
                      )}
                      {(statusFilter || categoryFilter) && (
                        <span className="inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200 border-gray-200 dark:border-gray-600">
                          {[statusFilter && (statusFilter === 'unknown' ? 'Unknown' : statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)), categoryFilter && (CLUSTER_CATEGORIES.find((c) => c.id === categoryFilter)?.label ?? categoryFilter)].filter(Boolean).join(' · ')}
                          {' '}{totalFiltered}
                          <button
                            type="button"
                            onClick={() => { setStatusFilter(null); setCategoryFilter(null); }}
                            className="rounded p-0.5 hover:bg-gray-200 dark:hover:bg-gray-600"
                            title="Clear filters"
                            aria-label="Clear filters"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      )}
                    </div>
                    {/* Category filter (left of search) + Filter input */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {clusters.some((c) => c.category) && (
                        <div className="flex items-center gap-0.5" role="group" aria-label="Filter by category">
                          <button
                            type="button"
                            onClick={() => setCategoryFilter(null)}
                            title="All categories"
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                              !categoryFilter
                                ? 'border-blue-500 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400'
                            }`}
                          >
                            <Server className="h-3.5 w-3.5" />
                          </button>
                          {CLUSTER_CATEGORIES.map(({ id, label, Icon, emoji, iconColor }) => {
                            const count = clusters.filter((c) => c.category === id).length;
                            if (count === 0) return null;
                            return (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setCategoryFilter((prev) => (prev === id ? null : id))}
                                title={`${label}: ${count} cluster(s)`}
                                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-all hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                                  categoryFilter === id
                                    ? 'border-blue-500 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                                    : 'border-gray-200 bg-gray-50 text-gray-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400'
                                }`}
                              >
                                {emoji ? (
                                  <span className={`text-base leading-none ${iconColor}`} aria-hidden>{emoji}</span>
                                ) : (
                                  Icon && <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      <div className="relative w-40 flex-shrink-0 flex items-center">
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                        <input
                          type="text"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                          placeholder="Filter..."
                          className="h-9 w-full rounded-md border border-gray-200 bg-gray-50 py-2 pl-8 pr-8 text-xs text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700 min-w-0"
                        />
                        {filter.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setFilter('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 dark:hover:text-gray-300 dark:hover:bg-gray-600"
                            title="Clear filter"
                            aria-label="Clear filter"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Cluster Table */}
                  {clusters.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => setIsAddingNew(true)}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-gray-200 px-4 py-6 text-sm text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                    >
                      <Plus className="h-5 w-5" />
                      Add cluster
                    </button>
                  ) : totalFiltered === 0 ? (
                    <p className="py-2 text-center text-xs text-gray-500 dark:text-gray-400">No clusters match the filter. Try a different search or clear filters.</p>
                  ) : (
                    <>
                      <div className="rounded-lg overflow-hidden min-w-0 w-full">
                        <div className="w-full max-w-full max-h-[420px] overflow-y-auto overflow-x-hidden">
                          <table className="w-full max-w-full table-fixed text-left text-xs" style={{ tableLayout: 'fixed' }}>
                            <colgroup>
                              <col className="w-[38%]" />
                              <col className="w-[40%]" />
                              <col className="w-[22%]" />
                            </colgroup>
                            <thead className="sticky top-0 z-[1] bg-gray-50/90 dark:bg-gray-800/90 backdrop-blur-sm">
                              <tr>
                                <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-400 truncate">Cluster ({statusCounts.total})</th>
                                <th className="py-2 px-2 font-semibold text-gray-600 dark:text-gray-400 truncate">Uri</th>
                                <th className="py-2 px-2 truncate" aria-label="Actions" />
                              </tr>
                            </thead>
                            <tbody>
                              {filteredClusters.map((cluster) => {
                                const healthInfo = clusterHealth[cluster.label];
                                const status = healthInfo?.status ?? 'loading';
                                const displayClusterName = cluster.cluster_name ?? healthInfo?.cluster_name;
                                const clusterIndex = clusters.findIndex((c) => c.label === cluster.label);
                                const canMoveUp = clusterIndex > 0;
                                const canMoveDown = clusterIndex >= 0 && clusterIndex < clusters.length - 1;
                                const statusDot = HEALTH_DOT_CLASS[status];
                                const isActive = activeCluster?.label === cluster.label;
                                return (
                                  <tr
                                    key={cluster.label}
                                    className={isActive ? 'bg-blue-50/80 dark:bg-blue-900/20' : 'hover:bg-gray-50/80 dark:hover:bg-gray-700/30'}
                                  >
                                    <td className="py-2 px-2 min-w-0 overflow-hidden">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <div
                                          className={`h-2 w-2 flex-shrink-0 rounded-full ${statusDot}`}
                                          title={
                                            status === 'loading'
                                              ? 'Checking…'
                                              : status === 'unreachable'
                                                ? 'Unreachable or unknown'
                                                : `Cluster status: ${status}`
                                          }
                                        />
                                        {cluster.category && (() => {
                                          const cat = CLUSTER_CATEGORIES.find((c) => c.id === cluster.category);
                                          if (!cat) return null;
                                          return cat.emoji ? (
                                            <span className={`flex-shrink-0 text-base leading-none ${cat.iconColor}`} title={cat.label} aria-hidden>{cat.emoji}</span>
                                          ) : cat.Icon ? (
                                            <span className={`flex-shrink-0 ${cat.iconColor}`} title={cat.label}>
                                              <cat.Icon className="h-3.5 w-3.5" />
                                            </span>
                                          ) : null;
                                        })()}
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setActiveCluster(cluster.label);
                                            handleClose();
                                          }}
                                          className="text-left min-w-0 flex-1 overflow-hidden"
                                        >
                                          <div className="flex items-center gap-1 min-w-0">
                                            <span className="font-medium text-gray-900 dark:text-gray-100 truncate block min-w-0" title={cluster.label}>
                                              {cluster.label}
                                            </span>
                                            {isActive && (
                                              <span className="inline-flex items-center rounded px-1 py-0.5 text-[11px] font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 flex-shrink-0">
                                                active
                                              </span>
                                            )}
                                          </div>
                                          <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate block min-w-0 mt-0.5 font-mono" title={displayClusterName ?? undefined}>
                                            {displayClusterName ?? '—'}
                                          </div>
                                        </button>
                                      </div>
                                    </td>
                                    <td className="py-2 px-2 align-middle min-w-0 overflow-hidden">
                                      <div className="flex items-center gap-0.5 min-w-0">
                                        <span
                                          className="truncate block min-w-0 text-gray-700 dark:text-gray-300 font-mono text-[11px] flex-1"
                                          title={cluster.baseUrl.replace(/\/$/, '')}
                                        >
                                          {cluster.baseUrl.replace(/\/$/, '')}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() => handleCopyUrl(cluster)}
                                          title={copiedCluster === cluster.label ? 'Copied!' : 'Copy URI'}
                                          className="flex-shrink-0 rounded p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300"
                                        >
                                          {copiedCluster === cluster.label ? (
                                            <Check className="h-4 w-4 text-green-600" />
                                          ) : (
                                            <Copy className="h-4 w-4" />
                                          )}
                                        </button>
                                      </div>
                                    </td>
                                    <td className="py-2 px-2 min-w-0 overflow-visible relative">
                                      <div className="flex items-center justify-end gap-0.5 flex-shrink-0" data-reorder-menu>
                                        <button
                                          type="button"
                                          onClick={() => handleEdit(cluster)}
                                          className="rounded p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300"
                                          title="Edit"
                                        >
                                          <Edit2 className="h-4 w-4" />
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (confirm(`Delete cluster "${cluster.label}"?`)) {
                                              deleteCluster(cluster.label);
                                            }
                                          }}
                                          className="rounded p-1.5 text-gray-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                                          title="Delete"
                                        >
                                          <Trash2 className="h-4 w-4" />
                                        </button>
                                        <div className="relative">
                                          <button
                                            type="button"
                                            onClick={() => setOpenReorderForLabel((prev) => (prev === cluster.label ? null : cluster.label))}
                                            className="rounded p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300"
                                            title="Reorder"
                                            aria-haspopup="true"
                                            aria-expanded={openReorderForLabel === cluster.label}
                                          >
                                            <MoreVertical className="h-4 w-4" />
                                          </button>
                                          {openReorderForLabel === cluster.label && (
                                            <div className="absolute right-0 top-full z-10 mt-0.5 min-w-[7rem] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800">
                                              <button
                                                type="button"
                                                disabled={!canMoveUp}
                                                onClick={() => {
                                                  moveCluster(cluster.label, 'up');
                                                  setOpenReorderForLabel(null);
                                                }}
                                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:pointer-events-none dark:text-gray-300 dark:hover:bg-gray-700"
                                              >
                                                <ChevronUp className="h-3.5 w-3.5" />
                                                Move up
                                              </button>
                                              <button
                                                type="button"
                                                disabled={!canMoveDown}
                                                onClick={() => {
                                                  moveCluster(cluster.label, 'down');
                                                  setOpenReorderForLabel(null);
                                                }}
                                                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:pointer-events-none dark:text-gray-300 dark:hover:bg-gray-700"
                                              >
                                                <ChevronDown className="h-3.5 w-3.5" />
                                                Move down
                                              </button>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  )}
                </>
              ) : (
                /* Add/Edit Form */
                <form onSubmit={handleSubmit} className="space-y-3" data-tour="cluster-form">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      Name
                    </label>
                    <input
                      type="text"
                      value={form.label}
                      onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
                      placeholder="Production, Staging..."
                      autoFocus
                    />
                  </div>

                  {/* Optional category icon for quick filtering */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      Tag <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <div className="flex items-center gap-1 flex-wrap">
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, category: undefined }))}
                        title="No category"
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                          form.category == null
                            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                        }`}
                      >
                        <Server className="h-4 w-4" />
                      </button>
                      {CLUSTER_CATEGORIES.map(({ id, label, Icon, emoji, iconColor }) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setForm((prev) => ({ ...prev, category: id }))}
                          title={label}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                            form.category === id
                              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                              : 'border-gray-200 bg-gray-50 text-gray-500 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
                          }`}
                        >
                          {emoji ? (
                            <span className={`text-lg leading-none ${iconColor}`} aria-hidden>{emoji}</span>
                          ) : (
                            Icon && <Icon className={`h-4 w-4 ${iconColor}`} />
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                  
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      URL:PORT <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.baseUrl}
                      onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
                      placeholder="http://localhost:9200"
                      required
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      Authentication
                    </label>
                    <div className="flex flex-wrap gap-3">
                      {(['none', 'basic', 'apiKey'] as const).map((t) => (
                        <label key={t} className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="radio"
                            name="authType"
                            checked={(form.authType ?? 'none') === t}
                            onChange={() => setForm((prev) => ({ ...prev, authType: t }))}
                            className="rounded-full border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700"
                          />
                          <span className="text-xs text-gray-700 dark:text-gray-300">
                            {t === 'none' && 'No authorization'}
                            {t === 'basic' && 'Basic auth'}
                            {t === 'apiKey' && 'API key'}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {(form.authType ?? 'none') === 'basic' && (
                    <div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                            Username
                          </label>
                          <input
                            type="text"
                            value={form.username ?? ''}
                            onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
                            placeholder="elastic"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                            Password
                          </label>
                          <div className="relative">
                            <input
                              type={showPassword ? 'text' : 'password'}
                              value={form.password ?? ''}
                              onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                              className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 pr-8 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
                              placeholder="••••••"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword(!showPassword)}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                            >
                              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        Use elastic or a dedicated monitoring user. Best practice: create a user with limited roles.
                        <InfoPopup
                          title="Create monitoring user"
                          modalTitle="Create monitoring user"
                          open={basicAuthInfoOpen}
                          onOpen={() => setBasicAuthInfoOpen(true)}
                          onClose={() => setBasicAuthInfoOpen(false)}
                          buttonClassName="inline-flex p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          placement="right"
                        >
                          <div className="space-y-3">
                            <p className="text-gray-600 dark:text-gray-400">
                              To maintain a secure cluster, create a dedicated user for health checks and metric collection rather than using a superuser account.
                            </p>
                            <div>
                              <p className="font-medium text-gray-700 dark:text-gray-200 mb-1">Recommended roles</p>
                              <ul className="text-[11px] text-gray-500 dark:text-gray-400 mb-2 list-disc list-inside space-y-0.5">
                                <li><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">remote_monitoring_collector</code> — cluster health, node stats, index metrics</li>
                                <li><code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">snapshot_user</code> — snapshot repositories and snapshot list (optional)</li>
                              </ul>
                            </div>
                            <div>
                              <p className="font-medium text-gray-700 dark:text-gray-200 mb-1">Kibana Dev Tools (Console)</p>
                              <ApiKeyCodeBlock text={MONITORING_USER_KIBANA_SNIPPET} label="Kibana snippet" />
                            </div>
                            <div>
                              <p className="font-medium text-gray-700 dark:text-gray-200 mb-1">Terminal (cURL)</p>
                              <ApiKeyCodeBlock text={monitoringUserCurlSnippet} label="curl command" />
                            </div>
                            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                              <p className="font-medium text-amber-800 dark:text-amber-200 text-[11px] mb-1">
                                Use for Username and Password above
                              </p>
                              <p className="text-amber-700 dark:text-amber-300 text-[11px]">
                                Example username: <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded font-mono">searchali_monitoring_user</code>
                              </p>
                              <p className="text-amber-700 dark:text-amber-300 text-[11px] mt-0.5">
                                Example password: <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded font-mono">searchali_monitoring_password</code>
                              </p>
                            </div>
                          </div>
                        </InfoPopup>
                      </p>
                    </div>
                  )}

                  {(form.authType ?? 'none') === 'apiKey' && (
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                        API key
                      </label>
                      <div className="relative">
                        <input
                          type={showApiKey ? 'text' : 'password'}
                          value={form.apiKey ?? ''}
                          onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 pr-8 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
                          placeholder="Paste encoded API key (from Kibana or POST /_security/api_key)"
                        />
                        <button
                          type="button"
                          onClick={() => setShowApiKey(!showApiKey)}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                        >
                          {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1">
                        Create via Kibana → Stack Management → API Keys, or POST /_security/api_key
                        <InfoPopup
                          title="Create API key"
                          modalTitle="Create API key"
                          open={apiKeyInfoOpen}
                          onOpen={() => setApiKeyInfoOpen(true)}
                          onClose={() => setApiKeyInfoOpen(false)}
                          buttonClassName="inline-flex p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                          placement="right"
                        >
                          <div className="space-y-3">
                            <div>
                              <p className="font-medium text-gray-700 dark:text-gray-200 mb-1">Kibana Dev Tools (Console)</p>
                              <ApiKeyCodeBlock text={API_KEY_KIBANA_SNIPPET} label="Kibana snippet" />
                            </div>
                            <div>
                              <p className="font-medium text-gray-700 dark:text-gray-200 mb-1">Terminal (cURL)</p>
                              <ApiKeyCodeBlock text={apiKeyCurlSnippet} label="curl command" />
                            </div>
                            <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-3 py-2">
                              <p className="font-medium text-amber-800 dark:text-amber-200 text-[11px]">
                                API key = <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded font-mono">encoded</code>
                              </p>
                              <p className="text-amber-700 dark:text-amber-300 text-[11px] mt-0.5">
                                Copy the <code className="bg-amber-100 dark:bg-amber-900/40 px-1 rounded font-mono">encoded</code> value from the response and paste it above.
                              </p>
                            </div>
                          </div>
                        </InfoPopup>
                      </p>
                    </div>
                  )}

                  {formError && (
                    <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
                      {formError}
                    </p>
                  )}

                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={handleTestConnection}
                      disabled={testConnectionLoading || !form.baseUrl?.trim() || isAuthCredentialsMissing}
                      className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    >
                      <Wifi className="h-3.5 w-3.5" />
                      {testConnectionLoading ? 'Testing…' : 'Test connection'}
                    </button>
                    {testConnectionResult && (
                      <div className={`rounded-md px-2 py-1.5 text-xs ${
                        testConnectionResult.success
                          ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400'
                          : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'
                      }`}>
                        {testConnectionResult.success ? (
                          'Connected successfully.'
                        ) : (
                          <>
                            <p className="mb-1">
                              {testConnectionResult.error}
                              {testConnectionResult.clusterUri && (
                                <> Cluster uri:{' '}
                                  <a
                                    href={testConnectionResult.clusterUri}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="underline break-all hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded"
                                  >
                                    {testConnectionResult.clusterUri}
                                  </a>
                                </>
                              )}
                            </p>
                            {testConnectionResult.clusterUri?.startsWith('https') && (
                              <p className="text-[11px] opacity-90 mt-0.5">
                                When using HTTPS, make sure your browser trusts the cluster&apos;s SSL certificate.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleCancel}
                      className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isAuthCredentialsMissing}
                      className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {editingLabel ? 'Update' : 'Add Cluster'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

