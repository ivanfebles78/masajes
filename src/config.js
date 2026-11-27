// Constantes y valores por defecto de la aplicación.

export const ZONA_HORARIA = 'Europe/Madrid';
export const TURNOS = Object.freeze(['manana', 'mediodia', 'tarde']);
export const CANALES = ['whatsapp', 'sms'];
export const USUARIO_ADMIN = 'admin';

// Tipos de masaje y duraciones (en minutos) que admite cada uno.
export const SERVICIOS = Object.freeze([
  Object.freeze({ id: 'shiatsu', nombre: 'Shiatsu Zen', duraciones: Object.freeze([75]) }),
  Object.freeze({ id: 'camilla', nombre: 'Masaje en camilla', duraciones: Object.freeze([60, 90]) }),
]);

export function buscarServicio(id) {
  return SERVICIOS.find((s) => s.id === id) ?? null;
}

// Catálogo de la tienda. Precios en céntimos de euro, tomados del programa de
// PausatZen. Las sesiones sueltas llevan `duracion` para enlazarlas con la reserva.
const producto = (datos) => Object.freeze({ nota: '', duracion: null, ...datos });
export const PRODUCTOS = Object.freeze([
  producto({ id: 'shiatsu-75', servicio: 'shiatsu', tipo: 'sesion', duracion: 75,
    nombre: 'Shiatsu Zen · sesión de 75 min', precio_cent: 5500 }),
  producto({ id: 'shiatsu-bono-3', servicio: 'shiatsu', tipo: 'bono',
    nombre: 'Shiatsu Zen · bono de 3 sesiones', precio_cent: 15000,
    nota: 'Caduca a los 3 meses de la primera sesión' }),
  producto({ id: 'shiatsu-bono-5', servicio: 'shiatsu', tipo: 'bono',
    nombre: 'Shiatsu Zen · bono de 5 sesiones', precio_cent: 25000 }),
  producto({ id: 'camilla-60', servicio: 'camilla', tipo: 'sesion', duracion: 60,
    nombre: 'Masaje en camilla · sesión de 60 min', precio_cent: 6000 }),
  producto({ id: 'camilla-90', servicio: 'camilla', tipo: 'sesion', duracion: 90,
    nombre: 'Masaje en camilla · sesión de 90 min', precio_cent: 8000 }),
  producto({ id: 'camilla-bono-3', servicio: 'camilla', tipo: 'bono',
    nombre: 'Masaje en camilla · bono de 3 sesiones de 60 min', precio_cent: 15500 }),
  producto({ id: 'camilla-bono-5', servicio: 'camilla', tipo: 'bono',
    nombre: 'Masaje en camilla · bono de 5 sesiones de 60 min', precio_cent: 27000,
    nota: 'Caduca a los 6 meses' }),
]);

export function buscarProducto(id) {
  return PRODUCTOS.find((p) => p.id === id) ?? null;
}

export const AJUSTES_POR_DEFECTO = Object.freeze({
  nombre_salon: 'PausatZen',
  direccion: 'Estella · Lizarra',
  telefono_salon: '+34 680 72 96 31',
  antelacion_horas: '2',
  max_dias: '60',
});

// Valores sembrados por versiones anteriores que se actualizan solos al arrancar
// (solo si el administrador no los ha cambiado ya por otros).
export const AJUSTES_RENOMBRADOS = Object.freeze([
  { clave: 'nombre_salon', antes: ['Shiatsu Pamplona', 'Pausatzen'], ahora: 'PausatZen' },
  { clave: 'direccion', antes: ['Pamplona · Iruña'], ahora: 'Estella · Lizarra' },
  { clave: 'telefono_salon', antes: [''], ahora: '+34 680 72 96 31' },
]);

const TRAMOS = Object.freeze({
  manana: { inicio: '09:00', fin: '13:30' },
  mediodia: { inicio: '13:30', fin: '16:30' },
  tarde: { inicio: '16:30', fin: '19:00' },
});

// Turnos abiertos por defecto: de lunes a viernes jornada continua de 9:00 a
// 19:00; sábados solo por la mañana; domingos cerrado.
function turnosAbiertos(dia) {
  if (dia <= 5) return TURNOS;
  return dia === 6 ? ['manana'] : [];
}

// dia_semana: 1 = lunes … 7 = domingo (ISO).
export const HORARIO_POR_DEFECTO = Object.freeze(
  [1, 2, 3, 4, 5, 6, 7].flatMap((dia) => TURNOS.map((turno) => ({
    dia_semana: dia,
    turno,
    ...TRAMOS[turno],
    activo: turnosAbiertos(dia).includes(turno),
  }))),
);

export const LIMITES = Object.freeze({
  NOMBRE_MIN: 2,
  NOMBRE_MAX: 80,
  EMAIL_MAX: 120,
  CLAVE_MIN: 10,
  CLAVE_MAX: 100,
  MOTIVO_MAX: 120,
  SESION_MS: 8 * 60 * 60 * 1000,
  MINUTOS_DIA: 24 * 60,
  UNIDADES_MAX_POR_PRODUCTO: 10,
  REGALO_PARA_MAX: 80,
  REGALO_MENSAJE_MAX: 300,
  CITAS_ACTIVAS_POR_CONTACTO: 3,
});
