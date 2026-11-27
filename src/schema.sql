-- Esquema idempotente: se ejecuta en cada arranque.

CREATE TABLE IF NOT EXISTS administradores (
  id             SERIAL PRIMARY KEY,
  usuario        TEXT NOT NULL UNIQUE,
  clave_hash     TEXT NOT NULL,
  version_clave  INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS horario (
  dia_semana  SMALLINT NOT NULL CHECK (dia_semana BETWEEN 1 AND 7),
  turno       TEXT NOT NULL CHECK (turno IN ('manana', 'mediodia', 'tarde')),
  inicio      TEXT NOT NULL,
  fin         TEXT NOT NULL,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (dia_semana, turno)
);

CREATE TABLE IF NOT EXISTS dias_bloqueados (
  id      SERIAL PRIMARY KEY,
  fecha   DATE NOT NULL,
  turno   TEXT CHECK (turno IN ('manana', 'mediodia', 'tarde')),
  motivo  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS dias_bloqueados_fecha ON dias_bloqueados (fecha);

CREATE TABLE IF NOT EXISTS ajustes (
  clave  TEXT PRIMARY KEY,
  valor  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS citas (
  id         SERIAL PRIMARY KEY,
  fecha      DATE NOT NULL,
  hora       TEXT NOT NULL,
  turno      TEXT NOT NULL CHECK (turno IN ('manana', 'mediodia', 'tarde')),
  servicio   TEXT NOT NULL,
  duracion_min INTEGER NOT NULL CHECK (duracion_min BETWEEN 15 AND 240),
  nombre     TEXT NOT NULL,
  telefono   TEXT,
  email      TEXT,
  canal      TEXT CHECK (canal IN ('whatsapp', 'sms')),
  estado     TEXT NOT NULL DEFAULT 'confirmada' CHECK (estado IN ('confirmada', 'cancelada')),
  creada_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Red de seguridad: nunca dos citas confirmadas con la misma hora de inicio.
-- Los solapes entre duraciones distintas se evitan con un bloqueo por fecha
-- al crear la cita (ver servicio.js).
CREATE UNIQUE INDEX IF NOT EXISTS citas_hueco_unico
  ON citas (fecha, hora) WHERE estado = 'confirmada';

CREATE TABLE IF NOT EXISTS notificaciones (
  id         SERIAL PRIMARY KEY,
  cita_id    INTEGER NOT NULL REFERENCES citas (id) ON DELETE CASCADE,
  canal      TEXT NOT NULL,
  destino    TEXT NOT NULL,
  estado     TEXT NOT NULL,
  detalle    TEXT NOT NULL DEFAULT '',
  creada_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notificaciones_cita ON notificaciones (cita_id);

CREATE TABLE IF NOT EXISTS pedidos (
  id              SERIAL PRIMARY KEY,
  codigo          TEXT NOT NULL UNIQUE,
  nombre          TEXT NOT NULL,
  email           TEXT NOT NULL,
  telefono        TEXT,
  es_regalo       BOOLEAN NOT NULL DEFAULT FALSE,
  regalo_para     TEXT NOT NULL DEFAULT '',
  regalo_mensaje  TEXT NOT NULL DEFAULT '',
  total_cent      INTEGER NOT NULL CHECK (total_cent > 0),
  estado          TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'pagado', 'cancelado')),
  stripe_sesion   TEXT UNIQUE,
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  pagado_en       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS pedidos_creado ON pedidos (creado_en DESC);

CREATE TABLE IF NOT EXISTS pedido_lineas (
  id           SERIAL PRIMARY KEY,
  pedido_id    INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
  producto_id  TEXT NOT NULL,
  nombre       TEXT NOT NULL,
  precio_cent  INTEGER NOT NULL CHECK (precio_cent > 0),
  cantidad     INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 10)
);
CREATE INDEX IF NOT EXISTS pedido_lineas_pedido ON pedido_lineas (pedido_id);

-- Bases de datos creadas antes de existir el turno de mediodía: se rehacen las
-- restricciones para admitirlo (es idempotente).
ALTER TABLE horario DROP CONSTRAINT IF EXISTS horario_turno_check;
ALTER TABLE horario ADD CONSTRAINT horario_turno_check
  CHECK (turno IN ('manana', 'mediodia', 'tarde'));
ALTER TABLE dias_bloqueados DROP CONSTRAINT IF EXISTS dias_bloqueados_turno_check;
ALTER TABLE dias_bloqueados ADD CONSTRAINT dias_bloqueados_turno_check
  CHECK (turno IN ('manana', 'mediodia', 'tarde'));
ALTER TABLE citas DROP CONSTRAINT IF EXISTS citas_turno_check;
ALTER TABLE citas ADD CONSTRAINT citas_turno_check
  CHECK (turno IN ('manana', 'mediodia', 'tarde'));
