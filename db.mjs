// Postgres layer for photobooth-receipt (Express replaced by combined server).
// Uses the existing local Postgres (postgres-kontrakan) with a dedicated
// database + role so it never touches the kontrakan data.
import pg from 'pg'
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
  `)
  console.log('[db] schema ready')
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

export default pool
