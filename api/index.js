'use strict';
/**
 * Barbería — API (Vercel Serverless + Neon Postgres).
 * Protocolo: POST /api { action, token?, ...datos }  ->  { ok, data } | { ok:false, error }
 */
const crypto = require('crypto');
const { neon } = require('@neondatabase/serverless');

const TZ = 'America/Bogota';
const SESSION_SECONDS = 6 * 3600;
const MAX_FAILS = 8;
const FAIL_WINDOW_MIN = 10;
const MAX_FECHAS = 10;
const ESTADOS = ['confirmada', 'completada', 'cancelada', 'no_asistio'];

// Tablas editables desde el admin: columnas permitidas
const TABLAS = {
  sedes:       ['nombre', 'direccion', 'activo'],
  barberos:    ['nombre', 'telefono', 'activo'],
  servicios:   ['nombre', 'precio', 'duracion_min', 'activo'],
  formas_pago: ['nombre', 'activo'],
  horarios:    ['barbero_id', 'sede_id', 'dia_semana', 'hora_inicio', 'hora_fin'],
  bloqueos:    ['barbero_id', 'fecha', 'hora_inicio', 'hora_fin', 'motivo']
};

let _sql;
function db() {
  if (!process.env.DATABASE_URL) throw apiError('Falta la variable DATABASE_URL en Vercel.', 'NOT_CONFIGURED');
  if (!_sql) _sql = neon(process.env.DATABASE_URL);
  return _sql;
}
const q = (text, params) => db().query(text, params || []);

function apiError(message, code) {
  const e = new Error(message);
  e.code = code;
  e.isApi = true;
  return e;
}

// ---------- utilidades ----------
const sha256 = v => crypto.createHash('sha256').update(String(v)).digest('hex');
const hhmm = t => String(t).slice(0, 5);
const toMin = t => { const [h, m] = hhmm(t).split(':').map(Number); return h * 60 + m; };
const fromMin = n => String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !isNaN(Date.parse(s));
const isTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');
const dow = fecha => new Date(fecha + 'T00:00:00Z').getUTCDay();
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max || 200);

function ahoraBogota() {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).reduce((a, x) => (a[x.type] = x.value, a), {});
  return { fecha: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function genCodigo() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const b = crypto.randomBytes(6);
  return Array.from(b, x => abc[x % abc.length]).join('');
}

async function getConfig() {
  const rows = await q('select clave, valor from config');
  return rows.reduce((a, r) => (a[r.clave] = r.valor, a), {});
}

// ---------- token admin ----------
function secret() {
  return process.env.SESSION_SECRET || sha256('barberia|' + (process.env.ADMIN_PASSWORD || ''));
}
function firmar(exp) {
  return exp + '.' + crypto.createHmac('sha256', secret()).update(String(exp)).digest('hex');
}
function verificarToken(token) {
  const [exp, sig] = String(token || '').split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const esperado = firmar(exp).split('.')[1];
  const a = Buffer.from(sig), b = Buffer.from(esperado);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function requireAdmin(body) {
  if (!verificarToken(body.token)) throw apiError('Sesión expirada. Ingrese de nuevo.', 'AUTH');
}

// ---------- disponibilidad ----------
async function slotsDisponibles({ fecha, barbero_id, servicio_id, sede_id }) {
  if (!isDate(fecha)) throw apiError('Fecha inválida.');
  const cfg = await getConfig();
  const paso = Number(cfg.intervalo_min) || 30;
  const antic = Number(cfg.anticipacion_min) || 0;
  const maxDias = Number(cfg.dias_max_adelanto) || 60;
  const hoy = ahoraBogota();
  if (fecha < hoy.fecha) return [];
  if (fecha > sumarDias(hoy.fecha, maxDias)) return [];

  const [svc] = await q('select duracion_min from servicios where id=$1 and activo', [servicio_id]);
  if (!svc) throw apiError('Servicio no disponible.');
  const dur = svc.duracion_min;

  const [horarios, citas, bloqueos] = await Promise.all([
    q('select hora_inicio, hora_fin from horarios where barbero_id=$1 and sede_id=$2 and dia_semana=$3',
      [barbero_id, sede_id, dow(fecha)]),
    q(`select hora_inicio, hora_fin from reservas
        where barbero_id=$1 and fecha=$2 and estado in ('confirmada','completada')`, [barbero_id, fecha]),
    q('select hora_inicio, hora_fin from bloqueos where fecha=$1 and (barbero_id is null or barbero_id=$2)',
      [fecha, barbero_id])
  ]);

  const ocupado = [...citas, ...bloqueos].map(r => [toMin(r.hora_inicio), toMin(r.hora_fin)]);
  const out = new Set();
  for (const h of horarios) {
    const ini = toMin(h.hora_inicio), fin = toMin(h.hora_fin);
    for (let t = ini; t + dur <= fin; t += paso) {
      if (fecha === hoy.fecha && t < hoy.min + antic) continue;
      if (ocupado.some(([a, b]) => t < b && t + dur > a)) continue;
      out.add(fromMin(t));
    }
  }
  return [...out].sort();
}

// ---------- correo (opcional) ----------
async function enviarCorreo(to, subject, text) {
  if (!process.env.RESEND_API_KEY || !to) return false;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM || 'Barbería <onboarding@resend.dev>', to: [to], subject, text })
    });
    return r.ok;
  } catch (e) { return false; }
}

// ---------- acciones públicas ----------
async function catalogo() {
  const [sedes, barberos, servicios, pagos, horarios, cfg] = await Promise.all([
    q('select id, nombre, direccion from sedes where activo order by nombre'),
    q('select id, nombre from barberos where activo order by nombre'),
    q('select id, nombre, precio::float, duracion_min from servicios where activo order by precio'),
    q('select id, nombre from formas_pago where activo order by id'),
    q('select distinct barbero_id, sede_id from horarios'),
    getConfig()
  ]);
  return {
    sedes, barberos, servicios, pagos, horarios,
    negocio: cfg.nombre_negocio || 'Barbería',
    hoy: ahoraBogota().fecha,
    max_fecha: sumarDias(ahoraBogota().fecha, Number(cfg.dias_max_adelanto) || 60)
  };
}

async function disponibilidad(b) {
  return slotsDisponibles({
    fecha: b.fecha, barbero_id: Number(b.barbero_id), servicio_id: Number(b.servicio_id), sede_id: Number(b.sede_id)
  });
}

async function reservar(b) {
  if (b.web) throw apiError('Solicitud rechazada.'); // honeypot
  const nombre = str(b.nombre, 100), telefono = str(b.telefono, 20).replace(/[^\d+]/g, ''), email = str(b.email, 120);
  if (nombre.length < 2) throw apiError('Ingrese su nombre.');
  if (telefono.replace(/\D/g, '').length < 7) throw apiError('Teléfono inválido.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw apiError('Correo inválido.');
  if (!isTime(b.hora)) throw apiError('Hora inválida.');

  const barbero_id = Number(b.barbero_id), servicio_id = Number(b.servicio_id), sede_id = Number(b.sede_id);
  const fechas = [b.fecha, ...(Array.isArray(b.fechas_extra) ? b.fechas_extra : [])]
    .filter((f, i, a) => isDate(f) && a.indexOf(f) === i);
  if (!isDate(b.fecha)) throw apiError('Fecha inválida.');
  if (fechas.length > MAX_FECHAS) throw apiError(`Máximo ${MAX_FECHAS} fechas por operación.`);

  const [svc] = await q('select id, nombre, precio::float as precio, duracion_min from servicios where id=$1 and activo', [servicio_id]);
  const [bar] = await q('select id, nombre from barberos where id=$1 and activo', [barbero_id]);
  const [sede] = await q('select id, nombre from sedes where id=$1 and activo', [sede_id]);
  if (!svc || !bar || !sede) throw apiError('Servicio, barbero o sede no disponible.');
  const pagoId = b.forma_pago_id ? Number(b.forma_pago_id) : null;

  const cfg = await getConfig();
  const [{ n }] = await q(
    `select count(*)::int n from reservas r join clientes c on c.id=r.cliente_id
      where c.telefono=$1 and r.estado='confirmada' and r.fecha >= $2`, [telefono, ahoraBogota().fecha]);
  if (n + fechas.length > (Number(cfg.max_activas_cliente) || 5)) {
    throw apiError('Superó el máximo de reservas activas. Cancele alguna o contacte a la barbería.');
  }

  const [cli] = await q(
    `insert into clientes (nombre, telefono, email) values ($1,$2,$3)
     on conflict (telefono) do update set nombre=excluded.nombre, email=coalesce(nullif(excluded.email,''), clientes.email)
     returning id`, [nombre, telefono, email || null]);

  const serie = fechas.length > 1 ? crypto.randomUUID() : null;
  const inicio = toMin(b.hora), fin = inicio + svc.duracion_min;
  if (fin > 24 * 60) throw apiError('El servicio no puede cruzar la medianoche.');
  const creadas = [], fallidas = [];

  for (const fecha of fechas) {
    const libres = await slotsDisponibles({ fecha, barbero_id, servicio_id, sede_id });
    if (!libres.includes(b.hora)) { fallidas.push({ fecha, motivo: 'Horario no disponible' }); continue; }
    try {
      const codigo = genCodigo();
      await q(
        `insert into reservas (codigo, serie_id, cliente_id, barbero_id, servicio_id, sede_id, forma_pago_id,
                               fecha, hora_inicio, hora_fin, precio, servicio_nombre)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [codigo, serie, cli.id, barbero_id, servicio_id, sede_id, pagoId, fecha, b.hora, fromMin(fin), svc.precio, svc.nombre]);
      creadas.push({ codigo, fecha });
    } catch (e) {
      // 23P01 = violación de EXCLUDE: otro cliente tomó el hueco justo antes
      fallidas.push({ fecha, motivo: e.code === '23P01' ? 'Otro cliente reservó ese horario' : 'Error al guardar' });
    }
  }
  if (!creadas.length) throw apiError('No se pudo reservar: ' + (fallidas[0] ? fallidas[0].motivo : 'sin disponibilidad') + '.', 'NO_SLOT');

  const resumen = creadas.map(c => `  ${c.fecha}  ·  código ${c.codigo}`).join('\n');
  const texto =
    `Hola ${nombre},\n\nTu reserva en ${cfg.nombre_negocio || 'la barbería'} quedó confirmada.\n\n` +
    `Servicio: ${svc.nombre}\nBarbero: ${bar.nombre}\nSede: ${sede.nombre}\nHora: ${b.hora} – ${fromMin(fin)}\n` +
    `Precio: $${svc.precio.toLocaleString('es-CO')}\n\nFechas:\n${resumen}\n\n` +
    `Para consultar o cancelar usa tu código y tu teléfono en el sitio.`;
  // no bloquea la respuesta si falla el correo
  await Promise.all([
    email ? enviarCorreo(email, 'Reserva confirmada', texto) : null,
    cfg.email_admin ? enviarCorreo(cfg.email_admin, `Nueva reserva: ${nombre}`, texto) : null
  ]);
  return { creadas, fallidas, servicio: svc.nombre, barbero: bar.nombre, sede: sede.nombre, hora: b.hora, hora_fin: fromMin(fin), precio: svc.precio };
}

async function consultar(b) {
  const tel = str(b.telefono, 20).replace(/[^\d+]/g, '');
  const rows = await q(
    `select r.codigo, r.fecha::text, r.hora_inicio::text, r.hora_fin::text, r.estado, r.precio::float,
            r.servicio_nombre, ba.nombre barbero, s.nombre sede
       from reservas r join clientes c on c.id=r.cliente_id
       join barberos ba on ba.id=r.barbero_id join sedes s on s.id=r.sede_id
      where r.codigo=$1 and c.telefono=$2`, [str(b.codigo, 12).toUpperCase(), tel]);
  if (!rows.length) throw apiError('No encontramos esa reserva. Revise el código y el teléfono.');
  const r = rows[0];
  r.hora_inicio = hhmm(r.hora_inicio); r.hora_fin = hhmm(r.hora_fin);
  return r;
}

async function cancelar(b) {
  const r = await consultar(b);
  if (r.estado !== 'confirmada') throw apiError('Esta reserva ya no está activa.');
  const cfg = await getConfig();
  const hoy = ahoraBogota();
  const minutosFaltan = (Date.parse(r.fecha + 'T00:00:00Z') - Date.parse(hoy.fecha + 'T00:00:00Z')) / 60000
                        + toMin(r.hora_inicio) - hoy.min;
  if (minutosFaltan < (Number(cfg.cancelar_horas) || 0) * 60) {
    throw apiError(`Solo puede cancelar con ${cfg.cancelar_horas} h de anticipación. Contacte a la barbería.`);
  }
  await q(`update reservas set estado='cancelada' where codigo=$1`, [r.codigo]);
  return { codigo: r.codigo };
}

// ---------- acciones admin ----------
async function login(b, ip) {
  const [{ n }] = await q(
    `select count(*)::int n from intentos_login where ip=$1 and en > now() - ($2 || ' minutes')::interval`,
    [ip, String(FAIL_WINDOW_MIN)]);
  if (n >= MAX_FAILS) throw apiError('Demasiados intentos. Espere unos minutos.', 'RATE');
  const real = process.env.ADMIN_PASSWORD || '';
  const a = Buffer.from(sha256(b.password || '')), c = Buffer.from(sha256(real));
  if (!real || !crypto.timingSafeEqual(a, c)) {
    await q('insert into intentos_login (ip) values ($1)', [ip]);
    throw apiError('Contraseña incorrecta.', 'AUTH');
  }
  await q(`delete from intentos_login where en < now() - interval '1 day'`);
  return { token: firmar(Math.floor(Date.now() / 1000) + SESSION_SECONDS) };
}

async function adminReservas(b) {
  const hoy = ahoraBogota().fecha;
  const desde = isDate(b.desde) ? b.desde : hoy;
  const hasta = isDate(b.hasta) ? b.hasta : sumarDias(desde, 7);
  const rows = await q(
    `select r.id, r.codigo, r.fecha::text, r.hora_inicio::text, r.hora_fin::text, r.estado, r.precio::float,
            r.servicio_nombre, ba.nombre barbero, s.nombre sede, c.nombre cliente, c.telefono, c.email, fp.nombre pago
       from reservas r join clientes c on c.id=r.cliente_id
       join barberos ba on ba.id=r.barbero_id join sedes s on s.id=r.sede_id
       left join formas_pago fp on fp.id=r.forma_pago_id
      where r.fecha between $1 and $2 order by r.fecha, r.hora_inicio`, [desde, hasta]);
  rows.forEach(r => { r.hora_inicio = hhmm(r.hora_inicio); r.hora_fin = hhmm(r.hora_fin); });
  return { desde, hasta, reservas: rows };
}

async function adminEstado(b) {
  if (!ESTADOS.includes(b.estado)) throw apiError('Estado inválido.');
  try {
    await q('update reservas set estado=$1 where id=$2', [b.estado, Number(b.id)]);
  } catch (e) {
    if (e.code === '23P01') throw apiError('No se puede reactivar: el horario ya fue ocupado.');
    throw e;
  }
  return { id: b.id };
}

async function adminResumen(b) {
  const hoy = ahoraBogota().fecha;
  const desde = isDate(b.desde) ? b.desde : hoy.slice(0, 8) + '01';
  const hasta = isDate(b.hasta) ? b.hasta : hoy;
  const [tot] = await q(
    `select count(*) filter (where estado in ('confirmada','completada'))::int reservas,
            coalesce(sum(precio) filter (where estado='completada'),0)::float ingresos,
            coalesce(sum(precio) filter (where estado='confirmada'),0)::float pendiente,
            count(*) filter (where estado='cancelada')::int canceladas,
            count(*) filter (where estado='no_asistio')::int no_asistio
       from reservas where fecha between $1 and $2`, [desde, hasta]);
  const porBarbero = await q(
    `select ba.nombre, count(*)::int citas, coalesce(sum(r.precio),0)::float ingresos
       from reservas r join barberos ba on ba.id=r.barbero_id
      where r.fecha between $1 and $2 and r.estado='completada' group by ba.nombre order by 3 desc`, [desde, hasta]);
  const porServicio = await q(
    `select servicio_nombre nombre, count(*)::int citas from reservas
      where fecha between $1 and $2 and estado in ('confirmada','completada')
      group by servicio_nombre order by 2 desc limit 5`, [desde, hasta]);
  return { desde, hasta, ...tot, porBarbero, porServicio };
}

async function adminListar(b) {
  if (b.tabla === 'config') return getConfig();
  if (!TABLAS[b.tabla]) throw apiError('Tabla inválida.');
  return q(`select * from ${b.tabla} order by id`);
}

async function adminGuardar(b) {
  if (b.tabla === 'config') {
    for (const [k, v] of Object.entries(b.item || {})) {
      await q(`insert into config (clave, valor) values ($1,$2) on conflict (clave) do update set valor=excluded.valor`,
        [str(k, 50), str(v, 200)]);
    }
    return { ok: true };
  }
  const cols = TABLAS[b.tabla];
  if (!cols) throw apiError('Tabla inválida.');
  const item = b.item || {};
  const usadas = cols.filter(c => item[c] !== undefined);
  if (!usadas.length) throw apiError('Sin datos.');
  const vals = usadas.map(c => item[c] === '' ? null : item[c]);
  if (item.id) {
    const sets = usadas.map((c, i) => `${c}=$${i + 1}`).join(', ');
    await q(`update ${b.tabla} set ${sets} where id=$${usadas.length + 1}`, [...vals, Number(item.id)]);
  } else {
    const ph = usadas.map((_, i) => '$' + (i + 1)).join(',');
    await q(`insert into ${b.tabla} (${usadas.join(',')}) values (${ph})`, vals);
  }
  return { ok: true };
}

async function adminBorrar(b) {
  if (!['horarios', 'bloqueos'].includes(b.tabla)) throw apiError('Solo se pueden borrar horarios y bloqueos; desactive el resto.');
  await q(`delete from ${b.tabla} where id=$1`, [Number(b.id)]);
  return { ok: true };
}

// ---------- router ----------
const PUBLICAS = { catalogo, disponibilidad, reservar, consultar, cancelar };
const ADMIN = {
  admin_reservas: adminReservas, admin_estado: adminEstado, admin_resumen: adminResumen,
  admin_listar: adminListar, admin_guardar: adminGuardar, admin_borrar: adminBorrar
};

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido.' });
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const ip = String(req.headers['x-forwarded-for'] || 'local').split(',')[0].trim();
    let data;
    if (body.action === 'login') data = await login(body, ip);
    else if (PUBLICAS[body.action]) data = await PUBLICAS[body.action](body);
    else if (ADMIN[body.action]) { requireAdmin(body); data = await ADMIN[body.action](body); }
    else throw apiError('Acción desconocida.');
    res.status(200).json({ ok: true, data });
  } catch (e) {
    if (!e.isApi) console.error(e);
    res.status(e.isApi ? (e.code === 'AUTH' ? 401 : 400) : 500)
       .json({ ok: false, error: e.isApi ? e.message : 'Error interno del servidor.', code: e.code });
  }
};

module.exports._test = { toMin, fromMin, dow, isDate, genCodigo };
