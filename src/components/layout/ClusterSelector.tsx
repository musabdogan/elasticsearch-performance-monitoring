import { ChevronDown, Edit2, Plus, Server, Trash2, Check, Eye, EyeOff, Copy } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useMonitoring } from '@/context/MonitoringProvider';
import type { ClusterConnection, CreateClusterInput } from '@/types/app';

const initialForm: CreateClusterInput = {
  label: '',
  baseUrl: '',
  username: '',
  password: ''
};

export function ClusterSelector() {
  const {
    clusters,
    activeCluster,
    setActiveCluster,
    addCluster,
    updateCluster,
    deleteCluster
  } = useMonitoring();
  const [form, setForm] = useState<CreateClusterInput>(initialForm);
  const [showDropdown, setShowDropdown] = useState(false);
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [copiedCluster, setCopiedCluster] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    setShowDropdown(false);
    setIsAddingNew(false);
    setEditingLabel(null);
    setForm(initialForm);
    setFormError(null);
    setShowPassword(false);
    setCopiedCluster(null);
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
    setForm({
      label: cluster.label,
      baseUrl: cluster.baseUrl,
      username: cluster.username || '',
      password: cluster.password || ''
    });
    setEditingLabel(cluster.label);
    setIsAddingNew(true);
    setFormError(null);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
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
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.baseUrl) {
      setFormError('URL:PORT is required.');
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

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-1 text-xs text-gray-700 dark:text-gray-300">
          <Server className="h-3 w-3" />
          <span className="font-medium">Clusters:</span>
        </div>
        <button
          type="button"
          onClick={openDropdown}
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
        <div className="absolute right-0 top-full z-[9999] mt-2 w-80 origin-top-right animate-fade-in">
          <div className="rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
            {/* Header */}
            <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-700">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider dark:text-gray-400">
                {isAddingNew ? (editingLabel ? 'Edit Cluster' : 'New Cluster') : 'Clusters'}
              </h3>
            </div>

            {/* Content */}
            <div className="p-2">
              {!isAddingNew ? (
                <>
                  {/* Cluster List */}
                  {clusters.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {clusters.map((cluster) => (
                        <div
                          key={cluster.label}
                          className={`group flex items-center justify-between rounded-lg px-3 py-2 transition-colors ${
                            activeCluster?.label === cluster.label
                              ? 'bg-blue-50 dark:bg-blue-900/30'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setActiveCluster(cluster.label);
                              handleClose();
                            }}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="flex items-center gap-2">
                              {activeCluster?.label === cluster.label && (
                                <Check className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                              )}
                              <div className="min-w-0">
                                <div className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate">
                                  {cluster.label}
                                </div>
                              </div>
                            </div>
                          </button>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyUrl(cluster);
                              }}
                              className={`rounded-md p-1.5 transition-colors ${
                                copiedCluster === cluster.label
                                  ? 'text-green-600 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300'
                                  : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300'
                              }`}
                              title={copiedCluster === cluster.label ? "Copied!" : "Copy URL"}
                            >
                              {copiedCluster === cluster.label ? (
                                <Check className="h-3.5 w-3.5" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(cluster);
                              }}
                              className="rounded-md p-1.5 text-gray-400 hover:bg-gray-200 hover:text-gray-600 dark:hover:bg-gray-600 dark:hover:text-gray-300"
                              title="Edit"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm(`Delete cluster "${cluster.label}"?`)) {
                                  deleteCluster(cluster.label);
                                }
                              }}
                              className="rounded-md p-1.5 text-gray-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Add New Button */}
                  <button
                    type="button"
                    onClick={() => setIsAddingNew(true)}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg border-2 border-dashed border-gray-200 px-3 py-2.5 text-sm text-gray-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600 dark:border-gray-600 dark:text-gray-400 dark:hover:border-blue-500 dark:hover:bg-blue-900/20 dark:hover:text-blue-400"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add new cluster</span>
                  </button>
                </>
              ) : (
                /* Add/Edit Form */
                <form onSubmit={handleSubmit} className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      Name
                    </label>
                    <input
                      type="text"
                      value={form.label}
                      onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
                      placeholder="Production, Staging..."
                      autoFocus
                    />
                  </div>
                  
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      URL:PORT <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={form.baseUrl}
                      onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
                      placeholder="http://localhost:9200"
                      required
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">
                        Username
                      </label>
                      <input
                        type="text"
                        value={form.username}
                        onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
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
                          value={form.password}
                          onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                          className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 pr-8 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 dark:placeholder:text-gray-500 dark:focus:bg-gray-700"
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

                  {formError && (
                    <p className="rounded-md bg-red-50 px-2 py-1.5 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
                      {formError}
                    </p>
                  )}

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
                      className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-blue-700"
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

