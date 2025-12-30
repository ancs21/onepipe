import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Play,
  Copy,
  Check,
  ChevronRight,
  Lock,
  Search,
  Clock,
  History,
  Zap,
  Server,
  Plus,
  X,
  Settings2,
  Code2,
  FileJson,
  Layers,
  ChevronLeft,
  Download,
  User,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useAuthUsers, useGenerateToken } from '../lib/db';
import type { RouteInfo, AuthUser } from '../lib/types';

// ============================================================================
// Types
// ============================================================================

interface RequestHistoryItem {
  id: string;
  method: string;
  path: string;
  body?: string;
  headers?: Record<string, string>;
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    duration: number;
  };
  timestamp: number;
  starred?: boolean;
}

interface KeyValuePair {
  key: string;
  value: string;
  enabled: boolean;
}

interface Environment {
  name: string;
  variables: Record<string, string>;
}

// ============================================================================
// Storage
// ============================================================================

function getRequestHistory(): RequestHistoryItem[] {
  try {
    const stored = localStorage.getItem('onepipe_request_history');
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveRequestHistory(history: RequestHistoryItem[]) {
  localStorage.setItem(
    'onepipe_request_history',
    JSON.stringify(history.slice(0, 100))
  );
}

function getEnvironments(): Environment[] {
  try {
    const stored = localStorage.getItem('onepipe_environments');
    return stored
      ? JSON.parse(stored)
      : [
          {
            name: 'Development',
            variables: { baseUrl: 'http://localhost:3001' },
          },
          {
            name: 'Production',
            variables: { baseUrl: 'https://api.example.com' },
          },
        ];
  } catch {
    return [
      { name: 'Development', variables: { baseUrl: 'http://localhost:3001' } },
    ];
  }
}

// ============================================================================
// Utility Components
// ============================================================================

function MethodBadge({
  method,
  size = 'sm',
}: {
  method: string;
  size?: 'xs' | 'sm' | 'md';
}) {
  const colors: Record<string, string> = {
    GET: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    POST: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
    PUT: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    PATCH:
      'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20',
    DELETE: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
  };
  const sizes = {
    xs: 'px-1 py-0.5 text-[9px]',
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-1 text-xs',
  };
  return (
    <span
      className={`${colors[method] || colors.GET} ${
        sizes[size]
      } font-mono font-bold rounded border`}
    >
      {method}
    </span>
  );
}

function StatusBadge({
  status,
  duration,
}: {
  status: number;
  duration?: number;
}) {
  const isSuccess = status >= 200 && status < 300;
  const isRedirect = status >= 300 && status < 400;
  const isClientError = status >= 400 && status < 500;
  const isServerError = status >= 500;

  const colors = isSuccess
    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
    : isRedirect
    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
    : isClientError
    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
    : isServerError
    ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
    : 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/20';

  return (
    <div className="flex items-center gap-2">
      <span
        className={`px-2 py-1 text-xs font-mono font-bold rounded border ${colors}`}
      >
        {status}
      </span>
      {duration !== undefined && (
        <span className="flex items-center gap-1 text-xs text-text-muted font-mono">
          <Clock className="w-3 h-3" />
          {duration.toFixed(0)}ms
        </span>
      )}
    </div>
  );
}

// ============================================================================
// Auth User Dropdown
// ============================================================================

function AuthUserDropdown({
  selectedUser,
  onSelectUser,
  onClearAuth,
  isGenerating,
}: {
  selectedUser: AuthUser | null;
  onSelectUser: (user: AuthUser) => void;
  onClearAuth: () => void;
  isGenerating: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { data: users, isLoading } = useAuthUsers();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={isGenerating}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
          selectedUser
            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
            : 'bg-bg-secondary text-text-muted border-border hover:text-text-primary hover:border-border'
        }`}
      >
        {isGenerating ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <User className="w-3.5 h-3.5" />
        )}
        {selectedUser ? (
          <span className="max-w-[120px] truncate">{selectedUser.email}</span>
        ) : (
          'Auth'
        )}
        <ChevronDown className="w-3 h-3" />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-bg-primary border border-border
                      rounded-lg shadow-lg z-50 py-1 animate-in fade-in zoom-in-95 duration-150">
          <div className="px-3 py-2 border-b border-border">
            <p className="text-xs font-medium text-text-primary">Authenticate as</p>
            <p className="text-[10px] text-text-muted mt-0.5">
              Select a user to add Authorization header
            </p>
          </div>

          {isLoading ? (
            <div className="p-4 text-center">
              <Loader2 className="w-4 h-4 mx-auto animate-spin text-text-muted" />
            </div>
          ) : !users || users.length === 0 ? (
            <div className="p-4 text-center">
              <User className="w-6 h-6 mx-auto mb-2 text-text-muted/30" />
              <p className="text-xs text-text-muted">No test users</p>
              <p className="text-[10px] text-text-muted/60 mt-0.5">
                Create users in the Auth page
              </p>
            </div>
          ) : (
            <div className="max-h-48 overflow-y-auto py-1">
              {users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => {
                    onSelectUser(user);
                    setIsOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                    selectedUser?.id === user.id
                      ? 'bg-accent/10'
                      : 'hover:bg-bg-tertiary'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-indigo-500/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-[10px] font-medium text-indigo-500">
                      {user.email.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-mono text-text-primary truncate">
                      {user.email}
                    </p>
                    {user.role && (
                      <p className="text-[10px] text-text-muted">{user.role}</p>
                    )}
                  </div>
                  {selectedUser?.id === user.id && (
                    <Check className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          )}

          {selectedUser && (
            <>
              <div className="border-t border-border" />
              <button
                onClick={() => {
                  onClearAuth();
                  setIsOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500
                         hover:bg-red-500/10 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                Clear authentication
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function KeyValueEditor({
  pairs,
  onChange,
  placeholder = { key: 'Key', value: 'Value' },
}: {
  pairs: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  placeholder?: { key: string; value: string };
}) {
  const addPair = () => {
    onChange([...pairs, { key: '', value: '', enabled: true }]);
  };

  const updatePair = (
    index: number,
    field: 'key' | 'value' | 'enabled',
    value: string | boolean
  ) => {
    const newPairs = [...pairs];
    newPairs[index] = { ...newPairs[index], [field]: value };
    onChange(newPairs);
  };

  const removePair = (index: number) => {
    onChange(pairs.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-1">
      {pairs.map((pair, index) => (
        <div key={index} className="flex items-center gap-2 group">
          <input
            type="checkbox"
            checked={pair.enabled}
            onChange={(e) => updatePair(index, 'enabled', e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border text-accent focus:ring-accent/20"
          />
          <input
            type="text"
            value={pair.key}
            onChange={(e) => updatePair(index, 'key', e.target.value)}
            placeholder={placeholder.key}
            className={`flex-1 px-2 py-1.5 text-xs font-mono bg-bg-primary border border-border rounded
                      focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent
                      ${!pair.enabled ? 'opacity-50' : ''}`}
          />
          <input
            type="text"
            value={pair.value}
            onChange={(e) => updatePair(index, 'value', e.target.value)}
            placeholder={placeholder.value}
            className={`flex-1 px-2 py-1.5 text-xs font-mono bg-bg-primary border border-border rounded
                      focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent
                      ${!pair.enabled ? 'opacity-50' : ''}`}
          />
          <button
            onClick={() => removePair(index)}
            className="p-1 text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        onClick={addPair}
        className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add
      </button>
    </div>
  );
}

// ============================================================================
// JSON Viewer (Enhanced)
// ============================================================================

function JSONViewer({
  data,
  maxHeight = 400,
}: {
  data: unknown;
  maxHeight?: number;
}) {
  const [copied, setCopied] = useState(false);
  const jsonString = useMemo(() => JSON.stringify(data, null, 2), [data]);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const syntaxHighlight = (json: string) => {
    // Use CSS custom properties for theme-aware colors
    return json
      .replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?)/g, (match) => {
        if (match.endsWith(':')) {
          // Keys - blue
          return `<span style="color: var(--syntax-key, #3b82f6)">${match.slice(
            0,
            -1
          )}</span>:`;
        }
        // String values - emerald
        return `<span style="color: var(--syntax-string, #10b981)">${match}</span>`;
      })
      .replace(
        /\b(true|false)\b/g,
        '<span style="color: var(--syntax-boolean, #8b5cf6)">$1</span>'
      )
      .replace(
        /\b(null)\b/g,
        '<span style="color: var(--syntax-null, #71717a); font-style: italic">$1</span>'
      )
      .replace(
        /\b(\d+\.?\d*)\b/g,
        '<span style="color: var(--syntax-number, #f59e0b)">$1</span>'
      );
  };

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 z-10 p-1.5 rounded bg-bg-tertiary/90 backdrop-blur-sm
                 opacity-0 group-hover:opacity-100 transition-opacity text-text-muted hover:text-text-primary"
      >
        {copied ? (
          <Check className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <Copy className="w-3.5 h-3.5" />
        )}
      </button>
      <pre
        className="p-4 bg-bg-primary rounded-lg border border-border overflow-auto font-mono text-xs leading-relaxed"
        style={{ maxHeight }}
        dangerouslySetInnerHTML={{ __html: syntaxHighlight(jsonString) }}
      />
    </div>
  );
}

// ============================================================================
// Sidebar - Endpoint List
// ============================================================================

function EndpointSidebar({
  routes,
  selectedRoute,
  onSelectRoute,
  history,
  onSelectHistory,
  collapsed,
  onToggleCollapse,
}: {
  routes: RouteInfo[];
  selectedRoute: RouteInfo | null;
  onSelectRoute: (route: RouteInfo) => void;
  history: RequestHistoryItem[];
  onSelectHistory: (item: RequestHistoryItem) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'endpoints' | 'history'>(
    'endpoints'
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const filteredRoutes = useMemo(() => {
    if (!search) return routes;
    const lower = search.toLowerCase();
    return routes.filter(
      (r) =>
        r.path.toLowerCase().includes(lower) ||
        r.method.toLowerCase().includes(lower)
    );
  }, [routes, search]);

  const groupedRoutes = useMemo(() => {
    const groups: Record<string, RouteInfo[]> = {};
    for (const route of filteredRoutes) {
      const parts = route.path.split('/').filter(Boolean);
      // Use second segment for service name (e.g., /api/todos -> todos)
      const group = parts[1] || parts[0] || 'root';
      if (!groups[group]) groups[group] = [];
      groups[group].push(route);
    }
    return groups;
  }, [filteredRoutes]);

  // Auto-expand groups when searching
  useEffect(() => {
    if (search) {
      setExpandedGroups(new Set(Object.keys(groupedRoutes)));
    }
  }, [search, groupedRoutes]);

  // Auto-expand group containing selected route
  useEffect(() => {
    if (selectedRoute) {
      const parts = selectedRoute.path.split('/').filter(Boolean);
      const group = parts[1] || parts[0] || 'root';
      setExpandedGroups(prev => new Set([...prev, group]));
    }
  }, [selectedRoute]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  if (collapsed) {
    return (
      <div className="w-12 border-r border-border bg-bg-secondary flex flex-col items-center py-3 gap-2">
        <button
          onClick={onToggleCollapse}
          className="p-2 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
        <div className="w-6 h-px bg-border my-1" />
        <button
          onClick={() => {
            onToggleCollapse();
            setActiveTab('endpoints');
          }}
          className={`p-2 rounded-lg transition-colors ${
            activeTab === 'endpoints'
              ? 'text-accent bg-accent/10'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
          }`}
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            onToggleCollapse();
            setActiveTab('history');
          }}
          className={`p-2 rounded-lg transition-colors ${
            activeTab === 'history'
              ? 'text-accent bg-accent/10'
              : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
          }`}
        >
          <History className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="w-72 border-r border-border bg-bg-secondary flex flex-col">
      {/* Header */}
      <div className="h-12 p-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary">
            API Explorer
          </span>
        </div>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        <button
          onClick={() => setActiveTab('endpoints')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'endpoints'
              ? 'text-text-primary border-b-2 border-accent'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            Endpoints
            <span className="px-1.5 py-0.5 bg-bg-tertiary rounded text-[10px]">
              {routes.length}
            </span>
          </div>
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'history'
              ? 'text-text-primary border-b-2 border-accent'
              : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <div className="flex items-center justify-center gap-1.5">
            <History className="w-3.5 h-3.5" />
            History
            {history.length > 0 && (
              <span className="px-1.5 py-0.5 bg-bg-tertiary rounded text-[10px]">
                {history.length}
              </span>
            )}
          </div>
        </button>
      </div>

      {/* Search */}
      <div className="p-2 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search endpoints..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-bg-primary border border-border rounded-lg
                     placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent/50"
          />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'endpoints' ? (
          <div className="py-1">
            {Object.entries(groupedRoutes).map(([group, groupRoutes]) => {
              const isExpanded = expandedGroups.has(group);
              return (
                <div key={group} className="border-b border-border/50 last:border-b-0">
                  {/* Group Header - Clickable */}
                  <button
                    onClick={() => toggleGroup(group)}
                    className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-bg-tertiary/50 transition-colors group"
                  >
                    <ChevronRight
                      className={`w-3.5 h-3.5 text-text-muted transition-transform duration-200 ${
                        isExpanded ? 'rotate-90' : ''
                      }`}
                    />
                    <span className="flex-1 text-xs font-semibold text-text-secondary capitalize">
                      {group}
                    </span>
                    <span className="px-1.5 py-0.5 bg-bg-tertiary text-text-muted rounded text-[10px] font-mono">
                      {groupRoutes.length}
                    </span>
                  </button>

                  {/* Endpoints - Collapsible */}
                  {isExpanded && (
                    <div className="pb-1">
                      {groupRoutes.map((route, idx) => (
                        <button
                          key={`${route.method}-${route.path}-${idx}`}
                          onClick={() => onSelectRoute(route)}
                          className={`w-full pl-8 pr-3 py-2 flex items-center gap-2 text-left transition-colors ${
                            selectedRoute === route
                              ? 'bg-accent/10 border-l-2 border-l-accent'
                              : 'hover:bg-bg-tertiary border-l-2 border-l-transparent'
                          }`}
                        >
                          <MethodBadge method={route.method} size="xs" />
                          <span className="flex-1 text-xs font-mono text-text-primary truncate">
                            {route.path}
                          </span>
                          {route.auth && <Lock className="w-3 h-3 text-amber-500" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-1">
            {history.length === 0 ? (
              <div className="p-6 text-center">
                <History className="w-8 h-8 mx-auto mb-2 text-text-muted/30" />
                <p className="text-xs text-text-muted">No requests yet</p>
              </div>
            ) : (
              history.map((item) => (
                <button
                  key={item.id}
                  onClick={() => onSelectHistory(item)}
                  className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-bg-tertiary transition-colors border-l-2 border-l-transparent"
                >
                  <MethodBadge method={item.method} size="xs" />
                  <span className="flex-1 text-xs font-mono text-text-primary truncate">
                    {item.path}
                  </span>
                  <span
                    className={`text-[10px] font-mono ${
                      item.response.status < 400
                        ? 'text-emerald-500'
                        : 'text-red-500'
                    }`}
                  >
                    {item.response.status}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Request Builder
// ============================================================================

function RequestBuilder({
  method,
  path,
  body,
  headers,
  params,
  onMethodChange,
  onPathChange,
  onBodyChange,
  onHeadersChange,
  onParamsChange,
  onSend,
  loading,
  environment,
}: {
  method: string;
  path: string;
  body: string;
  headers: KeyValuePair[];
  params: KeyValuePair[];
  onMethodChange: (method: string) => void;
  onPathChange: (path: string) => void;
  onBodyChange: (body: string) => void;
  onHeadersChange: (headers: KeyValuePair[]) => void;
  onParamsChange: (params: KeyValuePair[]) => void;
  onSend: () => void;
  loading: boolean;
  environment: Environment;
}) {
  const [activeTab, setActiveTab] = useState<'params' | 'headers' | 'body'>(
    'body'
  );
  const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

  // Interpolate environment variables
  const interpolatedPath = useMemo(() => {
    let result = path;
    for (const [key, value] of Object.entries(environment.variables)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }, [path, environment]);

  return (
    <div className="flex flex-col h-full">
      {/* URL Bar */}
      <div className="p-4 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-2">
          {/* Method Selector */}
          <select
            value={method}
            onChange={(e) => onMethodChange(e.target.value)}
            className="px-3 py-2.5 text-xs font-mono font-bold bg-bg-primary border border-border rounded-lg
                     focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent
                     cursor-pointer appearance-none"
            style={{
              color:
                method === 'GET'
                  ? '#059669'
                  : method === 'POST'
                  ? '#2563EB'
                  : method === 'PUT'
                  ? '#D97706'
                  : method === 'PATCH'
                  ? '#7C3AED'
                  : '#DC2626',
            }}
          >
            {methods.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          {/* URL Input */}
          <div className="flex-1 relative">
            <input
              type="text"
              value={path}
              onChange={(e) => onPathChange(e.target.value)}
              placeholder="/api/endpoint"
              className="w-full px-4 py-2.5 text-sm font-mono bg-bg-primary border border-border rounded-lg
                       focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent"
            />
            {path !== interpolatedPath && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-text-muted font-mono">
                {interpolatedPath}
              </div>
            )}
          </div>

          {/* Send Button */}
          <button
            onClick={onSend}
            disabled={loading}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent hover:bg-accent-hover text-white
                     text-sm font-medium rounded-lg transition-all duration-150
                     disabled:opacity-50 disabled:cursor-not-allowed
                     shadow-sm hover:shadow-md active:scale-[0.98]"
          >
            {loading ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Sending
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Send
              </>
            )}
          </button>
        </div>

        {/* Keyboard hint */}
        <div className="mt-2 flex items-center gap-3 text-[10px] text-text-muted">
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-bg-tertiary rounded font-mono">
              ⌘
            </kbd>
            <kbd className="px-1.5 py-0.5 bg-bg-tertiary rounded font-mono">
              ↵
            </kbd>
            <span className="ml-1">Send request</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 bg-bg-tertiary rounded font-mono">
              ⌘
            </kbd>
            <kbd className="px-1.5 py-0.5 bg-bg-tertiary rounded font-mono">
              S
            </kbd>
            <span className="ml-1">Save to collection</span>
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center border-b border-border bg-bg-tertiary/30">
          {[
            { id: 'params', label: 'Params', icon: Settings2 },
            { id: 'headers', label: 'Headers', icon: FileJson },
            { id: 'body', label: 'Body', icon: Code2 },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as 'params' | 'headers' | 'body')}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium transition-colors ${
                activeTab === id
                  ? 'text-accent border-b-2 border-accent bg-bg-secondary'
                  : 'text-text-muted hover:text-text-secondary border-b-2 border-transparent'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
              {id === 'params' && params.length > 0 && (
                <span className="px-1 py-0.5 bg-accent/10 text-accent rounded text-[10px]">
                  {params.filter((p) => p.enabled).length}
                </span>
              )}
              {id === 'headers' && headers.length > 0 && (
                <span className="px-1 py-0.5 bg-accent/10 text-accent rounded text-[10px]">
                  {headers.filter((h) => h.enabled).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4">
          {activeTab === 'params' && (
            <KeyValueEditor
              pairs={params}
              onChange={onParamsChange}
              placeholder={{ key: 'Parameter', value: 'Value' }}
            />
          )}
          {activeTab === 'headers' && (
            <KeyValueEditor
              pairs={headers}
              onChange={onHeadersChange}
              placeholder={{ key: 'Header', value: 'Value' }}
            />
          )}
          {activeTab === 'body' && (
            <div className="h-full">
              <textarea
                value={body}
                onChange={(e) => onBodyChange(e.target.value)}
                placeholder='{\n  "key": "value"\n}'
                className="w-full h-64 p-4 text-sm font-mono bg-bg-primary border border-border rounded-lg
                         resize-none focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent
                         placeholder:text-text-muted"
                spellCheck={false}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Response Viewer
// ============================================================================

function ResponseViewer({
  response,
  loading,
}: {
  response: {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    duration: number;
  } | null;
  loading: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'body' | 'headers' | 'timing'>(
    'body'
  );
  const [copied, setCopied] = useState(false);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 border-3 border-accent/20 border-t-accent rounded-full animate-spin" />
          <p className="text-sm text-text-muted">Sending request...</p>
        </div>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center max-w-xs">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-bg-tertiary flex items-center justify-center">
            <Zap className="w-8 h-8 text-text-muted/30" />
          </div>
          <p className="text-sm text-text-muted mb-1">No response yet</p>
          <p className="text-xs text-text-muted/60">
            Select an endpoint and click Send to make a request
          </p>
        </div>
      </div>
    );
  }

  const handleCopyResponse = () => {
    navigator.clipboard.writeText(JSON.stringify(response.body, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const headerEntries = Object.entries(response.headers || {});

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Response Header */}
      <div className="p-4 border-b border-border bg-bg-secondary flex items-center justify-between">
        <StatusBadge status={response.status} duration={response.duration} />
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyResponse}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-muted
                     hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-500" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            Copy
          </button>
          <button
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-muted
                           hover:text-text-primary hover:bg-bg-tertiary rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Save
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-bg-tertiary/30">
        {[
          { id: 'body', label: 'Body' },
          { id: 'headers', label: `Headers (${headerEntries.length})` },
          { id: 'timing', label: 'Timing' },
        ].map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id as 'body' | 'headers' | 'timing')}
            className={`px-4 py-2.5 text-xs font-medium transition-colors ${
              activeTab === id
                ? 'text-accent border-b-2 border-accent bg-bg-secondary'
                : 'text-text-muted hover:text-text-secondary border-b-2 border-transparent'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'body' && (
          <JSONViewer data={response.body} maxHeight={500} />
        )}
        {activeTab === 'headers' && (
          <div className="space-y-1">
            {headerEntries.map(([key, value]) => (
              <div
                key={key}
                className="flex py-1.5 border-b border-border last:border-0"
              >
                <span className="w-48 text-xs font-mono text-text-muted shrink-0">
                  {key}
                </span>
                <span className="text-xs font-mono text-text-primary break-all">
                  {value}
                </span>
              </div>
            ))}
          </div>
        )}
        {activeTab === 'timing' && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1 h-2 bg-bg-tertiary rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-accent to-emerald-500 rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min(
                      100,
                      (response.duration / 1000) * 100
                    )}%`,
                  }}
                />
              </div>
              <span className="text-sm font-mono font-medium text-text-primary">
                {response.duration.toFixed(0)}ms
              </span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 bg-bg-tertiary/50 rounded-lg">
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
                  Total Time
                </p>
                <p className="text-lg font-mono font-semibold text-text-primary">
                  {response.duration.toFixed(0)}ms
                </p>
              </div>
              <div className="p-4 bg-bg-tertiary/50 rounded-lg">
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
                  Status
                </p>
                <p className="text-lg font-mono font-semibold text-text-primary">
                  {response.status}
                </p>
              </div>
              <div className="p-4 bg-bg-tertiary/50 rounded-lg">
                <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1">
                  Size
                </p>
                <p className="text-lg font-mono font-semibold text-text-primary">
                  {(JSON.stringify(response.body).length / 1024).toFixed(1)}KB
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function ApiExplorer() {
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [selectedRoute, setSelectedRoute] = useState<RouteInfo | null>(null);
  const [sending, setSending] = useState(false);
  const [history, setHistory] =
    useState<RequestHistoryItem[]>(getRequestHistory);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [environments] = useState<Environment[]>(getEnvironments);
  const [currentEnvIndex, setCurrentEnvIndex] = useState(0);

  // Auth state
  const [selectedAuthUser, setSelectedAuthUser] = useState<AuthUser | null>(null);
  const generateToken = useGenerateToken();

  // Request state
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('');
  const [body, setBody] = useState('{\n  \n}');
  const [headers, setHeaders] = useState<KeyValuePair[]>([
    { key: 'Content-Type', value: 'application/json', enabled: true },
  ]);
  const [params, setParams] = useState<KeyValuePair[]>([]);
  const [response, setResponse] = useState<{
    status: number;
    headers: Record<string, string>;
    body: unknown;
    duration: number;
  } | null>(null);

  // Handle auth user selection - generate token and add to headers
  const handleSelectAuthUser = async (user: AuthUser) => {
    try {
      const result = await generateToken.mutateAsync({ userId: user.id, expiresIn: 7 * 24 * 60 * 60 });
      setSelectedAuthUser(user);

      // Update headers with Authorization
      setHeaders((prev) => {
        const filtered = prev.filter((h) => h.key.toLowerCase() !== 'authorization');
        return [
          ...filtered,
          { key: 'Authorization', value: `Bearer ${result.token}`, enabled: true },
        ];
      });
    } catch (error) {
      console.error('Failed to generate token:', error);
    }
  };

  // Handle clearing auth
  const handleClearAuth = () => {
    setSelectedAuthUser(null);
    setHeaders((prev) => prev.filter((h) => h.key.toLowerCase() !== 'authorization'));
  };

  // Load routes
  useEffect(() => {
    api
      .getRoutes()
      .then(setRoutes)
      .catch(() => setRoutes([]));
  }, []);

  // Update request when route selected
  useEffect(() => {
    if (selectedRoute) {
      setMethod(selectedRoute.method);
      setPath(selectedRoute.path);
      setBody('{\n  \n}');
      setResponse(null);
    }
  }, [selectedRoute]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        sendRequest();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [method, path, body, headers]);

  const sendRequest = async () => {
    if (!path) return;
    setSending(true);
    try {
      const headerObj: Record<string, string> = {};
      for (const h of headers.filter((h) => h.enabled && h.key)) {
        headerObj[h.key] = h.value;
      }

      const result = await api.sendRequest(
        method,
        path,
        method !== 'GET' && method !== 'DELETE' ? JSON.parse(body) : undefined,
        headerObj
      );

      setResponse({
        status: result.status,
        headers: result.headers,
        body: result.body,
        duration: result.duration,
      });

      // Add to history
      const historyItem: RequestHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        method,
        path,
        body: method !== 'GET' && method !== 'DELETE' ? body : undefined,
        headers: headerObj,
        response: {
          status: result.status,
          headers: result.headers,
          body: result.body,
          duration: result.duration,
        },
        timestamp: Date.now(),
      };
      const newHistory = [historyItem, ...history].slice(0, 100);
      setHistory(newHistory);
      saveRequestHistory(newHistory);
    } catch (error) {
      setResponse({
        status: 0,
        headers: {},
        body: {
          error: error instanceof Error ? error.message : 'Request failed',
        },
        duration: 0,
      });
    } finally {
      setSending(false);
    }
  };

  const handleSelectHistory = (item: RequestHistoryItem) => {
    setMethod(item.method);
    setPath(item.path);
    if (item.body) setBody(item.body);
    setResponse(item.response);
  };

  return (
    <div className="h-full flex bg-bg-primary">
      {/* Sidebar */}
      <EndpointSidebar
        routes={routes}
        selectedRoute={selectedRoute}
        onSelectRoute={setSelectedRoute}
        history={history}
        onSelectHistory={handleSelectHistory}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />

      {/* Main Content - Split View */}
      <div className="flex-1 flex">
        {/* Request Builder */}
        <div className="flex-1 flex flex-col border-r border-border">
          {/* Environment Selector */}
          <div className="px-4 py-2 border-b border-border bg-bg-wash flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="w-3.5 h-3.5 text-text-muted" />
              <select
                value={currentEnvIndex}
                onChange={(e) => setCurrentEnvIndex(Number(e.target.value))}
                className="text-xs font-medium bg-transparent border-none focus:outline-none cursor-pointer"
              >
                {environments.map((env, idx) => (
                  <option key={idx} value={idx}>
                    {env.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <div className="text-[10px] font-mono text-text-muted">
                {environments[currentEnvIndex]?.variables?.baseUrl}
              </div>
              <AuthUserDropdown
                selectedUser={selectedAuthUser}
                onSelectUser={handleSelectAuthUser}
                onClearAuth={handleClearAuth}
                isGenerating={generateToken.isPending}
              />
            </div>
          </div>

          <RequestBuilder
            method={method}
            path={path}
            body={body}
            headers={headers}
            params={params}
            onMethodChange={setMethod}
            onPathChange={setPath}
            onBodyChange={setBody}
            onHeadersChange={setHeaders}
            onParamsChange={setParams}
            onSend={sendRequest}
            loading={sending}
            environment={environments[currentEnvIndex]}
          />
        </div>

        {/* Response Viewer */}
        <div className="flex-1 flex flex-col bg-bg-secondary">
          <ResponseViewer response={response} loading={sending} />
        </div>
      </div>
    </div>
  );
}
