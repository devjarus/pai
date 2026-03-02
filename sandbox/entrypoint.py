"""
PAI Sandbox — Isolated code execution server.

HTTP API on port 8888:
  GET  /health              → {"ok": true, "languages": ["python", "node"]}
  POST /run                 → Execute code and return results
       Body: {"language": "python"|"node", "code": "...", "timeout": 30}
       Response: {"stdout": "...", "stderr": "...", "exitCode": 0, "files": [...]}

Files written to /output/ inside the execution are returned as base64-encoded entries.
"""

import json
import os
import sys
import base64
import subprocess
import shutil
import tempfile
import time
import signal
from http.server import HTTPServer, BaseHTTPRequestHandler

MAX_TIMEOUT = 120
DEFAULT_TIMEOUT = 30
MAX_OUTPUT_BYTES = 100 * 1024  # 100KB stdout/stderr cap
MAX_CODE_BYTES = 512 * 1024    # 512KB max code size
OUTPUT_DIR_NAME = "output"

# Minimal env vars passed to subprocess — never leak host secrets
SAFE_ENV = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "HOME": "/tmp",
    "LANG": "C.UTF-8",
    "PYTHONUNBUFFERED": "1",
    "MPLBACKEND": "Agg",
}


def log(level: str, msg: str, **kwargs):
    """Structured JSON log line to stdout (visible in docker logs)."""
    entry = {"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "level": level, "msg": msg, **kwargs}
    print(json.dumps(entry), flush=True)


class SandboxHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        # Suppress default BaseHTTPRequestHandler access logs; we log structured JSON instead
        pass

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"ok": True, "languages": ["python", "node"]})
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path != "/run":
            self._send_json({"error": "not found"}, 404)
            return

        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > MAX_CODE_BYTES:
            self._send_json({"error": f"request too large (max {MAX_CODE_BYTES} bytes)"}, 413)
            return

        raw = self.rfile.read(content_length)

        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError:
            log("warn", "invalid JSON in request body")
            self._send_json({"error": "invalid JSON"}, 400)
            return

        language = body.get("language", "python")
        code = body.get("code", "")
        timeout = min(int(body.get("timeout", DEFAULT_TIMEOUT)), MAX_TIMEOUT)

        if language not in ("python", "node"):
            self._send_json({"error": f"unsupported language: {language}"}, 400)
            return

        if not code.strip():
            self._send_json({"error": "empty code"}, 400)
            return

        log("info", "exec start", language=language, codeLen=len(code), timeout=timeout)
        start = time.monotonic()
        result = execute_code(language, code, timeout)
        duration_ms = int((time.monotonic() - start) * 1000)
        log(
            "info" if result["exitCode"] == 0 else "warn",
            "exec done",
            language=language,
            exitCode=result["exitCode"],
            stdoutLen=len(result["stdout"]),
            stderrLen=len(result["stderr"]),
            files=len(result["files"]),
            durationMs=duration_ms,
        )
        self._send_json(result)


def execute_code(language: str, code: str, timeout: int) -> dict:
    """Run code in a subprocess with timeout and output directory."""
    work_dir = tempfile.mkdtemp(prefix="sandbox-")
    output_dir = os.path.join(work_dir, OUTPUT_DIR_NAME)
    os.makedirs(output_dir, exist_ok=True)

    ext = ".py" if language == "python" else ".js"
    script_path = os.path.join(work_dir, f"script{ext}")

    # Inject output directory path so scripts can save files there
    if language == "python":
        header = f'import os; os.environ["OUTPUT_DIR"] = {repr(output_dir)}\n'
    else:
        header = f'process.env.OUTPUT_DIR = {json.dumps(output_dir)};\n'

    with open(script_path, "w") as f:
        f.write(header + code)

    cmd = ["python3", script_path] if language == "python" else ["node", script_path]

    stdout = ""
    stderr = ""
    exit_code = 1

    try:
        # Use Popen so we can kill the whole process group on timeout
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=work_dir,
            env={**SAFE_ENV, "OUTPUT_DIR": output_dir},
            # Run in new process group so we can kill all children
            preexec_fn=os.setsid,
        )
        try:
            raw_stdout, raw_stderr = proc.communicate(timeout=timeout)
            stdout = raw_stdout.decode("utf-8", errors="replace")[:MAX_OUTPUT_BYTES]
            stderr = raw_stderr.decode("utf-8", errors="replace")[:MAX_OUTPUT_BYTES]
            exit_code = proc.returncode
        except subprocess.TimeoutExpired:
            # Kill the entire process group (script + any children it spawned)
            try:
                os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
            except OSError:
                proc.kill()
            # Drain any partial output that was produced before timeout
            raw_stdout, raw_stderr = proc.communicate(timeout=5)
            stdout = raw_stdout.decode("utf-8", errors="replace")[:MAX_OUTPUT_BYTES]
            stderr_partial = raw_stderr.decode("utf-8", errors="replace")[:MAX_OUTPUT_BYTES]
            stderr = f"Execution timed out after {timeout}s\n{stderr_partial}".strip()
            exit_code = 124
            log("warn", "exec timeout, killed process group", pid=proc.pid, timeout=timeout)
    except Exception as e:
        stdout = ""
        stderr = str(e)
        exit_code = 1

    # Collect output files
    files = []
    if os.path.isdir(output_dir):
        for fname in sorted(os.listdir(output_dir)):
            fpath = os.path.join(output_dir, fname)
            if os.path.isfile(fpath) and os.path.getsize(fpath) < 5 * 1024 * 1024:  # 5MB max per file
                with open(fpath, "rb") as f:
                    data = base64.b64encode(f.read()).decode("ascii")
                files.append({"name": fname, "data": data, "size": os.path.getsize(fpath)})

    # Cleanup
    shutil.rmtree(work_dir, ignore_errors=True)

    return {
        "stdout": stdout,
        "stderr": stderr,
        "exitCode": exit_code,
        "files": files,
    }


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8888"))
    server = HTTPServer(("0.0.0.0", port), SandboxHandler)
    log("info", "sandbox server started", port=port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("info", "sandbox server shutting down")
    server.server_close()
