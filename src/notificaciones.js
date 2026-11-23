// Avisos de confirmación: correo real por Resend; WhatsApp y SMS simulados
// (se registran en el log y en la base de datos) hasta contratar proveedor.
import { buscarServicio } from './config.js';
import { fechaLarga } from './slots.js';

const URL_RESEND = 'https://api.resend.com/emails';
const TIEMPO_MAX_MS = 8000;

function escaparHtml(valor) {
  return String(valor).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function nombreServicio(cita) {
  return buscarServicio(cita.servicio)?.nombre ?? 'Masaje';
}

function textoConfirmacion(cita, ajustes) {
  const lineas = [
    `Hola ${cita.nombre}, tu cita en ${ajustes.nombre_salon} está confirmada:`,
    `${nombreServicio(cita)} · ${fechaLarga(cita.fecha)} a las ${cita.hora} (${cita.duracion} min).`,
  ];
  if (ajustes.direccion) lineas.push(ajustes.direccion);
  if (ajustes.telefono_salon) {
    lineas.push(`Si necesitas cambiarla o anularla, llámanos al ${ajustes.telefono_salon}.`);
  }
  return lineas.join('\n');
}

function htmlConfirmacion(cita, ajustes) {
  const e = escaparHtml;
  const contacto = ajustes.telefono_salon
    ? `<p style="margin:24px 0 0;color:#6b645a;font-size:14px">Si necesitas cambiarla o anularla, llámanos al ${e(ajustes.telefono_salon)}.</p>`
    : '';
  return `<!doctype html><html lang="es"><body style="margin:0;background:#f4efe6;font-family:Georgia,serif;color:#1c1a17">
<div style="max-width:520px;margin:0 auto;padding:40px 28px">
  <p style="margin:0;letter-spacing:.2em;text-transform:uppercase;font-size:12px;color:#c8371f">${e(ajustes.nombre_salon)}</p>
  <h1 style="margin:12px 0 24px;font-size:28px;font-weight:normal">Tu cita está confirmada</h1>
  <p style="margin:0 0 20px;font-size:16px">Hola ${e(cita.nombre)}, te esperamos:</p>
  <div style="border-left:3px solid #c8371f;padding:6px 0 6px 18px">
    <p style="margin:0 0 6px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#6b645a">${e(nombreServicio(cita))}</p>
    <p style="margin:0;font-size:20px">${e(fechaLarga(cita.fecha))}</p>
    <p style="margin:6px 0 0;font-size:20px">${e(cita.hora)} h · ${e(cita.duracion)} minutos</p>
    <p style="margin:6px 0 0;font-size:15px;color:#6b645a">${e(ajustes.direccion)}</p>
  </div>
  <p style="margin:24px 0 0;font-size:15px">Ven con ropa cómoda y, si puedes, llega cinco minutos antes.</p>
  ${contacto}
</div></body></html>`;
}

export function crearNotificador({ env = process.env, fetchImpl = fetch, log = console } = {}) {
  async function enviarCorreo(cita, ajustes) {
    const base = { canal: 'email', destino: cita.email };
    if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
      log.warn('[avisos] Correo SIMULADO (faltan RESEND_API_KEY o MAIL_FROM) para la cita', cita.id);
      return { ...base, estado: 'simulado', detalle: 'Resend sin configurar' };
    }
    try {
      const respuesta = await fetchImpl(URL_RESEND, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.MAIL_FROM,
          to: [cita.email],
          subject: `Cita confirmada · ${fechaLarga(cita.fecha)} a las ${cita.hora}`,
          html: htmlConfirmacion(cita, ajustes),
          text: textoConfirmacion(cita, ajustes),
        }),
        signal: AbortSignal.timeout(TIEMPO_MAX_MS),
      });
      if (!respuesta.ok) {
        log.error('[avisos] Resend rechazó el correo de la cita', cita.id, respuesta.status);
        return { ...base, estado: 'error', detalle: `Resend ${respuesta.status}` };
      }
      return { ...base, estado: 'enviado', detalle: '' };
    } catch (err) {
      log.error('[avisos] Fallo al enviar el correo de la cita', cita.id, err.message);
      return { ...base, estado: 'error', detalle: err.message.slice(0, 200) };
    }
  }

  function enviarMensajeMovil(cita, ajustes) {
    // Cuando haya proveedor, aquí se envía textoConfirmacion(cita, ajustes).
    const caracteres = textoConfirmacion(cita, ajustes).length;
    log.info(`[avisos] ${cita.canal.toUpperCase()} SIMULADO para la cita ${cita.id} (${caracteres} caracteres)`);
    return { canal: cita.canal, destino: cita.telefono, estado: 'simulado', detalle: 'Proveedor pendiente' };
  }

  /** Envía los avisos que correspondan según los datos que dejó el cliente. */
  async function enviarConfirmacion(cita, ajustes) {
    const avisos = [];
    if (cita.email) avisos.push(await enviarCorreo(cita, ajustes));
    if (cita.telefono && cita.canal) avisos.push(enviarMensajeMovil(cita, ajustes));
    return avisos;
  }

  return { enviarConfirmacion };
}
