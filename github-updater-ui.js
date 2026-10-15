const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, ipcMain, BrowserWindow } = require('electron');

const OWNER = 'wraitstudio-cmd';
const REPO = 'Anka-Web';
const MANIFEST_URL = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/refs/heads/main/latest.yml';
const MANIFEST_PATH = '/' + OWNER + '/' + REPO + '/refs/heads/main/latest.yml';
const DOWNLOAD_PATH_PREFIX = '/' + OWNER + '/' + REPO + '/releases/download/';
const DOWNLOAD_URL_PREFIX = 'https://github.com' + DOWNLOAD_PATH_PREFIX;
const RELEASE_API_PREFIX = '/repos/' + OWNER + '/' + REPO + '/releases/tags/';
const LATEST_API_PATH = '/repos/' + OWNER + '/' + REPO + '/releases/latest';
const UI_VERSION = 18;
const TASK_VERSION = 6;
const FIRST_CHECK_DELAY = 800;
const CHECK_INTERVAL = 5 * 60 * 1000;
const FOCUS_CHECK_GAP = 60 * 1000;
const REQUEST_TIMEOUT = 10000;
const MAX_REDIRECTS = 5;
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_MARKER_BYTES = 4096;
const MARKER_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const NOTES_MAX = 600;
const POLL_MS = 200;
const HANDOFF_DELAY = 500;
const CLAIM_WAIT = 15000;
const CLAIM_POLL = 80;
const MARKER_FILE = 'anka-last-update.json';
const UPDATER_DIR = 'updater';
const TASK_NAME = 'AnkaWebUpdater';
const LINUX_UNIT = 'anka-web-updater.service';
const WIN_JOB_FILE = 'job.json';
const WIN_SCRIPT_FILE = 'anka-updater.ps1';
const WIN_STATUS_FILE = 'status.json';
const WIN_TASK_MARKER = 'task.json';
const WIN_TASK_XML = 'task.xml';
const WIN_TASK_NAMESPACE = 'http://schemas.microsoft.com/windows/2004/02/mit/task';
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

const HTML_PAGE = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anka Web Güncelleniyor</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{height:100%;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:linear-gradient(135deg,#0a0a0f 0%,#15151f 50%,#0a0a0f 100%);color:#f4f4f5;display:flex;align-items:center;justify-content:center}
.bg{position:fixed;inset:0;background:radial-gradient(circle at 25% 35%,rgba(255,71,87,.1) 0%,transparent 45%),radial-gradient(circle at 75% 65%,rgba(255,122,69,.08) 0%,transparent 45%);animation:bgPulse 6s ease-in-out infinite}
@keyframes bgPulse{0%,100%{opacity:.6}50%{opacity:1}}
.card{position:relative;width:min(440px,calc(100vw - 40px));background:rgba(22,22,28,.9);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:36px 32px;box-shadow:0 28px 56px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.02) inset;animation:cardIn .5s cubic-bezier(.16,1,.3,1) both}
@keyframes cardIn{from{opacity:0;transform:translateY(32px) scale(.94)}to{opacity:1;transform:none}}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;border-radius:22px 22px 0 0;background:linear-gradient(90deg,#ff4757,#ff7a45,#ff4757);background-size:200% 100%;animation:shimmer 1.8s linear infinite}
@keyframes shimmer{to{background-position:-200% 0}}
.icon{width:68px;height:68px;margin:0 auto 22px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(135deg,#ff4757,#ff7a45);position:relative;animation:bob 2.2s ease-in-out infinite;transition:background .3s ease}
@keyframes bob{0%,100%{transform:translateY(-3px)}50%{transform:translateY(3px)}}
.icon::after{content:'';position:absolute;inset:-3px;border-radius:20px;border:2px solid rgba(255,71,87,.5);opacity:0;animation:ring 2s ease-out infinite}
@keyframes ring{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.35);opacity:0}}
.icon svg{width:32px;height:32px;fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}
.icon.done{background:linear-gradient(135deg,#10b981,#34d399);animation:none}
.icon.done::after{animation:none}
.icon.done svg{animation:pop .45s cubic-bezier(.34,1.56,.64,1) both}
@keyframes pop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
.icon.err{background:linear-gradient(135deg,#ef4444,#dc2626);animation:none}
.icon.err::after{border-color:rgba(239,68,68,.5);animation:none}
.title{font-size:20px;font-weight:700;text-align:center;margin-bottom:6px;letter-spacing:-.01em}
.subtitle{font-size:13px;color:#a1a1aa;text-align:center;margin-bottom:24px}
.progress-track{height:7px;border-radius:4px;background:rgba(255,255,255,.07);overflow:hidden;margin-bottom:10px}
.progress-bar{height:100%;border-radius:4px;background:linear-gradient(90deg,#ff4757,#ff7a45,#ff4757);background-size:200% 100%;animation:shimmer 1.4s linear infinite;transform-origin:left;transform:scaleX(0);transition:transform .25s cubic-bezier(.4,0,.2,1);will-change:transform}
.progress-info{display:flex;justify-content:space-between;font-size:12px;color:#71717a;margin-bottom:18px}
.progress-info .pct{color:#ff4757;font-weight:700}
.stats{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:20px}
.stat{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.05);border-radius:10px;padding:10px 8px;text-align:center}
.stat-value{font-size:14px;font-weight:700;color:#f4f4f5;font-variant-numeric:tabular-nums}
.stat-label{font-size:10px;color:#71717a;text-transform:uppercase;letter-spacing:.6px;margin-top:3px;font-weight:600}
.status{display:flex;align-items:center;justify-content:center;gap:8px;font-size:12px;color:#a1a1aa;min-height:18px}
.spinner{width:12px;height:12px;border:2px solid rgba(255,255,255,.15);border-top-color:#ff4757;border-radius:50%;animation:spin .7s linear infinite;flex-shrink:0}
@keyframes spin{to{transform:rotate(360deg)}}
.spinner.hidden{display:none}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>
</head>
<body>
<div class="bg"></div>
<div class="card">
<div class="icon" id="icon"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg></div>
<h1 class="title" id="title">Anka Web Güncelleniyor</h1>
<p class="subtitle" id="subtitle">Sürüm __VERSION__ hazırlanıyor</p>
<div class="stats" id="stats">
<div class="stat"><div class="stat-value" id="statPercent">0%</div><div class="stat-label">İlerleme</div></div>
<div class="stat"><div class="stat-value" id="statSpeed">0 MB/s</div><div class="stat-label">Hız</div></div>
<div class="stat"><div class="stat-value" id="statSize">0 MB</div><div class="stat-label">Boyut</div></div>
</div>
<div class="progress-track"><div class="progress-bar" id="bar"></div></div>
<div class="progress-info"><span id="progressText">Hazırlanıyor</span><span class="pct" id="progressPercent">0%</span></div>
<div class="status"><span class="spinner" id="spinner"></span><span id="statusText">Bağlantı kuruluyor</span></div>
</div>
<script>
(function(){
'use strict';
var bar=document.getElementById('bar'),title=document.getElementById('title'),subtitle=document.getElementById('subtitle'),statusText=document.getElementById('statusText'),spinner=document.getElementById('spinner'),icon=document.getElementById('icon'),statPercent=document.getElementById('statPercent'),statSpeed=document.getElementById('statSpeed'),statSize=document.getElementById('statSize'),progressText=document.getElementById('progressText'),progressPercent=document.getElementById('progressPercent');
var lastPhase='',lastPercent=-1,running=true;
function fmtBytes(b){if(!b||b<0)return'0 MB';var mb=b/1048576;if(mb>=1024)return(mb/1024).toFixed(2)+' GB';return mb.toFixed(2)+' MB'}
function fmtSpeed(bps){if(!bps||bps<0)return'0 MB/s';var mbps=bps/1048576;if(mbps>=1024)return(mbps/1024).toFixed(2)+' GB/s';return mbps.toFixed(2)+' MB/s'}
function setIcon(t){if(t==='done'){icon.className='icon done';icon.innerHTML='<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'}else if(t==='error'){icon.className='icon err';icon.innerHTML='<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5h.01"/></svg>'}else{icon.className='icon';icon.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg>'}}
function setStatus(msg,showSpinner){statusText.textContent=msg;if(showSpinner===false)spinner.classList.add('hidden');else spinner.classList.remove('hidden')}
function update(d){
var phase=d.phase||'download',percent=Math.max(0,Math.min(100,d.percent||0));
if(phase!==lastPhase){
lastPhase=phase;
if(phase==='download'){title.textContent='Anka Web Güncelleniyor';subtitle.textContent='Sürüm __VERSION__ indiriliyor';setIcon('download');setStatus('İndiriliyor...',true)}
else if(phase==='verify'){title.textContent='Dosya Doğrulanıyor';subtitle.textContent='SHA256 bütünlük kontrolü';setIcon('download');setStatus('Doğrulanıyor...',true);bar.style.transform='scaleX(1)';progressPercent.textContent='100%';statPercent.textContent='100%';progressText.textContent='Doğrulanıyor'}
else if(phase==='install'){title.textContent='Kurulum Yapılıyor';subtitle.textContent='Lütfen bekleyin, birkaç saniye sürebilir';setIcon('download');setStatus('Sessiz kurulum çalışıyor...',true);bar.style.transform='scaleX(1)';progressPercent.textContent='100%';statPercent.textContent='100%';progressText.textContent='Kuruluyor'}
else if(phase==='done'){title.textContent='Güncelleme Tamamlandı';subtitle.textContent='Anka Web başlatılıyor';setIcon('done');setStatus('Başarıyla tamamlandı',false);bar.style.transform='scaleX(1)';progressPercent.textContent='100%';statPercent.textContent='100%';progressText.textContent='Tamamlandı';statSpeed.textContent='—';statSize.textContent='—';running=false;setTimeout(function(){window.close()},2000)}
else if(phase==='error'){title.textContent='Güncelleme Hatası';subtitle.textContent=d.message||'Bilinmeyen hata';setIcon('error');setStatus('Hata: '+(d.message||'Bilinmeyen hata'),false);progressText.textContent='Başarısız';running=false}
}
if(phase==='download'){
if(percent!==lastPercent){lastPercent=percent;bar.style.transform='scaleX('+(percent/100)+')';progressPercent.textContent=percent+'%';statPercent.textContent=percent+'%'}
var received=d.received||0,total=d.total||0,speed=d.speed||0;
statSpeed.textContent=fmtSpeed(speed*1048576);
statSize.textContent=fmtBytes(received)+(total>0?' / '+fmtBytes(total):'');
progressText.textContent='İndiriliyor';
setStatus(fmtBytes(received)+(total>0?' / '+fmtBytes(total):'')+'  •  '+fmtSpeed(speed*1048576),true)
}
}
var statusUrl='__STATUS_URL__';
function poll(){
if(!running)return;
var req=new XMLHttpRequest();
req.open('GET',statusUrl+'?t='+Date.now(),true);
req.timeout=4000;
req.onload=function(){if(req.status===200){try{update(JSON.parse(req.responseText))}catch(e){}}setTimeout(poll,150)};
req.onerror=function(){setTimeout(poll,400)};
req.ontimeout=function(){setTimeout(poll,400)};
req.send();
}
poll();
})();
</script>
</body>
</html>`;

const WIN_TASK_SCRIPT = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$jobFile = Join-Path $dir 'job.json'
$logFile = Join-Path $dir 'updater.log'
$statusFile = Join-Path $dir 'status.json'
function Write-Log($m) { try { Add-Content -Path $logFile -Value ((Get-Date -Format 's') + ' ' + $m) } catch {} }
function Write-Status($phase, $percent, $received, $total, $speed, $message) {
    $obj = @{ phase = $phase; percent = [int]$percent; received = [long]$received; total = [long]$total; speed = [double]$speed }
    if ($message) { $obj.message = $message }
    try { [IO.File]::WriteAllText($statusFile, ($obj | ConvertTo-Json -Compress), [Text.Encoding]::UTF8) } catch {}
}

$server = $null
$port = 0

function Start-HtmlServer {
    param($HtmlPath)
    try {
        $listener = New-Object System.Net.HttpListener
        $port = Get-Random -Minimum 49152 -Maximum 65535
        $listener.Prefixes.Add("http://127.0.0.1:$port/")
        $listener.Start()
        $script:server = $listener
        $script:port = $port
        Start-Job -ScriptBlock {
            param($L, $H)
            while ($L.IsListening) {
                try {
                    $ctx = $L.GetContext()
                    $path = $ctx.Request.Url.AbsolutePath
                    if ($path -eq '/status.json') {
                        $file = Join-Path (Split-Path $H -Parent) 'status.json'
                        if (Test-Path $file) {
                            $buf = [IO.File]::ReadAllBytes($file)
                            $ctx.Response.ContentType = 'application/json; charset=utf-8'
                            $ctx.Response.ContentLength64 = $buf.Length
                            $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
                        } else {
                            $ctx.Response.StatusCode = 204
                        }
                    } else {
                        $buf = [IO.File]::ReadAllBytes($H)
                        $ctx.Response.ContentType = 'text/html; charset=utf-8'
                        $ctx.Response.ContentLength64 = $buf.Length
                        $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
                    }
                    $ctx.Response.OutputStream.Close()
                } catch {}
            }
        } -ArgumentList $listener, $HtmlPath | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Stop-HtmlServer {
    if ($script:server) {
        try { $script:server.Stop() } catch {}
        try { $script:server.Close() } catch {}
    }
    Get-Job | Where-Object { $_.State -eq 'Running' } | Stop-Job -ErrorAction SilentlyContinue
    Get-Job | Remove-Job -Force -ErrorAction SilentlyContinue
}

function Open-Browser {
    param($Url)
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $Url
        $psi.UseShellExecute = $true
        $psi.WindowStyle = 'Hidden'
        [System.Diagnostics.Process]::Start($psi) | Out-Null
        return $true
    } catch {
        try { Start-Process $Url -WindowStyle Hidden } catch { return $false }
    }
}

function Test-Exe($p) {
    if (-not $p) { return $false }
    if (-not (Test-Path -LiteralPath $p -PathType Leaf)) { return $false }
    $n = [IO.Path]::GetFileName($p)
    if ($n -notlike '*.exe') { return $false }
    if ($n -match '^(unins|uninstall|electron|squirrel|update)') { return $false }
    return $true
}

function Find-InDir($d) {
    if (-not $d -or -not (Test-Path -LiteralPath $d -PathType Container)) { return '' }
    $f = Get-ChildItem -LiteralPath $d -Filter '*.exe' -File -ErrorAction SilentlyContinue | Where-Object { Test-Exe $_.FullName } | Sort-Object Length -Descending | Select-Object -First 1
    if ($f) { return $f.FullName }
    return ''
}

function Find-App($job) {
    $self = [string]$job.exec
    if (Test-Exe $self) { return $self }
    $name = [string]$job.name
    $keys = @(
        'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',
        'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'
    )
    foreach ($k in $keys) {
        $items = @(Get-ItemProperty -Path $k -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -and (($name -and $_.DisplayName -like ($name + '*')) -or $_.DisplayName -like 'Anka*') })
        foreach ($it in $items) {
            $icon = ([string]$it.DisplayIcon) -replace ',\\s*-?\\d+$', '' -replace '"', ''
            if (Test-Exe $icon) { return $icon }
            $found = Find-InDir ([string]$it.InstallLocation)
            if ($found) { return $found }
        }
    }
    $pf86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    $roots = @((Join-Path $env:LOCALAPPDATA 'Programs'), $env:ProgramFiles, $pf86)
    foreach ($root in $roots) {
        if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        $filters = @('Anka*')
        if ($name) { $filters = @(($name + '*'), 'Anka*') }
        foreach ($flt in $filters) {
            $dirs = @(Get-ChildItem -LiteralPath $root -Directory -Filter $flt -ErrorAction SilentlyContinue)
            foreach ($d in $dirs) {
                $found = Find-InDir $d.FullName
                if ($found) { return $found }
            }
        }
    }
    return ''
}

if (-not (Test-Path -LiteralPath $jobFile)) { exit 1 }
$job = $null
try { $job = Get-Content -Raw -Encoding UTF8 -LiteralPath $jobFile | ConvertFrom-Json } catch {}
Remove-Item -LiteralPath $jobFile -Force -ErrorAction SilentlyContinue
if (-not $job) { exit 1 }

$tmp = Join-Path $dir ('anka-web-' + [string]$job.version + '.exe')
$failed = $false
$htmlFile = Join-Path $dir 'updater.html'

try {
    Write-Status 'download' 0 0 0 0 'Hazırlanıyor'
    $uri = [Uri]([string]$job.url)
    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'github.com' -or -not $uri.AbsolutePath.StartsWith('__PREFIX__')) { throw 'Gecersiz adres' }

    $procId = [int]$job.pid
    try { Wait-Process -Id $procId -Timeout 20 } catch {}
    $alive = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($alive -and $alive.ProcessName -eq [string]$job.proc) {
        try { $alive.Kill(); $alive.WaitForExit(8000) | Out-Null } catch {}
    }
    Start-Sleep -Milliseconds 400

    $html = [IO.File]::ReadAllText($htmlFile)
    $html = $html -replace '__VERSION__', [string]$job.version
    [IO.File]::WriteAllText($htmlFile, $html, [Text.Encoding]::UTF8)

    if (Start-HtmlServer $htmlFile) {
        Open-Browser "http://127.0.0.1:$($script:port)/" | Out-Null
    }

    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force }

    $request = [Net.HttpWebRequest]::Create($uri)
    $request.UserAgent = 'AnkaWeb-Updater'
    $request.AllowAutoRedirect = $true
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    $response = $request.GetResponse()
    try {
        $total = [long]$response.ContentLength
        $netStream = $response.GetResponseStream()
        $fileStream = [IO.File]::Create($tmp)
        try {
            $buffer = New-Object byte[] 262144
            $received = [long]0
            $clock = [Diagnostics.Stopwatch]::StartNew()
            $lastWrite = [long]0
            $lastBytes = [long]0
            while (($read = $netStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $fileStream.Write($buffer, 0, $read)
                $received += $read
                $elapsed = $clock.ElapsedMilliseconds
                if (($elapsed - $lastWrite) -ge 120) {
                    $percent = 0
                    if ($total -gt 0) { $percent = [int][Math]::Floor(($received * 100) / $total) }
                    $deltaTime = ($elapsed - $lastWrite) / 1000.0
                    $deltaBytes = $received - $lastBytes
                    $speed = 0
                    if ($deltaTime -gt 0) { $speed = ($deltaBytes / 1MB) / $deltaTime }
                    Write-Status 'download' $percent $received $total $speed 'İndiriliyor'
                    $lastWrite = $elapsed
                    $lastBytes = $received
                }
            }
        } finally {
            $fileStream.Close()
            $netStream.Close()
        }
    } finally {
        $response.Close()
    }

    Write-Status 'verify' 100 0 0 0 'Doğrulanıyor'

    $info = Get-Item -LiteralPath $tmp
    if ($info.Length -lt 1024) { throw 'Indirilen dosya gecersiz' }
    $stream = [IO.File]::OpenRead($tmp)
    try { $b1 = $stream.ReadByte(); $b2 = $stream.ReadByte() } finally { $stream.Close() }
    if ($b1 -ne 0x4d -or $b2 -ne 0x5a) { throw 'Gecerli bir kurulum dosyasi degil' }
    $expected = ([string]$job.hash).ToLower()
    if ($expected) {
        $actual = (Get-FileHash -LiteralPath $tmp -Algorithm SHA256).Hash.ToLower()
        if ($actual -ne $expected) { throw 'Dosya dogrulamasi basarisiz' }
    }

    Write-Status 'install' 100 0 0 0 'Kuruluyor'

    $proc = Start-Process -FilePath $tmp -ArgumentList @('/S', '--updated') -WindowStyle Hidden -Wait -PassThru
    Write-Log ('kurulum cikis kodu ' + $proc.ExitCode)
} catch {
    $failed = $true
    $message = [string]$_.Exception.Message
    Write-Log $message
    Write-Status 'error' 0 0 0 0 $message
    Start-Sleep -Seconds 4
} finally {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
}

if (-not $failed) {
    Write-Status 'done' 100 0 0 0 ''
    Start-Sleep -Milliseconds 800
}

Stop-HtmlServer

$target = ''
try { $target = Find-App $job } catch { Write-Log $_.Exception.Message }
if (-not $target) {
    Write-Log 'uygulama bulunamadi'
    exit 1
}
try {
    Start-Process -FilePath 'explorer.exe' -ArgumentList ('"' + $target + '"') -WindowStyle Hidden
} catch {
    try { Start-Process -FilePath $target -WorkingDirectory (Split-Path -Parent $target) -WindowStyle Hidden } catch { Write-Log $_.Exception.Message }
}
`.replace('__PREFIX__', DOWNLOAD_PATH_PREFIX);

const LINUX_SCRIPT = `#!/bin/sh
DIR=$(cd "$(dirname "$0")" && pwd)
JOB="$DIR/job.env"
LOG="$DIR/updater.log"
STATUS="$DIR/status.json"
log() { echo "$(date '+%Y-%m-%dT%H:%M:%S') $1" >> "$LOG" 2>/dev/null; }
write_status() {
    printf '{"phase":"%s","percent":%d,"received":%d,"total":%d,"speed":%.2f%s}' "$1" "$2" "$3" "$4" "$5" "$6" > "$STATUS" 2>/dev/null
}

find_bin() {
    for d in /usr/bin /bin /usr/local/bin /usr/sbin /sbin; do
        if [ -x "$d/$1" ]; then printf '%s' "$d/$1"; return 0; fi
    done
    command -v "$1" 2>/dev/null
}

if [ ! -f "$JOB" ]; then exit 1; fi
. "$JOB"
rm -f "$JOB"
trap '' HUP

HTML_FILE="$DIR/updater.html"
if [ -f "$HTML_FILE" ]; then
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "file://$HTML_FILE" >/dev/null 2>&1 &
    fi
fi

TMP="$DIR/anka-web-$ANKA_VERSION.AppImage.part"
rm -f "$TMP"

remote_size() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsIL --connect-timeout 15 -A AnkaWeb-Updater "$ANKA_URL" 2>/dev/null | tr -d '\\r' | grep -i '^content-length:' | tail -n 1 | tr -dc '0-9'
    elif command -v wget >/dev/null 2>&1; then
        wget --spider -S -q -T 30 -t 1 -U AnkaWeb-Updater "$ANKA_URL" 2>&1 | tr -d '\\r' | grep -i 'content-length:' | tail -n 1 | tr -dc '0-9'
    fi
}

fetch() {
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --retry 3 --retry-delay 1 --connect-timeout 15 --max-time 900 -A AnkaWeb-Updater -o "$2" "$1"
    elif command -v wget >/dev/null 2>&1; then
        wget -q -T 30 -t 3 -U AnkaWeb-Updater -O "$2" "$1"
    else
        return 127
    fi
}

case "$ANKA_URL" in
    "__PREFIX__"*) ;;
    *) write_status "error" 0 0 0 0 ',"message":"Gecersiz adres"'; exit 1 ;;
esac

write_status "download" 0 0 0 0 ""

n=0
while kill -0 "$ANKA_PID" 2>/dev/null && [ "$n" -lt 100 ]; do
    n=$((n+1))
    sleep 0.2
done
if kill -0 "$ANKA_PID" 2>/dev/null; then
    kill -TERM "$ANKA_PID" 2>/dev/null
    sleep 1
    kill -KILL "$ANKA_PID" 2>/dev/null
fi
sleep 0.3

TOTAL=$(remote_size)
[ -n "$TOTAL" ] || TOTAL=0

fetch "$ANKA_URL" "$TMP" &
FPID=$!
PREV=0
PREVT=0
while kill -0 "$FPID" 2>/dev/null; do
    CUR=0
    [ -f "$TMP" ] && CUR=$(wc -c < "$TMP" | tr -d '[:space:]')
    [ -n "$CUR" ] || CUR=0
    PCT=0
    [ "$TOTAL" -gt 0 ] && PCT=$((CUR*100/TOTAL))
    [ "$PCT" -gt 99 ] && PCT=99
    NOW=$(date +%s%N 2>/dev/null || date +%s)
    SPD=$(( (CUR-PREV)*5 ))
    [ "$SPD" -ge 0 ] || SPD=0
    PREV=$CUR
    write_status "download" "$PCT" "$CUR" "$TOTAL" "$SPD" ""
    sleep 0.2
done
wait "$FPID" || { write_status "error" 0 0 0 0 ',"message":"Indirme basarisiz"'; exit 1; }

write_status "verify" 100 0 0 0 ""

SIZE=$(wc -c < "$TMP" 2>/dev/null | tr -d '[:space:]')
[ -n "$SIZE" ] && [ "$SIZE" -ge 1024 ] || { write_status "error" 0 0 0 0 ',"message":"Gecersiz dosya"'; exit 1; }
MAGIC=$(head -c 4 "$TMP" | od -An -tx1 | tr -d '[:space:]')
[ "$MAGIC" = "7f454c46" ] || { write_status "error" 0 0 0 0 ',"message":"Gecerli AppImage degil"'; exit 1; }
if [ -n "$ANKA_HASH" ]; then
    if command -v sha256sum >/dev/null 2>&1; then
        SUM=$(sha256sum "$TMP" | cut -d' ' -f1)
    elif command -v shasum >/dev/null 2>&1; then
        SUM=$(shasum -a 256 "$TMP" | cut -d' ' -f1)
    else
        write_status "error" 0 0 0 0 ',"message":"sha256 yok"'; exit 1
    fi
    [ "$SUM" = "$ANKA_HASH" ] || { write_status "error" 0 0 0 0 ',"message":"Dogrulama basarisiz"'; exit 1; }
fi

write_status "install" 100 0 0 0 ""

mkdir -p "$(dirname "$ANKA_DEST")" || { write_status "error" 0 0 0 0 ',"message":"Hedef olusturulamadi"'; exit 1; }
if cp -f "$TMP" "$ANKA_DEST.new" && chmod 755 "$ANKA_DEST.new" && mv -f "$ANKA_DEST.new" "$ANKA_DEST"; then
    rm -f "$TMP"
    log "guncelleme tamamlandi: $ANKA_VERSION"
else
    rm -f "$ANKA_DEST.new"
    write_status "error" 0 0 0 0 ',"message":"Dosya degistirilemedi"'; exit 1
fi

write_status "done" 100 0 0 0 ""

sleep 0.5
[ -x "$ANKA_DEST" ] || exit 0
unset APPIMAGE APPDIR ARGV0 OWD
if command -v setsid >/dev/null 2>&1; then
    setsid "$ANKA_DEST" >/dev/null 2>&1 </dev/null &
else
    nohup "$ANKA_DEST" >/dev/null 2>&1 </dev/null &
fi
sleep 1
exit 0
`.replace('__PREFIX__', DOWNLOAD_URL_PREFIX);

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
        if (ipc) ipc.send('anka-updater:action', action);
        else queue.push(action);
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

let ensurePromise = null;

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

function platformKinds() {
    if (process.platform === 'win32') return ['exe'];
    if (process.platform === 'linux') {
        if (process.arch !== 'x64') throw new Error('Bu işlemci mimarisi için paket yok');
        return ['appimage'];
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
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: true, env: cleanEnv(extraEnv) });
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
        const child = spawn(command, args, {
            detached: true,
            stdio: 'ignore',
            shell: false,
            windowsHide: true,
            cwd: cwd,
            env: cleanEnv(extraEnv)
        });
        child.once('error', reject);
        child.once('spawn', () => {
            child.unref();
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

function systemPath(...parts) {
    const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    return path.join(root, 'System32', ...parts);
}

function updaterDir() {
    return path.join(app.getPath('userData'), UPDATER_DIR);
}

function prepareUpdaterDir() {
    const dir = updaterDir();
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return dir;
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
    fs.writeFileSync(temp, content, { mode: mode });
    fs.renameSync(temp, file);
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

function xmlEscape(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function windowsTaskXml(script) {
    const name = process.env.USERNAME || os.userInfo().username;
    const user = (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + name;
    const powershell = systemPath('WindowsPowerShell', 'v1.0', 'powershell.exe');
    const args = '-NoProfile -NoLogo -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + script + '"';
    return [
        '<?xml version="1.0" encoding="UTF-16"?>',
        '<Task version="1.4" xmlns="' + WIN_TASK_NAMESPACE + '">',
        '  <RegistrationInfo>',
        '    <Description>Anka Web Updater</Description>',
        '  </RegistrationInfo>',
        '  <Principals>',
        '    <Principal id="Author">',
        '      <UserId>' + xmlEscape(user) + '</UserId>',
        '      <LogonType>InteractiveToken</LogonType>',
        '      <RunLevel>LeastPrivilege</RunLevel>',
        '    </Principal>',
        '  </Principals>',
        '  <Settings>',
        '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
        '    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>',
        '    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>',
        '    <AllowHardTerminate>true</AllowHardTerminate>',
        '    <StartWhenAvailable>true</StartWhenAvailable>',
        '    <AllowStartOnDemand>true</AllowStartOnDemand>',
        '    <Enabled>true</Enabled>',
        '    <Hidden>true</Hidden>',
        '    <ExecutionTimeLimit>PT30M</ExecutionTimeLimit>',
        '    <Priority>7</Priority>',
        '  </Settings>',
        '  <Actions Context="Author">',
        '    <Exec>',
        '      <Command>' + xmlEscape(powershell) + '</Command>',
        '      <Arguments>' + xmlEscape(args) + '</Arguments>',
        '    </Exec>',
        '  </Actions>',
        '</Task>'
    ].join('\r\n');
}

async function createWindowsTask(dir, script) {
    const xmlFile = path.join(dir, WIN_TASK_XML);
    const xml = windowsTaskXml(script);
    fs.writeFileSync(xmlFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, 'utf16le')]), { mode: 0o600 });
    try {
        const result = await runProcess(systemPath('schtasks.exe'), ['/create', '/tn', TASK_NAME, '/xml', xmlFile, '/f']);
        if (result.code !== 0) {
            const fallbackResult = await runProcess(systemPath('schtasks.exe'), ['/create', '/tn', TASK_NAME, '/tr', `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${script}"`, '/sc', 'ONCE', '/st', '00:00', '/f']);
            return fallbackResult.code === 0;
        }
        return true;
    } catch (err) {
        return false;
    } finally {
        try {
            fs.rmSync(xmlFile, { force: true });
        } catch (cleanupErr) {}
    }
}

async function ensureWindowsTask() {
    const dir = prepareUpdaterDir();
    const script = path.join(dir, WIN_SCRIPT_FILE);
    writeIfChanged(script, '\uFEFF' + WIN_TASK_SCRIPT, 0o600);

    const htmlFile = path.join(dir, 'updater.html');
    writeIfChanged(htmlFile, HTML_PAGE, 0o600);

    const markerFile = path.join(dir, WIN_TASK_MARKER);
    let marker = null;
    try {
        marker = JSON.parse(fs.readFileSync(markerFile, 'utf8'));
    } catch (err) {
        marker = null;
    }

    let exists = false;
    try {
        const query = await runProcess(systemPath('schtasks.exe'), ['/query', '/tn', TASK_NAME]);
        exists = query.code === 0;
    } catch (err) {
        exists = false;
    }

    if (exists && marker && marker.script === script && marker.v === TASK_VERSION) return;

    if (exists) {
        try {
            await runProcess(systemPath('schtasks.exe'), ['/delete', '/tn', TASK_NAME, '/f']);
        } catch (err) {}
    }

    try {
        fs.rmSync(markerFile, { force: true });
    } catch (err) {}

    const created = await createWindowsTask(dir, script);
    if (!created) throw new Error('Güncelleme görevi oluşturulamadı');

    try {
        fs.writeFileSync(markerFile, JSON.stringify({ script: script, v: TASK_VERSION }), { mode: 0o600 });
    } catch (err) {}
}

async function triggerWindows(job) {
    await ensureBackground();
    const dir = prepareUpdaterDir();
    const jobFile = path.join(dir, WIN_JOB_FILE);
    fs.writeFileSync(jobFile, JSON.stringify(job), { mode: 0o600 });

    let result;
    try {
        result = await runProcess(systemPath('schtasks.exe'), ['/run', '/tn', TASK_NAME]);
    } catch (err) {
        result = { code: 1 };
    }

    if (result.code !== 0) {
        try {
            await launchDetached('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, WIN_SCRIPT_FILE)], dir);
        } catch (fallbackErr) {
            fs.rmSync(jobFile, { force: true });
            throw new Error('Güncelleme görevi başlatılamadı');
        }
    }

    if (!(await waitClaim(jobFile, CLAIM_WAIT))) {
        try {
            if (fs.existsSync(jobFile)) {
                await launchDetached('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', path.join(dir, WIN_SCRIPT_FILE)], dir);
                if (await waitClaim(jobFile, CLAIM_WAIT)) return;
            }
        } catch (err) {}
        fs.rmSync(jobFile, { force: true });
        throw new Error('Güncelleme görevi yanıt vermedi');
    }
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

async function ensureLinuxService() {
    const dir = prepareUpdaterDir();
    const script = path.join(dir, LINUX_SCRIPT_FILE);
    writeIfChanged(script, LINUX_SCRIPT, 0o755);
    try {
        fs.chmodSync(script, 0o755);
    } catch (err) {}

    const htmlFile = path.join(dir, 'updater.html');
    let html = HTML_PAGE;
    writeIfChanged(htmlFile, html, 0o644);

    const systemctl = findBin('systemctl');
    if (!systemctl) return;

    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const unitDir = path.join(configHome, 'systemd', 'user');
    fs.mkdirSync(unitDir, { recursive: true, mode: 0o755 });
    const changed = writeIfChanged(path.join(unitDir, LINUX_UNIT), linuxUnitContent(script), 0o644);
    if (changed) {
        try {
            await runProcess(systemctl, ['--user', 'daemon-reload']);
        } catch (err) {}
    }
}

function linuxJobContent(target, version) {
    const lines = [
        'ANKA_PID=' + shellQuote(process.pid),
        'ANKA_URL=' + shellQuote(target.url),
        'ANKA_HASH=' + shellQuote(target.hash || ''),
        'ANKA_VERSION=' + shellQuote(version),
        'ANKA_DEST=' + shellQuote(linuxDestination())
    ];
    GUI_ENV.forEach((key) => {
        if (process.env[key]) lines.push('export ' + key + '=' + shellQuote(process.env[key]));
    });
    return lines.join('\n') + '\n';
}

async function triggerLinux(target, version) {
    await ensureBackground();
    const dir = prepareUpdaterDir();
    const script = path.join(dir, LINUX_SCRIPT_FILE);
    const jobFile = path.join(dir, LINUX_JOB_FILE);
    fs.writeFileSync(jobFile, linuxJobContent(target, version), { mode: 0o600 });

    let claimed = false;
    const systemctl = findBin('systemctl');
    if (systemctl) {
        try {
            const result = await runProcess(systemctl, ['--user', 'start', '--no-block', LINUX_UNIT]);
            if (result.code === 0) claimed = await waitClaim(jobFile, CLAIM_WAIT);
        } catch (err) {
            claimed = false;
        }
    }

    if (!claimed && fs.existsSync(jobFile)) {
        try {
            await launchDetached(SH_BIN, [script], dir);
            claimed = await waitClaim(jobFile, CLAIM_WAIT);
        } catch (err) {
            claimed = false;
        }
    }

    if (!claimed) {
        fs.rmSync(jobFile, { force: true });
        throw new Error('Güncelleme servisi başlatılamadı');
    }
}

function ensureBackground() {
    if (!ensurePromise) {
        let work;
        if (process.platform === 'win32') work = ensureWindowsTask();
        else if (process.platform === 'linux') work = ensureLinuxService();
        else work = Promise.resolve();
        ensurePromise = work.catch((err) => {
            ensurePromise = null;
            throw err;
        });
    }
    return ensurePromise;
}

async function launchBackgroundUpdate(target, version) {
    if (process.platform === 'win32') {
        await triggerWindows({
            pid: process.pid,
            url: target.url,
            hash: target.hash || '',
            version: version,
            exec: app.isPackaged ? process.execPath : '',
            proc: path.parse(process.execPath).name,
            name: app.getName()
        });
        return;
    }
    if (process.platform === 'linux') {
        await triggerLinux(target, version);
        return;
    }
    throw new Error('Bu platformda otomatik güncelleme desteklenmiyor');
}

function setupWindow(win, currentVersion, options) {
    if (!win || win.isDestroyed() || win.__ankaUpdater) return;

    const contents = win.webContents;
    const installed = String(currentVersion || app.getVersion());
    const startManual = !!(options && options.manual);
    const updatedTo = takeMarker(installed);

    let announce = updatedTo ? 'Anka Web Sürümü ' + updatedTo + ' kuruldu' : '';
    let destroyed = false;
    let busy = false;
    let installing = false;
    let uiReady = false;
    let lastCheck = 0;
    let firstTimer = null;
    let intervalTimer = null;
    let pollTimer = null;
    let abortCtl = null;

    async function ensureUi() {
        if (destroyed || win.isDestroyed()) return false;
        if (uiReady) return true;
        try {
            await contents.executeJavaScript('(' + BOOT_SOURCE + ')(' + UI_VERSION + ')');
            uiReady = true;
            if (!pollTimer) {
                const hasIpc = await contents.executeJavaScript('Boolean(window.__ankaUpdater && window.__ankaUpdater.ipc)');
                if (!hasIpc) startPoll();
            }
            return true;
        } catch (err) {
            return false;
        }
    }

    async function send(view) {
        if (!(await ensureUi())) return;
        try {
            await contents.executeJavaScript('window.__ankaUpdater&&window.__ankaUpdater.render(' + safeJson(view) + ')');
        } catch (err) {}
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
                if (manual) await send({ view: 'info', title: 'Anka Web', message: 'Anka Web Sürümü ' + installed + ' güncel' });
                return;
            }

            const kinds = platformKinds();
            if (!kinds) {
                if (manual) await send({ view: 'info', title: 'Anka Web', message: 'Bu platformda otomatik güncelleme desteklenmiyor' });
                return;
            }

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
            }

            paint();
        } catch (err) {
            if (ctl.signal.aborted || destroyed) return;
            if (manual) await send({ view: 'error', message: err && err.message ? err.message : 'İnternet bağlantısı yok' });
        } finally {
            busy = false;
            if (abortCtl === ctl) abortCtl = null;
        }
    }

    async function startBackgroundUpdate() {
        if (installing || destroyed || !state.targets.length) return;
        installing = true;

        try {
            const target = state.targets[0];
            const version = state.version;

            state.phase = 'ready';
            state.percent = 100;
            state.kind = target.kind;
            state.detail = '';
            paint();

            writeMarker(installed, version);
            await launchBackgroundUpdate(target, version);

            await sleep(HANDOFF_DELAY);
            if (destroyed) return;
            quitSoon();
        } catch (err) {
            installing = false;
            removeMarker();
            resetState();
            if (!destroyed) await send({ view: 'error', message: err && err.message ? err.message : 'Güncelleme başlatılamadı' });
        }
    }

    function handle(action) {
        if (typeof action !== 'string' || !ACTIONS.has(action) || destroyed) return;

        if (action === 'later' || action === 'close' || action === 'skip') {
            state.snoozed = state.version;
            if (abortCtl) abortCtl.abort();
            send(null);
        } else if (action === 'install' || action === 'update') {
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
        if (abortCtl) abortCtl.abort();
        try {
            ipcMain.removeListener(ACTION_CHANNEL, onAction);
        } catch (err) {}
        try {
            contents.removeListener('did-start-loading', onStartLoading);
            contents.removeListener('did-finish-load', onFinishLoad);
            win.removeListener('focus', onFocus);
        } catch (err) {}
        try {
            delete win.__ankaUpdater;
        } catch (err) {}
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
    ensureBackground().catch(() => {});

    if (targetWin) {
        setupWindow(targetWin, currentVersion, options);
        return;
    }

    BrowserWindow.getAllWindows().forEach((win) => setupWindow(win, currentVersion, options));

    app.on('browser-window-created', (event, win) => {
        if (win.getParentWindow()) return;
        setupWindow(win, currentVersion, options);
    });
}

module.exports = { init };
