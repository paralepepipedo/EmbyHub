// ============================================
// api/tareas.js — Gestión de tareas del alumno
// GET    /api/tareas              → listar tareas del usuario
// POST   /api/tareas              → crear nueva tarea
// PUT    /api/tareas              → actualizar tarea (entregar, calificar)
// DELETE /api/tareas              → eliminar tarea
// ============================================

import {
  query, getPerfil, agregarMonedas, agregarXP, actualizarRacha,
  res, resError, verificarAuth, getConfigEconomia
} from '../lib/neon.js';

// ============================================
// 1. GET — Listar tareas
// ============================================
async function listar(clerkId, url) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const esAdmin = url.searchParams.get('admin') === 'true' && perfil.rol === 'admin';
  const estado  = url.searchParams.get('estado');
  const asig    = url.searchParams.get('asignatura');

  // ── Vista admin: tareas entregadas pendientes de corrección del colegio ──
  if (esAdmin) {
    if (!perfil.colegio_id) return resError('Admin sin colegio asignado', 400);
    const params = [perfil.colegio_id];
    let sql = `
      SELECT t.*, p.nombre AS nombre_alumno
      FROM tareas t
      JOIN perfiles p ON p.id = t.user_id
      WHERE p.colegio_id = $1
        AND t.contenido_subido IS NOT NULL
        AND t.es_correcta IS NULL`;
    if (asig) { params.push(asig); sql += ` AND t.asignatura = $${params.length}`; }
    sql += ` ORDER BY t.created_at ASC`;
    const tareas = await query(sql, params);
    return res({ tareas, stats: { total: tareas.length } });
  }

  // ── Vista alumno normal ──
  let sql = `SELECT * FROM tareas WHERE user_id = $1`;
  const params = [perfil.id];

  if (estado === 'pendiente') {
    sql += ` AND es_correcta IS NULL`;
  } else if (estado === 'entregada') {
    sql += ` AND contenido_subido IS NOT NULL AND es_correcta IS NULL`;
  } else if (estado === 'calificada') {
    sql += ` AND es_correcta IS NOT NULL`;
  }

  if (asig) {
    params.push(asig);
    sql += ` AND asignatura = $${params.length}`;
  }

  sql += ` ORDER BY fecha DESC, created_at DESC`;

  const tareas = await query(sql, params);

  const total      = tareas.length;
  const entregadas = tareas.filter(t => t.contenido_subido || t.foto_url).length;
  const correctas  = tareas.filter(t => t.es_correcta === true).length;
  const pendientes = tareas.filter(t => !t.contenido_subido && !t.foto_url).length;

  return res({ tareas, stats: { total, entregadas, correctas, pendientes } });
}

// ============================================
// 2. POST — Crear tarea
// ============================================
async function crear(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const { asignatura, contenido, foto_url, fecha } = body;
  if (!asignatura) return resError('Falta asignatura');

  const fechaTarea = fecha || new Date().toISOString().split('T')[0];

  const rows = await query(
    `INSERT INTO tareas (user_id, fecha, asignatura, contenido_subido, foto_url)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [perfil.id, fechaTarea, asignatura, contenido || null, foto_url || null]
  );

  await verificarMisionTarea(perfil, asignatura);

  return res(rows[0], 201);
}

// ============================================
// 3. PUT — Actualizar tarea
// ============================================
async function actualizar(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const { id, contenido, foto_url, es_correcta, porcentaje_obtenido } = body;
  if (!id) return resError('Falta id');

  // Admin puede calificar tareas de cualquier alumno de su colegio
  const esAdmin = body.admin === true && perfil.rol === 'admin';
  let rows;
  if (esAdmin) {
    rows = await query(
      `SELECT t.* FROM tareas t
       JOIN perfiles p ON p.id = t.user_id
       WHERE t.id = $1 AND p.colegio_id = $2`,
      [id, perfil.colegio_id]
    );
  } else {
    rows = await query(
      `SELECT * FROM tareas WHERE id = $1 AND user_id = $2`,
      [id, perfil.id]
    );
  }
  const tarea = rows[0];
  if (!tarea) return resError('Tarea no encontrada', 404);

  const campos = {};
  if (contenido    !== undefined) campos.contenido_subido    = contenido;
  if (foto_url     !== undefined) campos.foto_url            = foto_url;
  if (es_correcta  !== undefined) campos.es_correcta         = es_correcta;
  if (porcentaje_obtenido !== undefined) campos.porcentaje_obtenido = porcentaje_obtenido;

  const keys   = Object.keys(campos);
  const values = Object.values(campos);
  if (keys.length === 0) return resError('Nada que actualizar');

  const set = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const updated = await query(
    `UPDATE tareas SET ${set} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  const tareaActual = updated[0];

  // Otorgar recompensa si se calificó y no se entregó antes
  let recompensa = null;
  if (es_correcta !== undefined && !tarea.recompensa_entregada) {
    // Para admin, necesitamos el perfil del alumno para darle la recompensa
    const perfilAlumno = esAdmin
      ? (await query('SELECT * FROM perfiles WHERE id = $1', [tarea.user_id]))[0]
      : perfil;
    if (perfilAlumno) {
      recompensa = await calcularRecompensaTarea(perfilAlumno, tareaActual);
    }
  }

  return res({ tarea: tareaActual, recompensa });
}

// ============================================
// 4. DELETE — Eliminar tarea
// ============================================
async function eliminar(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const { id } = body;
  if (!id) return resError('Falta id');

  await query(
    `DELETE FROM tareas WHERE id = $1 AND user_id = $2`,
    [id, perfil.id]
  );

  return res({ ok: true });
}

// ============================================
// 5. HELPERS
// ============================================
async function calcularRecompensaTarea(perfil, tarea) {
  const config = await getConfigEconomia();
  const pct    = Number(tarea.porcentaje_obtenido || 100);

  let monedas = 0;
  let mensaje = '';

  if (tarea.es_correcta && pct >= 100) {
    monedas = config.tarea_correcta || 100;
    mensaje = '✅ Tarea correcta (100%)';
  } else if (tarea.es_correcta && pct >= 80) {
    monedas = config.tarea_con_error || 80;
    mensaje = '✅ Tarea correcta con observaciones (' + pct + '%)';
  } else if (!tarea.es_correcta) {
    monedas = 0;
    mensaje = '❌ Tarea incorrecta — sin recompensa';
  }

  if (monedas > 0) {
    await agregarMonedas(
      perfil.id, monedas,
      `Tarea ${tarea.asignatura}: ${mensaje}`,
      tarea.id
    );
    await agregarXP(perfil.id, Math.floor(monedas / 2));
    await actualizarRacha(perfil.id);
    await query(
      `UPDATE tareas SET recompensa_entregada = TRUE WHERE id = $1`,
      [tarea.id]
    );
  }

  return { monedas, mensaje };
}

async function verificarMisionTarea(perfil, asignatura) {
  const hoy = new Date().toISOString().split('T')[0];
  const tiposMision = ['subir_tarea'];
  if (asignatura && asignatura.toLowerCase().includes('ingl')) {
    tiposMision.push('tarea_ingles');
  }

  for (const tipo of tiposMision) {
    const misions = await query(
      `SELECT * FROM misiones_diarias
       WHERE user_id = $1 AND fecha = $2 AND tipo_mision = $3 AND completada = FALSE
       LIMIT 1`,
      [perfil.id, hoy, tipo]
    );
    if (misions.length > 0) {
      const m = misions[0];
      await query(
        `UPDATE misiones_diarias SET completada = TRUE, completada_at = NOW() WHERE id = $1`,
        [m.id]
      );
      const monedas = Number(m.recompensa_monedas);
      await agregarMonedas(perfil.id, monedas, `Misión: ${m.descripcion}`, m.id);
      await agregarXP(perfil.id, Math.floor(monedas / 2));
    }
  }
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  const url = new URL(request.url);

  if (request.method === 'GET')    return listar(auth.clerkId, url);
  if (request.method === 'POST')   return crear(auth.clerkId, await request.json());
  if (request.method === 'PUT')    return actualizar(auth.clerkId, await request.json());
  if (request.method === 'DELETE') return eliminar(auth.clerkId, await request.json());

  return resError('Método no permitido', 405);
}
