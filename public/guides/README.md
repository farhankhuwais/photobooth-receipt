# Panduan Desain Bingkai Custom (Canva)

Bingkai custom di-upload sebagai **1 file PNG transparan**, lalu di-STRETCH
menutup SELURUH strip hasil (foto + logo + QR + tanggal + watermark) dan
digambar paling atas.

## Aturan wajib
- **Latar = transparan** (PNG dengan background transparan di Canva: File →
  Transparent background, atau export PNG lalu pastikan bg kosong).
- **Tengah HARUS transparan** → supaya foto kelihatan.
- **Bagian bawah (zona QR/tanggal/watermark ~200px) biarkan transparan** →
  kalau diisi, QR & teks ketutup.
- Hanya **tepi kiri/kanan + pojok** yang boleh berwarna (tahan distorsi stretch).

## Ukuran canvas (lebar SELALU 576px)
Tinggi bergantung template + toggle yang nyala. Pakai angka di bawah sesuai
setup kamu. (Hitungan: header logo=266 / tanpa logo=64; footer all-on=308,
tanpa QR=100.)

| Template | Logo NYALA | Tanpa Logo |
|---|---|---|
| **3 Vertikal** | 576 × 1800 | 576 × 1598 |
| **1 Foto** | 576 × 976 | 576 × 774 |
| **2x2** | 576 × 978 | 576 × 776 |

> Tinggi berubah kalau toggle QR / tanggal / watermark dimatikan. Kalau ragu,
> desain di angka "all-on" (paling tinggi) lalu biarkan zona bawah transparan.

### Board panduan siap import (file PNG transparan, di `samples/`)
Gambar: box MERAH = zona foto (tengah, transparent di dalam), box KUNING =
zona bawah (QR+tanggal+watermark, biarkan kosong), tanda pojok hitam = suggested
dekorasi. Import ke Canva sebagai lapisan bawah, lalu desain di atasnya.

**Logo NYALA:**
- `guide-3vertikal.png` (576×1800)
- `guide-1foto.png` (576×976)
- `guide-2x2.png` (576×978)

**Tanpa Logo:**
- `guide-nologo-3vertikal.png` (576×1598)
- `guide-nologo-1foto.png` (576×774)
- `guide-nologo-2x2.png` (576×776)

## Cara di Canva
1. Buat desain ukuran custom: **576 × (tinggi di atas)**.
2. Background: biarkan kosong (transparan).
3. Gambar dekorasi cuma di **tepi kiri & kanan** (full tinggi) + **pojok**.
   - Contoh: garis tepi, bracket pojok, titik-titik kolom, bunga di sudut.
4. JANGAN isi tengah & jangan isi strip bawah ~200px.
5. Export → **PNG** (atur transparan).
6. Di app: Pengaturan (⚙) → Gallery Bingkai Custom → + Upload Bingkai.
7. Di layar hasil, klik thumbnail bingkai → preview & cetak auto-update.

## Catatan penting soal stretch
Satu bingkai di-stretch ke ukuran canvas aktif. Bingkai yang lo buat untuk
3 Vertikal (tinggi 1800) kalau dipakai di 1 Foto (976) akan **melar vertikal**.
Solusi:
- Buat **1 bingkai per template** (ukuran masing-masing di tabel), atau
- Desain **tepi + pojok saja** (tanpa bentuk di tengah) → melar tidak merusak.

## Board siap pakai
File `samples/frame-guide-*.png` adalah board kosong (transparan) dengan
tanda pojok + garis tipis zona foto & zona bawah — bisa di-import ke Canva
sebagai lapisan panduan, lalu desain di atasnya.
