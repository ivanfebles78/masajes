// Página de vuelta tras pagar en Stripe: pregunta al servidor si el pago está
// realmente confirmado antes de dar las gracias.
import { api, el, euros } from './comun.js';

const CLAVE_CARRITO = 'pausatzen-carrito';
const INTENTOS = 6;
const ESPERA_MS = 2000;
const $ = (id) => document.getElementById(id);
const espera = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

function mostrar({ titulo, texto, lineas = [], total = null }) {
  $('pago-titulo').textContent = titulo;
  $('pago-texto').textContent = texto;
  const filas = lineas.map((l) => el('li', {},
    el('span', { text: `${l.cantidad} × ${l.nombre}` }),
    el('span', { text: euros(l.precio_cent * l.cantidad) })));
  if (total !== null) filas.push(el('li', { class: 'es-total' }, el('span', { text: 'Total pagado' }), el('span', { text: euros(total) })));
  $('pago-lineas').replaceChildren(...filas);
  $('pago-lineas').hidden = filas.length === 0;
}

async function comprobar() {
  const sesion = new URLSearchParams(window.location.search).get('sesion') ?? '';
  if (!sesion) {
    mostrar({ titulo: 'No encontramos tu pago', texto: 'Falta la referencia del pago. Si has pagado, escríbenos y lo revisamos.' });
    return;
  }
  for (let intento = 0; intento < INTENTOS; intento += 1) {
    let pedido;
    try {
      pedido = await api(`/api/pedidos/estado?sesion=${encodeURIComponent(sesion)}`);
    } catch (err) {
      mostrar({ titulo: 'No hemos podido comprobar el pago', texto: `${err.message} Si has pagado, escríbenos y lo revisamos.` });
      return;
    }
    if (pedido.estado === 'pagado') {
      try { localStorage.removeItem(CLAVE_CARRITO); } catch { /* sin almacenamiento */ }
      mostrar({
        titulo: 'Pago recibido. ¡Gracias!',
        texto: `Tu pedido es el ${pedido.codigo}. Te hemos enviado el justificante por correo. Ya puedes reservar tu sesión.`,
        lineas: pedido.lineas,
        total: pedido.total_cent,
      });
      $('pago-reservar').hidden = false;
      return;
    }
    if (pedido.estado === 'cancelado') {
      mostrar({ titulo: 'El pago no se completó', texto: 'No se ha cobrado nada. Puedes volver a intentarlo desde el carrito.' });
      return;
    }
    await espera(ESPERA_MS);
  }
  mostrar({
    titulo: 'Estamos confirmando tu pago',
    texto: 'El banco todavía no lo ha confirmado. Recibirás un correo en cuanto esté; no hace falta que pagues otra vez.',
  });
}

comprobar();
