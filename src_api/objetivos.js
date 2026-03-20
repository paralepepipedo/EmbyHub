// ============================================================
// ARCHIVO: /api/objetivos.js
// VERSIÓN: 1.0.0 — 2026-03-08
// Changelog:
//   1.0.0 - Implementación inicial
//           GET  → lista objetivos del curso + progreso del alumno
//           POST → admin: crear objetivo
//           PUT  → admin: editar objetivo
//           DELETE → admin: eliminar objetivo
// ============================================================
// GET  /api/objetivos?colegio_id=X&grado=Y
//        → { objetivos, stats, historial }
// POST /api/objetivos  { ...campos }     → admin: crear
// PUT  /api/objetivos  { id, ...campos } → admin: editar
// DELETE /api/objetivos { id }           → admin: eliminar
// ============================================================

import {
  query, getPerfil, agregarMonedas, agregarXP,
  res, resError, verificarAuth
} from '../lib/neon.js';

// ============================================================
// CALCULAR PROGRESO REAL desde BD según tipo_metrica
// Todas las métricas usan el período del objetivo (fecha_inicio/fin)
// o el mes actual si no hay fechas definidas.
// ============================================================
async function calcularProgreso(perfilId, tipoMetrica, fechaInicio, fechaFin) {
  // Definir rango temporal como strings ISO para Neon
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().split('T')[0];
  const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
  const inicio = fechaInicio || primerDiaMes;
  const fin = fechaFin || ultimoDiaMes;

  switch (tipoMetrica) {
    case 'juegos_completados': {
      const r = await query(
        `SELECT COUNT(*) AS cnt FROM juegos_partidas
         WHERE user_id = $1 AND completado = true
           AND created_at >= $2 AND created_at <= $3`,
        [perfilId, inicio, fin]
      );
      return Number(r?.[0]?.cnt || 0);
    }

    case 'misiones_completadas': {
      const r = await query(
        `SELECT COUNT(*) AS cnt FROM misiones_diarias
         WHERE user_id = $1 AND completada = true
           AND fecha >= $2 AND fecha <= $3`,
        [perfilId, inicio.toISOString().split('T')[0], fin.toISOString().split('T')[0]]
      );
      return Number(r?.[0]?.cnt || 0);
    }

    case 'tareas_entregadas': {
      const r = await query(
        `SELECT COUNT(*) AS cnt FROM tareas
         WHERE user_id = $1 AND es_correcta IS NOT NULL
           AND fecha >= $2 AND fecha <= $3`,
        [perfilId, inicio.toISOString().split('T')[0], fin.toISOString().split('T')[0]]
      );
      return Number(r?.[0]?.cnt || 0);
    }

    case 'racha_dias': {
      // Racha actual del alumno (no tiene rango temporal)
      const r = await query(
        `SELECT racha_dias FROM perfiles WHERE id = $1`,
        [perfilId]
      );
      return Number(r?.[0]?.racha_dias || 0);
    }

    case 'xp_acumulado': {
      const r = await query(
        `SELECT COALESCE(SUM(xp_ganado),0) AS total FROM historial_xp
         WHERE user_id = $1
           AND created_at >= $2 AND created_at <= $3`,
        [perfilId, inicio, fin]
      );
      return Number(r?.[0]?.total || 0);
    }

    case 'evaluaciones_aprobadas': {
      const r = await query(
        `SELECT COUNT(*) AS cnt FROM evaluaciones
         WHERE user_id = $1 AND nota_obtenida >= 4.0
           AND fecha_evaluacion >= $2 AND fecha_evaluacion <= $3`,
        [perfilId, inicio.toISOString().split('T')[0], fin.toISOString().split('T')[0]]
      );
      return Number(r?.[0]?.cnt || 0);
    }

    default:
      return 0;
  }
}

// ============================================================
// GET — listar objetivos con progreso del alumno
// ============================================================
async function getObjetivos(clerkId, searchParams) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const colegioId = searchParams.get('colegio_id') || perfil.colegio_id;
  const grado = searchParams.get('grado') || perfil.grado_ingreso;

  if (!colegioId || !grado) {
    return res({ objetivos: [], stats: { completados: 0, total: 0, monedas_ganados: 0, pct: 0 }, historial: [] });
  }

  // Obtener objetivos activos del curso
  const objRows = await query(
    `SELECT id, emoji, titulo, descripcion, color, tipo_metrica,
            meta, monedas, xp, fecha_inicio, fecha_fin
     FROM objetivos
     WHERE colegio_id = $1 AND grado = $2 AND activo = true
     ORDER BY created_at DESC`,
    [colegioId, grado]
  );

  const objetivos = [];
  if (!objRows?.length) {
    return res({ objetivos: [], stats: { completados: 0, total: 0, monedas_ganados: 0, pct: 0 }, historial: [] });
  }
  let totalCompletados = 0;
  let totalMonedas = 0;

  for (const o of (objRows || [])) {
    // Progreso actual del alumno
    const actual = await calcularProgreso(perfil.id, o.tipo_metrica, o.fecha_inicio, o.fecha_fin);
    const pct = Math.min(100, Math.round((actual / o.meta) * 100));
    const completado = actual >= o.meta;

    // Ver si ya recibió recompensa
    const progrRow = await query(
      `SELECT recompensa_entregada FROM objetivos_progreso
       WHERE objetivo_id = $1 AND user_id = $2`,
      [o.id, perfil.id]
    );
    const recompensaEntregada = progrRow?.[0]?.recompensa_entregada || false;

    // Si completó y no ha recibido recompensa → entregar
    if (completado && !recompensaEntregada) {
      await entregarRecompensa(perfil, o);
    }

    if (completado) totalCompletados++;
    objetivos.push({
      id: o.id,
      emoji: o.emoji,
      titulo: o.titulo,
      descripcion: o.descripcion,
      color: o.color,
      tipo: o.tipo_metrica,
      meta: o.meta,
      actual,
      pct,
      monedas: o.monedas,
      xp: o.xp,
      fecha_fin: o.fecha_fin,
      completado,
      recompensa_entregada: recompensaEntregada || completado,
    });

    if (completado) totalMonedas += o.monedas;
  }

  const total = objetivos.length;
  const pctGlobal = total ? Math.round((totalCompletados / total) * 100) : 0;

  // Historial: transacciones de tipo 'ganancia' con concepto 'Objetivo:...'
  const histRows = await query(
    `SELECT concepto, monto, created_at FROM transacciones
     WHERE user_id = $1 AND concepto LIKE 'Objetivo:%'
     ORDER BY created_at DESC LIMIT 20`,
    [perfil.id]
  );

  return res({
    objetivos,
    stats: {
      completados: totalCompletados,
      total,
      monedas_ganados: totalMonedas,
      pct: pctGlobal,
    },
    historial: histRows || [],
  });
}

// ============================================================
// ENTREGAR RECOMPENSA al completar objetivo
// ============================================================
async function entregarRecompensa(perfil, objetivo) {
  try {
    // Upsert en objetivos_progreso marcando entregado
    await query(
      `INSERT INTO objetivos_progreso (objetivo_id, user_id, progreso_actual, completado, completado_at, recompensa_entregada)
       VALUES ($1, $2, $3, true, NOW(), true)
       ON CONFLICT (objetivo_id, user_id) DO UPDATE
       SET progreso_actual = EXCLUDED.progreso_actual,
           completado = true,
           completado_at = COALESCE(objetivos_progreso.completado_at, NOW()),
           recompensa_entregada = true,
           updated_at = NOW()`,
      [objetivo.id, perfil.id, objetivo.meta]
    );

    // Dar monedas y XP
    await agregarMonedas(perfil.id, objetivo.monedas,
      `Objetivo: ${objetivo.titulo}`, objetivo.id);
    await agregarXP(perfil.id, objetivo.xp,
      `Objetivo: ${objetivo.titulo}`, 'objetivo', objetivo.id);
  } catch (e) {
    console.error('[objetivos] Error entregando recompensa:', e.message);
  }
}

// ============================================================
// POST — admin: crear objetivo
// ============================================================
async function crearObjetivo(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil || perfil.rol !== 'admin') return resError('No autorizado', 403);

  const { colegio_id, grado, emoji, titulo, descripcion, color,
    tipo_metrica, meta, monedas, xp, fecha_inicio, fecha_fin } = body;

  if (!colegio_id || !grado || !titulo || !tipo_metrica || !meta) {
    return resError('Faltan campos obligatorios');
  }

  const r = await query(
    `INSERT INTO objetivos
       (colegio_id, grado, emoji, titulo, descripcion, color,
        tipo_metrica, meta, monedas, xp, fecha_inicio, fecha_fin,
        created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING id`,
    [colegio_id, grado, emoji || '🎯', titulo, descripcion || null,
      color || '#22c55e', tipo_metrica, meta, monedas || 200, xp || 50,
      fecha_inicio || null, fecha_fin || null, perfil.id]
  );

  return res({ ok: true, id: r?.[0]?.id || null });
}

// ============================================================
// PUT — admin: editar objetivo
// ============================================================
async function editarObjetivo(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil || perfil.rol !== 'admin') return resError('No autorizado', 403);

  const { id, emoji, titulo, descripcion, color,
    tipo_metrica, meta, monedas, xp, fecha_inicio, fecha_fin, activo } = body;

  if (!id) return resError('Falta id');

  await query(
    `UPDATE objetivos SET
       emoji       = COALESCE($2, emoji),
       titulo      = COALESCE($3, titulo),
       descripcion = $4,
       color       = COALESCE($5, color),
       tipo_metrica = COALESCE($6, tipo_metrica),
       meta        = COALESCE($7, meta),
       monedas     = COALESCE($8, monedas),
       xp          = COALESCE($9, xp),
       fecha_inicio = $10,
       fecha_fin    = $11,
       activo      = COALESCE($12, activo),
       updated_at  = NOW()
     WHERE id = $1`,
    [id, emoji, titulo, descripcion || null, color,
      tipo_metrica, meta, monedas, xp,
      fecha_inicio || null, fecha_fin || null, activo ?? null]
  );

  return res({ ok: true });
}

// ============================================================
// DELETE — admin: eliminar objetivo
// ============================================================
async function eliminarObjetivo(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil || perfil.rol !== 'admin') return resError('No autorizado', 403);

  const { id } = body;
  if (!id) return resError('Falta id');

  await query(`DELETE FROM objetivos WHERE id = $1`, [id]);
  return res({ ok: true });
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  try {
    const auth = await verificarAuth(request);
    if (!auth.ok) return resError('No autorizado', 401);

    const clerkId = auth.clerkId;
    const method = request.method.toUpperCase();
    const url = new URL(request.url);

    if (method === 'GET') {
      return await getObjetivos(clerkId, url.searchParams);
    }

    const body = await request.json().catch(() => ({}));

    if (method === 'POST') return await crearObjetivo(clerkId, body);
    if (method === 'PUT') return await editarObjetivo(clerkId, body);
    if (method === 'DELETE') return await eliminarObjetivo(clerkId, body);

    return resError('Método no permitido', 405);

  } catch (e) {
    console.error('[api/objetivos]', e);
    return resError('Error interno: ' + e.message, 500);
  }
}