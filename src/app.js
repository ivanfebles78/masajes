// Construcción de la aplicación Express (sin escuchar en ningún puerto).
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import cookieSession from 'cookie-session';
import { LIMITES } from './config.js';
import { rutasPublicas } from './rutas/publicas.js';
import { rutasAdmin } from './rutas/admin.js';

const DIR_PUBLICO = fileURLToPath(new URL('../public', import.meta.url));
const LIMITE_JSON = '10kb';

/**
 * @param {{ db: object, notificador: object, secretoSesion: string,
 *           produccion?: boolean, limitar?: boolean, saltosProxy?: number, ahora?: () => Date }} opciones
 */
export function crearApp({
  db, notificador, secretoSesion, produccion = false, limitar = true, saltosProxy = 1, ahora = () => new Date(),
}) {
  const app = express();
  app.disable('x-powered-by');
  if (produccion) app.set('trust proxy', saltosProxy);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  app.use(express.json({ limit: LIMITE_JSON }));
  app.use(cookieSession({
    name: 'sesion',
    keys: [secretoSesion],
    maxAge: LIMITES.SESION_MS,
    httpOnly: true,
    sameSite: 'strict',
    secure: produccion,
  }));

  app.get('/salud', (_req, res) => res.json({ ok: true }));
  app.use('/api/admin', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  }, rutasAdmin({ db, ahora, limitar }));
  app.use('/api', rutasPublicas({ db, notificador, ahora, limitar }));
  app.use('/api', (_req, res) => res.status(404).json({ ok: false, error: 'No encontrado.' }));

  // Sin caché larga: los ficheros no llevan huella y deben ir a la par que la API.
  app.use(express.static(DIR_PUBLICO, { extensions: ['html'], maxAge: 0 }));
  app.use((_req, res) => res.status(404).sendFile('404.html', { root: DIR_PUBLICO }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status ?? err.statusCode ?? 500;
    if (status >= 500) {
      console.error('[error]', err);
      return res.status(500).json({ ok: false, error: 'Ha ocurrido un error. Inténtalo de nuevo.' });
    }
    const mensaje = err.type === 'entity.parse.failed' ? 'Petición no válida.' : err.message;
    res.status(status).json({ ok: false, error: mensaje, campo: err.campo ?? undefined });
  });

  return app;
}
