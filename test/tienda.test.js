import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { conectarBD, prepararBD } from '../src/db.js';
import { crearNotificador } from '../src/notificaciones.js';
import { crearPagos } from '../src/pagos.js';
import { crearApp } from '../src/app.js';

const silencio = { info() {}, warn() {}, error() {} };
const CLIENTE = { nombre: 'Ana Compradora', email: 'ana@ejemplo.test' };

let db;
let servidor;
let base;
let servidorSinPagos;
let baseSinPagos;
const correos = [];
const sesionesCreadas = [];
const pagadas = new Set();

// Stripe simulado: registra lo que se le pide y deja decidir qué sesiones están pagadas.
const stripeFalso = {
  checkout: {
    sessions: {
      async create(parametros) {
        const id = `cs_test_${String(sesionesCreadas.length + 1).padStart(12, '0')}`;
        sesionesCreadas.push({ id, parametros });
        return { id, url: `https://checkout.stripe.test/pagar/${id}` };
      },
      async retrieve(id) {
        const creada = sesionesCreadas.find((s) => s.id === id);
        const importe = creada.parametros.line_items.reduce((t, l) => t + l.quantity * l.price_data.unit_amount, 0);
        return { id, payment_status: pagadas.has(id) ? 'paid' : 'unpaid', amount_total: importe, currency: 'eur' };
      },
    },
  },
  webhooks: {
    constructEvent(cuerpo, firma, secreto) {
      if (firma !== `firma-valida-${secreto}`) throw new Error('firma incorrecta');
      return JSON.parse(cuerpo.toString('utf8'));
    },
  },
};

async function pedir(ruta, { metodo = 'GET', cuerpo, cabeceras = {}, origen = base } = {}) {
  const crudo = typeof cuerpo === 'string';
  const respuesta = await fetch(origen + ruta, {
    method: metodo,
    headers: { ...(cuerpo ? { 'Content-Type': 'application/json' } : {}), ...cabeceras },
    body: cuerpo ? (crudo ? cuerpo : JSON.stringify(cuerpo)) : undefined,
  });
  return { status: respuesta.status, json: await respuesta.json() };
}

const comprar = (lineas, extra = {}) =>
  pedir('/api/pedidos', { metodo: 'POST', cuerpo: { ...CLIENTE, lineas, ...extra } });

const avisoStripe = (tipo, objeto, firma = 'firma-valida-whsec_prueba') =>
  pedir('/api/stripe/webhook', {
    metodo: 'POST',
    cuerpo: JSON.stringify({ type: tipo, data: { object: objeto } }),
    cabeceras: { 'stripe-signature': firma },
  });

before(async () => {
  const env = { NODE_ENV: 'test', ADMIN_PASSWORD: 'clave-de-pruebas-1' };
  db = await conectarBD(env);
  await prepararBD(db, env);
  const notificador = crearNotificador({
    env: { RESEND_API_KEY: 're_prueba', MAIL_FROM: 'PausatZen <citas@ejemplo.test>' },
    fetchImpl: async (_url, opciones) => {
      correos.push(JSON.parse(opciones.body));
      return new Response('{"id":"x"}', { status: 200 });
    },
    log: silencio,
  });
  const comun = { db, notificador, secretoSesion: 'x'.repeat(40), limitar: false };
  const pagos = crearPagos({ env: { STRIPE_WEBHOOK_SECRET: 'whsec_prueba' }, cliente: stripeFalso });
  servidor = crearApp({ ...comun, pagos, urlBase: 'https://pausatzen.test' }).listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
  servidorSinPagos = crearApp(comun).listen(0);
  baseSinPagos = `http://127.0.0.1:${servidorSinPagos.address().port}`;
});

after(async () => {
  servidor.close();
  servidorSinPagos.close();
  await db.cerrar();
});

test('la web publica el catálogo con los precios del programa', async () => {
  const { productos, pagoOnline } = (await pedir('/api/info')).json.data;
  assert.equal(pagoOnline, true);
  const precio = Object.fromEntries(productos.map((p) => [p.id, p.precio_cent]));
  assert.deepEqual(precio, {
    'shiatsu-75': 5500,
    'shiatsu-bono-3': 15000,
    'shiatsu-bono-5': 25000,
    'camilla-60': 6000,
    'camilla-90': 8000,
    'camilla-bono-3': 15500,
    'camilla-bono-5': 27000,
  });
  assert.equal((await pedir('/api/info', { origen: baseSinPagos })).json.data.pagoOnline, false);
});

test('sin clave de Stripe el pago online responde que no está disponible', async () => {
  const r = await pedir('/api/pedidos', {
    metodo: 'POST', origen: baseSinPagos, cuerpo: { ...CLIENTE, lineas: [{ id: 'shiatsu-75', cantidad: 1 }] },
  });
  assert.equal(r.status, 503);
});

test('un carrito con varios productos crea el pedido con los precios del catálogo', async () => {
  const r = await comprar(
    [{ id: 'shiatsu-75', cantidad: 2 }, { id: 'camilla-bono-3', cantidad: 1 }],
    // Un precio enviado por el navegador se ignora: manda el catálogo del servidor.
    { precio_cent: 1, total_cent: 1 },
  );
  assert.equal(r.status, 201);
  const { id, parametros } = sesionesCreadas.at(-1);
  assert.equal(r.json.data.url, `https://checkout.stripe.test/pagar/${id}`);
  assert.equal(parametros.mode, 'payment');
  assert.equal(parametros.customer_email, 'ana@ejemplo.test');
  assert.equal(parametros.success_url, 'https://pausatzen.test/pago-ok?sesion={CHECKOUT_SESSION_ID}');
  assert.deepEqual(parametros.line_items.map((l) => [l.quantity, l.price_data.unit_amount, l.price_data.currency]), [
    [2, 5500, 'eur'],
    [1, 15500, 'eur'],
  ]);
  const { rows } = await db.query('SELECT total_cent, estado, codigo FROM pedidos WHERE stripe_sesion = $1', [id]);
  assert.equal(rows[0].total_cent, 26500);
  assert.equal(rows[0].estado, 'pendiente');
  assert.match(rows[0].codigo, /^PZ-[A-Z2-9]{6}$/);
});

test('rechaza carritos vacíos, productos inventados, cantidades absurdas y datos incompletos', async () => {
  assert.equal((await comprar([])).status, 400);
  assert.equal((await comprar([{ id: 'masaje-gratis', cantidad: 1 }])).status, 400);
  assert.equal((await comprar([{ id: 'shiatsu-75', cantidad: 0 }])).status, 400);
  assert.equal((await comprar([{ id: 'shiatsu-75', cantidad: 99 }])).status, 400);
  assert.equal((await comprar([{ id: 'shiatsu-75', cantidad: 1 }, { id: 'shiatsu-75', cantidad: 1 }])).status, 400);
  assert.equal((await comprar([{ id: 'shiatsu-75', cantidad: 1 }], { email: 'no-es-correo' })).status, 400);
  assert.equal((await comprar([{ id: 'shiatsu-75', cantidad: 1 }], { nombre: '' })).status, 400);
});

test('el pedido no se da por pagado hasta que Stripe lo confirma', async () => {
  await comprar([{ id: 'shiatsu-bono-5', cantidad: 1 }]);
  const { id } = sesionesCreadas.at(-1);
  const antes = await pedir(`/api/pedidos/estado?sesion=${id}`);
  assert.equal(antes.json.data.estado, 'pendiente');
  assert.equal(correos.length, 0);

  pagadas.add(id);
  const despues = await pedir(`/api/pedidos/estado?sesion=${id}`);
  assert.equal(despues.json.data.estado, 'pagado');
  assert.equal(despues.json.data.total_cent, 25000);
  assert.equal(correos.length, 1);
  assert.deepEqual(correos[0].to, ['ana@ejemplo.test']);
  assert.match(correos[0].subject, /^Pago recibido · pedido PZ-/);
  assert.ok(correos[0].text.includes('1 × Shiatsu Zen · bono de 5 sesiones: 250,00'));

  // Consultar otra vez no reenvía el correo.
  await pedir(`/api/pedidos/estado?sesion=${id}`);
  assert.equal(correos.length, 1);
});

test('el aviso de Stripe marca el pedido como pagado una sola vez y exige firma válida', async () => {
  await comprar([{ id: 'camilla-90', cantidad: 1 }], { es_regalo: true, regalo_para: 'Marta', regalo_mensaje: 'Feliz cumple' });
  const { id } = sesionesCreadas.at(-1);
  const enviados = correos.length;

  const cobrado = { id, payment_status: 'paid', amount_total: 8000, currency: 'eur' };
  const falso = await avisoStripe('checkout.session.completed', cobrado, 'firma-falsa');
  assert.equal(falso.status, 400);
  assert.equal((await pedir(`/api/pedidos/estado?sesion=${id}`)).json.data.estado, 'pendiente');

  const sinCobrar = await avisoStripe('checkout.session.completed', { ...cobrado, payment_status: 'unpaid' });
  assert.equal(sinCobrar.status, 200);
  assert.equal((await pedir(`/api/pedidos/estado?sesion=${id}`)).json.data.estado, 'pendiente');

  // Un aviso con un importe distinto al del pedido no lo da por pagado.
  assert.equal((await avisoStripe('checkout.session.completed', { ...cobrado, amount_total: 100 })).status, 200);
  assert.equal((await pedir(`/api/pedidos/estado?sesion=${id}`)).json.data.estado, 'pendiente');

  assert.equal((await avisoStripe('checkout.session.completed', cobrado)).status, 200);
  assert.equal((await avisoStripe('checkout.session.completed', cobrado)).status, 200);
  assert.equal((await pedir(`/api/pedidos/estado?sesion=${id}`)).json.data.estado, 'pagado');
  assert.equal(correos.length, enviados + 1);
  assert.ok(correos.at(-1).text.includes('Es un regalo para Marta'));
});

test('una sesión de pago caducada cancela el pedido', async () => {
  await comprar([{ id: 'camilla-60', cantidad: 1 }]);
  const { id } = sesionesCreadas.at(-1);
  await avisoStripe('checkout.session.expired', { id });
  assert.equal((await pedir(`/api/pedidos/estado?sesion=${id}`)).json.data.estado, 'cancelado');

  // Si aun así el cobro llega más tarde, el dinero recibido no se pierde de vista.
  const enviados = correos.length;
  await avisoStripe('checkout.session.async_payment_succeeded', { id, payment_status: 'paid', amount_total: 6000, currency: 'eur' });
  assert.equal((await pedir(`/api/pedidos/estado?sesion=${id}`)).json.data.estado, 'pagado');
  assert.equal(correos.length, enviados + 1);
});

test('si Stripe falla al iniciar el pago, el pedido se descarta y los textos se limpian', async () => {
  const original = stripeFalso.checkout.sessions.create;
  stripeFalso.checkout.sessions.create = async () => { throw new Error('Stripe caído'); };
  const r = await comprar([{ id: 'shiatsu-75', cantidad: 1 }], { nombre: 'Fallo\u0000 Stripe' });
  stripeFalso.checkout.sessions.create = original;
  assert.equal(r.status, 502);
  const { rows } = await db.query("SELECT nombre, estado, stripe_sesion FROM pedidos WHERE nombre LIKE 'Fallo%'");
  assert.deepEqual(rows, [{ nombre: 'Fallo Stripe', estado: 'cancelado', stripe_sesion: null }]);
});

test('la consulta de estado valida la referencia y no inventa pedidos', async () => {
  assert.equal((await pedir('/api/pedidos/estado?sesion=hola')).status, 400);
  assert.equal((await pedir('/api/pedidos/estado?sesion=cs_test_999999999999')).status, 404);
});

test('el administrador ve los pedidos con sus líneas', async () => {
  const login = await fetch(`${base}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ usuario: 'admin', clave: 'clave-de-pruebas-1' }),
  });
  const cookie = login.headers.getSetCookie().map((g) => g.split(';')[0]).join('; ');
  assert.equal((await pedir('/api/admin/pedidos')).status, 401);
  const lista = await pedir('/api/admin/pedidos', { cabeceras: { Cookie: cookie } });
  assert.equal(lista.status, 200);
  const regalo = lista.json.data.pedidos.find((p) => p.es_regalo);
  assert.equal(regalo.estado, 'pagado');
  assert.equal(regalo.regalo_para, 'Marta');
  assert.deepEqual(regalo.lineas, [{ nombre: 'Masaje en camilla · sesión de 90 min', cantidad: 1 }]);
  assert.match(regalo.creado, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
});
