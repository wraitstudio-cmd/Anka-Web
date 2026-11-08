# Anka Web Projesi – Kapsamlı Mimari ve Geliştirici Kılavuzu 🚀

Anka-Web projesinin kaynak kodları, sürüm yönetim stratejileri, sürekli entegrasyon süreçleri ve modern dağıtım (deployment) konfigürasyonları bu merkezi depo üzerinden profesyonel standartlarda yönetilmektedir.

---

## 🌐 Erişim ve Resmi Kanallar

Proje hakkında detaylı bilgi edinmek, adım adım kullanım kılavuzunu incelemek ve canlı demoyu test etmek için resmi kaynaklarımıza göz atabilirsiniz:

* **Resmi Web Sitesi:** [AnkaWeb Surge Platformu](https://ankaweb.surge.sh)
* **GitHub Kaynak Deposu:** [WraitStudio-Cmd / Anka-Web](https://github.com/wraitstudio-cmd/Anka-Web)
* **Sürüm Bilgisi:** [`latest.yml`](https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/latest.yml)

---

## ⚡ Hızlı Kurulum

Anka Web'in **en son sürümünü** üç farklı yoldan kurabilirsiniz. Hepsi aynı `latest.yml` dosyasını kullandığı için her zaman en güncel sürümü indirir.

### 🌍 1. Web Sitesinden Kurulum (En Kolay)

Tarayıcınızı açın ve doğrudan resmi siteye gidin:

**👉 [https://ankaweb.surge.sh](https://ankaweb.surge.sh)**

Site, işletim sisteminizi otomatik algılar ve size uygun kurulum dosyasını (`.exe`, `.msi`, `.deb`, `.rpm`, `.AppImage`, `.tar.gz`) tek tıkla indirmenizi sağlar. Kod, terminal veya PowerShell bilgisi gerekmez — indirip çalıştırmanız yeterlidir.

### 🪟 2. Windows – PowerShell (Tek Komut)

**PowerShell**'i açın (Win + X → Terminal) ve aşağıdaki tek satırı yapıştırıp Enter'a basın:

```powershell
irm https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/install.ps1 | iex
```

> ExecutionPolicy engeli çıkarsa önce şu komutu çalıştırın, sonra üstteki satırı tekrar deneyin:
>
> ```powershell
> Set-ExecutionPolicy Bypass -Scope Process -Force
> ```

### 🐧 3. Linux – Terminal (Tek Komut)

```bash
curl -fsSL https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/install.ps1 | pwsh
```

> `pwsh` yoksa: `sudo apt install powershell` veya dağıtımınıza uygun paket.

### Manuel / Güvenli Kurulum (Önerilen)

Komutu körlemesine çalıştırmak istemiyorsanız, betiği önce diske indirip gözden geçirin:

```powershell
irm https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/install.ps1 -OutFile "$env:TEMP\install.ps1"
notepad "$env:TEMP\install.ps1"
powershell -ExecutionPolicy Bypass -File "$env:TEMP\install.ps1"
```

### Kurulum Sihirbazı Ne Yapar?

1. **`latest.yml`'yi** GitHub üzerinden çeker ve en güncel sürüm numarasını okur.
2. **İşletim sistemini** algılar (Windows → `.exe`, Linux → `.AppImage` → `.deb` → `.rpm` → `.tar.gz`).
3. **İlerleme çubuğu** ile indirir — yüzde, indirilen/toplam boyut, anlık hız (MB/sn) ve tahmini kalan süre gösterir.
4. İndirilen paketi **sessiz modda** kurar (`.exe` için `/S`, `.msi` için `/quiet /norestart`, `.deb`/`.rpm` için `dpkg`/`rpm`).
5. Geçici dosyayı temizler ve işlemi tamamlar.

---

## 🛠️ Teknik Altyapı ve Mimari Özellikler

Anka-Web, modern web standartlarına tam uygun olarak yüksek performanslı, ölçeklenebilir ve modüler bir mimariyle tasarlanmıştır.

### Öne Çıkan Mimari Özellikler

* **Hızlı Statik Dağıtım:** Küresel CDN altyapısı sayesinde içeriklerin kullanıcılara milisaniyeler içerisinde, kesintisiz ve yüksek güvenlikli (HTTPS) olarak sunulması.
* **Modüler Bileşen Yapısı:** Arayüz bileşenlerinin birbirinden bağımsız, sürdürülebilir ve kolayca optimize edilebilir bir düzende kurgulanması.
* **Duyarlı (Responsive) Tasarım:** Dokunmatik ekranlar ve masaüstü ekranlarla tam uyumlu, akışkan kullanıcı deneyimi.
* **Gelişmiş Sürüm Kontrolü:** Git iş akışları ile uyumlu, her dağıtımda revizyon takibi yapabilen altyapı entegrasyonu.
* **Otomatik Sürüm Algılama:** `latest.yml` dosyası tek kaynak olarak kullanılır; yeni bir sürüm yayınlandığında kurulum betiği hiçbir değişiklik gerektirmez.

---

## 📦 Sürüm Yayınlama Akışı

Yeni bir sürüm hazırlamak için izlenecek adımlar:

1. Sürüm numarasını `package.json` içinde güncelleyin.
2. `electron-builder` ile tüm platform paketlerini üretin.
3. Üretilen paketleri GitHub Releases altında yayınlayın.
4. `latest.yml` dosyasındaki `version`, `url_exe`, `url_msi`, `url_deb`, `url_rpm`, `url_appimage`, `url_targz` alanlarını yeni sürüme göre güncelleyin.
5. Değişiklikleri `main` dalına itin — kurulum sihirbazı bir sonraki çalıştırmada yeni sürümü otomatik olarak indirecektir.
6. Web sitesindeki (`ankaweb.surge.sh`) indirme bağlantılarının da aynı `latest.yml` sürümünü gösterdiğinden emin olun.

### `latest.yml` Örneği

```yaml
version: 1.5.3
url_exe: https://github.com/wraitstudio-cmd/Anka-Web/releases/download/v1.5.3/Anka_Web_1.5.3.exe
url_msi: https://github.com/wraitstudio-cmd/Anka-Web/releases/download/v1.5.3/Anka_Web_1.5.3_x64.msi
url_deb: https://github.com/wraitstudio-cmd/Anka-Web/releases/download/v1.5.3/Anka_Web_1.5.3_amd64.deb
url_rpm: https://github.com/wraitstudio-cmd/Anka-Web/releases/download/v1.5.3/Anka_Web_1.5.3_x86_64.rpm
url_appimage: https://github.com/wraitstudio-cmd/Anka-Web/releases/download/v1.5.3/Anka_Web_1.5.3_x86_64.AppImage
url_targz: https://github.com/wraitstudio-cmd/Anka-Web/releases/download/v1.5.3/Anka_Web_1.5.3_x64.tar.gz
```

---

## 🧪 Doğrulama ve Test

Kurulum sonrası doğrulama adımları:

```powershell
AnkaWeb --version
```

Beklenen çıktı, `latest.yml` içinde tanımlı sürüm numarasıyla birebir eşleşmelidir.

---

## 🤝 Katkı ve Lisans

* Katkı sağlamak için ilgili konuyu (issue) açın ve `fork → branch → pull request` akışını izleyin.
* Lisans ve kullanım koşulları için depo kök dizinindeki `LICENSE` dosyasına göz atın.

---

## 📌 Özet – Kurulum Yolları

| Yöntem | Komut / Bağlantı | Kime Uygun |
|--------|------------------|------------|
| **Web Sitesi** | [ankaweb.surge.sh](https://ankaweb.surge.sh) | Herkes, en kolay |
| **PowerShell** | `irm https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/install.ps1 \| iex` | Windows, terminal sevenler |
| **Linux** | `curl -fsSL .../install.ps1 \| pwsh` | Linux, terminal sevenler |

Hangi yöntemi seçerseniz seçin, Anka Web'in **en son sürümü** otomatik olarak indirilir ve kurulur.
