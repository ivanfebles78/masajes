# Pausatzen · web y citas online

Web de un salón de masajes en Pamplona con reserva de citas online y panel de
administración. Node 20+ · Express 5 · PostgreSQL · sin paso de compilación.

## Qué hace

- **Dos masajes**: shiatsu (90 min) y masaje en camilla (60 o 90 min).
- **Reserva en 5 pasos**: masaje → día → turno (mañana/tarde) → hora → datos.
  El cliente nunca ve la ocupación de un día entero: solo los huecos del turno
  que pide. Si no quedan, se le ofrece el otro turno u otro día.
- **Datos del cliente**: nombre y teléfono y/o correo. Sin pago por adelantado.
- **Avisos al confirmar**: correo real por Resend; WhatsApp o SMS (lo elige el
  cliente) de momento **simulados**: se escriben en el log y quedan registrados.
- **Panel `/admin/`**: citas por día (con cancelación), horario semanal por
  turnos, días cerrados, datos del salón y cambio de contraseña.

### Cómo se calculan los huecos

Dentro de cada turno, los huecos se encadenan desde el inicio de cada tramo
libre según la duración pedida. Con el turno de mañana vacío (9:00–13:30):

- 90 min → 9:00, 10:30, 12:00
- 60 min → 9:00, 10:00, 11:00, 12:00

Si ya hay una cita de 60 min a las 9:00, lo siguiente empieza a las 10:00, de
modo que las citas quedan pegadas y no se pierde tiempo entre ellas.

## Desarrollo local

```bash
npm install
npm start        # http://localhost:4330
npm test
```

Sin `DATABASE_URL` se usa un Postgres embebido en memoria (PGlite): los datos se
pierden al reiniciar. Para conservarlos, define `PGLITE_DIR=./pgdata` o apunta
`DATABASE_URL` a un Postgres real. Variables en `.env.example`.

## Despliegue en Railway

1. Crea un proyecto desde este repositorio (usa el `Dockerfile`).
2. Añade un servicio **PostgreSQL** y referencia su `DATABASE_URL` en la app.
3. Variables de la app:

| Variable | Obligatoria | Para qué |
|----------|-------------|----------|
| `NODE_ENV=production` | sí | cookies seguras y proxy de Railway |
| `DATABASE_URL` | sí | conexión a PostgreSQL |
| `SESSION_SECRET` | sí | firma de la sesión (32+ caracteres aleatorios) |
| `RESEND_API_KEY` | para el correo | clave de Resend |
| `MAIL_FROM` | para el correo | remitente verificado, p. ej. `Salón <citas@tudominio.es>` |
| `PGSSL=true` | solo si la BD exige SSL | conexión externa a Postgres |
| `ADMIN_PASSWORD` | sí (primer arranque) | contraseña inicial del usuario `admin`; se guarda hasheada |

El esquema se crea solo al arrancar. Sin `RESEND_API_KEY`/`MAIL_FROM` los
correos **no se envían** (quedan como «simulado» en el panel).

## Administración

Usuario `admin`. La contraseña inicial se toma de la variable `ADMIN_PASSWORD`
la primera vez que arranca (no está en el repositorio) y se guarda con bcrypt.
Una vez creado el usuario puedes borrar la variable. Se cambia en Ajustes, y
cambiarla cierra el resto de sesiones abiertas.

## Pendiente

- Proveedor real de WhatsApp/SMS (el punto de enganche es
  `enviarMensajeMovil` en `src/notificaciones.js`).
- Aviso al cliente cuando el administrador cancela una cita.
- Textos legales (privacidad/RGPD) y datos reales del salón (nombre, dirección
  y teléfono se editan en Ajustes).
