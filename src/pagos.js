// Pago online con Stripe Checkout (página de pago alojada por Stripe: los datos
// de la tarjeta nunca pasan por este servidor).
import Stripe from 'stripe';

export const MONEDA = 'eur';

/**
 * @param {{ env?: object, cliente?: object }} opciones `cliente` permite inyectar
 *   un Stripe simulado en los tests.
 */
export function crearPagos({ env = process.env, cliente = null } = {}) {
  const stripe = cliente ?? (env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null);
  const secretoWebhook = env.STRIPE_WEBHOOK_SECRET ?? '';

  return {
    /** Hay clave de Stripe: se puede cobrar. */
    activo: stripe !== null,
    /** Hay secreto de webhook: Stripe puede avisarnos de los pagos. */
    webhookActivo: stripe !== null && secretoWebhook !== '',

    /** Crea la sesión de pago y devuelve su id y la URL a la que enviar al cliente. */
    async crearSesion({ pedido, lineas, urlBase }) {
      const sesion = await stripe.checkout.sessions.create({
        mode: 'payment',
        locale: 'es',
        customer_email: pedido.email,
        client_reference_id: pedido.codigo,
        metadata: { pedido: pedido.codigo },
        line_items: lineas.map((linea) => ({
          quantity: linea.cantidad,
          price_data: {
            currency: MONEDA,
            unit_amount: linea.precio_cent,
            product_data: { name: linea.nombre },
          },
        })),
        success_url: `${urlBase}/pago-ok?sesion={CHECKOUT_SESSION_ID}`,
        cancel_url: `${urlBase}/pago-cancelado`,
      });
      return { id: sesion.id, url: sesion.url };
    },

    /** Estado real del cobro de una sesión, preguntado directamente a Stripe. */
    async leerCobro(idSesion) {
      const sesion = await stripe.checkout.sessions.retrieve(idSesion);
      return { pagada: sesion.payment_status === 'paid', importe: sesion.amount_total, moneda: sesion.currency };
    },

    /** Verifica la firma del aviso de Stripe y devuelve el evento. Lanza si no es auténtico. */
    eventoDeWebhook(cuerpoCrudo, firma) {
      return stripe.webhooks.constructEvent(cuerpoCrudo, firma, secretoWebhook);
    },
  };
}
