// API pública: información del salón, disponibilidad por turno y reserva.
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AJUSTES_POR_DEFECTO, PRODUCTOS, SERVICIOS, TURNOS } from '../config.js';
import { validarCita, validarConsulta } from '../validacion.js';
import {
  crearCita,
  disponibilidad,
  leerAjustes,
  leerHorario,
  registrarAvisos,
} from '../servicio.js';
import { ahoraEnSalon, sumarDias } from '../slots.js';

const VENTANA_MS = 15 * 60 * 1000;
const MAX_CONSULTAS = 120;
const VENTANA_RESERVA_MS = 60 * 60 * 1000;
const MAX_RESERVAS = 8;

function limitador(windowMs, limit, mensaje, activo) {
  if (!activo) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: mensaje },
  });
}

export function rutasPublicas({ db, notificador, ahora, limitar, pagos }) {
  const router = Router();
  const limiteConsultas = limitador(VENTANA_MS, MAX_CONSULTAS, 'Demasiadas consultas. Prueba en unos minutos.', limitar);
  const limiteReservas = limitador(VENTANA_RESERVA_MS, MAX_RESERVAS, 'Demasiadas reservas desde tu conexión. Llámanos, por favor.', limitar);

  router.get('/info', limiteConsultas, async (_req, res) => {
    const [ajustes, horario] = await Promise.all([leerAjustes(db), leerHorario(db)]);
    const hoy = ahoraEnSalon(ahora()).fecha;
    res.json({
      ok: true,
      data: {
        nombre: ajustes.nombre_salon,
        direccion: ajustes.direccion,
        telefono: ajustes.telefono_salon,
        servicios: SERVICIOS,
        turnos: TURNOS,
        productos: PRODUCTOS,
        pagoOnline: pagos.activo,
        hoy,
        ultimoDia: sumarDias(hoy, ajustes.max_dias),
        horario: horario.map(({ dia_semana, turno, inicio, fin, activo }) => (
          { dia: dia_semana, turno, inicio, fin, activo }
        )),
      },
    });
  });

  router.get('/disponibilidad', limiteConsultas, async (req, res) => {
    const consulta = validarConsulta(req.query);
    const { fecha, turno } = consulta;
    const resultado = await disponibilidad(db, consulta, ahora());
    res.json({ ok: true, data: { fecha, turno, ...resultado } });
  });

  router.post('/citas', limiteReservas, async (req, res) => {
    // Campo trampa: los bots lo rellenan, las personas no lo ven.
    if (typeof req.body?.web === 'string' && req.body.web.trim() !== '') {
      return res.status(400).json({ ok: false, error: 'No se pudo procesar la solicitud.' });
    }
    const datos = validarCita(req.body);
    const cita = await crearCita(db, datos, ahora());

    let avisos = [];
    try {
      const ajustes = await leerAjustes(db).catch(() => AJUSTES_POR_DEFECTO);
      avisos = await notificador.enviarConfirmacion(cita, ajustes);
      await registrarAvisos(db, cita.id, avisos);
    } catch (err) {
      // La cita ya está guardada: un fallo de avisos no debe perderla.
      console.error('[citas] Error al notificar la cita', cita.id, err.message);
    }

    res.status(201).json({
      ok: true,
      data: {
        fecha: cita.fecha,
        hora: cita.hora,
        servicio: cita.servicio,
        duracion: cita.duracion,
        avisos: avisos.map(({ canal, estado }) => ({ canal, estado })),
      },
    });
  });

  return router;
}
