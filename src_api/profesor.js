// ============================================
// api/profesor.js — Panel del Profesor
// Requiere perfil.rol === 'profesor' o 'admin'
//
// GET  /api/profesor?action=mis_cursos
//      → cursos asignados al profesor con lista de alumnos y stats del día
//
// GET  /api/profesor?action=alumnos&grado=6
//      → alumnos de un grado con stats completos del día
//
// GET  /api/profesor?action=alumno_detalle&clerk_id=xxx
//      → detalle completo de un alumno (misiones, tareas, evaluaciones, transacciones)
//
// POST /api/profesor { action:'crear_tarea', asignatura, fecha, contenido, grado? | clerk_id_alumno? }
//      → crea tarea para uno o todos los alumnos de un grado
//
// POST /api/profesor { action:'crear_evaluacion', asignatura, fecha_evaluacion, contenidos?, nota_esperada?, grado? | clerk_id_alumno? }
//      → agenda evaluación en el calendario de uno o todos los alumnos
//
// POST /api/profesor { action:'asignar_curso', clerk_id_profesor, grados:[6,7] }
//      → asigna grados a un profesor (solo admin)
// ============================================

import {
  query, getPerfil, res, resError, verificarAuth
} from '../lib/neon.js';

// ============================================
// Helper: verificar que es profesor o admin
// ============================================
async function getProfesorPerfil(clerkId) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return null;
  if (perfil.rol !== 'profesor' && perfil.rol !== 'admin') return null;
  return perfil;
}

// ============================================
// GET: Cursos asignados al profesor
// Los grados asignados se guardan en el campo
// accesorios del perfil del profesor como array
// de números: [6, 7]
// Admin ve todos los grados sin restricción.
// ============================================
async function getMisCursos(profesor) {
  const anio             = new Date().getFullYear();
  const hoy              = new Date().toISOString().split('T')[0];
  const cursosAsignados  = profesor.accesorios || [];

  let alumnos;

  if (profesor.rol === 'admin' || cursosAsignados.length === 0) {
    alumnos = await query(
      `SELECT
         p.id, p.clerk_id, p.nombre, p.email, p.avatar_base,
         p.nivel, p.monedas, p.xp, p.racha_dias, p.ultimo_login,
         (p.grado_ingreso + ($1 - p.anio_ingreso)) AS grado_actual,
         (SELECT COUNT(*) FROM misiones_diarias m
          WHERE m.user_id = p.id AND m.fecha = $2 AND m.completada = TRUE
         ) AS misiones_completadas_hoy,
         (SELECT COUNT(*) FROM misiones_diarias m
          WHERE m.user_id = p.id AND m.fecha = $2
         ) AS misiones_total_hoy
       FROM perfiles p
       WHERE p.rol = 'alumno'
       ORDER BY grado_actual ASC, p.nombre ASC`,
      [anio, hoy]
    );
  } else {
    const grados = cursosAsignados.map(Number).filter(Boolean);
    alumnos = await query(
      `SELECT
         p.id, p.clerk_id, p.nombre, p.email, p.avatar_base,
         p.nivel, p.monedas, p.xp, p.racha_dias, p.ultimo_login,
         (p.grado_ingreso + ($1 - p.anio_ingreso)) AS grado_actual,
         (SELECT COUNT(*) FROM misiones_diarias m
          WHERE m.user_id = p.id AND m.fecha = $2 AND m.completada = TRUE
         ) AS misiones_completadas_hoy,
         (SELECT COUNT(*) FROM misiones_diarias m
          WHERE m.user_id = p.id AND m.fecha = $2
         ) AS misiones_total_hoy
       FROM perfiles p
       WHERE p.rol = 'alumno'
         AND (p.grado_ingreso + ($1 - p.anio_ingreso)) = ANY($3::int[])
       ORDER BY grado_actual ASC, p.nombre ASC`,
      [anio, hoy, grados]
    );
  }

  // Agrupar alumnos por grado
  const cursos = {};
  for (const a of alumnos) {
    const g = Number(a.grado_actual);
    if (!cursos[g]) {
      cursos[g] = {
        grado:         g,
        total_alumnos: 0,
        alumnos:       [],
      };
    }
    cursos[g].alumnos.push(a);
    cursos[g].total_alumnos++;
  }

  return res({
    cursos:           Object.values(cursos).sort((a, b) => a.grado - b.grado),
    total_alumnos:    alumnos.length,
    cursos_asignados: cursosAsignados,
  });
}

// ============================================
// GET: Alumnos de un grado con stats del día
// ============================================
async function getAlumnos(url) {
  const grado = url.searchParams.get('grado');
  const hoy   = new Date().toISOString().split('T')[0];
  const anio  = new Date().getFullYear();

  const params = [anio, hoy];
  let gradoFiltro = '';

  if (grado) {
    params.push(Number(grado));
    gradoFiltro = `AND (p.grado_ingreso + ($1 - p.anio_ingreso)) = $${params.length}`;
  }

  const alumnos = await query(
    `SELECT
       p.id, p.clerk_id, p.nombre, p.email, p.avatar_base,
       p.nivel, p.monedas, p.xp, p.racha_dias, p.ultimo_login,
       p.energia_actual, p.energia_max,
       (p.grado_ingreso + ($1 - p.anio_ingreso)) AS grado_actual,

       -- Misiones del día
       (SELECT COUNT(*) FROM misiones_diarias m
        WHERE m.user_id = p.id AND m.fecha = $2 AND m.completada = TRUE
       ) AS misiones_completadas_hoy,
       (SELECT COUNT(*) FROM misiones_diarias m
        WHERE m.user_id = p.id AND m.fecha = $2
       ) AS misiones_total_hoy,

       -- Tareas entregadas hoy
       (SELECT COUNT(*) FROM tareas t
        WHERE t.user_id = p.id AND t.fecha = $2
          AND (t.contenido_subido IS NOT NULL OR t.foto_url IS NOT NULL)
       ) AS tareas_entregadas_hoy,

       -- Evaluaciones próximas (7 días)
       (SELECT COUNT(*) FROM evaluaciones e
        WHERE e.user_id = p.id
          AND e.fecha_evaluacion >= CURRENT_DATE
          AND e.fecha_evaluacion <= CURRENT_DATE + INTERVAL '7 days'
          AND e.estado IN ('pendiente', 'estudiado')
       ) AS evaluaciones_proximas,

       -- Monedas ganadas hoy
       (SELECT COALESCE(SUM(monto), 0) FROM transacciones tr
        WHERE tr.user_id = p.id AND tr.tipo = 'ganancia'
          AND DATE(tr.created_at) = $2
       ) AS monedas_ganadas_hoy

     FROM perfiles p
     WHERE p.rol = 'alumno' ${gradoFiltro}
     ORDER BY grado_actual ASC, p.monedas DESC`,
    params
  );

  return res({
    alumnos,
    grado:  grado ? Number(grado) : null,
    fecha:  hoy,
  });
}

// ============================================
// GET: Detalle completo de un alumno
// ============================================
async function getAlumnoDetalle(url) {
  const clerkIdAlumno = url.searchParams.get('clerk_id');
  if (!clerkIdAlumno) return resError('Falta clerk_id del alumno');

  const alumno = await getPerfil(clerkIdAlumno);
  if (!alumno || alumno.rol !== 'alumno') return resError('Alumno no encontrado', 404);

  const hoy  = new Date().toISOString().split('T')[0];
  const mes  = new Date().getMonth() + 1;
  const anio = new Date().getFullYear();

  const [misiones, tareas, evaluaciones, transacciones, rachaStats] = await Promise.all([

    // Misiones del día
    query(
      `SELECT tipo_mision, descripcion, icono, recompensa_monedas, completada, completada_at
       FROM misiones_diarias
       WHERE user_id = $1 AND fecha = $2
       ORDER BY completada ASC, created_at ASC`,
      [alumno.id, hoy]
    ),

    // Últimas 15 tareas
    query(
      `SELECT asignatura, fecha, contenido_subido, foto_url,
              es_correcta, porcentaje_obtenido, recompensa_entregada, created_at
       FROM tareas
       WHERE user_id = $1
       ORDER BY fecha DESC, created_at DESC
       LIMIT 15`,
      [alumno.id]
    ),

    // Evaluaciones del mes
    query(
      `SELECT asignatura, fecha_evaluacion, contenidos,
              nota_esperada, rango_min, rango_max,
              nota_obtenida, estado, recompensa_entregada
       FROM evaluaciones
       WHERE user_id = $1
         AND EXTRACT(MONTH FROM fecha_evaluacion) = $2
         AND EXTRACT(YEAR  FROM fecha_evaluacion) = $3
       ORDER BY fecha_evaluacion ASC`,
      [alumno.id, mes, anio]
    ),

    // Últimas 10 transacciones
    query(
      `SELECT tipo, monto, concepto, created_at
       FROM transacciones
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [alumno.id]
    ),

    // Racha: misiones completadas los últimos 7 días
    query(
      `SELECT fecha,
              COUNT(*) FILTER (WHERE completada) AS completadas,
              COUNT(*) AS total
       FROM misiones_diarias
       WHERE user_id = $1
         AND fecha >= CURRENT_DATE - INTERVAL '6 days'
       GROUP BY fecha
       ORDER BY fecha ASC`,
      [alumno.id]
    ),
  ]);

  // Stats resumen del mes
  const tareasCorrectas   = tareas.filter(t => t.es_correcta === true).length;
  const tareasIncorrectas = tareas.filter(t => t.es_correcta === false).length;
  const evalConNota       = evaluaciones.filter(e => e.nota_obtenida != null);
  const promedioNotas     = evalConNota.length > 0
    ? (evalConNota.reduce((s, e) => s + Number(e.nota_obtenida), 0) / evalConNota.length).toFixed(1)
    : null;

  return res({
    alumno,
    misiones_hoy:            misiones,
    tareas_recientes:        tareas,
    evaluaciones_mes:        evaluaciones,
    ultimas_transacciones:   transacciones,
    racha_7_dias:            rachaStats,
    resumen: {
      misiones_completadas_hoy: misiones.filter(m => m.completada).length,
      misiones_total_hoy:       misiones.length,
      tareas_correctas:         tareasCorrectas,
      tareas_incorrectas:       tareasIncorrectas,
      promedio_notas_mes:       promedioNotas,
      racha_actual:             alumno.racha_dias,
    },
  });
}

// ============================================
// POST: Crear tarea para uno o todos los alumnos
// de un grado
// ============================================
async function crearTarea(body) {
  const { asignatura, contenido, fecha, grado, clerk_id_alumno } = body;

  if (!asignatura) return resError('Falta asignatura');
  if (!fecha)      return resError('Falta fecha (formato YYYY-MM-DD)');

  let alumnos = [];

  if (clerk_id_alumno) {
    const a = await getPerfil(clerk_id_alumno);
    if (!a || a.rol !== 'alumno') return resError('Alumno no encontrado', 404);
    alumnos = [a];
  } else if (grado) {
    const anio = new Date().getFullYear();
    alumnos = await query(
      `SELECT * FROM perfiles
       WHERE rol = 'alumno'
         AND (grado_ingreso + ($1 - anio_ingreso)) = $2
       ORDER BY nombre ASC`,
      [anio, Number(grado)]
    );
  } else {
    return resError('Debes especificar grado o clerk_id_alumno');
  }

  if (alumnos.length === 0) return resError('No se encontraron alumnos para ese grado');

  let creadas = 0;
  for (const alumno of alumnos) {
    await query(
      `INSERT INTO tareas (user_id, fecha, asignatura, contenido_subido)
       VALUES ($1, $2, $3, $4)`,
      [alumno.id, fecha, asignatura, contenido || null]
    );
    creadas++;
  }

  return res({
    ok:            true,
    tareas_creadas: creadas,
    asignatura,
    fecha,
    mensaje: `✅ Tarea de ${asignatura} creada para ${creadas} alumno${creadas !== 1 ? 's' : ''}`,
  });
}

// ============================================
// POST: Crear evaluación en el calendario
// Usa la misma lógica de rango que evaluaciones.js
// ============================================
async function crearEvaluacion(body) {
  const {
    asignatura, fecha_evaluacion, contenidos,
    nota_esperada, grado, clerk_id_alumno,
  } = body;

  if (!asignatura)       return resError('Falta asignatura');
  if (!fecha_evaluacion) return resError('Falta fecha_evaluacion (formato YYYY-MM-DD)');

  let alumnos = [];

  if (clerk_id_alumno) {
    const a = await getPerfil(clerk_id_alumno);
    if (!a || a.rol !== 'alumno') return resError('Alumno no encontrado', 404);
    alumnos = [a];
  } else if (grado) {
    const anio = new Date().getFullYear();
    alumnos = await query(
      `SELECT * FROM perfiles
       WHERE rol = 'alumno'
         AND (grado_ingreso + ($1 - anio_ingreso)) = $2
       ORDER BY nombre ASC`,
      [anio, Number(grado)]
    );
  } else {
    return resError('Debes especificar grado o clerk_id_alumno');
  }

  if (alumnos.length === 0) return resError('No se encontraron alumnos para ese grado');

  // Calcular rango ±0.5 (igual que evaluaciones.js)
  let rango_min = null;
  let rango_max = null;
  if (nota_esperada != null) {
    const nota = Number(nota_esperada);
    if (nota === 7.0) {
      rango_min = 7.0;
      rango_max = 7.0;
    } else {
      rango_min = Math.max(1.0, nota - 0.5);
      rango_max = Math.min(7.0, nota + 0.5);
    }
  }

  let creadas = 0;
  for (const alumno of alumnos) {
    await query(
      `INSERT INTO evaluaciones
         (user_id, asignatura, fecha_evaluacion, contenidos, nota_esperada, rango_min, rango_max)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        alumno.id, asignatura, fecha_evaluacion,
        contenidos   || null,
        nota_esperada != null ? Number(nota_esperada) : null,
        rango_min, rango_max,
      ]
    );
    creadas++;
  }

  return res({
    ok:                   true,
    evaluaciones_creadas: creadas,
    asignatura,
    fecha_evaluacion,
    mensaje: `📅 Evaluación de ${asignatura} agendada para ${creadas} alumno${creadas !== 1 ? 's' : ''}`,
  });
}

// ============================================
// POST: Asignar grados a un profesor (solo admin)
// Los grados se guardan en perfiles.accesorios
// como array de enteros: [6, 7]
// ============================================
async function asignarCurso(solicitante, body) {
  if (solicitante.rol !== 'admin') {
    return resError('Solo un admin puede asignar cursos a profesores', 403);
  }

  const { clerk_id_profesor, grados } = body;
  if (!clerk_id_profesor)              return resError('Falta clerk_id_profesor');
  if (!Array.isArray(grados))          return resError('grados debe ser un array, ej: [6, 7]');

  const profesor = await getPerfil(clerk_id_profesor);
  if (!profesor || profesor.rol !== 'profesor') {
    return resError('Profesor no encontrado o el perfil no tiene rol=profesor', 404);
  }

  await query(
    `UPDATE perfiles SET accesorios = $1 WHERE clerk_id = $2`,
    [grados, clerk_id_profesor]
  );

  return res({
    ok:               true,
    profesor:         profesor.nombre,
    grados_asignados: grados,
    mensaje:          `✅ Grados ${grados.join(', ')}° asignados a ${profesor.nombre}`,
  });
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  const profesor = await getProfesorPerfil(auth.clerkId);
  if (!profesor) return resError('Acceso denegado — se requiere rol profesor o admin', 403);

  const url = new URL(request.url);

  if (request.method === 'GET') {
    const action = url.searchParams.get('action');
    if (action === 'mis_cursos')     return getMisCursos(profesor);
    if (action === 'alumnos')        return getAlumnos(url);
    if (action === 'alumno_detalle') return getAlumnoDetalle(url);
    return resError('action no reconocida. Usa: mis_cursos | alumnos | alumno_detalle');
  }

  if (request.method === 'POST') {
    const body = await request.json();
    if (body.action === 'crear_tarea')      return crearTarea(body);
    if (body.action === 'crear_evaluacion') return crearEvaluacion(body);
    if (body.action === 'asignar_curso')    return asignarCurso(profesor, body);
    return resError('action no reconocida. Usa: crear_tarea | crear_evaluacion | asignar_curso');
  }

  return resError('Método no permitido', 405);
}
