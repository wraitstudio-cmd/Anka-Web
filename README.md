# Anka Web 🚀

Modern, hızlı ve güvenli web tarayıcısı. En son sürümü her zaman tek tıkla veya tek komutla indirebilirsiniz.

---

## 🌐 Resmi Kanallar

* **Web Sitesi:** [ankaweb.surge.sh](https://ankaweb.surge.sh)
* **GitHub Deposu:** [WraitStudio-Cmd / Anka-Web](https://github.com/wraitstudio-cmd/Anka-Web)
* **Sürüm Bilgisi:** [`latest.yml`](https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/latest.yml)

---

## ⚡ İndirme ve Kurulum

Anka Web'i üç farklı yoldan kurabilirsiniz. Hepsi aynı `latest.yml` dosyasını kullandığı için **her zaman en güncel sürüm** iner.

### 🌍 1. Web Sitesinden İndir (En Kolay)

Tarayıcınızı açın ve doğrudan siteye gidin:

**👉 [https://ankaweb.surge.sh](https://ankaweb.surge.sh)**

Site işletim sisteminizi otomatik algılar ve size uygun kurulum dosyasını (`.exe`, `.msi`, `.deb`, `.rpm`, `.AppImage`, `.tar.gz`) tek tıkla indirir. Terminal veya komut bilgisi gerekmez.

### 🪟 2. Windows – PowerShell (Tek Komut)

PowerShell'i açın (Win + X → Terminal) ve şu satırı yapıştırın:

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

### 🔒 Güvenli İndirme (İsteğe Bağlı)

Komutu körlemesine çalıştırmak istemiyorsanız betiği önce diske indirip inceleyin:

```powershell
irm https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/install.ps1 -OutFile "$env:TEMP\install.ps1"
notepad "$env:TEMP\install.ps1"
powershell -ExecutionPolicy Bypass -File "$env:TEMP\install.ps1"
```

---

## 📥 İndirilebilir Paketler

| Platform | Dosya Türü | Ne Zaman Kullanılır |
|----------|------------|---------------------|
| Windows | `.exe` | Kurulum sihirbazı (önerilen) |
| Windows | `.msi` | Yönetici / kurumsal kurulum |
| Linux | `.AppImage` | Kurulumsuz, tek dosya (önerilen) |
| Linux | `.deb` | Debian / Ubuntu / Mint |
| Linux | `.rpm` | Fedora / RHEL / openSUSE |
| Linux | `.tar.gz` | Taşınabilir sürüm |

---

## ✨ Öne Çıkan Özellikler

* **Hızlı ve Güvenli Gezinme** – Küresel CDN altyapısı sayesinde içerikler saniyeler içinde, HTTPS ile sunulur.
* **Çoklu Sekme Yönetimi** – Sekmeleri gruplar, sabitler, sessize alır ve oturum olarak kaydedip geri yükler.
* **Yerleşik Parola Yöneticisi** – Kayıtlı hesaplar cihazda şifreli saklanır, güçlü parola üretici içerir.
* **Kalem ve Ders Araçları** – Sayfaların üzerine çizin, alan yakalayın, kronometre ve geri sayım kullanın.
* **Karanlık Mod ve Okuma Modu** – Her site için ayrı ayrı açılabilir; göz yorgunluğunu azaltır.
* **Gizlilik ve Site İzinleri** – Her site için kamera, mikrofon, konum ve bildirim izinleri ayrı yönetilir.
* **Reklam ve Takip Engelleyici** – Zararlı reklam ağları ve izleyiciler otomatik olarak bloklanır.
* **Sekme Uyutma** – Arka plandaki sekmeler uyutularak bellek tasarrufu sağlanır.
* **Duyarlı Tasarım** – Dokunmatik ekranlar ve masaüstüyle tam uyumlu, akışkan arayüz.

---

## 🔄 Sürüm Güncellemesi

Anka Web, `latest.yml` dosyasını tek kaynak olarak kullanır. Yeni sürüm yayınlandığında:

- Web sitesi otomatik olarak yeni sürümü gösterir.
- PowerShell / Linux komutu bir sonraki çalıştırmada en son sürümü indirir.
- Kullanıcının hiçbir şey yapmasına gerek kalmaz.

---

## 🤝 Katkı ve Lisans

* Hata bildirimi ve öneriler için GitHub'da **issue** açabilirsiniz.
* Lisans ve kullanım koşulları için depodaki `LICENSE` dosyasına göz atın.

---

## 📌 Özet

| Yöntem | Adres / Komut |
|--------|---------------|
| **Web Sitesi** | [ankaweb.surge.sh](https://ankaweb.surge.sh) |
| **Windows PowerShell** | `irm https://raw.githubusercontent.com/wraitstudio-cmd/Anka-Web/refs/heads/main/install.ps1 \| iex` |
| **Linux Terminal** | `curl -fsSL .../install.ps1 \| pwsh` |

Hangi yolu seçerseniz seçin, Anka Web'in **en son sürümü** otomatik olarak indirilir ve kurulur.
