# Repository Structure Analysis and Visualization System

A full-stack developer tool that analyzes a local or GitHub repository and renders it as an interactive dependency graph with code metrics, circular dependency detection, hotspot ranking, and AI-generated file summaries.

The goal is to make unfamiliar repositories easier to understand. Instead of only showing folders like a normal file explorer, the system scans source files, extracts internal dependencies, calculates useful metrics, and displays the result on a draggable React Flow canvas.

## Features

### Repository Analysis

- Analyze an absolute local path or a GitHub URL such as `owner/repo` or `https://github.com/user/repo`.
- Static dependency extraction without executing target repository code.
- Python dependency parsing using `ast` with regex fallback.
- JavaScript/TypeScript parsing for `import`, `require`, and `export ... from`.
- C/C++ parsing for `#include`.
- Go parsing with `go.mod` module resolution.
- Supported source file detection for Python, JavaScript, TypeScript, C/C++, Go, Java, Ruby, and Rust.

### Code Metrics

- Lines of code and total lines.
- Estimated cyclomatic complexity.
- File size.
- Fan-in and fan-out coupling.
- Git churn from commit history.
- Hotspot score based on complexity and churn.
- Circular dependency detection using Tarjan's strongly connected components algorithm.

### Visualization

- React Flow canvas with zoom, pan, draggable nodes, minimap, and curved dependency edges.
- Dagre layout for small dense graphs.
- Folder-cluster layout for sparse or large graphs, preventing the graph from becoming a tiny straight line.
- Language, hotspot, and complexity color modes.
- Search, language filter, LoC filter, and cycle-only filter.
- PNG export.

### AI Features

- Click a file node to generate a short plain-English explanation.
- Supports Google Gemini or OpenAI.
- Offline heuristic fallback if no API key is configured.
- Content-hash cache so unchanged files are not re-analyzed.
- Whole-repository architecture overview from graph statistics and dependency samples.

### Deployment and Safety Additions

- Dockerfiles for backend and frontend.
- `docker-compose.yml` for one-command local container startup.
- Basic in-memory rate limiting for expensive API endpoints.
- GitHub clone cache and AI summary cache.
- File-serving guardrails to prevent path traversal outside analyzed roots.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Backend | Python, FastAPI, Pydantic, Uvicorn |
| Analysis | Python `ast`, regex parsing, git CLI |
| Frontend | React, Vite, React Flow |
| Layout | Dagre plus custom folder-cluster layout |
| AI | Gemini, OpenAI, offline fallback |
| Deployment | Docker, Docker Compose, Nginx for frontend container |

## Project Structure

```text
project_gdsc/
|-- backend/
|   |-- main.py            # FastAPI app, API routes, git cloning, rate limiting
|   |-- analyzer.py        # Repository traversal, dependency parsing, metrics
|   |-- ai.py              # AI summaries and SHA-256 cache
|   |-- requirements.txt
|   |-- Dockerfile
|   |-- .env.example
|-- frontend/
|   |-- src/
|   |   |-- App.jsx
|   |   |-- api.js
|   |   |-- graph.js
|   |   |-- components/
|   |   |   |-- FileNode.jsx
|   |   |   |-- FolderGroup.jsx
|   |   |   |-- InsightsPanel.jsx
|   |   |   |-- SidePanel.jsx
|   |-- Dockerfile
|   |-- nginx.conf
|   |-- package.json
|-- docker-compose.yml
|-- start-backend.bat
|-- start-frontend.bat
```

## Run Locally

### Prerequisites

- Python 3.10 or newer
- Node.js 18 or newer
- Git installed and available in PATH

### Backend

```bash
cd backend
python -m pip install -r requirements.txt
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Backend URL:

```text
http://127.0.0.1:8000
```

Swagger API docs:

```text
http://127.0.0.1:8000/docs
```

On Windows, you can also run:

```bash
start-backend.bat
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend URL:

```text
http://127.0.0.1:5173
```

On Windows, you can also run:

```bash
start-frontend.bat
```

## Optional AI Configuration

Copy the example file:

```bash
cd backend
copy .env.example .env
```

Example `.env`:

```env
AI_PROVIDER=auto
GEMINI_API_KEY=
OPENAI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
OPENAI_MODEL=gpt-4o-mini
```

If no key is configured, the project still works with offline summaries.

## Docker Run

From the project root:

```bash
docker compose up --build
```

Then open:

```text
Frontend: http://127.0.0.1:5173
Backend:  http://127.0.0.1:8000
Docs:     http://127.0.0.1:8000/docs
```

Optional environment variables:

```bash
set GEMINI_API_KEY=your_key_here
set AI_RATE_LIMIT=30
set ANALYZE_RATE_LIMIT=20
docker compose up --build
```

On Linux/macOS:

```bash
GEMINI_API_KEY=your_key_here docker compose up --build
```

## Testing Workflow

1. Start backend and frontend.
2. Open `http://127.0.0.1:5173`.
3. Enter a repository URL, for example:

```text
https://github.com/Lakshya44444/DrishtiAI
```

or:

```text
https://github.com/rootp1/koordinator
```

4. Click **Analyze**.
5. Inspect repository stats, folder groups, file nodes, and dependency edges.
6. Click a file node to view metrics, dependencies, source code, and AI summary.
7. Open `http://127.0.0.1:8000/docs` and test the backend endpoints directly.

## API Endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Backend status and active AI provider |
| `POST` | `/api/analyze` | Analyze a local path or GitHub repository |
| `GET` | `/api/file` | Fetch raw source for a selected file |
| `POST` | `/api/summarize` | Generate or read cached AI summary for one file |
| `POST` | `/api/architecture` | Generate or read cached repository overview |

Example `/api/analyze` request:

```json
{
  "path": "https://github.com/Lakshya44444/DrishtiAI",
  "max_files": 900
}
```

## Rate Limiting

The backend includes simple in-memory per-client rate limiting:

| Bucket | Default |
| --- | --- |
| `/api/analyze` | 20 requests per minute |
| `/api/summarize` and `/api/architecture` | 30 requests per minute |
| Other endpoints | 240 requests per minute |

Override with environment variables:

```env
ANALYZE_RATE_LIMIT=20
AI_RATE_LIMIT=30
GENERAL_RATE_LIMIT=240
```

Set a value to `0` to disable that bucket.

## Assumptions and Limitations

- The analyzer is static; it does not execute target code.
- External packages such as `react`, `numpy`, and `fastapi` are intentionally skipped.
- Dynamic imports, reflection, generated code, and dependency injection may not be fully detected.
- Git churn requires git history in the analyzed repository.
- Large repositories are capped for browser performance.
- Frontend default request size is 900 source files.
- Backend hard cap is 1500 source files.
- Docker setup is suitable for local/demo deployment, not hardened public production.

## Extra Verification Points

These features go beyond the base requirement:

- GitHub URL analysis with shallow clone and local clone cache.
- AI summaries with Gemini/OpenAI plus offline fallback.
- Content-hash AI cache to reduce API cost.
- Circular dependency detection.
- Hotspot ranking using complexity and git churn.
- Folder grouping for sparse repositories.
- Large-repository safeguards.
- Syntax-highlighted source viewer.
- PNG export.
- FastAPI Swagger docs.
- Docker Compose deployment.
- Basic API rate limiting.

## Security Notes

- File reads are restricted to roots analyzed in the current backend session.
- Path traversal attempts are rejected.
- CORS is open for local development. Restrict `allow_origins` before public deployment.
- Rate limiting is in-memory and resets on backend restart. A production deployment should use Redis or an API gateway for distributed rate limiting.

## Recommended Demo Repositories

```text
https://github.com/Lakshya44444/DrishtiAI
https://github.com/rootp1/koordinator
```

DrishtiAI is good for showing folder grouping and AI summaries. Koordinator is good for showing large-repository performance handling.
