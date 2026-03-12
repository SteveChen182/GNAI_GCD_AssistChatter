$env:GNAI_BRIDGE_HOST = "127.0.0.1"
$env:GNAI_BRIDGE_PORT = "8775"
$env:GNAI_BRIDGE_TIMEOUT = "240"
$env:GNAI_BRIDGE_DEFAULT_ASSISTANT = "sighting_assistant"
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
