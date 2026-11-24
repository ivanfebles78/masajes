// Acceso a PostgreSQL. En producción usa `pg` con DATABASE_URL; sin ella
// (desarrollo y tests) arranca un Postgres embebido (PGlite) para no depender
// de un servidor local.
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import {
  AJUSTES_POR_DEFECTO,
  AJUSTES_RENOMBRADOS,
  HORARIO_POR_DEFECTO,
  USUARIO_ADMIN,
} from './config.js';

const COSTE_BCRYPT = 12;
const TIEMPO_CONEXION_MS = 5000;
const TIEMPO_CONSULTA_MS = 10_000;

async function conectarPg(databaseUrl, env) {
  const { default: pg } = await import('pg');
  // Railway en red privada no usa SSL; se activa con PGSSL=true si hace falta.
  const ssl = env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl,
    max: 10,
    connectionTimeoutMillis: TIEMPO_CONEXION_MS,
    statement_timeout: TIEMPO_CONSULTA_MS,
  });
  pool.on('error', (err) => console.error('[bd] error en conexión inactiva:', err.message));
  return {
    query: (texto, params = []) => pool.query(texto, params),
    exec: (sql) => pool.query(sql),
    async transaccion(tarea) {
      const cliente = await pool.connect();
      try {
        await cliente.query('BEGIN');
        const resultado = await tarea({ query: (texto, params = []) => cliente.query(texto, params) });
        await cliente.query('COMMIT');
        return resultado;
      } catch (err) {
        await cliente.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        cliente.release();
      }
    },
    cerrar: () => pool.end(),
  };
}

async function conectarEmbebida(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  const pglite = new PGlite(dataDir || undefined);
  await pglite.waitReady;
  return {
    query: (texto, params = []) => pglite.query(texto, params),
    exec: (sql) => pglite.exec(sql),
    transaccion: (tarea) =>
      pglite.transaction((tx) => tarea({ query: (texto, params = []) => tx.query(texto, params) })),
    cerrar: () => pglite.close(),
  };
}

export async function conectarBD(env = process.env) {
  if (env.DATABASE_URL) return conectarPg(env.DATABASE_URL, env);
  if (env.NODE_ENV === 'production') {
    throw new Error('Falta DATABASE_URL: en producción es obligatoria.');
  }
  console.warn('[bd] Sin DATABASE_URL: usando Postgres embebido (solo desarrollo).');
  return conectarEmbebida(env.PGLITE_DIR);
}

// La contraseña inicial nunca vive en el código: llega por el entorno
// (ADMIN_PASSWORD o ADMIN_PASSWORD_HASH) y se guarda siempre hasheada.
async function hashAdminInicial(env) {
  if (env.ADMIN_PASSWORD_HASH) return env.ADMIN_PASSWORD_HASH;
  if (env.ADMIN_PASSWORD) return bcrypt.hash(env.ADMIN_PASSWORD, COSTE_BCRYPT);
  if (env.NODE_ENV === 'production') {
    throw new Error('Falta ADMIN_PASSWORD (o ADMIN_PASSWORD_HASH) para crear el usuario «admin».');
  }
  const temporal = randomBytes(9).toString('base64url');
  console.warn(`[admin] Sin ADMIN_PASSWORD: contraseña temporal de desarrollo para «admin»: ${temporal}`);
  return bcrypt.hash(temporal, COSTE_BCRYPT);
}

// Se ejecuta una sola vez: el horario sembrado por la primera versión cerraba
// a las 19:30; con la jornada continua la tarde de lunes a viernes acaba a las 19:00.
async function migrarHorarioContinuo(db) {
  const marca = 'migracion_horario_continuo';
  const hecha = await db.query('SELECT 1 FROM ajustes WHERE clave = $1', [marca]);
  if (hecha.rows.length > 0) return;
  await db.query(
    `UPDATE horario SET fin = '19:00'
     WHERE turno = 'tarde' AND inicio = '16:30' AND fin = '19:30'`,
  );
  await db.query('INSERT INTO ajustes (clave, valor) VALUES ($1, $2)', [marca, '1']);
}

async function sembrar(db, env) {
  const admins = await db.query('SELECT 1 FROM administradores LIMIT 1');
  if (admins.rows.length === 0) {
    await db.query('INSERT INTO administradores (usuario, clave_hash) VALUES ($1, $2)', [
      USUARIO_ADMIN,
      await hashAdminInicial(env),
    ]);
  }

  for (const h of HORARIO_POR_DEFECTO) {
    await db.query(
      `INSERT INTO horario (dia_semana, turno, inicio, fin, activo)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (dia_semana, turno) DO NOTHING`,
      [h.dia_semana, h.turno, h.inicio, h.fin, h.activo],
    );
  }

  await migrarHorarioContinuo(db);

  for (const [clave, valor] of Object.entries(AJUSTES_POR_DEFECTO)) {
    await db.query(
      'INSERT INTO ajustes (clave, valor) VALUES ($1, $2) ON CONFLICT (clave) DO NOTHING',
      [clave, valor],
    );
  }

  for (const { clave, antes, ahora } of AJUSTES_RENOMBRADOS) {
    for (const viejo of antes) {
      await db.query('UPDATE ajustes SET valor = $1 WHERE clave = $2 AND valor = $3', [ahora, clave, viejo]);
    }
  }
}

export async function prepararBD(db, env = process.env) {
  const esquema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await db.exec(esquema);
  await sembrar(db, env);
}

export { COSTE_BCRYPT };
