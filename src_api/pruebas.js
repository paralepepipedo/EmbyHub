// ============================================
// ARCHIVO: api/pruebas.js
// VERSIÓN: 1.0.0 — 2026-03-15
// Changelog:
//   1.0.0 - Motor de repaso espaciado, registro de intentos,
//            integración con juegos_partidas y recompensas
//
// POST /api/pruebas { action:'get_prueba',      id }
//   → Devuelve la prueba activa (sin preguntas, solo metadata)
//
// POST /api/pruebas { action:'armar_prueba',    id }
//   → Motor de repaso espaciado: arma el paquete de preguntas
//     personalizado para el alumno que llama
//
// POST /api/pruebas { action:'registrar_intento', prueba_id,
//                     buenas, malas, total_preguntas,
//                     ids_erradas: ['hist_u1_005', ...] }
//   → Calcula recompensas proporcionales, guarda el intento,
//     inserta en juegos_partidas para misiones diarias
// ============================================

import {
  query, getPerfil, agregarMonedas, agregarXP,
  res, resError, verificarAuth
} from '../lib/neon.js';

// ============================================
// HELPER: Fisher-Yates shuffle
// ============================================
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================
// POST: get_prueba
// Devuelve metadata de la prueba (sin preguntas)
// El frontend la usa para mostrar la pantalla de
// "¿Listo para comenzar?" antes de armar la prueba
// ============================================
async function getPrueba(body) {
  const { id } = body;
  if (!id) return resError('Falta id de prueba');

  const rows = await query(
    `SELECT id, nombre, asignatura, grado, unidades,
            preguntas_por_intento, recompensa_monedas, recompensa_xp, activa
     FROM pruebas_activas
     WHERE id = $1`,
    [id]
  );

  if (!rows[0]) return resError('Prueba no encontrada', 404);
  if (!rows[0].activa) return resError('Esta prueba no está activa', 403);

  return res({ prueba: rows[0] });
}

// ============================================
// POST: armar_prueba
// El "cerebro" del repaso espaciado.
//
// Algoritmo:
//  1. Busca si el alumno ya intentó esta prueba antes
//  2. Si tuvo errores, extrae esos IDs del detalle_respuestas
//  3. Rescata esas preguntas específicas del banco (prioridad)
//  4. Rellena el cupo restante con preguntas aleatorias del pool
//  5. Desordena y devuelve el paquete limpio
// ============================================
async function armarPrueba(body, clerkId) {
  const { id } = body;
  if (!id) return resError('Falta id de prueba');

  // 1. Obtener la prueba activa
  const pruebaRows = await query(
    `SELECT id, asignatura, grado, unidades, preguntas_por_intento, activa
     FROM pruebas_activas WHERE id = $1`,
    [id]
  );
  if (!pruebaRows[0]) return resError('Prueba no encontrada', 404);
  if (!pruebaRows[0].activa) return resError('Esta prueba no está activa', 403);

  const prueba = pruebaRows[0];
  const cupo = Number(prueba.preguntas_por_intento);

  // 2. Obtener perfil del alumno
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  // 3. Buscar intentos anteriores para extraer preguntas erradas
  const intentoRows = await query(
    `SELECT detalle_respuestas
     FROM pruebas_intentos
     WHERE prueba_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [id, perfil.id]
  );

  // ids_erradas: array de id_pregunta que falló en el último intento
  let idsErradas = [];
  if (intentoRows[0]?.detalle_respuestas?.ids_erradas) {
    idsErradas = intentoRows[0].detalle_respuestas.ids_erradas;
  }

  // 4. Traer todas las preguntas del pool (unidades seleccionadas)
  const bancoRows = await query(
    `SELECT id, preguntas
     FROM banco_preguntas
     WHERE asignatura = $1
       AND grado = $2
       AND unidad = ANY($3::smallint[])`,
    [prueba.asignatura, prueba.grado, prueba.unidades]
  );

  // Aplanar todas las preguntas en un único array
  let poolCompleto = [];
  bancoRows.forEach(fila => {
    if (Array.isArray(fila.preguntas)) {
      poolCompleto = poolCompleto.concat(fila.preguntas);
    }
  });

  if (poolCompleto.length === 0) {
    return resError('No hay preguntas en el banco para esta prueba', 404);
  }

  // 5. Separar preguntas erradas (repaso) del resto (nuevas/aleatorias)
  const preguntasErradas = poolCompleto.filter(q =>
    idsErradas.includes(q.id_pregunta)
  );
  const preguntasNuevas = poolCompleto.filter(q =>
    !idsErradas.includes(q.id_pregunta)
  );

  // 6. Armar el paquete final:
  //    - Primero las erradas (hasta llenar el cupo)
  //    - Rellenar el resto con nuevas aleatorias
  const erradasShuffled = shuffle(preguntasErradas);
  const nuevasShuffled = shuffle(preguntasNuevas);

  let paquete = [];

  // Tomar erradas (máximo hasta cupo)
  const erradasATomar = erradasShuffled.slice(0, cupo);
  paquete = paquete.concat(erradasATomar);

  // Rellenar con nuevas hasta completar el cupo
  const espacioRestante = cupo - paquete.length;
  const nuevasATomar = nuevasShuffled.slice(0, espacioRestante);
  paquete = paquete.concat(nuevasATomar);

  // 7. Shuffle final para que las erradas no aparezcan siempre primero
  paquete = shuffle(paquete);

  // Limpiar las respuestas correctas antes de enviar al frontend
  // (el frontend NUNCA debe recibir la respuesta correcta de antemano)
  const paqueteLimpio = paquete.map(q => {
    const { correcta, pares, ...resto } = q;
    return resto; // Solo enviamos el enunciado y las opciones, sin respuesta
  });

  return res({
    prueba_id: prueba.id,
    asignatura: prueba.asignatura,
    total_preguntas: paquete.length,
    preguntas_repaso: erradasATomar.length, // Info para el frontend (puede mostrar "X preguntas de repaso")
    preguntas: paqueteLimpio,              // Sin respuestas correctas
    // Las respuestas correctas van en un mapa separado, indexado por id_pregunta
    // El frontend las recibe encriptadas o el backend valida en registrar_intento
    _mapa_respuestas: Object.fromEntries(
      paquete.map(q => [
        q.id_pregunta,
        q.tipo === 'unir_conceptos'
          ? q.pares                          // Para unir_conceptos devolvemos los pares correctos
          : q.correcta                       // Para multiple y V/F devolvemos el string correcto
      ])
    )
  });
}

// ============================================
// POST: registrar_intento
// Recibe el resultado del alumno, valida respuestas,
// calcula recompensas proporcionales y guarda todo.
//
// Body esperado:
// {
//   prueba_id: uuid,
//   respuestas: {
//     "hist_u1_001": "El maíz",
//     "hist_u1_002": "Verdadero",
//     "hist_u1_003": [{ izq: "Chaac", der: "Dios de la lluvia" }, ...]
//   }
// }
// ============================================
async function registrarIntento(body, clerkId) {
  const { prueba_id, respuestas } = body;
  if (!prueba_id || !respuestas) return resError('Faltan datos del intento');

  // 1. Obtener la prueba
  const pruebaRows = await query(
    `SELECT id, asignatura, grado, unidades, preguntas_por_intento,
            recompensa_monedas, recompensa_xp
     FROM pruebas_activas WHERE id = $1 AND activa = TRUE`,
    [prueba_id]
  );
  if (!pruebaRows[0]) return resError('Prueba no encontrada o inactiva', 404);
  const prueba = pruebaRows[0];

  // 2. Obtener perfil del alumno
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  // 3. Traer las preguntas del banco para validar respuestas en el servidor
  const bancoRows = await query(
    `SELECT preguntas
     FROM banco_preguntas
     WHERE asignatura = $1
       AND grado = $2
       AND unidad = ANY($3::smallint[])`,
    [prueba.asignatura, prueba.grado, prueba.unidades]
  );

  // Construir mapa id_pregunta → pregunta completa
  let mapaPreguntas = {};
  bancoRows.forEach(fila => {
    if (Array.isArray(fila.preguntas)) {
      fila.preguntas.forEach(q => {
        mapaPreguntas[q.id_pregunta] = q;
      });
    }
  });

  // 4. Validar cada respuesta del alumno
  let buenas = 0;
  let malas = 0;
  let idsErradas = [];
  const idsRespondidas = Object.keys(respuestas);
  const totalPreguntas = idsRespondidas.length;

  idsRespondidas.forEach(idPregunta => {
    const pregunta = mapaPreguntas[idPregunta];
    if (!pregunta) return; // Pregunta no encontrada en banco, ignorar

    const respuestaAlumno = respuestas[idPregunta];
    let esCorrecta = false;

    if (pregunta.tipo === 'seleccion_multiple' || pregunta.tipo === 'verdadero_falso') {
      esCorrecta = String(respuestaAlumno).trim() === String(pregunta.correcta).trim();

    } else if (pregunta.tipo === 'unir_conceptos') {
      // Para unir_conceptos, el alumno envía un array de pares { izq, der }
      // Validamos que cada par coincida con los pares correctos (sin importar el orden)
      if (Array.isArray(respuestaAlumno) && Array.isArray(pregunta.pares)) {
        const paresCorrectos = pregunta.pares.map(p =>
          `${p.izq.trim().toLowerCase()}|||${p.der.trim().toLowerCase()}`
        );
        const paresAlumno = respuestaAlumno.map(p =>
          `${String(p.izq).trim().toLowerCase()}|||${String(p.der).trim().toLowerCase()}`
        );
        // Todos los pares deben coincidir
        esCorrecta = paresCorrectos.length === paresAlumno.length &&
          paresCorrectos.every(par => paresAlumno.includes(par));
      }
    }

    if (esCorrecta) {
      buenas++;
    } else {
      malas++;
      idsErradas.push(idPregunta);
    }
  });

  // 5. Calcular recompensas proporcionales
  // Si saca 100% → recompensa completa. Si saca 60% → 60% de la recompensa.
  const precision = totalPreguntas > 0 ? buenas / totalPreguntas : 0;
  const monedasGanadas = Math.round(Number(prueba.recompensa_monedas) * precision);
  const xpGanado = Math.round(Number(prueba.recompensa_xp) * precision);

  // 6. Guardar el intento en pruebas_intentos
  await query(
    `INSERT INTO pruebas_intentos
       (prueba_id, user_id, buenas, malas, total_preguntas,
        monedas_ganadas, xp_ganado, detalle_respuestas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      prueba_id,
      perfil.id,
      buenas,
      malas,
      totalPreguntas,
      monedasGanadas,
      xpGanado,
      JSON.stringify({
        ids_erradas: idsErradas,           // Para el repaso espaciado del próximo intento
        respuestas_alumno: respuestas,     // Historial completo
        precision: Math.round(precision * 100)
      })
    ]
  );

  // 7. Insertar en juegos_partidas para que cuente en misiones diarias
  //    ("Juega 3 veces hoy", "Completa 5 juegos esta semana", etc.)
  await query(
    `INSERT INTO juegos_partidas
       (user_id, juego_id, puntos, monedas_ganadas, xp_ganado, completado)
     VALUES ($1, 'prueba_ia', $2, $3, $4, $5)`,
    [
      perfil.id,
      buenas,                            // puntos = cantidad de buenas
      monedasGanadas,
      xpGanado,
      precision >= 0.6                   // completado = TRUE si sacó al menos 60%
    ]
  );

  // 8. Pagar recompensas al alumno (solo si ganó algo)
  if (monedasGanadas > 0) {
    await agregarMonedas(
      perfil.id,
      monedasGanadas,
      `Prueba IA: ${prueba.asignatura} — ${Math.round(precision * 100)}% correcto`
    );
  }
  if (xpGanado > 0) {
    await agregarXP(
      perfil.id,
      xpGanado,
      `Prueba IA: ${prueba.asignatura}`,
      'prueba_ia'
    );
  }

  // 9. Devolver el resumen completo al frontend (Fase 4 pantalla final)
  return res({
    ok: true,
    resultado: {
      buenas,
      malas,
      total_preguntas: totalPreguntas,
      precision_pct: Math.round(precision * 100),
      monedas_ganadas: monedasGanadas,
      xp_ganado: xpGanado,
      ids_erradas: idsErradas,           // Para mostrar "fallaste X preguntas"
      tiene_repaso: idsErradas.length > 0
    }
  });
}

// ============================================
// POST: get_mis_intentos
// Devuelve todos los intentos del alumno
// agrupados por prueba, con nota calculada.
// Usado por estadisticas.html
// ============================================
async function getMisIntentos(clerkId) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const rows = await query(
    `SELECT
       pi.id,
       pi.prueba_id,
       pi.buenas,
       pi.malas,
       pi.total_preguntas,
       pi.monedas_ganadas,
       pi.created_at,
       pa.nombre,
       pa.asignatura,
       pa.grado,
       pa.unidades
     FROM pruebas_intentos pi
     JOIN pruebas_activas pa ON pa.id = pi.prueba_id
     WHERE pi.user_id = $1
     ORDER BY pa.asignatura ASC, pa.nombre ASC, pi.created_at ASC`,
    [perfil.id]
  );

  function calcularNotaChilena(pct) {
    const exigencia = 60;
    if (pct >= exigencia) return Math.round((4.0 + ((pct - exigencia) / (100 - exigencia)) * 3.0) * 10) / 10;
    return Math.round((1.0 + (pct / exigencia) * 3.0) * 10) / 10;
  }

  const grupos = {};
  rows.forEach(r => {
    if (!grupos[r.prueba_id]) {
      grupos[r.prueba_id] = {
        prueba_id: r.prueba_id,
        nombre: r.nombre,
        asignatura: r.asignatura,
        grado: r.grado,
        unidades: r.unidades,
        intentos: []
      };
    }
    const precision = r.total_preguntas > 0 ? Math.round((r.buenas / r.total_preguntas) * 100) : 0;
    grupos[r.prueba_id].intentos.push({
      fecha: r.created_at,
      buenas: r.buenas,
      malas: r.malas,
      total_preguntas: r.total_preguntas,
      precision_pct: precision,
      nota: calcularNotaChilena(precision),
      monedas_ganadas: r.monedas_ganadas
    });
  });

  const resultado = Object.values(grupos).map(g => {
    g.intentos = g.intentos.map((i, idx) => ({ ...i, numero: idx + 1 }));
    return g;
  });

  return res({ grupos: resultado });
}

// ============================================
// POST: get_pruebas_forzadas
// ============================================
async function getPruebasForzadas(clerkId) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const anioActual = new Date().getFullYear();
  const gradoActual = perfil.grado_ingreso + (anioActual - perfil.anio_ingreso);

  const pruebas = await query(
    `SELECT id, nombre, asignatura, grado, unidades,
            preguntas_por_intento, recompensa_monedas, recompensa_xp
     FROM pruebas_activas
     WHERE activa = true AND forzada = true AND grado = $1
     ORDER BY created_at DESC`,
    [gradoActual]
  );

  if (pruebas.length === 0) return res({ pruebas: [] });

  const pruebasIds = pruebas.map(p => p.id);
  const intentos = await query(
    `SELECT prueba_id, buenas, total_preguntas, created_at
     FROM pruebas_intentos
     WHERE user_id = $1 AND prueba_id = ANY($2::uuid[])
     ORDER BY prueba_id, created_at DESC`,
    [perfil.id, pruebasIds]
  );

  const intentosPorPrueba = {};
  intentos.forEach(i => {
    if (!intentosPorPrueba[i.prueba_id]) intentosPorPrueba[i.prueba_id] = [];
    intentosPorPrueba[i.prueba_id].push(i);
  });

  function calcularNotaChilena(pct) {
    const exigencia = 60;
    if (pct >= exigencia) return Math.round((4.0 + ((pct - exigencia) / (100 - exigencia)) * 3.0) * 10) / 10;
    return Math.round((1.0 + (pct / exigencia) * 3.0) * 10) / 10;
  }

  const pruebasEnriquecidas = pruebas.map(p => {
    const historial = intentosPorPrueba[p.id] || [];
    const totalIntentos = historial.length;
    const ultimo = historial[0] || null;
    let ultimaPrecision = null, ultimaNota = null;
    if (ultimo) {
      ultimaPrecision = ultimo.total_preguntas > 0 ? Math.round((ultimo.buenas / ultimo.total_preguntas) * 100) : 0;
      ultimaNota = calcularNotaChilena(ultimaPrecision);
    }
    let efectividadPct = null;
    if (totalIntentos > 0) {
      const suma = historial.reduce((acc, i) => acc + (i.total_preguntas > 0 ? i.buenas / i.total_preguntas : 0), 0);
      efectividadPct = Math.round((suma / totalIntentos) * 100);
    }
    return {
      id: p.id, nombre: p.nombre, asignatura: p.asignatura, grado: p.grado,
      recompensa_monedas: p.recompensa_monedas, recompensa_xp: p.recompensa_xp,
      ultima_nota: ultimaNota, ultima_precision_pct: ultimaPrecision,
      total_intentos: totalIntentos, efectividad_pct: efectividadPct,
      necesita_atencion: totalIntentos >= 3 && efectividadPct !== null && efectividadPct < 50
    };
  });

  return res({ pruebas: pruebasEnriquecidas });
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  if (request.method !== 'POST') return resError('Método no permitido', 405);

  const body = await request.json();

  if (body.action === 'get_prueba') return getPrueba(body);
  if (body.action === 'armar_prueba') return armarPrueba(body, auth.clerkId);
  if (body.action === 'registrar_intento') return registrarIntento(body, auth.clerkId);
  if (body.action === 'get_pruebas_forzadas') return getPruebasForzadas(auth.clerkId);
  if (body.action === 'get_mis_intentos') return getMisIntentos(auth.clerkId);

  return resError('action no reconocida');
}