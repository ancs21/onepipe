import { useCallback, useMemo } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { sql, PostgreSQL } from '@codemirror/lang-sql'
import { EditorView } from '@codemirror/view'

interface SQLEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  readOnly?: boolean
  height?: string
  schema?: Record<string, string[]> // tableName -> columnNames
}

// Custom theme to match dashboard design
const editorTheme = EditorView.theme({
  '&': {
    fontSize: '13px',
    backgroundColor: 'rgb(var(--bg-secondary))',
  },
  '.cm-content': {
    fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
    padding: '12px 0',
  },
  '.cm-line': {
    padding: '0 12px',
  },
  '.cm-gutters': {
    backgroundColor: 'rgb(var(--bg-tertiary))',
    borderRight: '1px solid rgb(var(--border))',
    color: 'rgb(var(--text-muted))',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgb(var(--bg-tertiary))',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgb(var(--accent) / 0.05)',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'rgb(var(--accent))',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'rgb(var(--accent) / 0.15)',
  },
  '.cm-placeholder': {
    color: 'rgb(var(--text-muted))',
    fontStyle: 'italic',
  },
  '.cm-scroller': {
    overflow: 'auto',
  },
})

// SQL syntax highlighting colors
const syntaxHighlighting = EditorView.theme({
  '.cm-keyword': { color: '#7C3AED' }, // purple for keywords
  '.cm-string': { color: '#059669' }, // green for strings
  '.cm-number': { color: '#D97706' }, // amber for numbers
  '.cm-operator': { color: '#525049' }, // gray for operators
  '.cm-comment': { color: '#9C9891', fontStyle: 'italic' },
  '.cm-variableName': { color: '#2563EB' }, // blue for identifiers
  '.cm-propertyName': { color: '#2563EB' },
  '.cm-typeName': { color: '#DC2626' }, // red for types
  '.cm-punctuation': { color: '#525049' },
})

export function SQLEditor({
  value,
  onChange,
  placeholder = 'SELECT * FROM table_name LIMIT 100',
  readOnly = false,
  height = '120px',
  schema = {},
}: SQLEditorProps) {
  const handleChange = useCallback(
    (val: string) => {
      onChange(val)
    },
    [onChange]
  )

  // Configure SQL completion with schema
  const sqlExtension = useMemo(() => {
    return sql({
      dialect: PostgreSQL,
      schema: schema,
      upperCaseKeywords: true,
    })
  }, [schema])

  const extensions = useMemo(
    () => [
      sqlExtension,
      editorTheme,
      syntaxHighlighting,
      EditorView.lineWrapping,
    ],
    [sqlExtension]
  )

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <CodeMirror
        value={value}
        height={height}
        extensions={extensions}
        onChange={handleChange}
        placeholder={placeholder}
        readOnly={readOnly}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          foldGutter: false,
          dropCursor: false,
          allowMultipleSelections: false,
          indentOnInput: true,
          syntaxHighlighting: true,
          highlightSelectionMatches: true,
          searchKeymap: true,
          tabSize: 2,
        }}
      />
    </div>
  )
}
