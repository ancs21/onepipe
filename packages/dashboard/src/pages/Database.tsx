import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import {
  Database as DatabaseIcon,
  Table,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Play,
  Key,
  AlertCircle,
  Search,
  Copy,
  Download,
  Check,
  Zap,
  Grid3X3,
  Code2,
  Layers,
  Command,
} from 'lucide-react';
import {
  useDatabases,
  useTables,
  useTableSchema,
  useExecuteQuery,
  useTablePreview,
} from '../lib/db';
import {
  DatabaseSchemaNode,
  type DatabaseSchemaNodeData,
  type SchemaColumn,
  type DatabaseSchemaNodeType,
} from '../components/DatabaseSchemaNode';
import { SQLEditor } from '../components/SQLEditor';
import type { DatabaseInfo, TableInfo, ColumnInfo } from '../lib/types';

// ============================================================================
// Types
// ============================================================================

type TabType = 'visual' | 'data' | 'query';

// ============================================================================
// Node Types for React Flow
// ============================================================================

const nodeTypes = {
  databaseSchema: DatabaseSchemaNode,
} satisfies Record<
  string,
  React.ComponentType<NodeProps<DatabaseSchemaNodeType>>
>;

// ============================================================================
// Utility Functions
// ============================================================================

function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

function exportToCsv(rows: Record<string, unknown>[], tableName: string) {
  if (rows.length === 0) return;

  const headers = Object.keys(rows[0]);
  const csvContent = [
    headers.join(','),
    ...rows.map((row) =>
      headers
        .map((h) => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          if (typeof val === 'string') return `"${val.replace(/"/g, '""')}"`;
          return String(val);
        })
        .join(',')
    ),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${tableName}_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// ============================================================================
// Sidebar Components
// ============================================================================

function DatabaseTreeItem({
  db,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  children,
}: {
  db: DatabaseInfo;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  const typeColors: Record<string, string> = {
    postgres: 'text-blue-500 dark:text-blue-400',
    mysql: 'text-orange-500 dark:text-orange-400',
    sqlite: 'text-emerald-500 dark:text-emerald-400',
  };

  return (
    <div>
      <button
        onClick={() => {
          onToggle();
          onSelect();
        }}
        className={`
          w-full flex items-center gap-2 px-3 py-2 text-left text-sm
          transition-colors group
          ${
            isSelected
              ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
              : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
          }
        `}
      >
        {isExpanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
        )}
        <DatabaseIcon
          className={`w-4 h-4 ${typeColors[db.type] || 'text-text-muted'}`}
        />
        <span className="font-mono font-medium truncate">{db.name}</span>
        <span className="ml-auto text-2xs text-text-muted uppercase">
          {db.type}
        </span>
      </button>
      {isExpanded && children && (
        <div className="ml-5 border-l border-border">{children}</div>
      )}
    </div>
  );
}

function TableTreeItem({
  table,
  isSelected,
  onSelect,
}: {
  table: TableInfo;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`
        w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm
        transition-colors
        ${
          isSelected
            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
            : 'text-text-muted hover:text-text-primary hover:bg-bg-tertiary'
        }
      `}
    >
      <Table className="w-3.5 h-3.5" />
      <span className="font-mono truncate">{table.name}</span>
      {table.type === 'view' && (
        <span className="ml-auto text-2xs px-1.5 py-0.5 bg-bg-tertiary text-text-muted rounded">
          view
        </span>
      )}
    </button>
  );
}

function DatabaseSidebar({
  databases,
  tables,
  selectedDb,
  selectedTable,
  searchQuery,
  onSearchChange,
  onSelectDb,
  onSelectTable,
  expandedDbs,
  onToggleDb,
}: {
  databases: DatabaseInfo[];
  tables: TableInfo[];
  selectedDb: string | null;
  selectedTable: string | null;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onSelectDb: (db: string) => void;
  onSelectTable: (table: string) => void;
  expandedDbs: Set<string>;
  onToggleDb: (db: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filter tables by search
  const filteredTables = useMemo(() => {
    const tableList = Array.isArray(tables) ? tables : [];
    if (!searchQuery) return tableList;
    const query = searchQuery.toLowerCase();
    return tableList.filter((t) => t.name.toLowerCase().includes(query));
  }, [tables, searchQuery]);

  return (
    <div className="h-full flex flex-col bg-bg-secondary border-r border-border">
      {/* Search */}
      <div className="p-3 border-b border-border">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          <input
            ref={searchRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tables..."
            className="w-full pl-9 pr-10 py-2 text-sm bg-bg-primary border border-border rounded-lg
                     text-text-primary placeholder:text-text-muted
                     focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/20
                     font-mono transition-colors"
          />
          <kbd
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 text-2xs
                        text-text-muted bg-bg-tertiary rounded border border-border"
          >
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {databases.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <DatabaseIcon className="w-10 h-10 mx-auto mb-3 text-text-muted/30" />
            <p className="text-sm text-text-muted">No databases</p>
            <p className="text-xs text-text-muted/60 mt-1">
              Use DB.create() to register
            </p>
          </div>
        ) : (
          databases.map((db) => (
            <DatabaseTreeItem
              key={db.name}
              db={db}
              isExpanded={expandedDbs.has(db.name)}
              isSelected={selectedDb === db.name && !selectedTable}
              onToggle={() => onToggleDb(db.name)}
              onSelect={() => onSelectDb(db.name)}
            >
              {selectedDb === db.name &&
                filteredTables.map((table) => (
                  <TableTreeItem
                    key={table.name}
                    table={table}
                    isSelected={selectedTable === table.name}
                    onSelect={() => onSelectTable(table.name)}
                  />
                ))}
            </DatabaseTreeItem>
          ))
        )}
      </div>

      {/* Stats footer */}
      <div className="px-4 py-3 border-t border-border text-xs text-text-muted">
        <div className="flex items-center justify-between">
          <span>
            {databases.length} database{databases.length !== 1 ? 's' : ''}
          </span>
          <span>
            {tables.length} table{tables.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Tab Bar
// ============================================================================

function TabBar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabType;
  onTabChange: (tab: TabType) => void;
}) {
  const tabs: {
    id: TabType;
    label: string;
    icon: typeof Layers;
    shortcut: string;
  }[] = [
    { id: 'visual', label: 'Schema', icon: Layers, shortcut: '1' },
    { id: 'data', label: 'Data', icon: Grid3X3, shortcut: '2' },
    { id: 'query', label: 'Query', icon: Code2, shortcut: '3' },
  ];

  // Keyboard shortcuts for tabs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;
      if (e.key === '1') onTabChange('visual');
      if (e.key === '2') onTabChange('data');
      if (e.key === '3') onTabChange('query');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onTabChange]);

  return (
    <div className="flex gap-1 p-1 bg-bg-tertiary rounded-lg">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`
              flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md
              transition-all duration-150
              ${
                activeTab === tab.id
                  ? 'bg-bg-secondary text-amber-600 dark:text-amber-400 shadow-sm'
                  : 'text-text-muted hover:text-text-primary hover:bg-bg-secondary/50'
              }
            `}
          >
            <Icon className="w-4 h-4" />
            {tab.label}
            <kbd className="ml-1 px-1 py-0.5 text-2xs bg-bg-primary text-text-muted rounded">
              {tab.shortcut}
            </kbd>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Schema Tab (Visual)
// ============================================================================

function SchemaTab({
  tables,
  dbName,
}: {
  tables: TableInfo[];
  dbName: string;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<
    Node<DatabaseSchemaNodeData>
  >([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    if (tables.length === 0) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const fetchAllSchemas = async () => {
      const schemaPromises = tables.map(async (table) => {
        try {
          const response = await fetch(
            `/api/dashboard/databases/${encodeURIComponent(
              dbName
            )}/tables/${encodeURIComponent(table.name)}`
          );
          const columns: ColumnInfo[] = await response.json();
          return { table, columns };
        } catch {
          return { table, columns: [] };
        }
      });

      const results = await Promise.all(schemaPromises);

      // Create dagre layout
      const dagreGraph = new dagre.graphlib.Graph();
      dagreGraph.setDefaultEdgeLabel(() => ({}));
      dagreGraph.setGraph({ rankdir: 'LR', nodesep: 80, ranksep: 150 });

      results.forEach(({ table, columns }) => {
        const height = Math.max(80, 48 + columns.length * 28);
        dagreGraph.setNode(table.name, { width: 260, height });
      });

      dagre.layout(dagreGraph);

      const newNodes: Node<DatabaseSchemaNodeData>[] = results.map(
        ({ table, columns }) => {
          const nodePos = dagreGraph.node(table.name);
          return {
            id: table.name,
            type: 'databaseSchema',
            position: {
              x: nodePos.x - 130,
              y: nodePos.y - (24 + columns.length * 14),
            },
            data: {
              label: table.name,
              type: table.type,
              schema: columns.map(
                (col): SchemaColumn => ({
                  name: col.name,
                  type: col.type,
                  nullable: col.nullable,
                  primaryKey: col.primaryKey,
                })
              ),
            },
          };
        }
      );

      // Detect relationships
      const newEdges: Edge[] = [];
      results.forEach(({ table, columns }) => {
        columns.forEach((col) => {
          if (col.name.endsWith('_id') && !col.primaryKey) {
            const possibleTable = col.name.replace(/_id$/, '');
            const targetTable = tables.find(
              (t) => t.name === possibleTable || t.name === `${possibleTable}s`
            );
            if (targetTable) {
              newEdges.push({
                id: `${table.name}-${col.name}-${targetTable.name}`,
                source: table.name,
                sourceHandle: `${col.name}-source`,
                target: targetTable.name,
                targetHandle: 'id-target',
                type: 'smoothstep',
                animated: true,
                style: { stroke: '#f59e0b', strokeWidth: 2 },
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  color: '#f59e0b',
                },
              });
            }
          }
        });
      });

      setNodes(newNodes);
      setEdges(newEdges);
    };

    fetchAllSchemas();
  }, [tables, dbName, setNodes, setEdges]);

  if (tables.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Layers className="w-12 h-12 mx-auto mb-4 text-text-muted/30" />
          <p className="text-text-muted">No tables to visualize</p>
          <p className="text-sm text-text-muted/60 mt-1">
            Select a database with tables
          </p>
        </div>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      attributionPosition="bottom-left"
      minZoom={0.3}
      maxZoom={1.5}
      className="bg-bg-primary"
    >
      <Background color="rgb(var(--border))" gap={24} size={1} />
      <Controls className="!bg-bg-secondary !border-border !shadow-lg [&>button]:!bg-bg-tertiary [&>button]:!border-border [&>button]:!text-text-muted [&>button:hover]:!bg-bg-elevated" />
    </ReactFlow>
  );
}

// ============================================================================
// Data Tab
// ============================================================================

function DataTab({
  dbName,
  tableName,
  schema,
}: {
  dbName: string;
  tableName: string | null;
  schema: ColumnInfo[];
}) {
  const { data: previewData, isLoading } = useTablePreview(dbName, tableName);
  const [copiedRow, setCopiedRow] = useState<number | null>(null);

  const handleCopyRow = async (row: Record<string, unknown>, index: number) => {
    await copyToClipboard(JSON.stringify(row, null, 2));
    setCopiedRow(index);
    setTimeout(() => setCopiedRow(null), 2000);
  };

  const handleExportCsv = () => {
    if (previewData?.rows && tableName) {
      exportToCsv(previewData.rows, tableName);
    }
  };

  if (!tableName) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Grid3X3 className="w-12 h-12 mx-auto mb-4 text-text-muted/30" />
          <p className="text-text-muted">Select a table to view data</p>
          <p className="text-sm text-text-muted/60 mt-1">
            Data preview shows first 10 rows
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="w-6 h-6 text-amber-500 animate-spin" />
      </div>
    );
  }

  const rows = previewData?.rows || [];
  const error = previewData?.error;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-secondary">
        <div className="flex items-center gap-3">
          <Table className="w-4 h-4 text-amber-500" />
          <span className="font-mono text-sm text-text-primary">
            {tableName}
          </span>
          <span className="text-xs text-text-muted">
            ({schema.length} columns)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {rows.length > 0 && (
            <button
              onClick={handleExportCsv}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-text-muted
                       hover:text-text-primary bg-bg-tertiary hover:bg-border-hover rounded-md
                       transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      {/* Schema bar */}
      <div className="px-4 py-2 border-b border-border-subtle bg-bg-wash">
        <div className="flex flex-wrap gap-2">
          {schema.map((col) => (
            <div
              key={col.name}
              className="flex items-center gap-1.5 px-2 py-1 bg-bg-tertiary rounded text-xs"
            >
              {col.primaryKey && <Key className="w-3 h-3 text-amber-500" />}
              <span className="font-mono text-text-secondary">{col.name}</span>
              <span className="text-text-muted">{col.type}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="m-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Data grid */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <p className="text-sm text-text-muted">No data in this table</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-bg-secondary/95 backdrop-blur-sm">
              <tr className="border-b border-border">
                <th className="w-10 px-2 py-2 text-center text-xs font-medium text-text-muted">
                  #
                </th>
                {Object.keys(rows[0]).map((key) => (
                  <th
                    key={key}
                    className="px-3 py-2 text-left text-xs font-mono font-medium text-text-muted
                             whitespace-nowrap"
                  >
                    {key}
                  </th>
                ))}
                <th className="w-10 px-2 py-2 text-center text-xs font-medium text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-border-subtle hover:bg-bg-tertiary group"
                >
                  <td className="px-2 py-2 text-center text-xs text-text-muted">
                    {i + 1}
                  </td>
                  {Object.values(row).map((value, j) => (
                    <td
                      key={j}
                      className="px-3 py-2 font-mono text-xs text-text-primary whitespace-nowrap max-w-xs truncate"
                    >
                      {value === null ? (
                        <span className="text-text-muted italic">null</span>
                      ) : typeof value === 'object' ? (
                        <span className="text-amber-600 dark:text-amber-400/80">
                          {JSON.stringify(value)}
                        </span>
                      ) : typeof value === 'boolean' ? (
                        <span
                          className={
                            value
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-red-600 dark:text-red-400'
                          }
                        >
                          {String(value)}
                        </span>
                      ) : (
                        String(value)
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center">
                    <button
                      onClick={() => handleCopyRow(row, i)}
                      className="p-1.5 text-text-muted hover:text-amber-500 opacity-0 group-hover:opacity-100
                               transition-all rounded hover:bg-bg-tertiary"
                      title="Copy as JSON (⌘⇧C)"
                    >
                      {copiedRow === i ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border bg-bg-secondary text-xs text-text-muted">
        Showing {rows.length} row{rows.length !== 1 ? 's' : ''} (preview)
      </div>
    </div>
  );
}

// ============================================================================
// Query Tab
// ============================================================================

function QueryTab({
  dbName,
  tableName,
  tables,
  schema,
}: {
  dbName: string;
  tableName: string | null;
  tables: TableInfo[];
  schema: ColumnInfo[];
}) {
  const defaultQuery = tableName
    ? `SELECT * FROM "${tableName}" LIMIT 100`
    : '';
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<Record<string, unknown>[] | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [executionTime, setExecutionTime] = useState<number | null>(null);
  const executeQuery = useExecuteQuery(dbName);

  // Update default query when table changes
  useEffect(() => {
    if (tableName) {
      setQuery(`SELECT * FROM "${tableName}" LIMIT 100`);
    }
  }, [tableName]);

  // Build schema for autocomplete
  const editorSchema = useMemo(() => {
    const schemaObj: Record<string, string[]> = {};
    tables.forEach((table) => {
      schemaObj[table.name] = [];
    });
    if (tableName && schema.length > 0) {
      schemaObj[tableName] = schema.map((col) => col.name);
    }
    return schemaObj;
  }, [tables, tableName, schema]);

  const handleExecute = useCallback(async () => {
    setError(null);
    setResults(null);
    setExecutionTime(null);

    const sqlToRun = query.trim();
    if (!sqlToRun) return;

    const start = performance.now();
    try {
      const result = await executeQuery.mutateAsync(sqlToRun);
      setExecutionTime(performance.now() - start);
      if (result.error) {
        setError(result.error);
      } else {
        setResults(result.rows);
      }
    } catch (e) {
      setExecutionTime(performance.now() - start);
      setError(e instanceof Error ? e.message : 'Query failed');
    }
  }, [query, executeQuery]);

  // CMD+Enter to execute
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleExecute();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleExecute]);

  const handleExportResults = () => {
    if (results && tableName) {
      exportToCsv(results, `${tableName}_query`);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Editor */}
      <div className="border-b border-border">
        <div className="p-3 flex items-center justify-between bg-bg-secondary">
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Code2 className="w-4 h-4" />
            <span>SQL Editor</span>
            {executionTime !== null && (
              <span className="px-2 py-0.5 bg-bg-tertiary rounded-full text-text-secondary">
                <Zap className="w-3 h-3 inline mr-1" />
                {executionTime.toFixed(0)}ms
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs text-text-muted">
              <kbd className="px-1.5 py-0.5 bg-bg-tertiary rounded border border-border">
                ⌘
              </kbd>
              <kbd className="px-1.5 py-0.5 bg-bg-tertiary rounded border border-border">
                ↵
              </kbd>
              <span className="ml-1">to run</span>
            </div>
          </div>
        </div>
        <div className="relative">
          <SQLEditor
            value={query}
            onChange={setQuery}
            placeholder="SELECT * FROM table_name LIMIT 100"
            height="200px"
            schema={editorSchema}
          />
          <button
            onClick={handleExecute}
            disabled={executeQuery.isPending || !query.trim()}
            className="absolute bottom-4 right-4 flex items-center gap-1.5 px-4 py-2 text-sm
                     font-medium bg-amber-500 text-black rounded-lg hover:bg-amber-400
                     disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
          >
            <Play className="w-4 h-4" />
            {executeQuery.isPending ? 'Running...' : 'Run Query'}
          </button>
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {error && (
          <div className="m-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
            <div className="flex items-start gap-2 text-red-600 dark:text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          </div>
        )}

        {results && (
          <>
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-bg-secondary">
              <span className="text-xs text-text-muted">
                {results.length} row{results.length !== 1 ? 's' : ''} returned
              </span>
              {results.length > 0 && (
                <button
                  onClick={handleExportResults}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted
                           hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                >
                  <Download className="w-3 h-3" />
                  Export
                </button>
              )}
            </div>
            <div className="flex-1 overflow-auto">
              {results.length === 0 ? (
                <div className="h-full flex items-center justify-center text-text-muted text-sm">
                  Query returned no results
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-bg-secondary/95 backdrop-blur-sm">
                    <tr className="border-b border-border">
                      {Object.keys(results[0]).map((key) => (
                        <th
                          key={key}
                          className="px-3 py-2 text-left text-xs font-mono font-medium text-text-muted
                                   whitespace-nowrap"
                        >
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row, i) => (
                      <tr
                        key={i}
                        className="border-b border-border-subtle hover:bg-bg-tertiary"
                      >
                        {Object.values(row).map((value, j) => (
                          <td
                            key={j}
                            className="px-3 py-2 font-mono text-xs text-text-primary whitespace-nowrap"
                          >
                            {value === null ? (
                              <span className="text-text-muted italic">
                                null
                              </span>
                            ) : typeof value === 'object' ? (
                              <span className="text-amber-600 dark:text-amber-400/80">
                                {JSON.stringify(value)}
                              </span>
                            ) : (
                              String(value)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}

        {!results && !error && (
          <div className="flex-1 flex items-center justify-center text-text-muted">
            <div className="text-center">
              <Code2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Run a query to see results</p>
              <p className="text-xs mt-1">Only SELECT queries are allowed</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Status Bar
// ============================================================================

function StatusBar({
  selectedDb,
  selectedTable,
  isConnected,
}: {
  selectedDb: string | null;
  selectedTable: string | null;
  isConnected: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between px-4 py-2 bg-bg-secondary border-t border-border
                  text-xs text-text-muted"
    >
      <div className="flex items-center gap-4">
        {/* Connection status */}
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? 'bg-emerald-500' : 'bg-text-muted'
            }`}
          />
          <span>{isConnected ? 'Connected' : 'Disconnected'}</span>
        </div>

        {/* Current selection */}
        {selectedDb && (
          <>
            <span className="text-border">•</span>
            <div className="flex items-center gap-1.5">
              <DatabaseIcon className="w-3 h-3" />
              <span className="font-mono">{selectedDb}</span>
            </div>
          </>
        )}
        {selectedTable && (
          <>
            <span className="text-border">/</span>
            <div className="flex items-center gap-1.5">
              <Table className="w-3 h-3 text-amber-500" />
              <span className="font-mono text-amber-600 dark:text-amber-400">
                {selectedTable}
              </span>
            </div>
          </>
        )}
      </div>

      {/* Keyboard shortcuts */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Command className="w-3 h-3" />
          <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-2xs">K</kbd>
          <span>search</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Command className="w-3 h-3" />
          <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-2xs">↵</kbd>
          <span>run</span>
        </div>
        <div className="flex items-center gap-1.5">
          <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-2xs">1</kbd>
          <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-2xs">2</kbd>
          <kbd className="px-1 py-0.5 bg-bg-tertiary rounded text-2xs">3</kbd>
          <span>tabs</span>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main Database Component
// ============================================================================

export function Database() {
  const { data: databases = [], isLoading, error, refetch } = useDatabases();
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('data');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDbs, setExpandedDbs] = useState<Set<string>>(new Set());

  const { data: tablesData } = useTables(selectedDb);
  const { data: schemaData } = useTableSchema(selectedDb, selectedTable);

  // Ensure tables and schema are always arrays (API might return object on error)
  const tables = Array.isArray(tablesData) ? tablesData : [];
  const schema = Array.isArray(schemaData) ? schemaData : [];

  // Auto-select and expand first database
  useEffect(() => {
    if (databases.length > 0 && !selectedDb) {
      setSelectedDb(databases[0].name);
      setExpandedDbs(new Set([databases[0].name]));
    }
  }, [databases, selectedDb]);

  // Reset table selection when database changes
  useEffect(() => {
    setSelectedTable(null);
  }, [selectedDb]);

  const handleToggleDb = (dbName: string) => {
    setExpandedDbs((prev) => {
      const next = new Set(prev);
      if (next.has(dbName)) {
        next.delete(dbName);
      } else {
        next.add(dbName);
      }
      return next;
    });
  };

  const handleSelectTable = (tableName: string) => {
    setSelectedTable(tableName);
    setActiveTab('data'); // Switch to data tab when selecting a table
  };

  return (
    <div className="h-full flex flex-col bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-6 h-12 border-b border-border">
        <h1 className="font-semibold text-text-primary">Database Explorer</h1>

        <div className="flex items-center gap-3">
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} />
          <div className="w-px h-8 bg-border" />
          <button
            onClick={() => refetch()}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-text-muted
                     hover:text-text-primary bg-bg-secondary hover:bg-bg-tertiary rounded-lg
                     border border-border transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-6 mt-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            <span>Failed to load databases</span>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-64 flex-shrink-0">
          <DatabaseSidebar
            databases={databases}
            tables={tables}
            selectedDb={selectedDb}
            selectedTable={selectedTable}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSelectDb={setSelectedDb}
            onSelectTable={handleSelectTable}
            expandedDbs={expandedDbs}
            onToggleDb={handleToggleDb}
          />
        </div>

        {/* Main Area */}
        <div className="flex-1 overflow-hidden border-l border-border">
          {!selectedDb ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center">
                <DatabaseIcon className="w-16 h-16 mx-auto mb-4 text-text-muted/20" />
                <p className="text-text-muted">Select a database to explore</p>
              </div>
            </div>
          ) : activeTab === 'visual' ? (
            <SchemaTab tables={tables} dbName={selectedDb} />
          ) : activeTab === 'data' ? (
            <DataTab
              dbName={selectedDb}
              tableName={selectedTable}
              schema={schema}
            />
          ) : (
            <QueryTab
              dbName={selectedDb}
              tableName={selectedTable}
              tables={tables}
              schema={schema}
            />
          )}
        </div>
      </div>

      {/* Status Bar */}
      <StatusBar
        selectedDb={selectedDb}
        selectedTable={selectedTable}
        isConnected={databases.length > 0}
      />
    </div>
  );
}
