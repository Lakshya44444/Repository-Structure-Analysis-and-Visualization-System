
import dagre from "@dagrejs/dagre";

export const LANG_COLORS = {
  python:     "#3776ab",
  javascript: "#f0db4f",
  typescript: "#3178c6",
  c:          "#5c6bc0",
  cpp:        "#00599c",
  java:       "#e76f00",
  go:         "#00add8",
  ruby:       "#cc342d",
  rust:       "#dea584",
  default:    "#9aa0a6",
};

export function langColor(lang) {
  return LANG_COLORS[lang] || LANG_COLORS.default;
}

export function heatColor(t) {
  const x = Math.max(0, Math.min(1, t));
  const hue = (1 - x) * 120; // 120 = green, 0 = red
  return `hsl(${hue}, 75%, 50%)`;
}

function sizeForLoc(loc) {
  const width  = Math.round(200 + Math.min(loc, 1000) / 10);
  const height = 80;
  return { width, height };
}

export function nodeColor(node, mode, maxComplexity) {
  const d  = node.data || node;
  const mx = maxComplexity || 1;
  if (mode === "hotspot")    return heatColor(d.hotspot || 0);
  if (mode === "complexity") return heatColor((d.complexity || 0) / mx);
  return langColor(d.language);
}

// -----------------------------------------------------------------------------
const DAGRE_LIMIT = 180;
const SPARSE_EDGE_RATIO = 0.9;

export function buildElements(data, { colorMode = "language" } = {}) {
  const { nodes = [], edges = [] } = data;
  const maxComplexity = Math.max(1, ...nodes.map((n) => n.complexity || 0));

  const isLarge = nodes.length > DAGRE_LIMIT;
  const isSparse = nodes.length > 20 && edges.length / Math.max(nodes.length, 1) < SPARSE_EDGE_RATIO;

  if (isLarge || isSparse) {
    return buildClusteredElements(nodes, edges, colorMode, maxComplexity);
  }

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: "LR", nodesep: 60, ranksep: 130, marginx: 48, marginy: 48 });

  const sizeById = new Map();
  for (const n of nodes) {
    const size = sizeForLoc(n.loc);
    sizeById.set(n.id, size);
    g.setNode(n.id, size);
  }
  for (const e of edges) {
    if (sizeById.has(e.source) && sizeById.has(e.target)) {
      g.setEdge(e.source, e.target);
    }
  }
  dagre.layout(g);

  const rfNodes = nodes.map((n) => {
    const pos  = g.node(n.id) || { x: 0, y: 0 };
    const size = sizeById.get(n.id);
    const nd   = buildNodeData(n, size, colorMode, maxComplexity);
    return {
      id:       n.id,
      type:     "fileNode",
      position: { x: pos.x - size.width / 2, y: pos.y - size.height / 2 },
      data:     nd,
    };
  });

  const rfEdges = buildEdges(edges);
  return { rfNodes, rfEdges };
}


function folderKey(node) {
  const parts = (node.folder || "").split("/").filter(Boolean);
  if (!parts.length) return "(root)";
  return parts.slice(0, Math.min(2, parts.length)).join("/");
}

function buildClusteredElements(nodes, edges, colorMode, maxComplexity) {
  const groups = new Map();
  for (const n of nodes) {
    const key = folderKey(n);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(n);
  }

  const sortedGroups = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

  const groupGapX = 70;
  const groupGapY = 70;
  const nodeGapX = 248;
  const nodeGapY = 114;
  const groupSlotWidth = 1320;
  const groupColumns = Math.max(2, Math.ceil(Math.sqrt(sortedGroups.length)));

  const rfNodes = [];
  let rowY = 0;
  let rowHeight = 0;

  sortedGroups.forEach(([folder, groupNodes], groupIndex) => {
    const groupCol = groupIndex % groupColumns;
    const columns = Math.max(2, Math.min(5, Math.ceil(Math.sqrt(groupNodes.length))));
    const rows = Math.ceil(groupNodes.length / columns);
    const groupWidth = Math.max(540, 36 + columns * nodeGapX);
    const groupHeight = Math.max(190, 72 + rows * nodeGapY);

    if (groupCol === 0 && groupIndex > 0) {
      rowY += rowHeight + groupGapY;
      rowHeight = 0;
    }

    const originX = groupCol * (groupSlotWidth + groupGapX);
    const originY = rowY;
    rowHeight = Math.max(rowHeight, groupHeight);
    const groupId = `folder:${folder}`;

    rfNodes.push({
      id: groupId,
      type: "folderGroup",
      position: { x: originX, y: originY },
      data: { label: folder, isGroup: true },
      selectable: false,
      draggable: false,
      className: "folder-group",
      style: {
        width: groupWidth,
        height: groupHeight,
        borderRadius: 10,
        border: "1px solid rgba(148,163,184,0.65)",
        background: "rgba(255,255,255,0.72)",
      },
    });

    groupNodes
      .sort((a, b) =>
        (b.fan_in + b.fan_out + b.complexity) - (a.fan_in + a.fan_out + a.complexity) ||
        a.id.localeCompare(b.id)
      )
      .forEach((n, index) => {
        const col = index % columns;
        const row = Math.floor(index / columns);
        const size = { width: 220, height: 78 };
        const nd = buildNodeData(n, size, colorMode, maxComplexity);
        nd.group = folder;
        nd.absX = originX + 18 + col * nodeGapX;
        nd.absY = originY + 48 + row * nodeGapY;
        rfNodes.push({
          id: n.id,
          type: "fileNode",
          parentNode: groupId,
          extent: "parent",
          position: {
            x: 18 + col * nodeGapX,
            y: 48 + row * nodeGapY,
          },
          data: nd,
        });
      });
  });

  return { rfNodes, rfEdges: buildEdges(edges) };
}

function buildNodeData(n, size, colorMode, maxComplexity) {
  const d = {
    label:       n.label,
    folder:      n.folder,
    language:    n.language,
    loc:         n.loc,
    totalLines:  n.total_lines,
    complexity:  n.complexity,
    sizeBytes:   n.size_bytes,
    churn:       n.churn,
    hotspot:     n.hotspot,
    inCycle:     n.in_cycle,
    fanIn:       n.fan_in,
    fanOut:      n.fan_out,
    width:       size.width,
    height:      size.height,
    maxComplexity,
  };
  d.color = nodeColor({ data: d }, colorMode, maxComplexity);
  return d;
}

function buildEdges(edges) {
  return edges.map((e, i) => ({
    id:       `e${i}-${e.source}-${e.target}`,
    source:   e.source,
    target:   e.target,
    type:     "smoothstep",
    animated: !!e.cycle,
    data:     { cycle: !!e.cycle },
    interactionWidth: 14,
    style: {
      stroke:      e.cycle ? "#f43f5e" : "#64748b",
      strokeWidth: e.cycle ? 2.5 : 1.5,
      opacity:     e.cycle ? 0.85 : 0.38,
    },
    markerEnd: { type: "arrowclosed", color: e.cycle ? "#f43f5e" : "#64748b" },
  }));
}

// Build a compact textual digest of the graph for the AI architecture overview.
export function buildDigest(data) {
  const { nodes = [], edges = [], stats = {}, insights = {} } = data;
  const lines = [];
  lines.push(`Repository with ${stats.files} files, ${stats.edges} import edges, ${stats.total_loc} lines of code.`);
  if (insights.language_breakdown) {
    lines.push("Languages: " + Object.entries(insights.language_breakdown)
      .map(([l, c]) => `${l} (${c})`).join(", ") + ".");
  }
  if (insights.most_depended_on?.length) {
    lines.push("Most depended-on files (likely core modules): " +
      insights.most_depended_on.map((m) => `${m.id} [${m.fan_in} dependents]`).join(", ") + ".");
  }
  if (insights.most_complex?.length) {
    lines.push("Most complex files: " +
      insights.most_complex.slice(0, 6).map((m) => `${m.id} [cx ${m.complexity}]`).join(", ") + ".");
  }
  if (insights.top_hotspots?.length) {
    lines.push("Risk hotspots (complex AND frequently changed): " +
      insights.top_hotspots.slice(0, 6).map((h) => h.id).join(", ") + ".");
  }
  lines.push(`Circular dependencies detected: ${insights.cycle_count || 0}.`);
  const sample = edges.slice(0, 25).map((e) => `${e.source} -> ${e.target}`);
  if (sample.length) lines.push("Sample dependencies:\n" + sample.join("\n"));
  return lines.join("\n");
}
