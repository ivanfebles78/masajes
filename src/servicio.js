// Reglas de negocio: disponibilidad y creación de citas.
import { AJUSTES_POR_DEFECTO, LIMITES } from './config.js';
import {
  aMinutos,
  ahoraEnSalon,
  diaSemanaISO,
  diasEntre,
  huecosLibres,
} from './slots.js';

const COD_DUPLICADO = '23505';

export class ErrorHuecoOcupado extends Error {
  constructor() {
    super('Ese hueco acaba de reservarse. Elige otro, por favor.');
    this.status = 409;
  }
}

export class ErrorDemasiadasCitas extends Error {
  constructor() {
    super('Ya tienes varias citas pendientes con estos datos. Llámanos si necesitas otra.');
    this.status = 429;
  }
}

/** Citas confirmadas, de hoy en adelante, con el mismo teléfono o correo. */
async function citasActivasDeContacto(db, { telefono, email }, hoy) {
  const { rows } = await db.query(
    `SELECT count(*)::int AS total FROM citas
     WHERE estado = 'confirmada' AND fecha >= $1
       AND (($2::text IS NOT NULL AND telefono = $2) OR ($3::text IS NOT NULL AND email = $3))`,
    [hoy, telefono, email],
  );
  return rows[0].total;
}

export async function leerAjustes(db) {
  const { rows } = await db.query('SELECT clave, valor FROM ajustes');
  const crudos = { ...AJUSTES_POR_DEFECTO, ...Object.fromEntries(rows.map((r) => [r.clave, r.valor])) };
  return {
    nombre_salon: crudos.nombre_salon,
    direccion: crudos.direccion,
    telefono_salon: crudos.telefono_salon,
    antelacion_horas: Number(crudos.antelacion_horas),
    max_dias: Number(crudos.max_dias),
  };
}

export async function leerHorario(db) {
  const { rows } = await db.query(
    'SELECT dia_semana, turno, inicio, fin, activo FROM horario ORDER BY dia_semana, turno',
  );
  return rows;
}

async function estaBloqueado(db, fecha, turno) {
  const { rows } = await db.query(
    'SELECT 1 FROM dias_bloqueados WHERE fecha = $1 AND (turno IS NULL OR turno = $2) LIMIT 1',
    [fecha, turno],
  );
  return rows.length > 0;
}

async function citasDelDia(db, fecha) {
  const { rows } = await db.query(
    "SELECT hora, duracion_min FROM citas WHERE fecha = $1 AND estado = 'confirmada'",
    [fecha],
  );
  return rows.map((r) => {
    const inicio = aMinutos(r.hora);
    return { inicio, fin: inicio + r.duracion_min };
  });
}

/**
 * Huecos libres de un día y turno concretos. Nunca devuelve la ocupación de
 * otros turnos: el cliente solo ve lo que ha pedido.
 */
export async function disponibilidad(db, { fecha, turno, duracion }, instante = new Date()) {
  const ajustes = await leerAjustes(db);
  const ahora = ahoraEnSalon(instante);
  const distancia = diasEntre(ahora.fecha, fecha);
  if (distancia < 0 || distancia > ajustes.max_dias) {
    return { abierto: false, motivo: 'fuera_de_rango', huecos: [] };
  }

  const { rows } = await db.query(
    'SELECT inicio, fin, activo FROM horario WHERE dia_semana = $1 AND turno = $2',
    [diaSemanaISO(fecha), turno],
  );
  const tramo = rows[0];
  if (!tramo || !tramo.activo) return { abierto: false, motivo: 'cerrado', huecos: [] };
  if (await estaBloqueado(db, fecha, turno)) return { abierto: false, motivo: 'cerrado', huecos: [] };

  const huecos = huecosLibres({
    inicio: tramo.inicio,
    fin: tramo.fin,
    duracion,
    ocupadas: await citasDelDia(db, fecha),
    fecha,
    ahora,
    antelacionMin: ajustes.antelacion_horas * 60,
  });
  return { abierto: true, motivo: null, huecos };
}

export async function crearCita(db, datos, instante = new Date()) {
  try {
    return await db.transaccion(async (tx) => {
      // Serializa las reservas del mismo día: sin esto, dos masajes de distinta
      // duración podrían solaparse si se piden a la vez.
      await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [datos.fecha]);
      const { huecos } = await disponibilidad(tx, datos, instante);
      if (!huecos.includes(datos.hora)) throw new ErrorHuecoOcupado();
      // Freno al acaparamiento de huecos y al envío de correos a terceros.
      const activas = await citasActivasDeContacto(tx, datos, ahoraEnSalon(instante).fecha);
      if (activas >= LIMITES.CITAS_ACTIVAS_POR_CONTACTO) throw new ErrorDemasiadasCitas();
      const { rows } = await tx.query(
        `INSERT INTO citas (fecha, hora, turno, servicio, duracion_min, nombre, telefono, email, canal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [datos.fecha, datos.hora, datos.turno, datos.servicio, datos.duracion,
          datos.nombre, datos.telefono, datos.email, datos.canal],
      );
      return { id: rows[0].id, ...datos };
    });
  } catch (err) {
    if (err.code === COD_DUPLICADO) throw new ErrorHuecoOcupado();
    throw err;
  }
}

export async function registrarAvisos(db, citaId, avisos) {
  for (const aviso of avisos) {
    await db.query(
      'INSERT INTO notificaciones (cita_id, canal, destino, estado, detalle) VALUES ($1, $2, $3, $4, $5)',
      [citaId, aviso.canal, aviso.destino, aviso.estado, aviso.detalle ?? ''],
    );
  }
}
