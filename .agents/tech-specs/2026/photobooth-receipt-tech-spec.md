# Tech Spec — Photobooth Receipt (PWA + Thermal Print)

## 1. Arsitektur

```
┌─────────────────────────┐         Web Bluetooth (ESC/POS)        ┌─────────────────┐
│  Web App (PWA)          │ ───────────────────────────────────────▶│ IWARE XS-80BT   │
│  React + Vite + TS      │                                          │ (80mm thermal)  │
│  - camera (getUserMedia)│                                          └─────────────────┘
│  - canvas template eng  │         fetch POST /print                ┌─────────────────┐
│  - escpos encode        │ ───────────────────────────────────────▶│ Node Bridge     │
│  - printService         │         fetch POST /upload              │ (node-escpos BT)│
└─────────────────────────┘ ───────────────────────────────────────▶└────────┬────────┘
                                                                               │ ESC/POS
                                                                               ▼
                                                                         ┌─────────────────┐
                                                                         │ IWARE XS-80BT   │
                                                                         └─────────────────┘
        Backend (Node+Express): /upload (simpan PNG→URL), /print (bridge→printer)
```

- **Frontend** satu sumber untuk web & (nanti) Capacitor Android. Logika cetak diabstraksi `printService`.
- **printService** punya 2 impl: `webBluetoothPrinter` (native Chrome/Edge/Android) & `bridgePrinter` (fetch ke Node). Pemilihan otomatis via fitur-deteksi `navigator.bluetooth`.

## 2. Struktur Folder

```
photobooth_receipt/
├─ .agents/                    (PRD + tech-spec)
├─ index.html
├─ package.json
├─ vite.config.ts             (react, PWA plugin)
├─ tsconfig.json / tsconfig.node.json
├─ tailwind.config.js / postcss.config.js
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ index.css
│  ├─ store/useSession.ts     (Zustand: frames, template, branding, status)
│  ├─ modules/
│  │  ├─ camera/useCamera.ts
│  │  ├─ camera/CameraCapture.tsx
│  │  ├─ templates/templates.ts        (definisi template)
│  │  ├─ templates/TemplateEngine.ts   (compose canvas)
│  │  ├─ branding/branding.ts          (logo/watermark/date)
│  │  ├─ escpos/escposEncode.ts        (canvas→ESC/POS bytes, dither 1-bit)
│  │  ├─ escpos/webBluetoothPrinter.ts (navigator.bluetooth)
│  │  ├─ escpos/bridgePrinter.ts       (fetch)
│  │  ├─ print/printService.ts         (interface + select)
│  │  ├─ share/share.ts                (Web Share API + download)
│  │  └─ qr/qr.ts                      (generate QR canvas/PNG)
│  └─ components/  (UI: Kios, Preview, Settings)
└─ server/
   ├─ index.ts     (Express: /upload, /print)
   └─ bridge.ts    (node-escpos bluetooth ke XS-80BT)
```

## 3. Alur Sesi (Happy Path)
1. Operator buka PWA, pilih/muat preset event (nama, logo, template default).
2. Tamu tekan "Mulai" → kamera live preview.
3. Countdown 3-2-1 → capture frame (ulang jika perlu) sampai jumlah template terpenuhi.
4. TemplateEngine susun canvas (frame + decor + date + branding + watermark).
5. Preview modal → tamu/operator konfirmasi.
6. `printService.print(canvas)`: encode ESC/POS → kirim Web Bluetooth ATAU bridge.
7. Paralel: upload PNG → URL → generate QR → (optional) cetak QR di struk + tampil di layar.
8. Web Share / download sebagai fallback digital.

## 4. Spesifikasi Teknis Penting
- **Lebar cetak 80mm @203dpi ≈ 576px**. Canvas strip lebar 576, tinggi mengikuti template.
- **ESC/POS encode**: gambar di-dither ke 1-bit (Floyd–Steinberg) agar tajam di thermal; teks via perintah; QR via `qrimage` (atau embed PNG QR ke canvas).
- **Web Bluetooth**: `navigator.bluetooth.requestDevice({ filters:[{namePrefix:'XS'}] , optionalServices })`, tulis ke TX characteristic (SPP). Butuh HTTPS/localhost.
- **Bridge**: Node + `node-escpos` adapter bluetooth (noble); terima PNG base64, encode, tulis ke printer. Allowlist origin + token.
- **QR**: bila backend ada → URL pendek; bila offline → teks statis (nama event).

## 5. Dependensi
- Frontend: react, react-dom, vite, @vitejs/plugin-react, typescript, tailwindcss, postcss, autoprefixer, zustand, escpos-browser, qrcode, vite-plugin-pwa.
- Backend: express, multer, node-escpos (+ escpos-bluetooth), cors, dotenv.

## 6. Phasing & Task
- **P1** Scaffold (Vite/TS/Tailwind/PWA) + Zustand store + CameraCapture + countdown.
- **P2** templates.ts + TemplateEngine + branding (logo/date/watermark) + UI pilih template.
- **P3** escposEncode + webBluetoothPrinter + printService + tombol cetak (tes hardware XS-80BT).
- **P4** qr.ts + share.ts + backend /upload + QR di struk.
- **P5** backend /print + bridgePrinter fallback (node-escpos bluetooth).
- **P6** PWA polish + settings/preset + persiapan Capacitor (mobile).

## 7. Risiko
- XS-80BT perlu diverifikasi ESC/POS + UUID Bluetooth SPP (tes hardware P3).
- Web Bluetooth tidak ada di iOS/macOS → wajib bridge (P5).
- noble (bt) butuh build native & permisi di host bridge.
