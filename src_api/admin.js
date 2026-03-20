// ============================================
// ARCHIVO: Api/admin.js
// VERSIÓN: 1.8.0 — 2026-03-18
// Changelog:
//   1.8.0 - toggle_forzada: activa/desactiva flag forzada en pruebas_activas
//   1.7.0 - colegio_id en getEvaluacionesAdmin
//   1.6.0 - Agregar action=colegios para selector en formulario
//   1.5.0 - Fix fecha timezone y colegio_id en evaluaciones
//   1.4.0 - Evaluaciones admin: crear_evaluacion, editar_evaluacion,
//            eliminar_evaluacion, evaluaciones_admin
//            Fix columna contenidos (era descripcion)
//   1.3.0 - Tab evaluaciones admin, canjes pendientes, modal entrega
//   1.2.0 - Profesores, tienda items, evento activo
//   1.1.0 - KPIs, alumnos, misiones banco, economía
// Requiere perfil.rol === 'admin'
//
// GET  /api/admin?action=alumnos          → lista de alumnos con stats
// GET  /api/admin?action=transacciones    → últimas transacciones globales
// GET  /api/admin?action=misiones_banco   → banco de misiones
// GET  /api/admin?action=tienda_items     → ítems de tienda (todos, incluyendo deshabilitados)
// GET  /api/admin?action=economia         → config_economia
// GET  /api/admin?action=kpis             → KPIs del panel
// GET  /api/admin?action=profesores       → lista de profesores con grados asignados
// GET  /api/admin?action=evento_activo    → evento activo desde tabla eventos_activos
// POST /api/admin { action:'dar_monedas', clerk_id_alumno, cantidad, motivo }
// POST /api/admin { action:'crear_mision', tipo, descripcion, icono, recompensa_base }
// POST /api/admin { action:'crear_profesor', clerk_id, nombre, email, grados }
// POST /api/admin { action:'activar_evento', multiplicador, fin, alcance }
// PUT  /api/admin { action:'editar_mision', id, ...campos }
// PUT  /api/admin { action:'desactivar_evento' }
// DELETE /api/admin { action:'eliminar_mision', id }
// PUT  /api/admin { action:'actualizar_economia', clave, valor }
// POST /api/admin { action:'crear_item', nombre, categoria, tipo, precio, ... }
// PUT  /api/admin { action:'editar_item', id, ...campos }
// DELETE /api/admin { action:'eliminar_item', id }
// ============================================

import {
  query, getPerfil, agregarMonedas, agregarXP,
  res, resError, verificarAuth
} from '../lib/neon.js';

// ============================================
// Helper: arrays para Neon
// JSON.stringify([]) = "[]" → Neon rechaza con "malformed array literal"
// Neon espera: '{}' vacío  o  '{1,2,3}' con valores
// ============================================
function gradosParaNeon(arr) {
  if (!arr || !Array.isArray(arr) || arr.length === 0) return '{}';
  return '{' + arr.map(Number).filter(function (n) { return !isNaN(n); }).join(',') + '}';
}

// ============================================
// Helper: verificar que el solicitante es admin
// ============================================
async function getAdminPerfil(clerkId) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return null;
  if (perfil.rol !== 'admin') return null;
  return perfil;
}

// ============================================
// GET handlers
// ============================================
async function getAlumnos() {
  const anioActual = new Date().getFullYear();
  const hoy = new Date().toISOString().split('T')[0];

  const alumnos = await query(
    `SELECT
       p.id, p.clerk_id, p.nombre, p.email, p.avatar_base,
       p.nivel, p.xp, p.monedas, p.racha_dias, p.ultimo_login,
       p.energia_actual, p.grado_ingreso, p.anio_ingreso,
       (p.grado_ingreso + ($1 - p.anio_ingreso)) AS grado_actual,
       (SELECT COUNT(*) FROM misiones_diarias m
        WHERE m.user_id = p.id AND m.fecha = $2 AND m.completada = TRUE) AS misiones_hoy,
       (SELECT COUNT(*) FROM tareas t WHERE t.user_id = p.id) AS total_tareas,
       (SELECT COUNT(*) FROM tareas t WHERE t.user_id = p.id AND t.es_correcta = TRUE) AS tareas_correctas
     FROM perfiles p
     WHERE p.rol = 'alumno'
     ORDER BY p.monedas DESC`,
    [anioActual, hoy]
  );

  return res({ alumnos });
}

async function getTransacciones() {
  const trans = await query(
    `SELECT t.*, p.nombre, p.avatar_base
     FROM transacciones t
     JOIN perfiles p ON p.id = t.user_id
     ORDER BY t.created_at DESC
     LIMIT 50`
  );
  return res({ transacciones: trans });
}

async function getMisionesBanco() {
  const misiones = await query(
    `SELECT * FROM misiones_banco ORDER BY created_at ASC`
  );
  return res({ misiones });
}

async function getTiendaItems() {
  const items = await query(
    `SELECT * FROM tienda_items ORDER BY orden ASC, created_at ASC`
  );
  return res({ items });
}

async function getEconomia() {
  const config = await query(
    `SELECT clave, valor, descripcion, updated_at FROM config_economia ORDER BY clave`
  );
  return res({ config });
}

async function getKPIs() {
  const hoy = new Date().toISOString().split('T')[0];

  const [alumnos, misHoy, tareas, rachas] = await Promise.all([
    query(`SELECT COUNT(*) AS cnt FROM perfiles WHERE rol='alumno'`),
    query(`SELECT
             COUNT(*) FILTER (WHERE completada) AS hechas,
             COUNT(*) AS total
           FROM misiones_diarias WHERE fecha = $1`, [hoy]),
    query(`SELECT
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE es_correcta) AS correctas
           FROM tareas WHERE DATE(created_at) = $1`, [hoy]),
    query(`SELECT AVG(racha_dias) AS prom FROM perfiles WHERE rol='alumno'`),
  ]);

  const totalAlumnos = Number(alumnos[0]?.cnt || 0);
  const hechas = Number(misHoy[0]?.hechas || 0);
  const totalMis = Number(misHoy[0]?.total || 0);
  const pctMisiones = totalMis > 0 ? Math.round((hechas / totalMis) * 100) : 0;
  const totalTareas = Number(tareas[0]?.total || 0);
  const correctas = Number(tareas[0]?.correctas || 0);
  const pctTareas = totalTareas > 0 ? Math.round((correctas / totalTareas) * 100) : 0;
  const rachaProm = Math.round(Number(rachas[0]?.prom || 0) * 10) / 10;

  return res({
    alumnos_activos: totalAlumnos,
    pct_misiones: pctMisiones,
    pct_tareas: pctTareas,
    racha_promedio: rachaProm,
  });
}

async function getProfesores() {
  const anio = new Date().getFullYear();

  const profesores = await query(
    `SELECT
       p.id, p.clerk_id, p.nombre, p.email, p.accesorios
     FROM perfiles p
     WHERE p.rol = 'profesor'
     ORDER BY p.nombre ASC`,
    []
  );

  // Para cada profesor, contar cuántos alumnos tiene en sus grados
  const result = [];
  for (const prof of profesores) {
    const grados = (prof.accesorios || []).map(Number).filter(Boolean);
    let totalAlumnos = 0;
    if (grados.length > 0) {
      const rows = await query(
        `SELECT COUNT(*) AS cnt FROM perfiles
         WHERE rol = 'alumno'
           AND (grado_ingreso + ($1 - anio_ingreso)) = ANY($2::int[])`,
        [anio, grados]
      );
      totalAlumnos = Number(rows[0]?.cnt || 0);
    }
    result.push({ ...prof, total_alumnos: totalAlumnos });
  }

  return res({ profesores: result });
}

// ============================================
// POST: Dar monedas a un alumno
// ============================================
async function darMonedas(body) {
  const { clerk_id_alumno, cantidad, motivo } = body;
  if (!clerk_id_alumno || !cantidad || cantidad <= 0) {
    return resError('Faltan datos: clerk_id_alumno, cantidad');
  }

  const alumno = await getPerfil(clerk_id_alumno);
  if (!alumno) return resError('Alumno no encontrado', 404);

  await agregarMonedas(
    alumno.id,
    Number(cantidad),
    motivo || 'Premio del profesor'
  );

  return res({
    ok: true,
    alumno: alumno.nombre,
    monedas: Number(cantidad),
    saldo_nuevo: alumno.monedas + Number(cantidad),
  });
}

// ============================================
// POST: Crear misión en banco
// ============================================
async function crearMision(body) {
  const {
    tipo, descripcion, icono, recompensa_base, recompensa_xp,
    categoria, dificultad, url_destino, requiere_puntos, nivel_minimo,
    peso_sorteo, forzada, limite_semanal, es_semanal, meta_progreso,
    grados_aptos, activo,
    condicion_tipo, juego_id, accion_trigger, meta_cantidad,
    meta_tiempo_seg, parametro_valor, mensaje_logro, oculta,
  } = body;
  if (!tipo || !descripcion) return resError('Faltan tipo y descripción');

  const existe = await query('SELECT id FROM misiones_banco WHERE tipo = $1', [tipo]);
  if (existe.length > 0) return resError('Ya existe una misión con ese tipo', 409);

  const base = recompensa_base || 60;
  const rows = await query(
    `INSERT INTO misiones_banco (
       tipo, descripcion, icono, recompensa_base, recompensa_xp,
       categoria, dificultad, url_destino, requiere_puntos, nivel_minimo,
       peso_sorteo, forzada, limite_semanal, es_semanal, meta_progreso,
       grados_aptos, activo,
       condicion_tipo, juego_id, accion_trigger, meta_cantidad,
       meta_tiempo_seg, parametro_valor, mensaje_logro, oculta
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
       $16::int[],$17,$18,$19,$20,$21,$22,$23,$24,$25
     ) RETURNING *`,
    [
      tipo, descripcion.trim(), icono || '🎯', base, recompensa_xp || Math.floor(base / 2),
      categoria || 'juego', dificultad || 1, url_destino || null, requiere_puntos || null, nivel_minimo || 1,
      peso_sorteo || 5, forzada || false, limite_semanal || 3, es_semanal || false, meta_progreso || 1,
      gradosParaNeon(grados_aptos), activo !== false,
      condicion_tipo || 'auto', juego_id || null, accion_trigger || 'juego_completado',
      meta_cantidad || 1, meta_tiempo_seg || null, parametro_valor || null,
      mensaje_logro || null, oculta || false,
    ]
  );
  return res(rows[0], 201);
}

// ============================================
// GET: Estado del evento activo
// ============================================
async function getEventoActivo() {
  try {
    const rows = await query(
      `SELECT id, nombre, multiplicador, alcance, inicio, fin
       FROM eventos_activos
       WHERE activo = TRUE AND fin > NOW()
       ORDER BY created_at DESC LIMIT 1`
    );
    if (!rows || rows.length === 0) return res({ evento: null });
    const e = rows[0];
    return res({
      evento: {
        id: e.id,
        nombre: e.nombre,
        multiplicador: Number(e.multiplicador),
        alcance: e.alcance,
        inicio: e.inicio,
        fin: e.fin,
      }
    });
  } catch (_) {
    return res({ evento: null });
  }
}

// ============================================
// POST: Activar evento x2
// ============================================
async function activarEvento(body) {
  const { multiplicador, fin, alcance, nombre } = body;
  if (!fin) return resError('Falta fecha de fin');
  if (new Date(fin) <= new Date()) return resError('La fecha de fin debe ser futura');

  // Desactivar cualquier evento activo anterior
  await query(`UPDATE eventos_activos SET activo = FALSE WHERE activo = TRUE`);

  // Crear nuevo evento
  const rows = await query(
    `INSERT INTO eventos_activos (nombre, multiplicador, alcance, fin)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [
      nombre || 'Evento especial',
      Number(multiplicador || 2),
      alcance || 'marcadas',
      fin,
    ]
  );

  // Si alcance = 'todas', marcar evento_activo en todas las misiones activas
  if (alcance === 'todas') {
    await query(
      `UPDATE misiones_banco
       SET evento_activo = TRUE, evento_multiplicador = $1, evento_fin = $2
       WHERE activo = TRUE`,
      [multiplicador || 2, fin]
    );
  }

  return res({ ok: true, evento: rows[0] });
}

// ============================================
// PUT: Desactivar evento
// ============================================
async function desactivarEvento() {
  await query(`UPDATE eventos_activos SET activo = FALSE WHERE activo = TRUE`);
  await query(`UPDATE misiones_banco SET evento_activo = FALSE`);
  return res({ ok: true });
}

// ============================================
// POST: Crear perfil de profesor
// ============================================
async function crearProfesor(body) {
  const { clerk_id, nombre, email, grados } = body;
  if (!clerk_id || !nombre || !email) {
    return resError('Faltan campos obligatorios: clerk_id, nombre, email');
  }

  // Verificar que no exista ya
  const existente = await query(
    'SELECT id FROM perfiles WHERE clerk_id = $1',
    [clerk_id]
  );
  if (existente.length > 0) {
    return resError('Ya existe un perfil con ese Clerk ID', 409);
  }

  const rows = await query(
    `INSERT INTO perfiles
       (clerk_id, nombre, email, grado_ingreso, anio_ingreso, monedas, rol, accesorios)
     VALUES ($1, $2, $3, 1, $4, 0, 'profesor', $5)
     RETURNING *`,
    [
      clerk_id,
      nombre.trim(),
      email.toLowerCase(),
      new Date().getFullYear(),
      grados || [],
    ]
  );

  return res({ ok: true, profesor: rows[0] }, 201);
}

// ============================================
// PUT: Editar misión del banco
// ============================================
async function editarMision(body) {
  const { id, ...campos } = body;
  if (!id) return resError('Falta id');

  const allowed = [
    'tipo', 'descripcion', 'icono', 'recompensa_base', 'recompensa_xp', 'activo',
    'categoria', 'dificultad', 'url_destino', 'requiere_puntos', 'nivel_minimo',
    'peso_sorteo', 'forzada', 'limite_semanal', 'es_semanal', 'meta_progreso',
    'grados_aptos', 'evento_activo', 'evento_multiplicador', 'evento_fin',
    // Campos nuevos
    'condicion_tipo', 'juego_id', 'accion_trigger', 'meta_cantidad',
    'meta_tiempo_seg', 'parametro_valor', 'mensaje_logro', 'oculta',
  ];
  const keys = Object.keys(campos).filter(k => allowed.includes(k));
  const values = keys.map(k => campos[k]);
  if (keys.length === 0) return resError('Nada que actualizar');

  // grados_aptos necesita cast explícito a int[]
  const setClauses = keys.map((k, i) => {
    if (k === 'grados_aptos') return `${k} = $${i + 2}::int[]`;
    return `${k} = $${i + 2}`;
  });
  // Para grados_aptos, convertir array a JSON string que Neon pueda castear
  const valuesFixed = values.map((v, i) => {
    if (keys[i] === 'grados_aptos') return gradosParaNeon(Array.isArray(v) ? v : []);
    return v;
  });
  const set = setClauses.join(', ');
  const rows = await query(
    `UPDATE misiones_banco SET ${set} WHERE id = $1 RETURNING *`,
    [id, ...valuesFixed]
  );
  if (!rows[0]) return resError('Misión no encontrada', 404);
  return res(rows[0]);
}

// ============================================
// DELETE: Eliminar misión del banco
// ============================================
async function eliminarMision(body) {
  const { id } = body;
  if (!id) return resError('Falta id');
  await query(
    `UPDATE misiones_banco SET activo = FALSE WHERE id = $1`,
    [id]
  );
  return res({ ok: true });
}

// ============================================
// PUT: Actualizar config economía
// ============================================
async function actualizarEconomia(body) {
  const { clave, valor } = body;
  if (!clave || valor === undefined) return resError('Faltan clave y valor');

  await query(
    `UPDATE config_economia SET valor = $1, updated_at = NOW() WHERE clave = $2`,
    [Number(valor), clave]
  );
  return res({ ok: true, clave, valor: Number(valor) });
}

// ============================================
// POST: Crear ítem de tienda
// ============================================
async function crearItem(body) {
  const {
    nombre, categoria, tipo, precio, nivel_minimo,
    emoji, imagen_url, descripcion,
    stock, compra_repetida, disponible,
    duracion_horas, multiplicador, alcance
  } = body;

  if (!nombre || !precio) return resError('Faltan nombre y precio');

  const rows = await query(
    `INSERT INTO tienda_items
      (nombre, categoria, tipo, precio, nivel_minimo,
       emoji, imagen_url, descripcion,
       stock, compra_repetida, disponible,
       duracion_horas, multiplicador, alcance)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      nombre,
      categoria || 'cosmético',
      tipo || 'cosmético',
      Number(precio),
      Number(nivel_minimo) || 1,
      emoji || '',
      imagen_url || null,
      descripcion || null,
      stock !== undefined && stock !== null && stock !== '' ? Number(stock) : null,
      Boolean(compra_repetida),
      disponible !== false,

      // <-- CORRECCIONES AQUÍ: 0 y 1 en lugar de null para cumplir con NOT NULL de Neon
      duracion_horas ? Number(duracion_horas) : 0,
      multiplicador ? Number(multiplicador) : 1,

      alcance || 'todo',
    ]
  );
  return res(rows[0]);
}

// ============================================
// PUT: Editar ítem de tienda
// ============================================
async function editarItem(body) {
  const { id, ...campos } = body;
  if (!id) return resError('Falta id');

  // Evitar NOT NULL en columnas con default
  if (campos.alcance === null || campos.alcance === undefined) campos.alcance = 'todo';
  if (campos.duracion_horas === null) campos.duracion_horas = 0;
  if (campos.multiplicador === null) campos.multiplicador = 1;

  // <-- NUEVA PROTECCIÓN: Si al editar se envía nulo, se cambia por texto en blanco
  if (campos.emoji === null) campos.emoji = '';

  const allowed = [
    'nombre', 'categoria', 'tipo', 'precio', 'nivel_minimo',
    'emoji', 'imagen_url', 'descripcion',
    'stock', 'compra_repetida', 'disponible',
    'duracion_horas', 'multiplicador', 'alcance', 'orden',
  ];

  const keys = Object.keys(campos).filter(k => allowed.includes(k));
  if (keys.length === 0) return resError('Nada que actualizar');

  const values = keys.map(k => campos[k]);
  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');

  const rows = await query(
    `UPDATE tienda_items SET ${set} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  if (!rows[0]) return resError('Ítem no encontrado', 404);
  return res(rows[0]);
}

// ============================================
// DELETE: Eliminar ítem de tienda (físico)
// ============================================
async function eliminarItem(body) {
  const { id } = body;
  if (!id) return resError('Falta id');
  await query(`DELETE FROM tienda_items WHERE id = $1`, [id]);
  return res({ ok: true });
}

// ============================================
// GET: Evaluaciones del admin (todas, con origen='admin')
// ============================================
async function getColegios() {
  const rows = await query(`SELECT id, nombre FROM colegios WHERE activo = true ORDER BY nombre ASC`);
  return res({ colegios: rows || [] });
}

async function getEvaluacionesAdmin() {
  const rows = await query(
    `SELECT id, asignatura, fecha_evaluacion,
            COALESCE(tipo_evaluacion, 'prueba') AS tipo_evaluacion,
            grado AS grado_destinatario,
            colegio_id,
            contenidos AS descripcion,
            estado, origen, created_at
     FROM evaluaciones
     WHERE origen = 'admin'
     ORDER BY fecha_evaluacion ASC`
  );
  return res({ evaluaciones: rows });
}

// ============================================
// POST: Crear evaluación del admin
// ============================================
async function crearEvaluacion(body) {
  const { asignatura, fecha_evaluacion, tipo_evaluacion, grado, colegio_id, descripcion } = body;
  if (!asignatura || !fecha_evaluacion) return resError('Faltan asignatura y fecha');

  // Normalizar fecha a solo YYYY-MM-DD (evitar timezone shifts)
  const fechaStr = fecha_evaluacion.split('T')[0];

  const rows = await query(
    `INSERT INTO evaluaciones
      (asignatura, fecha_evaluacion, tipo_evaluacion, grado, colegio_id, contenidos, origen, estado)
     VALUES ($1, $2, $3, $4, $5, $6, 'admin', 'pendiente')
     RETURNING *`,
    [asignatura, fechaStr, tipo_evaluacion || 'prueba', grado || null, colegio_id || null, descripcion || null]
  );
  return res(rows[0], 201);
}

// ============================================
// PUT: Editar evaluación del admin
// ============================================
async function editarEvaluacion(body) {
  const { id, asignatura, fecha_evaluacion, tipo_evaluacion, grado, colegio_id, descripcion } = body;
  if (!id) return resError('Falta id');

  const fechaStr = fecha_evaluacion ? fecha_evaluacion.split('T')[0] : null;

  const rows = await query(
    `UPDATE evaluaciones
     SET asignatura = $2, fecha_evaluacion = $3, tipo_evaluacion = $4,
         grado = $5, colegio_id = $6, contenidos = $7
     WHERE id = $1 AND origen = 'admin'
     RETURNING *`,
    [id, asignatura, fechaStr, tipo_evaluacion || 'prueba', grado || null, colegio_id || null, descripcion || null]
  );
  if (!rows[0]) return resError('Evaluación no encontrada', 404);
  return res(rows[0]);
}

// ============================================
// DELETE: Eliminar evaluación del admin
// ============================================
async function eliminarEvaluacion(body) {
  const { id } = body;
  if (!id) return resError('Falta id');
  await query(`DELETE FROM evaluaciones WHERE id = $1 AND origen = 'admin'`, [id]);
  return res({ ok: true });
}

// ============================================
// GET: Canjes pendientes de entrega
// ============================================
async function getCanjesPendientes() {
  const rows = await query(
    `SELECT inv.id, inv.user_id, inv.item_id, inv.precio_pagado, inv.created_at,
            inv.estado, inv.nota_regalo,
            ti.nombre AS item_nombre, ti.emoji, ti.categoria,
            p.nombre  AS alumno_nombre
     FROM tienda_inventario inv
     JOIN tienda_items ti ON ti.id = inv.item_id
     JOIN perfiles p      ON p.id  = inv.user_id
     WHERE inv.estado = 'inactivo'
       AND ti.tipo = 'canjeable'
     ORDER BY inv.created_at ASC`
  );
  return res({ canjes: rows });
}

// ============================================
// PUT: Marcar canje como entregado
// ============================================
async function marcarEntregado(body, clerkId) {
  const { inventario_id, nota } = body;
  if (!inventario_id) return resError('Falta inventario_id');

  // Obtener perfil del admin para registrar quién entregó
  const adminPerfil = await getPerfil(clerkId);

  const rows = await query(
    `UPDATE tienda_inventario
     SET estado       = 'entregado',
         entregado_por = $2,
         entregado_at  = NOW(),
         nota_regalo   = $3
     WHERE id = $1 AND estado = 'inactivo'
     RETURNING *`,
    [inventario_id, adminPerfil?.id || null, nota || null]
  );
  if (!rows[0]) return resError('Ítem no encontrado o ya entregado', 404);

  // ─── TELEGRAM: pendiente de configurar ────────────────────────────
  // Cuando se configure el bot, descomentar y completar:
  // const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // '8617578510:AAEZUO-siYqpQmx9j8fI-nvFQhMoZa_YLEo'
  // const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;   // Obtener enviando /start al bot y leyendo el chat_id
  // if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
  //   await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({
  //       chat_id: TELEGRAM_CHAT_ID,
  //       text: `✅ Entrega registrada\nÍtem: ${rows[0].item_nombre}\nAlumno: ${rows[0].alumno_nombre}\nEntregado por: ${adminPerfil?.nombre || 'Admin'}\nNota: ${nota || '—'}`,
  //     })
  //   });
  // }
  // ──────────────────────────────────────────────────────────────────

  return res({ ok: true });
}

// ============================================
// POST: Activar/Desactivar flag forzada en prueba
// ============================================
async function toggleForzadaPrueba(body) {
  const { id, forzada } = body;
  if (!id) return resError('Falta id');
  if (typeof forzada !== 'boolean') return resError('forzada debe ser true o false');
  await query(
    `UPDATE public.pruebas_activas SET forzada = $1, updated_at = now() WHERE id = $2`,
    [forzada, id]
  );
  return res({ ok: true, id, forzada });
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  const admin = await getAdminPerfil(auth.clerkId);
  if (!admin) return resError('Acceso denegado — se requiere rol admin', 403);

  const url = new URL(request.url);

  // GET
  if (request.method === 'GET') {
    const action = url.searchParams.get('action');
    if (action === 'alumnos') return getAlumnos();
    if (action === 'transacciones') return getTransacciones();
    if (action === 'misiones_banco') return getMisionesBanco();
    if (action === 'tienda_items') return getTiendaItems();
    if (action === 'canjes_pendientes') return getCanjesPendientes();
    if (action === 'colegios') return getColegios();
    if (action === 'evaluaciones_admin') return getEvaluacionesAdmin();
    if (action === 'economia') return getEconomia();
    if (action === 'kpis') return getKPIs();
    if (action === 'profesores') return getProfesores();
    if (action === 'evento_activo') return getEventoActivo();
    return resError('action no reconocida');
  }

  const body = await request.json();

  // POST
  if (request.method === 'POST') {
    if (body.action === 'dar_monedas') return darMonedas(body);
    if (body.action === 'crear_mision') return crearMision(body);
    if (body.action === 'crear_profesor') return crearProfesor(body);
    if (body.action === 'activar_evento') return activarEvento(body);
    if (body.action === 'crear_item') return crearItem(body);
    if (body.action === 'crear_evaluacion') return crearEvaluacion(body);
    if (body.action === 'guardar_banco_preguntas') return guardarBancoPreguntas(body);
    if (body.action === 'get_banco_stats') return getBancoStats();
    if (body.action === 'crear_prueba_activa') return crearPruebaActiva(body);
    if (body.action === 'get_pruebas_activas') return getPruebasActivas();
    if (body.action === 'toggle_prueba') return togglePruebaActiva(body);
    if (body.action === 'toggle_forzada') return toggleForzadaPrueba(body);
    if (body.action === 'get_preguntas_unidad') return getPreguntasUnidad(body);
    if (body.action === 'eliminar_pregunta_banco') return eliminarPreguntaBanco(body);
    if (body.action === 'editar_pregunta_banco') return editarPreguntaBanco(body);
    if (body.action === 'editar_prueba_activa') return editarPruebaActiva(body);
    if (body.action === 'get_banco_filas') return getBancoFilas();
    if (body.action === 'eliminar_fila_banco') return eliminarFilaBanco(body);
    if (body.action === 'eliminar_prueba_activa') return eliminarPruebaActiva(body);

    return resError('action no reconocida');
  }

  // PUT
  if (request.method === 'PUT') {
    if (body.action === 'editar_mision') return editarMision(body);
    if (body.action === 'actualizar_economia') return actualizarEconomia(body);
    if (body.action === 'desactivar_evento') return desactivarEvento();
    if (body.action === 'editar_item') return editarItem(body);
    if (body.action === 'marcar_entregado') return marcarEntregado(body, auth.clerkId);
    if (body.action === 'editar_evaluacion') return editarEvaluacion(body);
    return resError('action no reconocida');
  }

  // DELETE
  if (request.method === 'DELETE') {
    if (body.action === 'eliminar_mision') return eliminarMision(body);
    if (body.action === 'eliminar_item') return eliminarItem(body);
    if (body.action === 'eliminar_evaluacion') return eliminarEvaluacion(body);
    return resError('action no reconocida');
  }

  return resError('Método no permitido', 405);
}
// ============================================
// POST: Guardar JSON de IA en el Banco de Pruebas
// ============================================
async function guardarBancoPreguntas(body) {
  const { asignatura, grado, unidad, tema, preguntas } = body;

  if (!asignatura || !grado || !unidad || !preguntas) {
    return resError('Faltan datos obligatorios');
  }

  // Insertar en Neon (preguntas ya viene como array desde el frontend)
  const rows = await query(
    `INSERT INTO banco_preguntas (asignatura, grado, unidad, tema, preguntas)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      asignatura,
      Number(grado),
      Number(unidad),
      tema || '',
      JSON.stringify(preguntas)
    ]
  );

  return res({ ok: true, id: rows[0].id });
}
// ============================================
// POST: Obtener estadísticas del Almacén
// ============================================
async function getBancoStats() {
  const rows = await query(`
    SELECT asignatura, grado, unidad, SUM(jsonb_array_length(preguntas))::int as total_preguntas
    FROM banco_preguntas
    GROUP BY asignatura, grado, unidad
    ORDER BY asignatura, grado, unidad
  `);
  return res({ ok: true, stats: rows });
}

// ============================================
// POST: Armar y Activar Prueba
// ============================================
async function crearPruebaActiva(body) {
  const { nombre, asignatura, grado, unidades, preguntas_por_intento, recompensa_monedas, recompensa_xp } = body;
  if (!nombre || !unidades || unidades.length === 0) return resError('Faltan datos');

  const rows = await query(`
    INSERT INTO pruebas_activas 
      (nombre, asignatura, grado, unidades, preguntas_por_intento, recompensa_monedas, recompensa_xp, activa)
    VALUES ($1, $2, $3, $4, $5, $6, $7, true) RETURNING id
  `, [nombre, asignatura, Number(grado), unidades, Number(preguntas_por_intento), Number(recompensa_monedas), Number(recompensa_xp)]);

  return res({ ok: true, id: rows[0].id });
}

// ============================================
// POST: Listar Pruebas Activas
// ============================================
async function getPruebasActivas() {
  const rows = await query(`SELECT * FROM pruebas_activas ORDER BY created_at DESC`);
  return res({ ok: true, pruebas: rows });
}

// ============================================
// POST: Activar/Desactivar Prueba
// ============================================
async function togglePruebaActiva(body) {
  if (!body.id) return resError('Falta id');
  await query(`UPDATE pruebas_activas SET activa = $1 WHERE id = $2`, [Boolean(body.estado), body.id]);
  return res({ ok: true });
}
// ============================================
// POST: Obtener preguntas específicas para Editar
// ============================================
async function getPreguntasUnidad(body) {
  const { asignatura, grado, unidad } = body;
  if (!asignatura || !grado || !unidad) return resError('Faltan filtros');

  const rows = await query(`
    SELECT id, tema, preguntas 
    FROM banco_preguntas 
    WHERE asignatura = $1 AND grado = $2 AND unidad = $3
  `, [asignatura, Number(grado), Number(unidad)]);

  return res({ ok: true, filas: rows });
}

// ============================================
// POST: Eliminar quirúrgicamente una pregunta de un JSON
// ============================================
async function eliminarPreguntaBanco(body) {
  const { row_id, index } = body;
  if (!row_id || index === undefined) return resError('Faltan datos');

  // 1. Obtenemos el JSON completo de esa fila
  const rows = await query(`SELECT preguntas FROM banco_preguntas WHERE id = $1`, [row_id]);
  if (rows.length === 0) return resError('Fila no encontrada');

  let arrayPreguntas = rows[0].preguntas;

  // 2. Eliminamos la pregunta específica del arreglo
  arrayPreguntas.splice(index, 1);

  // 3. Volvemos a guardar (Si el arreglo quedó vacío, borramos la fila entera para no dejar basura)
  if (arrayPreguntas.length === 0) {
    await query(`DELETE FROM banco_preguntas WHERE id = $1`, [row_id]);
  } else {
    await query(`UPDATE banco_preguntas SET preguntas = $1::jsonb WHERE id = $2`, [JSON.stringify(arrayPreguntas), row_id]);
  }

  return res({ ok: true });
}
// ============================================
// POST: Editar JSON de una pregunta específica
// ============================================
async function editarPreguntaBanco(body) {
  const { row_id, index, nueva_pregunta } = body;
  if (!row_id || index === undefined || !nueva_pregunta) return resError('Faltan datos');

  const rows = await query(`SELECT preguntas FROM banco_preguntas WHERE id = $1`, [row_id]);
  if (rows.length === 0) return resError('Fila no encontrada');

  let arrayPreguntas = rows[0].preguntas;
  arrayPreguntas[index] = nueva_pregunta; // Reemplazamos la vieja por la nueva editada

  await query(`UPDATE banco_preguntas SET preguntas = $1::jsonb WHERE id = $2`, [JSON.stringify(arrayPreguntas), row_id]);
  return res({ ok: true });
}

// ============================================
// POST: Guardar cambios de una evaluación editada
// ============================================
async function editarPruebaActiva(body) {
  const { id, nombre, asignatura, grado, unidades, preguntas_por_intento, recompensa_monedas, recompensa_xp } = body;
  if (!id) return resError('Falta ID de prueba');

  await query(`
    UPDATE pruebas_activas 
    SET nombre = $1, asignatura = $2, grado = $3, unidades = $4, preguntas_por_intento = $5, recompensa_monedas = $6, recompensa_xp = $7, updated_at = now()
    WHERE id = $8
  `, [nombre, asignatura, Number(grado), unidades, Number(preguntas_por_intento), Number(recompensa_monedas), Number(recompensa_xp), id]);

  return res({ ok: true });
}

async function getBancoFilas() {
  const rows = await query(
    `SELECT id, asignatura, grado, unidad, tema, created_at,
            jsonb_array_length(preguntas) AS total_preguntas
     FROM banco_preguntas
     ORDER BY asignatura, grado, unidad, created_at ASC`
  );
  return res({ ok: true, filas: rows });
}

async function eliminarFilaBanco(body) {
  const { row_id } = body;
  if (!row_id) return resError('Falta row_id');
  await query(`DELETE FROM banco_preguntas WHERE id = $1`, [row_id]);
  return res({ ok: true });
}

async function eliminarPruebaActiva(body) {
  const { id } = body;
  if (!id) return resError('Falta id');
  await query(`DELETE FROM pruebas_activas WHERE id = $1`, [id]);
  return res({ ok: true });
}