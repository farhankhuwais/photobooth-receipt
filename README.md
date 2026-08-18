# Photobooth Receipt

Aplikasi **photobooth web (PWA)** yang mengambil foto lewat kamera, menyusun strip foto
bergaya (multi-template + branding), lalu mencetak ke **printer thermal 80mm** dan membagikan
versi digital via QR + Web Share — tanpa install driver berat.

Target printer: **IWARE XS-80BT** (80mm, ESC/POS). Stack bisa dipakai ulang untuk Android
(PWA / Capacitor) nanti.

---

## Prasyarat

- Node.js 22+ & npm 10+ (sudah terpasang di environment ini).
- Browser **Chrome / Edge** (butuh `getUserMedia` + Web Serial). Safari/iOS tidak didukung
  untuk cetak langsung — pakai Node bridge.
- Kamera (webcam/laptop) untuk mode capture.
- Printer thermal (opsional untuk tes; tanpa printer app tetap jalan, cetak → download).

---

## Cara Menjalankan

### Web app (frontend)
```bash
npm install
npm run dev          # buka http://localhost:5173  (Chrome/Edge)
npm run build        # build produksi ke dist/
npm run preview      # serve hasil build
```
> Buka lewat **localhost**, bukan IP (http://192.168.x.x). Kamera & Web Serial butuh
> secure context (localhost/HTTPS).

### Backend bridge (opsional — untuk QR digital & cetak via Node)
```bash
cd server
npm install
PRINTER_PATH=COM3 PRINTER_BAUD=9600 npm start   # default port 8787
```
Lalu isi **Bridge URL** di Settings (`http://<ip-pc>:8787`).

---

## Struktur Folder

```
photobooth_receipt/
├─ index.html
├─ package.json
├─ vite.config.ts            (React + PWA manifest)
├─ tsconfig*.json
├─ tailwind.config.js
├─ public/icon.svg           (icon PWA)
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx                (alur sesi: kamera → capture → preview → cetak/share)
│  ├─ index.css
│  ├─ store/useSession.ts    (Zustand: shots, template, branding, bridgeUrl, digitalUrl + persist)
│  └─ modules/
│     ├─ camera/useCamera.ts  (getUserMedia + deteksi error kamera)
│     ├─ templates/TemplateEngine.ts  (compose canvas 576px, template, logo/date/watermark/QR)
│     ├─ escpos/encoder.ts    (canvas → ESC/POS raster, dither 1-bit Floyd–Steinberg)
│     ├─ escpos/serialPrinter.ts  (Web Serial → tulis bytes ke COM/USB)
│     ├─ escpos/bridgePrinter.ts  (fetch ESC/POS bytes ke Node bridge)
│     ├─ print/printService.ts    (selectSmart: serial → bridge → download)
│     ├─ qr/qr.ts             (generate QR data URL)
│     ├─ share/share.ts       (Web Share API + download fallback)
│     ├─ share/upload.ts      (upload strip PNG ke /api/upload)
│     └─ branding/Settings.tsx (panel pengaturan event)
└─ server/
   ├─ package.json
   ├─ index.ts                (Express: /api/upload, /api/print)
   └─ bridge.ts               (tulis ESC/POS buffer ke serial COM via serialport)
```

---

## Alur Sesi (Happy Path)

1. Operator buka app, atur event di **⚙ Event** (nama, logo, template, tanggal, watermark, QR).
2. Tamu tekan **MULAI 📸** → preview kamera + countdown 3-2-1 → capture frame.
3. Diulang otomatis sampai jumlah foto template terpenuhi (thumbnail tiap shot tampil).
4. `TemplateEngine` susun canvas (576px ≈ 80mm) + branding + tanggal + QR.
5. Preview strip muncul → **Cetak / Share / Ulangi**.
6. **Cetak**: `printSmart` pilih jalur (lihat bawah) → kirim ESC/POS.
7. (Jika Bridge URL diisi) strip di-upload → URL balik jadi QR otomatis di struk.

---

## Jalur Cetak (Penting)

| Jalur | Trigger | Kapan dipakai |
|-------|---------|---------------|
| **Web Serial** | `navigator.serial` ada | Utama. Chrome/Edge. Printer terpasang sebagai COM port (BT Classic) atau USB-SERIAL. |
| **Node bridge** | `bridgeUrl` diisi | Headless/kios & Safari/iOS. Web app kirim bytes ke `server` → tulis ke COM. |
| **Download** | fallback | Tanpa printer/hardware. Unduh PNG + simpan `.bin` ESC/POS. |

> **Catatan koneksi printer:** Web Bluetooth **tidak** dipakai — hanya mendukung BLE,
> sedangkan thermal 80mm umumnya **Bluetooth Classic (SPP)**. XS-80BT kemungkinan Classic,
> jadi jalur andalan = **Web Serial ke COM port** (pasangin di Windows → Device Manager →
> Ports → COMx) atau **Node bridge**. Baud default `9600` (sesuaikan `PRINTER_BAUD`).

---

## Pengaturan & Persistensi

- **Branding** (event name, logo, tanggal, watermark, QR) → `localStorage` (`pb_branding`).
- **Bridge URL** → `localStorage` (`pb_bridge`).
- Semua auto-save; reload browser tetap mempertahankan konfigurasi.

---

## Konfigurasi

| Var / Field | Default | Fungsi |
|-------------|---------|--------|
| `PRINTER_PATH` | `COM3` | Port printer di Node bridge (Windows). Linux: `/dev/ttyUSB0` dll. |
| `PRINTER_BAUD` | `9600` | Baud rate printer. |
| `PORT` (server) | `8787` | Port backend bridge. |
| Template | `strip3` | `strip3` / `grid2x2` / `single`. |
| `PRINT_WIDTH` | `576` | Lebar canvas px (80mm @203dpi). |

---

## Fitur (Status)

- [x] Kamera + countdown + multi-shot + thumbnail progres.
- [x] Template: 3-vertikal / 2x2 / 1-foto.
- [x] Branding: logo, event name, tanggal, watermark.
- [x] Encoder ESC/POS (dither 1-bit) — tanpa lib eksternal.
- [x] Cetak: Web Serial + Node bridge + download fallback.
- [x] QR di struk + auto-upload → link digital.
- [x] Share (Web Share / download).
- [x] Settings persist + PWA installable.
- [ ] Tes cetak nyata ke XS-80BT (printer belum ada).
- [ ] P6: Capacitor (mobile Android).

---

## Known Issues / Limitations

- Belum tes cetak ke hardware sungguh (encoder & alur sudah siap).
- Web Bluetooth sengaja tidak dipakai (BLE vs Classic SPP).
- QR digital butuh `bridgeUrl` + server jalan; tanpa itu pakai teks/link manual.
- iOS/Safari: cetak langsung tidak ada (pakai bridge).

---

## Extension Points (cara tambah fitur lain)

- **Template baru**: tambah case di `TemplateEngine.ts` + opsi di `App.tsx` & `Settings.tsx`.
- **Printer lain / jalur cetak baru**: implement di `src/modules/escpos/` lalu daftarkan di
  `printService.ts` (`printSmart`).
- **Field branding baru**: tambah ke `BrandingConfig` (`useSession.ts`) + input di `Settings.tsx`
  + render di `TemplateEngine.ts`.
- **Upload storage cloud** (S3/GCS): ganti simpanan di `server/index.ts` `/api/upload`.
- **Galeri tamu / admin**: tambah route + halaman di `server/` & `src/`.
- **Mobile native**: bungkus dengan Capacitor (reuse kode React), atau pakai bridge lewat LAN.
- **Multi-event preset**: perlu backend; simpan preset di `server` bukan localStorage.

---

## Troubleshooting

**Kamera tidak bisa diakses**
- Buka `http://localhost:5173`, bukan IP.
- Izinkan kamera (ikom 🔒 → allow) → refresh.
- Pastikan kamera tidak dipakai app lain (Zoom/Meet).

**Cetak tidak keluar**
- Web Serial: pasangin printer → COM port → tombol Cetak → pilih port. Cek baud.
- Bridge: `server` jalan + `bridgeUrl` benar + `PRINTER_PATH` sesuai.
- Tanpa hardware: tombol Cetak → download PNG (normal).

**QR tidak muncul**
- Isi field **QR code** di Settings (atau set Bridge URL untuk auto).
- Preview update otomatis setelah diisi.
