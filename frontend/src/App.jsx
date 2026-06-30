import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
} from "reactflow";
import { toPng } from "html-to-image";

import FileNode from "./components/FileNode.jsx";
import FolderGroup from "./components/FolderGroup.jsx";
import SidePanel from "./components/SidePanel.jsx";
import InsightsPanel from "./components/InsightsPanel.jsx";
import { buildElements, buildDigest, nodeColor } from "./graph";
import * as api from "./api";

const nodeTypes = { fileNode: FileNode, folderGroup: FolderGroup };

const COLOR_MODES = [
  { id: "language",   label: "Language" },
  { id: "hotspot",    label: "Hotspot" },
  { id: "complexity", label: "Complexity" },
];

function LogoIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <circle cx="3"  cy="3"  r="2" fill="white"/>
      <circle cx="13" cy="3"  r="2" fill="white"/>
      <circle cx="3"  cy="13" r="2" fill="white"/>
      <circle cx="13" cy="13" r="2" fill="white"/>
      <circle cx="8"  cy="8"  r="2" fill="white"/>
      <line x1="5" y1="3"  x2="11" y2="3"  stroke="white" strokeWidth="1.2"/>
      <line x1="3" y1="5"  x2="3"  y2="11" stroke="white" strokeWidth="1.2"/>
      <line x1="5" y1="13" x2="11" y2="13" stroke="white" strokeWidth="1.2"/>
      <line x1="13" y1="5" x2="13" y2="11" stroke="white" strokeWidth="1.2"/>
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd"
        d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"/>
    </svg>
  );
}

function EmptyState() {
  return (
    <div className="placeholder">
      <svg className="placeholder-illustration" viewBox="0 0 80 80" fill="none">
        <circle cx="14" cy="20" r="7" stroke="#9ca3af" strokeWidth="2"/>
        <circle cx="66" cy="20" r="7" stroke="#9ca3af" strokeWidth="2"/>
        <circle cx="14" cy="60" r="7" stroke="#9ca3af" strokeWidth="2"/>
        <circle cx="66" cy="60" r="7" stroke="#9ca3af" strokeWidth="2"/>
        <circle cx="40" cy="40" r="7" fill="#d1d5db"/>
        <line x1="21" y1="20" x2="33" y2="37" stroke="#d1d5db" strokeWidth="2"/>
        <line x1="59" y1="20" x2="47" y2="37" stroke="#d1d5db" strokeWidth="2"/>
        <line x1="21" y1="60" x2="33" y2="43" stroke="#d1d5db" strokeWidth="2"/>
        <line x1="59" y1="60" x2="47" y2="43" stroke="#d1d5db" strokeWidth="2"/>
      </svg>
      <h1>Repository Structure Visualizer</h1>
      <p className="placeholder__subtitle">
        Enter a local directory path or a GitHub URL and click Analyze.
        Each file becomes a node; every import becomes a directed edge.
      </p>
      <div className="placeholder__tips">
        <div className="tip-card">
          <div className="tip-card__label">Local path</div>
          <div className="tip-card__title">Your machine</div>
          <div className="tip-card__desc">C:\code\my-project</div>
        </div>
        <div className="tip-card">
          <div className="tip-card__label">GitHub</div>
          <div className="tip-card__title">Remote repo</div>
          <div className="tip-card__desc">owner/repo</div>
        </div>
        <div className="tip-card">
          <div className="tip-card__label">AI summary</div>
          <div className="tip-card__title">Click any node</div>
          <div className="tip-card__desc">Summary opens automatically</div>
        </div>
      </div>
    </div>
  );
}

function useResizablePanel(initialWidth = 360, min = 260, max = 680) {
  const [width, setWidth] = useState(initialWidth);
  const dragging = useRef(false);
  const startX   = useRef(0);
  const startW   = useRef(0);

  const onMouseDown = useCallback((e) => {
    e.preventDefault();
    dragging.current = true;
    startX.current   = e.clientX;
    startW.current   = width;

    const onMove = (ev) => {
      if (!dragging.current) return;
      const delta = startX.current - ev.clientX;
      setWidth(Math.min(max, Math.max(min, startW.current + delta)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
  }, [width, min, max]);

  return { width, onMouseDown };
}

function AnalyzingOverlay({ phase, fileCount, onCancel }) {
  return (
    <div className="analyzing-overlay">
      <div className="spinner" />
      <div className="analyzing-text">
        {phase === "cloning"   && "Cloning repository..."}
        {phase === "scanning"  && "Scanning files..."}
        {phase === "layout"    && `Building graph (${fileCount} files)...`}
        {phase === "analyzing" && "Analyzing..."}
      </div>
      {onCancel && (
        <button className="cancel-btn" onClick={onCancel}>
          Cancel
        </button>
      )}
    </div>
  );
}

function Canvas() {
  const [path, setPath]             = useState("");
  const [apiBase, setApiBaseState]  = useState(api.getApiBase());
  const [data, setData]             = useState(null);
  const [analyzing, setAnalyzing]   = useState(false);
  const [analyzePhase, setAnalyzePhase] = useState("analyzing");
  const [analyzeError, setAnalyzeError] = useState(null);
  const [aiProvider, setAiProvider] = useState(null);
  const [colorMode, setColorMode]   = useState("language");

  const [rawQuery, setRawQuery]     = useState("");
  const [activeLangs, setActiveLangs] = useState(null);
  const [minLoc, setMinLoc]         = useState(0);
  const [cyclesOnly, setCyclesOnly] = useState(false);

  const query = useDeferredValue(rawQuery);

  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const [selected, setSelected]         = useState(null);
  const [summary, setSummary]           = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError]     = useState(null);
  const [code, setCode]                 = useState("");
  const [codeLoading, setCodeLoading]   = useState(false);

  const [arch, setArch]           = useState(null);
  const [archLoading, setArchLoading] = useState(false);
  const [archError, setArchError] = useState(null);

  const abortRef = useRef(null);
  const summaryRequestRef = useRef(0);
  const flowWrapper = useRef(null);
  const { fitView, setCenter } = useReactFlow();
  const panel = useResizablePanel(360);

  useEffect(() => {
    api.health()
      .then((h) => setAiProvider(`${h.ai_provider} / ${h.ai_model}`))
      .catch(() => setAiProvider("backend unreachable"));
  }, [apiBase]);

  const applyApiBase = () => {
    api.setApiBase(apiBase);
    setApiBaseState(api.getApiBase());
  };

  useEffect(() => {
    if (!data) return;
    setAnalyzePhase("layout");
    const timer = setTimeout(() => {
      const { rfNodes, rfEdges } = buildElements(data, { colorMode });
      setNodes(rfNodes);
      setEdges(rfEdges);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (rfNodes.length > 40) {
            const fileNodes = rfNodes.filter((node) => !node.data?.isGroup);
            const focus = fileNodes.reduce((best, node) => {
              const score = node.data.fanIn * 4 + node.data.fanOut * 2 +
                node.data.complexity + node.data.hotspot * 20;
              const bestScore = best.data.fanIn * 4 + best.data.fanOut * 2 +
                best.data.complexity + best.data.hotspot * 20;
              return score > bestScore ? node : best;
            }, fileNodes[0]);
            setCenter(
              (focus.data.absX ?? focus.position.x) + (focus.data.width || 220) / 2,
              (focus.data.absY ?? focus.position.y) + (focus.data.height || 78) / 2,
              { zoom: 0.9, duration: 400 },
            );
          } else {
            fitView({ padding: 0.16, duration: 400, maxZoom: 1 });
          }
          setAnalyzing(false);
        });
      });
    }, 80);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, setNodes, setEdges]);

  useEffect(() => {
    if (!data || !nodes.length) return;
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          color: nodeColor({ data: n.data }, colorMode,
            Math.max(1, ...data.nodes.map((x) => x.complexity || 0))),
        },
      }))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorMode]);

  const cancelAnalyze = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setAnalyzing(false);
    setAnalyzeError("Analysis cancelled.");
  }, []);

  const runAnalyze = useCallback(async () => {
    if (!path.trim()) return;

    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setAnalyzing(true);
    setAnalyzeError(null);
    setSelected(null);
    setSummary(null);
    setArch(null);
    setData(null);
    setNodes([]);
    setEdges([]);

    const isRemote = !/^[A-Za-z]:[\\/]/.test(path.trim()) && !path.trim().startsWith("/");
    setAnalyzePhase(isRemote ? "cloning" : "scanning");

    try {
      const res = await api.analyzeWithSignal(path.trim(), controller.signal);
      if (controller.signal.aborted) return;
      setAnalyzePhase("layout");
      setData(res);
      setActiveLangs(null);
      setMinLoc(0);
      setCyclesOnly(false);
    } catch (e) {
      if (e.name === "AbortError") return;
      setAnalyzeError(e.message);
      setData(null);
      setNodes([]);
      setEdges([]);
      setAnalyzing(false);
    }
  }, [path, fitView, setNodes, setEdges]);

  const neighborIndex = useMemo(() => {
    const idx = {};
    if (!data) return idx;
    for (const n of data.nodes) idx[n.id] = { imports: [], importedBy: [] };
    for (const e of data.edges) {
      if (idx[e.source]) idx[e.source].imports.push(e.target);
      if (idx[e.target]) idx[e.target].importedBy.push(e.source);
    }
    return idx;
  }, [data]);

  const summarizeNode = useCallback(async (node, force = false) => {
    if (!node || !data) return;
    const requestId = summaryRequestRef.current + 1;
    summaryRequestRef.current = requestId;
    setSummaryLoading(true);
    setSummaryError(null);
    const nb = neighborIndex[node.id] || { imports: [], importedBy: [] };
    try {
      const res = await api.summarize(data.root, node.id, {
        force, imports: nb.imports, importedBy: nb.importedBy,
      });
      if (summaryRequestRef.current !== requestId) return;
      setSummary(res);
    } catch (e) {
      if (summaryRequestRef.current !== requestId) return;
      setSummaryError(e.message);
    } finally {
      if (summaryRequestRef.current === requestId) setSummaryLoading(false);
    }
  }, [data, neighborIndex]);

  const onNodeClick = useCallback(async (_, node) => {
    if (node.data?.isGroup) return;
    setSelected(node);
    setSummary(null);
    setSummaryError(null);
    setCode("");
    summarizeNode(node, false);
    if (data) {
      setCodeLoading(true);
      try {
        const res = await api.getFile(data.root, node.id);
        setCode(res.content);
      } catch (_) {
        setCode("");
      } finally {
        setCodeLoading(false);
      }
    }
  }, [data, summarizeNode]);

  const doSummarize = useCallback(async (force = false) => {
    if (!selected) return;
    return summarizeNode(selected, force);
  }, [selected, summarizeNode]);

  const doExplainArchitecture = useCallback(async (force = false) => {
    if (!data) return;
    setArchLoading(true);
    setArchError(null);
    try {
      const res = await api.architecture(data.root, buildDigest(data), force);
      setArch(res);
    } catch (e) {
      setArchError(e.message);
    } finally {
      setArchLoading(false);
    }
  }, [data]);

  const focusNode = useCallback((id) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return;
    setCenter(
      (n.data.absX ?? n.position.x) + (n.data.width || 180) / 2,
      (n.data.absY ?? n.position.y) + 32,
      { zoom: 1.4, duration: 500 },
    );
    onNodeClick(null, n);
  }, [nodes, setCenter, onNodeClick]);

  const q = query.trim().toLowerCase();
  const visibleIds = useMemo(() => {
    const set = new Set();
    for (const n of nodes) {
      if (n.data?.isGroup) {
        set.add(n.id);
        continue;
      }
      const d = n.data;
      const ok =
        (!q || n.id.toLowerCase().includes(q)) &&
        (!activeLangs || activeLangs.has(d.language || "other")) &&
        (d.loc >= minLoc) &&
        (!cyclesOnly || d.inCycle);
      if (ok) set.add(n.id);
    }
    return set;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, q, activeLangs, minLoc, cyclesOnly]);

  const selectedId = selected?.id ?? null;
  const displayNodes = useMemo(() => nodes.map((n) => {
    const visible = visibleIds.has(n.id);
    const isSelected = n.id === selectedId;
    return {
      ...n,
      selected: isSelected,
      style: { ...n.style, opacity: visible ? 1 : 0.08 },
    };
  }), [nodes, visibleIds, selectedId]);

  const connectedEdgeIds = useMemo(() => {
    if (!selectedId) return null;
    const set = new Set();
    for (const e of edges) {
      if (e.source === selectedId || e.target === selectedId) set.add(e.id);
    }
    return set;
  }, [edges, selectedId]);

  const displayEdges = useMemo(() => {
    if (!connectedEdgeIds) return edges;
    return edges.map((e) => {
      if (!connectedEdgeIds.has(e.id)) return e;
      return { ...e, animated: true, style: { ...e.style, stroke: "#2563eb", strokeWidth: 2 } };
    });
  }, [edges, connectedEdgeIds]);

  const languages = useMemo(() =>
    Object.keys(data?.insights?.language_breakdown || {}), [data]);

  const toggleLang = (lang) => {
    setActiveLangs((prev) => {
      const base = prev ? new Set(prev) : new Set(languages);
      if (base.has(lang)) base.delete(lang); else base.add(lang);
      return base.size === languages.length ? null : base;
    });
  };

  const exportPng = useCallback(() => {
    const el = flowWrapper.current;
    if (!el) return;
    const overlays = el.querySelectorAll(".insights, .react-flow__controls, .react-flow__minimap");
    overlays.forEach((o) => (o.style.display = "none"));
    toPng(el, { backgroundColor: "#eef0f3", pixelRatio: 2, cacheBust: true })
      .then((url) => {
        const a = document.createElement("a");
        a.download = "repo-graph.png";
        a.href = url;
        a.click();
      })
      .finally(() => {
        overlays.forEach((o) => (o.style.display = ""));
      });
  }, []);

  const maxComplexity = useMemo(
    () => Math.max(1, ...(data?.nodes || []).map((n) => n.complexity || 0)),
    [data],
  );

  const selectedNeighbors = selected ? neighborIndex[selected.id] : null;

  return (
    <div className="app">
      <header className="toolbar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <div className="brand-logo"><LogoIcon /></div>
          RepoViz
        </a>
        <div className="toolbar-divider" />
        <input
          id="path-input"
          className="path-input"
          placeholder="Local path or GitHub URL (owner/repo)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !analyzing && runAnalyze()}
        />
        <button
          id="btn-analyze"
          className="primary-btn"
          onClick={analyzing ? cancelAnalyze : runAnalyze}
          style={analyzing ? { background: "#dc2626" } : {}}
        >
          {analyzing ? "Cancel" : "Analyze"}
        </button>

        {data && (
          <>
            <div className="toolbar-divider" />
            <div className="seg">
              {COLOR_MODES.map((m) => (
                <button
                  key={m.id}
                  className={`seg__btn${colorMode === m.id ? " active" : ""}`}
                  onClick={() => setColorMode(m.id)}
                >{m.label}</button>
              ))}
            </div>
            <input
              className="search"
              placeholder="Search files..."
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
            />
            <button className="ghost-btn" onClick={exportPng}>Export PNG</button>
          </>
        )}

        <details className="settings">
          <summary className="icon-btn" title="Settings"><GearIcon /></summary>
          <div className="settings__body">
            <div>
              <label>Backend URL</label>
              <div className="row">
                <input value={apiBase} onChange={(e) => setApiBaseState(e.target.value)} />
                <button className="ghost-btn" onClick={applyApiBase}>Save</button>
              </div>
            </div>
            <div className="ai-status">AI: {aiProvider || "checking..."}</div>
            {data && (
              <>
                <div>
                  <label>Min lines of code: {minLoc}</label>
                  <input type="range" min="0" max="500" value={minLoc}
                    onChange={(e) => setMinLoc(Number(e.target.value))} />
                </div>
                <label className="check">
                  <input type="checkbox" checked={cyclesOnly}
                    onChange={(e) => setCyclesOnly(e.target.checked)} />
                  Show only circular dependency files
                </label>
                {languages.length > 0 && (
                  <div>
                    <label>Filter by language</label>
                    <div className="lang-filter" style={{ marginTop: 4 }}>
                      {languages.map((l) => (
                        <button key={l}
                          className={`chip${!activeLangs || activeLangs.has(l) ? " chip--on" : ""}`}
                          onClick={() => toggleLang(l)}>{l}</button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </details>
      </header>

      {analyzeError && (
        <div className="banner banner--error">{analyzeError}</div>
      )}

      <div className="main">
        <div className="canvas" ref={flowWrapper}>
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onPaneClick={() => setSelected(null)}
            nodeTypes={nodeTypes}
            minZoom={0.08}
            fitView
            fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
            style={{ width: "100%", height: "100%" }}
            proOptions={{ hideAttribution: true }}
            onlyRenderVisibleElements
          >
            <Background color="#d1d5db" gap={24} size={1} />
            <Controls />
            <MiniMap
              pannable
              zoomable
              nodeColor={(n) => nodeColor(n, colorMode, maxComplexity)}
              maskColor="rgba(238,240,243,0.75)"
            />
          </ReactFlow>

          {data && (
            <InsightsPanel
              insights={data.insights}
              stats={data.stats}
              cycles={data.cycles}
              onFocusNode={focusNode}
              arch={arch}
              archLoading={archLoading}
              archError={archError}
              onExplainArchitecture={doExplainArchitecture}
            />
          )}

          {analyzing && (
            <AnalyzingOverlay
              phase={analyzePhase}
              fileCount={data?.stats?.files || 0}
              onCancel={cancelAnalyze}
            />
          )}

          {!data && !analyzing && <EmptyState />}
        </div>

        <div className="panel-resize-handle" onMouseDown={panel.onMouseDown} title="Drag to resize" />

        <SidePanel
          node={selected}
          neighbors={selectedNeighbors}
          summary={summary}
          loading={summaryLoading}
          error={summaryError}
          code={code}
          codeLoading={codeLoading}
          onSummarize={() => doSummarize(false)}
          onRefresh={() => doSummarize(true)}
          onClose={() => setSelected(null)}
          onFocusNode={focusNode}
          width={panel.width}
        />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Canvas />
    </ReactFlowProvider>
  );
}
