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

// Resolve tenant dari request hostname + device fingerprint.
// Booth app kini jalan di SATU domain (mis. app.achipix.web.id) dan tenant
// ditentukan dari device yang sudah di-pair; subdomain {slug}.* tetap jalan
// sebagai alias opsional. Return null kalau device dikirim tapi belum di-pair
// dan tidak ada subdomain match (biar booth tampilkan layar pairing).
const ROOT_DOMAIN = 'achipix.web.id'
const ADMIN_SUBDOMAIN = 'admin'

// Batas panjang device fingerprint (header bisa panjang tak terduga → keamanan).
const DEVICE_FP_MAX = 128
function normDeviceFp(fp) {
  if (!fp) return ''
  return String(fp).trim().slice(0, DEVICE_FP_MAX)
}

// Cari tenant dari device fingerprint yang sudah di-pair (is_active=true).
// Return slug atau null. Dipakai sebagai prioritas utama routing booth.
export async function resolveTenantByDevice(deviceFp) {
  const fp = normDeviceFp(deviceFp)
  if (!fp) return null
  try {
    const { rows } = await pool.query(
      `SELECT bd.tenant_slug
       FROM booth_devices bd
       JOIN tenants t ON t.slug = bd.tenant_slug
       WHERE bd.device_fp = $1 AND bd.is_active = true AND t.active = true
         AND t.status NOT IN ('pending', 'rejected')
       ORDER BY bd.paired_at DESC NULLS LAST, bd.id DESC
       LIMIT 1`,
      [fp]
    )
    return rows[0]?.tenant_slug || null
  } catch {
    return null
  }
}

export async function resolveTenant(hostname = '', deviceFp = null) {
  const h = String(hostname).split(':')[0].toLowerCase()
  if (!h) return DEFAULT_TENANT
  const parts = h.split('.')
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^localhost$/.test(h) || parts.length === 1
  const fp = normDeviceFp(deviceFp)
  // Prioritas BARU: device fingerprint. Device yang sudah di-pair → tenant-nya,
  // apapun host-nya (device-based routing). Dipasang SEBELUM shortcut localhost/IP
  // agar booth bisa di-test via localhost:5173 (hanya booth yang mengirim fp;
  // admin SPA tidak pernah mengirim header X-Device-Fp).
  if (fp) {
    const byDevice = await resolveTenantByDevice(fp)
    if (byDevice) return byDevice
  }

  // Root domain (achipix.web.id) or bare IP/localhost → serve admin dashboard.
  // TAPI: request dengan device fp yang tak dikenal (device booth belum di-pair)
  // → null supaya booth menampilkan layar pairing (localhost/IP ikut rule ini,
  // karena hanya booth app yang mengirim X-Device-Fp; admin SPA tidak).
  if (h === ROOT_DOMAIN || isIp) return fp ? null : 'admin'
  // admin.achipix.web.id → admin dashboard (subdomain)
  if (parts[0] === ADMIN_SUBDOMAIN && parts[1] === 'achipix') return 'admin'

  // *.achipix.web.id → booth tenant (slug = subdomain) — alias opsional.
  const slug = parts[0]
  if (!slug) return DEFAULT_TENANT
  try {
    const { rows } = await pool.query(
      `SELECT slug FROM tenants
       WHERE slug = $1 AND active = true AND status NOT IN ('pending', 'rejected')`,
      [slug]
    )
    if (rows.length) return slug
    // Device dikirim tapi belum di-pair & tidak ada subdomain match (mis. app.*)
    // → null supaya booth menampilkan layar pairing, bukan fallback default.
    if (fp) return null
    // Host tak dikenal TANPA fp → fallback lama (deployment existing tetap jalan).
    return DEFAULT_TENANT
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
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'status') THEN
        ALTER TABLE tenants ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
      END IF;
    END $$;
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'trial_ends_at') THEN
        ALTER TABLE tenants ADD COLUMN trial_ends_at TIMESTAMPTZ NULL;
      END IF;
    END $$;
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'subscription_ends_at') THEN
        ALTER TABLE tenants ADD COLUMN subscription_ends_at TIMESTAMPTZ NULL;
      END IF;
    END $$;
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'grace_period_ends_at') THEN
        ALTER TABLE tenants ADD COLUMN grace_period_ends_at TIMESTAMPTZ NULL;
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
    CREATE TABLE IF NOT EXISTS admin_user (
      id              SERIAL PRIMARY KEY,
      email           TEXT NOT NULL UNIQUE,
      password_hash   TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'super_admin',  -- super_admin | tenant_admin
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
    CREATE TABLE IF NOT EXISTS user_sessions (
      id          TEXT PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES admin_user(id) ON DELETE CASCADE,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at  TIMESTAMPTZ NOT NULL,
      remember    BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS user_sessions_user_idx ON user_sessions (user_id, expires_at DESC);
    CREATE INDEX IF NOT EXISTS user_sessions_expires_idx ON user_sessions (expires_at);
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
  // Helper functions
function sanitizeVendorId(vendorId) {
  return String(vendorId).replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function sanitizeSlug(vendorId) {
  return String(vendorId).replace(/@.*/, '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '')
}

// ──────────────────────── User Session Helpers ────────────────────────
  // Migration: add for_user_id for 1:1 code-to-user binding
  await pool.query(`ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS for_user_id INTEGER REFERENCES admin_user(id) ON DELETE SET NULL`)
  await pool.query(`CREATE INDEX IF NOT EXISTS license_codes_for_user_idx ON license_codes(for_user_id)`)
  // Migration: store plaintext code so admin can re-copy a generated code
  await pool.query(`ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS code_plain TEXT`)
  // Migration: simpan user penerima kode (dipakai markLicenseRedeemed). Sebelumnya
  // kolom ini direferensikan query tapi tak pernah dibuat → query throw.
  await pool.query(`ALTER TABLE license_codes ADD COLUMN IF NOT EXISTS redeemed_user_id INTEGER REFERENCES admin_user(id)`)
  // Migration: kode aktivasi 6 char (flow baru) tidak pakai HMAC → secret_version boleh NULL.
  await pool.query(`ALTER TABLE license_codes ALTER COLUMN secret_version DROP NOT NULL`)

  // ── Access codes: 6-char alphanumeric codes for tablet pairing ────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS access_codes (
      id          SERIAL PRIMARY KEY,
      tenant_slug TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      code        TEXT NOT NULL UNIQUE,
      active      BOOLEAN NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at  TIMESTAMPTZ NULL,
      used_at     TIMESTAMPTZ NULL
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS access_codes_code_idx ON access_codes(code)`)
  await pool.query(`CREATE INDEX IF NOT EXISTS access_codes_tenant_idx ON access_codes(tenant_slug)`)
  // Migration: simpan device fingerprint pemakai kode (single-use) — dipakai dashboard.
  await pool.query(`ALTER TABLE access_codes ADD COLUMN IF NOT EXISTS used_by_fp TEXT`)

  // ── Booth devices: tablet yang sudah di-pair ke tenant ─────────────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booth_devices (
      id SERIAL PRIMARY KEY,
      tenant_slug TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      device_fp TEXT NOT NULL,
      device_name TEXT,
      last_seen_at TIMESTAMPTZ,
      last_ip TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      paired_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (tenant_slug, device_fp)
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS booth_devices_tenant_idx ON booth_devices (tenant_slug)`)

  // ── Subscription payments (Midtrans Snap, self-pay dari dashboard) ─────────
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_payments (
      id          SERIAL PRIMARY KEY,
      tenant_slug TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      order_id    TEXT NOT NULL UNIQUE,
      amount      INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',   -- pending|paid|failed|expired
      snap_token  TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      paid_at     TIMESTAMPTZ
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS subscription_payments_tenant_idx ON subscription_payments (tenant_slug, created_at DESC)`)

  // ── Notifikasi (email + WhatsApp): trial H-3 & masa expired ────────────────
  await pool.query(`ALTER TABLE admin_user ADD COLUMN IF NOT EXISTS phone TEXT`)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id          SERIAL PRIMARY KEY,
      tenant_slug TEXT NOT NULL REFERENCES tenants(slug) ON DELETE CASCADE,
      kind        TEXT NOT NULL,          -- trial_reminder | expired_notice
      channel     TEXT NOT NULL,          -- email | whatsapp
      status      TEXT NOT NULL DEFAULT 'sent',
      sent_at     TIMESTAMPTZ DEFAULT now(),
      UNIQUE (tenant_slug, kind, channel)
    )
  `)

  // ── License secrets: versioned so rotation doesn't break existing codes ───
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

// ──────────────────────── User Session Helpers ────────────────────────
// Separate session namespace for end-users (register/login) — isolated from admin_session
const USER_SESSION_DAYS = 30
const USER_SESSION_DEFAULT_DAYS = 1

export async function createUserSession(userId, remember = false) {
  const token = crypto.randomBytes(32).toString('hex')
  const days = remember ? USER_SESSION_DAYS : USER_SESSION_DEFAULT_DAYS
  const expiresAt = new Date(Date.now() + days * 24 * 3600 * 1000)
  await pool.query(
    'INSERT INTO user_sessions (id, user_id, expires_at, remember) VALUES ($1, $2, $3, $4)',
    [token, userId, expiresAt, remember]
  )
  return token
}

export async function getUserSessionUser(token) {
  if (!token) return null
  const { rows } = await pool.query(
    `SELECT u.id, u.email, u.role, u.tenant_id, u.name, u.active, u.pricing_tier_id, u.code
     FROM user_sessions s JOIN admin_user u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now() LIMIT 1`,
    [token]
  )
  if (!rows[0]) return null
  if (rows[0].active === false) return null
  return {
    id: rows[0].id,
    email: rows[0].email,
    role: rows[0].role,
    tenant_id: rows[0].tenant_id,
    name: rows[0].name,
    pricing_tier_id: rows[0].pricing_tier_id,
    code: rows[0].code
  }
}

export async function destroyUserSession(token) {
  if (!token) return
  await pool.query('DELETE FROM user_sessions WHERE id = $1', [token])
}

// ──────────────────────── Admin Session Helpers ────────────────────────

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

export async function getDesign(id, tenantId = DEFAULT_TENANT) {
  const r = await pool.query('SELECT id, name, frame_data, canvas_w, canvas_h, slots FROM designs WHERE id = $1 AND tenant_id = $2', [id, tenantId])
  if (!r.rows[0]) return null
  const row = r.rows[0]
  let frameBuf = null
  if (row.frame_data) {
    frameBuf = Buffer.isBuffer(row.frame_data) ? row.frame_data.toString('base64') : Buffer.from(row.frame_data).toString('base64')
  }
  return {
    id: row.id,
    name: row.name,
    canvas_w: row.canvas_w,
    canvas_h: row.canvas_h,
    slots: typeof row.slots === 'string' ? JSON.parse(row.slots) : row.slots,
    hasFrame: !!frameBuf,
    frameBuf,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function deleteDesign(id, tenantId = DEFAULT_TENANT) {
  await pool.query('DELETE FROM designs WHERE id = $1 AND tenant_id = $2', [id, tenantId])
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
  if (AUDIT_DISABLED_ACTIONS.has(action)) return
  await pool.query(
    `INSERT INTO admin_audit_log (user_id, tenant_slug, action, target, ip, ua)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, tenantSlug, action, target, ip, ua]
  )
}

// Aksi noise tinggi: tidak tercatat agar log tetap ringkat.
// Hapus entri di sini untuk mengaktifkan kembali pencatatan.
const AUDIT_DISABLED_ACTIONS = new Set([
  'logout',
  'preset_upsert',
  'design_create',
  'design_update',
  'photo_delete',
  'audit_cleanup',
])

export async function listAudit({ limit = 100, offset = 0, tenantSlug = null, userId = null } = {}) {
  const where = []
  const params = []
  if (tenantSlug) { params.push(tenantSlug); where.push(`tenant_slug = $${params.length}`) }
  if (userId) { params.push(userId); where.push(`user_id = $${params.length}`) }
  const sql = `SELECT id, user_id, tenant_slug, action, target, created_at
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

export async function createTenant({ slug, name, accessPin = null, ownerUserId = null, status = 'active', active = true }) {
  const r = await pool.query(
    `INSERT INTO tenants (slug, name, access_pin, owner_user_id, status, active) VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, access_pin = EXCLUDED.access_pin, updated_at = now()
     RETURNING id, slug, name, active, status, access_pin, owner_user_id, created_at, updated_at`,
    [String(slug).toLowerCase().trim(), name, accessPin, ownerUserId, status, active]
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

// ── Approval registrasi vendor ──────────────────────────────────────────────
// Daftar tenant yang masih 'pending' (hasil /api/auth/register) + email pendaftar.
export async function listPendingRegistrations() {
  const r = await pool.query(`
    SELECT t.slug, t.name, t.status, t.created_at,
           u.email AS owner_email, u.name AS owner_name
    FROM tenants t
    LEFT JOIN LATERAL (
      SELECT email, name FROM admin_user
      WHERE tenant_id = t.slug ORDER BY id ASC LIMIT 1
    ) u ON true
    WHERE t.status = 'pending'
    ORDER BY t.created_at DESC
  `)
  return r.rows
}

// Tolak pendaftaran: status 'rejected' + active=false (tenant tetap ada, tidak aktif).
export async function rejectTenantRegistration(slug) {
  const r = await pool.query(
    `UPDATE tenants SET status = 'rejected', active = false, updated_at = now()
     WHERE slug = $1
     RETURNING slug, name, status, active`,
    [slug]
  )
  return r.rows[0] || null
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
  if (search) { params.push(`%${search.toLowerCase()}%`); where.push(`(LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.name, '')) LIKE $${params.length})`) }
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
    `SELECT COUNT(*)::int AS c FROM admin_user u ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
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
  // Tenant pending/rejected = belum aktif → perlakukan seperti tidak aktif (blokir).
  const eff = await getEffectiveTenantStatus(tenantSlug)
  if (eff === 'pending' || eff === 'rejected') {
    return { ok: false, error: 'Tenant belum aktif (menunggu persetujuan admin).' }
  }
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
export async function recordLicenseCode({ code, vendorId, tierSlug, expiresAt, issuedBy, secretVersion = 1, forUserId = null }) {
  const codeHash = hashLicenseCode(code)
  const r = await pool.query(`
    INSERT INTO license_codes (code_hash, code_plain, vendor_id, tier_slug, expires_at, issued_by, secret_version, for_user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    ON CONFLICT (code_hash) DO NOTHING
    RETURNING id, code_hash, vendor_id, tier_slug, expires_at, issued_at, for_user_id
  `, [codeHash, code, vendorId, tierSlug || null, expiresAt, issuedBy || null, secretVersion, forUserId])
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
    SELECT lc.id, lc.code_hash, lc.code_plain, lc.vendor_id, lc.tier_slug, lc.expires_at,
           lc.issued_at, lc.issued_by, u1.email AS issued_by_email,
           lc.redeemed_at, lc.redeemed_by, lc.redeemed_tenant,
           lc.revoked_at, lc.revoked_by, u2.email AS revoked_by_email,
           lc.for_user_id, u3.email AS for_user_email, lc.active,
           COUNT(*) OVER() AS total_count
    FROM license_codes lc
    LEFT JOIN admin_user u1 ON u1.id = lc.issued_by
    LEFT JOIN admin_user u2 ON u2.id = lc.revoked_by
    LEFT JOIN admin_user u3 ON u3.id = lc.for_user_id
    ${where}
    ORDER BY lc.issued_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `, params)
  const total = r.rows.length > 0 ? Number(r.rows[0].total_count) : 0
  return { items: r.rows, total }
}

// List kode aktivasi 6 char (code_plain IS NOT NULL) untuk tabel "Kode Aktivasi" di UI.
// Sengaja dipisah dari listLicenseCodes supaya daftar lama (campur kode HMAC legacy)
// tidak tersentuh. redeemed_by di tabel ini berisi email (TEXT), jadi di-JOIN by email;
// kalau user-nya sudah dihapus, kita fallback ke nilai mentahnya.
export async function listActivationCodes({ limit = 100, offset = 0 } = {}) {
  const r = await pool.query(`
    SELECT lc.id, lc.code_plain, lc.vendor_id, lc.tier_slug, lc.expires_at, lc.active,
           lc.issued_at AS created_at, lc.issued_at,
           lc.redeemed_at, lc.redeemed_tenant,
           COALESCE(u_redeem.email, lc.redeemed_by) AS redeemed_by_email,
           u_redeemed.email AS redeemed_user_email,
           u_for.email AS for_user_email,
           lc.for_user_id, lc.redeemed_user_id, lc.secret_version,
           COUNT(*) OVER() AS total_count
    FROM license_codes lc
    LEFT JOIN admin_user u_redeem   ON u_redeem.email = lc.redeemed_by
    LEFT JOIN admin_user u_redeemed ON u_redeemed.id = lc.redeemed_user_id
    LEFT JOIN admin_user u_for      ON u_for.id = lc.for_user_id
    WHERE lc.code_plain IS NOT NULL
    ORDER BY lc.issued_at DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset])
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
// userId is optional (for binding to pre-existing user)
export async function markLicenseRedeemed({ code, userEmail, tenantSlug, userId = null }) {
  const codeHash = hashLicenseCode(code)
  const r = await pool.query(`
    UPDATE license_codes
    SET active = false, redeemed_at = now(),
        redeemed_by = $2, redeemed_tenant = $3, redeemed_user_id = $4
    WHERE code_hash = $1 AND active = true
    RETURNING id
  `, [codeHash, userEmail, tenantSlug, userId])
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

// ──────────────────────── Access Code Helpers ────────────────────────
// Kode 6 karakter alfanumerik per tenant untuk pairing tablet (bukan license HMAC).
// Charset tanpa karakter ambigu: I, O, 0, 1 dibuang.
const ACCESS_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

// Generate 6 char acak pakai crypto (bukan Math.random) — selalu UPPERCASE.
export function randomAccessCode() {
  const chars = []
  for (let i = 0; i < 6; i++) {
    chars.push(ACCESS_CODE_CHARSET[crypto.randomInt(0, ACCESS_CODE_CHARSET.length)])
  }
  return chars.join('')
}

// Normalisasi input kode: buang whitespace + uppercase. Kode disimpan UPPERCASE,
// jadi lookup/compare harus dinormalisasi dulu.
export function normalizeAccessCode(code) {
  return String(code ?? '').replace(/\s+/g, '').toUpperCase()
}

export async function generateAccessCode(tenantSlug, { expiry = null } = {}) {
  // Generate unique 6-char code; retry kalau tabrakan.
  let code = ''
  for (let attempt = 0; attempt < 20; attempt++) {
    code = randomAccessCode()
    const dup = await pool.query('SELECT 1 FROM access_codes WHERE code = $1', [code])
    if (!dup.rows.length) break
  }
  const expiresAt = expiry || new Date(Date.now() + 7 * 24 * 3600 * 1000) // default 7 days
  const r = await pool.query(
    `INSERT INTO access_codes (tenant_slug, code, expires_at) VALUES ($1, $2, $3)
     ON CONFLICT (code) DO NOTHING RETURNING id, tenant_slug, code, expires_at`,
    [tenantSlug, code, expiresAt]
  )
  // Kalau tabrakan (sangat jarang), coba lagi.
  if (!r.rows[0]) return generateAccessCode(tenantSlug, { expiry })
  return r.rows[0]
}

export async function validateAccessCode(code) {
  const norm = normalizeAccessCode(code)
  if (!norm) return null
  const r = await pool.query(
    `SELECT ac.id, ac.tenant_slug, ac.code, ac.active, ac.expires_at, ac.used_at, ac.used_by_fp,
            t.name, t.status, t.trial_ends_at, t.subscription_ends_at, t.grace_period_ends_at, t.active AS tenant_active
     FROM access_codes ac
     JOIN tenants t ON t.slug = ac.tenant_slug
     WHERE ac.code = $1`,
    [norm]
  )
  if (!r.rows[0]) return null
  const row = r.rows[0]
  // Single-use: kode sudah pernah dipakai → tolak (kode lama active=false + used_at terisi).
  if (row.used_at) return { ...row, used: true, error: 'Kode sudah digunakan' }
  if (row.active === false) return { ...row, error: 'Kode akses tidak valid' }
  // Check expiry
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { ...row, error: 'Kode akses sudah kedaluwarsa' }
  // Check tenant status
  if (row.tenant_active === false) return { ...row, error: 'Tenant tidak aktif' }
  // Status efektif dihitung dari timestamp (trial/active yang lewat tenggat → expired/suspended).
  const eff = await getEffectiveTenantStatus(row.tenant_slug)
  // Tenant hasil registrasi yang belum di-approve (pending) / ditolak → booth diblokir.
  if (eff === 'pending') return { ...row, error: 'Pendaftaran masih menunggu persetujuan admin' }
  if (eff === 'rejected') return { ...row, error: 'Pendaftaran ditolak' }
  if (eff === 'suspended') return { ...row, error: 'Tenant diblokir' }
  if (eff === 'expired') return { ...row, error: 'Langganan berakhir, silakan perpanjang' }
  return { ...row, status: eff || row.status }
}

// Tandai kode sebagai terpakai (single-use): used_at + active=false. deviceFp opsional.
export async function markAccessCodeUsed(id, { deviceFp = null } = {}) {
  await pool.query(
    `UPDATE access_codes SET used_at = now(), active = false,
            used_by_fp = COALESCE($2, used_by_fp)
     WHERE id = $1`,
    [id, deviceFp]
  )
}

export async function listActiveAccessCodes(tenantSlug) {
  const r = await pool.query(
    `SELECT id, tenant_slug, code, expires_at, used_at, used_by_fp, created_at
     FROM access_codes WHERE tenant_slug = $1 AND active = true ORDER BY created_at DESC`,
    [tenantSlug]
  )
  return r.rows
}

export async function deactivateAccessCode(id) {
  await pool.query('UPDATE access_codes SET active = false WHERE id = $1', [id])
}

// ──────────────────────── Booth Device Helpers ────────────────────────
// Device tablet yang sudah di-pair ke tenant (hasil dari kode akses single-use).

export async function upsertBoothDevice({ tenantSlug, deviceFp, ip = null, name = null }) {
  if (!tenantSlug || !deviceFp) return null
  const r = await pool.query(
    `INSERT INTO booth_devices (tenant_slug, device_fp, device_name, last_seen_at, last_ip, is_active)
     VALUES ($1, $2, $3, now(), $4, true)
     ON CONFLICT (tenant_slug, device_fp)
     DO UPDATE SET is_active = true, last_seen_at = now(), last_ip = EXCLUDED.last_ip,
                   device_name = COALESCE(EXCLUDED.device_name, booth_devices.device_name)
     RETURNING id, tenant_slug, device_fp, device_name, last_seen_at, last_ip, is_active, paired_at`,
    [tenantSlug, deviceFp, name, ip]
  )
  return r.rows[0] || null
}

export async function listBoothDevices(tenantSlug) {
  const r = await pool.query(
    `SELECT id, device_fp, device_name, last_seen_at, last_ip, is_active, paired_at
     FROM booth_devices WHERE tenant_slug = $1 ORDER BY paired_at DESC, id DESC`,
    [tenantSlug]
  )
  return r.rows
}

export async function deactivateBoothDevice(tenantSlug, id) {
  await pool.query(
    'UPDATE booth_devices SET is_active = false WHERE tenant_slug = $1 AND id = $2',
    [tenantSlug, id]
  )
}

export async function getBoothDevice(tenantSlug, deviceFp) {
  if (!tenantSlug || !deviceFp) return null
  const r = await pool.query(
    `SELECT id, tenant_slug, device_fp, device_name, last_seen_at, last_ip, is_active, paired_at
     FROM booth_devices WHERE tenant_slug = $1 AND device_fp = $2`,
    [tenantSlug, deviceFp]
  )
  return r.rows[0] || null
}

// Update last_seen saja; no-op kalau row belum ada (belum di-pair).
export async function touchBoothDevice(tenantSlug, deviceFp) {
  if (!tenantSlug || !deviceFp) return
  await pool.query(
    'UPDATE booth_devices SET last_seen_at = now() WHERE tenant_slug = $1 AND device_fp = $2',
    [tenantSlug, deviceFp]
  )
}

// ──────────────────────── Tenant Subscription Helpers ────────────────────────
// Status machine: pending → trial → active → expired → suspended (rejected = mati)
// Trial: TRIAL_DAYS (default 3). Grace after expired: GRACE_DAYS (default 3).

export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 3)
export const GRACE_DAYS = Number(process.env.GRACE_DAYS || 3)

// Mark a tenant as on trial: set status='trial' + active=true + trial_ends_at = now + TRIAL_DAYS
export async function startTenantTrial(tenantSlug) {
  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000)
  await pool.query(
    `UPDATE tenants SET active = true, status = 'trial', trial_ends_at = $2, subscription_ends_at = NULL, grace_period_ends_at = NULL, updated_at = now() WHERE slug = $1`,
    [tenantSlug, trialEnds]
  )
  return trialEnds
}

// Approve pendaftaran vendor: aktifkan tenant + mulai trial dalam SATU transaksi atomik.
// Idempotent: dipanggil berulang kali menghasilkan state trial yang sama (trial_ends_at di-reset).
export async function approveTenantRegistration(slug) {
  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 24 * 3600 * 1000)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      `UPDATE tenants
       SET active = true, status = 'trial', trial_ends_at = $2,
           subscription_ends_at = NULL, grace_period_ends_at = NULL, updated_at = now()
       WHERE slug = $1
       RETURNING slug, name, status, active, trial_ends_at`,
      [slug, trialEnds]
    )
    await client.query('COMMIT')
    return rows[0] || null
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}

// Activate subscription: status='active', subscription_ends_at = now + days
export async function activateTenantSubscription(tenantSlug, days = 30) {
  const endsAt = new Date(Date.now() + days * 24 * 3600 * 1000)
  await pool.query(
    `UPDATE tenants SET status = 'active', subscription_ends_at = $2, grace_period_ends_at = NULL, updated_at = now() WHERE slug = $1`,
    [tenantSlug, endsAt]
  )
  return endsAt
}

// Extend trial (super_admin action): reset trial_ends_at = now + days
export async function extendTenantTrial(tenantSlug, days = TRIAL_DAYS) {
  const endsAt = new Date(Date.now() + days * 24 * 3600 * 1000)
  await pool.query(
    `UPDATE tenants SET status = 'trial', trial_ends_at = $2, updated_at = now() WHERE slug = $1`,
    [tenantSlug, endsAt]
  )
  return endsAt
}

// Force suspend (super_admin action)
export async function suspendTenant(tenantSlug) {
  await pool.query(`UPDATE tenants SET status = 'suspended', updated_at = now() WHERE slug = $1`, [tenantSlug])
}

// Reactivate tenant (super_admin action): set to active with fresh subscription_ends_at
export async function reactivateTenant(tenantSlug, days = 30) {
  const endsAt = new Date(Date.now() + days * 24 * 3600 * 1000)
  await pool.query(
    `UPDATE tenants SET status = 'active', subscription_ends_at = $2, grace_period_ends_at = NULL, updated_at = now() WHERE slug = $1`,
    [tenantSlug, endsAt]
  )
  return endsAt
}

export async function getTenantSubscription(slug) {
  const r = await pool.query(
    `SELECT slug, status, trial_ends_at, subscription_ends_at, grace_period_ends_at, created_at
     FROM tenants WHERE slug = $1`,
    [slug]
  )
  return r.rows[0] || null
}

// Status efektif tenant — hitung dari timestamps tanpa nunggu cron hourly.
// trial/active yang lewat tenggat → 'expired'. Lewat masa grace → 'suspended'.
// Status lain (mis. 'suspended' manual / 'expired') dikembalikan apa adanya.
export async function getEffectiveTenantStatus(slug) {
  const sub = await getTenantSubscription(slug)
  if (!sub) return null
  const now = Date.now()
  const ts = (v) => (v ? new Date(v).getTime() : null)
  const graceEnd = ts(sub.grace_period_ends_at)
  if (graceEnd && graceEnd < now && ['trial', 'active', 'expired'].includes(sub.status)) {
    return 'suspended'
  }
  if (sub.status === 'trial' && ts(sub.trial_ends_at) && ts(sub.trial_ends_at) < now) return 'expired'
  if (sub.status === 'active' && ts(sub.subscription_ends_at) && ts(sub.subscription_ends_at) < now) return 'expired'
  return sub.status
}

// Scheduled job: run periodically to transition expired tenants
export async function runSubscriptionCheck() {
  const now = new Date()
  let updated = 0
  // 1. trial → expired (trial_ends_at passed)
  const trialExp = await pool.query(
    `UPDATE tenants SET status='expired', grace_period_ends_at = now() + ($2 || ' days')::interval
     WHERE status='trial' AND trial_ends_at < $1 AND trial_ends_at IS NOT NULL
     RETURNING slug`,
    [now, GRACE_DAYS]
  )
  updated += trialExp.rowCount || 0
  // 2. active → expired (subscription_ends_at passed)
  const activeExp = await pool.query(
    `UPDATE tenants SET status='expired', grace_period_ends_at = now() + ($2 || ' days')::interval
     WHERE status='active' AND subscription_ends_at < $1 AND subscription_ends_at IS NOT NULL
     RETURNING slug`,
    [now, GRACE_DAYS]
  )
  updated += activeExp.rowCount || 0
  // 3. expired → suspended (grace_period_ends_at passed)
  const graceExp = await pool.query(
    `UPDATE tenants SET status='suspended'
     WHERE status='expired' AND grace_period_ends_at IS NOT NULL AND grace_period_ends_at < $1
     RETURNING slug`,
    [now]
  )
  updated += graceExp.rowCount || 0
  return { updated }
}

// ──────────────────────── Subscription Payments (Midtrans) ──────────────────

export async function createSubscriptionPayment({ tenantSlug, orderId, amount, snapToken = null }) {
  const r = await pool.query(
    `INSERT INTO subscription_payments (tenant_slug, order_id, amount, status, snap_token)
     VALUES ($1, $2, $3, 'pending', $4)
     RETURNING id, tenant_slug, order_id, amount, status, snap_token, created_at`,
    [tenantSlug, orderId, amount, snapToken]
  )
  return r.rows[0] || null
}

export async function setSubscriptionPaymentSnapToken(orderId, snapToken) {
  await pool.query('UPDATE subscription_payments SET snap_token = $2 WHERE order_id = $1', [orderId, snapToken])
}

export async function getSubscriptionPayment(orderId) {
  const r = await pool.query(
    `SELECT id, tenant_slug, order_id, amount, status, snap_token, created_at, paid_at
     FROM subscription_payments WHERE order_id = $1`,
    [orderId]
  )
  return r.rows[0] || null
}

// Idempotent: hanya transisi pending/failed → paid. Return null kalau sudah paid.
export async function markSubscriptionPaymentPaid(orderId) {
  const r = await pool.query(
    `UPDATE subscription_payments SET status = 'paid', paid_at = now()
     WHERE order_id = $1 AND status <> 'paid'
     RETURNING tenant_slug, amount`,
    [orderId]
  )
  return r.rows[0] || null
}

export async function markSubscriptionPaymentFailed(orderId) {
  const r = await pool.query(
    `UPDATE subscription_payments SET status = 'failed'
     WHERE order_id = $1 AND status = 'pending'
     RETURNING id`,
    [orderId]
  )
  return r.rows[0] || null
}

// ──────────────────────── Notifikasi (Email + WhatsApp) ─────────────────────

const PB_APP_URL = process.env.PB_APP_URL || 'https://app.achipix.web.id'
const NOTIFY_WINDOW_DAYS = 3

// Kontak owner tenant: prioritas owner_user_id, fallback user dengan tenant_id sama.
export async function getTenantOwnerContact(tenantSlug) {
  const r = await pool.query(
    `SELECT COALESCE(o.email, u.email) AS email,
            COALESCE(o.phone, u.phone) AS phone,
            COALESCE(o.name, u.name) AS name,
            t.name AS tenant_name
     FROM tenants t
     LEFT JOIN admin_user o ON o.id = t.owner_user_id
     LEFT JOIN LATERAL (
       SELECT email, phone, name FROM admin_user
       WHERE tenant_id = t.slug ORDER BY id ASC LIMIT 1
     ) u ON true
     WHERE t.slug = $1`,
    [tenantSlug]
  )
  return r.rows[0] || null
}

function fmtDateID(d) {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return '-'
  }
}

function buildNotificationMessage(kind, { tenantName, trialEndsAt, daysLeft }) {
  const dash = `${PB_APP_URL}/#/`
  if (kind === 'trial_reminder') {
    return `Halo ${tenantName || 'Kak'}! 👋\n\nMasa trial Achipix kamu tinggal ${daysLeft} hari lagi (berakhir ${fmtDateID(trialEndsAt)}).\nYuk perpanjang sekarang biar booth-nya nggak mati mendadak: ${dash}\n\nKalau butuh bantuan, balas pesan ini ya.`
  }
  return `Halo ${tenantName || 'Kak'}, masa langganan Achipix kamu sudah berakhir 😔\n\nTenant ${tenantName || ''} sekarang nggak bisa dipakai sampai diperpanjang. Aktifkan lagi di dashboard: ${dash}\n\nMakasih sudah pakai Achipix!`
}

// Best-effort email via nodemailer (dynamic import agar server tetap jalan
// meski dependency belum ter-install / SMTP belum diisi).
async function sendEmailNotification({ to, subject, text }) {
  const host = process.env.SMTP_HOST
  const port = process.env.SMTP_PORT
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  const from = process.env.SMTP_FROM || user
  if (!host || !port || !user || !pass || !from) {
    console.log('[notify] SMTP belum dikonfigurasi — email dilewati')
    return { ok: false, skipped: true }
  }
  try {
    const nodemailer = await import('nodemailer')
    const transport = nodemailer.default.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: { user, pass },
    })
    await transport.sendMail({ from, to, subject, text })
    return { ok: true }
  } catch (e) {
    console.error('[notify] email gagal:', e.message)
    return { ok: false, error: e.message }
  }
}

// Best-effort WhatsApp via Fonnte-compatible HTTP API.
async function sendWhatsAppNotification({ phone, message }) {
  const url = process.env.WA_API_URL || 'https://api.fonnte.com/send'
  const token = process.env.WA_TOKEN
  if (!token) {
    console.log('[notify] WA belum dikonfigurasi — whatsapp dilewati')
    return { ok: false, skipped: true }
  }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
      body: JSON.stringify({ target: phone, message }),
    })
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
    return { ok: true }
  } catch (e) {
    console.error('[notify] WA gagal:', e.message)
    return { ok: false, error: e.message }
  }
}

// Kirim 1 notifikasi per (tenant, kind, channel) dengan dedupe UNIQUE.
// INSERT dulu; kalau konflik → sudah pernah dikirim, skip. Gagal kirim → status 'failed'.
async function deliverNotification({ tenantSlug, kind, channel, contact, subject, text }) {
  const ins = await pool.query(
    `INSERT INTO notifications (tenant_slug, kind, channel, status, sent_at)
     VALUES ($1, $2, $3, 'sent', now())
     ON CONFLICT (tenant_slug, kind, channel) DO NOTHING
     RETURNING id`,
    [tenantSlug, kind, channel]
  )
  if (!ins.rows[0]) return { skipped: true }

  let result
  if (channel === 'email') {
    if (!contact?.email) result = { ok: false, skipped: true }
    else result = await sendEmailNotification({ to: contact.email, subject, text })
  } else {
    if (!contact?.phone) result = { ok: false, skipped: true }
    else result = await sendWhatsAppNotification({ phone: contact.phone, message: text })
  }
  if (!result.ok) {
    await pool.query(`UPDATE notifications SET status = 'failed' WHERE id = $1`, [ins.rows[0].id])
    return { failed: true }
  }
  return { sent: true }
}

// Cron: reminder trial H-3 + notice saat tenant baru expired.
// Dipanggil dari serve.mjs SETELAH runSubscriptionCheck().
export async function runNotifications() {
  const out = { sent: 0, failed: 0, skipped: 0 }
  let trialRows = []
  let expiredRows = []
  try {
    trialRows = (await pool.query(
      `SELECT slug, name, trial_ends_at FROM tenants
       WHERE status = 'trial' AND trial_ends_at IS NOT NULL
         AND trial_ends_at > now() AND trial_ends_at <= now() + ($1 || ' days')::interval`,
      [NOTIFY_WINDOW_DAYS]
    )).rows
  } catch (e) {
    console.error('[notify] query trial error:', e.message)
  }
  try {
    // Status 'expired' di-set oleh runSubscriptionCheck saat trial/langganan lewat.
    expiredRows = (await pool.query(
      `SELECT slug, name, subscription_ends_at, trial_ends_at FROM tenants WHERE status = 'expired'`
    )).rows
  } catch (e) {
    console.error('[notify] query expired error:', e.message)
  }

  for (const t of trialRows) {
    const contact = await getTenantOwnerContact(t.slug)
    const daysLeft = Math.max(0, Math.ceil((new Date(t.trial_ends_at).getTime() - Date.now()) / 86400000))
    const text = buildNotificationMessage('trial_reminder', { tenantName: t.name, trialEndsAt: t.trial_ends_at, daysLeft })
    const subject = `Trial Achipix tinggal ${daysLeft} hari lagi`
    for (const channel of ['email', 'whatsapp']) {
      const r = await deliverNotification({ tenantSlug: t.slug, kind: 'trial_reminder', channel, contact, subject, text })
      if (r.sent) out.sent++
      else if (r.failed) out.failed++
      else out.skipped++
    }
  }

  for (const t of expiredRows) {
    const contact = await getTenantOwnerContact(t.slug)
    const endAt = t.subscription_ends_at || t.trial_ends_at
    const text = buildNotificationMessage('expired_notice', { tenantName: t.name, trialEndsAt: endAt })
    const subject = 'Langganan Achipix berakhir — aktifkan lagi yuk'
    for (const channel of ['email', 'whatsapp']) {
      const r = await deliverNotification({ tenantSlug: t.slug, kind: 'expired_notice', channel, contact, subject, text })
      if (r.sent) out.sent++
      else if (r.failed) out.failed++
      else out.skipped++
    }
  }
  return out
}

export default pool
