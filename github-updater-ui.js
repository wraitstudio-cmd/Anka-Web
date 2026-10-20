const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { app, ipcMain, BrowserWindow } = require('electron');
const { createSplash } = require('./splash');

const OWNER = 'wraitstudio-cmd';
const REPO = 'Anka-Web';
const MANIFEST_URL = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/refs/heads/main/latest.yml';
const MANIFEST_PATH = '/' + OWNER + '/' + REPO + '/refs/heads/main/latest.yml';
const DOWNLOAD_PATH_PREFIX = '/' + OWNER + '/' + REPO + '/releases/download/';
const DOWNLOAD_URL_PREFIX = 'https://github.com' + DOWNLOAD_PATH_PREFIX;
const RELEASE_API_PREFIX = '/repos/' + OWNER + '/' + REPO + '/releases/tags/';
const LATEST_API_PATH = '/repos/' + OWNER + '/' + REPO + '/releases/latest';
const UI_VERSION = 21;
const FIRST_CHECK_DELAY = 800;
const CHECK_INTERVAL = 5 * 60 * 1000;
const FOCUS_CHECK_GAP = 60 * 1000;
const PROMPT_TIMEOUT = 10000;
const REQUEST_TIMEOUT = 10000;
const MAX_REDIRECTS = 5;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_MARKER_BYTES = 4096;
const MAX_DOWNLOAD_BYTES = 800 * 1024 * 1024;
const PROGRESS_MS = 90;
const MARKER_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const NOTES_MAX = 600;
const POLL_MS = 200;
const HANDOFF_DELAY = 400;
const CLAIM_WAIT = 25000;
const CLAIM_POLL = 50;
const MARKER_FILE = 'anka-last-update.json';
const UPDATER_DIR = 'updater';
const DOWNLOAD_PREFIX = 'download-';
const WIN_JOB_FILE = 'job.json';
const WIN_SCRIPT_FILE = 'anka-updater.ps1';
const WIN_VBS_FILE = 'launch.vbs';
const LINUX_JOB_FILE = 'job.env';
const LINUX_SCRIPT_FILE = 'anka-updater.sh';
const ACTION_CHANNEL = 'anka-updater:action';
const ACTIONS = new Set(['later', 'close', 'install', 'retry', 'update', 'skip']);
const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;
const FILE_RE = /^[A-Za-z0-9._+()@ -]{1,200}$/;
const TAG_RE = /^[A-Za-z0-9._-]{1,100}$/;
const HASH_RE = /^[a-f0-9]{64}$/;
const DIGEST_RE = /^sha256:([A-Fa-f0-9]{64})$/;
const TRANSIENT_CODES = new Set(['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET', 'EPIPE']);
const EXTENSIONS = { exe: '.exe', msi: '.msi', deb: '.deb', rpm: '.rpm', appimage: '.AppImage', targz: '.tar.gz' };
const STRIPPED_ENV = ['APPIMAGE', 'APPDIR', 'ARGV0', 'OWD'];
const GUI_ENV = ['DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP', 'XDG_SESSION_DESKTOP', 'LANG'];
const BIN_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'];
const SH_BIN = '/bin/sh';
const LOG_DIR_NAME = 'anka-web-updater';
const LOG_MAX_BYTES = 1024 * 1024;

let mainLogPath = null;
let crashLogPath = null;
let logFallbackConsole = false;

function testWritable(dir) {
    try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        const probe = path.join(dir, '.probe-' + process.pid + '-' + Date.now());
        fs.writeFileSync(probe, 'x', { mode: 0o600 });
        fs.unlinkSync(probe);
        return true;
    } catch (err) {
        return false;
    }
}

function initLogging() {
    const candidates = [];
    try { candidates.push(path.join(os.tmpdir(), LOG_DIR_NAME)); } catch (e) {}
    try { candidates.push(path.join(os.homedir(), '.' + LOG_DIR_NAME)); } catch (e) {}
    try { candidates.push(path.join(process.cwd(), LOG_DIR_NAME)); } catch (e) {}
    try {
        if (app && typeof app.getPath === 'function') {
            candidates.push(path.join(app.getPath('userData'), 'logs'));
        }
    } catch (e) {}

    for (const dir of candidates) {
        if (testWritable(dir)) {
            mainLogPath = path.join(dir, 'main.log');
            crashLogPath = path.join(dir, 'crash.log');
            try {
                if (fs.existsSync(mainLogPath) && fs.statSync(mainLogPath).size > LOG_MAX_BYTES) {
                    fs.writeFileSync(mainLogPath, '');
                }
            } catch (e) {}
            return;
        }
    }
    logFallbackConsole = true;
}

function writeLog(file, prefix, args) {
    const parts = Array.prototype.map.call(args, (a) => {
        try {
            if (a instanceof Error) return a.stack || a.message || String(a);
            if (typeof a === 'string') return a;
            return JSON.stringify(a);
        } catch (e) {
            return String(a);
        }
    });
    const line = new Date().toISOString() + ' [' + prefix + '] ' + parts.join(' ');
    if (file) {
        try {
            fs.appendFileSync(file, line + '\n', { mode: 0o600 });
            return;
        } catch (err) {}
    }
    if (logFallbackConsole) {
        try { process.stderr.write(line + '\n'); } catch (e) {}
    }
}

function logInfo() { writeLog(mainLogPath, 'INFO', arguments); }
function logWarn() { writeLog(mainLogPath, 'WARN', arguments); }
function logError() {
    writeLog(mainLogPath, 'ERROR', arguments);
    writeLog(crashLogPath, 'ERROR', arguments);
}

function installGlobalHandlers() {
    process.on('uncaughtException', (err) => {
        try { logError('uncaughtException', err); } catch (e) {}
    });
    process.on('unhandledRejection', (reason) => {
        try { logError('unhandledRejection', reason); } catch (e) {}
    });
    process.on('warning', (warning) => {
        try { logWarn('warning', warning && warning.message ? warning.message : warning); } catch (e) {}
    });
}

initLogging();
if (!global.__ankaUpdaterHandlers) {
    global.__ankaUpdaterHandlers = true;
    installGlobalHandlers();
}

function safeCall(fn, fallback) {
    try {
        const result = fn();
        return result === undefined ? fallback : result;
    } catch (err) {
        logError('safeCall', err);
        return fallback;
    }
}

async function safeAsync(fn, fallback) {
    try {
        return await fn();
    } catch (err) {
        logError('safeAsync', err);
        return fallback;
    }
}

const WIN_TASK_SCRIPT = [
'$ErrorActionPreference = "SilentlyContinue"',
'$ProgressPreference = "SilentlyContinue"',
'$WarningPreference = "SilentlyContinue"',
'$InformationPreference = "SilentlyContinue"',
'$VerbosePreference = "SilentlyContinue"',
'$DebugPreference = "SilentlyContinue"',
'try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}',
'try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}',
'',
'$dir = Split-Path -Parent $MyInvocation.MyCommand.Path',
'$jobFile = Join-Path $dir "job.json"',
'$logFile = Join-Path $dir "updater.log"',
'$statusFile = Join-Path $dir "status.js"',
'',
'function Log {',
'    param($m)',
'    try {',
'        $line = (Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fff") + " " + $m',
'        Add-Content -Path $logFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue',
'    } catch {}',
'    try {',
'        $tmpDir = Join-Path $env:TEMP "anka-web-updater"',
'        if (-not (Test-Path -LiteralPath $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null }',
'        $tmpLog = Join-Path $tmpDir "updater.log"',
'        Add-Content -Path $tmpLog -Value $m -Encoding UTF8 -ErrorAction SilentlyContinue',
'    } catch {}',
'}',
'',
'function Write-Status {',
'    param($phase, $percent, $received, $total, $speed, $message)',
'    try {',
'        $obj = [ordered]@{',
'            phase = [string]$phase',
'            percent = [int]$percent',
'            received = [long]$received',
'            total = [long]$total',
'            speed = [double]$speed',
'        }',
'        if ($message) { $obj["message"] = [string]$message }',
'        $json = $obj | ConvertTo-Json -Compress -Depth 3',
'        $content = "window.__updateStatus && window.__updateStatus(" + $json + ");"',
'        [IO.File]::WriteAllText($statusFile, $content, [Text.Encoding]::UTF8)',
'    } catch {}',
'}',
'',
'function Test-Exe {',
'    param($p)',
'    if (-not $p) { return $false }',
'    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $false }',
'    $n = [IO.Path]::GetFileName($p)',
'    if ($n -notlike "*.exe") { return $false }',
'    if ($n -match "^(unins|uninstall|electron|squirrel|update)") { return $false }',
'    return $true',
'}',
'',
'function Find-InDir {',
'    param($d)',
'    if (-not $d) { return "" }',
'    if (-not (Test-Path -LiteralPath $d -PathType Container)) { return "" }',
'    $f = Get-ChildItem -LiteralPath $d -Filter "*.exe" -File -ErrorAction SilentlyContinue | Where-Object { Test-Exe $_.FullName } | Sort-Object Length -Descending | Select-Object -First 1',
'    if ($f) { return $f.FullName }',
'    return ""',
'}',
'',
'function Find-App {',
'    param($job)',
'    $self = [string]$job.exec',
'    if (Test-Exe $self) { return $self }',
'    $name = [string]$job.name',
'    $keys = @(',
'        "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
'        "HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*",',
'        "HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*"',
'    )',
'    foreach ($k in $keys) {',
'        $items = @(Get-ItemProperty -Path $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and (($name -and $_.DisplayName -like ($name + "*")) -or $_.DisplayName -like "Anka*") })',
'        foreach ($it in $items) {',
'            $icon = ([string]$it.DisplayIcon) -replace ",\\s*-?\\d+$", "" -replace [char]34, ""',
'            if (Test-Exe $icon) { return $icon }',
'            $found = Find-InDir ([string]$it.InstallLocation)',
'            if ($found) { return $found }',
'        }',
'    }',
'    $pf86 = [Environment]::GetEnvironmentVariable("ProgramFiles(x86)")',
'    $roots = @((Join-Path $env:LOCALAPPDATA "Programs"), $env:ProgramFiles, $pf86)',
'    foreach ($root in $roots) {',
'        if (-not $root) { continue }',
'        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }',
'        $filters = @("Anka*")',
'        if ($name) { $filters = @(($name + "*"), "Anka*") }',
'        foreach ($flt in $filters) {',
'            $dirs = @(Get-ChildItem -LiteralPath $root -Directory -Filter $flt -ErrorAction SilentlyContinue)',
'            foreach ($d in $dirs) {',
'                $found = Find-InDir $d.FullName',
'                if ($found) { return $found }',
'            }',
'        }',
'    }',
'    return ""',
'}',
'',
'Log "updater basladi"',
'Log ("dir=" + $dir)',
'',
'if (-not (Test-Path -LiteralPath $jobFile)) {',
'    Log "job.json bulunamadi"',
'    Write-Status "error" 0 0 0 0 "Gorev dosyasi bulunamadi"',
'    Start-Sleep -Seconds 3',
'    exit 1',
'}',
'',
'$job = $null',
'try {',
'    $raw = Get-Content -Raw -Encoding UTF8 -LiteralPath $jobFile',
'    $job = $raw | ConvertFrom-Json',
'} catch {',
'    Log ("job parse hatasi: " + $_.Exception.Message)',
'}',
'',
'try { Remove-Item -LiteralPath $jobFile -Force -ErrorAction SilentlyContinue } catch {}',
'Log "job.json okundu ve silindi"',
'',
'if (-not $job) {',
'    Write-Status "error" 0 0 0 0 "Gorev dosyasi okunamadi"',
'    Start-Sleep -Seconds 3',
'    exit 1',
'}',
'',
'Write-Status "download" 0 0 0 0 "Hazirlaniyor"',
'',
'$tmp = Join-Path $dir ("anka-web-" + [string]$job.version + ".exe")',
'$failed = $false',
'$useFile = $false',
'$pre = [string]$job.file',
'if ($pre -and ($pre -notlike "*..*") -and $pre.StartsWith($dir, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $pre -PathType Leaf)) { $tmp = $pre; $useFile = $true }',
'',
'try {',
'    $urlStr = [string]$job.url',
'    if (-not $urlStr) { throw "URL eksik" }',
'    $uri = [Uri]$urlStr',
'    if ($uri.Scheme -ne "https") { throw "HTTPS gerekli" }',
'    if ($uri.Host -ne "github.com") { throw "Gecersiz host" }',
'    if (-not $uri.AbsolutePath.StartsWith("__PREFIX__")) { throw "Gecersiz yol" }',
'',
'    Log ("url=" + $urlStr)',
'',
'    $procId = [int]$job.pid',
'    if ($procId -gt 0) {',
'        try { Wait-Process -Id $procId -Timeout 20 -ErrorAction SilentlyContinue } catch {}',
'        $alive = Get-Process -Id $procId -ErrorAction SilentlyContinue',
'        if ($alive) {',
'            try { $alive.Kill(); $alive.WaitForExit(8000) | Out-Null } catch {}',
'        }',
'    }',
'    Start-Sleep -Milliseconds 400',
'',
'    if (-not $useFile) {',
'    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }',
'',
'    Write-Status "download" 0 0 0 0 "Baglanti kuruluyor"',
'',
'    $request = [Net.HttpWebRequest]::Create($uri)',
'    $request.UserAgent = "AnkaWeb-Updater"',
'    $request.AllowAutoRedirect = $true',
'    $request.Timeout = 30000',
'    $request.ReadWriteTimeout = 30000',
'',
'    $response = $request.GetResponse()',
'    try {',
'        $total = [long]$response.ContentLength',
'        if ($total -lt 0) { $total = 0 }',
'        $netStream = $response.GetResponseStream()',
'        $fileStream = [IO.File]::Create($tmp)',
'        try {',
'            $buffer = New-Object byte[] 1048576',
'            $received = [long]0',
'            $clock = [Diagnostics.Stopwatch]::StartNew()',
'            $lastWrite = [long]0',
'            $lastBytes = [long]0',
'            while (($read = $netStream.Read($buffer, 0, $buffer.Length)) -gt 0) {',
'                $fileStream.Write($buffer, 0, $read)',
'                $received += $read',
'                $elapsed = $clock.ElapsedMilliseconds',
'                if (($elapsed - $lastWrite) -ge 100) {',
'                    $percent = 0',
'                    if ($total -gt 0) { $percent = [int][Math]::Floor(($received * 100) / $total) }',
'                    if ($percent -gt 99 -and $received -lt $total) { $percent = 99 }',
'                    $deltaTime = ($elapsed - $lastWrite) / 1000.0',
'                    $deltaBytes = $received - $lastBytes',
'                    $speed = 0',
'                    if ($deltaTime -gt 0) { $speed = ($deltaBytes / 1MB) / $deltaTime }',
'                    Write-Status "download" $percent $received $total $speed "Indiriliyor"',
'                    $lastWrite = $elapsed',
'                    $lastBytes = $received',
'                }',
'            }',
'            Write-Status "download" 100 $received $total 0 "Indirme tamamlandi"',
'        } finally {',
'            try { $fileStream.Close() } catch {}',
'            try { $netStream.Close() } catch {}',
'        }',
'    } finally {',
'        try { $response.Close() } catch {}',
'    }',
'    }',
'',
'    Write-Status "verify" 100 0 0 0 "Dogrulaniyor"',
'    Log "indirme tamamlandi"',
'',
'    $info = Get-Item -LiteralPath $tmp -ErrorAction SilentlyContinue',
'    if (-not $info) { throw "Indirilen dosya bulunamadi" }',
'    if ($info.Length -lt 1024) { throw "Indirilen dosya gecersiz" }',
'    $stream = [IO.File]::OpenRead($tmp)',
'    try {',
'        $b1 = $stream.ReadByte()',
'        $b2 = $stream.ReadByte()',
'    } finally {',
'        try { $stream.Close() } catch {}',
'    }',
'    if ($b1 -ne 0x4d -or $b2 -ne 0x5a) { throw "Gecerli bir kurulum dosyasi degil" }',
'    $expected = ([string]$job.hash).ToLower()',
'    if ($expected) {',
'        $actual = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256 -ErrorAction Stop).Hash.ToLower()',
'        if ($actual -ne $expected) { throw "Dosya dogrulamasi basarisiz" }',
'    }',
'    Log "dogrulama tamamlandi"',
'',
'    Write-Status "install" 100 0 0 0 "Kuruluyor"',
'    Log "kurulum basliyor"',
'',
'    $proc = Start-Process -FilePath $tmp -ArgumentList @("/S", "--updated") -WindowStyle Hidden -Wait -PassThru -ErrorAction Stop',
'    Log ("kurulum cikis kodu " + $proc.ExitCode)',
'} catch {',
'    $failed = $true',
'    $errMsg = [string]$_.Exception.Message',
'    if (-not $errMsg) { $errMsg = "Bilinmeyen hata" }',
'    Log ("HATA: " + $errMsg)',
'    Write-Status "error" 0 0 0 0 $errMsg',
'    Start-Sleep -Seconds 4',
'} finally {',
'    try { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue } catch {}',
'}',
'',
'if (-not $failed) {',
'    Write-Status "done" 100 0 0 0 ""',
'    Log "guncelleme basarili"',
'    Start-Sleep -Milliseconds 1200',
'}',
'',
'$target = ""',
'try { $target = Find-App $job } catch { Log ("Find-App hatasi: " + $_.Exception.Message) }',
'if ($target) {',
'    Log ("uygulama baslatiliyor: " + $target)',
'    try {',
'        $wd = Split-Path -Parent $target',
'        Start-Process -FilePath $target -WorkingDirectory $wd -WindowStyle Normal -ErrorAction SilentlyContinue | Out-Null',
'    } catch {',
'        Log ("start hatasi: " + $_.Exception.Message)',
'    }',
'} else {',
'    Log "uygulama bulunamadi"',
'}',
'',
'Log "updater bitti"',
'exit 0'
].join('\r\n').replace('__PREFIX__', DOWNLOAD_PATH_PREFIX);

const LINUX_SCRIPT = [
'#!/bin/sh',
'trap \'\' HUP',
'DIR=$(cd "$(dirname "$0")" && pwd)',
'JOB="$DIR/job.env"',
'LOG="$DIR/updater.log"',
'STATUS="$DIR/status.js"',
'TMPLOG="${TMPDIR:-/tmp}/anka-web-updater/updater.log"',
'mkdir -p "$(dirname "$TMPLOG")" 2>/dev/null',
'',
'log() {',
'    line="$(date \'+%Y-%m-%dT%H:%M:%S\') $1"',
'    echo "$line" >> "$LOG" 2>/dev/null',
'    echo "$line" >> "$TMPLOG" 2>/dev/null',
'}',
'',
'json_escape() {',
'    printf \'%s\' "$1" | sed \'s/\\\\\\\\/\\\\\\\\\\\\\\\\/g; s/"/\\\\\\\\"/g\' | tr -d \'\\r\\n\'',
'}',
'',
'write_status() {',
'    phase="$1"; percent="$2"; received="$3"; total="$4"; speed="$5"; msg="$6"',
'    json="{\\"phase\\":\\"$phase\\",\\"percent\\":$percent,\\"received\\":$received,\\"total\\":$total,\\"speed\\":$speed"',
'    if [ -n "$msg" ]; then',
'        esc=$(json_escape "$msg")',
'        json="$json,\\"message\\":\\"$esc\\""',
'    fi',
'    json="$json}"',
'    printf \'window.__updateStatus && window.__updateStatus(%s);\' "$json" > "$STATUS" 2>/dev/null',
'}',
'',
'if [ ! -f "$JOB" ]; then',
'    log "job.env bulunamadi"',
'    exit 1',
'fi',
'',
'. "$JOB" 2>/dev/null',
'rm -f "$JOB"',
'',
'TMPNAME=$(basename "$ANKA_URL")',
'[ -n "$TMPNAME" ] || TMPNAME="anka-web-$ANKA_VERSION.$ANKA_KIND"',
'TMP="$DIR/$TMPNAME"',
'USEFILE=0',
'case "$ANKA_FILE" in',
'    "$DIR"/download-*) if [ -f "$ANKA_FILE" ]; then TMP="$ANKA_FILE"; USEFILE=1; fi ;;',
'esac',
'[ "$USEFILE" -eq 1 ] || rm -f "$TMP"',
'',
'write_status "download" 0 0 0 0 "Hazirlaniyor"',
'',
'case "$ANKA_URL" in',
'    "__PREFIX__"*) ;;',
'    *) write_status "error" 0 0 0 0 "Gecersiz adres"; log "gecersiz adres"; exit 1 ;;',
'esac',
'',
'n=0',
'while kill -0 "$ANKA_PID" 2>/dev/null && [ "$n" -lt 100 ]; do',
'    n=$((n+1))',
'    sleep 0.2',
'done',
'if kill -0 "$ANKA_PID" 2>/dev/null; then',
'    kill -TERM "$ANKA_PID" 2>/dev/null',
'    sleep 1',
'    kill -KILL "$ANKA_PID" 2>/dev/null',
'fi',
'sleep 0.3',
'',
'remote_size() {',
'    if command -v curl >/dev/null 2>&1; then',
'        curl -fsIL --connect-timeout 15 -A AnkaWeb-Updater "$ANKA_URL" 2>/dev/null | tr -d \'\\r\' | grep -i \'^content-length:\' | tail -n 1 | tr -dc \'0-9\'',
'    elif command -v wget >/dev/null 2>&1; then',
'        wget --spider -S -q -T 30 -t 1 -U AnkaWeb-Updater "$ANKA_URL" 2>&1 | tr -d \'\\r\' | grep -i \'content-length:\' | tail -n 1 | tr -dc \'0-9\'',
'    fi',
'}',
'',
'fetch() {',
'    if command -v curl >/dev/null 2>&1; then',
'        curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 900 -A AnkaWeb-Updater -o "$2" "$1"',
'    elif command -v wget >/dev/null 2>&1; then',
'        wget -q -T 30 -t 3 -U AnkaWeb-Updater -O "$2" "$1"',
'    else',
'        return 127',
'    fi',
'}',
'',
'if [ "$USEFILE" -ne 1 ]; then',
'TOTAL=$(remote_size)',
'[ -n "$TOTAL" ] || TOTAL=0',
'',
'fetch "$ANKA_URL" "$TMP" &',
'FPID=$!',
'PREV=0',
'while kill -0 "$FPID" 2>/dev/null; do',
'    CUR=0',
'    if [ -f "$TMP" ]; then',
'        CUR=$(wc -c < "$TMP" 2>/dev/null | tr -d \'[:space:]\')',
'    fi',
'    [ -n "$CUR" ] || CUR=0',
'    PCT=0',
'    if [ "$TOTAL" -gt 0 ]; then',
'        PCT=$((CUR*100/TOTAL))',
'        [ "$PCT" -gt 99 ] && [ "$CUR" -lt "$TOTAL" ] && PCT=99',
'    fi',
'    SPD=$(( (CUR-PREV)*5 ))',
'    [ "$SPD" -ge 0 ] || SPD=0',
'    PREV=$CUR',
'    write_status "download" "$PCT" "$CUR" "$TOTAL" "$SPD" "Indiriliyor"',
'    sleep 0.2',
'done',
'wait "$FPID" || { write_status "error" 0 0 0 0 "Indirme basarisiz"; log "indirme basarisiz"; exit 1; }',
'fi',
'',
'write_status "verify" 100 0 0 0 "Dogrulaniyor"',
'log "indirme tamamlandi"',
'',
'SIZE=$(wc -c < "$TMP" 2>/dev/null | tr -d \'[:space:]\')',
'if [ -z "$SIZE" ] || [ "$SIZE" -lt 1024 ]; then',
'    write_status "error" 0 0 0 0 "Gecersiz dosya"',
'    log "gecersiz dosya"',
'    exit 1',
'fi',
'',
'MAGIC=$(head -c 4 "$TMP" | od -An -tx1 | tr -d \'[:space:]\')',
'case "$ANKA_KIND" in',
'    appimage)',
'        if [ "$MAGIC" != "7f454c46" ]; then',
'            write_status "error" 0 0 0 0 "Gecerli AppImage degil"',
'            log "gecerli appimage degil"',
'            exit 1',
'        fi',
'        ;;',
'    deb)',
'        DEBMAGIC=$(head -c 7 "$TMP" | od -An -tx1 | tr -d \'[:space:]\')',
'        if [ "$DEBMAGIC" != "213c617263683e" ]; then',
'            write_status "error" 0 0 0 0 "Gecerli deb paketi degil"',
'            log "gecerli deb degil"',
'            exit 1',
'        fi',
'        ;;',
'    rpm)',
'        if [ "$MAGIC" != "edabeedb" ]; then',
'            write_status "error" 0 0 0 0 "Gecerli rpm paketi degil"',
'            log "gecerli rpm degil"',
'            exit 1',
'        fi',
'        ;;',
'esac',
'',
'if [ -n "$ANKA_HASH" ]; then',
'    SUM=""',
'    if command -v sha256sum >/dev/null 2>&1; then',
'        SUM=$(sha256sum "$TMP" | cut -d\' \' -f1)',
'    elif command -v shasum >/dev/null 2>&1; then',
'        SUM=$(shasum -a 256 "$TMP" | cut -d\' \' -f1)',
'    fi',
'    if [ "$SUM" != "$ANKA_HASH" ]; then',
'        write_status "error" 0 0 0 0 "Dogrulama basarisiz"',
'        log "dogrulama basarisiz"',
'        exit 1',
'    fi',
'fi',
'',
'write_status "install" 100 0 0 0 "Kuruluyor"',
'log "kurulum basliyor"',
'',
'PKG=""',
'BEFORE=""',
'if [ "$ANKA_KIND" = "deb" ]; then',
'    if command -v dpkg-deb >/dev/null 2>&1; then',
'        PKG=$(dpkg-deb -f "$TMP" Package 2>/dev/null)',
'    fi',
'    if [ -n "$PKG" ] && command -v dpkg-query >/dev/null 2>&1; then',
'        BEFORE=$(dpkg-query -W -f=\'${Version}\' "$PKG" 2>/dev/null)',
'    fi',
'fi',
'if [ "$ANKA_KIND" = "rpm" ]; then',
'    if command -v rpm >/dev/null 2>&1; then',
'        PKG=$(rpm -qp --qf \'%{NAME}\' "$TMP" 2>/dev/null)',
'        if [ -n "$PKG" ]; then',
'            BEFORE=$(rpm -q --qf \'%{VERSION}-%{RELEASE}\' "$PKG" 2>/dev/null)',
'            case "$BEFORE" in *"not installed"*) BEFORE="" ;; esac',
'        fi',
'    fi',
'fi',
'',
'open_gui() {',
'    if command -v xdg-open >/dev/null 2>&1; then',
'        nohup xdg-open "$1" >/dev/null 2>&1 </dev/null &',
'        return 0',
'    fi',
'    if command -v gio >/dev/null 2>&1; then',
'        nohup gio open "$1" >/dev/null 2>&1 </dev/null &',
'        return 0',
'    fi',
'    if command -v gnome-software >/dev/null 2>&1; then',
'        nohup gnome-software --local-filename="$1" >/dev/null 2>&1 </dev/null &',
'        return 0',
'    fi',
'    return 1',
'}',
'',
'OK=0',
'case "$ANKA_KIND" in',
'    appimage)',
'        mkdir -p "$(dirname "$ANKA_DEST")" 2>/dev/null',
'        if cp -f "$TMP" "$ANKA_DEST.new" && chmod 755 "$ANKA_DEST.new" && mv -f "$ANKA_DEST.new" "$ANKA_DEST"; then',
'            OK=1',
'        else',
'            rm -f "$ANKA_DEST.new" 2>/dev/null',
'        fi',
'        ;;',
'    deb|rpm)',
'        if open_gui "$TMP"; then',
'            i=0',
'            while [ "$i" -lt 600 ]; do',
'                AFTER=""',
'                if [ "$ANKA_KIND" = "deb" ] && [ -n "$PKG" ] && command -v dpkg-query >/dev/null 2>&1; then',
'                    AFTER=$(dpkg-query -W -f=\'${Version}\' "$PKG" 2>/dev/null)',
'                fi',
'                if [ "$ANKA_KIND" = "rpm" ] && [ -n "$PKG" ] && command -v rpm >/dev/null 2>&1; then',
'                    AFTER=$(rpm -q --qf \'%{VERSION}-%{RELEASE}\' "$PKG" 2>/dev/null)',
'                    case "$AFTER" in *"not installed"*) AFTER="" ;; esac',
'                fi',
'                if [ -n "$AFTER" ] && [ "$AFTER" != "$BEFORE" ]; then',
'                    OK=1',
'                    break',
'                fi',
'                i=$((i+1))',
'                sleep 1',
'            done',
'        fi',
'        ;;',
'esac',
'',
'rm -f "$TMP"',
'',
'if [ "$OK" -ne 1 ]; then',
'    write_status "error" 0 0 0 0 "Kurulum tamamlanmadi"',
'    log "kurulum tamamlanmadi"',
'    exit 1',
'fi',
'',
'log "guncelleme tamamlandi: $ANKA_VERSION"',
'write_status "done" 100 0 0 0 ""',
'',
'sleep 0.5',
'',
'find_desktop_bin() {',
'    [ -n "$PKG" ] || return 1',
'    FILES=""',
'    if [ "$ANKA_KIND" = "deb" ] && command -v dpkg >/dev/null 2>&1; then',
'        FILES=$(dpkg -L "$PKG" 2>/dev/null)',
'    elif [ "$ANKA_KIND" = "rpm" ] && command -v rpm >/dev/null 2>&1; then',
'        FILES=$(rpm -ql "$PKG" 2>/dev/null)',
'    fi',
'    for f in $FILES; do',
'        case "$f" in',
'            *.desktop)',
'                if [ -f "$f" ]; then',
'                    EX=$(grep \'^Exec=\' "$f" 2>/dev/null | head -n 1 | cut -d= -f2- | sed \'s/ *%[a-zA-Z]//g\' | awk \'{print $1}\')',
'                    if [ -n "$EX" ] && [ -x "$EX" ]; then',
'                        printf \'%s\' "$EX"',
'                        return 0',
'                    fi',
'                fi',
'                ;;',
'        esac',
'    done',
'    return 1',
'}',
'',
'find_binary() {',
'    for n in anka-web anka-web-desktop Anka_Web ankaweb anka; do',
'        p=$(command -v "$n" 2>/dev/null)',
'        if [ -n "$p" ] && [ -x "$p" ]; then',
'            printf \'%s\' "$p"',
'            return 0',
'        fi',
'    done',
'    return 1',
'}',
'',
'BIN=""',
'if [ "$ANKA_KIND" = "appimage" ] && [ -x "$ANKA_DEST" ]; then',
'    BIN="$ANKA_DEST"',
'else',
'    BIN=$(find_desktop_bin) || BIN=$(find_binary)',
'fi',
'',
'if [ -n "$BIN" ] && [ -x "$BIN" ]; then',
'    log "uygulama baslatiliyor: $BIN"',
'    unset APPIMAGE APPDIR ARGV0 OWD',
'    if command -v setsid >/dev/null 2>&1; then',
'        setsid "$BIN" >/dev/null 2>&1 </dev/null &',
'    else',
'        nohup "$BIN" >/dev/null 2>&1 </dev/null &',
'    fi',
'else',
'    log "uygulama bulunamadi"',
'fi',
'',
'log "updater bitti"',
'sleep 1',
'exit 0'
].join('\n').replace('__PREFIX__', DOWNLOAD_URL_PREFIX);

const agent = new https.Agent({ keepAlive: true, maxSockets: 4 });

function bootUi(version) {
    const existing = window.__ankaUpdater;
    if (existing && existing.v === version) return true;

    const oldHost = document.getElementById('anka-updater-host');
    if (oldHost) oldHost.remove();

    const host = document.createElement('div');
    host.id = 'anka-updater-host';
    const root = host.attachShadow({ mode: 'closed' });

    root.innerHTML = `
        <style>
            :host { all: initial; }
            .card { position: fixed; right: 24px; bottom: 24px; width: min(400px, calc(100vw - 32px)); box-sizing: border-box; display: flex; gap: 14px; padding: 18px; border-radius: 16px; border: 1px solid var(--border, #27272a); background: var(--panel, #18181b); color: var(--text, #f4f4f5); box-shadow: var(--shadow-pop, 0 20px 40px rgba(0,0,0,.45)); font: 13px/1.5 var(--font, system-ui, sans-serif); z-index: 2147483000; overflow: hidden; animation: cardIn .42s cubic-bezier(.16,1,.3,1) both; will-change: transform, opacity; }
            .card.out { animation: cardOut .22s cubic-bezier(.4,0,1,1) both; }
            .card::before { content: ''; position: absolute; left: 0; top: 0; right: 0; height: 2px; background: linear-gradient(90deg, var(--accent, #ff4757), var(--accent-2, #ff7a45)); transform-origin: left; animation: topbar .7s .1s cubic-bezier(.16,1,.3,1) both; }
            @keyframes cardIn { from { opacity: 0; transform: translateY(28px) scale(.94); } to { opacity: 1; transform: none; } }
            @keyframes cardOut { to { opacity: 0; transform: translateY(20px) scale(.96); } }
            @keyframes topbar { from { transform: scaleX(0); } to { transform: scaleX(1); } }
            .icon { position: relative; flex: 0 0 40px; width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center; color: #fff; background: linear-gradient(135deg, var(--accent, #ff4757), var(--accent-2, #ff7a45)); }
            .icon::after { content: ''; position: absolute; inset: 0; border-radius: 12px; border: 2px solid var(--accent, #ff4757); opacity: 0; animation: ring 1.8s ease-out infinite; }
            .icon.done::after { animation: none; }
            .icon.err { background: #ef4444; }
            .icon.err::after { border-color: #ef4444; }
            .icon svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
            .icon.busy svg { animation: bob 1.1s ease-in-out infinite; }
            .icon.done svg { animation: pop .45s cubic-bezier(.34,1.56,.64,1) both; }
            @keyframes ring { 0% { transform: scale(1); opacity: .55; } 100% { transform: scale(1.55); opacity: 0; } }
            @keyframes bob { 0%, 100% { transform: translateY(-2px); } 50% { transform: translateY(2px); } }
            @keyframes pop { from { transform: scale(.3); opacity: 0; } to { transform: scale(1); opacity: 1; } }
            .body { flex: 1; min-width: 0; }
            .body.swap { animation: swap .32s cubic-bezier(.16,1,.3,1); }
            .body.shake { animation: shake .42s ease; }
            @keyframes swap { from { opacity: 0; transform: translateX(10px); } to { opacity: 1; transform: none; } }
            @keyframes shake { 0%, 100% { transform: none; } 20% { transform: translateX(-6px); } 40% { transform: translateX(5px); } 60% { transform: translateX(-4px); } 80% { transform: translateX(2px); } }
            .title { margin: 0 0 4px; font-size: 15px; font-weight: 700; }
            .text { margin: 0; color: var(--text-secondary, #a1a1aa); word-break: break-word; }
            .notes { margin: 10px 0 0; max-height: 96px; overflow: auto; padding: 8px 10px; border-radius: 8px; background: var(--bg, #121214); color: var(--text-secondary, #a1a1aa); font-size: 12px; white-space: pre-wrap; word-break: break-word; }
            .track { height: 6px; margin-top: 12px; border-radius: 3px; background: var(--hover, #27272a); overflow: hidden; }
            .bar { height: 100%; width: 100%; border-radius: 3px; transform-origin: left; transform: scaleX(0); transition: transform .25s ease-out; background: linear-gradient(90deg, var(--accent, #ff4757), var(--accent-2, #ff7a45), var(--accent, #ff4757)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
            @keyframes shimmer { to { background-position: -200% 0; } }
            .actions { display: flex; gap: 8px; margin-top: 14px; }
            .btn { flex: 1; min-height: 38px; padding: 0 14px; border-radius: 8px; border: 1px solid var(--border, #27272a); background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; touch-action: manipulation; transition: background-color .15s ease, transform .1s ease, filter .15s ease; }
            .btn:hover { background: var(--hover, #27272a); }
            .btn:active { transform: scale(.96); }
            .btn.primary { flex: 2; background: var(--accent, #ff4757); border-color: transparent; color: #fff; animation: glow 2s ease-in-out infinite; }
            .btn.primary:hover { filter: brightness(1.1); }
            @keyframes glow { 0%, 100% { box-shadow: 0 0 0 0 rgba(255,71,87,0); } 50% { box-shadow: 0 0 0 5px rgba(255,71,87,.22); } }
            [hidden] { display: none !important; }
            @media (prefers-reduced-motion: reduce) { .card, .card::before, .icon::after, .icon svg, .body, .bar, .btn, .btn.primary { animation: none !important; transition: none !important; } }
        </style>
        <div class="card" role="status" aria-live="polite" hidden>
            <div class="icon"></div>
            <div class="body">
                <h3 class="title"></h3>
                <p class="text"></p>
                <div class="notes" hidden></div>
                <div class="track" hidden><div class="bar"></div></div>
                <div class="actions"></div>
            </div>
        </div>
    `;

    const ICONS = {
        download: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>',
        check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
        alert: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>',
        info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5h.01"/></svg>'
    };

    const card = root.querySelector('.card');
    const icon = root.querySelector('.icon');
    const body = root.querySelector('.body');
    const title = root.querySelector('.title');
    const text = root.querySelector('.text');
    const notes = root.querySelector('.notes');
    const track = root.querySelector('.track');
    const bar = root.querySelector('.bar');
    const actions = root.querySelector('.actions');
    const queue = [];
    let ipc = null;
    let hideTimer = 0;
    let leaveTimer = 0;
    let currentKey = '';

    try {
        if (typeof require === 'function') ipc = require('electron').ipcRenderer || null;
    } catch (err) {
        ipc = null;
    }

    function emit(action) {
        try {
            if (ipc) ipc.send('anka-updater:action', action);
            else queue.push(action);
        } catch (err) {}
    }

    function setIcon(kind, cls) {
        icon.className = cls ? 'icon ' + cls : 'icon';
        icon.innerHTML = ICONS[kind];
    }

    function animate(cls) {
        body.className = 'body';
        void body.offsetWidth;
        body.className = 'body ' + cls;
    }

    function setButtons(defs) {
        actions.replaceChildren();
        defs.forEach((def) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = def[2] ? 'btn primary' : 'btn';
            button.textContent = def[0];
            button.addEventListener('click', () => emit(def[1]));
            actions.appendChild(button);
        });
        actions.hidden = defs.length === 0;
    }

    function show() {
        if (card.hidden) {
            card.hidden = false;
            card.classList.remove('out');
        } else if (card.classList.contains('out')) {
            card.classList.remove('out');
        }
    }

    function dismiss() {
        currentKey = '';
        if (card.hidden || card.classList.contains('out')) return;
        card.classList.add('out');
        leaveTimer = setTimeout(() => {
            card.hidden = true;
            card.classList.remove('out');
        }, 220);
    }

    function render(state) {
        clearTimeout(hideTimer);

        if (!state || (state.view !== 'update' && state.view !== 'error' && state.view !== 'info')) {
            dismiss();
            return;
        }

        clearTimeout(leaveTimer);

        if (state.view === 'update') {
            const percent = Math.max(0, Math.min(100, Number(state.percent) || 0));
            const isReady = !!state.ready;
            const key = 'update:' + state.version + ':' + (isReady ? 'ready' : (state.prompt ? 'prompt' : 'load'));

            if (key !== currentKey) {
                currentKey = key;
                setIcon(isReady ? 'check' : 'download', isReady ? 'done' : 'busy');

                if (state.prompt) {
                    title.textContent = 'Anka Web Sürümü ' + state.version + ' mevcut';
                    text.textContent = 'Güncellemeyi yüklemek istiyor musunuz?';
                    setButtons([['Daha Sonra', 'skip'], ['Güncelle', 'update', true]]);
                } else if (isReady) {
                    title.textContent = 'Anka Web Sürümü ' + state.version + ' kuruluyor';
                    text.textContent = 'Uygulama kapanacak, güncelleme arka planda kurulup Anka Web yeniden açılacak…';
                    setButtons([]);
                } else {
                    title.textContent = 'Anka Web Sürümü ' + state.version + ' hazırlanıyor';
                    setButtons([['İptal Et', 'skip']]);
                }

                notes.textContent = state.notes || '';
                notes.hidden = !state.notes;
                track.hidden = isReady || state.prompt;
                animate('swap');
            }

            if (!state.prompt && !isReady) {
                text.textContent = 'Hazırlanıyor… %' + percent + (state.detail ? ' · ' + state.detail : '');
                bar.style.transform = 'scaleX(' + percent / 100 + ')';
            }
        } else if (state.view === 'error') {
            currentKey = 'error:' + Date.now();
            setIcon('alert', 'err');
            title.textContent = 'Güncelleme hatası';
            text.textContent = state.message || 'Bilinmeyen hata';
            notes.hidden = true;
            track.hidden = true;
            setButtons([['Kapat', 'close'], ['Tekrar Dene', 'retry', true]]);
            animate('shake');
        } else {
            currentKey = 'info:' + Date.now();
            setIcon('info');
            title.textContent = state.title || 'Anka Web';
            text.textContent = state.message || '';
            notes.hidden = true;
            track.hidden = true;
            setButtons([]);
            animate('swap');
            if (!state.sticky) hideTimer = setTimeout(dismiss, 6000);
        }

        show();
    }

    window.__ankaUpdater = Object.freeze({
        v: version,
        render: render,
        pop: () => queue.shift() || null,
        ipc: !!ipc
    });

    document.documentElement.appendChild(host);
    return true;
}

const BOOT_SOURCE = bootUi.toString();

const state = global.__ankaUpdaterState || (global.__ankaUpdaterState = {
    phase: 'idle',
    version: '',
    percent: 0,
    file: '',
    kind: '',
    snoozed: '',
    notes: '',
    detail: '',
    targets: []
});

if (!Array.isArray(state.targets)) state.targets = [];

function safeJson(value) {
    return JSON.stringify(value)
        .replace(/</g, '\\u003c')
        .replace(/\u2028/g, '\\u2028')
        .replace(/\u2029/g, '\\u2029');
}

function sleep(ms, signal) {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        if (signal) {
            signal.addEventListener('abort', () => {
                clearTimeout(timer);
                resolve();
            }, { once: true });
        }
    });
}

function transientError(message) {
    const err = new Error(message);
    err.transient = true;
    return err;
}

function parseVersion(value) {
    return String(value).trim().replace(/^v/i, '').split(/[-+]/)[0].split('.').map((part) => parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
    const x = parseVersion(a);
    const y = parseVersion(b);
    const length = Math.max(x.length, y.length, 3);
    for (let i = 0; i < length; i += 1) {
        const diff = (x[i] || 0) - (y[i] || 0);
        if (diff) return diff > 0 ? 1 : -1;
    }
    return 0;
}

function parseManifest(text) {
    const out = Object.create(null);
    String(text).replace(/^\uFEFF/, '').split(/\r?\n/).forEach((line) => {
        const match = /^([A-Za-z0-9_]+):[ \t]*(.*)$/.exec(line);
        if (!match) return;
        let value = match[2].trim();
        if (value.length > 1 && ((value[0] === '"' && value.endsWith('"')) || (value[0] === "'" && value.endsWith("'")))) {
            value = value.slice(1, -1).trim();
        }
        out[match[1]] = value;
    });
    return out;
}

function cleanNotes(value) {
    return String(value || '')
        .replace(/\r/g, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/[*`_]/g, '')
        .trim()
        .slice(0, NOTES_MAX);
}

function manifestAllow(url) {
    return url.hostname === 'raw.githubusercontent.com' && url.pathname === MANIFEST_PATH;
}

function releaseAllow(apiPath) {
    return (url, redirected) => !redirected
        && url.hostname === 'api.github.com'
        && url.pathname === apiPath;
}

function downloadAllow(url, redirected) {
    if (redirected) return url.hostname === 'github.com' || /(^|\.)githubusercontent\.com$/.test(url.hostname);
    return url.hostname === 'github.com' && url.pathname.startsWith(DOWNLOAD_PATH_PREFIX);
}

function networkError(err) {
    if (err && TRANSIENT_CODES.has(err.code)) {
        const out = new Error('İnternet bağlantısı yok');
        out.transient = true;
        return out;
    }
    return err;
}

function get(url, options, depth) {
    return new Promise((resolve, reject) => {
        let target;
        try {
            target = new URL(url);
        } catch (err) {
            reject(new Error('Geçersiz adres'));
            return;
        }

        if (target.protocol !== 'https:' || target.username || target.password || !options.allow(target, depth > 0)) {
            reject(new Error('Güvenilmeyen adres engellendi'));
            return;
        }

        const req = https.get(target, {
            agent: agent,
            headers: { 'User-Agent': 'AnkaWeb-Updater', 'Cache-Control': 'no-cache', Accept: options.accept || '*/*' },
            timeout: options.timeout,
            signal: options.signal
        }, (res) => {
            const code = res.statusCode;
            if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
                res.resume();
                if (!options.redirects || depth >= MAX_REDIRECTS) {
                    reject(new Error('Çok fazla yönlendirme'));
                    return;
                }
                let next;
                try {
                    next = new URL(res.headers.location, target).toString();
                } catch (err) {
                    reject(new Error('Geçersiz yönlendirme'));
                    return;
                }
                resolve(get(next, options, depth + 1));
                return;
            }
            if (code === 403 || code === 429) {
                res.resume();
                const limited = new Error('GitHub istek sınırı aşıldı, biraz sonra tekrar deneyin');
                limited.status = code;
                reject(limited);
                return;
            }
            if (code !== 200) {
                res.resume();
                const failure = new Error(code === 404 ? 'Dosya bulunamadı (404)' : 'Sunucu yanıtı: ' + code);
                failure.status = code;
                failure.transient = code >= 500;
                reject(failure);
                return;
            }
            resolve(res);
        });

        req.on('timeout', () => req.destroy(transientError('Bağlantı zaman aşımına uğradı')));
        req.on('error', (err) => reject(networkError(err)));
    });
}

function readLimited(res, max) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
            size += chunk.length;
            if (size > max) {
                res.destroy(new Error('Yanıt çok büyük'));
                return;
            }
            chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', (err) => reject(networkError(err)));
    });
}

function saveStream(res, file, total, report) {
    return new Promise((resolve, reject) => {
        const out = fs.createWriteStream(file, { mode: 0o600 });
        const digest = crypto.createHash('sha256');
        let received = 0;
        let settled = false;
        let lastTick = Date.now();
        let lastBytes = 0;

        const fail = (err) => {
            if (settled) return;
            settled = true;
            try { res.destroy(); } catch (e) {}
            try { out.destroy(); } catch (e) {}
            reject(networkError(err));
        };

        res.on('data', (chunk) => {
            received += chunk.length;
            if (received > MAX_DOWNLOAD_BYTES) {
                fail(new Error('Dosya çok büyük'));
                return;
            }
            digest.update(chunk);
            const now = Date.now();
            if (now - lastTick >= PROGRESS_MS) {
                const seconds = (now - lastTick) / 1000;
                const speed = seconds > 0 ? (received - lastBytes) / seconds : 0;
                lastTick = now;
                lastBytes = received;
                const percent = total > 0 ? Math.min(99, Math.floor((received * 100) / total)) : -1;
                report({ percent: percent, received: received, total: total, speed: speed });
            }
        });
        res.on('error', fail);
        res.on('aborted', () => fail(new Error('Bağlantı kesildi')));
        out.on('error', fail);
        out.on('finish', () => {
            if (settled) return;
            if (total > 0 && received < total) {
                fail(new Error('Dosya eksik indirildi'));
                return;
            }
            settled = true;
            report({ percent: 100, received: received, total: total || received, speed: 0 });
            resolve({ received: received, hash: digest.digest('hex') });
        });
        res.pipe(out);
    });
}

function findBin(name) {
    for (const dir of BIN_DIRS) {
        const file = path.join(dir, name);
        try {
            fs.accessSync(file, fs.constants.X_OK);
            return file;
        } catch (err) {}
    }
    return null;
}

function detectLinuxDistro() {
    try {
        const raw = fs.readFileSync('/etc/os-release', 'utf8');
        const out = Object.create(null);
        raw.split(/\r?\n/).forEach((line) => {
            const m = /^([A-Z_]+)=(.*)$/.exec(line);
            if (!m) return;
            let v = m[2].trim();
            if (v.length > 1 && ((v[0] === '"' && v.endsWith('"')) || (v[0] === "'" && v.endsWith("'")))) {
                v = v.slice(1, -1);
            }
            out[m[1]] = v;
        });
        return out;
    } catch (err) {
        return Object.create(null);
    }
}

function linuxPreferredKinds() {
    if (process.env.APPIMAGE) return ['appimage', 'targz'];
    const info = detectLinuxDistro();
    const id = String(info.ID || '').toLowerCase();
    const like = ' ' + String(info.ID_LIKE || '').toLowerCase() + ' ';
    const debSet = ['debian', 'ubuntu', 'linuxmint', 'mint', 'pop', 'elementary', 'kali', 'raspbian', 'deepin', 'zorin', 'mx', 'neon', 'devuan'];
    const rpmSet = ['fedora', 'rhel', 'centos', 'rocky', 'almalinux', 'ol', 'opensuse', 'opensuse-leap', 'opensuse-tumbleweed', 'suse', 'sles', 'amzn', 'oracle', 'mageia'];
    const isDeb = debSet.some((x) => id === x || id.startsWith(x + '-')) || debSet.some((x) => like.indexOf(' ' + x + ' ') >= 0);
    const isRpm = rpmSet.some((x) => id === x || id.startsWith(x + '-')) || rpmSet.some((x) => like.indexOf(' ' + x + ' ') >= 0);
    if (isDeb) return ['deb', 'appimage', 'targz'];
    if (isRpm) return ['rpm', 'appimage', 'targz'];
    return ['appimage', 'targz'];
}

function platformKinds() {
    if (process.platform === 'win32') return ['exe'];
    if (process.platform === 'linux') {
        if (process.arch !== 'x64') throw new Error('Bu işlemci mimarisi için paket yok');
        return linuxPreferredKinds();
    }
    return null;
}

function detectKind(name) {
    const lower = String(name).toLowerCase();
    if (lower.endsWith('.tar.gz')) return 'targz';
    if (lower.endsWith('.appimage')) return 'appimage';
    if (lower.endsWith('.deb')) return 'deb';
    if (lower.endsWith('.rpm')) return 'rpm';
    if (lower.endsWith('.msi')) return 'msi';
    if (lower.endsWith('.exe')) return 'exe';
    return null;
}

function archMismatch(name) {
    if (process.arch === 'x64') {
        return /(arm64|aarch64|armv7|armhf|i386|i686|ia32)/i.test(name) || /x86(?![_-]?64)/i.test(name);
    }
    if (process.arch === 'ia32') return /(x64|x86[_-]?64|amd64|arm64|aarch64)/i.test(name);
    return false;
}

function buildTarget(raw, hash) {
    let url;
    try {
        url = new URL(String(raw || '').trim());
    } catch (err) {
        return null;
    }

    const valid = url.protocol === 'https:'
        && url.hostname === 'github.com'
        && !url.username
        && !url.password
        && !url.port
        && !url.search
        && !url.hash
        && url.pathname.startsWith(DOWNLOAD_PATH_PREFIX);
    if (!valid) return null;

    const rest = url.pathname.slice(DOWNLOAD_PATH_PREFIX.length).split('/');
    if (rest.length !== 2 || !TAG_RE.test(rest[0]) || !rest[1]) return null;

    let name;
    try {
        name = decodeURIComponent(rest[1]);
    } catch (err) {
        return null;
    }
    if (!FILE_RE.test(name) || name.includes('..')) return null;

    const kind = detectKind(name);
    if (!kind) return null;

    return { kind: kind, ext: EXTENSIONS[kind], url: url.toString(), name: name, hash: hash || '' };
}

function collectTargets(manifest, assets, kinds) {
    const found = new Map();
    const hashes = new Map();
    assets.forEach((asset) => hashes.set(asset.name, asset.hash));

    const add = (target) => {
        if (!target || kinds.indexOf(target.kind) < 0) return;
        const existing = found.get(target.url);
        if (existing) {
            if (!existing.hash && target.hash) existing.hash = target.hash;
            return;
        }
        found.set(target.url, target);
    };

    Object.keys(manifest).forEach((key) => {
        if (!/^url_/.test(key)) return;
        const target = buildTarget(manifest[key], '');
        if (!target) return;
        const declared = String(manifest['sha256_' + key.slice(4)] || '').trim().toLowerCase();
        target.hash = hashes.get(target.name) || (HASH_RE.test(declared) ? declared : '');
        add(target);
    });

    assets.forEach((asset) => {
        if (/portable/i.test(asset.name) || archMismatch(asset.name)) return;
        add(buildTarget(asset.url, asset.hash));
    });

    return Array.from(found.values()).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
}

async function fetchReleaseJson(apiPath, signal) {
    const res = await get('https://api.github.com' + apiPath, {
        allow: releaseAllow(apiPath),
        accept: 'application/vnd.github+json',
        timeout: REQUEST_TIMEOUT,
        redirects: false,
        signal: signal
    }, 0);
    return JSON.parse((await readLimited(res, MAX_JSON_BYTES)).toString('utf8'));
}

async function fetchRelease(version, signal) {
    const paths = [RELEASE_API_PREFIX + 'v' + version, RELEASE_API_PREFIX + version, LATEST_API_PATH];
    for (const apiPath of paths) {
        if (signal.aborted) break;
        try {
            const release = await fetchReleaseJson(apiPath, signal);
            if (!release || typeof release !== 'object') continue;
            if (apiPath === LATEST_API_PATH && compareVersions(String(release.tag_name || ''), version) !== 0) continue;

            const list = Array.isArray(release.assets) ? release.assets : [];
            const assets = [];
            list.forEach((item) => {
                if (!item || typeof item.name !== 'string' || typeof item.browser_download_url !== 'string') return;
                const match = DIGEST_RE.exec(String(item.digest || ''));
                assets.push({ name: item.name, url: item.browser_download_url, hash: match ? match[1].toLowerCase() : '' });
            });
            return { assets: assets, notes: cleanNotes(release.body) };
        } catch (err) {
            if (err && (err.status === 403 || err.status === 429)) break;
        }
    }
    return { assets: [], notes: '' };
}

function resetState() {
    state.phase = 'idle';
    state.version = '';
    state.percent = 0;
    state.file = '';
    state.kind = '';
    state.notes = '';
    state.detail = '';
    state.targets = [];
}

function markerPath() {
    return path.join(app.getPath('userData'), MARKER_FILE);
}

function writeMarker(from, to) {
    try {
        fs.writeFileSync(markerPath(), JSON.stringify({ from: String(from), to: String(to), at: Date.now() }), { mode: 0o600 });
    } catch (err) {}
}

function removeMarker() {
    try {
        fs.rmSync(markerPath(), { force: true });
    } catch (err) {}
}

function takeMarker(installed) {
    const file = markerPath();
    let data = null;
    try {
        if (fs.statSync(file).size <= MAX_MARKER_BYTES) data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        data = null;
    }
    removeMarker();
    if (!data || typeof data.to !== 'string' || !VERSION_RE.test(data.to)) return '';
    if (compareVersions(installed, data.to) < 0) return '';
    if (!(Date.now() - Number(data.at) < MARKER_MAX_AGE)) return '';
    return data.to;
}

function cleanEnv(extra) {
    const env = Object.assign({}, process.env);
    STRIPPED_ENV.forEach((key) => {
        delete env[key];
    });
    if (extra) Object.assign(env, extra);
    return env;
}

function runProcess(command, args, extraEnv) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(command, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: false,
                windowsHide: true,
                env: cleanEnv(extraEnv)
            });
        } catch (err) {
            reject(err);
            return;
        }
        let out = '';
        let err = '';
        child.stdout.on('data', (chunk) => {
            if (out.length < MAX_OUTPUT_BYTES) out += chunk;
        });
        child.stderr.on('data', (chunk) => {
            if (err.length < MAX_OUTPUT_BYTES) err += chunk;
        });
        child.once('error', reject);
        child.once('close', (code) => resolve({ code: code, out: out, err: err }));
    });
}

function launchDetached(command, args, cwd, extraEnv) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(command, args, {
                detached: true,
                stdio: 'ignore',
                shell: false,
                windowsHide: true,
                cwd: cwd,
                env: cleanEnv(extraEnv)
            });
        } catch (err) {
            reject(err);
            return;
        }
        child.once('error', reject);
        child.once('spawn', () => {
            try { child.unref(); } catch (err) {}
            resolve();
        });
    });
}

function quitSoon() {
    try {
        BrowserWindow.getAllWindows().forEach((win) => {
            if (win && !win.isDestroyed()) win.destroy();
        });
    } catch (e) {}

    setTimeout(() => {
        try {
            app.quit();
        } catch (e) {}
        setTimeout(() => {
            try {
                app.exit(0);
            } catch (e) {
                process.exit(0);
            }
        }, 1200);
    }, 150);
}

function systemPath() {
    const parts = Array.prototype.slice.call(arguments);
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    return path.join.apply(path, [root, 'System32'].concat(parts));
}

function updaterDir() {
    return path.join(app.getPath('userData'), UPDATER_DIR);
}

function prepareUpdaterDir() {
    const dir = updaterDir();
    try {
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    } catch (err) {}
    return dir;
}

function cleanDownloads(dir) {
    try {
        fs.readdirSync(dir).forEach((name) => {
            if (name.indexOf(DOWNLOAD_PREFIX) === 0) {
                try { fs.rmSync(path.join(dir, name), { force: true }); } catch (err) {}
            }
        });
    } catch (err) {}
}

function writeIfChanged(file, content, mode) {
    let current = null;
    try {
        current = fs.readFileSync(file, 'utf8');
    } catch (err) {
        current = null;
    }
    if (current === content) return false;
    const temp = file + '.tmp-' + process.pid;
    try {
        fs.writeFileSync(temp, content, { mode: mode });
        fs.renameSync(temp, file);
    } catch (err) {
        try { fs.rmSync(temp, { force: true }); } catch (e) {}
        throw err;
    }
    return true;
}

async function waitClaim(file, limit) {
    const end = Date.now() + limit;
    while (Date.now() < end) {
        if (!fs.existsSync(file)) return true;
        await sleep(CLAIM_POLL);
    }
    return !fs.existsSync(file);
}

function userInstallDir() {
    return path.join(os.homedir(), '.local', 'share', 'anka-web');
}

function linuxDestination() {
    const current = process.env.APPIMAGE;
    if (current && fs.existsSync(current)) return current;
    return path.join(userInstallDir(), 'Anka_Web.AppImage');
}

function shellQuote(value) {
    return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

function unitQuote(value) {
    return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%') + '"';
}

function linuxUnitContent(script) {
    return [
        '[Unit]',
        'Description=Anka Web Updater',
        '',
        '[Service]',
        'Type=oneshot',
        'ExecStart=' + SH_BIN + ' ' + unitQuote(script),
        'StandardInput=null',
        'StandardOutput=null',
        'StandardError=null',
        'KillMode=process',
        'SendSIGHUP=no',
        'SendSIGKILL=no',
        'TimeoutStartSec=30min',
        ''
    ].join('\n');
}

function linuxJobContent(target, version, file) {
    const lines = [
        'ANKA_PID=' + shellQuote(process.pid),
        'ANKA_URL=' + shellQuote(target.url),
        'ANKA_HASH=' + shellQuote(target.hash || ''),
        'ANKA_VERSION=' + shellQuote(version),
        'ANKA_KIND=' + shellQuote(target.kind),
        'ANKA_DEST=' + shellQuote(linuxDestination()),
        'ANKA_FILE=' + shellQuote(file || '')
    ];
    GUI_ENV.forEach((key) => {
        if (process.env[key]) lines.push('export ' + key + '=' + shellQuote(process.env[key]));
    });
    return lines.join('\n') + '\n';
}

let linuxUnitEnsured = false;

async function ensureLinuxService() {
    if (linuxUnitEnsured) return;
    const dir = prepareUpdaterDir();
    const script = path.join(dir, LINUX_SCRIPT_FILE);
    writeIfChanged(script, LINUX_SCRIPT, 0o755);
    try { fs.chmodSync(script, 0o755); } catch (err) {}

    const systemctl = findBin('systemctl');
    if (systemctl) {
        try {
            const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
            const unitDir = path.join(configHome, 'systemd', 'user');
            fs.mkdirSync(unitDir, { recursive: true, mode: 0o755 });
            const changed = writeIfChanged(path.join(unitDir, 'anka-web-updater.service'), linuxUnitContent(script), 0o644);
            if (changed) {
                await safeAsync(() => runProcess(systemctl, ['--user', 'daemon-reload']));
            }
        } catch (err) {
            logWarn('linux service setup', err);
        }
    }
    linuxUnitEnsured = true;
}

async function triggerLinux(target, version, file) {
    await ensureLinuxService();
    const dir = prepareUpdaterDir();
    const script = path.join(dir, LINUX_SCRIPT_FILE);
    const jobFile = path.join(dir, LINUX_JOB_FILE);

    try {
        fs.writeFileSync(jobFile, linuxJobContent(target, version, file), { mode: 0o600 });
    } catch (err) {
        throw new Error('Görev dosyası yazılamadı: ' + err.message);
    }

    let claimed = false;

    try {
        await launchDetached(SH_BIN, [script], dir);
        claimed = await waitClaim(jobFile, 5000);
    } catch (err) {
        logWarn('direct launch', err);
    }

    if (!claimed && fs.existsSync(jobFile)) {
        const systemctl = findBin('systemctl');
        if (systemctl) {
            try {
                await runProcess(systemctl, ['--user', 'start', '--no-block', 'anka-web-updater.service']);
                claimed = await waitClaim(jobFile, 10000);
            } catch (err) {
                logWarn('systemctl start', err);
            }
        }
    }

    if (!claimed && fs.existsSync(jobFile)) {
        const nohup = findBin('nohup');
        if (nohup) {
            try {
                await launchDetached(nohup, [SH_BIN, script], dir);
                claimed = await waitClaim(jobFile, 5000);
            } catch (err) {
                logWarn('nohup launch', err);
            }
        }
    }

    if (!claimed) {
        try { fs.rmSync(jobFile, { force: true }); } catch (e) {}
        throw new Error('Güncelleme servisi başlatılamadı. Log: ' + (mainLogPath || 'bilinmiyor'));
    }
}

let winEnsured = false;

async function ensureWindowsScripts() {
    if (winEnsured) return;
    const dir = prepareUpdaterDir();
    const script = path.join(dir, WIN_SCRIPT_FILE);
    writeIfChanged(script, '\uFEFF' + WIN_TASK_SCRIPT, 0o600);
    try { fs.rmSync(path.join(dir, 'status.js'), { force: true }); } catch (err) {}
    winEnsured = true;
}

function findPowerShell() {
    const candidates = [
        systemPath('WindowsPowerShell', 'v1.0', 'powershell.exe'),
        systemPath('WindowsPowerShell', 'v1.0', 'pwsh.exe')
    ];
    for (const candidate of candidates) {
        try {
            fs.accessSync(candidate, fs.constants.F_OK);
            return candidate;
        } catch (err) {}
    }
    return 'powershell.exe';
}

function vbsQuote(value) {
    return '"' + String(value).replace(/"/g, '""') + '"';
}

async function triggerWindows(target, version, jobInfo) {
    await ensureWindowsScripts();
    const dir = prepareUpdaterDir();
    const script = path.join(dir, WIN_SCRIPT_FILE);
    const jobFile = path.join(dir, WIN_JOB_FILE);
    const vbsFile = path.join(dir, WIN_VBS_FILE);

    try { fs.rmSync(path.join(dir, 'status.js'), { force: true }); } catch (err) {}

    const job = {
        pid: jobInfo.pid,
        url: target.url,
        hash: target.hash || '',
        version: version,
        exec: jobInfo.exec,
        proc: jobInfo.proc,
        name: jobInfo.name,
        file: jobInfo.file || ''
    };

    try {
        fs.writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });
    } catch (err) {
        throw new Error('Görev dosyası yazılamadı: ' + err.message);
    }

    const ps = findPowerShell();
    const psArgs = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + vbsQuote(script);
    const cmdLine = ps + ' ' + psArgs;
    const vbsContent = 'CreateObject("WScript.Shell").Run ' + vbsQuote(cmdLine) + ', 0, False\r\n';

    try {
        fs.writeFileSync(vbsFile, vbsContent, { mode: 0o600 });
    } catch (err) {
        logWarn('vbs yazilamadi', err);
    }

    let launched = false;

    try {
        await launchDetached('wscript.exe', ['//B', '//Nologo', vbsFile], dir);
        launched = true;
        logInfo('vbs launch ok');
    } catch (err) {
        logWarn('vbs launch failed', err);
    }

    if (!launched || !(await waitClaim(jobFile, CLAIM_WAIT))) {
        if (fs.existsSync(jobFile)) {
            logWarn('vbs basarisiz, dogrudan ps deniyoruz');
            try {
                await launchDetached(ps, [
                    '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
                    '-ExecutionPolicy', 'Bypass', '-File', script
                ], dir);
            } catch (err) {
                logWarn('direct ps failed', err);
            }
        }
    }

    if (!(await waitClaim(jobFile, CLAIM_WAIT))) {
        try { fs.rmSync(jobFile, { force: true }); } catch (e) {}
        throw new Error('Güncelleme başlatılamadı. Log: ' + (mainLogPath || 'bilinmiyor'));
    }
}

async function launchBackgroundUpdate(target, version, file) {
    if (process.platform === 'win32') {
        await triggerWindows(target, version, {
            pid: process.pid,
            exec: app.isPackaged ? process.execPath : '',
            proc: path.parse(process.execPath).name,
            name: app.getName(),
            file: file || ''
        });
        return;
    }
    if (process.platform === 'linux') {
        await triggerLinux(target, version, file || '');
        return;
    }
    throw new Error('Bu platformda otomatik güncelleme desteklenmiyor');
}

async function downloadAndInstall(target, version, splash) {
    const dir = prepareUpdaterDir();
    cleanDownloads(dir);
    const file = path.join(dir, DOWNLOAD_PREFIX + version + target.ext);

    const push = (info) => {
        if (!splash) return;
        splash.update(info);
    };

    push({ phase: 'prepare', percent: -1, version: version });

    const res = await get(target.url, {
        allow: downloadAllow,
        timeout: REQUEST_TIMEOUT,
        redirects: true
    }, 0);

    const total = parseInt(res.headers['content-length'], 10) || 0;
    let lastPush = 0;
    const result = await saveStream(res, file, total, (info) => {
        const now = Date.now();
        if (info.percent < 100 && now - lastPush < 80) return;
        lastPush = now;
        push(Object.assign({ phase: 'download', version: version }, info));
    });

    push({ phase: 'verify', percent: 100, version: version });
    if (target.hash && result.hash !== target.hash) throw new Error('Dosya doğrulaması başarısız');

    push({ phase: 'install', percent: 100, version: version });
    writeMarker(String(safeCall(() => app.getVersion(), '0.0.0')), version);
    await launchBackgroundUpdate(target, version, file);

    return file;
}

async function installUpdate(options) {
    const opts = options || {};
    const manifest = opts.manifest || Object.create(null);
    const version = String(opts.version || manifest.version || '').trim();
    const installed = String(opts.currentVersion || safeCall(() => app.getVersion(), '0.0.0'));
    const emit = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};

    if (!VERSION_RE.test(version)) throw new Error('Manifestteki sürüm geçersiz');

    const kinds = platformKinds();
    if (!kinds) throw new Error('Bu platformda otomatik güncelleme desteklenmiyor');

    emit({ phase: 'prepare', percent: -1, version: version });

    let targets = collectTargets(manifest, [], kinds);
    if (!targets.length || !targets[0].hash) {
        const release = await fetchRelease(version, new AbortController().signal);
        const merged = collectTargets(manifest, release.assets, kinds);
        if (merged.length) targets = merged;
    }
    if (!targets.length) throw new Error('Bu sistem için uygun güncelleme paketi bulunamadı (aranan: ' + kinds.join(', ') + ')');

    const target = targets[0];
    const dir = prepareUpdaterDir();
    cleanDownloads(dir);
    const file = path.join(dir, DOWNLOAD_PREFIX + version + target.ext);

    try {
        const res = await get(target.url, {
            allow: downloadAllow,
            timeout: REQUEST_TIMEOUT,
            redirects: true
        }, 0);
        const total = parseInt(res.headers['content-length'], 10) || 0;
        const result = await saveStream(res, file, total, (info) => {
            emit(Object.assign({ phase: 'download', version: version }, info));
        });
        emit({ phase: 'verify', percent: 100, version: version });
        if (target.hash && result.hash !== target.hash) throw new Error('Dosya doğrulaması başarısız');

        emit({ phase: 'install', percent: 100, version: version });
        writeMarker(installed, version);
        await launchBackgroundUpdate(target, version, file);
    } catch (err) {
        removeMarker();
        try { fs.rmSync(file, { force: true }); } catch (e) {}
        logError('installUpdate', err);
        throw err;
    }

    return true;
}

function setupWindow(win, currentVersion, options) {
    if (!win || win.isDestroyed() || win.__ankaUpdater) return;

    let contents;
    try {
        contents = win.webContents;
    } catch (err) {
        return;
    }
    if (!contents) return;

    const installed = String(currentVersion || safeCall(() => app.getVersion(), '0.0.0'));
    const startManual = !!(options && options.manual);
    const updatedTo = safeCall(() => takeMarker(installed), '');

    let announce = updatedTo ? 'Anka Web ' + updatedTo + ' sürümüne güncellendi' : '';
    let destroyed = false;
    let busy = false;
    let installing = false;
    let uiReady = false;
    let lastCheck = 0;
    let firstTimer = null;
    let intervalTimer = null;
    let pollTimer = null;
    let promptTimer = null;
    let abortCtl = null;

    function clearPromptTimer() {
        if (promptTimer) {
            clearTimeout(promptTimer);
            promptTimer = null;
        }
    }

    function startPromptTimer() {
        clearPromptTimer();
        promptTimer = setTimeout(() => {
            promptTimer = null;
            if (destroyed || installing) return;
            if (state.phase === 'prompt') {
                state.snoozed = state.version;
                send(null);
            }
        }, PROMPT_TIMEOUT);
        if (typeof promptTimer.unref === 'function') promptTimer.unref();
    }

    async function ensureUi() {
        if (destroyed || win.isDestroyed()) return false;
        if (uiReady) return true;
        try {
            await contents.executeJavaScript('(' + BOOT_SOURCE + ')(' + UI_VERSION + ')');
            uiReady = true;
            if (!pollTimer) {
                try {
                    const hasIpc = await contents.executeJavaScript('Boolean(window.__ankaUpdater && window.__ankaUpdater.ipc)');
                    if (!hasIpc) startPoll();
                } catch (err) {
                    startPoll();
                }
            }
            return true;
        } catch (err) {
            logWarn('ensureUi', err);
            return false;
        }
    }

    async function send(view) {
        if (!(await ensureUi())) return;
        try {
            await contents.executeJavaScript('window.__ankaUpdater&&window.__ankaUpdater.render(' + safeJson(view) + ')');
        } catch (err) {
            logWarn('send', err);
        }
    }

    function paint() {
        if (state.phase === 'idle' || state.snoozed === state.version) return;
        if (installing && state.phase === 'prompt') return;
        send({
            view: 'update',
            version: state.version,
            percent: state.percent,
            ready: state.phase === 'ready',
            prompt: state.phase === 'prompt',
            notes: state.notes || '',
            detail: state.detail || ''
        });
    }

    function flushAnnounce() {
        if (!announce) return;
        const message = announce;
        announce = '';
        send({ view: 'info', title: 'Anka Web', message: message });
    }

    function startPoll() {
        pollTimer = setInterval(async () => {
            if (destroyed || win.isDestroyed()) return;
            try {
                const action = await contents.executeJavaScript('window.__ankaUpdater?window.__ankaUpdater.pop():null');
                if (typeof action === 'string') handle(action);
            } catch (err) {}
        }, POLL_MS);
        if (typeof pollTimer.unref === 'function') pollTimer.unref();
    }

    async function check(manual) {
        if (destroyed || installing) return;
        if (busy) {
            if (manual) {
                state.snoozed = '';
                paint();
            }
            return;
        }

        busy = true;
        lastCheck = Date.now();
        if (manual) state.snoozed = '';
        const ctl = new AbortController();
        abortCtl = ctl;

        try {
            const url = MANIFEST_URL + '?t=' + Date.now();
            let res;
            try {
                res = await get(url, { allow: manifestAllow, timeout: REQUEST_TIMEOUT, redirects: false, signal: ctl.signal }, 0);
            } catch (err) {
                if (err && err.status === 404) throw new Error('latest.yml bulunamadı (404). Depo herkese açık olmalı ve dosya main dalının kökünde bulunmalı');
                throw err;
            }

            const manifest = parseManifest((await readLimited(res, MAX_MANIFEST_BYTES)).toString('utf8'));
            const version = String(manifest.version || '').trim();
            if (!VERSION_RE.test(version)) throw new Error('Manifestteki sürüm geçersiz');

            if (compareVersions(version, installed) <= 0) {
                if (state.phase !== 'idle') resetState();
                clearPromptTimer();
                if (manual) await send({ view: 'info', title: 'Anka Web', message: 'Anka Web Sürümü ' + installed + ' güncel' });
                return;
            }

            const kinds = platformKinds();
            if (!kinds) {
                if (manual) await send({ view: 'info', title: 'Anka Web', message: 'Bu platformda otomatik güncelleme desteklenmiyor' });
                return;
            }

            let transitionedToPrompt = false;

            if (state.version !== version || !state.targets.length) {
                const release = await fetchRelease(version, ctl.signal);
                const targets = collectTargets(manifest, release.assets, kinds);
                if (!targets.length) throw new Error('Bu sistem için uygun güncelleme paketi bulunamadı (aranan: ' + kinds.join(', ') + ')');

                state.version = version;
                state.targets = targets;
                state.kind = targets[0].kind;
                state.phase = 'prompt';
                state.percent = 0;
                state.file = '';
                state.notes = release.notes;
                state.detail = '';
                transitionedToPrompt = true;
            }

            paint();
            if (transitionedToPrompt) startPromptTimer();
        } catch (err) {
            if (ctl.signal.aborted || destroyed) return;
            logWarn('check', err);
            if (manual) await send({ view: 'error', message: err && err.message ? err.message : 'İnternet bağlantısı yok' });
        } finally {
            busy = false;
            if (abortCtl === ctl) abortCtl = null;
        }
    }

    async function startBackgroundUpdate() {
        if (installing || destroyed || !state.targets.length) return;
        installing = true;
        clearPromptTimer();

        let splash = null;
        try {
            splash = createSplash();
            splash.open();
        } catch (err) {
            logWarn('splash open', err);
        }

        try {
            const target = state.targets[0];
            const version = state.version;

            state.phase = 'ready';
            state.percent = 100;
            state.kind = target.kind;
            state.detail = '';

            send(null);

            await downloadAndInstall(target, version, splash);

            if (splash) splash.update({ phase: 'done', percent: 100, version: version });
            await sleep(HANDOFF_DELAY);
            if (destroyed) return;
            if (splash) splash.close();
            quitSoon();
        } catch (err) {
            logError('startBackgroundUpdate', err);
            installing = false;
            removeMarker();
            resetState();
            if (splash) {
                splash.update({
                    phase: 'error',
                    percent: 0,
                    version: state.version || '',
                    message: err && err.message ? err.message : 'Güncelleme başlatılamadı'
                });
                await sleep(2200);
                splash.close();
            }
            if (!destroyed) await send({ view: 'error', message: err && err.message ? err.message : 'Güncelleme başlatılamadı' });
        }
    }

    function handle(action) {
        if (typeof action !== 'string' || !ACTIONS.has(action) || destroyed) return;

        if (action === 'later' || action === 'close' || action === 'skip') {
            clearPromptTimer();
            state.snoozed = state.version;
            if (abortCtl) abortCtl.abort();
            send(null);
        } else if (action === 'install' || action === 'update') {
            clearPromptTimer();
            startBackgroundUpdate();
        } else if (action === 'retry') {
            check(true);
        }
    }

    function onAction(event, action) {
        if (destroyed || win.isDestroyed() || !event || !event.sender) return;
        if (event.sender.id !== contents.id) return;
        if (event.senderFrame && contents.mainFrame && event.senderFrame !== contents.mainFrame) return;
        handle(action);
    }

    function onFocus() {
        if (Date.now() - lastCheck >= FOCUS_CHECK_GAP) check(false);
    }

    function onStartLoading() {
        uiReady = false;
    }

    function onFinishLoad() {
        uiReady = false;
        paint();
        flushAnnounce();
    }

    function destroy() {
        if (destroyed) return;
        destroyed = true;
        clearTimeout(firstTimer);
        clearInterval(intervalTimer);
        clearInterval(pollTimer);
        clearPromptTimer();
        if (abortCtl) abortCtl.abort();
        try { ipcMain.removeListener(ACTION_CHANNEL, onAction); } catch (err) {}
        try {
            contents.removeListener('did-start-loading', onStartLoading);
            contents.removeListener('did-finish-load', onFinishLoad);
            win.removeListener('focus', onFocus);
        } catch (err) {}
        try { delete win.__ankaUpdater; } catch (err) {}
    }

    ipcMain.on(ACTION_CHANNEL, onAction);
    contents.on('did-start-loading', onStartLoading);
    contents.on('did-finish-load', onFinishLoad);
    win.on('focus', onFocus);
    win.once('closed', destroy);

    win.__ankaUpdater = Object.freeze({
        owner: destroy,
        check: (manual) => check(!!manual),
        destroy: destroy
    });

    firstTimer = setTimeout(() => check(startManual), FIRST_CHECK_DELAY);
    intervalTimer = setInterval(() => check(false), CHECK_INTERVAL);
    if (typeof firstTimer.unref === 'function') firstTimer.unref();
    if (typeof intervalTimer.unref === 'function') intervalTimer.unref();

    paint();
    if (!contents.isLoading()) flushAnnounce();
}

function init(targetWin, currentVersion, options) {
    logInfo('init called', { platform: process.platform, version: currentVersion, mainLog: mainLogPath });
    safeAsync(async () => {
        if (process.platform === 'win32') await ensureWindowsScripts();
        else if (process.platform === 'linux') await ensureLinuxService();
    });

    if (targetWin) {
        setupWindow(targetWin, currentVersion, options);
        return;
    }

    BrowserWindow.getAllWindows().forEach((win) => setupWindow(win, currentVersion, options));

    app.on('browser-window-created', (event, win) => {
        try {
            if (win.getParentWindow()) return;
            setupWindow(win, currentVersion, options);
        } catch (err) {
            logWarn('browser-window-created', err);
        }
    });
}

module.exports = { init, installUpdate, logPath: () => mainLogPath };
