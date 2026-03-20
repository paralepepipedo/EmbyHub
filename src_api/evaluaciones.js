// ============================================
// api/evaluaciones.js — Calendario de pruebas (por curso)
//
// MODELO:
//   evaluaciones          → creadas por admin, pertenecen a colegio+grado
//   evaluaciones_resultados → registro personal de cada alumno (nota, estado, foto)
//
// ENDPOINTS:
//   GET    /api/evaluaciones?colegio_id=X&grado=Y  → evaluaciones del curso + resultado personal
//   POST   /api/evaluaciones                        → crear evaluación (solo admin)
//   POST   /api/evaluaciones/batch                  → carga masiva (solo admin)
//   PUT    /api/evaluaciones                        → actualizar eval (admin) o resultado (alumno)
//   DELETE /api/evaluaciones                        → eliminar eval (solo admin)
// ============================================

import {
  query, getPerfil, agregarMonedas, agregarXP,
  res, resError, verificarAuth, getConfigEconomia
} from '../lib/neon.js';

// ============================================
// 1. GET — Listar evaluaciones del curso
// ============================================
async function listar(clerkId, url) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const colegioId = url.searchParams.get('colegio_id') || perfil.colegio_id;
  const grado = parseInt(url.searchParams.get('grado') || perfil.grado_actual || perfil.grado_ingreso || 0);

  if (!colegioId || !grado) {
    return resError('No se puede determinar el curso. Pasa colegio_id y grado como parámetros.', 400);
  }

  const mes = url.searchParams.get('mes');
  const anio = url.searchParams.get('anio') || new Date().getFullYear();

  let sqlQuery = `
    SELECT
      e.*,
      er.id              AS resultado_id,
      er.nota_obtenida   AS nota_obtenida,
      er.estado          AS estado,
      er.foto_url        AS foto_url,
      er.recompensa_entregada AS recompensa_entregada
    FROM evaluaciones e
    LEFT JOIN evaluaciones_resultados er
      ON er.evaluacion_id = e.id AND er.user_id = $3
    WHERE e.colegio_id = $1
      AND e.grado      = $2
  `;
  const params = [colegioId, grado, perfil.id];

  if (mes) {
    params.push(mes, anio);
    sqlQuery += `
      AND EXTRACT(MONTH FROM e.fecha_evaluacion) = $4
      AND EXTRACT(YEAR  FROM e.fecha_evaluacion) = $5
    `;
  }

  sqlQuery += ` ORDER BY e.fecha_evaluacion ASC`;

  const rows = await query(sqlQuery, params);

  const evaluaciones = rows.map(e => ({
    id: e.id,
    colegio_id: e.colegio_id,
    grado: e.grado,
    asignatura: e.asignatura,
    fecha_evaluacion: e.fecha_evaluacion,
    contenidos: e.contenidos,
    nota_esperada: e.nota_esperada ? Number(e.nota_esperada) : null,
    rango_min: e.rango_min ? Number(e.rango_min) : null,
    rango_max: e.rango_max ? Number(e.rango_max) : null,
    resultado_id: e.resultado_id || null,
    nota_obtenida: e.nota_obtenida ? Number(e.nota_obtenida) : null,
    estado: e.estado || 'pendiente',
    foto_url: e.foto_url || null,
    recompensa_entregada: !!e.recompensa_entregada,
    created_by: e.created_by || null,
  }));

  const pendientes = evaluaciones.filter(e => ['pendiente', 'estudiado', 'rendida'].includes(e.estado)).length;
  const rendidas = evaluaciones.filter(e => e.nota_obtenida !== null).length;
  const notas = evaluaciones.filter(e => e.nota_obtenida).map(e => e.nota_obtenida);
  const promedioNotas = notas.length
    ? notas.reduce((s, n) => s + n, 0) / notas.length
    : null;

  return res({ evaluaciones, estadisticas: { pendientes, rendidas, promedio_notas: promedioNotas } });
}

// ============================================
// 2. POST — Crear evaluación individual (solo admin)
// ============================================
async function crear(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);
  if (perfil.rol !== 'admin') return resError('Solo administradores pueden crear evaluaciones', 403);

  const { colegio_id, grado, asignatura, fecha_evaluacion, contenidos, nota_esperada } = body;

  if (!colegio_id || !grado || !asignatura || !fecha_evaluacion) {
    return resError('Faltan campos: colegio_id, grado, asignatura, fecha_evaluacion');
  }

  let rango_min = null;
  let rango_max = null;
  if (nota_esperada !== undefined && nota_esperada !== null) {
    const nota = Number(nota_esperada);
    rango_min = nota === 7.0 ? 7.0 : Math.max(1.0, nota - 0.5);
    rango_max = nota === 7.0 ? 7.0 : Math.min(7.0, nota + 0.5);
  }

  const rows = await query(
    `INSERT INTO evaluaciones
       (colegio_id, grado, asignatura, fecha_evaluacion, contenidos,
        nota_esperada, rango_min, rango_max, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [colegio_id, grado, asignatura, fecha_evaluacion,
      contenidos || null, nota_esperada || null, rango_min, rango_max, perfil.id]
  );

  return res({ evaluacion: rows[0] }, 201);
}

// ============================================
// 3. POST /batch — Carga masiva (solo admin)
// ============================================
async function crearBatch(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);
  if (perfil.rol !== 'admin') return resError('Solo administradores pueden crear evaluaciones masivamente', 403);

  const { colegio_id, grado, evaluaciones } = body;

  if (!colegio_id || !grado || !Array.isArray(evaluaciones)) {
    return resError('Datos incompletos. Se requiere colegio_id, grado y evaluaciones[]', 400);
  }

  if (grado < 1 || grado > 8) {
    return resError('Grado debe estar entre 1 y 8', 400);
  }

  if (evaluaciones.length === 0) {
    return resError('Debe enviar al menos una evaluación', 400);
  }

  if (evaluaciones.length > 50) {
    return resError('Máximo 50 evaluaciones por batch', 400);
  }

  const ASIGNATURAS_VALIDAS = [
    'Matematicas', 'Lenguaje', 'Historia', 'Ciencias',
    'Ingles', 'Ed. Fisica', 'Musica', 'Artes', 'Tecnologia'
  ];

  const TIPOS_VALIDOS = [
    'prueba', 'trabajo', 'tarea', 'disertacion', 'laboratorio'
  ];

  const colegioCheck = await query(
    `SELECT id, nombre FROM colegios WHERE id = $1`,
    [colegio_id]
  );

  if (!colegioCheck[0]) {
    return resError('Colegio no encontrado', 404);
  }

  const erroresValidacion = [];

  evaluaciones.forEach((ev, index) => {
    const errores = [];

    if (!ev.asignatura || !ASIGNATURAS_VALIDAS.includes(ev.asignatura)) {
      errores.push(`Asignatura inválida: ${ev.asignatura}`);
    }

    if (!ev.fecha_evaluacion) {
      errores.push('Falta fecha_evaluacion');
    } else {
      const fecha = new Date(ev.fecha_evaluacion);
      if (isNaN(fecha.getTime())) {
        errores.push(`Fecha inválida: ${ev.fecha_evaluacion}`);
      }
    }

    if (!ev.tipo_evaluacion || !TIPOS_VALIDOS.includes(ev.tipo_evaluacion)) {
      errores.push(`Tipo inválido: ${ev.tipo_evaluacion}`);
    }

    if (errores.length > 0) {
      erroresValidacion.push({
        index: index + 1,
        evaluacion: ev,
        errores: errores
      });
    }
  });

  if (erroresValidacion.length > 0) {
    return resError('Errores de validación en las evaluaciones', 400, {
      detalles: erroresValidacion
    });
  }

  const valores = [];
  const placeholders = [];
  let paramIndex = 1;

  evaluaciones.forEach((ev) => {
    const row = [
      colegio_id,
      grado,
      ev.asignatura,
      ev.fecha_evaluacion,
      ev.contenidos || null,
      ev.tipo_evaluacion,
      'admin',
      perfil.id,
      'pendiente'
    ];

    valores.push(...row);

    const rowPlaceholder = `(${row.map((_, i) => `$${paramIndex + i}`).join(',')})`;
    placeholders.push(rowPlaceholder);
    paramIndex += row.length;
  });

  const sql = `
    INSERT INTO evaluaciones
      (colegio_id, grado, asignatura, fecha_evaluacion, contenidos, 
       tipo_evaluacion, origen, created_by, estado)
    VALUES ${placeholders.join(', ')}
    RETURNING *
  `;

  try {
    const resultado = await query(sql, valores);

    return res({
      success: true,
      insertadas: resultado.length,
      evaluaciones: resultado,
      mensaje: `${resultado.length} evaluaciones creadas para ${colegioCheck[0].nombre} - ${grado}° Básico`
    }, 201);

  } catch (error) {
    console.error('Error en INSERT batch:', error);
    return resError('Error al guardar evaluaciones en la base de datos', 500, {
      detalles: error.message
    });
  }
}

// ============================================
// 4. PUT — Actualizar
// ============================================
async function actualizar(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const { id, estado, nota_obtenida, foto_url,
    asignatura, fecha_evaluacion, contenidos, nota_esperada } = body;
  if (!id) return resError('Falta el id de la evaluación');

  if (perfil.rol === 'admin' && (asignatura || fecha_evaluacion || contenidos !== undefined || nota_esperada !== undefined)) {
    const evalRow = await query(`SELECT * FROM evaluaciones WHERE id = $1`, [id]);
    if (!evalRow[0]) return resError('Evaluación no encontrada', 404);

    const campos = {};
    if (asignatura) campos.asignatura = asignatura;
    if (fecha_evaluacion) campos.fecha_evaluacion = fecha_evaluacion;
    if (contenidos !== undefined) campos.contenidos = contenidos || null;
    if (nota_esperada !== undefined) {
      const nota = nota_esperada !== null ? Number(nota_esperada) : null;
      campos.nota_esperada = nota;
      campos.rango_min = nota === null ? null : nota === 7.0 ? 7.0 : Math.max(1.0, nota - 0.5);
      campos.rango_max = nota === null ? null : nota === 7.0 ? 7.0 : Math.min(7.0, nota + 0.5);
    }

    const keys = Object.keys(campos);
    const values = Object.values(campos);
    const set = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');

    const updated = await query(
      `UPDATE evaluaciones SET ${set}, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, ...values]
    );
    return res({ evaluacion: updated[0] });
  }

  const evalRow = await query(`SELECT * FROM evaluaciones WHERE id = $1`, [id]);
  if (!evalRow[0]) return resError('Evaluación no encontrada', 404);

  const existing = await query(
    `SELECT * FROM evaluaciones_resultados WHERE evaluacion_id = $1 AND user_id = $2`,
    [id, perfil.id]
  );

  let resultado;
  if (existing[0]) {
    const campos = {};
    if (estado) campos.estado = estado;
    if (foto_url) campos.foto_url = foto_url;
    if (nota_obtenida !== undefined && nota_obtenida !== null) {
      campos.nota_obtenida = Number(nota_obtenida);
      campos.estado = 'nota_ingresada';
    }

    const keys = Object.keys(campos);
    const values = Object.values(campos);
    const set = keys.map((k, i) => `${k} = $${i + 3}`).join(', ');

    const updated = await query(
      `UPDATE evaluaciones_resultados SET ${set}, updated_at = NOW()
       WHERE evaluacion_id = $1 AND user_id = $2 RETURNING *`,
      [id, perfil.id, ...values]
    );
    resultado = updated[0];
  } else {
    const nuevoEstado = (nota_obtenida !== undefined && nota_obtenida !== null)
      ? 'nota_ingresada'
      : (estado || 'pendiente');

    const inserted = await query(
      `INSERT INTO evaluaciones_resultados
         (evaluacion_id, user_id, nota_obtenida, estado, foto_url)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, perfil.id,
        nota_obtenida !== undefined ? Number(nota_obtenida) : null,
        nuevoEstado,
        foto_url || null]
    );
    resultado = inserted[0];
  }

  let recompensa = null;
  const yaEntregada = existing[0]?.recompensa_entregada || false;
  if (nota_obtenida !== undefined && nota_obtenida !== null && !yaEntregada) {
    recompensa = await calcularRecompensa(perfil, evalRow[0], Number(nota_obtenida));
  }

  return res({ evaluacion: { ...evalRow[0], ...resultado }, recompensa });
}

// ============================================
// 5. DELETE — Eliminar evaluación (solo admin)
// ============================================
async function eliminar(clerkId, body) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);
  if (perfil.rol !== 'admin') return resError('Solo administradores pueden eliminar evaluaciones', 403);

  const { id } = body;
  if (!id) return resError('Falta el id');

  await query(`DELETE FROM evaluaciones WHERE id = $1`, [id]);
  return res({ ok: true });
}

// ============================================
// 6. HELPER: Calcular y entregar recompensa
// ============================================
async function calcularRecompensa(perfil, evaluacion, nota) {
  const config = await getConfigEconomia();
  const rangoMin = evaluacion.rango_min ? Number(evaluacion.rango_min) : null;
  const rangoMax = evaluacion.rango_max ? Number(evaluacion.rango_max) : null;

  let monedas = 0;
  let mensaje = '';
  let tipo = 'sin_recompensa';

  if (nota === 7.0) {
    monedas = config.nota_7_exacto || 300;
    mensaje = '🌟 ¡Nota máxima! Recompensa máxima';
    tipo = 'nota_7';
  } else if (rangoMin !== null && nota >= rangoMin && nota <= rangoMax) {
    monedas = config.nota_en_rango || 150;
    mensaje = '✅ Nota dentro del rango esperado';
    tipo = 'en_rango';
  } else {
    monedas = config.nota_fuera_rango || 0;
    mensaje = '❌ Nota fuera del rango esperado';
    tipo = 'fuera_rango';
  }

  if (monedas > 0) {
    await agregarMonedas(
      perfil.id, monedas,
      `Evaluación ${evaluacion.asignatura}: ${nota} → ${mensaje}`,
      evaluacion.id
    );
    await agregarXP(perfil.id, Math.floor(monedas / 3));
  }

  await query(
    `UPDATE evaluaciones_resultados
     SET recompensa_entregada = TRUE
     WHERE evaluacion_id = $1 AND user_id = $2`,
    [evaluacion.id, perfil.id]
  );

  return { monedas, mensaje, tipo };
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  const url = new URL(request.url);

  // Ruta especial para batch usando query parameter
  if (request.method === 'POST' && url.searchParams.get('action') === 'batch') {
    return crearBatch(auth.clerkId, await request.json());
  }

  if (request.method === 'GET') return listar(auth.clerkId, url);
  if (request.method === 'POST') return crear(auth.clerkId, await request.json());
  if (request.method === 'PUT') return actualizar(auth.clerkId, await request.json());
  if (request.method === 'DELETE') return eliminar(auth.clerkId, await request.json());

  return resError('Método no permitido', 405);
}