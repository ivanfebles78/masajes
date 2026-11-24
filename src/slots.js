// Lógica pura de fechas y huecos. Sin acceso a base de datos.
import { ZONA_HORARIA, LIMITES } from './config.js';

const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MS_DIA = 86_400_000;

export function esHoraValida(hora) {
  return typeof hora === 'string' && RE_HORA.test(hora);
}

export function aMinutos(hora) {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

export function aHora(minutos) {
  const h = String(Math.floor(minutos / 60)).padStart(2, '0');
  const m = String(minutos % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function aUTC(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return Date.UTC(a, m - 1, d);
}

export function esFechaValida(fecha) {
  if (typeof fecha !== 'string' || !RE_FECHA.test(fecha)) return false;
  return new Date(aUTC(fecha)).toISOString().slice(0, 10) === fecha;
}

/** 1 = lunes … 7 = domingo. */
export function diaSemanaISO(fecha) {
  const dia = new Date(aUTC(fecha)).getUTCDay();
  return dia === 0 ? 7 : dia;
}

export function sumarDias(fecha, dias) {
  return new Date(aUTC(fecha) + dias * MS_DIA).toISOString().slice(0, 10);
}

export function diasEntre(desde, hasta) {
  return Math.round((aUTC(hasta) - aUTC(desde)) / MS_DIA);
}

/** Fecha y minutos del día actuales en la zona horaria del salón. */
export function ahoraEnSalon(instante = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_HORARIA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  return {
    fecha: `${p.year}-${p.month}-${p.day}`,
    minutos: Number(p.hour) * 60 + Number(p.minute),
  };
}

/**
 * Tramos libres [inicio, fin) de un turno, en minutos, descontando las citas.
 * @param {number} inicio
 * @param {number} fin
 * @param {{inicio: number, fin: number}[]} ocupadas
 */
export function tramosLibres(inicio, fin, ocupadas) {
  const ordenadas = [...ocupadas].sort((x, y) => x.inicio - y.inicio);
  const tramos = [];
  let cursor = inicio;
  for (const cita of ordenadas) {
    if (cita.fin <= cursor) continue;
    if (cita.inicio >= fin) break;
    if (cita.inicio > cursor) tramos.push({ inicio: cursor, fin: cita.inicio });
    cursor = Math.max(cursor, cita.fin);
  }
  if (cursor < fin) tramos.push({ inicio: cursor, fin });
  return tramos;
}

/**
 * Jornada continua a la que pertenece un turno: une los turnos abiertos que
 * van seguidos (el fin de uno coincide con el inicio del siguiente o lo pisa).
 * @param {{turno: string, inicio: number, fin: number}[]} abiertos
 * @param {string} turno
 * @returns {{inicio: number, fin: number} | null}
 */
export function jornadaContinua(abiertos, turno) {
  const ordenados = [...abiertos].sort((x, y) => x.inicio - y.inicio);
  const bloques = [];
  for (const tramo of ordenados) {
    const ultimo = bloques.at(-1);
    if (ultimo && tramo.inicio <= ultimo.fin) {
      bloques[bloques.length - 1] = {
        inicio: ultimo.inicio,
        fin: Math.max(ultimo.fin, tramo.fin),
        turnos: [...ultimo.turnos, tramo.turno],
      };
    } else {
      bloques.push({ inicio: tramo.inicio, fin: tramo.fin, turnos: [tramo.turno] });
    }
  }
  const bloque = bloques.find((b) => b.turnos.includes(turno));
  return bloque ? { inicio: bloque.inicio, fin: bloque.fin } : null;
}

const enMinutos = (valor) => (typeof valor === 'string' ? aMinutos(valor) : valor);

/**
 * Horas de inicio que se pueden ofrecer para un masaje de `duracion` minutos.
 * Los huecos se encadenan desde el principio de cada tramo libre de la jornada
 * (`inicio`–`fin`), de modo que las citas quedan pegadas y no se desperdicia
 * tiempo entre ellas. Con `ventana` solo se devuelven los que EMPIEZAN dentro
 * de ese turno, aunque el masaje termine ya en el turno siguiente.
 */
export function huecosLibres({ inicio, fin, duracion, ocupadas, fecha, ahora, antelacionMin, ventana = null }) {
  const minutosHastaFecha = diasEntre(ahora.fecha, fecha) * LIMITES.MINUTOS_DIA - ahora.minutos;
  const huecos = [];
  for (const tramo of tramosLibres(enMinutos(inicio), enMinutos(fin), ocupadas)) {
    for (let t = tramo.inicio; t + duracion <= tramo.fin; t += duracion) {
      const enVentana = !ventana || (t >= ventana.inicio && t < ventana.fin);
      if (enVentana && minutosHastaFecha + t >= antelacionMin) huecos.push(aHora(t));
    }
  }
  return huecos;
}

export function fechaLarga(fecha) {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(aUTC(fecha)));
}
