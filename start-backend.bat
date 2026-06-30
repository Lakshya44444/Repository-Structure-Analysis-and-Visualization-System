@echo off
cd /d "%~dp0backend"
echo [RepoViz] Setting up backend...
if exist "..\\.venv\\Scripts\\activate.bat" (
    call "..\\.venv\\Scripts\\activate.bat"
    echo [RepoViz] Virtual environment activated.
) else (
    echo [RepoViz] No .venv found, using system Python.
)
echo [RepoViz] Installing dependencies...
python -m pip install -r requirements.txt --quiet
echo [RepoViz] Starting FastAPI server on http://127.0.0.1:8000
python -m uvicorn main:app --reload --port 8000
