# ── Sync toolkit to C:\dt_sighting (no-spaces path required by dt gnai) ──────
$toolkitSrc = "C:\Users\steveche\OneDrive - Intel Corporation\Documents\Python_Project\GCD_SightingAssistantTool\SightingAssistantTool_latest"
$toolkitDst = "C:\dt_sighting"
if (Test-Path $toolkitSrc) {
    Write-Host "[bridge] syncing toolkit $toolkitSrc -> $toolkitDst"
    New-Item -ItemType Directory -Path $toolkitDst -Force | Out-Null
    foreach ($item in @("toolkit.yaml", "tools", "assistants", "src")) {
        $s = Join-Path $toolkitSrc $item
        $d = Join-Path $toolkitDst $item
        if (Test-Path $s) {
            if (Test-Path $d) { Remove-Item $d -Recurse -Force }
            Copy-Item $s $d -Recurse -Force
        }
    }
    Write-Host "[bridge] toolkit sync done"
} else {
    Write-Warning "[bridge] toolkit source not found: $toolkitSrc (skipping sync)"
}
# ─────────────────────────────────────────────────────────────────────────────

$env:GNAI_BRIDGE_HOST = "127.0.0.1"
$env:GNAI_BRIDGE_PORT = "8775"
$env:GNAI_BRIDGE_TIMEOUT = "360"
$env:GNAI_BRIDGE_DEFAULT_ASSISTANT = "sighting_assistant"
$env:GNAI_BRIDGE_DEBUG = "1"
$env:GNAI_BRIDGE_ECHO_RESPONSE = "1"
$env:GNAI_BRIDGE_MAX_FOLLOWUP_ROUNDS = "0"
$env:GNAI_BRIDGE_STREAM_EMIT_INTERVAL_SECONDS = "0.5"
$env:GNAI_BRIDGE_STREAM_READ_CHARS = "1024"
# Optional:
# $env:GNAI_BRIDGE_API_KEY = "your-local-bridge-token"

# Optional: manually set full dt.exe path if needed.
# Example:
# $manualDtPath = "C:\Tools\dt\dt.exe"
$manualDtPath = "C:\Users\steveche\bin\dt.exe"

if ($manualDtPath -and (Test-Path $manualDtPath)) {
	$env:GNAI_BRIDGE_DT_PATH = $manualDtPath
	Write-Host "[bridge] using manual dt path: $manualDtPath"
} else {
	# Clear stale override so bridge can still try PATH lookup.
	Remove-Item Env:GNAI_BRIDGE_DT_PATH -ErrorAction SilentlyContinue
	$dtCmd = Get-Command dt -ErrorAction SilentlyContinue
	if ($dtCmd) {
		$env:GNAI_BRIDGE_DT_PATH = $dtCmd.Source
		Write-Host "[bridge] using dt from PATH: $($dtCmd.Source)"
	} else {
		Write-Warning "dt not found. Please install dt CLI or set manualDtPath in run_bridge.ps1"
	}
}

python .\bridge_server.py
