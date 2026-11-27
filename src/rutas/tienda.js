// Tienda: creación de pedidos, pago con Stripe y confirmación.
import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { AJUSTES_POR_DEFECTO } from '../config.js';
import { validarPedido } from '../validacion.js';
import { leerAjustes } from '../servicio.js';
import { MONEDA } from '../pagos.js';
import {
  crearPedido,
  descartarPedido,
  guardarSesionDePago,
  marcarCaducado,
  marcarPagado,
  pedidoPorSesion,
} from '../pedidos.js';

const VENTANA_MS = 60 * 60 * 1000;
const MAX_PEDIDOS = 12;
const MAX_CONSULTAS = 60;
const RE_SESION = /^cs_[A-Za-z0-9_]{10,200}$/;
const LIMITE_WEBHOOK = '200kb';

function limitador(limit, mensaje, activo) {
  if (!activo) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: VENTANA_MS,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: mensaje },
  });
}

/**
 * Marca el pedido como pagado y, si esta llamada hizo el cambio, envía el correo.
 * `cobro` es lo que Stripe dice haber cobrado: si no cuadra con el pedido no se
 * da por bueno (no debería ocurrir: los importes los fija este servidor).
 */
async function confirmarPago({ db, notificador, urlBase }, idSesion, cobro) {
  const previo = await pedidoPorSesion(db, idSesion);
  if (!previo) return;
  if (cobro.importe !== previo.total_cent || cobro.moneda !== MONEDA) {
    console.error('[tienda] El cobro no coincide con el pedido', previo.codigo, cobro.importe, cobro.moneda);
    return;
  }
  const pedido = await marcarPagado(db, idSesion);
  if (!pedido) return;
  try {
    const ajustes = await leerAjustes(db).catch(() => AJUSTES_POR_DEFECTO);
    const envio = await notificador.enviarPedido(pedido, ajustes, urlBase);
    if (envio.estado === 'error') {
      console.error('[tienda] No se pudo enviar el justificante del pedido', pedido.codigo, envio.detalle);
    }
  } catch (err) {
    // El pago ya está registrado: un fallo del correo no debe deshacerlo.
    console.error('[tienda] Error al enviar el correo del pedido', pedido.codigo, err.message);
  }
}

/** Aviso de Stripe. Necesita el cuerpo sin procesar para comprobar la firma. */
export function rutaWebhook({ db, pagos, notificador, urlPublica }) {
  const router = Router();
  router.post('/', express.raw({ type: 'application/json', limit: LIMITE_WEBHOOK }), async (req, res) => {
    if (!pagos.webhookActivo) return res.status(503).json({ ok: false, error: 'Webhook sin configurar.' });
    let evento;
    try {
      evento = pagos.eventoDeWebhook(req.body, req.get('stripe-signature') ?? '');
    } catch {
      return res.status(400).json({ ok: false, error: 'Firma no válida.' });
    }
    const sesion = evento.data?.object;
    const pagado = evento.type === 'checkout.session.async_payment_succeeded'
      || (evento.type === 'checkout.session.completed' && sesion?.payment_status === 'paid');
    if (pagado) {
      await confirmarPago({ db, notificador, urlBase: urlPublica(req) }, sesion.id,
        { importe: sesion.amount_total, moneda: sesion.currency });
    }
    else if (evento.type === 'checkout.session.expired') await marcarCaducado(db, sesion.id);
    res.json({ ok: true });
  });
  return router;
}

export function rutasTienda({ db, pagos, notificador, limitar, urlPublica }) {
  const router = Router();
  const limitePedidos = limitador(MAX_PEDIDOS, 'Demasiados pedidos desde tu conexión. Prueba más tarde.', limitar);
  const limiteConsultas = limitador(MAX_CONSULTAS, 'Demasiadas consultas. Prueba en unos minutos.', limitar);

  router.post('/pedidos', limitePedidos, async (req, res) => {
    if (typeof req.body?.web === 'string' && req.body.web.trim() !== '') {
      return res.status(400).json({ ok: false, error: 'No se pudo procesar la solicitud.' });
    }
    if (!pagos.activo) {
      return res.status(503).json({ ok: false, error: 'El pago online todavía no está disponible.' });
    }
    const pedido = await crearPedido(db, validarPedido(req.body));
    let sesion;
    try {
      sesion = await pagos.crearSesion({ pedido, lineas: pedido.lineas, urlBase: urlPublica(req) });
    } catch (err) {
      console.error('[tienda] Stripe no pudo crear la sesión del pedido', pedido.codigo, err.message);
      await descartarPedido(db, pedido.id);
      return res.status(502).json({ ok: false, error: 'No se pudo iniciar el pago. Inténtalo de nuevo.' });
    }
    await guardarSesionDePago(db, pedido.id, sesion.id);
    res.status(201).json({ ok: true, data: { url: sesion.url } });
  });

  // La página de «pago correcto» consulta aquí. No se fía de haber llegado a
  // esa URL: pregunta a Stripe si la sesión está realmente pagada.
  router.get('/pedidos/estado', limiteConsultas, async (req, res) => {
    const idSesion = typeof req.query.sesion === 'string' ? req.query.sesion : '';
    if (!RE_SESION.test(idSesion)) return res.status(400).json({ ok: false, error: 'Referencia de pago no válida.' });
    let pedido = await pedidoPorSesion(db, idSesion);
    if (!pedido) return res.status(404).json({ ok: false, error: 'No encontramos ese pedido.' });
    if (pedido.estado !== 'pagado' && pagos.activo) {
      const cobro = await pagos.leerCobro(idSesion);
      if (cobro.pagada) {
        await confirmarPago({ db, notificador, urlBase: urlPublica(req) }, idSesion, cobro);
        pedido = await pedidoPorSesion(db, idSesion);
      }
    }
    res.json({
      ok: true,
      data: {
        codigo: pedido.codigo,
        estado: pedido.estado,
        total_cent: pedido.total_cent,
        lineas: pedido.lineas.map(({ nombre, cantidad, precio_cent }) => ({ nombre, cantidad, precio_cent })),
      },
    });
  });

  return router;
}
