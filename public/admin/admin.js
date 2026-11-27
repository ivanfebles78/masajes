// Panel de administración.
import { api, el, DIAS, NOMBRE_TURNO, NOMBRE_CANAL, fechaLarga, mayuscula, pintarNombre } from '/js/comun.js';

const $ = (id) => document.getElementById(id);
const SECCIONES = ['citas', 'horario', 'bloqueos', 'ajustes'];
const NOMBRE_SERVICIO = { shiatsu: 'Shiatsu Zen', camilla: 'Masaje en camilla' };
const MS_AVISO = 4000;
const TURNOS = ['manana', 'mediodia', 'tarde'];

let temporizadorAviso = null;

function avisar(mensaje, esError = false) {
  const caja = $('aviso-panel');
  caja.textContent = mensaje;
  caja.className = esError ? 'aviso' : 'aviso aviso--ok';
  caja.hidden = false;
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => { caja.hidden = true; }, MS_AVISO);
}

function mostrarAcceso() {
  $('vista-panel').hidden = true;
  $('vista-acceso').hidden = false;
  $('usuario').focus();
}

/** Ejecuta una acción del panel; si la sesión ha caducado vuelve al acceso. */
async function intentar(accion) {
  try {
    return await accion();
  } catch (err) {
    if (err.status === 401) mostrarAcceso();
    else avisar(err.message, true);
    return undefined;
  }
}

/* ---------- Citas ---------- */
function filaCita(cita) {
  const cancelada = cita.estado === 'cancelada';
  const contacto = [];
  if (cita.telefono) contacto.push(el('a', { href: `tel:${cita.telefono}`, text: cita.telefono }));
  if (cita.telefono && cita.email) contacto.push(' · ');
  if (cita.email) contacto.push(el('a', { href: `mailto:${cita.email}`, text: cita.email }));

  const etiquetas = cancelada
    ? [el('span', { class: 'etiqueta etiqueta--error', text: 'Cancelada' })]
    : cita.avisos.map((a) => el('span', {
        class: `etiqueta etiqueta--${a.estado}`,
        text: `${NOMBRE_CANAL[a.canal] ?? a.canal}: ${a.estado}`,
      }));

  return el('article', { class: `cita${cancelada ? ' es-cancelada' : ''}` },
    el('p', { class: 'cita__hora', text: cita.hora }, el('small', { text: `${cita.duracion_min} min` })),
    el('div', {},
      el('p', { class: 'cita__nombre', text: cita.nombre }),
      el('p', { class: 'cita__servicio', text: NOMBRE_SERVICIO[cita.servicio] ?? cita.servicio })),
    el('div', {},
      el('p', { class: 'cita__contacto' }, contacto),
      el('div', { class: 'etiquetas' }, etiquetas)),
    el('div', { class: 'cita__accion' },
      cancelada ? null : el('button', {
        type: 'button', class: 'boton-mini', text: 'Cancelar', onclick: () => cancelarCita(cita),
      })));
}

async function cargarCitas() {
  const consulta = new URLSearchParams();
  if ($('filtro-desde').value) consulta.set('desde', $('filtro-desde').value);
  if ($('filtro-hasta').value) consulta.set('hasta', $('filtro-hasta').value);
  const datos = await intentar(() => api(`/api/admin/citas?${consulta}`));
  if (!datos) return;
  $('filtro-desde').value = datos.desde;
  $('filtro-hasta').value = datos.hasta;

  const verCanceladas = $('filtro-canceladas').checked;
  const visibles = datos.citas.filter((c) => verCanceladas || c.estado === 'confirmada');
  if (visibles.length === 0) {
    $('lista-citas').replaceChildren(el('p', { class: 'vacio', text: 'No hay citas en estas fechas.' }));
    return;
  }
  const porDia = new Map();
  for (const cita of visibles) {
    porDia.set(cita.fecha, [...(porDia.get(cita.fecha) ?? []), cita]);
  }
  const bloques = [...porDia].map(([fecha, citas]) => {
    const activas = citas.filter((c) => c.estado === 'confirmada').length;
    return el('section', { class: 'dia-citas' },
      el('h2', { class: 'dia-citas__fecha', text: mayuscula(fechaLarga(fecha)) },
        el('small', { text: `${activas} ${activas === 1 ? 'cita' : 'citas'}` })),
      citas.map(filaCita));
  });
  $('lista-citas').replaceChildren(...bloques);
}

async function cancelarCita(cita) {
  const seguro = window.confirm(
    `¿Cancelar la cita de ${cita.nombre} del ${fechaLarga(cita.fecha)} a las ${cita.hora}?\n` +
    'El hueco volverá a estar disponible. No se avisa al cliente automáticamente.',
  );
  if (!seguro) return;
  const hecho = await intentar(async () => {
    await api(`/api/admin/citas/${cita.id}/cancelar`, { metodo: 'POST' });
    return true;
  });
  if (!hecho) return;
  avisar('Cita cancelada.');
  await cargarCitas();
}

/* ---------- Horario ---------- */
function editorTurno(fila) {
  const caja = el('div', { class: `turno-edit${fila.activo ? '' : ' es-inactivo'}`, 'data-dia': fila.dia_semana, 'data-turno': fila.turno });
  const activo = el('input', { type: 'checkbox', checked: fila.activo, 'data-campo': 'activo' });
  activo.addEventListener('change', () => caja.classList.toggle('es-inactivo', !activo.checked));
  caja.append(
    el('label', { class: 'turno-edit__activo' }, activo, el('span', { class: 'turno-edit__nombre', text: NOMBRE_TURNO[fila.turno] })),
    el('input', { type: 'time', value: fila.inicio, step: '300', 'data-campo': 'inicio', 'aria-label': `Inicio ${NOMBRE_TURNO[fila.turno]} ${DIAS[fila.dia_semana - 1]}` }),
    el('span', { class: 'turno-edit__guion', 'aria-hidden': 'true', text: '–' }),
    el('input', { type: 'time', value: fila.fin, step: '300', 'data-campo': 'fin', 'aria-label': `Fin ${NOMBRE_TURNO[fila.turno]} ${DIAS[fila.dia_semana - 1]}` }),
  );
  return caja;
}

function pintarHorario(horario) {
  const filas = DIAS.map((nombre, i) => {
    const delDia = horario.filter((h) => h.dia_semana === i + 1);
    const orden = TURNOS.map((t) => delDia.find((h) => h.turno === t)).filter(Boolean);
    return el('div', { class: 'fila-horario' },
      el('p', { class: 'fila-horario__dia', text: nombre }),
      orden.map(editorTurno));
  });
  const cabecera = el('div', { class: 'fila-horario fila-horario--cabecera', 'aria-hidden': 'true' },
    el('span'),
    TURNOS.map((turno) => el('span', { text: NOMBRE_TURNO[turno] })));
  $('tabla-horario-admin').replaceChildren(cabecera, ...filas);
}

async function cargarHorario() {
  const datos = await intentar(() => api('/api/admin/horario'));
  if (datos) pintarHorario(datos.horario);
}

async function guardarHorario(evento) {
  evento.preventDefault();
  const horario = [...document.querySelectorAll('.turno-edit')].map((caja) => ({
    dia_semana: Number(caja.dataset.dia),
    turno: caja.dataset.turno,
    activo: caja.querySelector('[data-campo="activo"]').checked,
    inicio: caja.querySelector('[data-campo="inicio"]').value,
    fin: caja.querySelector('[data-campo="fin"]').value,
  }));
  const datos = await intentar(() => api('/api/admin/horario', { metodo: 'PUT', cuerpo: { horario } }));
  if (!datos) return;
  pintarHorario(datos.horario);
  avisar('Horario guardado.');
}

/* ---------- Días cerrados ---------- */
async function cargarBloqueos() {
  const datos = await intentar(() => api('/api/admin/bloqueos'));
  if (!datos) return;
  const filas = datos.bloqueos.map((b) => el('li', {},
    el('div', {},
      el('strong', { text: mayuscula(fechaLarga(b.fecha)) }),
      ' ',
      el('span', { text: `${b.turno ? `Solo ${NOMBRE_TURNO[b.turno].toLowerCase()}` : 'Todo el día'}${b.motivo ? ` · ${b.motivo}` : ''}` })),
    el('button', { type: 'button', class: 'boton-mini', text: 'Quitar', onclick: () => quitarBloqueo(b.id) })));
  $('lista-bloqueos').replaceChildren(
    ...(filas.length > 0 ? filas : [el('li', {}, el('span', { text: 'No hay días cerrados próximamente.' }))]),
  );
}

async function crearBloqueo(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const cuerpo = Object.fromEntries(new FormData(form));
  const hecho = await intentar(async () => {
    await api('/api/admin/bloqueos', { metodo: 'POST', cuerpo });
    return true;
  });
  if (!hecho) return;
  form.reset();
  avisar('Día cerrado. Las citas ya reservadas ese día no se cancelan solas.');
  await cargarBloqueos();
}

async function quitarBloqueo(id) {
  const hecho = await intentar(async () => {
    await api(`/api/admin/bloqueos/${id}`, { metodo: 'DELETE' });
    return true;
  });
  if (hecho) await cargarBloqueos();
}

/* ---------- Ajustes ---------- */
function pintarAjustes(ajustes) {
  pintarNombre($('nombre-salon'), ajustes.nombre_salon);
  $('aj-nombre').value = ajustes.nombre_salon;
  $('aj-direccion').value = ajustes.direccion;
  $('aj-telefono').value = ajustes.telefono_salon;
  $('aj-antelacion').value = ajustes.antelacion_horas;
  $('aj-max').value = ajustes.max_dias;
}

async function cargarAjustes() {
  const datos = await intentar(() => api('/api/admin/ajustes'));
  if (datos) pintarAjustes(datos.ajustes);
}

async function guardarAjustes(evento) {
  evento.preventDefault();
  const cuerpo = Object.fromEntries(new FormData(evento.currentTarget));
  const datos = await intentar(() => api('/api/admin/ajustes', { metodo: 'PUT', cuerpo }));
  if (!datos) return;
  pintarAjustes(datos.ajustes);
  avisar('Ajustes guardados.');
}

async function cambiarClave(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const { actual, nueva, repite } = Object.fromEntries(new FormData(form));
  if (nueva !== repite) {
    avisar('Las dos contraseñas nuevas no coinciden.', true);
    return;
  }
  const hecho = await intentar(async () => {
    await api('/api/admin/clave', { metodo: 'PUT', cuerpo: { actual, nueva } });
    return true;
  });
  if (!hecho) return;
  form.reset();
  avisar('Contraseña cambiada.');
}

/* ---------- Navegación y sesión ---------- */
const CARGADORES = { citas: cargarCitas, horario: cargarHorario, bloqueos: cargarBloqueos, ajustes: cargarAjustes };

function abrirPestana(nombre) {
  for (const seccion of SECCIONES) {
    $(`seccion-${seccion}`).hidden = seccion !== nombre;
    document.querySelector(`[data-pestana="${seccion}"]`).setAttribute('aria-selected', String(seccion === nombre));
  }
  CARGADORES[nombre]();
}

async function mostrarPanel() {
  $('vista-acceso').hidden = true;
  $('vista-panel').hidden = false;
  await cargarAjustes();
  abrirPestana('citas');
}

async function entrar(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const aviso = $('aviso-acceso');
  aviso.hidden = true;
  try {
    await api('/api/admin/login', { metodo: 'POST', cuerpo: Object.fromEntries(new FormData(form)) });
    form.reset();
    await mostrarPanel();
  } catch (err) {
    aviso.textContent = err.message;
    aviso.hidden = false;
  }
}

async function salir() {
  await api('/api/admin/logout', { metodo: 'POST' }).catch(() => {});
  mostrarAcceso();
}

async function iniciar() {
  $('form-acceso').addEventListener('submit', entrar);
  $('salir').addEventListener('click', salir);
  $('form-filtro').addEventListener('submit', (e) => { e.preventDefault(); cargarCitas(); });
  $('filtro-canceladas').addEventListener('change', cargarCitas);
  $('form-horario').addEventListener('submit', guardarHorario);
  $('form-bloqueo').addEventListener('submit', crearBloqueo);
  $('form-ajustes').addEventListener('submit', guardarAjustes);
  $('form-clave').addEventListener('submit', cambiarClave);
  for (const boton of document.querySelectorAll('[data-pestana]')) {
    boton.addEventListener('click', () => abrirPestana(boton.dataset.pestana));
  }

  try {
    await api('/api/admin/sesion');
    await mostrarPanel();
  } catch {
    mostrarAcceso();
  }
}

iniciar();
