// Utilidades compartidas por la web pública y el panel.

export class ErrorApi extends Error {
  constructor(mensaje, status, campo) {
    super(mensaje);
    this.status = status;
    this.campo = campo ?? null;
  }
}

/** Llama a la API y devuelve `data`; lanza ErrorApi con el mensaje del servidor. */
export async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  let respuesta;
  try {
    respuesta = await fetch(ruta, {
      method: metodo,
      headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined,
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      credentials: 'same-origin',
    });
  } catch {
    throw new ErrorApi('No hay conexión. Comprueba tu red e inténtalo de nuevo.', 0);
  }
  const json = await respuesta.json().catch(() => null);
  if (!respuesta.ok || !json?.ok) {
    throw new ErrorApi(json?.error ?? 'Ha ocurrido un error. Inténtalo de nuevo.', respuesta.status, json?.campo);
  }
  return json.data ?? null;
}

/** Crea un elemento con atributos y hijos sin usar innerHTML. */
export function el(etiqueta, atributos = {}, ...hijos) {
  const nodo = document.createElement(etiqueta);
  for (const [clave, valor] of Object.entries(atributos)) {
    if (valor === false || valor === null || valor === undefined) continue;
    if (clave === 'class') nodo.className = valor;
    else if (clave === 'text') nodo.textContent = valor;
    else if (clave.startsWith('on')) nodo.addEventListener(clave.slice(2), valor);
    else if (valor === true) nodo.setAttribute(clave, '');
    else nodo.setAttribute(clave, valor);
  }
  for (const hijo of hijos.flat()) {
    if (hijo !== null && hijo !== undefined && hijo !== false) nodo.append(hijo);
  }
  return nodo;
}

/**
 * Escribe el nombre del salón. Si es «PausatZen» lo compone como logotipo,
 * con la «t» destacada para que se lea Pausa+Zen.
 */
export function pintarNombre(nodo, nombre) {
  const esLogotipo = nombre.toLowerCase() === 'pausatzen';
  nodo.classList.toggle('es-logotipo', esLogotipo);
  if (esLogotipo) nodo.replaceChildren('Pausa', el('span', { class: 'marca__t', text: 't' }), 'Zen');
  else nodo.textContent = nombre;
}

export const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const NOMBRE_TURNO = { manana: 'Mañana', mediodia: 'Mediodía', tarde: 'Tarde' };
export const EN_TURNO = { manana: 'por la mañana', mediodia: 'al mediodía', tarde: 'por la tarde' };
export const NOMBRE_CANAL = { email: 'Correo', whatsapp: 'WhatsApp', sms: 'SMS' };

function aUTC(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

/** 1 = lunes … 7 = domingo. */
export function diaSemana(fecha) {
  const dia = aUTC(fecha).getUTCDay();
  return dia === 0 ? 7 : dia;
}

export function fechaLarga(fecha) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(aUTC(fecha));
}

const FORMATO_EUROS = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** 5500 → «55 €». */
export function euros(centimos) {
  return FORMATO_EUROS.format(centimos / 100);
}

export function mayuscula(texto) {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

export function fechaISO(anio, mes, dia) {
  return `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}
