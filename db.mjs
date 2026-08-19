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
      id          SERIAL PRIMARY KEY,
      name        TEXT NOT NULL UNIQUE,
      branding    JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id          SERIAL PRIMARY KEY,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      method      TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      template    TEXT,
      note        TEXT
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
  `)
  // Seed default admin dari env (hanya kalau belum ada user sama sekali)
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM admin_user')
  if (rows[0].c === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@photobooth.local').toLowerCase().trim()
    const pw = process.env.ADMIN_PASSWORD || 'admin123'
    const hash = hashPassword(pw)
    await pool.query('INSERT INTO admin_user (email, password_hash) VALUES ($1, $2)', [email, hash])
    console.log(`[db] seeded admin user: ${email} (ganti password via env ADMIN_PASSWORD)`)
  }
  console.log('[db] schema ready')
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

export async function saveTransaction({ method, amount, template = null, note = null }) {
  const r = await pool.query(
    'INSERT INTO transactions (method, amount, template, note) VALUES ($1, $2, $3, $4) RETURNING id, created_at',
    [method, amount, template, note]
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
  const sql = `SELECT id, created_at, method, amount, template, note FROM transactions
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

export async function savePreset(name, branding) {
  const r = await pool.query(
    `INSERT INTO presets (name, branding, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (name) DO UPDATE SET branding = EXCLUDED.branding, updated_at = now()
     RETURNING id`,
    [name, branding]
  )
  return r.rows[0].id
}

export async function listPresets() {
  const r = await pool.query('SELECT id, name, branding, updated_at FROM presets ORDER BY updated_at DESC')
  return r.rows
}

export async function getPreset(name) {
  const r = await pool.query('SELECT branding FROM presets WHERE name = $1', [name])
  return r.rows[0]?.branding || null
}

// ── Custom frame gallery (stored in Postgres, selectable by customer) ──────
export async function saveFrame(id, name, buf) {
  await pool.query(
    `INSERT INTO frames (id, name, image_data, created_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_data = EXCLUDED.image_data`,
    [id, name, buf]
  )
  return id
}

export async function listFrames() {
  const r = await pool.query('SELECT id, name, created_at FROM frames ORDER BY created_at ASC')
  return r.rows
}

export async function getFrame(id) {
  const r = await pool.query('SELECT image_data FROM frames WHERE id = $1', [id])
  return r.rows[0]?.image_data || null
}

export async function deleteFrame(id) {
  await pool.query('DELETE FROM frames WHERE id = $1', [id])
}

export default pool
