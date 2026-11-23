import dotenv from 'dotenv';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { conectarBD, prepararBD } from './db.js';
import { crearNotificador } from './notificaciones.js';
import { crearApp } from './app.js';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const PUERTO_POR_DEFECTO = 4330;
const LONGITUD_MIN_SECRETO = 32;

function secretoDeSesion(env, produccion) {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= LONGITUD_MIN_SECRETO) return env.SESSION_SECRET;
  if (produccion) {
    throw new Error(`Falta SESSION_SECRET (mínimo ${LONGITUD_MIN_SECRETO} caracteres) en producción.`);
  }
  console.warn('[sesion] Sin SESSION_SECRET: se usa uno temporal (las sesiones se pierden al reiniciar).');
  return randomBytes(LONGITUD_MIN_SECRETO).toString('hex');
}

/** En producción avisa de una vez de todas las variables que faltan. */
function comprobarEntorno(env) {
  const faltan = [];
  if (!env.DATABASE_URL) faltan.push('DATABASE_URL (referencia a la base de datos PostgreSQL)');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < LONGITUD_MIN_SECRETO) {
    faltan.push(`SESSION_SECRET (texto aleatorio de al menos ${LONGITUD_MIN_SECRETO} caracteres)`);
  }
  if (!env.ADMIN_PASSWORD && !env.ADMIN_PASSWORD_HASH) {
    console.warn('[admin] Sin ADMIN_PASSWORD: solo es válido si el usuario «admin» ya existe en la base de datos.');
  }
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno:\n  - ${faltan.join('\n  - ')}`);
  }
}

async function arrancar() {
  const env = process.env;
  const produccion = env.NODE_ENV === 'production';
  if (produccion) comprobarEntorno(env);
  const secretoSesion = secretoDeSesion(env, produccion);

  const db = await conectarBD(env);
  await prepararBD(db, env);

  if (!env.RESEND_API_KEY || !env.MAIL_FROM) {
    console.warn('[avisos] RESEND_API_KEY o MAIL_FROM sin configurar: los correos NO se enviarán (modo simulado).');
  }

  const saltosProxy = Number.isInteger(Number(env.TRUST_PROXY)) && env.TRUST_PROXY !== '' ? Number(env.TRUST_PROXY) : 1;
  const app = crearApp({ db, notificador: crearNotificador({ env }), secretoSesion, produccion, saltosProxy });
  const puerto = Number(env.PORT) || PUERTO_POR_DEFECTO;
  const servidor = app.listen(puerto, () => console.info(`[web] Escuchando en el puerto ${puerto}`));

  const cerrar = () => servidor.close(() => db.cerrar().finally(() => process.exit(0)));
  process.on('SIGTERM', cerrar);
  process.on('SIGINT', cerrar);
}

arrancar().catch((err) => {
  console.error('[arranque] No se pudo iniciar:', err);
  process.exit(1);
});
