// API de administración: sesión, citas, horario, días bloqueados y ajustes.
import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { COSTE_BCRYPT } from '../db.js';
import {
  ErrorValidacion,
  validarAjustes,
  validarBloqueo,
  validarCambioClave,
  validarHorario,
} from '../validacion.js';
import { leerAjustes, leerHorario } from '../servicio.js';
import { ahoraEnSalon, esFechaValida, sumarDias } from '../slots.js';

const VENTANA_LOGIN_MS = 15 * 60 * 1000;
const MAX_INTENTOS_LOGIN = 10;
const DIAS_LISTADO = 60;
const MAX_DIAS_LISTADO = 400;
// Hash de relleno para que el login tarde lo mismo exista o no el usuario.
const HASH_SENUELO = bcrypt.hashSync(randomBytes(16).toString('hex'), COSTE_BCRYPT);

async function buscarAdmin(db, usuario) {
  const { rows } = await db.query(
    'SELECT id, usuario, clave_hash, version_clave FROM administradores WHERE usuario = $1',
    [usuario],
  );
  return rows[0] ?? null;
}

export function rutasAdmin({ db, ahora, limitar }) {
  const router = Router();

  const limiteLogin = limitar
    ? rateLimit({
        windowMs: VENTANA_LOGIN_MS,
        limit: MAX_INTENTOS_LOGIN,
        skipSuccessfulRequests: true,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        message: { ok: false, error: 'Demasiados intentos. Espera unos minutos.' },
      })
    : (_req, _res, next) => next();

  async function exigirAdmin(req, res, next) {
    const sesion = req.session;
    if (!sesion?.adminId) return res.status(401).json({ ok: false, error: 'Sesión no iniciada.' });
    const { rows } = await db.query(
      'SELECT usuario, version_clave FROM administradores WHERE id = $1',
      [sesion.adminId],
    );
    // Un cambio de contraseña invalida las sesiones anteriores.
    if (!rows[0] || rows[0].version_clave !== sesion.version) {
      req.session = null;
      return res.status(401).json({ ok: false, error: 'Sesión caducada.' });
    }
    req.admin = { id: sesion.adminId, usuario: rows[0].usuario };
    next();
  }

  router.post('/login', limiteLogin, async (req, res) => {
    const usuario = typeof req.body?.usuario === 'string' ? req.body.usuario.trim() : '';
    const clave = typeof req.body?.clave === 'string' ? req.body.clave : '';
    const admin = usuario ? await buscarAdmin(db, usuario) : null;
    // Se compara siempre contra un hash para no delatar si el usuario existe.
    const coincide = await bcrypt.compare(clave, admin?.clave_hash ?? HASH_SENUELO);
    if (!admin || !coincide) {
      return res.status(401).json({ ok: false, error: 'Usuario o contraseña incorrectos.' });
    }
    req.session = { adminId: admin.id, version: admin.version_clave };
    res.json({ ok: true, data: { usuario: admin.usuario } });
  });

  router.post('/logout', (req, res) => {
    req.session = null;
    res.json({ ok: true });
  });

  router.use(exigirAdmin);

  router.get('/sesion', (req, res) => {
    res.json({ ok: true, data: { usuario: req.admin.usuario } });
  });

  router.get('/citas', async (req, res) => {
    const hoy = ahoraEnSalon(ahora()).fecha;
    const desde = esFechaValida(req.query.desde) ? req.query.desde : hoy;
    const hastaPedido = esFechaValida(req.query.hasta) ? req.query.hasta : sumarDias(desde, DIAS_LISTADO);
    const tope = sumarDias(desde, MAX_DIAS_LISTADO);
    const hasta = hastaPedido > tope ? tope : hastaPedido;
    const { rows } = await db.query(
      `SELECT c.id, to_char(c.fecha, 'YYYY-MM-DD') AS fecha, c.hora, c.turno, c.servicio, c.duracion_min, c.nombre,
              c.telefono, c.email, c.canal, c.estado,
              COALESCE((
                SELECT json_agg(json_build_object('canal', n.canal, 'estado', n.estado) ORDER BY n.id)
                FROM notificaciones n WHERE n.cita_id = c.id
              ), '[]'::json) AS avisos
       FROM citas c
       WHERE c.fecha BETWEEN $1 AND $2
       ORDER BY c.fecha, c.hora, c.id`,
      [desde, hasta],
    );
    res.json({ ok: true, data: { desde, hasta, citas: rows } });
  });

  router.post('/citas/:id/cancelar', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ErrorValidacion('Cita no válida.');
    const { rows } = await db.query(
      "UPDATE citas SET estado = 'cancelada' WHERE id = $1 AND estado = 'confirmada' RETURNING id",
      [id],
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, error: 'La cita no existe o ya estaba cancelada.' });
    res.json({ ok: true });
  });

  router.get('/horario', async (_req, res) => {
    res.json({ ok: true, data: { horario: await leerHorario(db) } });
  });

  router.put('/horario', async (req, res) => {
    const filas = validarHorario(req.body);
    await db.transaccion(async (tx) => {
      for (const f of filas) {
        await tx.query(
          `INSERT INTO horario (dia_semana, turno, inicio, fin, activo) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (dia_semana, turno)
           DO UPDATE SET inicio = EXCLUDED.inicio, fin = EXCLUDED.fin, activo = EXCLUDED.activo`,
          [f.dia_semana, f.turno, f.inicio, f.fin, f.activo],
        );
      }
    });
    res.json({ ok: true, data: { horario: await leerHorario(db) } });
  });

  router.get('/bloqueos', async (_req, res) => {
    const hoy = ahoraEnSalon(ahora()).fecha;
    const { rows } = await db.query(
      `SELECT id, to_char(fecha, 'YYYY-MM-DD') AS fecha, turno, motivo
       FROM dias_bloqueados WHERE fecha >= $1 ORDER BY fecha, turno NULLS FIRST`,
      [hoy],
    );
    res.json({ ok: true, data: { bloqueos: rows } });
  });

  router.post('/bloqueos', async (req, res) => {
    const b = validarBloqueo(req.body);
    await db.query('INSERT INTO dias_bloqueados (fecha, turno, motivo) VALUES ($1, $2, $3)', [
      b.fecha, b.turno, b.motivo,
    ]);
    res.status(201).json({ ok: true });
  });

  router.delete('/bloqueos/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ErrorValidacion('Bloqueo no válido.');
    await db.query('DELETE FROM dias_bloqueados WHERE id = $1', [id]);
    res.json({ ok: true });
  });

  router.get('/ajustes', async (_req, res) => {
    res.json({ ok: true, data: { ajustes: await leerAjustes(db) } });
  });

  router.put('/ajustes', async (req, res) => {
    const cambios = validarAjustes(req.body);
    for (const [clave, valor] of Object.entries(cambios)) {
      await db.query(
        `INSERT INTO ajustes (clave, valor) VALUES ($1, $2)
         ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
        [clave, valor],
      );
    }
    res.json({ ok: true, data: { ajustes: await leerAjustes(db) } });
  });

  router.put('/clave', limiteLogin, async (req, res) => {
    const { actual, nueva } = validarCambioClave(req.body);
    const admin = await buscarAdmin(db, req.admin.usuario);
    if (!admin || !(await bcrypt.compare(actual, admin.clave_hash))) {
      throw new ErrorValidacion('La contraseña actual no es correcta.', 'actual');
    }
    const { rows } = await db.query(
      `UPDATE administradores SET clave_hash = $1, version_clave = version_clave + 1
       WHERE id = $2 RETURNING version_clave`,
      [await bcrypt.hash(nueva, COSTE_BCRYPT), admin.id],
    );
    req.session = { adminId: admin.id, version: rows[0].version_clave };
    res.json({ ok: true });
  });

  return router;
}
