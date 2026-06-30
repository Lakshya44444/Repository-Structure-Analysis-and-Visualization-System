import { useState } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { langColor } from "../graph";

const PRISM_LANG = {
  python: "python",
  javascript: "javascript",
  typescript: "typescript",
  c: "c",
  cpp: "cpp",
  java: "java",
  go: "go",
  ruby: "ruby",
  rust: "rust",
};

export default function SidePanel({
  node, neighbors, summary, loading, error, code, codeLoading,
  onSummarize, onRefresh, onClose, onFocusNode, width,
}) {
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied]     = useState(false);

  const panelStyle = width ? { width } : {};

  if (!node) {
    return (
      <aside className="side-panel side-panel--empty" style={panelStyle}>
        <p className="hint">
          Select a file node on the canvas to view its metrics,
          dependencies, and AI-generated explanation.
        </p>
      </aside>
    );
  }

  const d = node.data;
  const imports    = neighbors?.imports    || [];
  const importedBy = neighbors?.importedBy || [];

  const handleCopy = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const badgeClass =
    !summary              ? ""
    : summary.provider === "offline" ? "badge--offline"
    : summary.cached      ? "badge--cached"
    : "badge--fresh";

  return (
    <aside className="side-panel" style={panelStyle}>
      <div className="side-panel__header">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span
              className="lang-dot"
              style={{ background: langColor(d.language), width: 9, height: 9, flexShrink: 0 }}
            />
            <h2 title={node.id}>{d.label}</h2>
          </div>
          <div className="path" title={node.id}>{node.id}</div>
        </div>
        <button className="icon-btn" onClick={onClose} title="Close" style={{ fontSize: 20 }}>
          &times;
        </button>
      </div>

      <div className="side-panel__content">

        {d.inCycle && (
          <div className="alert alert--cycle">
            This file is part of a circular dependency.
          </div>
        )}

        <div>
          <div className="panel-section-title">Metrics</div>
          <div className="metrics">
            <Metric label="Language" value={d.language || "text"} />
            <Metric label="Lines of code" value={d.loc.toLocaleString()} />
            <Metric label="Complexity" value={d.complexity} accent={d.complexity > 20 ? "warn" : null} />
            <Metric label="Hotspot" value={`${(d.hotspot * 100).toFixed(0)}%`} accent={d.hotspot > 0.5 ? "warn" : null} />
            <Metric label="Git churn" value={`${d.churn} commits`} />
            <Metric label="Coupling" value={`${d.fanIn} in / ${d.fanOut} out`} />
          </div>
        </div>

        {(imports.length > 0 || importedBy.length > 0) && (
          <div>
            <div className="panel-section-title">Dependencies</div>
            <div className="deps">
              <DepList title={`Imports (${imports.length})`} items={imports} onFocusNode={onFocusNode} />
              <DepList title={`Used by (${importedBy.length})`} items={importedBy} onFocusNode={onFocusNode} />
            </div>
          </div>
        )}

        <div className="ai-section">
          <div className="ai-section__head">
            <h3>AI Summary</h3>
            {summary && (
              <span className={`badge ${badgeClass}`}>
                {summary.provider}{summary.cached ? " - cached" : ""}
              </span>
            )}
          </div>

          {loading && <div className="loading">Analyzing file...</div>}
          {error && <div className="error">{error}</div>}

          {!loading && !summary && !error && (
            <button className="primary-btn" onClick={onSummarize} id="btn-summarize">
              Explain this file
            </button>
          )}

          {summary && (
            <div className="summary-box">
              <p className="summary-text">{summary.summary}</p>
              {summary.fallback_reason && (
                <p className="fallback-note">Fell back to offline summary: {summary.fallback_reason}</p>
              )}
              <button
                className="ghost-btn"
                onClick={onRefresh}
                disabled={loading}
                style={{ marginTop: 10 }}
              >
                Re-analyze (bypass cache)
              </button>
            </div>
          )}
        </div>

        <div className="code-section">
          <div className="code-section__header">
            <span className="code-section__title">Source</span>
            {showCode && code && (
              <button
                className={`code-copy-btn${copied ? " copied" : ""}`}
                onClick={handleCopy}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            )}
          </div>
          <button className="ghost-btn full" onClick={() => setShowCode((s) => !s)}>
            {showCode ? "Hide source" : "View source"}
          </button>
          {showCode && (
            codeLoading
              ? <div className="loading">Loading source...</div>
              : (
                <SyntaxHighlighter
                  language={PRISM_LANG[d.language] || "text"}
                  style={oneLight}
                  showLineNumbers
                  customStyle={{
                    margin: 0,
                    borderRadius: 6,
                    fontSize: 11.5,
                    maxHeight: 340,
                    border: "1px solid #e5e7eb",
                  }}
                >
                  {code || "// (empty or binary file)"}
                </SyntaxHighlighter>
              )
          )}
        </div>
      </div>
    </aside>
  );
}

function Metric({ label, value, accent }) {
  const cls = accent === "warn" ? "accent-warn" : accent === "danger" ? "accent-danger" : "";
  return (
    <div className="metric">
      <span className="metric__label">{label}</span>
      <span className={`metric__value ${cls}`}>{value}</span>
    </div>
  );
}

function DepList({ title, items, onFocusNode }) {
  if (!items.length) return null;
  return (
    <div className="dep-list">
      <div className="dep-list__title">{title}</div>
      <ul>
        {items.slice(0, 10).map((it) => (
          <li key={it} title={it} onClick={() => onFocusNode?.(it)}>
            {it.split("/").pop()}
          </li>
        ))}
        {items.length > 10 && (
          <li className="muted">+{items.length - 10} more</li>
        )}
      </ul>
    </div>
  );
}
