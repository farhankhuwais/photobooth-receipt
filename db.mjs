// Postgres layer for photobooth-receipt (Express replaced by combined server).
// Uses the existing local Postgres (postgres-kontrakan) with a dedicated
// database + role so it never touches the kontrakan data.
import pg from 'pg'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'

const DB_PW = process.env.PGPASSWORD || (await readPw())
const pool = new pg.Pool({
  host: process.env.PGHOST || '172.17.0.1',
  port: Number(process.env.PGPORT || 5432),
  user: process.env.PGUSER || 'photobooth',
  password: DB_PW,
  database: process.env.PGDATABASE || 'photobooth',
})

async function readPw() {
  try {
    return (await fs.readFile('/tmp/photobooth_pg_pw.txt', 'utf8')).trim()
  } catch {
    return process.env.PB_DB_PW || ''
  }
}

const SESSION_DAYS = 30

// Config default yang di-seed ke app_config(id=1) saat DB pertama kali init.
const DEFAULT_CONFIG = {
  eventName: 'My Event',
  logoDataUrl: null,
  showDate: true,
  watermark: '',
  qrText: '',
  frame: 'none',
}

// ── Admin auth (model like kontrakan: scrypt + DB session) ────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(password, salt, 64).toString('hex')
  return `scrypt:${salt}:${hash}`
}

function verifyPassword(password, stored) {
  const [scheme, salt, hashHex] = String(stored).split(':')
  if (scheme !== 'scrypt' || !salt || !hashHex) return false
  const hash = crypto.scryptSync(password, salt, 64)
  const expected = Buffer.from(hashHex, 'hex')
  return hash.length === expected.length && crypto.timingSafeEqual(hash, expected)
}

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS photos (
      id          TEXT PRIMARY KEY,
      data        BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS presets (
      name        TEXT PRIMARY KEY,
      mode        TEXT NOT NULL DEFAULT 'regular',
      price       INTEGER NOT NULL DEFAULT 5000,
      branding    JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id          SERIAL PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      method      TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      template    TEXT,
      note        TEXT,
      preset      TEXT,
      mode        TEXT NOT NULL DEFAULT 'regular'
    );
    CREATE TABLE IF NOT EXISTS app_config (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      mode        TEXT NOT NULL DEFAULT 'regular',
      price       INTEGER NOT NULL DEFAULT 5000,
      preset_name TEXT,
      branding    JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS attract_assets (
      mode        TEXT PRIMARY KEY,
      media_type  TEXT NOT NULL,
      data        BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS attract_icons (
      mode        TEXT PRIMARY KEY,
      media_type  TEXT NOT NULL,
      data        BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS admin_user (
      id              SERIAL PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS frames (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      image_data  BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS designs (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      frame_data  BYTEA,                 -- PNG bingkai transparan (opsional)
      canvas_w    INTEGER NOT NULL DEFAULT 308,
      canvas_h    INTEGER NOT NULL DEFAULT 454,
      slots       JSONB NOT NULL,        -- [{x,y,w,h,rot}] relatif thd canvas_w/h,
                                         -- dalam koordinat PRINT_WIDTH (576) setelah diskalakan
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  // Kolom template (strip3/single/grid2x2) agar tiap template punya frame sendiri.
  // Null = berlaku semua template (frame lama / universal).
  await pool.query(`ALTER TABLE frames ADD COLUMN IF NOT EXISTS template TEXT`)
  // Seed default admin dari env (hanya kalau belum ada user sama sekali)
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM admin_user')
  if (rows[0].c === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@photobooth.local').toLowerCase().trim()
    const pw = process.env.ADMIN_PASSWORD || 'admin123'
    const hash = hashPassword(pw)
    await pool.query('INSERT INTO admin_user (email, password_hash) VALUES ($1, $2)', [email, hash])
    console.log(`[db] seeded admin user: ${email} (ganti password via env ADMIN_PASSWORD)`)
  }
  // Seed default active config (row id=1) kalau belum ada.
  const { rows: cf } = await pool.query('SELECT COUNT(*)::int AS c FROM app_config')
  if (cf[0].c === 0) {
    await pool.query(
      `INSERT INTO app_config (id, mode, price, preset_name, branding)
       VALUES (1, 'regular', 5000, NULL, $1)`,
      [JSON.stringify(DEFAULT_CONFIG)]
    )
    console.log('[db] seeded default app_config (regular)')
  }
  console.log('[db] schema ready')
  await migrate()
}

// Migrasi: pastikan presets punya kolom name (PK). Versi per-mode lama pakai mode PK.
export async function migrate() {
  await pool.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns WHERE table_name='presets' AND column_name='name'
      ) THEN
        CREATE TABLE IF NOT EXISTS presets_new (
          name TEXT PRIMARY KEY,
          mode TEXT NOT NULL DEFAULT 'regular',
          price INTEGER NOT NULL DEFAULT 5000,
          branding JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        INSERT INTO presets_new (name, mode, price, branding, updated_at)
          SELECT COALESCE(mode, 'regular'), mode, price, branding, COALESCE(updated_at, now())
          FROM presets
          ON CONFLICT (name) DO NOTHING;
        DROP TABLE presets;
        ALTER TABLE presets_new RENAME TO presets;
      END IF;
    END $$;
  `)
}

export async function verifyAdmin(email, password) {
  const { rows } = await pool.query('SELECT id, password_hash FROM admin_user WHERE email = $1', [
    String(email).toLowerCase().trim(),
  ])
  if (!rows[0]) return null
  if (!verifyPassword(String(password), rows[0].password_hash)) return null
  return rows[0].id
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000)
  await pool.query('INSERT INTO admin_sessions (token, user_id, expires_at) VALUES ($1, $2, $3)', [
    token,
    userId,
    expiresAt,
  ])
  return token
}

export async function getSessionUser(token) {
  if (!token) return null
  const { rows } = await pool.query(
    `SELECT u.id, u.email
     FROM admin_sessions s JOIN admin_user u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now() LIMIT 1`,
    [token]
  )
  return rows[0] ? { id: rows[0].id, email: rows[0].email } : null
}

export async function destroySession(token) {
  if (!token) return
  await pool.query('DELETE FROM admin_sessions WHERE token = $1', [token])
}

export async function saveTransaction({ method, amount, template = null, note = null, preset = null, mode = 'regular' }) {
  const r = await pool.query(
    'INSERT INTO transactions (method, amount, template, note, preset, mode) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at',
    [method, amount, template, note, preset, mode]
  )
  return r.rows[0]
}

// listTransactions({ limit, from, to })
//   from/to: 'YYYY-MM-DD' (opsional) -> filter rentang hari itu (inklusif).
export async function listTransactions({ limit = 200, from = null, to = null } = {}) {
  const where = []
  const params = []
  if (from) { params.push(`${from} 00:00:00`); where.push(`created_at >= $${params.length}`) }
  if (to) { params.push(`${to} 23:59:59`); where.push(`created_at <= $${params.length}`) }
  params.push(Math.min(limit, 100000))
  const sql = `SELECT id, created_at, method, amount, template, note, preset, mode FROM transactions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC LIMIT $${params.length}`
  const r = await pool.query(sql, params)
  return r.rows
}

// Ganti password admin (verifikasi password lama dulu).
export async function changePassword(userId, currentPassword, newPassword) {
  const { rows } = await pool.query('SELECT password_hash FROM admin_user WHERE id = $1', [userId])
  if (!rows[0]) return { ok: false, error: 'user tidak ditemukan' }
  if (!verifyPassword(String(currentPassword), rows[0].password_hash)) {
    return { ok: false, error: 'password lama salah' }
  }
  if (!newPassword || String(newPassword).length < 6) {
    return { ok: false, error: 'password baru minimal 6 karakter' }
  }
  const hash = hashPassword(String(newPassword))
  await pool.query('UPDATE admin_user SET password_hash = $1 WHERE id = $2', [hash, userId])
  return { ok: true }
}

export async function getStats() {
  const today = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS today_count,
      COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS today_amount,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND method = 'qris') AS today_qris,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND method = 'cash') AS today_cash,
      COUNT(*) AS total_count,
      COALESCE(SUM(amount), 0) AS total_amount
    FROM transactions
  `)
  const byHour = await pool.query(`
    SELECT date_trunc('hour', created_at) AS hour, COUNT(*) AS cnt
    FROM transactions
    WHERE created_at >= date_trunc('day', now())
    GROUP BY 1 ORDER BY 1
  `)
  return { summary: today.rows[0], byHour: byHour.rows }
}

export async function savePhoto(id, buf) {
  await pool.query('INSERT INTO photos (id, data) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data', [id, buf])
  return id
}

export async function getPhoto(id) {
  const r = await pool.query('SELECT data FROM photos WHERE id = $1', [id])
  return r.rows[0]?.data || null
}

// Daftar foto (terbaru dulu). Filter by tanggal optional (from/to, format YYYY-MM-DD).
export async function listPhotos({ limit = 100, from = null, to = null } = {}) {
  const where = []
  const params = []
  if (from) { params.push(from + ' 00:00:00'); where.push(`created_at >= $${params.length}`) }
  if (to) { params.push(to + ' 23:59:59'); where.push(`created_at <= $${params.length}`) }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const r = await pool.query(
    `SELECT id, created_at FROM photos ${w} ORDER BY created_at DESC LIMIT ${Number(limit) || 100}`,
    params
  )
  return r.rows
}

// Hapus satu foto by id.
export async function deletePhoto(id) {
  await pool.query('DELETE FROM photos WHERE id = $1', [id])
}

// ── Presets (konfigurasi bernama, bisa banyak) — tiap preset punya mode sendiri ──
// Dropdown di panel memfilter preset per mode -> masing-masing config TERPISAH & persist.
export async function savePreset(name, mode, price, branding) {
  const n = String(name || '').trim()
  if (!n) throw new Error('nama preset wajib')
  const m = mode === 'event' ? 'event' : 'regular'
  const p = m === 'event' ? 0 : (price === 0 ? 0 : Number(price) || 5000)
  const r = await pool.query(
    `INSERT INTO presets (name, mode, price, branding, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (name) DO UPDATE SET mode = EXCLUDED.mode, price = EXCLUDED.price, branding = EXCLUDED.branding, updated_at = now()
     RETURNING name`,
    [n, m, p, branding]
  )
  return r.rows[0].name
}

// Semua preset sebagai array { name, mode, price, branding }, terbaru dulu.
export async function listPresets() {
  const r = await pool.query('SELECT name, mode, price, branding FROM presets ORDER BY updated_at DESC')
  return r.rows
}

// Ambil satu preset by name.
export async function getPreset(name) {
  const r = await pool.query('SELECT name, mode, price, branding FROM presets WHERE name = $1', [name])
  return r.rows[0] || null
}

// Hapus preset by name.
export async function deletePreset(name) {
  await pool.query('DELETE FROM presets WHERE name = $1', [name])
}

// ── Active app config (persisted, survives refresh/cache clear) ──
export async function getConfig() {
  const r = await pool.query('SELECT mode, price, preset_name, branding FROM app_config WHERE id = 1')
  return r.rows[0] || null
}

export async function saveConfig(config) {
  const { mode, price, preset_name, branding } = config
  await pool.query(
    `INSERT INTO app_config (id, mode, price, preset_name, branding, updated_at)
     VALUES (1, $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET mode = EXCLUDED.mode, price = EXCLUDED.price, preset_name = EXCLUDED.preset_name, branding = EXCLUDED.branding, updated_at = now()`,
    [mode, price, preset_name, branding]
  )
}

// ── Custom frame gallery (stored in Postgres, selectable by customer) ──────
export async function saveFrame(id, name, buf, template = null) {
  await pool.query(
    `INSERT INTO frames (id, name, image_data, template, created_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_data = EXCLUDED.image_data, template = EXCLUDED.template`,
    [id, name, buf, template]
  )
  return id
}

export async function listFrames(template = null) {
  // Kalau template diminta, kembalikan frame untuk template itu + frame universal (template NULL).
  let sql = 'SELECT id, name, template, created_at FROM frames'
  const args = []
  if (template) {
    sql += ' WHERE template = $1 OR template IS NULL'
    args.push(template)
  }
  sql += ' ORDER BY created_at ASC'
  const r = await pool.query(sql, args)
  return r.rows
}

export async function getFrame(id) {
  const r = await pool.query('SELECT image_data FROM frames WHERE id = $1', [id])
  return r.rows[0]?.image_data || null
}

export async function deleteFrame(id) {
  await pool.query('DELETE FROM frames WHERE id = $1', [id])
}

// ── Designs (mockup kustom: bingkai PNG + slot foto bebas/miring) ──
// slots: array { x, y, w, h, rot } dalam koordinat PRINT_WIDTH (576 px lebar).
// canvas_w/h = asli mockup (utk skala bingkai). disimpan JSONB.
export async function saveDesign(id, name, frameBuf, canvasW, canvasH, slots) {
  await pool.query(
    `INSERT INTO designs (id, name, frame_data, canvas_w, canvas_h, slots, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, frame_data = EXCLUDED.frame_data,
       canvas_w = EXCLUDED.canvas_w, canvas_h = EXCLUDED.canvas_h, slots = EXCLUDED.slots`,
    [id, name, frameBuf, canvasW, canvasH, JSON.stringify(slots)]
  )
  return id
}

// Update design yg sudah ada: ganti slot (dan bingkai kalau dikasih).
export async function updateDesign(id, { name, frameBuf, slots, canvasW, canvasH } = {}) {
  const cur = await getDesign(id)
  if (!cur) throw new Error('design tidak ditemukan')
  const nextName = name ?? cur.name
  const nextFrame = frameBuf !== undefined ? frameBuf : cur.frame_data
  const nextSlots = slots !== undefined ? JSON.stringify(slots) : JSON.stringify(cur.slots)
  const nextW = canvasW ?? cur.canvas_w
  const nextH = canvasH ?? cur.canvas_h
  await pool.query(
    `UPDATE designs SET name = $2, frame_data = $3, slots = $4, canvas_w = $5, canvas_h = $6 WHERE id = $1`,
    [id, nextName, nextFrame, nextSlots, nextW, nextH]
  )
  return id
}

export async function listDesigns() {
  const r = await pool.query(
    `SELECT id, name, canvas_w, canvas_h, created_at,
            COALESCE(jsonb_array_length(slots), 0) AS slots_count,
            slots AS slots_raw,
            (frame_data IS NOT NULL) AS has_frame
     FROM designs ORDER BY created_at ASC`
  )
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    canvasW: row.canvas_w,
    canvasH: row.canvas_h,
    slotsCount: Number(row.slots_count),
    slots: typeof row.slots_raw === 'string' ? JSON.parse(row.slots_raw) : (row.slots_raw || []),
    hasFrame: row.has_frame,
  }))
}

export async function getDesign(id) {
  const r = await pool.query('SELECT id, name, frame_data, canvas_w, canvas_h, slots FROM designs WHERE id = $1', [id])
  if (!r.rows[0]) return null
  const row = r.rows[0]
  return {
    id: row.id,
    name: row.name,
    frame_data: row.frame_data || null,
    canvas_w: row.canvas_w,
    canvas_h: row.canvas_h,
    slots: typeof row.slots === 'string' ? JSON.parse(row.slots) : row.slots,
  }
}

export async function deleteDesign(id) {
  await pool.query('DELETE FROM designs WHERE id = $1', [id])
}

// ── Attract screen background (image/video) per mode, stored in Postgres ──
export async function saveAttract(mode, mediaType, buf) {
  await pool.query(
    `INSERT INTO attract_assets (mode, media_type, data, created_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (mode) DO UPDATE SET media_type = EXCLUDED.media_type, data = EXCLUDED.data, created_at = now()`,
    [mode, mediaType, buf]
  )
}

export async function getAttract(mode) {
  const r = await pool.query('SELECT media_type, data FROM attract_assets WHERE mode = $1', [mode])
  return r.rows[0] || null
}

export async function deleteAttract(mode) {
  await pool.query('DELETE FROM attract_assets WHERE mode = $1', [mode])
}

// ── Attract tap icon (custom PNG per mode) ──
export async function saveAttractIcon(mode, mediaType, buf) {
  await pool.query(
    `INSERT INTO attract_icons (mode, media_type, data, created_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (mode) DO UPDATE SET media_type = EXCLUDED.media_type, data = EXCLUDED.data, created_at = now()`,
    [mode, mediaType, buf]
  )
}

export async function getAttractIcon(mode) {
  const r = await pool.query('SELECT media_type, data FROM attract_icons WHERE mode = $1', [mode])
  return r.rows[0] || null
}

export async function deleteAttractIcon(mode) {
  await pool.query('DELETE FROM attract_icons WHERE mode = $1', [mode])
}

export default pool
