// Pedidos de la tienda (sesiones sueltas y bonos pagados online).
import { randomInt } from 'node:crypto';
import { buscarProducto } from './config.js';

const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I
const LARGO_CODIGO = 6;

function nuevoCodigo() {
  let codigo = 'PZ-';
  for (let i = 0; i < LARGO_CODIGO; i += 1) codigo += ALFABETO_CODIGO[randomInt(ALFABETO_CODIGO.length)];
  return codigo;
}

/** Convierte las líneas pedidas en líneas con nombre y precio del catálogo (nunca del cliente). */
export function lineasDeCatalogo(lineasPedidas) {
  return lineasPedidas.map(({ id, cantidad }) => {
    const producto = buscarProducto(id);
    return { producto_id: producto.id, nombre: producto.nombre, precio_cent: producto.precio_cent, cantidad };
  });
}

export function totalDe(lineas) {
  return lineas.reduce((suma, l) => suma + l.precio_cent * l.cantidad, 0);
}

export async function crearPedido(db, datos) {
  const lineas = lineasDeCatalogo(datos.lineas);
  const total = totalDe(lineas);
  return db.transaccion(async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO pedidos (codigo, nombre, email, telefono, es_regalo, regalo_para, regalo_mensaje, total_cent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, codigo`,
      [nuevoCodigo(), datos.nombre, datos.email, datos.telefono, datos.es_regalo,
        datos.regalo_para, datos.regalo_mensaje, total],
    );
    const pedido = rows[0];
    for (const l of lineas) {
      await tx.query(
        `INSERT INTO pedido_lineas (pedido_id, producto_id, nombre, precio_cent, cantidad)
         VALUES ($1, $2, $3, $4, $5)`,
        [pedido.id, l.producto_id, l.nombre, l.precio_cent, l.cantidad],
      );
    }
    return { ...datos, id: pedido.id, codigo: pedido.codigo, total_cent: total, lineas };
  });
}

export async function guardarSesionDePago(db, pedidoId, idSesion) {
  await db.query('UPDATE pedidos SET stripe_sesion = $1 WHERE id = $2', [idSesion, pedidoId]);
}

async function lineasDePedido(db, pedidoId) {
  const { rows } = await db.query(
    'SELECT producto_id, nombre, precio_cent, cantidad FROM pedido_lineas WHERE pedido_id = $1 ORDER BY id',
    [pedidoId],
  );
  return rows;
}

export async function pedidoPorSesion(db, idSesion) {
  const { rows } = await db.query(
    `SELECT id, codigo, nombre, email, es_regalo, regalo_para, regalo_mensaje, total_cent, estado
     FROM pedidos WHERE stripe_sesion = $1`,
    [idSesion],
  );
  if (rows.length === 0) return null;
  return { ...rows[0], lineas: await lineasDePedido(db, rows[0].id) };
}

/**
 * Marca el pedido como pagado. Devuelve el pedido solo si ESTA llamada hizo el
 * cambio: así el aviso de Stripe y la página de «pago correcto» pueden llegar a
 * la vez sin duplicar el correo de confirmación.
 */
export async function marcarPagado(db, idSesion) {
  // Se lee antes de actualizar: si la lectura fallara después, Stripe
  // reintentaría, el pedido ya estaría pagado y el correo no saldría nunca.
  const pedido = await pedidoPorSesion(db, idSesion);
  if (!pedido) return null;
  // Un pago que llega tarde sobre un pedido dado por caducado también cuenta.
  const { rows } = await db.query(
    `UPDATE pedidos SET estado = 'pagado', pagado_en = now()
     WHERE stripe_sesion = $1 AND estado IN ('pendiente', 'cancelado') RETURNING id`,
    [idSesion],
  );
  return rows.length > 0 ? { ...pedido, estado: 'pagado' } : null;
}

/** El pago no llegó a iniciarse (Stripe falló): el pedido no debe quedar pendiente para siempre. */
export async function descartarPedido(db, pedidoId) {
  await db.query("UPDATE pedidos SET estado = 'cancelado' WHERE id = $1 AND estado = 'pendiente'", [pedidoId]);
}

export async function marcarCaducado(db, idSesion) {
  await db.query(
    "UPDATE pedidos SET estado = 'cancelado' WHERE stripe_sesion = $1 AND estado = 'pendiente'",
    [idSesion],
  );
}
