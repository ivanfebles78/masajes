// Tienda: tarifas con botón de añadir, carrito guardado en el navegador y
// salto a la página de pago de Stripe. Los precios que se cobran los decide
// siempre el servidor; aquí solo se muestran.
import { api, el, euros } from './comun.js';
import { infoLista } from './info.js';

const CLAVE = 'pausatzen-carrito';
const MAX_UNIDADES = 10;
const $ = (id) => document.getElementById(id);

let info = null;
let carrito = {}; // { idProducto: cantidad }

function leerGuardado() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CLAVE) ?? '{}');
    return Object.fromEntries(Object.entries(bruto).filter(([id, n]) => (
      info.productos.some((p) => p.id === id) && Number.isInteger(n) && n >= 1 && n <= MAX_UNIDADES
    )));
  } catch {
    return {};
  }
}

function guardar(nuevo) {
  carrito = nuevo;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(carrito));
  } catch {
    // Navegación privada sin almacenamiento: el carrito vive solo en esta página.
  }
  pintarCarrito();
}

const lineas = () => info.productos.filter((p) => carrito[p.id]).map((p) => ({ ...p, cantidad: carrito[p.id] }));
const total = () => lineas().reduce((suma, l) => suma + l.precio_cent * l.cantidad, 0);
const unidades = () => Object.values(carrito).reduce((a, b) => a + b, 0);

function cambiarCantidad(id, cantidad) {
  const { [id]: _quitado, ...resto } = carrito;
  guardar(cantidad >= 1 ? { ...resto, [id]: Math.min(cantidad, MAX_UNIDADES) } : resto);
}

function anadir(producto) {
  cambiarCantidad(producto.id, (carrito[producto.id] ?? 0) + 1);
  const aviso = $('carrito-aviso');
  aviso.textContent = `Añadido: ${producto.nombre}`;
  abrir();
}

/* ---------- Tarifas dentro de cada ficha de masaje ---------- */
function etiquetaCorta(producto) {
  return producto.nombre.split(' · ').slice(1).join(' · ');
}

function pintarTarifas() {
  for (const lista of document.querySelectorAll('[data-tarifas]')) {
    const filas = info.productos
      .filter((p) => p.servicio === lista.dataset.tarifas)
      .map((p) => el('li', { class: 'tarifa' },
        el('div', { class: 'tarifa__texto' },
          el('span', { class: 'tarifa__nombre', text: etiquetaCorta(p).replace(/^./, (c) => c.toUpperCase()) }),
          p.nota ? el('small', { text: p.nota }) : null),
        el('span', { class: 'tarifa__precio', text: euros(p.precio_cent) }),
        el('button', {
          type: 'button', class: 'tarifa__anadir', onclick: () => anadir(p),
          'aria-label': `Añadir al carrito: ${p.nombre}`, text: 'Añadir',
        })));
    lista.replaceChildren(...filas);
  }
}

/* ---------- Carrito ---------- */
function filaCarrito(linea) {
  const paso = (delta) => () => cambiarCantidad(linea.id, linea.cantidad + delta);
  return el('li', { class: 'linea' },
    el('div', { class: 'linea__texto' },
      el('span', { text: linea.nombre }),
      el('small', { text: `${euros(linea.precio_cent)} / ud.` })),
    el('div', { class: 'linea__cantidad' },
      el('button', { type: 'button', onclick: paso(-1), 'aria-label': `Quitar una unidad de ${linea.nombre}`, text: '−' }),
      el('span', { 'aria-live': 'polite', text: String(linea.cantidad) }),
      el('button', {
        type: 'button', onclick: paso(1), disabled: linea.cantidad >= MAX_UNIDADES,
        'aria-label': `Añadir una unidad de ${linea.nombre}`, text: '+',
      })),
    el('span', { class: 'linea__importe', text: euros(linea.precio_cent * linea.cantidad) }));
}

function pintarCarrito() {
  const n = unidades();
  $('carrito-contador').textContent = String(n);
  $('abrir-carrito').classList.toggle('tiene-productos', n > 0);
  $('abrir-carrito').setAttribute('aria-label', n === 1 ? 'Carrito: 1 producto' : `Carrito: ${n} productos`);

  const vacio = n === 0;
  $('carrito-vacio').hidden = !vacio;
  $('carrito-lleno').hidden = vacio;
  $('carrito-lineas').replaceChildren(...lineas().map(filaCarrito));
  $('carrito-total').textContent = euros(total());
}

function abrir() {
  const dialogo = $('carrito');
  if (!dialogo.open) dialogo.showModal();
}

function avisarError(mensaje) {
  const caja = $('carrito-error');
  caja.textContent = mensaje ?? '';
  caja.hidden = !mensaje;
}

async function pagar(evento) {
  evento.preventDefault();
  const datos = new FormData(evento.currentTarget);
  const esRegalo = datos.get('es_regalo') === 'on';
  const boton = $('boton-pagar');
  boton.disabled = true;
  boton.textContent = 'Abriendo el pago seguro…';
  avisarError(null);
  try {
    const { url } = await api('/api/pedidos', {
      metodo: 'POST',
      cuerpo: {
        lineas: lineas().map(({ id, cantidad }) => ({ id, cantidad })),
        nombre: datos.get('nombre'),
        email: datos.get('email'),
        telefono: datos.get('telefono'),
        es_regalo: esRegalo,
        regalo_para: datos.get('regalo_para'),
        regalo_mensaje: datos.get('regalo_mensaje'),
        web: datos.get('web'),
      },
    });
    window.location.assign(url);
  } catch (err) {
    avisarError(err.message);
    if (err.campo && evento.currentTarget?.elements?.[err.campo]) evento.currentTarget.elements[err.campo].focus();
    boton.disabled = false;
    boton.textContent = 'Pagar con tarjeta';
  }
}

async function iniciar() {
  try {
    info = await infoLista;
  } catch {
    return; // reserva.js ya muestra el aviso de error de carga.
  }
  carrito = leerGuardado();
  pintarTarifas();
  pintarCarrito();

  const disponible = info.pagoOnline;
  $('pago-no-disponible').hidden = disponible;
  $('boton-pagar').disabled = !disponible;
  for (const nodo of document.querySelectorAll('[data-pago-online]')) nodo.hidden = !disponible;

  $('abrir-carrito').addEventListener('click', abrir);
  $('cerrar-carrito').addEventListener('click', () => $('carrito').close());
  $('carrito').addEventListener('click', (e) => { if (e.target === $('carrito')) $('carrito').close(); });
  $('form-pago').addEventListener('submit', pagar);
  $('es-regalo').addEventListener('change', (e) => { $('campos-regalo').hidden = !e.target.checked; });
}

iniciar();
