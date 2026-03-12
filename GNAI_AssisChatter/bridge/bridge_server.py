import json
import os
import subprocess
import sys
import time
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOST = os.environ.get("GNAI_BRIDGE_HOST", "127.0.0.1")
PORT = int(os.environ.get("GNAI_BRIDGE_PORT", "8775"))
TIMEOUT_SECONDS = int(os.environ.get("GNAI_BRIDGE_TIMEOUT", "240"))
REQUIRE_API_KEY = os.environ.get("GNAI_BRIDGE_API_KEY", "").strip()
DEFAULT_ASSISTANT = os.environ.get("GNAI_BRIDGE_DEFAULT_ASSISTANT", "sighting_assistant")
DT_PATH_OVERRIDE = os.environ.get("GNAI_BRIDGE_DT_PATH", "").strip()


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
    handler.send_response(status_code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-gnai-assistant")
    handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    handler.end_headers()
    handler.wfile.write(body)


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

    started = time.time()
    try:
        completed = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=TIMEOUT_SECONDS,
            shell=False,
        )
    except FileNotFoundError:
        return {
            "ok": False,
            "error": "dt executable not found. Please check GNAI_BRIDGE_DT_PATH or PATH.",
            "status": 500,
            "dt_source": dt_source,
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "error": f"dt gnai ask timeout after {TIMEOUT_SECONDS}s",
            "status": 504,
        }

    duration_ms = int((time.time() - started) * 1000)
    stdout = (completed.stdout or "").strip()
    stderr = (completed.stderr or "").strip()

    if completed.returncode != 0:
        return {
            "ok": False,
            "error": stderr or stdout or f"dt gnai ask failed with exit code {completed.returncode}",
            "status": 502,
            "duration_ms": duration_ms,
            "return_code": completed.returncode,
            "dt_source": dt_source,
        }

    return {
        "ok": True,
        "content": stdout or "(empty response)",
        "duration_ms": duration_ms,
        "return_code": completed.returncode,
        "dt_source": dt_source,
    }


class BridgeHandler(BaseHTTPRequestHandler):
    server_version = "GNAIBridge/1.0"

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
                    "default_assistant": DEFAULT_ASSISTANT,
                    "requires_api_key": bool(REQUIRE_API_KEY),
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
        if self.path not in ("/chat/completions", "/v1/chat/completions"):
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

        result = _run_dt_gnai(prompt, assistant)
        if not result.get("ok"):
            _json_response(
                self,
                int(result.get("status", 500)),
                {
                    "ok": False,
                    "error": result.get("error", "Unknown bridge error"),
                    "assistant": assistant,
                    "dt_source": result.get("dt_source"),
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
            },
        }
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
