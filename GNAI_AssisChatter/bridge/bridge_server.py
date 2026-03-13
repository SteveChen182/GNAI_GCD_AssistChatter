import json
import os
import re
import queue
import subprocess
import sys
import threading
import time
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("GNAI_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("GNAI_BRIDGE_PORT", "8775"))
TIMEOUT_SECONDS = int(os.environ.get("GNAI_BRIDGE_TIMEOUT", "240"))
REQUIRE_API_KEY = os.environ.get("GNAI_BRIDGE_API_KEY", "").strip()
DEFAULT_ASSISTANT = os.environ.get("GNAI_BRIDGE_DEFAULT_ASSISTANT", "sighting_assistant")
DT_PATH_OVERRIDE = os.environ.get("GNAI_BRIDGE_DT_PATH", "").strip()
MAX_FOLLOWUP_ROUNDS = int(os.environ.get("GNAI_BRIDGE_MAX_FOLLOWUP_ROUNDS", "0"))
FOLLOWUP_BUDGET_MS = int(os.environ.get("GNAI_BRIDGE_FOLLOWUP_BUDGET_MS", "85000"))
DEBUG_LOG = os.environ.get("GNAI_BRIDGE_DEBUG", "1").strip().lower() in {"1", "true", "yes", "on"}


def _debug(message):
    if DEBUG_LOG:
        sys.stdout.write(f"[bridge-debug] {message}\n")


def _short(text, limit=280):
    value = (text or "").replace("\r", " ").replace("\n", " ").strip()
    if len(value) <= limit:
        return value
    return value[:limit] + "..."


def _resolve_dt_command():
    if DT_PATH_OVERRIDE:
        if os.path.isfile(DT_PATH_OVERRIDE):
            return DT_PATH_OVERRIDE, "override"
        return None, f"override_not_found:{DT_PATH_OVERRIDE}"

    dt_from_path = shutil.which("dt")
    if dt_from_path:
        return dt_from_path, "path"

    return None, "not_found"


def _json_response(handler, status_code, payload):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    try:
        handler.send_response(status_code)
        handler.send_header("Content-Type", "application/json; charset=utf-8")
        handler.send_header("Content-Length", str(len(body)))
        handler.send_header("Access-Control-Allow-Origin", "*")
        handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-gnai-assistant")
        handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        handler.end_headers()
        handler.wfile.write(body)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError) as err:
        # Client disconnected or local socket got aborted before response was written.
        sys.stdout.write(f"[bridge] response write skipped: {err}\n")


def _stream_json_line(handler, payload):
    try:
        body = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
        handler.wfile.write(body)
        handler.wfile.flush()
        return True
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError) as err:
        sys.stdout.write(f"[bridge] stream write skipped: {err}\n")
        return False


def _extract_bearer_token(headers):
    auth = headers.get("Authorization", "")
    if not auth.lower().startswith("bearer "):
        return ""
    return auth[7:].strip()


def _check_auth(headers):
    if not REQUIRE_API_KEY:
        return True
    token = _extract_bearer_token(headers)
    return token == REQUIRE_API_KEY


def _get_last_user_message(messages):
    if not isinstance(messages, list):
        return ""
    for item in reversed(messages):
        if isinstance(item, dict) and item.get("role") == "user":
            content = item.get("content", "")
            if isinstance(content, str) and content.strip():
                return content.strip()
    return ""


def _trim_text(text, limit=2000):
    value = (text or "").strip()
    if len(value) <= limit:
        return value
    return value[:limit] + "\n... [truncated]"


def _build_dt_run_kwargs():
    env = os.environ.copy()
    env["CI"] = "1"
    env.setdefault("TERM", "dumb")
    env.setdefault("PAGER", "cat")
    env.setdefault("GIT_PAGER", "cat")
    env.setdefault("LESS", "-F -X")

    kwargs = {
        "capture_output": True,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "shell": False,
        "stdin": subprocess.DEVNULL,
        "env": env,
    }

    if os.name == "nt":
        create_no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if create_no_window:
            kwargs["creationflags"] = create_no_window

        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = getattr(subprocess, "SW_HIDE", 0)
        kwargs["startupinfo"] = startupinfo

    return kwargs


def _build_dt_popen_kwargs():
    env = os.environ.copy()
    env["CI"] = "1"
    env.setdefault("TERM", "dumb")
    env.setdefault("PAGER", "cat")
    env.setdefault("GIT_PAGER", "cat")
    env.setdefault("LESS", "-F -X")

    kwargs = {
        "stdout": subprocess.PIPE,
        "stderr": subprocess.PIPE,
        "text": True,
        "encoding": "utf-8",
        "errors": "replace",
        "shell": False,
        "stdin": subprocess.DEVNULL,
        "env": env,
        "bufsize": 1,
    }

    if os.name == "nt":
        create_no_window = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if create_no_window:
            kwargs["creationflags"] = create_no_window

        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = getattr(subprocess, "SW_HIDE", 0)
        kwargs["startupinfo"] = startupinfo

    return kwargs


def _run_dt_gnai(prompt_text, assistant_name):
    dt_command, dt_source = _resolve_dt_command()
    if not dt_command:
        return {
            "ok": False,
            "error": (
                "dt command not found. Please install/configure dt CLI first, "
                "or set GNAI_BRIDGE_DT_PATH to full dt executable path."
            ),
            "status": 500,
            "dt_source": dt_source,
        }

    cmd = [
        dt_command,
        "gnai",
        "ask",
        prompt_text,
        "--assistant",
        assistant_name,
    ]

    _debug(f"dt start assistant={assistant_name} dt_source={dt_source} prompt='{_short(prompt_text)}'")

    started = time.time()
    try:
        completed = subprocess.run(cmd, timeout=TIMEOUT_SECONDS, **_build_dt_run_kwargs())
    except FileNotFoundError:
        return {
            "ok": False,
            "error": "dt executable not found. Please check GNAI_BRIDGE_DT_PATH or PATH.",
            "status": 500,
            "dt_source": dt_source,
        }
    except subprocess.TimeoutExpired as err:
        _debug(f"dt timeout after {TIMEOUT_SECONDS}s assistant={assistant_name}")
        return {
            "ok": False,
            "error": f"dt gnai ask timeout after {TIMEOUT_SECONDS}s",
            "status": 504,
            "stdout": _trim_text(err.stdout or ""),
            "stderr": _trim_text(err.stderr or ""),
            "return_code": None,
        }

    duration_ms = int((time.time() - started) * 1000)
    stdout = (completed.stdout or "").strip()
    stderr = (completed.stderr or "").strip()

    if completed.returncode != 0:
        combined = f"{stderr}\n{stdout}".lower()
        hint = ""
        if "press any key" in combined:
            hint = "Detected interactive prompt from dt/underlying command. Bridge now runs non-interactive, but please verify dt side scripts do not enforce pause."

        _debug(
            "dt failed "
            f"code={completed.returncode} duration_ms={duration_ms} "
            f"stderr='{_short(stderr)}' stdout='{_short(stdout)}'"
        )
        return {
            "ok": False,
            "error": stderr or stdout or f"dt gnai ask failed with exit code {completed.returncode}",
            "status": 502,
            "duration_ms": duration_ms,
            "return_code": completed.returncode,
            "dt_source": dt_source,
            "stdout": _trim_text(stdout),
            "stderr": _trim_text(stderr),
            "hint": hint,
        }

    _debug(
        "dt ok "
        f"duration_ms={duration_ms} return_code={completed.returncode} "
        f"content='{_short(stdout or '(empty response)')}'"
    )

    return {
        "ok": True,
        "content": stdout or "(empty response)",
        "duration_ms": duration_ms,
        "return_code": completed.returncode,
        "dt_source": dt_source,
    }


def _run_dt_gnai_stream(prompt_text, assistant_name, on_delta):
    dt_command, dt_source = _resolve_dt_command()
    if not dt_command:
        return {
            "ok": False,
            "error": (
                "dt command not found. Please install/configure dt CLI first, "
                "or set GNAI_BRIDGE_DT_PATH to full dt executable path."
            ),
            "status": 500,
            "dt_source": dt_source,
        }

    cmd = [
        dt_command,
        "gnai",
        "ask",
        prompt_text,
        "--assistant",
        assistant_name,
    ]

    _debug(f"dt stream start assistant={assistant_name} dt_source={dt_source} prompt='{_short(prompt_text)}'")

    started = time.time()
    q = queue.Queue()
    stdout_parts = []
    stderr_parts = []

    def _pump_chars(name, stream):
        try:
            while True:
                ch = stream.read(1)
                if not ch:
                    break
                q.put((name, ch))
        finally:
            q.put((f"{name}_done", None))

    try:
        proc = subprocess.Popen(cmd, **_build_dt_popen_kwargs())
    except FileNotFoundError:
        return {
            "ok": False,
            "error": "dt executable not found. Please check GNAI_BRIDGE_DT_PATH or PATH.",
            "status": 500,
            "dt_source": dt_source,
        }

    t_out = threading.Thread(target=_pump_chars, args=("stdout", proc.stdout), daemon=True)
    t_err = threading.Thread(target=_pump_chars, args=("stderr", proc.stderr), daemon=True)
    t_out.start()
    t_err.start()

    stdout_done = False
    stderr_done = False
    pending = ""
    last_emit = time.time()

    while not (stdout_done and stderr_done):
        if (time.time() - started) > TIMEOUT_SECONDS:
            try:
                proc.kill()
            except Exception:
                pass
            duration_ms = int((time.time() - started) * 1000)
            _debug(f"dt stream timeout after {TIMEOUT_SECONDS}s assistant={assistant_name}")
            return {
                "ok": False,
                "error": f"dt gnai ask timeout after {TIMEOUT_SECONDS}s",
                "status": 504,
                "stdout": _trim_text("".join(stdout_parts)),
                "stderr": _trim_text("".join(stderr_parts)),
                "return_code": None,
                "duration_ms": duration_ms,
                "dt_source": dt_source,
            }

        try:
            kind, data = q.get(timeout=0.2)
        except queue.Empty:
            kind, data = None, None

        if kind == "stdout":
            stdout_parts.append(data)
            pending += data
            now = time.time()
            if len(pending) >= 120 or (pending and (now - last_emit) >= 0.25):
                if on_delta(pending) is False:
                    try:
                        proc.kill()
                    except Exception:
                        pass
                    return {
                        "ok": False,
                        "error": "client disconnected during stream",
                        "status": 499,
                        "stdout": _trim_text("".join(stdout_parts)),
                        "stderr": _trim_text("".join(stderr_parts)),
                        "return_code": None,
                        "duration_ms": int((time.time() - started) * 1000),
                        "dt_source": dt_source,
                    }
                pending = ""
                last_emit = now
        elif kind == "stderr":
            stderr_parts.append(data)
        elif kind == "stdout_done":
            stdout_done = True
        elif kind == "stderr_done":
            stderr_done = True

    if pending:
        if on_delta(pending) is False:
            return {
                "ok": False,
                "error": "client disconnected during stream",
                "status": 499,
                "stdout": _trim_text("".join(stdout_parts)),
                "stderr": _trim_text("".join(stderr_parts)),
                "return_code": None,
                "duration_ms": int((time.time() - started) * 1000),
                "dt_source": dt_source,
            }

    return_code = proc.wait(timeout=5)
    duration_ms = int((time.time() - started) * 1000)
    stdout = "".join(stdout_parts).strip()
    stderr = "".join(stderr_parts).strip()

    if return_code != 0:
        _debug(
            "dt stream failed "
            f"code={return_code} duration_ms={duration_ms} "
            f"stderr='{_short(stderr)}' stdout='{_short(stdout)}'"
        )
        return {
            "ok": False,
            "error": stderr or stdout or f"dt gnai ask failed with exit code {return_code}",
            "status": 502,
            "duration_ms": duration_ms,
            "return_code": return_code,
            "dt_source": dt_source,
            "stdout": _trim_text(stdout),
            "stderr": _trim_text(stderr),
        }

    _debug(
        "dt stream ok "
        f"duration_ms={duration_ms} return_code={return_code} "
        f"content='{_short(stdout or '(empty response)')}'"
    )

    return {
        "ok": True,
        "content": stdout or "(empty response)",
        "duration_ms": duration_ms,
        "return_code": return_code,
        "dt_source": dt_source,
    }


def _looks_like_kickoff_only(content):
    text = (content or "").strip().lower()
    if not text:
        return True

    patterns = [
        r"let me start",
        r"i\s*'?ll analyze",
        r"gathering all (the )?necessary data",
        r"i\s*will analyze",
        r"我會先",
        r"先收集",
        r"開始分析",
        r"先進行",
    ]

    if len(text) < 240:
        for p in patterns:
            if re.search(p, text):
                return True

    return False


def _build_followup_prompt(original_prompt, previous_output):
    return (
        "Your previous reply only described starting the analysis and did not provide the final result. "
        "Please provide the complete final analysis directly. Do not restate process steps or say you are about to start."
        "\n\nOriginal user request:\n"
        f"{original_prompt}\n\n"
        "Your previous reply:\n"
        f"{previous_output}\n\n"
        "Now provide the final deliverable answer directly."
    )


def _run_dt_gnai_with_followup(prompt_text, assistant_name):
    first = _run_dt_gnai(prompt_text, assistant_name)
    if not first.get("ok"):
        return first

    content = first.get("content", "")
    total_duration = int(first.get("duration_ms") or 0)
    rounds = 0
    dt_source = first.get("dt_source")
    return_code = first.get("return_code")

    while rounds < max(0, MAX_FOLLOWUP_ROUNDS) and _looks_like_kickoff_only(content):
        if total_duration >= max(0, FOLLOWUP_BUDGET_MS):
            break

        rounds += 1
        _debug(f"followup round={rounds} triggered for assistant={assistant_name}")
        followup_prompt = _build_followup_prompt(prompt_text, content)
        nxt = _run_dt_gnai(followup_prompt, assistant_name)
        if not nxt.get("ok"):
            nxt["followup_rounds"] = rounds
            nxt["partial_content"] = content
            nxt["duration_ms"] = int(nxt.get("duration_ms") or 0) + total_duration
            return nxt

        content = nxt.get("content", content)
        total_duration += int(nxt.get("duration_ms") or 0)
        dt_source = nxt.get("dt_source", dt_source)
        return_code = nxt.get("return_code", return_code)

        if total_duration >= max(0, FOLLOWUP_BUDGET_MS):
            break

    return {
        "ok": True,
        "content": content,
        "duration_ms": total_duration,
        "return_code": return_code,
        "dt_source": dt_source,
        "followup_rounds": rounds,
    }


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "GNAIBridge/1.0"
    protocol_version = "HTTP/1.1"

    def do_OPTIONS(self):
        _json_response(self, 200, {"ok": True})

    def do_GET(self):
        if self.path in ("/health", "/v1/health"):
            dt_command, dt_source = _resolve_dt_command()
            _json_response(
                self,
                200,
                {
                    "ok": True,
                    "service": "gnai-bridge",
                    "host": HOST,
                    "port": PORT,
                    "timeout_seconds": TIMEOUT_SECONDS,
                    "default_assistant": DEFAULT_ASSISTANT,
                    "requires_api_key": bool(REQUIRE_API_KEY),
                    "streaming": {
                        "enabled": True,
                        "path": "/v1/chat/completions/stream",
                    },
                    "dt": {
                        "resolved": bool(dt_command),
                        "path": dt_command,
                        "source": dt_source,
                    },
                },
            )
            return

        _json_response(self, 404, {"ok": False, "error": "Not found"})

    def do_POST(self):
        if self.path not in (
            "/chat/completions",
            "/v1/chat/completions",
            "/chat/completions/stream",
            "/v1/chat/completions/stream",
        ):
            _json_response(self, 404, {"ok": False, "error": "Not found"})
            return

        if not _check_auth(self.headers):
            _json_response(self, 401, {"ok": False, "error": "Unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            _json_response(self, 400, {"ok": False, "error": "Invalid Content-Length"})
            return

        try:
            raw = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8"))
        except Exception:
            _json_response(self, 400, {"ok": False, "error": "Invalid JSON payload"})
            return

        assistant = (
            self.headers.get("x-gnai-assistant", "").strip()
            or str(payload.get("assistant", "")).strip()
            or DEFAULT_ASSISTANT
        )

        prompt = _get_last_user_message(payload.get("messages"))
        if not prompt:
            _json_response(self, 400, {"ok": False, "error": "No user message found in payload.messages"})
            return

        _debug(
            "request "
            f"path={self.path} assistant={assistant} model={payload.get('model', 'N/A')} "
            f"prompt='{_short(prompt)}'"
        )

        if self.path in ("/chat/completions/stream", "/v1/chat/completions/stream"):
            try:
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
                self.send_header("Cache-Control", "no-cache")
                self.send_header("Connection", "keep-alive")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-gnai-assistant")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.end_headers()
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
                return

            if not _stream_json_line(
                self,
                {
                    "type": "start",
                    "assistant": assistant,
                    "model": payload.get("model", "dt-gnai"),
                    "created": int(time.time()),
                },
            ):
                return

            def _on_delta(delta_text):
                return _stream_json_line(
                    self,
                    {
                        "type": "chunk",
                        "delta": delta_text,
                    },
                )

            stream_result = _run_dt_gnai_stream(prompt, assistant, _on_delta)
            if not stream_result.get("ok"):
                _stream_json_line(
                    self,
                    {
                        "type": "error",
                        "error": stream_result.get("error", "Unknown bridge error"),
                        "assistant": assistant,
                        "dt_source": stream_result.get("dt_source"),
                        "duration_ms": stream_result.get("duration_ms"),
                        "return_code": stream_result.get("return_code"),
                        "stdout": stream_result.get("stdout"),
                        "stderr": stream_result.get("stderr"),
                    },
                )
                return

            _stream_json_line(
                self,
                {
                    "type": "done",
                    "content": stream_result.get("content", ""),
                    "assistant": assistant,
                    "duration_ms": stream_result.get("duration_ms"),
                    "return_code": stream_result.get("return_code"),
                    "dt_source": stream_result.get("dt_source"),
                },
            )
            return

        result = _run_dt_gnai_with_followup(prompt, assistant)
        if not result.get("ok"):
            _debug(
                "response error "
                f"status={result.get('status', 500)} duration_ms={result.get('duration_ms')} "
                f"error='{_short(result.get('error', 'Unknown bridge error'))}'"
            )
            _json_response(
                self,
                int(result.get("status", 500)),
                {
                    "ok": False,
                    "error": result.get("error", "Unknown bridge error"),
                    "assistant": assistant,
                    "dt_source": result.get("dt_source"),
                    "duration_ms": result.get("duration_ms"),
                    "return_code": result.get("return_code"),
                    "stdout": result.get("stdout"),
                    "stderr": result.get("stderr"),
                    "hint": result.get("hint"),
                    "followup_rounds": result.get("followup_rounds", 0),
                    "partial_content": result.get("partial_content"),
                },
            )
            return

        content = result["content"]
        response_payload = {
            "id": f"gnai-{int(time.time() * 1000)}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": payload.get("model", "dt-gnai"),
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": content,
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": None,
                "completion_tokens": None,
                "total_tokens": None,
            },
            "bridge": {
                "assistant": assistant,
                "duration_ms": result.get("duration_ms"),
                "return_code": result.get("return_code"),
                "dt_source": result.get("dt_source"),
                "followup_rounds": result.get("followup_rounds", 0),
            },
        }
        _debug(
            "response ok "
            f"duration_ms={result.get('duration_ms')} followup_rounds={result.get('followup_rounds', 0)} "
            f"content='{_short(content)}'"
        )
        _json_response(self, 200, response_payload)

    def log_message(self, fmt, *args):
        sys.stdout.write("[bridge] " + (fmt % args) + "\n")


def main():
    print(f"Starting GNAI bridge on http://{HOST}:{PORT}")
    print(f"Default assistant: {DEFAULT_ASSISTANT}")
    if REQUIRE_API_KEY:
        print("API key auth: enabled")
    else:
        print("API key auth: disabled")
    print(f"Bridge debug log: {'enabled' if DEBUG_LOG else 'disabled'}")

    server = ThreadingHTTPServer((HOST, PORT), BridgeHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("Bridge stopped.")


if __name__ == "__main__":
    main()
