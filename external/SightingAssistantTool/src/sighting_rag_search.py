import base64
import json
import os
import sys
import urllib.parse

import requests

DEFAULT_MAX_DOCUMENTS = 10
DEFAULT_GNAI_URL = "https://gnai.intel.com/api"


def to_int(value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def resolve_gnai_url() -> str:
    gnai_url = os.environ.get("GNAI_URL", "").strip()
    if gnai_url:
        # Normalize to avoid double slashes when appending paths
        return gnai_url.rstrip("/")
    return DEFAULT_GNAI_URL.rstrip("/")


def build_auth_header(username: str, password: str) -> dict:
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("utf-8")
    return {"Authorization": f"Basic {token}"}


def print_result(lines: list[str]) -> None:
    payload = {
        "__meta__": {"type": "tool-result", "version": "v1"},
        "output": "\n".join(lines),
    }
    print(json.dumps(payload, ensure_ascii=False))


def main() -> int:
    stdout_reconfigure = getattr(sys.stdout, "reconfigure", None)
    if callable(stdout_reconfigure):
        stdout_reconfigure(encoding="utf-8")

    stderr_reconfigure = getattr(sys.stderr, "reconfigure", None)
    if callable(stderr_reconfigure):
        stderr_reconfigure(encoding="utf-8")

    search_query = os.environ.get("GNAI_INPUT_SEARCH_QUERY", "").strip()
    profile = os.environ.get("GNAI_INPUT_PROFILE", "").strip()
    max_documents = to_int(os.environ.get("GNAI_INPUT_MAX_DOCUMENTS"), DEFAULT_MAX_DOCUMENTS)

    if not search_query:
        print_result(["ERROR: search_query is required"])
        return 1
    if not profile:
        print_result(["ERROR: profile is required"])
        return 1
    if profile != "gpu-debug":
        print_result([f"ERROR: invalid profile '{profile}'. Only 'gpu-debug' is supported."])
        return 1

    username = os.environ.get("INTEL_USERNAME", "").strip()
    password = os.environ.get("INTEL_PASSWORD", "").strip()
    if not username or not password:
        print_result(["ERROR: INTEL_USERNAME and INTEL_PASSWORD are required"])
        return 1

    base_url = resolve_gnai_url()
    headers = build_auth_header(username, password)

    # Run vector similarity search
    params = urllib.parse.urlencode({
        "profile": profile,
        "retrieval_type": "hybrid",
        "max_documents": max_documents,
    })
    try:
        search_resp = requests.post(
            f"{base_url}/rag/vector/search?{params}",
            headers=headers,
            json={"question": search_query, "filters": {}},
            timeout=120,
        )
    except requests.RequestException as exc:
        print_result([f"ERROR: vector search request failed: {exc}"])
        return 1
    if not search_resp.ok:
        print_result([f"ERROR: vector search failed: {search_resp.status_code} {search_resp.text}"])
        return 1
    try:
        response_data = search_resp.json()
    except ValueError as exc:
        print_result([f"ERROR: failed to parse vector search response as JSON: {exc}"])
        return 1

    results = response_data.get("items", [])
    lines = [f"Found {len(results)} documents via RAG vector similarity search (profile={profile})"]
    for issue in results:
        lines.append("")
        lines.append(f"### {issue.get('title', '')}")
        lines.append(f"link: {issue.get('url', '')}")
        lines.append(issue.get("page_content") or "")

    print_result(lines)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
