// Constantes y valores por defecto de la aplicación.

export const ZONA_HORARIA = 'Europe/Madrid';
export const TURNOS = ['manana', 'tarde'];
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

export const AJUSTES_POR_DEFECTO = Object.freeze({
  nombre_salon: 'PausatZen',
  direccion: 'Estella · Lizarra',
  telefono_salon: '',
  antelacion_horas: '2',
  max_dias: '60',
});

const LABORABLE = [
  { turno: 'manana', inicio: '09:00', fin: '13:30', activo: true },
  { turno: 'tarde', inicio: '16:30', fin: '19:30', activo: true },
];
const SABADO = [
  { turno: 'manana', inicio: '09:00', fin: '13:30', activo: true },
  { turno: 'tarde', inicio: '16:30', fin: '19:30', activo: false },
];
const DOMINGO = [
  { turno: 'manana', inicio: '09:00', fin: '13:30', activo: false },
  { turno: 'tarde', inicio: '16:30', fin: '19:30', activo: false },
];

// dia_semana: 1 = lunes … 7 = domingo (ISO).
// Valores sembrados por versiones anteriores que se actualizan solos al arrancar
// (solo si el administrador no los ha cambiado ya por otros).
export const AJUSTES_RENOMBRADOS = Object.freeze([
  { clave: 'nombre_salon', antes: ['Shiatsu Pamplona', 'Pausatzen'], ahora: 'PausatZen' },
  { clave: 'direccion', antes: ['Pamplona · Iruña'], ahora: 'Estella · Lizarra' },
]);

export const HORARIO_POR_DEFECTO = Object.freeze(
  [1, 2, 3, 4, 5, 6, 7].flatMap((dia) => {
    const plantilla = dia <= 5 ? LABORABLE : dia === 6 ? SABADO : DOMINGO;
    return plantilla.map((t) => ({ dia_semana: dia, ...t }));
  }),
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
  CITAS_ACTIVAS_POR_CONTACTO: 3,
});
