
const DEFAULT_BASE = import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000";

let apiBase = localStorage.getItem("apiBase") || DEFAULT_BASE;

export function getApiBase() { return apiBase; }

export function setApiBase(url) {
  apiBase = url.replace(/\/$/, "");
  localStorage.setItem("apiBase", apiBase);
}

async function request(path, options = {}) {
  const res = await fetch(`${apiBase}${path}`, options);
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.detail) detail = body.detail;
    } catch (_) { /* ignore */ }
    throw new Error(detail);
  }
  return res.json();
}

export function health() {
  return request("/api/health");
}

export function analyze(path, maxFiles = 900) {
  return request("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, max_files: maxFiles }),
  });
}

export function analyzeWithSignal(path, signal, maxFiles = 900) {
  return request("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, max_files: maxFiles }),
    signal,
  });
}

export function summarize(root, path, { force = false, imports = [], importedBy = [] } = {}) {
  return request("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root, path, force, imports, imported_by: importedBy }),
  });
}

export function architecture(root, digest, force = false) {
  return request("/api/architecture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ root, digest, force }),
  });
}

export function getFile(root, path) {
  const q = new URLSearchParams({ root, path });
  return request(`/api/file?${q.toString()}`);
}
