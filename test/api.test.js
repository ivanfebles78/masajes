import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { conectarBD, prepararBD } from '../src/db.js';
import { crearNotificador } from '../src/notificaciones.js';
import { crearApp } from '../src/app.js';

// Lunes 23-11-2026 a las 09:00 en Pamplona.
const AHORA = new Date('2026-11-23T08:00:00Z');
const MARTES = '2026-11-24';
const CLAVE_PRUEBA = 'clave-de-pruebas-1';
const silencio = { info() {}, warn() {}, error() {} };

let db;
let servidor;
let base;
let cookie = '';
const correosEnviados = [];

async function pedir(ruta, { metodo = 'GET', cuerpo, conSesion = false } = {}) {
  const respuesta = await fetch(base + ruta, {
    method: metodo,
    headers: {
      ...(cuerpo ? { 'Content-Type': 'application/json' } : {}),
      ...(conSesion ? { Cookie: cookie } : {}),
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  const galletas = respuesta.headers.getSetCookie();
  if (galletas.length > 0) cookie = galletas.map((g) => g.split(';')[0]).join('; ');
  return { status: respuesta.status, json: await respuesta.json() };
}

const huecosDe = async (fecha, turno, servicio = 'shiatsu', duracion = 90) =>
  (await pedir(`/api/disponibilidad?fecha=${fecha}&turno=${turno}&servicio=${servicio}&duracion=${duracion}`)).json.data;
const SHIATSU = { servicio: 'shiatsu', duracion: 90 };

before(async () => {
  const env = { NODE_ENV: 'test', ADMIN_PASSWORD: CLAVE_PRUEBA };
  db = await conectarBD(env);
  await prepararBD(db, env);
  const fetchFalso = async (url, opciones) => {
    correosEnviados.push({ url, cuerpo: JSON.parse(opciones.body), auth: opciones.headers.Authorization });
    return new Response('{"id":"x"}', { status: 200 });
  };
  const notificador = crearNotificador({
    env: { RESEND_API_KEY: 're_prueba', MAIL_FROM: 'Salón <citas@ejemplo.test>' },
    fetchImpl: fetchFalso,
    log: silencio,
  });
  const app = crearApp({ db, notificador, secretoSesion: 'x'.repeat(40), limitar: false, ahora: () => AHORA });
  servidor = app.listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  servidor.close();
  await db.cerrar();
});

test('la contraseña del administrador se guarda hasheada', async () => {
  const { rows } = await db.query('SELECT usuario, clave_hash FROM administradores');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].usuario, 'admin');
  assert.match(rows[0].clave_hash, /^\$2[aby]\$12\$/);
  assert.ok(!rows[0].clave_hash.includes(CLAVE_PRUEBA));
});

test('muestra solo los huecos del turno pedido', async () => {
  assert.deepEqual((await huecosDe(MARTES, 'manana')).huecos, ['09:00', '10:30', '12:00']);
  assert.deepEqual((await huecosDe(MARTES, 'tarde')).huecos, ['16:30', '18:00']);
});

test('sábado por la tarde y domingo están cerrados', async () => {
  assert.equal((await huecosDe('2026-11-28', 'manana')).abierto, true);
  assert.equal((await huecosDe('2026-11-28', 'tarde')).abierto, false);
  assert.equal((await huecosDe('2026-11-29', 'manana')).abierto, false);
});

test('respeta la antelación mínima el mismo día y rechaza fechas pasadas o lejanas', async () => {
  assert.deepEqual((await huecosDe('2026-11-23', 'manana')).huecos, ['12:00']);
  assert.equal((await huecosDe('2026-11-20', 'manana')).motivo, 'fuera_de_rango');
  assert.equal((await huecosDe('2027-06-01', 'manana')).motivo, 'fuera_de_rango');
});

test('valida los parámetros de disponibilidad', async () => {
  assert.equal((await pedir('/api/disponibilidad?fecha=ayer&turno=manana&servicio=shiatsu&duracion=90')).status, 400);
  assert.equal((await pedir(`/api/disponibilidad?fecha=${MARTES}&turno=noche&servicio=shiatsu&duracion=90`)).status, 400);
  assert.equal((await pedir(`/api/disponibilidad?fecha=${MARTES}&turno=manana&servicio=shiatsu&duracion=60`)).status, 400);
  assert.equal((await pedir(`/api/disponibilidad?fecha=${MARTES}&turno=manana`)).status, 400);
});

test('reserva una cita, envía el correo y simula el WhatsApp', async () => {
  const r = await pedir('/api/citas', {
    metodo: 'POST',
    cuerpo: {
      ...SHIATSU, fecha: MARTES, turno: 'manana', hora: '10:30', nombre: 'Ana <b>López</b>',
      telefono: '612 345 678', email: 'ana@ejemplo.test', canal: 'whatsapp',
    },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.data.avisos, [
    { canal: 'email', estado: 'enviado' },
    { canal: 'whatsapp', estado: 'simulado' },
  ]);
  assert.equal(correosEnviados.length, 1);
  assert.equal(correosEnviados[0].url, 'https://api.resend.com/emails');
  assert.equal(correosEnviados[0].auth, 'Bearer re_prueba');
  assert.deepEqual(correosEnviados[0].cuerpo.to, ['ana@ejemplo.test']);
  assert.ok(correosEnviados[0].cuerpo.html.includes('Ana &lt;b&gt;López&lt;/b&gt;'));
  assert.ok(correosEnviados[0].cuerpo.text.includes('Shiatsu · martes, 24 de noviembre a las 10:30 (90 min)'));
  assert.deepEqual((await huecosDe(MARTES, 'manana')).huecos, ['09:00', '12:00']);
});

test('no permite reservar dos veces el mismo hueco ni un hueco inexistente', async () => {
  const cuerpo = { ...SHIATSU, fecha: MARTES, turno: 'manana', hora: '10:30', nombre: 'Luis', email: 'luis@ejemplo.test' };
  assert.equal((await pedir('/api/citas', { metodo: 'POST', cuerpo })).status, 409);
  assert.equal((await pedir('/api/citas', { metodo: 'POST', cuerpo: { ...cuerpo, hora: '11:00' } })).status, 409);
  assert.equal((await pedir('/api/citas', { metodo: 'POST', cuerpo: { ...cuerpo, turno: 'tarde', hora: '09:00' } })).status, 409);
});

test('dos reservas simultáneas del mismo hueco: solo entra una', async () => {
  const cuerpo = { ...SHIATSU, fecha: MARTES, turno: 'tarde', hora: '18:00', nombre: 'Carrera', email: 'c@ejemplo.test' };
  const [a, b] = await Promise.all([
    pedir('/api/citas', { metodo: 'POST', cuerpo }),
    pedir('/api/citas', { metodo: 'POST', cuerpo }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
});

test('un masaje en camilla de 60 minutos recoloca los huecos siguientes', async () => {
  const MIERCOLES = '2026-12-02';
  assert.deepEqual((await huecosDe(MIERCOLES, 'manana', 'camilla', 60)).huecos, ['09:00', '10:00', '11:00', '12:00']);
  const r = await pedir('/api/citas', {
    metodo: 'POST',
    cuerpo: { fecha: MIERCOLES, turno: 'manana', servicio: 'camilla', duracion: 60, hora: '09:00', nombre: 'Marta', telefono: '612345678', canal: 'sms' },
  });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.data.avisos, [{ canal: 'sms', estado: 'simulado' }]);
  assert.deepEqual((await huecosDe(MIERCOLES, 'manana', 'shiatsu', 90)).huecos, ['10:00', '11:30']);
  assert.deepEqual((await huecosDe(MIERCOLES, 'manana', 'camilla', 60)).huecos, ['10:00', '11:00', '12:00']);
  // Las 10:30 ya no es un inicio válido para shiatsu ese día.
  const pisada = await pedir('/api/citas', {
    metodo: 'POST',
    cuerpo: { ...SHIATSU, fecha: MIERCOLES, turno: 'manana', hora: '09:30', nombre: 'Pisa', email: 'p@ejemplo.test' },
  });
  assert.equal(pisada.status, 409);
});

test('dos reservas simultáneas de distinta duración que se solapan: solo entra una', async () => {
  const JUEVES = '2026-12-03';
  const comun = { fecha: JUEVES, turno: 'tarde', nombre: 'Solape', email: 's@ejemplo.test' };
  const [a, b] = await Promise.all([
    pedir('/api/citas', { metodo: 'POST', cuerpo: { ...comun, ...SHIATSU, hora: '16:30' } }),
    pedir('/api/citas', { metodo: 'POST', cuerpo: { ...comun, servicio: 'camilla', duracion: 60, hora: '17:30' } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [201, 409]);
});

test('limita las citas pendientes por contacto y rechaza correos con parámetros', async () => {
  const dias = ['2026-12-09', '2026-12-10', '2026-12-11', '2026-12-14'];
  const estados = [];
  for (const fecha of dias) {
    const r = await pedir('/api/citas', {
      metodo: 'POST',
      cuerpo: { ...SHIATSU, fecha, turno: 'manana', hora: '09:00', nombre: 'Repite', email: 'repite@ejemplo.test' },
    });
    estados.push(r.status);
  }
  assert.deepEqual(estados, [201, 201, 201, 429]);
  const raro = await pedir('/api/citas', {
    metodo: 'POST',
    cuerpo: { ...SHIATSU, fecha: '2026-12-15', turno: 'manana', hora: '09:00', nombre: 'Raro', email: 'a@b.co?bcc=x.com' },
  });
  assert.equal(raro.status, 400);
});

test('rechaza datos incompletos y el campo trampa', async () => {
  const cuerpo = { ...SHIATSU, fecha: MARTES, turno: 'manana', hora: '09:00', nombre: 'Eva' };
  const sinContacto = await pedir('/api/citas', { metodo: 'POST', cuerpo });
  assert.equal(sinContacto.status, 400);
  assert.equal(sinContacto.json.campo, 'telefono');
  const bot = await pedir('/api/citas', { metodo: 'POST', cuerpo: { ...cuerpo, email: 'e@e.es', web: 'http://spam' } });
  assert.equal(bot.status, 400);
});

test('el panel exige sesión y rechaza credenciales incorrectas', async () => {
  assert.equal((await pedir('/api/admin/citas')).status, 401);
  const mal = await pedir('/api/admin/login', { metodo: 'POST', cuerpo: { usuario: 'admin', clave: 'incorrecta' } });
  assert.equal(mal.status, 401);
  const otro = await pedir('/api/admin/login', { metodo: 'POST', cuerpo: { usuario: 'root', clave: CLAVE_PRUEBA } });
  assert.equal(otro.status, 401);
});

test('el administrador ve las citas y puede cancelar una, liberando el hueco', async () => {
  const login = await pedir('/api/admin/login', { metodo: 'POST', cuerpo: { usuario: 'admin', clave: CLAVE_PRUEBA } });
  assert.equal(login.status, 200);
  const lista = await pedir('/api/admin/citas', { conSesion: true });
  const ana = lista.json.data.citas.find((c) => c.hora === '10:30');
  assert.equal(ana.telefono, '+34612345678');
  assert.equal(ana.servicio, 'shiatsu');
  assert.equal(ana.duracion_min, 90);
  assert.deepEqual(ana.avisos.map((a) => a.canal), ['email', 'whatsapp']);
  const cancelar = await pedir(`/api/admin/citas/${ana.id}/cancelar`, { metodo: 'POST', conSesion: true });
  assert.equal(cancelar.status, 200);
  assert.deepEqual((await huecosDe(MARTES, 'manana')).huecos, ['09:00', '10:30', '12:00']);
});

test('el administrador cambia el horario y los huecos se recalculan', async () => {
  const { json } = await pedir('/api/admin/horario', { conSesion: true });
  const horario = json.data.horario.map((h) =>
    h.dia_semana === 3 && h.turno === 'tarde' ? { ...h, inicio: '15:00', fin: '19:30' } : h);
  const r = await pedir('/api/admin/horario', { metodo: 'PUT', cuerpo: { horario }, conSesion: true });
  assert.equal(r.status, 200);
  assert.deepEqual((await huecosDe('2026-11-25', 'tarde')).huecos, ['15:00', '16:30', '18:00']);
  const malo = horario.map((h) => (h.dia_semana === 1 ? { ...h, inicio: '14:00', fin: '09:00' } : h));
  assert.equal((await pedir('/api/admin/horario', { metodo: 'PUT', cuerpo: { horario: malo }, conSesion: true })).status, 400);
});

test('un día bloqueado deja de ofrecer huecos', async () => {
  const crear = await pedir('/api/admin/bloqueos', {
    metodo: 'POST', cuerpo: { fecha: '2026-11-26', turno: 'todo', motivo: 'Festivo' }, conSesion: true,
  });
  assert.equal(crear.status, 201);
  assert.equal((await huecosDe('2026-11-26', 'manana')).abierto, false);
  const { json } = await pedir('/api/admin/bloqueos', { conSesion: true });
  await pedir(`/api/admin/bloqueos/${json.data.bloqueos[0].id}`, { metodo: 'DELETE', conSesion: true });
  assert.equal((await huecosDe('2026-11-26', 'manana')).abierto, true);
});

test('los ajustes se validan y se reflejan en la web', async () => {
  const mal = await pedir('/api/admin/ajustes', { metodo: 'PUT', cuerpo: { max_dias: 0 }, conSesion: true });
  assert.equal(mal.status, 400);
  const bien = await pedir('/api/admin/ajustes', { metodo: 'PUT', cuerpo: { nombre_salon: 'Kokoro Shiatsu' }, conSesion: true });
  assert.equal(bien.status, 200);
  assert.equal((await pedir('/api/info')).json.data.nombre, 'Kokoro Shiatsu');
});

test('cambiar la contraseña invalida la sesión anterior', async () => {
  const cookieAntigua = cookie;
  const corta = await pedir('/api/admin/clave', { metodo: 'PUT', cuerpo: { actual: CLAVE_PRUEBA, nueva: 'corta' }, conSesion: true });
  assert.equal(corta.status, 400);
  const cambio = await pedir('/api/admin/clave', {
    metodo: 'PUT', cuerpo: { actual: CLAVE_PRUEBA, nueva: 'otra-clave-larga-2' }, conSesion: true,
  });
  assert.equal(cambio.status, 200);
  assert.equal((await pedir('/api/admin/sesion', { conSesion: true })).status, 200);
  const cookieNueva = cookie;
  cookie = cookieAntigua;
  assert.equal((await pedir('/api/admin/sesion', { conSesion: true })).status, 401);
  cookie = cookieNueva;
  await pedir('/api/admin/logout', { metodo: 'POST', conSesion: true });
});

test('sin clave de Resend el correo queda como simulado y la cita se guarda', async () => {
  const notificador = crearNotificador({ env: {}, log: silencio });
  const avisos = await notificador.enviarConfirmacion(
    { id: 1, nombre: 'Eva', servicio: 'camilla', duracion: 60, fecha: MARTES, hora: '09:00', email: 'e@e.es', telefono: '+34600000000', canal: 'sms' },
    { nombre_salon: 'S', direccion: '', telefono_salon: '' },
  );
  assert.deepEqual(avisos.map((a) => [a.canal, a.estado]), [['email', 'simulado'], ['sms', 'simulado']]);
});
