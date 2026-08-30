// Postgres layer for photobooth-receipt (Express replaced by combined server).
// Uses the existing local Postgres (postgres-kontrakan) with a dedicated
// database + role so it never touches the kontrakan data.
import pg from 'pg'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'

const DB_PW = process.env.PGPASSWORD || (await readPw())
export const pool = new pg.Pool({
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

// Default tenant slug untuk public access (single-instance fallback).
export const DEFAULT_TENANT = process.env.PB_DEFAULT_TENANT || 'default'

// Resolve tenant dari request hostname: {nama-customer}.achipix.web.id -> slug
// Return null jika subdomain tidak dikenaldi/disabled.
// Root domain constant — serves admin dashboard
const ROOT_DOMAIN = 'achipix.web.id'
const ADMIN_SUBDOMAIN = 'admin'

export async function resolveTenant(hostname = '') {
  const h = String(hostname).split(':')[0].toLowerCase()
  if (!h) return DEFAULT_TENANT
  const parts = h.split('.')
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^localhost$/.test(h) || parts.length === 1
  // Root domain (achipix.web.id) or bare IP/localhost → serve admin dashboard
  if (h === ROOT_DOMAIN || isIp) return 'admin'
  // admin.achipix.web.id → admin dashboard (subdomain)
  if (parts[0] === ADMIN_SUBDOMAIN && parts[1] === 'achipix') return 'admin'
  // *.achipix.web.id → booth tenant (slug = subdomain)
  const slug = parts[0]
  if (!slug) return DEFAULT_TENANT
  try {
    const { rows } = await pool.query('SELECT slug FROM tenants WHERE slug = $1 AND active = true', [slug])
    return rows.length ? slug : DEFAULT_TENANT
  } catch {
    return null
  }
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
    CREATE TABLE IF NOT EXISTS tenants (
      slug        TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      active      BOOLEAN NOT NULL DEFAULT true,
      access_pin  TEXT NULL,
      owner_user_id INTEGER NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    -- Tambah kolom id UUID bila belum ada (untuk FK internal, slug tetap untuk URL).
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'id') THEN
        ALTER TABLE tenants ADD COLUMN id UUID NOT NULL DEFAULT gen_random_uuid();
        CREATE UNIQUE INDEX IF NOT EXISTS tenants_id_idx ON tenants(id);
      END IF;
    END $$;
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'access_pin') THEN
        ALTER TABLE tenants ADD COLUMN access_pin TEXT NULL;
      END IF;
    END $$;
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'owner_user_id') THEN
        ALTER TABLE tenants ADD COLUMN owner_user_id INTEGER NULL;
        CREATE INDEX IF NOT EXISTS tenants_owner_idx ON tenants (owner_user_id);
      END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS photos (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      data        BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS presets (
      name        TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      mode        TEXT NOT NULL DEFAULT 'regular',
      price       INTEGER NOT NULL DEFAULT 5000,
      branding    JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id          SERIAL PRIMARY KEY,
      tenant_id   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      method      TEXT NOT NULL,
      amount      INTEGER NOT NULL,
      template    TEXT,
      note        TEXT,
      preset      TEXT,
      mode        TEXT NOT NULL DEFAULT 'regular'
    );
    CREATE TABLE IF NOT EXISTS app_config (
      tenant_id   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      id          INTEGER NOT NULL DEFAULT 1,
      mode        TEXT NOT NULL DEFAULT 'regular',
      price       INTEGER NOT NULL DEFAULT 5000,
      preset_name TEXT,
      branding    JSONB NOT NULL,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, id)
    );
    CREATE TABLE IF NOT EXISTS ai_settings (
      id          INTEGER PRIMARY KEY DEFAULT 1,
      tenant_id   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      api_key     TEXT NOT NULL DEFAULT '',
      model       TEXT NOT NULL DEFAULT 'gemini-2.5-flash-image',
      prompt      TEXT NOT NULL DEFAULT '',
      enabled     BOOLEAN NOT NULL DEFAULT false,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS attract_assets (
      mode        TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      media_type  TEXT NOT NULL,
      data        BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS attract_icons (
      mode        TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      media_type  TEXT NOT NULL,
      data        BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS admin_user (
      id              SERIAL PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'super_admin',  -- super_admin | tenant_admin | tenant_user
      tenant_id       TEXT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      name            TEXT NULL,
      active          BOOLEAN NOT NULL DEFAULT true,
      last_login_at   TIMESTAMPTZ NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS admin_user_email_lower_idx ON admin_user (LOWER(email));
    -- (admin_user_tenant_idx dipindah ke migrasi di bawah agar aman untuk DB lama yang
    -- belum punya kolom tenant_id di admin_user.)
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token       TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
      expires_at  TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions (expires_at);
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id          BIGSERIAL PRIMARY KEY,
      user_id     INTEGER NULL REFERENCES admin_user(id) ON DELETE SET NULL,
      tenant_slug TEXT NULL,
      action      TEXT NOT NULL,
      target      TEXT NULL,
      metadata    JSONB NULL,
      ip          TEXT NULL,
      ua          TEXT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS admin_audit_user_idx ON admin_audit_log (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS admin_audit_tenant_idx ON admin_audit_log (tenant_slug, created_at DESC);
    CREATE TABLE IF NOT EXISTS admin_login_attempts (
      id          BIGSERIAL PRIMARY KEY,
      email       TEXT NOT NULL,
      success     BOOLEAN NOT NULL,
      ip          TEXT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS admin_login_attempts_email_idx ON admin_login_attempts (LOWER(email), created_at DESC);
    CREATE TABLE IF NOT EXISTS frames (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      image_data  BYTEA NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS designs (
      id          TEXT PRIMARY KEY,
      tenant_id   TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      frame_data  BYTEA,
      canvas_w    INTEGER NOT NULL DEFAULT 308,
      canvas_h    INTEGER NOT NULL DEFAULT 454,
      slots       JSONB NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `)
  // Kolom template (strip3/single/grid2x2) agar tiap template punya frame sendiri.
  // Null = berlaku semua template (frame lama / universal).
  await pool.query(`ALTER TABLE frames ADD COLUMN IF NOT EXISTS template TEXT`)
  // Seed default tenant khusus SaaS akses public; juga jadi fallback multi-tenant.
  const defaultSlug = process.env.PB_DEFAULT_TENANT || 'default'
  await pool.query(
    `INSERT INTO tenants (slug, name) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`,
    [defaultSlug, defaultSlug === 'default' ? 'Default Tenant' : defaultSlug]
  )

  // Migrasi existing tables: tambah tenant_id jika belum ada.
  await pool.query(`ALTER TABLE photos ADD COLUMN IF NOT EXISTS tenant_id TEXT`)
  await pool.query(`ALTER TABLE presets ADD COLUMN IF NOT EXISTS tenant_id TEXT`)
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tenant_id TEXT`)
  await pool.query(`ALTER TABLE app_config ADD COLUMN IF NOT EXISTS tenant_id TEXT`)
  await pool.query(`ALTER TABLE ai_settings ADD COLUMN IF NOT EXISTS tenant_id TEXT`)
  await pool.query(`ALTER TABLE attract_assets ADD COLUMN IF NOT EXISTS tenant_id TEXT`)
  await pool.query(`ALTER TABLE attract_icons ADD COLUMN IF NOT EXISTS tenant_id TEXT`)
  await pool.query(`ALTER TABLE frames ADD COLUMN IF NOT EXISTS tenant_id TEXT`)
  await pool.query(`ALTER TABLE designs ADD COLUMN IF NOT EXISTS tenant_id TEXT`)
  // Migrasi kolom admin_user baru (tabel lama tidak diubah oleh CREATE TABLE IF NOT EXISTS).
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'super_admin'`)
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(slug) ON DELETE CASCADE`)
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS name TEXT`)
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true`)
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ`)
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`)
  await pool.query(`CREATE INDEX IF NOT EXISTS admin_user_email_lower_idx ON admin_user (LOWER(email))`)
  await pool.query(`CREATE INDEX IF NOT EXISTS admin_user_tenant_idx ON admin_user (tenant_id)`)

  // Pricing tiers: paket (Basic / Premium / Profesional) untuk user client.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pricing_tiers (
      id            SERIAL PRIMARY KEY,
      slug          TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      description   TEXT NULL,
      max_tenants   INTEGER NOT NULL DEFAULT 1,
      max_photos    INTEGER NOT NULL DEFAULT 100,
      max_frames    INTEGER NOT NULL DEFAULT 3,
      max_designs   INTEGER NOT NULL DEFAULT 3,
      max_presets   INTEGER NOT NULL DEFAULT 3,
      active        BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  // Migrasi kolom user untuk tier & kode akses.
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS code TEXT UNIQUE`)
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS pricing_tier_id INTEGER REFERENCES pricing_tiers(id) ON DELETE SET NULL`)
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS max_tenants INTEGER`)
  await pool.query(`CREATE INDEX IF NOT EXISTS admin_user_code_idx ON admin_user (code)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS admin_user_tier_idx ON admin_user (pricing_tier_id)`)

  // License codes: track issued/redeemed/revoked HMAC codes for audit & revocation.
  // Note: the actual code string is NOT stored in DB — HMAC contains all validity data.
  // DB only stores hash for fast revocation lookups and audit trail.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS license_codes (
      id               SERIAL PRIMARY KEY,
      code_hash        TEXT NOT NULL UNIQUE,   -- SHA256 of full code string
      vendor_id        TEXT NOT NULL,
      tier_slug        TEXT NULL,             -- pricing tier to assign on redemption
      expires_at       TIMESTAMPTZ NOT NULL,
      issued_by        INTEGER NULL REFERENCES admin_user(id),
      issued_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
      redeemed_at      TIMESTAMPTZ NULL,
      redeemed_by      TEXT NULL,             -- user email created on redemption
      redeemed_tenant  TEXT NULL,             -- tenant slug created on redemption
      revoked_at       TIMESTAMPTZ NULL,
      revoked_by      INTEGER NULL REFERENCES admin_user(id),
      active           BOOLEAN NOT NULL DEFAULT true,
      secret_version   INTEGER NOT NULL DEFAULT 1  -- which secret version was used to sign
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS license_codes_code_hash_idx ON license_codes(code_hash)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS license_codes_vendor_id_idx ON license_codes(vendor_id)`)

  // ── License secrets: versioned so rotation doesn't break existing codes ───
  // Each code is signed with the current secret_version; on verify, we look up
  // the secret for that specific version. Old secrets stay in the table for
  // redemption of previously-issued codes. Set "current=false" on prior rows
  // when rotating (so we know which one is "active" for new issues).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS license_secrets (
      id            SERIAL PRIMARY KEY,
      version       INTEGER NOT NULL UNIQUE,
      secret        TEXT NOT NULL,            -- plaintext (HMAC needs raw key)
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      rotated_by    INTEGER NULL REFERENCES admin_user(id),
      rotated_from  INTEGER NULL,             -- previous version (for audit)
      is_current    BOOLEAN NOT NULL DEFAULT false
    )
  `)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS license_secrets_current_idx ON license_secrets (is_current) WHERE is_current = true`)

  // Seed default tiers jika tabel kosong.
  const tierCount = await pool.query('SELECT COUNT(*)::int AS c FROM pricing_tiers')
  if (tierCount.rows[0].c === 0) {
    await pool.query(`
      INSERT INTO pricing_tiers (slug, name, description, max_tenants, max_photos, max_frames, max_designs, max_presets) VALUES
        ('basic', 'Basic', 'Cocok untuk individu / 1 booth', 1, 100, 3, 3, 3),
        ('premium', 'Premium', 'Untuk event organizer aktif', 3, 1000, 10, 10, 10),
        ('profesional', 'Profesional', 'Untuk studio / multi-cabang', 99, 99999, 99, 99, 99)
    `)
  }

  // Backfill tenant_id untuk data existing yang masih NULL ke default tenant.
  const backfill = (table) => pool.query(`UPDATE ${table} SET tenant_id = $1 WHERE tenant_id IS NULL`, [defaultSlug])
  await backfill('photos')
  await backfill('presets')
  await backfill('transactions')
  await backfill('app_config')
  await backfill('ai_settings')
  await backfill('attract_assets')
  await backfill('attract_icons')
  await backfill('frames')
  await backfill('designs')

  // Tambah unique constraint untuk isolasi config per tenant setelah backfill.
  await pool.query(`DROP INDEX IF EXISTS app_config_tenant_id_idx`)
  await pool.query(`ALTER TABLE app_config DROP CONSTRAINT IF EXISTS app_config_pkey`)
  await pool.query(`ALTER TABLE app_config ADD PRIMARY KEY (tenant_id, id)`)

  // Jadikan PK beberapa tabel menjadi composite (tenant_id, id) agar aman multi-tenant.
  for (const tbl of ['frames', 'designs']) {
    await pool.query(`ALTER TABLE ${tbl} DROP CONSTRAINT IF EXISTS ${tbl}_pkey`)
    await pool.query(`ALTER TABLE ${tbl} ADD PRIMARY KEY (tenant_id, id)`)
  }

  // Seed default admin dari env (hanya kalau belum ada user sama sekali)
  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM admin_user')
  if (rows[0].c === 0) {
    const email = (process.env.ADMIN_EMAIL || 'admin@photobooth.local').toLowerCase().trim()
    const pw = process.env.ADMIN_PASSWORD || 'admin123'
    const hash = hashPassword(pw)
    await pool.query('INSERT INTO admin_user (email, password_hash) VALUES ($1, $2)', [email, hash])
    console.log(`[db] seeded admin user: ${email} (ganti password via env ADMIN_PASSWORD)`)
  }
  // Seed default active config untuk tenant default kalau belum ada.
  const { rows: cf } = await pool.query('SELECT COUNT(*)::int AS c FROM app_config WHERE tenant_id = $1', [defaultSlug])
  if (cf[0].c === 0) {
    await pool.query(
      `INSERT INTO app_config (tenant_id, id, mode, price, preset_name, branding)
       VALUES ($1, 1, 'regular', 5000, NULL, $2)`,
      [defaultSlug, JSON.stringify(DEFAULT_CONFIG)]
    )
    console.log('[db] seeded default app_config')
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

  // License secret versioning migrations (idempotent)
  await pool.query(`
    ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS secret_version INTEGER NOT NULL DEFAULT 1
  `)
  // Seed version 1 secret from the current LICENSE_SECRET_KEY env (if provided),
  // else generate a fresh random one. Passed as named param to avoid SQL injection.
  const envSecret = process.env.LICENSE_SECRET_KEY || null
  const seedSecret = envSecret || `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`
  await pool.query(`
    INSERT INTO license_secrets (version, secret, is_current)
    VALUES (1, $1, true)
    ON CONFLICT (version) DO NOTHING
  `, [seedSecret])
  await pool.query(`CREATE INDEX IF NOT EXISTS license_codes_secret_version_idx ON license_codes(secret_version)`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS license_secrets_current_idx ON license_secrets (is_current) WHERE is_current = true`)
}

export async function verifyAdmin(email, password) {
  const { rows } = await pool.query('SELECT id, password_hash FROM admin_user WHERE email = $1', [
    String(email).toLowerCase().trim(),
  ])
  if (!rows[0]) return null
  if (!verifyPassword(String(password), rows[0].password_hash)) return null
  return rows[0].id
}

export async function createSession(userId, ttlSeconds = SESSION_DAYS * 24 * 3600) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000)
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
    `SELECT u.id, u.email, u.role, u.tenant_id, u.name, u.active
     FROM admin_sessions s JOIN admin_user u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now() LIMIT 1`,
    [token]
  )
  if (!rows[0]) return null
  if (rows[0].active === false) return null
  return { id: rows[0].id, email: rows[0].email, role: rows[0].role, tenant_id: rows[0].tenant_id, name: rows[0].name, pricing_tier_id: rows[0].pricing_tier_id, code: rows[0].code }
}

export async function destroySession(token) {
  if (!token) return
  await pool.query('DELETE FROM admin_sessions WHERE token = $1', [token])
}

export async function saveTransaction({ method, amount, template = null, note = null, preset = null, mode = 'regular', tenantId = DEFAULT_TENANT }) {
  const r = await pool.query(
    'INSERT INTO transactions (tenant_id, method, amount, template, note, preset, mode) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, created_at',
    [tenantId, method, amount, template, note, preset, mode]
  )
  return r.rows[0]
}

// listTransactions({ limit, from, to })
//   from/to: 'YYYY-MM-DD' (opsional) -> filter rentang hari itu (inklusif).
export async function listTransactions({ limit = 200, from = null, to = null, tenantId = DEFAULT_TENANT } = {}) {
  const where = ['tenant_id = $1']
  const params = [tenantId]
  if (from) { params.push(`${from} 00:00:00`); where.push(`created_at >= $${params.length}`) }
  if (to) { params.push(`${to} 23:59:59`); where.push(`created_at <= $${params.length}`) }
  params.push(Math.min(limit, 100000))
  const sql = `SELECT id, created_at, method, amount, template, note, preset, mode FROM transactions
    WHERE ${where.join(' AND ')}
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

export async function getStats(tenantId = DEFAULT_TENANT) {
  const today = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now())) AS today_count,
      COALESCE(SUM(amount) FILTER (WHERE created_at >= date_trunc('day', now())), 0) AS today_amount,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND method = 'qris') AS today_qris,
      COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND method = 'cash') AS today_cash,
      COUNT(*) AS total_count,
      COALESCE(SUM(amount), 0) AS total_amount
    FROM transactions
    WHERE tenant_id = $1
  `, [tenantId])
  const byHour = await pool.query(`
    SELECT date_trunc('hour', created_at) AS hour, COUNT(*) AS cnt
    FROM transactions
    WHERE created_at >= date_trunc('day', now()) AND tenant_id = $1
    GROUP BY 1 ORDER BY 1
  `, [tenantId])
  return { summary: today.rows[0], byHour: byHour.rows }
}

export async function savePhoto(id, buf, tenantId = DEFAULT_TENANT) {
  await pool.query(
    'INSERT INTO photos (id, tenant_id, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data',
    [id, tenantId, buf]
  )
  return id
}

export async function getPhoto(id) {
  const r = await pool.query('SELECT data FROM photos WHERE id = $1', [id])
  return r.rows[0]?.data || null
}

// Daftar foto (terbaru dulu). Filter by tanggal optional (from/to, format YYYY-MM-DD).
export async function listPhotos({ limit = 100, from = null, to = null, tenantId = DEFAULT_TENANT } = {}) {
  const where = ['tenant_id = $1']
  const params = [tenantId]
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
export async function savePreset(name, mode, price, branding, tenantId = DEFAULT_TENANT) {
  const n = String(name || '').trim()
  if (!n) throw new Error('nama preset wajib')
  const m = mode === 'event' ? 'event' : 'regular'
  const p = m === 'event' ? 0 : (price === 0 ? 0 : Number(price) || 5000)
  const r = await pool.query(
    `INSERT INTO presets (tenant_id, name, mode, price, branding, updated_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (name) DO UPDATE SET mode = EXCLUDED.mode, price = EXCLUDED.price, branding = EXCLUDED.branding, updated_at = now()
     RETURNING name`,
    [tenantId, n, m, p, branding]
  )
  return r.rows[0].name
}

// Semua preset sebagai array { name, mode, price, branding }, terbaru dulu.
export async function listPresets(tenantId = DEFAULT_TENANT) {
  const r = await pool.query('SELECT name, mode, price, branding FROM presets WHERE tenant_id = $1 ORDER BY updated_at DESC', [tenantId])
  return r.rows
}

// Ambil satu preset by name.
export async function getPreset(name, tenantId = DEFAULT_TENANT) {
  const r = await pool.query('SELECT name, mode, price, branding FROM presets WHERE name = $1 AND tenant_id = $2', [name, tenantId])
  return r.rows[0] || null
}

// Hapus preset by name.
export async function deletePreset(name, tenantId = DEFAULT_TENANT) {
  await pool.query('DELETE FROM presets WHERE name = $1 AND tenant_id = $2', [name, tenantId])
}

// ── Active app config (persisted, survives refresh/cache clear) ──
export async function getConfig(tenantId = DEFAULT_TENANT) {
  const r = await pool.query('SELECT mode, price, preset_name, branding FROM app_config WHERE tenant_id = $1 AND id = 1', [tenantId])
  return r.rows[0] || null
}

export async function saveConfig(config, tenantId = DEFAULT_TENANT) {
  const { mode, price, preset_name, branding } = config
  await pool.query(
    `INSERT INTO app_config (tenant_id, id, mode, price, preset_name, branding, updated_at)
     VALUES ($1, 1, $2, $3, $4, $5, now())
     ON CONFLICT (tenant_id, id) DO UPDATE SET mode = EXCLUDED.mode, price = EXCLUDED.price, preset_name = EXCLUDED.preset_name, branding = EXCLUDED.branding, updated_at = now()`,
    [tenantId, mode === 'event' ? 'event' : 'regular', Number(price) || 5000, preset_name ?? null, branding ?? {}]
  )
}

// ── AI settings (Gemini API key dkk; API key TIDAK pernah dikirim ke frontend) ──
const DEFAULT_AI_PROMPT =
  'Transform this photo into a minimalist black-and-white pencil sketch illustration. Clean thin line art on plain white paper background, soft hand-drawn pencil strokes, high contrast between the subject and background. Keep the exact same person, pose and composition. No color, no shading blocks — pure sketch lines only.'

export async function getAiSettings(tenantId = DEFAULT_TENANT) {
  try {
    const r = await pool.query('SELECT api_key, model, prompt, enabled FROM ai_settings WHERE tenant_id = $1 AND id = 1', [tenantId])
    if (r.rows[0]) return r.rows[0]
    await pool.query(
      `INSERT INTO ai_settings (tenant_id, id, api_key, model, prompt, enabled)
       VALUES ($1, 1, '', 'gemini-2.5-flash-image', $2, false)
       ON CONFLICT (id) DO NOTHING`,
      [tenantId, DEFAULT_AI_PROMPT]
    )
    const r2 = await pool.query('SELECT api_key, model, prompt, enabled FROM ai_settings WHERE tenant_id = $1 AND id = 1', [tenantId])
    return r2.rows[0] || { api_key: '', model: 'gemini-2.5-flash-image', prompt: DEFAULT_AI_PROMPT, enabled: false }
  } catch {
    return { api_key: '', model: 'gemini-2.5-flash-image', prompt: DEFAULT_AI_PROMPT, enabled: false }
  }
}

export async function saveAiSettings(s, tenantId = DEFAULT_TENANT) {
  const cur = await getAiSettings(tenantId)
  const apiKey = typeof s.api_key === 'string' ? s.api_key : cur.api_key
  const model = typeof s.model === 'string' && s.model.trim() ? s.model.trim() : cur.model
  const prompt = typeof s.prompt === 'string' && s.prompt.trim() ? s.prompt.trim() : cur.prompt
  const enabled = typeof s.enabled === 'boolean' ? s.enabled : cur.enabled
  await pool.query(
    `INSERT INTO ai_settings (tenant_id, id, api_key, model, prompt, enabled, updated_at)
     VALUES ($1, 1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET api_key = EXCLUDED.api_key, model = EXCLUDED.model, prompt = EXCLUDED.prompt, enabled = EXCLUDED.enabled, updated_at = now()`,
    [tenantId, apiKey, model, prompt, enabled]
  )
}

// ── Custom frame gallery (stored in Postgres, selectable by customer) ──────
export async function saveFrame(id, name, buf, template = null, tenantId = DEFAULT_TENANT) {
  await pool.query(
    `INSERT INTO frames (tenant_id, id, name, image_data, template, created_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, image_data = EXCLUDED.image_data, template = EXCLUDED.template`,
    [tenantId, id, name, buf, template]
  )
  return id
}

export async function listFrames(template = null, tenantId = DEFAULT_TENANT) {
  let sql = 'SELECT id, name, template, created_at FROM frames WHERE tenant_id = $1'
  const args = [tenantId]
  if (template) {
    sql += ' AND (template = $2 OR template IS NULL)'
    args.push(template)
  }
  sql += ' ORDER BY created_at ASC'
  const r = await pool.query(sql, args)
  return r.rows
}

export async function getFrame(id, tenantId = DEFAULT_TENANT) {
  const r = await pool.query('SELECT image_data FROM frames WHERE id = $1 AND tenant_id = $2', [id, tenantId])
  return r.rows[0]?.image_data || null
}

export async function deleteFrame(id, tenantId = DEFAULT_TENANT) {
  await pool.query('DELETE FROM frames WHERE id = $1 AND tenant_id = $2', [id, tenantId])
}

// ── Designs (mockup kustom: bingkai PNG + slot foto bebas/miring) ──
// slots: array { x, y, w, h, rot } dalam koordinat PRINT_WIDTH (576 px lebar).
// canvas_w/h = asli mockup (utk skala bingkai). disimpan JSONB.
export async function saveDesign(id, name, frameBuf, canvasW, canvasH, slots, tenantId = DEFAULT_TENANT) {
  await pool.query(
    `INSERT INTO designs (tenant_id, id, name, frame_data, canvas_w, canvas_h, slots, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, now())
     ON CONFLICT (tenant_id, id) DO UPDATE SET name = EXCLUDED.name, frame_data = EXCLUDED.frame_data,
       canvas_w = EXCLUDED.canvas_w, canvas_h = EXCLUDED.canvas_h, slots = EXCLUDED.slots`,
    [tenantId, id, name, frameBuf, canvasW, canvasH, JSON.stringify(slots)]
  )
  return id
}

// Update design yg sudah ada: ganti slot (dan bingkai kalau dikasih).
export async function updateDesign(id, { name, frameBuf, slots, canvasW, canvasH } = {}, tenantId = DEFAULT_TENANT) {
  const cur = await getDesign(id, tenantId)
  if (!cur) throw new Error('design tidak ditemukan')
  const nextName = name ?? cur.name
  const nextFrame = frameBuf !== undefined ? frameBuf : cur.frame_data
  const nextSlots = slots !== undefined ? JSON.stringify(slots) : JSON.stringify(cur.slots)
  const nextW = canvasW ?? cur.canvas_w
  const nextH = canvasH ?? cur.canvas_h
  await pool.query(
    `UPDATE designs SET name = $2, frame_data = $3, slots = $4, canvas_w = $5, canvas_h = $6 WHERE id = $1 AND tenant_id = $7`,
    [id, nextName, nextFrame, nextSlots, nextW, nextH, tenantId]
  )
  return id
}

export async function listDesigns(tenantId = DEFAULT_TENANT) {
  const r = await pool.query(
    `SELECT id, name, canvas_w, canvas_h, created_at,
            COALESCE(jsonb_array_length(slots), 0) AS slots_count,
            slots AS slots_raw,
            (frame_data IS NOT NULL) AS has_frame
     FROM designs WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [tenantId]
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

export async function getDesign(id, tenantId = DEFAULT_TENANT) {
  const r = await pool.query('SELECT id, name, frame_data, canvas_w, canvas_h, slots FROM designs WHERE id = $1 AND tenant_id = $2', [id, tenantId])
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

export async function deleteDesign(id, tenantId = DEFAULT_TENANT) {
  await pool.query('DELETE FROM designs WHERE id = $1 AND tenant_id = $2', [id, tenantId])
}

// ── Attract screen background (image/video) per mode, stored in Postgres ──
export async function saveAttract(mode, mediaType, buf, tenantId = DEFAULT_TENANT) {
  await pool.query(
    `INSERT INTO attract_assets (tenant_id, mode, media_type, data, created_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (mode) DO UPDATE SET media_type = EXCLUDED.media_type, data = EXCLUDED.data, created_at = now()`,
    [tenantId, mode, mediaType, buf]
  )
}

export async function getAttract(mode, tenantId = DEFAULT_TENANT) {
  const r = await pool.query('SELECT media_type, data FROM attract_assets WHERE mode = $1 AND tenant_id = $2', [mode, tenantId])
  return r.rows[0] || null
}

export async function deleteAttract(mode, tenantId = DEFAULT_TENANT) {
  await pool.query('DELETE FROM attract_assets WHERE mode = $1 AND tenant_id = $2', [mode, tenantId])
}

// ── Attract tap icon (custom PNG per mode) ──
export async function saveAttractIcon(mode, mediaType, buf, tenantId = DEFAULT_TENANT) {
  await pool.query(
    `INSERT INTO attract_icons (tenant_id, mode, media_type, data, created_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (mode) DO UPDATE SET media_type = EXCLUDED.media_type, data = EXCLUDED.data, created_at = now()`,
    [tenantId, mode, mediaType, buf]
  )
}

export async function getAttractIcon(mode, tenantId = DEFAULT_TENANT) {
  const r = await pool.query('SELECT media_type, data FROM attract_icons WHERE mode = $1 AND tenant_id = $2', [mode, tenantId])
  return r.rows[0] || null
}

export async function deleteAttractIcon(mode, tenantId = DEFAULT_TENANT) {
  await pool.query('DELETE FROM attract_icons WHERE mode = $1 AND tenant_id = $2', [mode, tenantId])
}

// =================== ADMIN SPA HELPERS ===================
// Functions used by the React admin dashboard at /api/admin/* (cookie-based auth).

export async function recordLoginAttempt(email, success, ip = null) {
  await pool.query(
    'INSERT INTO admin_login_attempts (email, success, ip) VALUES ($1, $2, $3)',
    [String(email).toLowerCase().trim(), !!success, ip]
  )
}

export async function recentFailedLogins(email, windowMins = 15) {
  const r = await pool.query(
    `SELECT COUNT(*)::int AS c FROM admin_login_attempts
     WHERE LOWER(email) = $1 AND success = false AND created_at > now() - ($2 || ' minutes')::interval`,
    [String(email).toLowerCase().trim(), windowMins]
  )
  return r.rows[0].c
}

export async function logAudit({ userId = null, tenantSlug = null, action, target = null, metadata = null, ip = null, ua = null }) {
  await pool.query(
    `INSERT INTO admin_audit_log (user_id, tenant_slug, action, target, metadata, ip, ua)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [userId, tenantSlug, action, target, metadata, ip, ua]
  )
}

export async function listAudit({ limit = 100, offset = 0, tenantSlug = null, userId = null } = {}) {
  const where = []
  const params = []
  if (tenantSlug) { params.push(tenantSlug); where.push(`tenant_slug = $${params.length}`) }
  if (userId) { params.push(userId); where.push(`user_id = $${params.length}`) }
  const sql = `SELECT id, user_id, tenant_slug, action, target, metadata, created_at
               FROM admin_audit_log
               ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
  params.push(limit, offset)
  const r = await pool.query(sql, params)
  const countR = await pool.query(
    `SELECT COUNT(*)::int AS c FROM admin_audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
    params.slice(0, params.length - 2)
  )
  return { items: r.rows, total: countR.rows[0].c }
}

export async function listTenantsWithStats({ search = '', limit = 500, offset = 0 } = {}) {
  const where = []
  const params = []
  if (search) { params.push(`%${search.toLowerCase()}%`); where.push(`(LOWER(t.slug) LIKE $${params.length} OR LOWER(t.name) LIKE $${params.length})`) }
  const sql = `
    SELECT t.id, t.slug, t.name, t.active, t.access_pin, t.created_at, t.updated_at,
           COALESCE((SELECT COUNT(*)::int FROM photos p WHERE p.tenant_id = t.slug), 0) AS photo_count,
           COALESCE((SELECT COUNT(*)::int FROM transactions x WHERE x.tenant_id = t.slug), 0) AS transaction_count,
           COALESCE((SELECT COALESCE(SUM(amount), 0)::bigint FROM transactions x WHERE x.tenant_id = t.slug), 0) AS revenue
    FROM tenants t
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
  params.push(limit, offset)
  const r = await pool.query(sql, params)
  const items = r.rows.map((row) => ({
    ...row,
    stats: { photos: row.photo_count, transactions: row.transaction_count, revenue: Number(row.revenue) },
  }))
  return items
}

export async function createTenant({ slug, name, accessPin = null, ownerUserId = null }) {
  const r = await pool.query(
    `INSERT INTO tenants (slug, name, access_pin, owner_user_id) VALUES ($1, $2, $3, $4)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, access_pin = EXCLUDED.access_pin, updated_at = now()
     RETURNING id, slug, name, active, access_pin, owner_user_id, created_at, updated_at`,
    [String(slug).toLowerCase().trim(), name, accessPin, ownerUserId]
  )
  return r.rows[0]
}

// Hitung jumlah tenant yang dimiliki user
export async function countTenantsByOwner(userId) {
  const r = await pool.query('SELECT COUNT(*)::int AS c FROM tenants WHERE owner_user_id = $1', [userId])
  return r.rows[0].c
}

// List tenant yang dimiliki user tertentu
export async function listTenantsByOwner(userId) {
  const r = await pool.query(
    `SELECT slug, name, active, access_pin, created_at, updated_at FROM tenants WHERE owner_user_id = $1 ORDER BY created_at DESC`,
    [userId]
  )
  return r.rows
}

// Owner check: return true jika user adalah owner tenant
export async function isTenantOwner(tenantSlug, userId) {
  const r = await pool.query('SELECT 1 FROM tenants WHERE slug = $1 AND owner_user_id = $2', [tenantSlug, userId])
  return r.rows.length > 0
}

export async function updateTenant(slug, { name = null, accessPin = undefined, active = undefined }) {
  const set = []
  const params = []
  if (name !== null) { params.push(name); set.push(`name = $${params.length}`) }
  if (accessPin !== undefined) { params.push(accessPin); set.push(`access_pin = $${params.length}`) }
  if (active !== undefined) { params.push(active); set.push(`active = $${params.length}`) }
  set.push(`updated_at = now()`)
  params.push(slug)
  const r = await pool.query(
    `UPDATE tenants SET ${set.join(', ')} WHERE slug = $${params.length}
     RETURNING id, slug, name, active, access_pin, created_at, updated_at`,
    params
  )
  return r.rows[0] || null
}

export async function deleteTenant(slug) {
  await pool.query('DELETE FROM tenants WHERE slug = $1', [slug])
}

export async function listUsers({ search = '', limit = 200, offset = 0 } = {}) {
  const where = []
  const params = []
  if (search) { params.push(`%${search.toLowerCase()}%`); where.push(`(LOWER(email) LIKE $${params.length} OR LOWER(COALESCE(name, '')) LIKE $${params.length})`) }
  const sql = `
    SELECT u.id, u.email, u.role, u.tenant_id, u.name, u.active, u.last_login_at, u.created_at,
           u.code, u.pricing_tier_id,
           t.id AS tier_id, t.slug AS tier_slug, t.name AS tier_name,
           t.max_tenants AS tier_max_tenants, t.max_photos AS tier_max_photos, t.max_frames AS tier_max_frames,
           t.max_designs AS tier_max_designs, t.max_presets AS tier_max_presets
    FROM admin_user u
    LEFT JOIN pricing_tiers t ON t.id = u.pricing_tier_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY u.created_at DESC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
  params.push(limit, offset)
  const r = await pool.query(sql, params)
  const countR = await pool.query(
    `SELECT COUNT(*)::int AS c FROM admin_user ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
    params.slice(0, params.length - 2)
  )
  return { items: r.rows, total: countR.rows[0].c }
}

export async function createUser({ email, password, role = 'super_admin', tenantId = null, name = null, pricingTierId = null }) {
  const hash = hashPassword(password)
  const r = await pool.query(
    `INSERT INTO admin_user (email, password_hash, role, tenant_id, name, pricing_tier_id) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, email, role, tenant_id, name, code, pricing_tier_id, active, last_login_at, created_at`,
    [email.toLowerCase().trim(), hash, role, tenantId, name, pricingTierId || null]
  )
  return r.rows[0]
}

export async function updateUser(id, { role = undefined, active = undefined, name = undefined, password = undefined, pricing_tier_id = undefined }) {
  const set = []
  const params = []
  if (role !== undefined) { params.push(role); set.push(`role = $${params.length}`) }
  if (active !== undefined) { params.push(active); set.push(`active = $${params.length}`) }
  if (name !== undefined) { params.push(name); set.push(`name = $${params.length}`) }
  if (password !== undefined) { params.push(hashPassword(password)); set.push(`password_hash = $${params.length}`) }
  if (pricing_tier_id !== undefined) { params.push(pricing_tier_id); set.push(`pricing_tier_id = $${params.length}`) }
  set.push(`updated_at = now()`)
  params.push(id)
  const r = await pool.query(
    `UPDATE admin_user SET ${set.join(', ')} WHERE id = $${params.length}
     RETURNING id, email, role, tenant_id, name, active, last_login_at, created_at`,
    params
  )
  return r.rows[0] || null
}

export async function deleteUser(id) {
  await pool.query('DELETE FROM admin_user WHERE id = $1', [id])
}

export async function getUserById(id) {
  const r = await pool.query(
    `SELECT u.id, u.email, u.role, u.tenant_id, u.name, u.active, u.code, u.pricing_tier_id, u.last_login_at, u.created_at,
            t.slug AS tier_slug, t.name AS tier_name, t.max_tenants AS tier_max_tenants, t.max_photos AS tier_max_photos, t.max_frames AS tier_max_frames, t.max_designs AS tier_max_designs, t.max_presets AS tier_max_presets
     FROM admin_user u LEFT JOIN pricing_tiers t ON t.id = u.pricing_tier_id
     WHERE u.id = $1`, [id])
  return r.rows[0] || null
}

// Find user by email (case-insensitive)
export async function findUserByEmail(email) {
  const r = await pool.query(
    `SELECT id, email, role, tenant_id, active FROM admin_user WHERE LOWER(email) = LOWER($1)`, [String(email).trim()])
  return r.rows[0] || null
}

export async function setLastLogin(id) {
  await pool.query('UPDATE admin_user SET last_login_at = now() WHERE id = $1', [id])
}

export async function getGlobalOverview() {
  const r = await pool.query(`
    SELECT
      (SELECT COUNT(*)::int FROM tenants) AS tenants,
      (SELECT COUNT(*)::int FROM photos) AS photos,
      (SELECT COUNT(*)::int FROM transactions) AS transactions,
      (SELECT COALESCE(SUM(amount), 0)::bigint FROM transactions) AS revenue
  `)
  const trend = await pool.query(`
    SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS label,
           COUNT(*)::int AS prints,
           COALESCE(SUM(amount), 0)::bigint AS revenue
    FROM transactions
    WHERE created_at > now() - interval '14 days'
    GROUP BY 1 ORDER BY 1
  `)
  return { ...r.rows[0], revenue: Number(r.rows[0].revenue), trend: trend.rows.map((t) => ({ ...t, revenue: Number(t.revenue) })) }
}

// =============== Pricing Tiers ===============
export async function listTiers({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE active = true' : ''
  const r = await pool.query(`SELECT * FROM pricing_tiers ${where} ORDER BY id`)
  return r.rows.map((t) => ({
    id: t.id, slug: t.slug, name: t.name, description: t.description,
    max_tenants: t.max_tenants, max_photos: t.max_photos, max_frames: t.max_frames,
    max_designs: t.max_designs, max_presets: t.max_presets, active: t.active,
  }))
}

export async function getTier(id) {
  const r = await pool.query('SELECT * FROM pricing_tiers WHERE id = $1', [id])
  return r.rows[0] || null
}

export async function createTier({ slug, name, description, max_tenants, max_photos, max_frames, max_designs, max_presets }) {
  const r = await pool.query(
    `INSERT INTO pricing_tiers (slug, name, description, max_tenants, max_photos, max_frames, max_designs, max_presets)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [slug, name, description || null, Number(max_tenants)||1, Number(max_photos)||100, Number(max_frames)||3, Number(max_designs)||3, Number(max_presets)||3]
  )
  return r.rows[0]
}

export async function updateTier(id, fields) {
  const set = []
  const params = []
  const cols = ['slug','name','description','max_tenants','max_photos','max_frames','max_designs','max_presets','active']
  for (const c of cols) {
    if (fields[c] !== undefined) { params.push(fields[c]); set.push(`${c} = $${params.length}`) }
  }
  if (!set.length) return getTier(id)
  set.push(`updated_at = now()`)
  params.push(id)
  const r = await pool.query(`UPDATE pricing_tiers SET ${set.join(', ')} WHERE id = $${params.length} RETURNING *`, params)
  return r.rows[0] || null
}

export async function deleteTier(id) {
  await pool.query('DELETE FROM pricing_tiers WHERE id = $1', [id])
}

// =============== User code & tier helpers ===============
export async function generateUserCode() {
  // Kode unik: PBX-XXXXXX (alphanum cap atas) dengan retry collision.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = 'PBX-'
    for (let j = 0; j < 6; j++) code += chars[Math.floor(Math.random() * chars.length)]
    const existing = await pool.query('SELECT id FROM admin_user WHERE code = $1', [code])
    if (!existing.rows[0]) return code
  }
  // Fallback: timestamp-based
  return 'PBX-' + Date.now().toString(36).toUpperCase().slice(-6)
}

export async function assignUserCode(userId, code) {
  const r = await pool.query('UPDATE admin_user SET code = $1, updated_at = now() WHERE id = $2 RETURNING id, email, code', [code, userId])
  return r.rows[0] || null
}

export async function setUserTier(userId, tierId) {
  const r = await pool.query('UPDATE admin_user SET pricing_tier_id = $1, updated_at = now() WHERE id = $2 RETURNING id, code, pricing_tier_id', [tierId || null, userId])
  return r.rows[0] || null
}

// =============== Tier enforcement ===============
// Mengambil limit tier untuk tenant admin yang terikat pada tenant.
// Return null jika tenant tidak punya user bertier (unlimited / booth tanpa tier).
export async function getUserTierLimit(userIdForAuth, tenantSlug) {
  const r = await pool.query(`
    SELECT t.max_tenants, t.max_photos, t.max_frames, t.max_designs, t.max_presets
    FROM admin_user u
    JOIN pricing_tiers t ON t.id = u.pricing_tier_id AND t.active = true
    WHERE u.tenant_id = $1 AND u.role = 'tenant_admin'
    LIMIT 1
  `, [tenantSlug])
  if (!r.rows[0] || !r.rows[0].max_tenants) return null
  return r.rows[0]
}

// Cek usage saat ini untuk tenant
export async function getTenantUsage(tenantSlug) {
  const photos = await pool.query('SELECT COUNT(*)::int AS c FROM photos WHERE tenant_id = $1', [tenantSlug])
  const frames = await pool.query('SELECT COUNT(*)::int AS c FROM frames WHERE tenant_id = $1', [tenantSlug])
  const designs = await pool.query('SELECT COUNT(*)::int AS c FROM designs WHERE tenant_id = $1', [tenantSlug])
  const presets = await pool.query('SELECT COUNT(*)::int AS c FROM presets WHERE tenant_id = $1', [tenantSlug])
  return {
    photos: photos.rows[0].c, frames: frames.rows[0].c, designs: designs.rows[0].c, presets: presets.rows[0].c,
  }
}

// Validasi resource create terhadap tier tenant. Return { ok: true } atau { ok: false, error: '...' }.
export async function checkTierLimit(userIdForAuth, tenantSlug, resource) {
  const limit = await getUserTierLimit(userIdForAuth, tenantSlug)
  if (!limit) return { ok: true } // tanpa tier = unlimited
  const usage = await getTenantUsage(tenantSlug)
  const field = `max_${resource}`
  const current = usage[resource]
  const max = limit[field]
  if (current >= max) {
    return { ok: false, error: `Batas tier tercapai: ${resource} sudah ${current}/${max}. Upgrade tier untuk menambah.` }
  }
  return { ok: true, current, max }
}

// ════════════════════════════════════════════════════════════════════════════════
// License Codes — track issued/redeemed/revoked HMAC codes
// ════════════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto'

function hashLicenseCode(code) {
  return createHash('sha256').update(String(code)).digest('hex')
}

// Record a newly issued license code
export async function recordLicenseCode({ code, vendorId, tierSlug, expiresAt, issuedBy, secretVersion = 1 }) {
  const codeHash = hashLicenseCode(code)
  const r = await pool.query(`
    INSERT INTO license_codes (code_hash, vendor_id, tier_slug, expires_at, issued_by, secret_version)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (code_hash) DO NOTHING
    RETURNING id, code_hash, vendor_id, tier_slug, expires_at, issued_at
  `, [codeHash, vendorId, tierSlug || null, expiresAt, issuedBy || null, secretVersion])
  return r.rows[0] || null
}

// Look up code by hash (for revocation check during /verify)
export async function getLicenseByHash(code) {
  const codeHash = hashLicenseCode(code)
  const r = await pool.query(`
    SELECT id, code_hash, vendor_id, tier_slug, expires_at,
           redeemed_at, redeemed_by, redeemed_tenant, revoked_at, active,
           secret_version
    FROM license_codes
    WHERE code_hash = $1
  `, [codeHash])
  return r.rows[0] || null
}

// List codes (for admin UI)
export async function listLicenseCodes({ limit = 100, offset = 0, vendorId = null } = {}) {
  const params = []
  let where = ''
  if (vendorId) {
    params.push(vendorId)
    where = `WHERE lc.vendor_id = $${params.length}`
  }
  params.push(limit, offset)
  const limitIdx = params.length - 1
  const offsetIdx = params.length
  const r = await pool.query(`
    SELECT lc.id, lc.code_hash, lc.vendor_id, lc.tier_slug, lc.expires_at,
           lc.issued_at, lc.issued_by, u1.email AS issued_by_email,
           lc.redeemed_at, lc.redeemed_by, lc.redeemed_tenant,
           lc.revoked_at, lc.revoked_by, u2.email AS revoked_by_email, lc.active,
           COUNT(*) OVER() AS total_count
    FROM license_codes lc
    LEFT JOIN admin_user u1 ON u1.id = lc.issued_by
    LEFT JOIN admin_user u2 ON u2.id = lc.revoked_by
    ${where}
    ORDER BY lc.issued_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `, params)
  const total = r.rows.length > 0 ? Number(r.rows[0].total_count) : 0
  return { items: r.rows, total }
}

// Revoke a license code (admin action)
export async function revokeLicenseCode(codeId, revokedBy) {
  const r = await pool.query(`
    UPDATE license_codes
    SET active = false, revoked_at = now(), revoked_by = $2
    WHERE id = $1 AND active = true
    RETURNING id
  `, [codeId, revokedBy || null])
  return r.rows[0] || null
}

// Mark code as redeemed (called after successful user+tenant creation)
export async function markLicenseRedeemed({ code, userEmail, tenantSlug }) {
  const codeHash = hashLicenseCode(code)
  const r = await pool.query(`
    UPDATE license_codes
    SET active = false, redeemed_at = now(),
        redeemed_by = $2, redeemed_tenant = $3
    WHERE code_hash = $1 AND active = true
    RETURNING id
  `, [codeHash, userEmail, tenantSlug])
  return r.rows[0] || null
}

export async function getSecretByVersion(version) {
  const r = await pool.query('SELECT version, secret, created_at, is_current FROM license_secrets WHERE version = $1', [version])
  return r.rows[0] || null
}

export async function getCurrentSecret() {
  const r = await pool.query('SELECT version, secret, created_at, is_current FROM license_secrets WHERE is_current = true')
  return r.rows[0] || null
}

export async function listSecretVersions() {
  const r = await pool.query(`
    SELECT s.version, s.created_at, s.rotated_by, s.rotated_from, s.is_current,
           u.email AS rotated_by_email
    FROM license_secrets s
    LEFT JOIN admin_user u ON u.id = s.rotated_by
    ORDER BY s.version DESC
  `)
  return r.rows
}

// Rotate: mark current secret as non-current, insert new secret as current.
// Returns new version number. Does NOT delete old secrets (needed for verify old codes).
export async function rotateSecret(newSecret, rotatedBy) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    // Mark current as non-current
    await client.query('UPDATE license_secrets SET is_current = false WHERE is_current = true')
    // Get previous version
    const { rows: prev } = await client.query('SELECT MAX(version) AS mv FROM license_secrets')
    const prevVersion = prev[0]?.mv || 1
    // Insert new current
    const { rows } = await client.query(
      'INSERT INTO license_secrets (version, secret, rotated_by, rotated_from, is_current) VALUES ($1, $2, $3, $4, true) RETURNING version',
      [prevVersion + 1, newSecret, rotatedBy, prevVersion]
    )
    await client.query('COMMIT')
    return rows[0].version
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

export default pool
