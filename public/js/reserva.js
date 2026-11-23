// Flujo de reserva: masaje → día → turno → hora → datos.
// El cliente nunca ve la ocupación de un día entero: solo los huecos del
// turno que ha pedido.
import { api, el, DIAS, NOMBRE_TURNO, NOMBRE_CANAL, diaSemana, fechaLarga, fechaISO, mayuscula } from './comun.js';

const $ = (id) => document.getElementById(id);
const PASOS_POSTERIORES = {
  masaje: ['paso-dia', 'paso-turno', 'paso-hora', 'paso-datos'],
  dia: ['paso-turno', 'paso-hora', 'paso-datos'],
  turno: ['paso-hora', 'paso-datos'],
  hora: ['paso-datos'],
};
const TEXTO_AVISO = {
  enviado: (canal) => `${NOMBRE_CANAL[canal]} de confirmación enviado.`,
  simulado: (canal) => `Recibirás la confirmación por ${canal === 'email' ? 'correo' : NOMBRE_CANAL[canal]}.`,
  error: (canal) => `No pudimos enviar el ${NOMBRE_CANAL[canal].toLowerCase()}, pero tu cita está guardada.`,
};

let info = null;
let estado = { servicio: null, duracion: null, fecha: null, turno: null, hora: null };
let mesVisible = null; // { anio, mes }

function cambiar(cambios) {
  estado = { ...estado, ...cambios };
}

function mostrarPaso(id) {
  const paso = $(id);
  const estabaOculto = paso.hidden;
  paso.hidden = false;
  if (estabaOculto) paso.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function ocultarDesde(clave) {
  for (const id of PASOS_POSTERIORES[clave]) $(id).hidden = true;
}

function avisar(id, mensaje) {
  const caja = $(id);
  caja.textContent = mensaje ?? '';
  caja.hidden = !mensaje;
}

function turnoAbierto(fecha, turno) {
  return info.horario.some((h) => h.dia === diaSemana(fecha) && h.turno === turno && h.activo);
}

function diaAbierto(fecha) {
  return fecha >= info.hoy && fecha <= info.ultimoDia
    && (turnoAbierto(fecha, 'manana') || turnoAbierto(fecha, 'tarde'));
}

/* ---------- Paso 1: masaje ---------- */
function elegirServicio(servicio, duracion) {
  cambiar({ servicio: servicio.id, duracion, turno: null, hora: null });
  pintarServicios();
  ocultarDesde('dia');
  pintarCalendario();
  mostrarPaso('paso-dia');
  if (estado.fecha) {
    pintarTurnos();
    mostrarPaso('paso-turno');
  }
}

function pintarServicios() {
  const nodos = info.servicios.map((servicio) => {
    const activo = estado.servicio === servicio.id;
    if (servicio.duraciones.length === 1) {
      const [duracion] = servicio.duraciones;
      return el('button', {
        type: 'button', class: 'opcion', 'aria-pressed': String(activo),
        onclick: () => elegirServicio(servicio, duracion),
      }, el('strong', { text: servicio.nombre }), el('small', { text: `${duracion} minutos` }));
    }
    return el('div', { class: `servicio${activo ? ' es-activo' : ''}` },
      el('p', { class: 'servicio__titulo', text: servicio.nombre }),
      el('div', { class: 'servicio__duraciones', role: 'group', 'aria-label': `Duración de ${servicio.nombre}` },
        servicio.duraciones.map((duracion) => el('button', {
          type: 'button', class: 'duracion',
          'aria-pressed': String(activo && estado.duracion === duracion),
          onclick: () => elegirServicio(servicio, duracion),
          text: `${duracion} minutos`,
        }))));
  });
  $('lista-servicios').replaceChildren(...nodos);
}

/* ---------- Paso 2: día ---------- */
function pintarCalendario() {
  const { anio, mes } = mesVisible;
  const primero = new Date(Date.UTC(anio, mes - 1, 1));
  const diasDelMes = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const hueco = (primero.getUTCDay() + 6) % 7;
  $('mes-titulo').textContent = mayuscula(
    new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(primero),
  );

  const celdas = Array.from({ length: hueco }, () => el('span'));
  for (let d = 1; d <= diasDelMes; d += 1) {
    const fecha = fechaISO(anio, mes, d);
    const abierto = diaAbierto(fecha);
    celdas.push(el('button', {
      type: 'button',
      class: `dia${fecha === info.hoy ? ' es-hoy' : ''}`,
      disabled: !abierto,
      'aria-pressed': String(estado.fecha === fecha),
      'aria-label': fechaLarga(fecha) + (abierto ? '' : ' (no disponible)'),
      onclick: () => elegirDia(fecha),
      text: String(d),
    }));
  }
  $('dias').replaceChildren(...celdas);

  $('mes-anterior').disabled = fechaISO(anio, mes, 1) <= info.hoy;
  $('mes-siguiente').disabled = fechaISO(anio, mes, diasDelMes) >= info.ultimoDia;
}

function moverMes(paso) {
  const fecha = new Date(Date.UTC(mesVisible.anio, mesVisible.mes - 1 + paso, 1));
  mesVisible = { anio: fecha.getUTCFullYear(), mes: fecha.getUTCMonth() + 1 };
  pintarCalendario();
}

function elegirDia(fecha) {
  cambiar({ fecha, turno: null, hora: null });
  pintarCalendario();
  ocultarDesde('turno');
  pintarTurnos();
  mostrarPaso('paso-turno');
}

/* ---------- Paso 3: turno ---------- */
function pintarTurnos() {
  const nodos = ['manana', 'tarde'].map((turno) => {
    const abierto = turnoAbierto(estado.fecha, turno);
    return el('button', {
      type: 'button', class: 'opcion', disabled: !abierto,
      'aria-pressed': String(estado.turno === turno),
      onclick: () => elegirTurno(turno),
    }, el('strong', { text: NOMBRE_TURNO[turno] }),
    el('small', { text: abierto ? fechaLarga(estado.fecha) : 'Cerrado ese día' }));
  });
  $('lista-turnos').replaceChildren(...nodos);
}

async function elegirTurno(turno) {
  cambiar({ turno, hora: null });
  pintarTurnos();
  ocultarDesde('hora');
  mostrarPaso('paso-hora');
  await cargarHuecos();
}

/* ---------- Paso 4: hora ---------- */
async function cargarHuecos() {
  const zona = $('zona-huecos');
  zona.replaceChildren(el('p', { class: 'cargando', text: 'Buscando huecos…' }));
  const consulta = new URLSearchParams({
    fecha: estado.fecha, turno: estado.turno, servicio: estado.servicio, duracion: estado.duracion,
  });
  const pedido = `${estado.fecha}|${estado.turno}|${estado.servicio}|${estado.duracion}`;
  try {
    const datos = await api(`/api/disponibilidad?${consulta}`);
    // Si el cliente cambió de opinión mientras cargaba, se descarta la respuesta.
    if (pedido !== `${estado.fecha}|${estado.turno}|${estado.servicio}|${estado.duracion}`) return;
    zona.replaceChildren(datos.huecos.length > 0 ? listaHuecos(datos.huecos) : sinHuecos(datos.otroTurno));
  } catch (err) {
    zona.replaceChildren(el('p', { class: 'aviso', text: err.message }));
  }
}

function listaHuecos(huecos) {
  return el('div', { class: 'huecos', role: 'group', 'aria-label': 'Horas disponibles' },
    huecos.map((hora) => el('button', {
      type: 'button', class: 'ficha-hora', 'aria-pressed': String(estado.hora === hora),
      onclick: () => elegirHora(hora, huecos), text: hora,
    })));
}

function sinHuecos(otroTurno) {
  const acciones = [];
  if (turnoAbierto(estado.fecha, otroTurno)) {
    acciones.push(el('button', {
      type: 'button', class: 'boton boton--tinta',
      onclick: () => elegirTurno(otroTurno),
      text: `Probar por la ${NOMBRE_TURNO[otroTurno].toLowerCase()}`,
    }));
  }
  acciones.push(el('button', {
    type: 'button', class: 'boton boton--linea', onclick: volverAlDia, text: 'Elegir otro día',
  }));
  return el('div', { class: 'sin-huecos' },
    el('p', { text: `No nos quedan huecos el ${fechaLarga(estado.fecha)} por la ${NOMBRE_TURNO[estado.turno].toLowerCase()}.` }),
    el('div', { class: 'sin-huecos__acciones' }, acciones));
}

function volverAlDia() {
  cambiar({ fecha: null, turno: null, hora: null });
  ocultarDesde('dia');
  pintarCalendario();
  $('paso-dia').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function elegirHora(hora, huecos) {
  cambiar({ hora });
  $('zona-huecos').replaceChildren(listaHuecos(huecos));
  const servicio = info.servicios.find((s) => s.id === estado.servicio);
  $('resumen').textContent = `${servicio.nombre} de ${estado.duracion} minutos · ${fechaLarga(estado.fecha)} a las ${hora}`;
  avisar('aviso-datos', null);
  mostrarPaso('paso-datos');
}

/* ---------- Paso 5: datos ---------- */
function marcarInvalido(campo) {
  for (const id of ['nombre', 'telefono', 'email']) {
    $(id).setAttribute('aria-invalid', String(id === campo));
  }
  if (campo && $(campo)) $(campo).focus();
}

async function enviar(evento) {
  evento.preventDefault();
  const form = evento.currentTarget;
  const datos = new FormData(form);
  const cuerpo = {
    ...estado,
    nombre: datos.get('nombre'),
    telefono: datos.get('telefono'),
    email: datos.get('email'),
    canal: datos.get('canal'),
    web: datos.get('web'),
  };
  const boton = $('boton-confirmar');
  boton.disabled = true;
  boton.textContent = 'Confirmando…';
  avisar('aviso-datos', null);
  marcarInvalido(null);
  try {
    const cita = await api('/api/citas', { metodo: 'POST', cuerpo });
    mostrarConfirmacion(cita);
    form.reset();
    $('campo-canal').hidden = true;
  } catch (err) {
    if (err.status === 409) {
      cambiar({ hora: null });
      $('paso-datos').hidden = true;
      await cargarHuecos();
      avisar('aviso-general', err.message);
      $('paso-hora').scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      avisar('aviso-datos', err.message);
      marcarInvalido(err.campo);
    }
  } finally {
    boton.disabled = false;
    boton.textContent = 'Confirmar cita';
  }
}

function mostrarConfirmacion(cita) {
  const servicio = info.servicios.find((s) => s.id === cita.servicio);
  $('confirmada-cuando').textContent =
    `${servicio.nombre} · ${fechaLarga(cita.fecha)} a las ${cita.hora} (${cita.duracion} min)`;
  $('confirmada-avisos').replaceChildren(
    ...cita.avisos.map((a) => el('li', { text: TEXTO_AVISO[a.estado]?.(a.canal) ?? '' })),
  );
  $('pasos').hidden = true;
  avisar('aviso-general', null);
  const caja = $('confirmada');
  caja.hidden = false;
  caja.focus();
  caja.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function reiniciar() {
  cambiar({ servicio: null, duracion: null, fecha: null, turno: null, hora: null });
  $('confirmada').hidden = true;
  $('pasos').hidden = false;
  ocultarDesde('masaje');
  pintarServicios();
  $('paso-masaje').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* ---------- Información general ---------- */
function pintarHorario() {
  // Los días seguidos con el mismo horario se muestran juntos: «Lunes – Viernes».
  const grupos = [];
  DIAS.forEach((nombre, i) => {
    const texto = info.horario
      .filter((h) => h.dia === i + 1 && h.activo)
      .map((h) => `${h.inicio} – ${h.fin}`)
      .join('  ·  ');
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.texto === texto) grupos[grupos.length - 1] = { ...ultimo, hasta: nombre };
    else grupos.push({ desde: nombre, hasta: nombre, texto });
  });
  const filas = grupos.map(({ desde, hasta, texto }) => (
    el('div', { class: `horario__fila${texto === '' ? ' es-cerrado' : ''}` },
      el('dt', { text: desde === hasta ? desde : `${desde} – ${hasta}` }),
      el('dd', { text: texto || 'Cerrado' }))
  ));
  $('tabla-horario').replaceChildren(...filas);
}

function pintarDatosSalon() {
  for (const nodo of document.querySelectorAll('[data-salon]')) nodo.textContent = info.nombre;
  document.querySelector('[data-direccion]').textContent = info.direccion;
  const telefono = document.querySelector('[data-telefono]');
  telefono.textContent = info.telefono;
  telefono.hidden = !info.telefono;
}

async function iniciar() {
  try {
    info = await api('/api/info');
  } catch (err) {
    avisar('aviso-general', err.message);
    return;
  }
  const [anio, mes] = info.hoy.split('-').map(Number);
  mesVisible = { anio, mes };
  pintarDatosSalon();
  pintarHorario();
  pintarServicios();

  $('mes-anterior').addEventListener('click', () => moverMes(-1));
  $('mes-siguiente').addEventListener('click', () => moverMes(1));
  $('form-datos').addEventListener('submit', enviar);
  $('otra-cita').addEventListener('click', reiniciar);
  $('telefono').addEventListener('input', (e) => {
    $('campo-canal').hidden = e.target.value.trim() === '';
  });
}

iniciar();
