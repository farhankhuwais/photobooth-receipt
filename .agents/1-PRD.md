# PRD — Photobooth Receipt (PWA + Thermal Print)

## BAGIAN 1: Visi & Tujuan Produk

**Visi**
Aplikasi web (PWA) photobooth yang berjalan di browser, mengambil foto lewat kamera perangkat, menyusun strip foto bergaya dengan dekor/branding, lalu langsung mencetak ke printer thermal Bluetooth **IWARE XS-80BT** (80mm) serta membagikan versi digital via QR + social share — tanpa install software berat.

**Tujuan Utama**
1. Capture & cetak strip foto dalam < 60 detik per sesi — indikator: rata-rata waktu sesi.
2. Dukungan multi-template + branding event — indikator: jumlah template & preset branding tersedia.
3. Cetak langsung ke thermal tanpa driver OS — indikator: berhasil cetak via Web Bluetooth (Chrome/Edge/Android) + fallback bridge.
4. Share digital otomatis — indikator: QR & Web Share ter-generasi tiap sesi.

**Value Proposition**
- PWA: buka di browser/HP, install layaknya app, tanpa setup driver.
- Web Bluetooth: kirim ESC/POS langsung ke XS-80BT (Chrome/Edge/Android).
- Print-bridge fallback: cover iOS/macOS & browser terkunci + siap untuk mobile native (Capacitor).
- Multi-template + branding + QR share dalam satu alur.

## BAGIAN 2: User Persona

**Persona 1 — Operator Event (Rian, 28)**
- Usia/Pekerjaan: 28, penyedia jasa photobooth & WO.
- Level Teknis: Menengah.
- Tujuan: Setup cepat di lokasi, ganti branding per event, cetak lancar saat ramai.
- Pain Points: software photobooth mahal/berat, printer susah disambungkan, tidak bisa branding cepat.
- Motivasi: alat praktis, hasil profesional, bisa di-HP & laptop.

**Persona 2 — Tamu/User Akhir (Siti, 22)**
- Usia/Pekerjaan: 22, tamu acara/pernikahan.
- Level Teknis: Pemula.
- Tujuan: foto lucu, dapat strip fisik + bisa share ke HP.
- Pain Points: antre lama, tidak dapat file digital, hasil monoton.
- Motivasi: pengalaman seru, souvenir fisik + share sosmed.

## BAGIAN 3: User Stories

**Modul Kamera & Sesi**
- Sebagai tamu, saya ingin lihat preview kamera live, agar bisa pose sebelum jepret.
- Sebagai tamu, saya ingin ada countdown sebelum jepret, agar siap.
- Sebagai tamu, saya ingin ambil beberapa foto untuk strip, agar dapat kolase.
- Sebagai tamu, saya ingin ulang foto jika jelek, agar hasil memuaskan.

**Modul Template & Branding**
- Sebagai tamu, saya ingin pilih template strip (3-vertikal/2x2/1-besar), agar sesuai selera.
- Sebagai operator, saya ingin atur logo & teks header/footer event, agar branded.
- Sebagai operator, saya ingin tambah frame/dekor & watermark, agar estetik.
- Sebagai sistem, saya ingin cap tanggal & nama event di struk, agar berkesan.

**Modul Cetak**
- Sebagai operator, saya ingin konek printer XS-80BT via Bluetooth, agar cetak langsung.
- Sebagai operator, saya ingin fallback cetak lewat bridge lokal, agar jalan di iPad/iOS.
- Sebagai tamu, saya ingin lihat preview sebelum cetak, agar tidak salah.

**Modul Share & Digital**
- Sebagai tamu, saya ingin dapat QR ke foto digital, agar simpan di HP.
- Sebagai tamu, saya ingin share ke sosmed via Web Share, agar posting mudah.
- Sebagai operator, saya ingin foto tersimpan di backend, agar bisa diambil tamu lewat link.

## BAGIAN 4: Functional Requirements

**FR-01: Live Camera Preview**
- Input: stream getUserMedia.
- Proses: render ke <video>, deteksi device kamera.
- Output: preview real-time + pilih kamera depan/belakang.
- Aturan: izin kamera wajib; fallback pesan jika ditolak.

**FR-02: Countdown & Capture**
- Input: trigger jepret.
- Proses: hitung mundur 3-2-1, snapshot ke canvas.
- Output: frame foto tersimpan di sesi.
- Aturan: jumlah foto = sesuai template (2/3/4).

**FR-03: Template Engine**
- Input: kumpulan frame + pilihan template.
- Proses: susun di canvas (3-vertikal / 2x2 / 1-besar+struk).
- Output: canvas strip siap cetak.
- Aturan: resolusi disesuaikan lebar 80mm (~576px @203dpi).

**FR-04: Branding & Decor**
- Input: logo, teks event, frame PNG, watermark.
- Proses: overlay ke canvas, cap tanggal.
- Output: strip + area struk ber-branding.
- Aturan: logo max ukuran; watermark opacity configurable.

**FR-05: ESC/POS Encode**
- Input: canvas strip (PNG).
- Proses: encode ke perintah ESC/POS (image raster + text + qrimage).
- Output: byte stream ESC/POS.
- Aturan: dithering gambar ke 1-bit agar tajam di thermal.

**FR-06: Web Bluetooth Print**
- Input: byte ESC/POS.
- Proses: navigator.bluetooth pilih XS-80BT, tulis ke characteristic.
- Output: cetakan strip + struk.
- Aturan: butuh HTTPS/localhost; hanya Chrome/Edge/Android.

**FR-07: Print Bridge Fallback**
- Input: PNG strip dari web app.
- Proses: POST ke Node bridge → node-escpos bluetooth ke printer.
- Output: cetakan.
- Aturan: auto-fallback bila Web Bluetooth tidak tersedia.

**FR-08: Backend Upload & URL**
- Input: PNG strip.
- Proses: simpan (lokal/cloud), generate short URL.
- Output: URL untuk QR.
- Aturan: retensi file configurable; max size upload.

**FR-09: QR Code Digital**
- Input: URL dari FR-08.
- Proses: generate QR ke area struk (qrimage).
- Output: QR ter-cetak + tampil di layar.
- Aturan: fallback teks statis bila no backend.

**FR-10: Social Share**
- Input: PNG strip.
- Proses: Web Share API (file/image).
- Output: sheet share OS.
- Aturan: fallback download bila tidak support.

**FR-11: Preview Sebelum Cetak**
- Input: canvas hasil.
- Proses: tampilkan modal preview.
- Output: konfirmasi cetak/share.
- Aturan: wajib konfirmasi sebelum kirim printer.

**FR-12: Settings & Preset**
- Input: konfig event (nama, logo, template default, printer).
- Proses: simpan ke localStorage/backend.
- Output: preset reload otomatis.
- Aturan: multi-event.

## BAGIAN 5: Non-Functional Requirements

**Performa**
- Waktu sesi capture→cetak < 60 detik.
- Encode ESC/POS < 1 detik untuk strip 576px.
- Muat PWA < 2 detik (koneksi lokal).

**Keamanan**
- HTTPS wajib (Web Bluetooth & upload).
- Upload divalidasi tipe/size (hanya image/png, max 5MB).
- Bridge hanya terima dari origin terdaftar (token/allowlist).
- Tidak simpan data pribadi tamu.

**Kompatibilitas**
- Chrome/Edge/Android Chrome: Web Bluetooth native.
- iOS/macOS/Safari: via print-bridge.
- Responsive: phone, tablet, desktop.

**Usability**
- UI bahasa Indonesia, large-touch (kios mode).
- Mode kios: tombol besar, alur simpel.
- PWA installable + offline shell.

**Skalabilitas**
- Backend stateless, bisa multi-instance.
- Storage lokal (V1) siap ganti S3/GCS.

## BAGIAN 6: Out of Scope & Dependensi

**Out of Scope (V1)**
- Auth/login multi-user & billing.
- Editor template visual drag-drop (pakai preset dulu).
- Galeri tamu jangka panjauh / admin dashboard.
- React Native native (pakai PWA/Capacitor).

**Dependensi**
- `escpos-browser` — Web Bluetooth ESC/POS (frontend).
- `node-escpos` (+ bluetooth adapter) — print bridge (Node).
- `qrcode` / `qr-image` — generate QR (fallback & canvas).
- React + Vite + TS + Tailwind + Zustand — frontend.
- `vite-plugin-pwa` — PWA.
- Node + Express — backend upload & bridge.
- Canvas API — compose strip.

**Asumsi**
- Printer IWARE XS-80BT kompatibel ESC/POS (Bluetooth SPP).
- Operator punya device Chrome/Edge/Android atau bridge di LAN.
- Koneksi internet tersedia untuk upload/QR (fallback offline tetap jalan).
