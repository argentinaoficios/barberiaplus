(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let token = '';
  try { token = sessionStorage.getItem('bt') || ''; } catch (e) {}
  const money = n => '$' + Number(n).toLocaleString('es-CO');
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const ESTADOS = ['confirmada', 'completada', 'cancelada', 'no_asistio'];
  const TABS = [['agenda', 'Agenda'], ['resumen', 'Resumen'], ['servicios', 'Servicios'], ['barberos', 'Barberos'],
                ['sedes', 'Sedes'], ['horarios', 'Horarios'], ['bloqueos', 'Bloqueos'], ['formas_pago', 'Pagos'], ['config', 'Ajustes']];
  let tab = 'agenda';

  async function api(action, data) {
    const r = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action, token }, data))
    });
    const j = await r.json().catch(() => ({ ok: false, error: 'Respuesta inválida.' }));
    if (!j.ok) { if (j.code === 'AUTH' && action !== 'login') salir(); throw new Error(j.error); }
    return j.data;
  }
  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (text != null) e.textContent = text;
    return e;
  }
  const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const sumar = (f, n) => { const d = new Date(f + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  function aviso(cont, tipo, t) { cont.querySelectorAll('.msg').forEach(m => m.remove()); cont.prepend(el('div', { class: 'msg ' + tipo, role: 'status' }, t)); }

  // ── Sesión ──────────────────────────────────────────────────
  function salir() { token = ''; try { sessionStorage.removeItem('bt'); } catch (e) {} $('panel').hidden = true; $('loginBox').hidden = false; }
  async function entrar() {
    try {
      const r = await api('login', { password: $('pass').value });
      token = r.token; try { sessionStorage.setItem('bt', token); } catch (e) {}
      $('pass').value = ''; mostrarPanel();
    } catch (e) { $('loginMsg').replaceChildren(el('div', { class: 'msg err' }, e.message)); }
  }
  function mostrarPanel() {
    $('loginBox').hidden = true; $('panel').hidden = false;
    const t = $('tabs'); t.replaceChildren();
    TABS.forEach(([id, nombre]) => {
      const b = el('button', { class: 'tab', role: 'tab', 'aria-selected': String(id === tab) }, nombre);
      b.addEventListener('click', () => { tab = id; mostrarPanel(); });
      t.append(b);
    });
    render();
  }

  // ── Vistas ──────────────────────────────────────────────────
  async function render() {
    const v = $('view'); v.replaceChildren(el('p', {}, 'Cargando…'));
    try {
      if (tab === 'agenda') await vistaAgenda(v);
      else if (tab === 'resumen') await vistaResumen(v);
      else if (tab === 'config') await vistaConfig(v);
      else await vistaCatalogo(v, tab);
    } catch (e) { v.replaceChildren(el('div', { class: 'msg err' }, e.message)); }
  }

  async function vistaAgenda(v) {
    const desde = v.dataset.d || hoyISO(), hasta = v.dataset.h || sumar(desde, 6);
    const d = await api('admin_reservas', { desde, hasta });
    v.replaceChildren();
    const tb = el('div', { class: 'toolbar' });
    const i1 = el('input', { type: 'date', value: d.desde }), i2 = el('input', { type: 'date', value: d.hasta });
    const go = el('button', { class: 'btn', type: 'button' }, 'Ver');
    go.addEventListener('click', () => { v.dataset.d = i1.value; v.dataset.h = i2.value; render(); });
    const c1 = el('div'); c1.append(el('label', {}, 'Desde'), i1);
    const c2 = el('div'); c2.append(el('label', {}, 'Hasta'), i2);
    tb.append(c1, c2, go); v.append(tb);
    if (!d.reservas.length) { v.append(el('div', { class: 'empty' }, 'Sin reservas en este rango.')); return; }
    const t = el('table'), th = el('tr');
    ['Fecha', 'Hora', 'Cliente', 'Servicio', 'Barbero / Sede', 'Precio', 'Estado'].forEach(h => th.append(el('th', {}, h)));
    t.append(th);
    d.reservas.forEach(r => {
      const tr = el('tr');
      tr.append(el('td', {}, r.fecha), el('td', {}, r.hora_inicio + '–' + r.hora_fin));
      const c = el('td'); c.append(el('div', {}, r.cliente), el('small', { style: 'color:var(--muted)' }, r.telefono + (r.pago ? ' · ' + r.pago : ''))); tr.append(c);
      tr.append(el('td', {}, r.servicio_nombre), el('td', {}, r.barbero + ' · ' + r.sede), el('td', {}, money(r.precio)));
      const sel = el('select', { 'aria-label': 'Estado de ' + r.codigo });
      ESTADOS.forEach(e => { const o = el('option', { value: e }, e.replace('_', ' ')); if (e === r.estado) o.selected = true; sel.append(o); });
      sel.addEventListener('change', async () => {
        try { await api('admin_estado', { id: r.id, estado: sel.value }); } catch (e) { alert(e.message); render(); }
      });
      const td = el('td'); td.append(sel); tr.append(td); t.append(tr);
    });
    const s = el('div', { class: 'table-scroll' }); s.append(t); v.append(s);
  }

  async function vistaResumen(v) {
    const d = await api('admin_resumen', {});
    v.replaceChildren(el('p', { style: 'color:var(--muted)' }, `Del ${d.desde} al ${d.hasta}`));
    const st = el('div', { class: 'stats' });
    [['Reservas activas', d.reservas], ['Ingresos (completadas)', money(d.ingresos)], ['Por cobrar (confirmadas)', money(d.pendiente)],
     ['Canceladas', d.canceladas], ['No asistió', d.no_asistio]].forEach(([k, val]) => {
      const s = el('div', { class: 'stat' }); s.append(el('b', {}, String(val)), el('span', {}, k)); st.append(s);
    });
    v.append(st);
    const lista = (titulo, rows, fmt) => {
      v.append(el('h3', { style: 'margin:16px 0 6px' }, titulo));
      if (!rows.length) return v.append(el('p', { style: 'color:var(--muted)' }, 'Sin datos.'));
      const t = el('table'); rows.forEach(r => { const tr = el('tr'); fmt(r).forEach(x => tr.append(el('td', {}, x))); t.append(tr); }); v.append(t);
    };
    lista('Ingresos por barbero', d.porBarbero, r => [r.nombre, r.citas + ' citas', money(r.ingresos)]);
    lista('Servicios más pedidos', d.porServicio, r => [r.nombre, r.citas + ' citas']);
  }

  async function vistaConfig(v) {
    const cfg = await api('admin_listar', { tabla: 'config' });
    v.replaceChildren();
    const ETQ = { nombre_negocio: 'Nombre del negocio', email_admin: 'Correo del administrador', intervalo_min: 'Intervalo entre horas (min)',
      anticipacion_min: 'Anticipación mínima (min)', dias_max_adelanto: 'Días máximos hacia adelante', cancelar_horas: 'Cancelación hasta X horas antes',
      max_activas_cliente: 'Reservas activas máx. por teléfono' };
    const inputs = {};
    Object.keys(ETQ).forEach(k => { const i = el('input', { value: cfg[k] || '' }); inputs[k] = i; v.append(el('label', {}, ETQ[k]), i); });
    const b = el('button', { class: 'btn primary', style: 'margin-top:16px' }, 'Guardar ajustes');
    b.addEventListener('click', async () => {
      const item = {}; Object.keys(inputs).forEach(k => item[k] = inputs[k].value);
      try { await api('admin_guardar', { tabla: 'config', item }); aviso(v, 'ok', 'Guardado.'); } catch (e) { aviso(v, 'err', e.message); }
    });
    v.append(b);
  }

  // Catálogo genérico: campos por tabla
  const CAMPOS = {
    servicios: [['nombre', 'Nombre', 'text'], ['precio', 'Precio', 'number'], ['duracion_min', 'Minutos', 'number']],
    barberos: [['nombre', 'Nombre', 'text'], ['telefono', 'Teléfono', 'text']],
    sedes: [['nombre', 'Nombre', 'text'], ['direccion', 'Dirección', 'text']],
    formas_pago: [['nombre', 'Nombre', 'text']],
    horarios: [['barbero_id', 'Barbero', 'ref:barberos'], ['sede_id', 'Sede', 'ref:sedes'], ['dia_semana', 'Día', 'dia'], ['hora_inicio', 'Desde', 'time'], ['hora_fin', 'Hasta', 'time']],
    bloqueos: [['barbero_id', 'Barbero (vacío = todos)', 'ref:barberos'], ['fecha', 'Fecha', 'date'], ['hora_inicio', 'Desde', 'time'], ['hora_fin', 'Hasta', 'time'], ['motivo', 'Motivo', 'text']]
  };
  const TIENE_ACTIVO = ['servicios', 'barberos', 'sedes', 'formas_pago'];

  async function vistaCatalogo(v, tabla) {
    const campos = CAMPOS[tabla];
    const refs = {};
    for (const [, , tipo] of campos) if (tipo.startsWith('ref:')) { const t = tipo.slice(4); refs[t] = refs[t] || await api('admin_listar', { tabla: t }); }
    const filas = await api('admin_listar', { tabla });
    v.replaceChildren();

    const mostrar = (c, val) => {
      if (val == null || val === '') return '—';
      if (c[2].startsWith('ref:')) { const r = refs[c[2].slice(4)].find(x => x.id === val); return r ? r.nombre : val; }
      if (c[2] === 'dia') return DIAS[val];
      if (c[2] === 'time') return String(val).slice(0, 5);
      if (c[0] === 'precio') return money(val);
      if (c[2] === 'date') return String(val).slice(0, 10);
      return val;
    };
    const t = el('table'), th = el('tr');
    campos.forEach(c => th.append(el('th', {}, c[1])));
    if (TIENE_ACTIVO.includes(tabla)) th.append(el('th', {}, 'Activo'));
    th.append(el('th', {}, '')); t.append(th);
    filas.forEach(f => {
      const tr = el('tr');
      campos.forEach(c => tr.append(el('td', {}, String(mostrar(c, f[c[0]])))));
      if (TIENE_ACTIVO.includes(tabla)) {
        const cb = el('input', { type: 'checkbox', style: 'width:auto', 'aria-label': 'Activo' }); cb.checked = f.activo;
        cb.addEventListener('change', async () => { try { await api('admin_guardar', { tabla, item: { id: f.id, activo: cb.checked } }); } catch (e) { alert(e.message); render(); } });
        const td = el('td'); td.append(cb); tr.append(td);
      }
      const td = el('td');
      if (!TIENE_ACTIVO.includes(tabla)) {
        const del = el('button', { class: 'btn sm danger' }, 'Borrar');
        del.addEventListener('click', async () => { if (confirm('¿Borrar?')) { try { await api('admin_borrar', { tabla, id: f.id }); render(); } catch (e) { alert(e.message); } } });
        td.append(del);
      } else {
        const ed = el('button', { class: 'btn sm' }, 'Editar');
        ed.addEventListener('click', () => form(f)); td.append(ed);
      }
      tr.append(td); t.append(tr);
    });
    const sc = el('div', { class: 'table-scroll' }); sc.append(t); v.append(sc);

    const caja = el('div', { style: 'margin-top:20px' }); v.append(caja);
    function form(item) {
      caja.replaceChildren(el('h3', {}, item ? 'Editar' : 'Agregar nuevo'));
      const ins = {};
      campos.forEach(([k, etq, tipo]) => {
        let i;
        if (tipo.startsWith('ref:')) {
          i = el('select'); i.append(el('option', { value: '' }, '—'));
          refs[tipo.slice(4)].forEach(r => i.append(el('option', { value: r.id }, r.nombre)));
        } else if (tipo === 'dia') {
          i = el('select'); DIAS.forEach((d, n) => i.append(el('option', { value: n }, d)));
        } else i = el('input', { type: tipo });
        if (item && item[k] != null) i.value = tipo === 'time' ? String(item[k]).slice(0, 5) : String(item[k]).slice(0, tipo === 'date' ? 10 : 200);
        ins[k] = i; caja.append(el('label', {}, etq), i);
      });
      const b = el('button', { class: 'btn primary', style: 'margin-top:14px' }, 'Guardar');
      b.addEventListener('click', async () => {
        const it = item ? { id: item.id } : {};
        Object.keys(ins).forEach(k => it[k] = ins[k].value);
        try { await api('admin_guardar', { tabla, item: it }); render(); } catch (e) { aviso(caja, 'err', e.message); }
      });
      caja.append(b);
    }
    form(null);
  }

  $('loginBtn').addEventListener('click', entrar);
  $('pass').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
  $('logout').addEventListener('click', salir);
  if (token) mostrarPanel();
})();
