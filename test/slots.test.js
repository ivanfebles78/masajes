import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ahoraEnSalon,
  diaSemanaISO,
  esFechaValida,
  huecosLibres,
  tramosLibres,
  sumarDias,
} from '../src/slots.js';
import { normalizarTelefono, validarCita, ErrorValidacion } from '../src/validacion.js';

const MANANA = { inicio: '09:00', fin: '13:30' };
const TARDE = { inicio: '16:30', fin: '19:30' };
const libre = {
  ocupadas: [],
  fecha: '2026-11-24',
  ahora: { fecha: '2026-11-23', minutos: 540 },
  antelacionMin: 120,
};
const cita = (hora, duracion) => {
  const [h, m] = hora.split(':').map(Number);
  return { inicio: h * 60 + m, fin: h * 60 + m + duracion };
};

test('con el turno vacío ofrece huecos encadenados según la duración', () => {
  assert.deepEqual(huecosLibres({ ...libre, ...MANANA, duracion: 90 }), ['09:00', '10:30', '12:00']);
  assert.deepEqual(huecosLibres({ ...libre, ...TARDE, duracion: 90 }), ['16:30', '18:00']);
  assert.deepEqual(huecosLibres({ ...libre, ...MANANA, duracion: 60 }), ['09:00', '10:00', '11:00', '12:00']);
  assert.deepEqual(huecosLibres({ ...libre, ...TARDE, duracion: 60 }), ['16:30', '17:30', '18:30']);
});

test('no ofrece huecos que terminen después del cierre', () => {
  assert.deepEqual(huecosLibres({ ...libre, inicio: '09:00', fin: '10:00', duracion: 90 }), []);
});

test('tras una cita de 60 minutos los siguientes huecos empiezan donde acaba', () => {
  const ocupadas = [cita('09:00', 60)];
  assert.deepEqual(huecosLibres({ ...libre, ...MANANA, ocupadas, duracion: 90 }), ['10:00', '11:30']);
  assert.deepEqual(huecosLibres({ ...libre, ...MANANA, ocupadas, duracion: 60 }), ['10:00', '11:00', '12:00']);
});

test('un tramo libre corto solo admite el masaje que cabe', () => {
  const ocupadas = [cita('10:00', 90)];
  assert.deepEqual(huecosLibres({ ...libre, ...MANANA, ocupadas, duracion: 90 }), ['11:30']);
  assert.deepEqual(huecosLibres({ ...libre, ...MANANA, ocupadas, duracion: 60 }), ['09:00', '11:30', '12:30']);
});

test('calcula los tramos libres aunque haya citas solapadas o fuera del turno', () => {
  const ocupadas = [cita('08:30', 60), cita('10:00', 90), cita('10:30', 60), cita('17:00', 60)];
  assert.deepEqual(tramosLibres(540, 810, ocupadas), [{ inicio: 570, fin: 600 }, { inicio: 690, fin: 810 }]);
});

test('calcula el día de la semana ISO', () => {
  assert.equal(diaSemanaISO('2026-11-23'), 1);
  assert.equal(diaSemanaISO('2026-11-28'), 6);
  assert.equal(diaSemanaISO('2026-11-29'), 7);
});

test('rechaza fechas imposibles', () => {
  assert.equal(esFechaValida('2026-02-30'), false);
  assert.equal(esFechaValida('23/11/2026'), false);
  assert.equal(esFechaValida('2026-11-23'), true);
});

test('suma días cruzando de mes', () => {
  assert.equal(sumarDias('2026-11-30', 1), '2026-12-01');
});

test('convierte el instante a la hora de Madrid', () => {
  assert.deepEqual(ahoraEnSalon(new Date('2026-11-23T08:00:00Z')), { fecha: '2026-11-23', minutos: 540 });
  assert.deepEqual(ahoraEnSalon(new Date('2026-07-01T22:30:00Z')), { fecha: '2026-07-02', minutos: 30 });
});

test('respeta la antelación mínima el mismo día', () => {
  // Hoy a las 09:00 con dos horas de antelación solo queda el de las 12:00.
  assert.deepEqual(huecosLibres({ ...libre, ...MANANA, duracion: 90, fecha: '2026-11-23' }), ['12:00']);
});

test('normaliza teléfonos españoles e internacionales', () => {
  assert.equal(normalizarTelefono('612 345 678'), '+34612345678');
  assert.equal(normalizarTelefono('0034 612-345-678'), '+34612345678');
  assert.equal(normalizarTelefono('+33 6 12 34 56 78'), '+33612345678');
  assert.equal(normalizarTelefono('12345'), null);
});

test('la cita exige nombre y al menos un medio de contacto', () => {
  const base = { fecha: '2026-11-24', turno: 'manana', servicio: 'shiatsu', duracion: 75, hora: '09:00', nombre: 'Ana' };
  assert.throws(() => validarCita(base), ErrorValidacion);
  assert.throws(() => validarCita({ ...base, nombre: '', email: 'a@b.es' }), ErrorValidacion);
  assert.throws(() => validarCita({ ...base, email: 'no-es-correo' }), ErrorValidacion);
  const soloCorreo = validarCita({ ...base, email: ' Ana@Ejemplo.es ' });
  assert.equal(soloCorreo.email, 'ana@ejemplo.es');
  assert.equal(soloCorreo.canal, null);
  const conMovil = validarCita({ ...base, telefono: '612345678', canal: 'sms' });
  assert.equal(conMovil.canal, 'sms');
  assert.equal(conMovil.email, null);
});

test('el shiatsu solo admite 75 minutos y la camilla 60 o 90', () => {
  const base = { fecha: '2026-11-24', turno: 'manana', hora: '09:00', nombre: 'Ana', email: 'a@b.es' };
  assert.throws(() => validarCita({ ...base, servicio: 'shiatsu', duracion: 60 }), ErrorValidacion);
  assert.throws(() => validarCita({ ...base, servicio: 'shiatsu', duracion: 90 }), ErrorValidacion);
  assert.equal(validarCita({ ...base, servicio: 'shiatsu', duracion: 75 }).duracion, 75);
  assert.throws(() => validarCita({ ...base, servicio: 'camilla', duracion: 45 }), ErrorValidacion);
  assert.throws(() => validarCita({ ...base, servicio: 'tailandes', duracion: 90 }), ErrorValidacion);
  assert.equal(validarCita({ ...base, servicio: 'camilla', duracion: '60' }).duracion, 60);
  assert.equal(validarCita({ ...base, servicio: 'camilla', duracion: 90 }).duracion, 90);
});
