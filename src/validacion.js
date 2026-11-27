// Validación de entradas en el borde del sistema.
import { CANALES, LIMITES, PRODUCTOS, TURNOS, buscarProducto, buscarServicio } from './config.js';
import { aMinutos, esFechaValida, esHoraValida } from './slots.js';

export class ErrorValidacion extends Error {
  constructor(mensaje, campo = null) {
    super(mensaje);
    this.campo = campo;
    this.status = 400;
  }
}

const RE_EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;
const RE_TELEFONO = /^\+\d{9,15}$/;

// Se quitan los caracteres de control: Postgres rechaza el NUL y los demás no aportan nada.
const RE_CONTROL = /[\u0000-\u001f\u007f]/g;

function texto(valor) {
  return typeof valor === 'string' ? valor.replace(RE_CONTROL, ' ').trim() : '';
}

/** Devuelve el teléfono en formato +34XXXXXXXXX o null si no es válido. */
export function normalizarTelefono(valor) {
  const limpio = texto(valor).replace(/[\s().-]/g, '');
  if (!limpio) return null;
  const conPrefijo = limpio.startsWith('00') ? `+${limpio.slice(2)}` : limpio;
  const final = /^[6789]\d{8}$/.test(conPrefijo) ? `+34${conPrefijo}` : conPrefijo;
  return RE_TELEFONO.test(final) ? final : null;
}

export function validarFechaTurno(entrada) {
  const fecha = texto(entrada?.fecha);
  const turno = texto(entrada?.turno);
  if (!esFechaValida(fecha)) throw new ErrorValidacion('La fecha no es válida.', 'fecha');
  if (!TURNOS.includes(turno)) throw new ErrorValidacion('El turno no es válido.', 'turno');
  return { fecha, turno };
}

export function validarServicio(entrada) {
  const servicio = buscarServicio(texto(entrada?.servicio));
  if (!servicio) throw new ErrorValidacion('Elige un tipo de masaje.', 'servicio');
  const duracion = Number(entrada?.duracion);
  if (!servicio.duraciones.includes(duracion)) {
    throw new ErrorValidacion('Esa duración no está disponible para este masaje.', 'duracion');
  }
  return { servicio: servicio.id, duracion };
}

export function validarConsulta(entrada) {
  return { ...validarFechaTurno(entrada), ...validarServicio(entrada) };
}

export function validarCita(cuerpo) {
  const { fecha, turno, servicio, duracion } = validarConsulta(cuerpo);
  const hora = texto(cuerpo?.hora);
  if (!esHoraValida(hora)) throw new ErrorValidacion('La hora no es válida.', 'hora');

  const nombre = texto(cuerpo?.nombre).replace(/\s+/g, ' ');
  if (nombre.length < LIMITES.NOMBRE_MIN || nombre.length > LIMITES.NOMBRE_MAX) {
    throw new ErrorValidacion('Indícanos tu nombre.', 'nombre');
  }

  const telefonoBruto = texto(cuerpo?.telefono);
  const telefono = normalizarTelefono(telefonoBruto);
  if (telefonoBruto && !telefono) {
    throw new ErrorValidacion('El teléfono no parece correcto.', 'telefono');
  }

  const email = texto(cuerpo?.email).toLowerCase();
  if (email && (email.length > LIMITES.EMAIL_MAX || !RE_EMAIL.test(email))) {
    throw new ErrorValidacion('El correo no parece correcto.', 'email');
  }

  if (!telefono && !email) {
    throw new ErrorValidacion('Necesitamos un teléfono o un correo para confirmarte la cita.', 'telefono');
  }

  let canal = null;
  if (telefono) {
    canal = texto(cuerpo?.canal) || 'whatsapp';
    if (!CANALES.includes(canal)) throw new ErrorValidacion('Elige WhatsApp o SMS.', 'canal');
  }

  return { fecha, turno, servicio, duracion, hora, nombre, telefono, email: email || null, canal };
}

export function validarPedido(cuerpo) {
  const pedidas = cuerpo?.lineas;
  if (!Array.isArray(pedidas) || pedidas.length === 0 || pedidas.length > PRODUCTOS.length) {
    throw new ErrorValidacion('El carrito está vacío.', 'lineas');
  }
  const vistos = new Set();
  const lineas = pedidas.map((linea) => {
    const id = texto(linea?.id);
    const cantidad = Number(linea?.cantidad);
    if (!buscarProducto(id) || vistos.has(id)) throw new ErrorValidacion('Hay un producto no válido en el carrito.', 'lineas');
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > LIMITES.UNIDADES_MAX_POR_PRODUCTO) {
      throw new ErrorValidacion(`Puedes pedir entre 1 y ${LIMITES.UNIDADES_MAX_POR_PRODUCTO} unidades de cada producto.`, 'lineas');
    }
    vistos.add(id);
    return { id, cantidad };
  });

  const nombre = texto(cuerpo?.nombre).replace(/\s+/g, ' ');
  if (nombre.length < LIMITES.NOMBRE_MIN || nombre.length > LIMITES.NOMBRE_MAX) {
    throw new ErrorValidacion('Indícanos tu nombre.', 'nombre');
  }
  const email = texto(cuerpo?.email).toLowerCase();
  if (!email || email.length > LIMITES.EMAIL_MAX || !RE_EMAIL.test(email)) {
    throw new ErrorValidacion('Necesitamos un correo válido para enviarte el justificante.', 'email');
  }
  const telefonoBruto = texto(cuerpo?.telefono);
  const telefono = normalizarTelefono(telefonoBruto);
  if (telefonoBruto && !telefono) throw new ErrorValidacion('El teléfono no parece correcto.', 'telefono');

  const esRegalo = cuerpo?.es_regalo === true;
  return {
    lineas,
    nombre,
    email,
    telefono,
    es_regalo: esRegalo,
    regalo_para: esRegalo ? texto(cuerpo?.regalo_para).slice(0, LIMITES.REGALO_PARA_MAX) : '',
    regalo_mensaje: esRegalo ? texto(cuerpo?.regalo_mensaje).slice(0, LIMITES.REGALO_MENSAJE_MAX) : '',
  };
}

const MAX_FILAS_HORARIO = 7 * TURNOS.length;

export function validarHorario(cuerpo) {
  const filas = cuerpo?.horario;
  if (!Array.isArray(filas) || filas.length === 0 || filas.length > MAX_FILAS_HORARIO) {
    throw new ErrorValidacion('El horario enviado no es válido.');
  }
  const vistos = new Set();
  return filas.map((fila) => {
    const dia = Number(fila?.dia_semana);
    const turno = texto(fila?.turno);
    const inicio = texto(fila?.inicio);
    const fin = texto(fila?.fin);
    const clave = `${dia}-${turno}`;
    if (!Number.isInteger(dia) || dia < 1 || dia > 7 || !TURNOS.includes(turno) || vistos.has(clave)) {
      throw new ErrorValidacion('El horario enviado no es válido.');
    }
    vistos.add(clave);
    if (!esHoraValida(inicio) || !esHoraValida(fin) || aMinutos(fin) <= aMinutos(inicio)) {
      throw new ErrorValidacion('En cada turno la hora de fin debe ser posterior a la de inicio.');
    }
    return { dia_semana: dia, turno, inicio, fin, activo: fila?.activo === true };
  });
}

export function validarBloqueo(cuerpo) {
  const fecha = texto(cuerpo?.fecha);
  if (!esFechaValida(fecha)) throw new ErrorValidacion('La fecha no es válida.', 'fecha');
  const turnoBruto = texto(cuerpo?.turno);
  const turno = turnoBruto === '' || turnoBruto === 'todo' ? null : turnoBruto;
  if (turno !== null && !TURNOS.includes(turno)) {
    throw new ErrorValidacion('El turno no es válido.', 'turno');
  }
  return { fecha, turno, motivo: texto(cuerpo?.motivo).slice(0, LIMITES.MOTIVO_MAX) };
}

const REGLAS_AJUSTES = {
  nombre_salon: { tipo: 'texto', min: 1, max: 80 },
  direccion: { tipo: 'texto', min: 0, max: 160 },
  telefono_salon: { tipo: 'texto', min: 0, max: 30 },
  antelacion_horas: { tipo: 'entero', min: 0, max: 72 },
  max_dias: { tipo: 'entero', min: 1, max: 365 },
};

export function validarAjustes(cuerpo) {
  const salida = {};
  for (const [clave, regla] of Object.entries(REGLAS_AJUSTES)) {
    if (cuerpo?.[clave] === undefined) continue;
    if (regla.tipo === 'entero') {
      const n = Number(cuerpo[clave]);
      if (!Number.isInteger(n) || n < regla.min || n > regla.max) {
        throw new ErrorValidacion(`«${clave}» debe estar entre ${regla.min} y ${regla.max}.`, clave);
      }
      salida[clave] = String(n);
    } else {
      const t = texto(String(cuerpo[clave]));
      if (t.length < regla.min || t.length > regla.max) {
        throw new ErrorValidacion(`«${clave}» no tiene una longitud válida.`, clave);
      }
      salida[clave] = t;
    }
  }
  return salida;
}

export function validarCambioClave(cuerpo) {
  const actual = typeof cuerpo?.actual === 'string' ? cuerpo.actual : '';
  const nueva = typeof cuerpo?.nueva === 'string' ? cuerpo.nueva : '';
  if (!actual) throw new ErrorValidacion('Escribe tu contraseña actual.', 'actual');
  if (nueva.length < LIMITES.CLAVE_MIN || nueva.length > LIMITES.CLAVE_MAX) {
    throw new ErrorValidacion(`La nueva contraseña debe tener al menos ${LIMITES.CLAVE_MIN} caracteres.`, 'nueva');
  }
  return { actual, nueva };
}
