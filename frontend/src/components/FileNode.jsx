import { memo } from "react";
import { Handle, Position } from "reactflow";

function FileNode({ data, selected }) {
  const {
    label, folder, language, loc, complexity, color, width, height,
    churn, hotspot, inCycle, fanIn, fanOut,
  } = data;

  const barColor =
    hotspot > 0.66 ? "#dc2626"
    : hotspot > 0.33 ? "#d97706"
    : "#16a34a";

  const tooltip = [
    label,
    folder ? `Folder: ${folder}` : "",
    `${language || "text"} - ${loc} LoC - complexity ${complexity}`,
    `Churn: ${churn} commits - Used by: ${fanIn} - Imports: ${fanOut}`,
    inCycle ? "Warning: Part of a circular dependency" : "",
  ].filter(Boolean).join("\n");

  const nodeH = height || 80;

  return (
    <div
      className={`file-node${selected ? " selected" : ""}${inCycle ? " in-cycle" : ""}`}
      style={{ width: width || 200, height: nodeH, borderLeftColor: color }}
      title={tooltip}
    >
      <Handle type="target" position={Position.Left}  style={{ opacity: 0.7 }} />
      <Handle type="source" position={Position.Right} style={{ opacity: 0.7 }} />
      <Handle type="target" position={Position.Top}    style={{ opacity: 0.7 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0.7 }} />

      {folder && (
        <div className="file-node__folder-pill" style={{ borderColor: color }}>
          {folder.split("/").slice(-2).join("/")}
        </div>
      )}

      <div className="file-node__row">
        <span className="lang-dot" style={{ background: color }} />
        <span className="file-node__name">{label}</span>
        <span className="file-node__badges">
          {inCycle && <span className="badge-cycle">cycle</span>}
          {hotspot >= 0.6 && <span className="badge-hot">hot</span>}
        </span>
      </div>

      <div className="file-node__meta">
        <span className="file-node__lang">{language || "text"}</span>
        <span className="file-node__sep">-</span>
        <span className="file-node__loc">{loc} LoC</span>
        {(fanIn > 0 || fanOut > 0) && (
          <>
            <span className="file-node__sep">-</span>
            <span className="file-node__conn" title={`${fanIn} used by, ${fanOut} imports`}>
              in {fanIn} out {fanOut}
            </span>
          </>
        )}
      </div>

      <div className="complexity-bar">
        <div
          className="complexity-fill"
          style={{ width: `${Math.max(4, (hotspot || 0) * 100)}%`, background: barColor }}
        />
      </div>
    </div>
  );
}

export default memo(FileNode);
