-- ============================================================
-- BARBERÍA — Esquema para Neon (PostgreSQL)
-- Ejecutar UNA vez en Neon > SQL Editor. Es idempotente.
-- ============================================================

create extension if not exists btree_gist;

-- ── Catálogo ────────────────────────────────────────────────
create table if not exists sedes (
  id         serial primary key,
  nombre     text not null unique,
  direccion  text,
  activo     boolean not null default true
);

create table if not exists barberos (
  id         serial primary key,
  nombre     text not null unique,
  telefono   text,
  activo     boolean not null default true
);

create table if not exists servicios (
  id           serial primary key,
  nombre       text not null unique,
  precio       numeric(12,2) not null check (precio >= 0),
  duracion_min integer not null default 30 check (duracion_min between 5 and 480),
  activo       boolean not null default true
);

create table if not exists formas_pago (
  id      serial primary key,
  nombre  text not null unique,
  activo  boolean not null default true
);

-- Horario semanal de cada barbero en cada sede (dia_semana: 0=domingo … 6=sábado)
create table if not exists horarios (
  id          serial primary key,
  barbero_id  integer not null references barberos(id) on delete cascade,
  sede_id     integer not null references sedes(id)    on delete cascade,
  dia_semana  smallint not null check (dia_semana between 0 and 6),
  hora_inicio time not null,
  hora_fin    time not null,
  check (hora_fin > hora_inicio)
);
create index if not exists horarios_barbero_dia_idx on horarios (barbero_id, dia_semana);

-- Bloqueos puntuales (vacaciones, almuerzo, citas médicas). barbero_id NULL = toda la barbería
create table if not exists bloqueos (
  id          serial primary key,
  barbero_id  integer references barberos(id) on delete cascade,
  fecha       date not null,
  hora_inicio time not null default '00:00',
  hora_fin    time not null default '23:59',
  motivo      text,
  check (hora_fin > hora_inicio)
);
create index if not exists bloqueos_fecha_idx on bloqueos (fecha);

-- ── Clientes y reservas ─────────────────────────────────────
create table if not exists clientes (
  id         serial primary key,
  nombre     text not null,
  telefono   text not null unique,
  email      text,
  creado_en  timestamptz not null default now()
);

create table if not exists reservas (
  id             serial primary key,
  codigo         text not null unique,
  serie_id       uuid,                                  -- agrupa reservas duplicadas en varias fechas
  cliente_id     integer not null references clientes(id),
  barbero_id     integer not null references barberos(id),
  servicio_id    integer not null references servicios(id),
  sede_id        integer not null references sedes(id),
  forma_pago_id  integer references formas_pago(id),
  fecha          date not null,
  hora_inicio    time not null,
  hora_fin       time not null,
  -- copia histórica: si cambia el precio del servicio, la reserva no se altera
  precio         numeric(12,2) not null check (precio >= 0),
  servicio_nombre text not null,
  estado         text not null default 'confirmada'
                 check (estado in ('confirmada','completada','cancelada','no_asistio')),
  notas          text,
  creada_en      timestamptz not null default now(),
  check (hora_fin > hora_inicio),
  inicio         timestamp generated always as (fecha + hora_inicio) stored,
  fin            timestamp generated always as (fecha + hora_fin)    stored,
  -- IMPOSIBLE reservar dos veces al mismo barbero en el mismo rango de tiempo
  constraint sin_cruces exclude using gist (
    barbero_id with =,
    tsrange(inicio, fin) with &&
  ) where (estado in ('confirmada','completada'))
);
create index if not exists reservas_fecha_idx    on reservas (fecha);
create index if not exists reservas_barbero_idx  on reservas (barbero_id, fecha);
create index if not exists reservas_cliente_idx  on reservas (cliente_id);

-- ── Configuración y seguridad ───────────────────────────────
create table if not exists config (
  clave  text primary key,
  valor  text not null
);

create table if not exists intentos_login (
  id    bigserial primary key,
  ip    text not null,
  en    timestamptz not null default now()
);
create index if not exists intentos_login_idx on intentos_login (ip, en);

-- ── Datos iniciales (editar luego desde /admin.html) ────────
insert into config (clave, valor) values
  ('nombre_negocio',      'Barbería'),
  ('email_admin',         ''),
  ('intervalo_min',       '30'),    -- separación entre horas ofrecidas
  ('anticipacion_min',    '60'),    -- minutos mínimos antes de la cita
  ('dias_max_adelanto',   '60'),
  ('cancelar_horas',      '2'),     -- el cliente puede cancelar hasta X horas antes
  ('max_activas_cliente', '5')
on conflict (clave) do nothing;

insert into sedes (nombre) values ('Sur'), ('Norte') on conflict (nombre) do nothing;
insert into formas_pago (nombre) values ('Efectivo'), ('Nequi'), ('Bre-b') on conflict (nombre) do nothing;

insert into servicios (nombre, precio, duracion_min) values
  ('Corte clásico',        25000, 30),
  ('Corte + barba',        40000, 45),
  ('Barba',                20000, 20),
  ('Corte niño',           18000, 30)
on conflict (nombre) do nothing;

insert into barberos (nombre) values ('Barbero 1'), ('Barbero 2') on conflict (nombre) do nothing;

-- Lunes a sábado 09:00–19:00: Barbero 1 en Sur, Barbero 2 en Norte (solo si aún no hay horarios)
insert into horarios (barbero_id, sede_id, dia_semana, hora_inicio, hora_fin)
select b.id, s.id, d, '09:00', '19:00'
from barberos b
join sedes s on (b.nombre = 'Barbero 1' and s.nombre = 'Sur') or (b.nombre = 'Barbero 2' and s.nombre = 'Norte')
cross join generate_series(1, 6) d
where not exists (select 1 from horarios);
