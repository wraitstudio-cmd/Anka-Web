$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

$SürümDosyasıAdresi = 'https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/latest.yml'

function BaşlıkGöster {
    param([string]$Metin)
    Write-Host ""
    Write-Host "  $Metin" -ForegroundColor Cyan
    Write-Host ""
}

function BaytBiçimlendir {
    param([double]$Bayt)
    if ($Bayt -ge 1GB) { return ("{0:N2} GB" -f ($Bayt / 1GB)) }
    if ($Bayt -ge 1MB) { return ("{0:N2} MB" -f ($Bayt / 1MB)) }
    if ($Bayt -ge 1KB) { return ("{0:N1} KB" -f ($Bayt / 1KB)) }
    return ("{0:N0} B" -f $Bayt)
}

function SüreBiçimlendir {
    param([double]$Saniye)
    if ($Saniye -lt 60) { return ("{0:N0} sn" -f [Math]::Max(0, $Saniye)) }
    if ($Saniye -lt 3600) { return ("{0:N0} dk {1:N0} sn" -f [Math]::Floor($Saniye / 60), [Math]::Round($Saniye % 60)) }
    return ("{0:N0} sa {1:N0} dk" -f [Math]::Floor($Saniye / 3600), [Math]::Floor(($Saniye % 3600) / 60))
}

function SürümBilgisiAl {
    try {
        $yanıt = Invoke-WebRequest -Uri $SürümDosyasıAdresi -UseBasicParsing -TimeoutSec 20 -ErrorAction Stop
        $içerik = [string]$yanıt.Content
    } catch {
        throw "Sürüm bilgisi alınamadı: $($_.Exception.Message)"
    }

    $sürüm = $null
    if ($içerik -match '(?m)^\s*version\s*:\s*([\w\.\-\+]+)\s*$') { $sürüm = $Matches[1].Trim() }

    $adresler = @{}
    foreach ($satır in ($içerik -split "`r?`n")) {
        if ($satır -match '(?m)^\s*url_([a-zA-Z0-9_]+)\s*:\s*(\S.*?)\s*$') {
            $anahtar = $Matches[1].Trim().ToLower()
            $değer = $Matches[2].Trim().Trim('"').Trim("'")
            $adresler[$anahtar] = $değer
        }
    }

    if (-not $sürüm -or $adresler.Count -eq 0) {
        throw "latest.yml beklenen biçimde değil."
    }

    return [pscustomobject]@{ Sürüm = $sürüm; Adresler = $adresler }
}

function İşletimSistemiAl {
    if (($env:OS -eq 'Windows_NT') -or ($IsWindows -eq $true)) { return 'Windows' }
    if ($IsLinux -eq $true) { return 'Linux' }
    if ($IsMacOS -eq $true) { return 'macOS' }
    return 'Bilinmiyor'
}

function KurulumDosyasıSeç {
    param($SürümBilgisi, [string]$İşletimSistemi)

    $u = $SürümBilgisi.Adresler
    if ($İşletimSistemi -eq 'Windows') {
        if ($u.ContainsKey('exe') -and $u['exe']) { return [pscustomobject]@{ Adres = $u['exe']; Tür = 'exe' } }
        if ($u.ContainsKey('msi') -and $u['msi']) { return [pscustomobject]@{ Adres = $u['msi']; Tür = 'msi' } }
    }
    if ($İşletimSistemi -eq 'Linux') {
        if ($u.ContainsKey('appimage') -and $u['appimage']) { return [pscustomobject]@{ Adres = $u['appimage']; Tür = 'AppImage' } }
        if ($u.ContainsKey('deb') -and $u['deb']) { return [pscustomobject]@{ Adres = $u['deb']; Tür = 'deb' } }
        if ($u.ContainsKey('rpm') -and $u['rpm']) { return [pscustomobject]@{ Adres = $u['rpm']; Tür = 'rpm' } }
        if ($u.ContainsKey('targz') -and $u['targz']) { return [pscustomobject]@{ Adres = $u['targz']; Tür = 'tar.gz' } }
    }
    throw "Bu işletim sistemi için uygun kurulum dosyası bulunamadı."
}

function İlerlemeyleİndir {
    param([string]$Adres, [string]$Hedef)

    $istek = [System.Net.HttpWebRequest]::Create($Adres)
    $istek.Method = 'GET'
    $istek.UserAgent = "AnkaWeb-Kurulum/1.0"
    $istek.AllowAutoRedirect = $true
    $istek.Timeout = 30000
    $istek.ReadWriteTimeout = 60000

    $yanıt = $istek.GetResponse()
    $toplamBoyut = $yanıt.ContentLength
    $akış = $yanıt.GetResponseStream()

    $dosya = [System.IO.File]::Create($Hedef)
    $tampon = New-Object byte[] 1048576

    $okunanToplam = [long]0
    $kronometre = [System.Diagnostics.Stopwatch]::StartNew()
    $sonRapor = [long]0
    $sonBayt = [long]0
    $sonTik = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        while (($okunan = $akış.Read($tampon, 0, $tampon.Length)) -gt 0) {
            $dosya.Write($tampon, 0, $okunan)
            $okunanToplam += $okunan

            $şimdikiMs = $kronometre.ElapsedMilliseconds
            if ($şimdikiMs - $sonRapor -ge 200) {
                $sonRapor = $şimdikiMs
                $tikSaniye = $sonTik.Elapsed.TotalSeconds
                $anlıkHız = if ($tikSaniye -gt 0.05) { ($okunanToplam - $sonBayt) / $tikSaniye } else { 0 }
                $sonTik.Restart()
                $sonBayt = $okunanToplam

                $ortalamaHız = if ($kronometre.Elapsed.TotalSeconds -gt 0) { $okunanToplam / $kronometre.Elapsed.TotalSeconds } else { 0 }
                $hızMetni = (BaytBiçimlendir $anlıkHız) + "/sn"

                if ($toplamBoyut -gt 0) {
                    $yüzde = [Math]::Min(100, [int](($okunanToplam / $toplamBoyut) * 100))
                    $kalan = [Math]::Max(0, $toplamBoyut - $okunanToplam)
                    $kalanSaniye = if ($ortalamaHız -gt 1) { $kalan / $ortalamaHız } else { 0 }
                    $durum = "{0} / {1}  |  {2}  |  Kalan: {3}" -f (BaytBiçimlendir $okunanToplam), (BaytBiçimlendir $toplamBoyut), $hızMetni, (SüreBiçimlendir $kalanSaniye)
                    Write-Progress -Activity "Anka Web indiriliyor" -Status $durum -PercentComplete $yüzde
                } else {
                    $durum = "{0}  |  {1}" -f (BaytBiçimlendir $okunanToplam), $hızMetni
                    Write-Progress -Activity "Anka Web indiriliyor" -Status $durum
                }
            }
        }
    } finally {
        $dosya.Close()
        $akış.Close()
        $yanıt.Close()
        Write-Progress -Activity "Anka Web indiriliyor" -Completed
    }
}

function PaketiKur {
    param([string]$Yol, [string]$Tür)

    if ($Tür -eq 'exe') {
        $süreç = Start-Process -FilePath $Yol -ArgumentList '/S' -Wait -PassThru
        return $süreç.ExitCode
    }
    if ($Tür -eq 'msi') {
        $süreç = Start-Process -FilePath 'msiexec.exe' -ArgumentList "/i `"$Yol`" /quiet /norestart" -Wait -PassThru
        return $süreç.ExitCode
    }
    if ($Tür -eq 'AppImage') {
        $hedefKlasör = Join-Path $HOME '.local/bin'
        $hedef = Join-Path $hedefKlasör 'anka-web'
        New-Item -ItemType Directory -Force -Path $hedefKlasör | Out-Null
        Copy-Item -Path $Yol -Destination $hedef -Force
        & chmod +x $hedef
        return 0
    }
    if ($Tür -eq 'deb') {
        & sudo dpkg -i $Yol
        return $LASTEXITCODE
    }
    if ($Tür -eq 'rpm') {
        & sudo rpm -i --replacepkgs $Yol
        return $LASTEXITCODE
    }
    if ($Tür -eq 'tar.gz') {
        $açmaKlasörü = Join-Path ([System.IO.Path]::GetTempPath()) "anka-web-taşınabilir"
        New-Item -ItemType Directory -Force -Path $açmaKlasörü | Out-Null
        & tar -xzf $Yol -C $açmaKlasörü
        Write-Host "[+] Arşiv açıldı: $açmaKlasörü" -ForegroundColor Green
        return 0
    }
    return 1
}

Clear-Host
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "       Anka Web Kurulum Sihirbazı        " -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Cyan

$hedef = $null
try {
    BaşlıkGöster "Sürüm bilgisi alınıyor..."
    $sürümBilgisi = SürümBilgisiAl
    Write-Host "[+] Sürüm: $($sürümBilgisi.Sürüm)" -ForegroundColor Green

    $işletimSistemi = İşletimSistemiAl
    Write-Host "[+] İşletim sistemi: $işletimSistemi" -ForegroundColor Green

    $kurulum = KurulumDosyasıSeç -SürümBilgisi $sürümBilgisi -İşletimSistemi $işletimSistemi
    $dosyaAdı = [System.IO.Path]::GetFileName(([System.Uri]$kurulum.Adres).AbsolutePath)
    if (-not $dosyaAdı) { $dosyaAdı = "AnkaWeb-$($sürümBilgisi.Sürüm).$($kurulum.Tür)" }

    $hedef = Join-Path ([System.IO.Path]::GetTempPath()) $dosyaAdı

    BaşlıkGöster "İndiriliyor: $dosyaAdı"
    İlerlemeyleİndir -Adres $kurulum.Adres -Hedef $hedef

    $boyutMB = [Math]::Round((Get-Item $hedef).Length / 1MB, 2)
    Write-Host "[+] İndirme tamamlandı: $boyutMB MB" -ForegroundColor Green

    BaşlıkGöster "Kuruluyor..."
    $çıkışKodu = PaketiKur -Yol $hedef -Tür $kurulum.Tür

    if ($çıkışKodu -eq 0 -or $çıkışKodu -eq 3010) {
        Write-Host "[+] Kurulum başarıyla tamamlandı." -ForegroundColor Green
    } else {
        Write-Host "[!] Kurulum sıfır olmayan kodla bitti: $çıkışKodu" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[-] Hata: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    if ($hedef -and (Test-Path $hedef)) {
        try { Remove-Item $hedef -Force -ErrorAction SilentlyContinue } catch { }
    }
    Write-Host ""
    Write-Host "[i] İşlem bitti. Kapatmak için Enter'a basın..." -ForegroundColor Cyan
    try { Read-Host | Out-Null } catch { }
}