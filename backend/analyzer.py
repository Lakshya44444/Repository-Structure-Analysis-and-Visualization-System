from __future__ import annotations

import ast
import os
import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple

# Directories to skip entirely
IGNORED_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    "env", ".idea", ".vscode", "dist", "build", ".next", ".cache", "target",
    "out", "coverage", ".pytest_cache", ".mypy_cache", "vendor", "bin", "obj",
    ".gradle", ".mvn", "Pods", ".dart_tool", ".pub-cache",
}

LANG_BY_EXT = {
    ".py":  "python",
    ".js":  "javascript", ".jsx": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts":  "typescript", ".tsx": "typescript",
    ".c":   "c",  ".h":   "c",
    ".cpp": "cpp", ".cc": "cpp", ".cxx": "cpp", ".hpp": "cpp", ".hh": "cpp",
    ".java":"java",
    ".go":  "go",
    ".rb":  "ruby",
    ".rs":  "rust",
}

COMPLEXITY_KEYWORDS = re.compile(
    r"\b(if|elif|else if|for|while|case|catch|except|switch|&&|\|\||\?)\b"
)

MAX_FILE_BYTES = 2_000_000


@dataclass
class FileNode:
    id: str
    label: str
    abs_path: str
    language: Optional[str]
    loc: int
    total_lines: int
    complexity: int
    size_bytes: int
    folder: str
    churn: int = 0
    hotspot: float = 0.0
    in_cycle: bool = False
    fan_in: int = 0
    fan_out: int = 0


@dataclass
class Edge:
    source: str
    target: str
    kind: str = "import"
    cycle: bool = False


@dataclass
class GraphResult:
    root: str
    nodes: List[FileNode] = field(default_factory=list)
    edges: List[Edge] = field(default_factory=list)
    stats: Dict[str, object] = field(default_factory=dict)
    cycles: List[List[str]] = field(default_factory=list)
    insights: Dict[str, object] = field(default_factory=dict)


def _rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def _count_loc(text: str, language: Optional[str]) -> Tuple[int, int]:
    lines = text.splitlines()
    total = len(lines)
    loc = 0
    block_comment = False
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if language in ("c", "cpp", "java", "javascript", "typescript", "go", "rust"):
            if block_comment:
                if "*/" in line:
                    block_comment = False
                continue
            if line.startswith("/*"):
                if "*/" not in line:
                    block_comment = True
                continue
            if line.startswith("//"):
                continue
        elif language in ("python", "ruby"):
            if line.startswith("#"):
                continue
        loc += 1
    return loc, total


def _estimate_complexity(text: str) -> int:
    return 1 + len(COMPLEXITY_KEYWORDS.findall(text))


def _python_imports(text: str) -> List[str]:
    out: List[str] = []
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return _python_imports_regex(text)
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                out.append(alias.name)
        elif isinstance(node, ast.ImportFrom):
            prefix = "." * (node.level or 0)
            mod = node.module or ""
            out.append(prefix + mod)
    return out


def _python_imports_regex(text: str) -> List[str]:
    pat = re.compile(r"^\s*(?:from\s+([\.\w]+)\s+import|import\s+([\w\.]+))", re.M)
    return [m.group(1) or m.group(2) for m in pat.finditer(text)]


_JS_IMPORT = re.compile(
    r"""(?:import\s[^'"]*?from\s*['"]([^'"]+)['"])"""
    r"""|(?:import\s*['"]([^'"]+)['"])"""
    r"""|(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))"""
    r"""|(?:export\s[^'"]*?from\s*['"]([^'"]+)['"])""",
    re.M,
)


def _js_imports(text: str) -> List[str]:
    return [next(g for g in m.groups() if g) for m in _JS_IMPORT.finditer(text)]


_INCLUDE = re.compile(r'^\s*#\s*include\s*[<"]([^>"]+)[>"]', re.M)


def _c_imports(text: str) -> List[str]:
    return _INCLUDE.findall(text)


_GO_SINGLE = re.compile(r'^import\s+"([^"]+)"', re.M)
_GO_BLOCK  = re.compile(r'import\s*\(([^)]+)\)', re.DOTALL)


def _go_imports(text: str) -> List[str]:
    """Extract Go import paths (single and block form)."""
    out = list(_GO_SINGLE.findall(text))
    for block in _GO_BLOCK.findall(text):
        out.extend(re.findall(r'"([^"]+)"', block))
    return out


def _extract_imports(text: str, language: Optional[str]) -> List[str]:
    if language == "python":
        return _python_imports(text)
    if language in ("javascript", "typescript"):
        return _js_imports(text)
    if language in ("c", "cpp"):
        return _c_imports(text)
    if language == "go":
        return _go_imports(text)
    return []


def _read_go_module(root: Path) -> str:
    """Read the module name from go.mod (e.g. 'github.com/user/repo')."""
    go_mod = root / "go.mod"
    if not go_mod.exists():
        return ""
    try:
        content = go_mod.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"^module\s+(\S+)", content, re.M)
        return m.group(1) if m else ""
    except OSError:
        return ""


def _resolve_go(raw: str, go_module: str, id_set: Set[str],
                dir_index: Dict[str, List[str]]) -> Optional[str]:
    if not go_module:
        return None
    if not raw.startswith(go_module):
        return None
    rel_pkg = raw[len(go_module):].lstrip("/")
    if not rel_pkg:
        return None
    candidates = dir_index.get(rel_pkg, [])
    if candidates:
        pkg_name = rel_pkg.rsplit("/", 1)[-1]
        for c in candidates:
            if Path(c).stem == pkg_name:
                return c
        return candidates[0]
    return None


def _resolve_python(raw: str, src_id: str, by_module: Dict[str, str],
                    id_set: Set[str]) -> Optional[str]:
    if raw.startswith("."):
        level = len(raw) - len(raw.lstrip("."))
        mod = raw.lstrip(".")
        base = Path(src_id).parent
        for _ in range(level - 1):
            base = base.parent
        parts = mod.split(".") if mod else []
        cand_dir = base.joinpath(*parts)
        for cand in (f"{cand_dir.as_posix()}.py",
                     f"{(cand_dir / '__init__.py').as_posix()}"):
            if cand in id_set:
                return cand
        return None
    parts = raw.split(".")
    while parts:
        if ".".join(parts) in by_module:
            return by_module[".".join(parts)]
        parts.pop()
    return None


def _resolve_relative_path(raw: str, src_id: str, id_set: Set[str],
                            exts: List[str]) -> Optional[str]:
    base = Path(src_id).parent
    target = os.path.normpath((base / raw).as_posix()).replace("\\", "/")
    candidates = [target] + [target + ext for ext in exts] + \
                 [f"{target}/index{ext}" for ext in exts]
    return next((c for c in candidates if c in id_set), None)


def _resolve_c(raw: str, src_id: str, id_set: Set[str],
               basename_index: Dict[str, List[str]]) -> Optional[str]:
    rel = _resolve_relative_path(raw, src_id, id_set, [])
    if rel:
        return rel
    base = os.path.basename(raw)
    matches = basename_index.get(base, [])
    return matches[0] if len(matches) == 1 else None


def find_cycles(node_ids: List[str], edges: List[Edge]) -> List[List[str]]:
    adj: Dict[str, List[str]] = {nid: [] for nid in node_ids}
    for e in edges:
        if e.source in adj and e.target in adj:
            adj[e.source].append(e.target)

    index_counter = [0]
    stack: List[str] = []
    on_stack: Set[str] = set()
    indices: Dict[str, int] = {}
    lowlink: Dict[str, int] = {}
    sccs: List[List[str]] = []

    for root_node in node_ids:
        if root_node in indices:
            continue
        work: List[Tuple[str, int]] = [(root_node, 0)]
        while work:
            v, pi = work[-1]
            if pi == 0:
                indices[v] = lowlink[v] = index_counter[0]
                index_counter[0] += 1
                stack.append(v)
                on_stack.add(v)
            recursed = False
            neighbors = adj[v]
            while pi < len(neighbors):
                w = neighbors[pi]
                pi += 1
                if w not in indices:
                    work[-1] = (v, pi)
                    work.append((w, 0))
                    recursed = True
                    break
                elif w in on_stack:
                    lowlink[v] = min(lowlink[v], indices[w])
            if recursed:
                continue
            work[-1] = (v, pi)
            if lowlink[v] == indices[v]:
                comp: List[str] = []
                while True:
                    w = stack.pop()
                    on_stack.discard(w)
                    comp.append(w)
                    if w == v:
                        break
                if len(comp) > 1:
                    sccs.append(comp)
            work.pop()
            if work:
                parent = work[-1][0]
                lowlink[parent] = min(lowlink[parent], lowlink[v])
    return sccs


def git_churn(root: Path, max_commits: int = 4000) -> Dict[str, int]:
    if not (root / ".git").exists():
        return {}
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "log", f"--max-count={max_commits}",
             "--name-only", "--pretty=format:", "--no-renames"],
            capture_output=True, text=True, timeout=30, encoding="utf-8", errors="ignore",
        )
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return {}
    if out.returncode != 0:
        return {}
    counts: Dict[str, int] = {}
    for line in out.stdout.splitlines():
        line = line.strip()
        if line:
            counts[line] = counts.get(line, 0) + 1
    return counts


def _normalize(values: List[float]) -> List[float]:
    if not values:
        return []
    lo, hi = min(values), max(values)
    if hi - lo < 1e-9:
        return [0.0] * len(values)
    return [(v - lo) / (hi - lo) for v in values]


def analyze(root_path: str, max_files: int = 500) -> GraphResult:
    root = Path(root_path).resolve()
    if not root.exists() or not root.is_dir():
        raise FileNotFoundError(f"Not a directory: {root_path}")

    # Read Go module name (empty string if not a Go project)
    go_module = _read_go_module(root)

    nodes: List[FileNode] = []
    raw_imports: Dict[str, List[str]] = {}
    by_module: Dict[str, str] = {}
    basename_index: Dict[str, List[str]] = {}
    dir_index: Dict[str, List[str]] = {}

    file_count = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames
                             if d not in IGNORED_DIRS and not d.startswith("."))
        for fn in sorted(filenames):
            if file_count >= max_files:
                break
            abs_p = Path(dirpath) / fn
            ext   = abs_p.suffix.lower()
            lang  = LANG_BY_EXT.get(ext)
            if not lang:
                continue
            try:
                size = abs_p.stat().st_size
            except OSError:
                continue

            rel_id = _rel(abs_p, root)
            folder = Path(rel_id).parent.as_posix()
            folder = "" if folder == "." else folder

            text = ""
            if size <= MAX_FILE_BYTES:
                try:
                    text = abs_p.read_text(encoding="utf-8", errors="ignore")
                except OSError:
                    pass

            loc, total = _count_loc(text, lang) if text else (0, 0)
            complexity = _estimate_complexity(text) if text else 1

            node = FileNode(
                id=rel_id, label=fn, abs_path=str(abs_p), language=lang,
                loc=loc, total_lines=total, complexity=complexity,
                size_bytes=size, folder=folder,
            )
            nodes.append(node)
            basename_index.setdefault(fn, []).append(rel_id)

            if lang == "go" and folder:
                dir_index.setdefault(folder, []).append(rel_id)

            if lang == "python":
                dotted = rel_id[:-3].replace("/", ".").replace(".__init__", "")
                by_module[dotted] = rel_id

            if text:
                raw_imports[rel_id] = _extract_imports(text, lang)

            file_count += 1
        if file_count >= max_files:
            break

    id_set     = {n.id for n in nodes}
    lang_by_id = {n.id: n.language for n in nodes}
    js_exts    = [e for e in LANG_BY_EXT if LANG_BY_EXT[e] in ("javascript", "typescript")]

    edges: List[Edge] = []
    seen: Set[Tuple[str, str]] = set()
    for src_id, imports in raw_imports.items():
        lang = lang_by_id.get(src_id)
        for raw in imports:
            target: Optional[str] = None
            if lang == "python":
                target = _resolve_python(raw, src_id, by_module, id_set)
            elif lang in ("javascript", "typescript"):
                if raw.startswith("."):
                    target = _resolve_relative_path(raw, src_id, id_set, js_exts)
                else:
                    bare = raw.split("/")[-1]
                    for ext in js_exts:
                        cand = f"{bare}{ext}"
                        matches = basename_index.get(cand, [])
                        if len(matches) == 1:
                            target = matches[0]
                            break
                    if not target:
                        matches = basename_index.get(bare, [])
                        if len(matches) == 1:
                            target = matches[0]
            elif lang in ("c", "cpp"):
                target = _resolve_c(raw, src_id, id_set, basename_index)
            elif lang == "go":
                target = _resolve_go(raw, go_module, id_set, dir_index)
            if target and target != src_id and (src_id, target) not in seen:
                seen.add((src_id, target))
                edges.append(Edge(source=src_id, target=target))

    node_by_id = {n.id: n for n in nodes}

    for e in edges:
        if e.source in node_by_id:
            node_by_id[e.source].fan_out += 1
        if e.target in node_by_id:
            node_by_id[e.target].fan_in += 1

    cycles = find_cycles([n.id for n in nodes], edges)
    cycle_members: Set[str] = set()
    for comp in cycles:
        cycle_members.update(comp)
    for n in nodes:
        if n.id in cycle_members:
            n.in_cycle = True
    for e in edges:
        if e.source in cycle_members and e.target in cycle_members:
            for comp in cycles:
                if e.source in comp and e.target in comp:
                    e.cycle = True
                    break

    churn   = git_churn(root)
    has_git = bool(churn)
    for n in nodes:
        n.churn = churn.get(n.id, 0)

    norm_cx = _normalize([float(n.complexity) for n in nodes])
    norm_ch = _normalize([float(n.churn)       for n in nodes])
    for n, cx, ch in zip(nodes, norm_cx, norm_ch):
        n.hotspot = round((cx * ch) if has_git else cx, 4)

    top_hotspots   = sorted(nodes, key=lambda n: n.hotspot,    reverse=True)[:8]
    most_depended  = sorted(nodes, key=lambda n: n.fan_in,     reverse=True)[:8]
    most_complex   = sorted(nodes, key=lambda n: n.complexity, reverse=True)[:8]

    insights = {
        "has_git":    has_git,
        "cycle_count": len(cycles),
        "top_hotspots": [
            {"id": n.id, "hotspot": n.hotspot, "complexity": n.complexity, "churn": n.churn}
            for n in top_hotspots if n.hotspot > 0
        ],
        "most_depended_on": [
            {"id": n.id, "fan_in": n.fan_in} for n in most_depended if n.fan_in > 0
        ],
        "most_complex": [
            {"id": n.id, "complexity": n.complexity} for n in most_complex
        ],
        "language_breakdown": _language_breakdown(nodes),
        "truncated": file_count >= max_files,
    }

    stats = {
        "files":        len(nodes),
        "edges":        len(edges),
        "total_loc":    sum(n.loc for n in nodes),
        "parsed_files": len(raw_imports),
        "cycles":       len(cycles),
        "has_git":      has_git,
        "truncated":    file_count >= max_files,
        "max_files":    max_files,
    }

    return GraphResult(root=str(root), nodes=nodes, edges=edges,
                       stats=stats, cycles=cycles, insights=insights)


def _language_breakdown(nodes: List[FileNode]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for n in nodes:
        if n.language:
            out[n.language] = out.get(n.language, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: kv[1], reverse=True))
