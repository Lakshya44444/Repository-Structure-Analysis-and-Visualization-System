from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


def _load_dotenv() -> None:
    """Minimal .env loader (no external dependency)."""
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = val


_load_dotenv()

import ai          # noqa: E402  (import after .env load so keys are visible)
import analyzer    # noqa: E402

app = FastAPI(title="Repo Structure Analyzer", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_ANALYZED_ROOTS: set[str] = set()


class AnalyzeRequest(BaseModel):
    path: str
    max_files: int = 900


class NodeOut(BaseModel):
    id: str
    label: str
    language: Optional[str]
    loc: int
    total_lines: int
    complexity: int
    size_bytes: int
    folder: str
    churn: int
    hotspot: float
    in_cycle: bool
    fan_in: int
    fan_out: int


class EdgeOut(BaseModel):
    source: str
    target: str
    kind: str
    cycle: bool


class AnalyzeResponse(BaseModel):
    root: str
    nodes: List[NodeOut]
    edges: List[EdgeOut]
    stats: dict
    cycles: List[List[str]]
    insights: dict


class SummarizeRequest(BaseModel):
    root: str
    path: str
    force: bool = False
    imports: List[str] = []
    imported_by: List[str] = []


class ArchitectureRequest(BaseModel):
    root: str
    digest: str
    force: bool = False


_REPO_CACHE = Path(__file__).parent / ".repos"
_REPO_CACHE.mkdir(exist_ok=True)

_GIT_URL_RE = re.compile(
    r"^(https?://|git@|ssh://|git://).+|^[\w.-]+/[\w.-]+$"
)


def _is_within(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


@app.get("/")
def index():
    return {"name": "Repo Structure Analyzer API", "docs": "/docs"}


@app.get("/api/health")
def health():
    provider, model, _ = ai._resolve_provider()
    return {"status": "ok", "ai_provider": provider, "ai_model": model}


def _looks_like_git_url(s: str) -> bool:
    if os.path.isabs(s) or (len(s) > 1 and s[1] == ":"):  # local / Windows path
        return False
    return bool(_GIT_URL_RE.match(s))


def _clone_repo(url: str) -> Path:
    normalized = url
    if re.match(r"^[\w.-]+/[\w.-]+$", url):
        normalized = f"https://github.com/{url}.git"
    key = hashlib.sha256(normalized.encode()).hexdigest()[:16]
    dest = _REPO_CACHE / key
    if dest.exists():
        return dest  # reuse previous clone
    try:
        proc = subprocess.run(
            ["git", "clone", "--depth", "20", normalized, str(dest)],
            capture_output=True, text=True, timeout=120,
        )
    except FileNotFoundError:
        raise HTTPException(500, "git is not installed on the server")
    except subprocess.TimeoutExpired:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(504, "git clone timed out")
    if proc.returncode != 0:
        shutil.rmtree(dest, ignore_errors=True)
        raise HTTPException(400, f"git clone failed: {proc.stderr.strip()[:300]}")
    return dest


@app.post("/api/analyze", response_model=AnalyzeResponse)
def analyze_repo(req: AnalyzeRequest):
    raw = req.path.strip()
    if not raw:
        raise HTTPException(400, "path is required")

    if _looks_like_git_url(raw):
        path = str(_clone_repo(raw))
    else:
        path = os.path.expanduser(raw)

    try:
        result = analyzer.analyze(path, max_files=min(max(req.max_files, 1), 1500))
    except FileNotFoundError as e:
        raise HTTPException(404, str(e))
    except PermissionError as e:
        raise HTTPException(403, str(e))

    _ANALYZED_ROOTS.add(str(Path(result.root).resolve()))

    return AnalyzeResponse(
        root=result.root,
        nodes=[NodeOut(id=n.id, label=n.label, language=n.language, loc=n.loc,
                       total_lines=n.total_lines, complexity=n.complexity,
                       size_bytes=n.size_bytes, folder=n.folder, churn=n.churn,
                       hotspot=n.hotspot, in_cycle=n.in_cycle, fan_in=n.fan_in,
                       fan_out=n.fan_out)
               for n in result.nodes],
        edges=[EdgeOut(source=e.source, target=e.target, kind=e.kind,
                       cycle=e.cycle)
               for e in result.edges],
        stats=result.stats,
        cycles=result.cycles,
        insights=result.insights,
    )


def _resolve_in_root(root: str, rel_path: str) -> Path:
    root_p = Path(root).resolve()
    if str(root_p) not in _ANALYZED_ROOTS:
        if not any(_is_within(root_p, Path(r)) or str(root_p) == r
                   for r in _ANALYZED_ROOTS):
            raise HTTPException(403, "root has not been analyzed in this session")
    target = (root_p / rel_path).resolve()
    if not _is_within(target, root_p):
        raise HTTPException(403, "path escapes analyzed root")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "file not found")
    return target


@app.get("/api/file")
def get_file(root: str, path: str):
    target = _resolve_in_root(root, path)
    try:
        text = target.read_text(encoding="utf-8", errors="ignore")
    except OSError as e:
        raise HTTPException(500, str(e))
    return {"path": path, "content": text}


@app.post("/api/summarize")
def summarize_file(req: SummarizeRequest):
    target = _resolve_in_root(req.root, req.path)
    ext = target.suffix.lower()
    language = analyzer.LANG_BY_EXT.get(ext)
    try:
        content = target.read_text(encoding="utf-8", errors="ignore")
    except OSError as e:
        raise HTTPException(500, str(e))
    result = ai.summarize(
        content, target.name, language, force=req.force,
        imports=req.imports, imported_by=req.imported_by,
    )
    result["path"] = req.path
    return result


@app.post("/api/architecture")
def architecture_overview(req: ArchitectureRequest):
    root_p = Path(req.root).resolve()
    if str(root_p) not in _ANALYZED_ROOTS:
        raise HTTPException(403, "root has not been analyzed in this session")
    return ai.summarize_architecture(req.digest, force=req.force)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
