import { useState } from "react";

export default function InsightsPanel({
  insights, stats, cycles, onFocusNode,
  arch, archLoading, archError, onExplainArchitecture,
}) {
  const [open, setOpen] = useState(true);
  if (!insights) return null;

  return (
    <div className={`insights${open ? "" : " insights--collapsed"}`}>
      <button className="insights__toggle" onClick={() => setOpen((o) => !o)}>
        {open ? "Insights" : "Insights"}
      </button>

      {open && (
        <div className="insights__body">
          <h3>Repository Overview</h3>

          <div className="insight-stats">
            <Stat n={stats.files?.toLocaleString()} label="files" />
            <Stat n={stats.edges?.toLocaleString()} label="edges" />
            <Stat n={(stats.total_loc || 0).toLocaleString()} label="LoC" />
            <Stat n={stats.cycles} label="cycles" warn={stats.cycles > 0} />
          </div>

          {!insights.has_git && (
            <p className="note" style={{ marginBottom: 8 }}>
              No git history - hotspots use complexity only.
            </p>
          )}

          {(insights.truncated || stats.truncated) && (
            <p className="note" style={{ marginBottom: 8 }}>
              Showing the first {stats.max_files || stats.files} source files to keep the graph responsive.
            </p>
          )}

          <div className="insight-section">
            <div className="insight-section__title">
              Circular Dependencies ({cycles?.length || 0})
            </div>
            {cycles?.length ? (
              <ul className="cycle-list">
                {cycles.slice(0, 5).map((c, i) => (
                  <li key={i} className="cycle-item">
                    {c.map((id) => (
                      <span
                        key={id}
                        className="chip chip--cycle"
                        onClick={() => onFocusNode(id)}
                        title={id}
                        style={{ cursor: "pointer" }}
                      >
                        {id.split("/").pop()}
                      </span>
                    ))}
                  </li>
                ))}
                {cycles.length > 5 && (
                  <li className="muted small" style={{ padding: "4px 0" }}>
                    +{cycles.length - 5} more cycles
                  </li>
                )}
              </ul>
            ) : (
              <p className="ok">No cycles detected.</p>
            )}
          </div>

          <div className="insight-section">
            <div className="insight-section__title">Risk Hotspots</div>
            <RankList
              items={insights.top_hotspots}
              render={(h) => `${h.id.split("/").pop()} - cx ${h.complexity} - ${h.churn} commits`}
              onFocusNode={onFocusNode}
              idKey="id"
              empty="No hotspots."
            />
          </div>

          <div className="insight-section">
            <div className="insight-section__title">Most Depended On</div>
            <RankList
              items={insights.most_depended_on}
              render={(m) => `${m.id.split("/").pop()} - ${m.fan_in} dependents`}
              onFocusNode={onFocusNode}
              idKey="id"
              empty="No internal dependencies."
            />
          </div>

          <div className="insight-section">
            <div className="insight-section__title">Most Complex</div>
            <RankList
              items={insights.most_complex}
              render={(m) => `${m.id.split("/").pop()} - complexity ${m.complexity}`}
              onFocusNode={onFocusNode}
              idKey="id"
              empty="No data."
            />
          </div>

          <div className="insight-section">
            <div className="insight-section__title">Architecture Overview</div>
            {!arch && !archLoading && (
              <button
                className="primary-btn full"
                onClick={() => onExplainArchitecture(false)}
                id="btn-explain-arch"
              >
                Generate AI overview
              </button>
            )}
            {archLoading && <div className="loading">Generating overview...</div>}
            {archError && <div className="error">{archError}</div>}
            {arch && (
              <>
                <div className="summary-box" style={{ marginTop: 6 }}>
                  <p className="summary-text small">{arch.summary}</p>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
                  <span className={`badge ${arch.provider === "offline" ? "badge--offline" : arch.cached ? "badge--cached" : "badge--fresh"}`}>
                    {arch.provider}{arch.cached ? " - cached" : ""}
                  </span>
                  <button
                    className="ghost-btn"
                    onClick={() => onExplainArchitecture(true)}
                    style={{ height: 26, fontSize: 11.5 }}
                  >
                    Refresh
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ n, label, warn }) {
  return (
    <div className={`stat${warn ? " stat--warn" : ""}`}>
      <div className="stat__n">{n}</div>
      <div className="stat__l">{label}</div>
    </div>
  );
}

function RankList({ items, render, onFocusNode, idKey, empty }) {
  if (!items?.length) return <p className="muted small">{empty}</p>;
  return (
    <ul className="rank-list">
      {items.slice(0, 6).map((it) => (
        <li
          key={it[idKey]}
          onClick={() => onFocusNode(it[idKey])}
          title={it[idKey]}
        >
          {render(it)}
        </li>
      ))}
    </ul>
  );
}
