(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const S = { cat: null, paso: 1, servicio: null, sede: null, barbero: null, fecha: '', hora: '', slots: [], busy: false };
  const money = n => '$' + Number(n).toLocaleString('es-CO');

  async function api(action, data) {
    const r = await fetch('/api', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action }, data))
    });
    const j = await r.json().catch(() => ({ ok: false, error: 'Respuesta inválida del servidor.' }));
    if (!j.ok) throw new Error(j.error || 'Error');
    return j.data;
  }
  function el(tag, attrs, text) {
    const e = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
    if (text != null) e.textContent = text;
    return e;
  }
  function msg(tipo, texto) {
    const box = $('msg');
    box.replaceChildren();
    if (texto) box.append(el('div', { class: 'msg ' + tipo }, texto));
  }

  // ── Opciones ────────────────────────────────────────────────
  function pintarOpciones(cont, items, sel, onPick, extra) {
    cont.replaceChildren();
    items.forEach(it => {
      const b = el('button', { type: 'button', class: 'opt', 'aria-pressed': String(sel && sel.id === it.id) });
      b.append(el('b', {}, it.nombre));
      if (extra) b.append(extra(it));
      b.addEventListener('click', () => onPick(it));
      cont.append(b);
    });
    if (!items.length) cont.append(el('div', { class: 'empty' }, 'No hay opciones disponibles.'));
  }

  function pintarServicios() {
    pintarOpciones($('optServicios'), S.cat.servicios, S.servicio, s => {
      S.servicio = s; limpiarDesde(2); pintarServicios(); resumen(); validar();
    }, s => {
      const f = el('small'); f.append(el('span', { class: 'price' }, money(s.precio)), document.createTextNode(' · ' + s.duracion_min + ' min'));
      return f;
    });
  }
  function pintarSedesBarberos() {
    const sedeIds = new Set(S.cat.horarios.map(h => h.sede_id));
    pintarOpciones($('optSedes'), S.cat.sedes.filter(s => sedeIds.has(s.id)), S.sede, s => {
      S.sede = s; if (S.barbero && !atiende(S.barbero.id, s.id)) S.barbero = null;
      limpiarDesde(3); pintarSedesBarberos(); resumen(); validar();
    }, s => el('small', {}, s.direccion || ''));
    const lista = S.sede ? S.cat.barberos.filter(b => atiende(b.id, S.sede.id)) : [];
    pintarOpciones($('optBarberos'), lista, S.barbero, b => {
      S.barbero = b; limpiarDesde(3); pintarSedesBarberos(); resumen(); validar();
    });
    if (!S.sede) { $('optBarberos').replaceChildren(el('div', { class: 'empty' }, 'Primero elige una sede.')); }
  }
  const atiende = (bid, sid) => S.cat.horarios.some(h => h.barbero_id === bid && h.sede_id === sid);

  function limpiarDesde(paso) {
    if (paso <= 3) { S.hora = ''; S.slots = []; $('slots').replaceChildren(); }
  }

  // ── Horas ───────────────────────────────────────────────────
  async function cargarSlots() {
    S.hora = ''; resumen(); validar();
    const cont = $('slots');
    if (!S.fecha) { cont.replaceChildren(el('div', { class: 'empty' }, 'Elige una fecha.')); return; }
    cont.replaceChildren(el('div', { class: 'empty' }, 'Buscando horarios…'));
    try {
      S.slots = await api('disponibilidad', { fecha: S.fecha, barbero_id: S.barbero.id, servicio_id: S.servicio.id, sede_id: S.sede.id });
      cont.replaceChildren();
      if (!S.slots.length) cont.append(el('div', { class: 'empty' }, 'Sin horarios ese día. Prueba otra fecha u otro barbero.'));
      S.slots.forEach(h => {
        const b = el('button', { type: 'button', class: 'slot', 'aria-pressed': String(S.hora === h) }, h);
        b.addEventListener('click', () => {
          S.hora = h; cont.querySelectorAll('.slot').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
          resumen(); validar();
        });
        cont.append(b);
      });
    } catch (e) { cont.replaceChildren(el('div', { class: 'empty' }, e.message)); }
  }

  function fechasExtra() {
    return [...document.querySelectorAll('#extraDates input')].map(i => i.value).filter(Boolean);
  }
  function agregarFecha() {
    const n = document.querySelectorAll('#extraDates .line').length;
    if (n >= 9) { msg('warn', 'Máximo 9 fechas adicionales.'); return; }
    const line = el('div', { class: 'line' });
    const inp = el('input', { type: 'date', min: S.cat.hoy, max: S.cat.max_fecha, 'aria-label': 'Fecha adicional' });
    const del = el('button', { type: 'button', class: 'btn sm danger', 'aria-label': 'Quitar fecha' }, '✕');
    del.addEventListener('click', () => { line.remove(); resumen(); });
    inp.addEventListener('change', resumen);
    line.append(inp, del); $('extraDates').append(line);
  }

  // ── Resumen y validación ────────────────────────────────────
  function resumen() {
    const dl = $('resumen'); dl.replaceChildren();
    const fila = (t, v) => { if (v) { dl.append(el('dt', {}, t), el('dd', {}, v)); } };
    fila('Servicio', S.servicio && S.servicio.nombre + ' (' + S.servicio.duracion_min + ' min)');
    fila('Sede', S.sede && S.sede.nombre);
    fila('Barbero', S.barbero && S.barbero.nombre);
    fila('Fecha', S.fecha && (S.fecha + (S.hora ? ' · ' + S.hora : '')));
    const extra = fechasExtra();
    if (extra.length) fila('Fechas extra', extra.join(', '));
    if (!dl.children.length) dl.append(el('dd', { style: 'color:var(--muted)' }, 'Aún no has elegido nada.'));
    const t = $('total');
    t.hidden = !S.servicio;
    if (S.servicio) t.textContent = 'Total ' + money(S.servicio.precio * (1 + extra.length));
  }
  function validar() {
    const ok = { 1: !!S.servicio, 2: !!(S.sede && S.barbero), 3: !!(S.fecha && S.hora), 4: !S.busy }[S.paso];
    $('next').disabled = !ok;
  }

  // ── Navegación ──────────────────────────────────────────────
  function irA(p) {
    S.paso = p; msg('', '');
    [1, 2, 3, 4].forEach(i => { $('s' + i).hidden = i !== p; });
    [...$('steps').children].forEach((li, i) => { li.className = i + 1 < p ? 'done' : (i + 1 === p ? 'on' : ''); });
    $('back').hidden = p === 1;
    $('next').textContent = p === 4 ? 'Confirmar reserva' : 'Continuar';
    if (p === 2) pintarSedesBarberos();
    if (p === 3) { $('fecha').min = S.cat.hoy; $('fecha').max = S.cat.max_fecha; cargarSlots(); }
    validar();
    $('s' + p).querySelector('h2').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function confirmar() {
    const nombre = $('nombre').value.trim(), tel = $('telefono').value.trim();
    ['nombre', 'telefono'].forEach(i => $(i).removeAttribute('aria-invalid'));
    if (nombre.length < 2) { $('nombre').setAttribute('aria-invalid', 'true'); $('nombre').focus(); return msg('err', 'Ingresa tu nombre.'); }
    if (tel.replace(/\D/g, '').length < 7) { $('telefono').setAttribute('aria-invalid', 'true'); $('telefono').focus(); return msg('err', 'Ingresa un teléfono válido.'); }
    S.busy = true; $('next').disabled = true; $('next').textContent = 'Reservando…'; msg('warn', 'Procesando tu reserva…');
    try {
      const r = await api('reservar', {
        nombre, telefono: tel, email: $('email').value.trim(), forma_pago_id: $('pago').value || null,
        servicio_id: S.servicio.id, barbero_id: S.barbero.id, sede_id: S.sede.id,
        fecha: S.fecha, hora: S.hora, fechas_extra: $('repetir').checked ? fechasExtra() : [], web: $('web').value
      });
      mostrarOk(r); reiniciar();
    } catch (e) { msg('err', e.message); }
    S.busy = false; $('next').textContent = 'Confirmar reserva'; validar();
  }

  function mostrarOk(r) {
    const b = $('okBody'); b.replaceChildren();
    b.append(el('p', {}, `${r.servicio} con ${r.barbero} · ${r.sede} · ${r.hora}–${r.hora_fin}`));
    r.creadas.forEach(c => { b.append(el('div', { class: 'code' }, c.codigo), el('p', { style: 'text-align:center;margin:0' }, c.fecha)); });
    if (r.fallidas.length) b.append(el('div', { class: 'msg warn' }, 'No disponibles: ' + r.fallidas.map(f => f.fecha).join(', ')));
    b.append(el('p', { style: 'color:var(--muted)' }, 'Guarda tu código: con él y tu teléfono puedes consultar o cancelar.'));
    $('dlgOk').showModal();
  }
  function reiniciar() {
    Object.assign(S, { paso: 1, servicio: null, sede: null, barbero: null, fecha: '', hora: '', slots: [] });
    $('fecha').value = ''; $('repetir').checked = false; $('extraBox').hidden = true; $('extraDates').replaceChildren();
    $('form').reset(); pintarServicios(); resumen(); irA(1);
  }

  // ── Consulta / cancelación ──────────────────────────────────
  async function buscar() {
    const out = $('cOut'); out.replaceChildren();
    try {
      const r = await api('consultar', { codigo: $('cCodigo').value, telefono: $('cTel').value });
      out.append(el('p', {}, `${r.servicio_nombre} con ${r.barbero} · ${r.sede}`),
                 el('p', {}, `${r.fecha} · ${r.hora_inicio}–${r.hora_fin} · ${money(r.precio)}`),
                 el('p', {}, 'Estado: ' + r.estado.replace('_', ' ')));
      if (r.estado === 'confirmada') {
        const b = el('button', { class: 'btn danger', type: 'button' }, 'Cancelar reserva');
        b.addEventListener('click', async () => {
          if (!confirm('¿Cancelar esta reserva?')) return;
          try { await api('cancelar', { codigo: r.codigo, telefono: $('cTel').value }); out.replaceChildren(el('div', { class: 'msg ok' }, 'Reserva cancelada.')); }
          catch (e) { out.append(el('div', { class: 'msg err' }, e.message)); }
        });
        out.append(b);
      }
    } catch (e) { out.append(el('div', { class: 'msg err' }, e.message)); }
  }

  // ── Inicio ──────────────────────────────────────────────────
  async function init() {
    try {
      S.cat = await api('catalogo');
    } catch (e) { msg('err', 'No se pudo cargar el catálogo: ' + e.message); return; }
    $('negocio').textContent = S.cat.negocio; document.title = 'Reserva tu cita · ' + S.cat.negocio;
    const pago = $('pago'); pago.replaceChildren(el('option', { value: '' }, 'Pago en el local'));
    S.cat.pagos.forEach(p => pago.append(el('option', { value: p.id }, p.nombre)));
    pintarServicios(); resumen(); irA(1);

    $('next').addEventListener('click', () => S.paso === 4 ? confirmar() : irA(S.paso + 1));
    $('back').addEventListener('click', () => irA(S.paso - 1));
    $('fecha').addEventListener('change', e => { S.fecha = e.target.value; cargarSlots(); });
    $('repetir').addEventListener('change', e => {
      $('extraBox').hidden = !e.target.checked;
      if (e.target.checked && !document.querySelector('#extraDates .line')) agregarFecha();
      resumen();
    });
    $('addFecha').addEventListener('click', agregarFecha);
    $('okClose').addEventListener('click', () => $('dlgOk').close());
    $('openConsulta').addEventListener('click', () => $('dlgConsulta').showModal());
    $('cClose').addEventListener('click', () => $('dlgConsulta').close());
    $('cBuscar').addEventListener('click', buscar);
  }
  init();
})();
