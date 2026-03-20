// ============================================
// api/misiones.js — Misiones diarias
// GET /api/misiones → obtener misiones de hoy
// POST /api/misiones { action:'completar', mision_id }
// POST /api/misiones { action:'verificar_trigger', trigger, juego_id?, puntos?, duracion_seg?, asignatura? }
// → llamado automáticamente por Api/juegos.js, Api/tareas.js, Api/evaluaciones.js, Api/duelos.js
// ============================================

import {
  query, getPerfil, agregarMonedas, agregarXP, actualizarRacha,
  res, resError, verificarAuth, getConfigEconomia
} from '../lib/neon.js';

// ============================================
// FALLBACK — si la BD no tiene misiones aún
// ============================================
const BANCO_MISIONES_FALLBACK = [
  { tipo: 'jugar_1_juego', descripcion: 'Jugar 1 juego educativo hoy', icono: '🎮', recompensa_base: 50, recompensa_xp: 25, peso_sorteo: 8, url_destino: '../juegos/juegos.html', condicion_tipo: 'auto', accion_trigger: 'juego_completado', juego_id: null, meta_cantidad: 1 },
  { tipo: 'subir_tarea', descripcion: 'Subir una tarea hoy', icono: '📝', recompensa_base: 100, recompensa_xp: 50, peso_sorteo: 8, url_destino: '../tareas/tareas.html', condicion_tipo: 'auto', accion_trigger: 'tarea_subida', juego_id: null, meta_cantidad: 1 },
  { tipo: 'trivia_completar', descripcion: 'Completar una partida de Trivia', icono: '❓', recompensa_base: 60, recompensa_xp: 30, peso_sorteo: 7, url_destino: '../juegos/trivia/trivia.html', condicion_tipo: 'auto', accion_trigger: 'juego_especifico', juego_id: 'trivia', meta_cantidad: 1 },
  { tipo: 'memoria_completar', descripcion: 'Completar el juego de Memoria', icono: '🃏', recompensa_base: 70, recompensa_xp: 35, peso_sorteo: 6, url_destino: '../juegos/memoria/memoria.html', condicion_tipo: 'auto', accion_trigger: 'juego_especifico', juego_id: 'memoria', meta_cantidad: 1 },
  { tipo: 'tablablast_jugar', descripcion: 'Practicar tablas en Tabla Blast', icono: '🔢', recompensa_base: 60, recompensa_xp: 30, peso_sorteo: 7, url_destino: '../juegos/tablablast/tablablast.html', condicion_tipo: 'auto', accion_trigger: 'juego_especifico', juego_id: 'TablaBlast', meta_cantidad: 1 },
  { tipo: 'marcar_estudiado', descripcion: 'Marcar una evaluación como estudiada', icono: '📅', recompensa_base: 40, recompensa_xp: 20, peso_sorteo: 7, url_destino: '../calendario/calendario.html', condicion_tipo: 'auto', accion_trigger: 'evaluacion_marcada', juego_id: null, meta_cantidad: 1 },
  { tipo: 'ganar_duelo', descripcion: 'Ganar un duelo contra otro alumno', icono: '⚔️', recompensa_base: 120, recompensa_xp: 60, peso_sorteo: 5, url_destino: '../duelos/duelos.html', condicion_tipo: 'auto', accion_trigger: 'duelo_ganado', juego_id: null, meta_cantidad: 1 },
  { tipo: 'coinclik_jugar', descripcion: 'Jugar una partida de CoinClik', icono: '💰', recompensa_base: 60, recompensa_xp: 30, peso_sorteo: 7, url_destino: '../juegos/coinclik/coinclik.html', condicion_tipo: 'auto', accion_trigger: 'juego_especifico', juego_id: 'coinclik', meta_cantidad: 1 },
  { tipo: 'horserace_jugar', descripcion: 'Jugar una carrera en Horse Race', icono: '🏇', recompensa_base: 60, recompensa_xp: 30, peso_sorteo: 6, url_destino: '../juegos/horserace/horserace.html', condicion_tipo: 'auto', accion_trigger: 'juego_especifico', juego_id: 'HorseRace', meta_cantidad: 1 },
  { tipo: 'problemas_jugar', descripcion: 'Resolver problemas matemáticos', icono: '🧮', recompensa_base: 70, recompensa_xp: 35, peso_sorteo: 7, url_destino: '../juegos/problemas/problemas.html', condicion_tipo: 'auto', accion_trigger: 'juego_especifico', juego_id: 'problemas', meta_cantidad: 1 },
  { tipo: 'subir_nota', descripcion: 'Registrar la nota de una prueba', icono: '⭐', recompensa_base: 70, recompensa_xp: 35, peso_sorteo: 6, url_destino: '../calendario/calendario.html', condicion_tipo: 'auto', accion_trigger: 'nota_ingresada', juego_id: null, meta_cantidad: 1 },
  { tipo: 'jugar_3_juegos', descripcion: 'Jugar 3 juegos diferentes hoy', icono: '🎮', recompensa_base: 120, recompensa_xp: 60, peso_sorteo: 4, url_destino: '../juegos/juegos.html', condicion_tipo: 'repetir', accion_trigger: 'juego_completado', juego_id: null, meta_cantidad: 3 },
  { tipo: 'sinonimos_completar', descripcion: 'Completar el juego de sinónimos', icono: '🔤', recompensa_base: 60, recompensa_xp: 30, peso_sorteo: 6, url_destino: '../juegos/sinonimos/sinonimos.html', condicion_tipo: 'auto', accion_trigger: 'juego_especifico', juego_id: 'sinonimos', meta_cantidad: 1 },
  { tipo: 'mapaquiz_jugar', descripcion: 'Jugar una partida de Mapa Quiz', icono: '🗺️', recompensa_base: 60, recompensa_xp: 30, peso_sorteo: 6, url_destino: '../juegos/mapaquiz/mapaquiz.html', condicion_tipo: 'auto', accion_trigger: 'juego_especifico', juego_id: 'mapaquiz', meta_cantidad: 1 },
  { tipo: 'coinclik_500', descripcion: 'Alcanzar 500 puntos en CoinClik', icono: '💰', recompensa_base: 90, recompensa_xp: 45, peso_sorteo: 5, url_destino: '../juegos/coinclik/coinclik.html', condicion_tipo: 'puntos', accion_trigger: 'juego_especifico', juego_id: 'coinclik', requiere_puntos: 500, meta_cantidad: 1 },
];

// ── Helper: array JS → formato {1,2,3} de PostgreSQL ──────
function toPostgresArray(arr) {
  const a = Array.isArray(arr) ? arr : [];
  return '{' + a.filter(x => x !== '' && x !== null && x !== undefined).join(',') + '}';
}

let _bancoCache = null;
let _bancoCacheAt = 0;

async function getBancoMisiones() {
  const CACHE_MS = 10 * 60 * 1000;
  if (_bancoCache && Date.now() - _bancoCacheAt < CACHE_MS) return _bancoCache;
  const rows = await query(
    `SELECT tipo, descripcion, icono, recompensa_base, recompensa_xp,
     categoria, dificultad, url_destino, requiere_puntos, nivel_minimo,
     peso_sorteo, forzada, limite_semanal, es_semanal, meta_progreso,
     grados_aptos, evento_activo, evento_multiplicador, evento_fin,
     condicion_tipo, juego_id, accion_trigger, meta_cantidad,
     meta_tiempo_seg, parametro_valor, mensaje_logro, oculta,
     tabla_fuente, campo_filtro
     FROM misiones_banco WHERE activo = TRUE`
  );
  _bancoCache = rows.length > 0 ? rows : BANCO_MISIONES_FALLBACK;
  _bancoCacheAt = Date.now();
  return _bancoCache;
}

// Invalida el caché cuando se edita el banco desde el admin
export function invalidarCacheBanco() {
  _bancoCache = null;
  _bancoCacheAt = 0;
}

// Evento global activo
async function getEventoGlobal() {
  try {
    const rows = await query(
      `SELECT multiplicador, alcance, fin
       FROM eventos_activos
       WHERE activo = TRUE AND fin > NOW()
       ORDER BY created_at DESC LIMIT 1`
    );
    return rows[0] || null;
  } catch (_) { return null; }
}


// ── Inferir tabla_fuente desde accion_trigger si no está en BD ──────────────
function inferirTablaFuente(accionTrigger) {
  if (!accionTrigger) return null;
  if (accionTrigger === 'juego_completado' || accionTrigger === 'juego_especifico') return 'juegos_partidas';
  if (accionTrigger === 'tarea_subida') return 'tareas';
  if (accionTrigger === 'duelo_ganado') return 'duelos';
  if (accionTrigger === 'nota_ingresada' || accionTrigger === 'evaluacion_marcada') return 'evaluaciones';
  return null;
}
// ============================================
// HELPER — Inicio de semana Chile (domingo 20:00)
// ============================================
function getInicioSemanaChile() {
  const ahora = new Date();
  const offsetChile = 3 * 60 * 60 * 1000;
  const ahoraChile = new Date(ahora.getTime() - offsetChile);
  const diaSemana = ahoraChile.getUTCDay();
  const horaChile = ahoraChile.getUTCHours();
  let diasDesdeReset = (diaSemana === 0 && horaChile < 20) ? 7 : diaSemana;
  const inicioChile = new Date(ahoraChile);
  inicioChile.setUTCDate(ahoraChile.getUTCDate() - diasDesdeReset);
  inicioChile.setUTCHours(20, 0, 0, 0);
  const inicioUTC = new Date(inicioChile.getTime() + offsetChile);
  const semanaKey = inicioUTC.toISOString().split('T')[0]; // solo 'YYYY-MM-DD'
  const semanaISO = inicioUTC.toISOString();
  const finISO = new Date(inicioUTC.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  return { semanaKey, semanaISO, finISO };
}

// ============================================
// GET — Obtener misiones del día
// ============================================
async function getMisiones(clerkId) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const hoy = new Date().toISOString().split('T')[0];

  // ── Semana actual (lunes → domingo) ──────────────────────
  const { semanaKey: lunesStr, semanaISO: inicioSemISO, finISO: finSemISO } = getInicioSemanaChile();

  // ── Misiones diarias ──────────────────────────────────────
  let misiones = await query(
    `SELECT md.*,
     COALESCE(mb.condicion_tipo, 'auto') AS condicion_tipo,
     COALESCE(mb.meta_cantidad, 1) AS meta_cantidad,
     COALESCE(mb.accion_trigger, 'juego_completado') AS accion_trigger,
     mb.url_destino AS banco_url_destino,
     mb.juego_id AS juego_id,
     mb.requiere_puntos AS requiere_puntos,
     mb.tabla_fuente AS tabla_fuente,
     mb.campo_filtro AS campo_filtro
     FROM misiones_diarias md
     LEFT JOIN misiones_banco mb ON mb.tipo = md.tipo_mision
     WHERE md.user_id = $1 AND md.fecha = $2
     ORDER BY md.created_at ASC`,
    [perfil.id, hoy]
  );
  if (misiones.length === 0) {
    misiones = await generarMisiones(perfil.id, hoy, perfil);
    misiones = await query(
      `SELECT md.*, mb.condicion_tipo, mb.meta_cantidad, mb.accion_trigger,
       mb.tabla_fuente, mb.campo_filtro, mb.juego_id, mb.requiere_puntos,
       mb.url_destino AS banco_url_destino
       FROM misiones_diarias md
       LEFT JOIN misiones_banco mb ON mb.tipo = md.tipo_mision
       WHERE md.user_id = $1 AND md.fecha = $2
       ORDER BY md.created_at ASC`,
      [perfil.id, hoy]
    );
  }

  // ── Misiones semanales ────────────────────────────────────
  let semanales = await query(
    `SELECT ms.*, mb.condicion_tipo, mb.meta_cantidad, mb.accion_trigger,
     mb.juego_id, mb.tabla_fuente, mb.campo_filtro, mb.requiere_puntos
     FROM misiones_semanales ms
     LEFT JOIN misiones_banco mb ON mb.tipo = ms.tipo_mision
     WHERE ms.user_id = $1 AND ms.semana = $2
     ORDER BY ms.created_at ASC`,
    [perfil.id, lunesStr]
  );
  if (semanales.length === 0) {
    semanales = await generarSemanales(perfil.id, lunesStr, perfil);
    semanales = await query(
      `SELECT ms.*, mb.condicion_tipo, mb.meta_cantidad, mb.accion_trigger,
       mb.juego_id, mb.tabla_fuente, mb.campo_filtro, mb.requiere_puntos
       FROM misiones_semanales ms
       LEFT JOIN misiones_banco mb ON mb.tipo = ms.tipo_mision
       WHERE ms.user_id = $1 AND ms.semana = $2
       ORDER BY ms.created_at ASC`,
      [perfil.id, lunesStr]
    );
  }

  // ── Verificación retroactiva DIARIAS ─────────────────────
  const pendientes = misiones.filter(m => !m.completada && m.tabla_fuente);

  if (pendientes.length > 0) {
    const hoyDate = new Date(hoy);
    const inicioDia = new Date(hoyDate.getTime() + 3 * 60 * 60 * 1000);
    const finDia = new Date(inicioDia.getTime() + 24 * 60 * 60 * 1000);
    const inicioISO = inicioDia.toISOString();
    const finISO = finDia.toISOString();

    const cacheDiarias = {};

    async function contarRegistros(tabla, mision) {
      const cacheKey = `${tabla}_${mision.juego_id || ''}_${mision.campo_filtro || ''}`;
      if (cacheDiarias[cacheKey] !== undefined) return cacheDiarias[cacheKey];
      let count = 0;

      if (tabla === 'juegos_partidas') {
        let q = `SELECT COUNT(*) AS n FROM juegos_partidas
                 WHERE user_id = $1 AND completado = TRUE
                 AND created_at >= $2 AND created_at < $3`;
        const params = [perfil.id, inicioISO, finISO];
        if (mision.juego_id) { q += ` AND LOWER(juego_id) = LOWER($4)`; params.push(mision.juego_id); }
        if (mision.requiere_puntos) { q += ` AND puntos >= $${params.length + 1}`; params.push(Number(mision.requiere_puntos)); }
        const r = await query(q, params);
        count = Number(r[0]?.n || 0);

      } else if (tabla === 'tareas') {
        let q = `SELECT COUNT(*) AS n FROM tareas WHERE user_id = $1 AND fecha = $2`;
        const params = [perfil.id, hoy];
        if (mision.campo_filtro) { q += ` AND asignatura = $3`; params.push(mision.campo_filtro); }
        const r = await query(q, params);
        count = Number(r[0]?.n || 0);

      } else if (tabla === 'evaluaciones') {
        let q = `SELECT COUNT(*) AS n FROM evaluaciones WHERE user_id = $1 AND DATE(updated_at) = $2`;
        const params = [perfil.id, hoy];
        if (mision.campo_filtro) { q += ` AND estado = $3`; params.push(mision.campo_filtro); }
        const r = await query(q, params);
        count = Number(r[0]?.n || 0);

      } else if (tabla === 'duelos') {
        const r = await query(
          `SELECT COUNT(*) AS n FROM duelos
           WHERE ganador_id = $1 AND estado = 'finalizado' AND DATE(finalizado_at) = $2`,
          [perfil.id, hoy]
        );
        count = Number(r[0]?.n || 0);
      }

      cacheDiarias[cacheKey] = count;
      return count;
    }

    await Promise.all(pendientes.map(async function (mision) {
      const tabla = mision.tabla_fuente || inferirTablaFuente(mision.accion_trigger);
      const meta = Number(mision.meta_cantidad || 1);
      const progreso = await contarRegistros(tabla, mision);
      if (progreso === 0) return;

      await query(`UPDATE misiones_diarias SET progreso = $1 WHERE id = $2`, [Math.min(progreso, meta), mision.id]);
      mision.progreso = Math.min(progreso, meta);

      if (progreso >= meta) {
        await query(`UPDATE misiones_diarias SET completada = TRUE, completada_at = NOW() WHERE id = $1`, [mision.id]);
        await agregarMonedas(perfil.id, Number(mision.recompensa_monedas), `Misión: ${mision.descripcion}`, mision.id);
        await agregarXP(perfil.id, Number(mision.recompensa_xp || 0));
        await actualizarRacha(perfil.id);
        mision.completada = true;
      }
    }));
  }

  // ── Verificación retroactiva SEMANALES ───────────────────
  const semPendientesRetro = semanales.filter(m => !m.completada && (m.tabla_fuente || inferirTablaFuente(m.accion_trigger)));

  if (semPendientesRetro.length > 0) {
    const inicioSemana = new Date(lunesStr + 'T03:00:00.000Z');
    const finSemana = new Date(inicioSemana.getTime() + 7 * 24 * 60 * 60 * 1000);
    const inicioSemISO = inicioSemana.toISOString();
    const finSemISO = finSemana.toISOString();
    const finSemFecha = finSemana.toISOString().split('T')[0];

    await Promise.all(semPendientesRetro.map(async function (mision) {
      const tabla = mision.tabla_fuente || inferirTablaFuente(mision.accion_trigger);
      const meta = Number(mision.meta_cantidad || 1);
      let progreso = 0;

      if (tabla === 'juegos_partidas') {
        let q = `SELECT COUNT(*) AS n FROM juegos_partidas
                 WHERE user_id = $1 AND completado = TRUE
                 AND created_at >= $2 AND created_at < $3`;
        const params = [perfil.id, inicioSemISO, finSemISO];
        if (mision.juego_id) { q += ` AND LOWER(juego_id) = LOWER($4)`; params.push(mision.juego_id); }
        if (mision.requiere_puntos) { q += ` AND puntos >= $${params.length + 1}`; params.push(Number(mision.requiere_puntos)); }
        const r = await query(q, params);
        progreso = Number(r[0]?.n || 0);

      } else if (tabla === 'tareas') {
        let q = `SELECT COUNT(*) AS n FROM tareas
                 WHERE user_id = $1 AND fecha >= $2 AND fecha <= $3`;
        const params = [perfil.id, lunesStr, finSemISO.split('T')[0]];
        if (mision.campo_filtro) { q += ` AND asignatura = $4`; params.push(mision.campo_filtro); }
        const r = await query(q, params);
        progreso = Number(r[0]?.n || 0);

      } else if (tabla === 'evaluaciones') {
        let q = `SELECT COUNT(*) AS n FROM evaluaciones
                 WHERE user_id = $1 AND DATE(updated_at) >= $2 AND DATE(updated_at) <= $3`;
        const params = [perfil.id, lunesStr, finSemISO.split('T')[0]];
        if (mision.campo_filtro) { q += ` AND estado = $4`; params.push(mision.campo_filtro); }
        const r = await query(q, params);
        progreso = Number(r[0]?.n || 0);

      } else if (tabla === 'duelos') {
        const r = await query(
          `SELECT COUNT(*) AS n FROM duelos
           WHERE ganador_id = $1 AND estado = 'finalizado'
           AND finalizado_at >= $2 AND finalizado_at < $3`,
          [perfil.id, inicioSemISO, finSemISO]
        );
        progreso = Number(r[0]?.n || 0);
      }

      if (progreso === 0) return;

      await query(`UPDATE misiones_semanales SET progreso = $1 WHERE id = $2`, [Math.min(progreso, meta), mision.id]);
      mision.progreso = Math.min(progreso, meta);

      if (progreso >= meta) {
        const resultado = await entregarRecompensaMisionSemanal(mision, perfil);
        const data = await resultado.json();
        if (data.ok) mision.completada = true;
      }
    }));
  }

  const completadas = misiones.filter(m => m.completada).length;
  const totalMonedas = misiones.filter(m => m.completada).reduce((s, m) => s + Number(m.recompensa_monedas), 0);
  const totalXP = misiones.filter(m => m.completada).reduce((s, m) => s + Number(m.recompensa_xp || 0), 0);
  const evento = await getEventoGlobal();

  return res({
    misiones,
    semanales,
    completadas,
    total: misiones.length,
    todas_completadas: completadas === misiones.length,
    total_monedas: totalMonedas,
    total_xp: totalXP,
    fecha: hoy,
    semana: lunesStr,
    xp_actual: perfil.xp,
    nivel_actual: perfil.nivel,
    xp_siguiente_nivel: perfil.nivel * 1000,
    evento_activo: !!evento,
    evento_multiplicador: evento ? Number(evento.multiplicador) : 1,
    evento_nombre: evento ? evento.nombre : null,
  });
}

// ============================================
// POST — Completar misión manualmente
// ============================================
async function completarMision(clerkId, body) {
  const { mision_id } = body;
  if (!mision_id) return resError('Falta mision_id');

  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const rows = await query(
    `SELECT * FROM misiones_diarias WHERE id = $1 AND user_id = $2`,
    [mision_id, perfil.id]
  );
  const mision = rows[0];
  if (!mision) return resError('Misión no encontrada', 404);
  if (mision.completada) return resError('Misión ya completada', 409);

  return await entregarRecompensaMision(mision, perfil);
}

// ============================================
// POST — Verificar trigger automático
// ============================================
async function verificarTrigger(clerkId, body) {
  const { trigger, juego_id, puntos, duracion_seg, asignatura } = body;
  if (!trigger) return resError('Falta trigger');

  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const hoy = new Date().toISOString().split('T')[0];

  const misiones = await query(
    `SELECT * FROM misiones_diarias
   WHERE user_id = $1 AND fecha = $2 AND completada = FALSE`,
    [perfil.id, hoy]
  );

  //if (misiones.length === 0) return res({ completadas: [] });

  const tipos = misiones.map(m => m.tipo_mision);
  const bancoRows = await query(
    `SELECT tipo, condicion_tipo, accion_trigger, juego_id,
     meta_cantidad, meta_tiempo_seg, parametro_valor,
     requiere_puntos, mensaje_logro
     FROM misiones_banco
     WHERE tipo = ANY($1::text[])`,
    [tipos]
  );
  const bancoMap = Object.fromEntries(bancoRows.map(r => [r.tipo, r]));

  const completadas = [];

  for (const mision of misiones) {
    const banco = bancoMap[mision.tipo_mision];
    if (!banco) continue;

    const cumple = await evaluarCondicion(banco, trigger, {
      juego_id, puntos, duracion_seg, asignatura, perfil, hoy
    });

    if (cumple) {
      const resultado = await entregarRecompensaMision(mision, perfil);
      const data = await resultado.json();
      if (data.ok) {
        completadas.push({
          descripcion: mision.descripcion,
          monedas: data.recompensa,
          xp: data.xp_ganado,
          subio_nivel: data.subio_nivel,
          nuevo_nivel: data.nuevo_nivel,
          mensaje: banco.mensaje_logro || null,
        });
        if (data.subio_nivel) perfil.nivel = data.nuevo_nivel;
      }
    }
  }

  // ── Actualizar progreso en misiones semanales ────────────
  const { semanaKey: lunesStr2 } = getInicioSemanaChile();

  const semPendientes = await query(
    `SELECT ms.*, mb.condicion_tipo, mb.accion_trigger, mb.juego_id,
     mb.meta_cantidad, mb.meta_tiempo_seg, mb.parametro_valor,
     mb.requiere_puntos, mb.mensaje_logro
     FROM misiones_semanales ms
     LEFT JOIN misiones_banco mb ON mb.tipo = ms.tipo_mision
     WHERE ms.user_id = $1 AND ms.semana = $2 AND ms.completada = FALSE`,
    [perfil.id, lunesStr2]
  );

  for (const mision of semPendientes) {
    if (!mision.condicion_tipo) continue;
    const banco2 = {
      tipo: mision.tipo_mision,
      condicion_tipo: mision.condicion_tipo,
      accion_trigger: mision.accion_trigger,
      juego_id: mision.juego_id,
      meta_cantidad: mision.meta_cantidad,
      meta_tiempo_seg: mision.meta_tiempo_seg,
      parametro_valor: mision.parametro_valor,
      requiere_puntos: mision.requiere_puntos,
      mensaje_logro: mision.mensaje_logro,
    };

    if (banco2.condicion_tipo === 'repetir' || banco2.condicion_tipo === 'auto') {
      const triggerOk =
        banco2.accion_trigger === trigger ||
        (banco2.accion_trigger === 'juego_especifico' && trigger === 'juego_completado');
      if (!triggerOk) continue;
      if (banco2.accion_trigger === 'juego_especifico' && banco2.juego_id) {
        if (!juego_id || banco2.juego_id.toLowerCase() !== juego_id.toLowerCase()) continue;
      }
      if (banco2.parametro_valor && asignatura) {
        if (banco2.parametro_valor.toLowerCase() !== asignatura.toLowerCase()) continue;
      }

      const nuevoProgreso = Number(mision.progreso || 0) + 1;
      const meta = Number(banco2.meta_cantidad || 1);

      await query(
        `UPDATE misiones_semanales SET progreso = $1 WHERE id = $2`,
        [nuevoProgreso, mision.id]
      );

      if (nuevoProgreso >= meta) {
        const resultado2 = await entregarRecompensaMisionSemanal(mision, perfil);
        const data2 = await resultado2.json();
        if (data2.ok) {
          completadas.push({
            descripcion: mision.descripcion,
            monedas: data2.recompensa,
            xp: data2.xp_ganado,
            subio_nivel: data2.subio_nivel,
            nuevo_nivel: data2.nuevo_nivel,
            mensaje: banco2.mensaje_logro || '🏆 Misión semanal completada',
            tipo: 'semanal',
          });
        }
      }
    }
  }

  return res({ completadas });
}

// ============================================
// NÚCLEO: evalúa si una misión se cumple dado el trigger actual
// ============================================
async function evaluarCondicion(banco, triggerActual, ctx) {
  const { juego_id: jidActual, puntos, duracion_seg, asignatura, perfil, hoy } = ctx;

  const triggerOk = (
    banco.accion_trigger === triggerActual ||
    (banco.accion_trigger === 'juego_especifico' && triggerActual === 'juego_completado')
  );
  if (!triggerOk) return false;

  if (banco.accion_trigger === 'juego_especifico' && banco.juego_id) {
    if (!jidActual) return false;
    if (banco.juego_id.toLowerCase() !== jidActual.toLowerCase()) return false;
  }

  if (banco.parametro_valor && asignatura) {
    if (banco.parametro_valor.toLowerCase() !== asignatura.toLowerCase()) return false;
  }

  const condicion = banco.condicion_tipo || 'auto';

  if (condicion === 'auto') return true;

  if (condicion === 'puntos') {
    const req = Number(banco.requiere_puntos || 0);
    return Number(puntos || 0) >= req;
  }

  if (condicion === 'tiempo') {
    const limite = Number(banco.meta_tiempo_seg || 9999);
    return Number(duracion_seg || 9999) <= limite;
  }

  if (condicion === 'repetir') {
    const meta = Number(banco.meta_cantidad || 1);
    if (meta <= 1) return true;
    const conteo = await contarOcurrenciasHoy(perfil.id, banco, hoy, jidActual, asignatura);
    return (conteo + 1) >= meta;
  }

  if (condicion === 'manual') return false;

  return true;
}

// Cuenta cuántas veces ya ocurrió el trigger de una misión hoy
async function contarOcurrenciasHoy(userId, banco, hoy) {
  const trigger = banco.accion_trigger;

  if (trigger === 'juego_completado') {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM juegos_partidas
       WHERE user_id = $1 AND DATE(created_at) = $2 AND completado = TRUE`,
      [userId, hoy]
    );
    return Number(rows[0]?.n || 0);
  }

  if (trigger === 'juego_especifico' && banco.juego_id) {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM juegos_partidas
       WHERE user_id = $1 AND DATE(created_at) = $2
       AND juego_id = $3 AND completado = TRUE`,
      [userId, hoy, banco.juego_id]
    );
    return Number(rows[0]?.n || 0);
  }

  if (trigger === 'tarea_subida') {
    const params = [userId, hoy];
    let sql = `SELECT COUNT(*) AS n FROM tareas WHERE user_id = $1 AND fecha = $2`;
    if (banco.parametro_valor) { sql += ' AND asignatura = $3'; params.push(banco.parametro_valor); }
    const rows = await query(sql, params);
    return Number(rows[0]?.n || 0);
  }

  if (trigger === 'duelo_ganado') {
    const rows = await query(
      `SELECT COUNT(*) AS n FROM duelos
       WHERE ganador_id = $1 AND DATE(finalizado_at) = $2 AND estado = 'finalizado'`,
      [userId, hoy]
    );
    return Number(rows[0]?.n || 0);
  }

  return 0;
}

// ============================================
// HELPER — Entregar recompensa de una misión diaria completada
// ============================================
async function entregarRecompensaMision(mision, perfil) {
  await query(
    `UPDATE misiones_diarias SET completada = TRUE, completada_at = NOW() WHERE id = $1`,
    [mision.id]
  );

  const monedas = Number(mision.recompensa_monedas);
  const xp = Number(mision.recompensa_xp) || Math.floor(monedas / 2);

  await agregarMonedas(perfil.id, monedas, `Misión: ${mision.descripcion}`, mision.id);
  const resultadoXP = await agregarXP(perfil.id, xp);

  const hoy = new Date().toISOString().split('T')[0];
  const conteo = await query(
    `SELECT COUNT(*) AS total,
     COUNT(*) FILTER (WHERE completada) AS hechas
     FROM misiones_diarias
     WHERE user_id = $1 AND fecha = $2`,
    [perfil.id, hoy]
  );
  const { total, hechas } = conteo[0];

  let bonus = null;
  if (Number(hechas) === Number(total) && Number(total) >= 8) {
    const config = await getConfigEconomia();
    const bonusMonedas = Number(config.bonus_8_misiones || 200);
    const bonusXP = 100;
    await agregarMonedas(perfil.id, bonusMonedas, '🏆 Bonus: ¡8 misiones completadas!');
    const resBonus = await agregarXP(perfil.id, bonusXP);
    bonus = {
      monedas: bonusMonedas,
      xp: bonusXP,
      subio_nivel: resBonus?.subioNivel || false,
      nuevo_nivel: resBonus?.nuevoNivel,
      mensaje: '¡Completaste todas las misiones del día!',
    };
  }

  return res({
    ok: true,
    recompensa: monedas,
    xp_ganado: xp,
    subio_nivel: resultadoXP?.subioNivel || false,
    nuevo_nivel: resultadoXP?.nuevoNivel,
    xp_total: resultadoXP?.nuevoXP,
    bonus,
    mensaje: `+${monedas} EduCoins y +${xp} XP 🎉`,
  });
}

// ============================================
// HELPER — Recompensa misión semanal
// ============================================
async function entregarRecompensaMisionSemanal(mision, perfil) {
  await query(
    `UPDATE misiones_semanales SET completada = TRUE, completada_at = NOW() WHERE id = $1`,
    [mision.id]
  );
  const monedas = Number(mision.recompensa_monedas);
  const xp = Number(mision.recompensa_xp) || Math.floor(monedas / 2);
  await agregarMonedas(perfil.id, monedas, `Misión semanal: ${mision.descripcion}`, mision.id);
  const resultadoXP = await agregarXP(perfil.id, xp);
  return res({
    ok: true,
    recompensa: monedas,
    xp_ganado: xp,
    subio_nivel: resultadoXP?.subioNivel || false,
    nuevo_nivel: resultadoXP?.nuevoNivel,
  });
}

// ============================================
// HELPER — Generar misiones diarias con sorteo inteligente
// ============================================
async function generarMisiones(userId, fecha, perfil) {
  const banco = await getBancoMisiones();
  const evento = await getEventoGlobal();

  const anioActual = new Date().getFullYear();
  const gradoActual = (perfil.grado_ingreso || 1) + (anioActual - (perfil.anio_ingreso || anioActual));
  const nivelActual = perfil.nivel || 1;

  const fechaObj = new Date(fecha);
  const diaSemana = fechaObj.getDay() || 7;
  const lunes = new Date(fechaObj);
  lunes.setDate(fechaObj.getDate() - (diaSemana - 1));
  const lunesStr = lunes.toISOString().split('T')[0];

  const usadasSemana = await query(
    `SELECT tipo_mision, COUNT(*) AS veces
     FROM misiones_diarias
     WHERE user_id = $1 AND fecha >= $2 AND fecha < $3
     GROUP BY tipo_mision`,
    [userId, lunesStr, fecha]
  );
  const conteoPorTipo = Object.fromEntries(usadasSemana.map(r => [r.tipo_mision, Number(r.veces)]));

  const aptas = banco.filter(m => {
    if (m.es_semanal) return false;
    if (Number(m.nivel_minimo || 1) > nivelActual) return false;
    const gradosRaw = m.grados_aptos;
    const grados = Array.isArray(gradosRaw)
      ? gradosRaw.map(Number)
      : (typeof gradosRaw === 'string' && gradosRaw.startsWith('{'))
        ? gradosRaw.replace(/[{}]/g, '').split(',').filter(Boolean).map(Number)
        : [];
    if (grados.length > 0 && !grados.includes(gradoActual)) return false;
    const limite = Number(m.limite_semanal || 3);
    if ((conteoPorTipo[m.tipo] || 0) >= limite) return false;
    return true;
  });

  const forzadas = aptas.filter(m => m.forzada).slice(0, 8);
  const sorteables = aptas.filter(m => !m.forzada);
  const cupos = 8 - forzadas.length;
  const sorteadas = sorteoMisiones(sorteables, cupos);
  let seleccionadas = [...forzadas, ...sorteadas];

  if (seleccionadas.length < 8) {
    const tiposYa = new Set(seleccionadas.map(m => m.tipo));
    const extra = BANCO_MISIONES_FALLBACK.filter(m => !tiposYa.has(m.tipo));
    seleccionadas.push(...extra.slice(0, 8 - seleccionadas.length));
  }

  for (const m of seleccionadas) {
    let multiplicador = 1;
    if (evento) {
      const aplica = evento.alcance === 'todas' || m.evento_activo;
      if (aplica) multiplicador = Number(evento.multiplicador || 1);
    }
    const monedas = Math.round(Number(m.recompensa_base || 60) * multiplicador);
    const xp = Math.round(Number(m.recompensa_xp || 30) * multiplicador);

    await query(
      `INSERT INTO misiones_diarias
       (user_id, fecha, tipo_mision, descripcion, icono, recompensa_monedas, recompensa_xp, fue_forzada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (user_id, fecha, tipo_mision) DO NOTHING`,
      [userId, fecha, m.tipo, m.descripcion, m.icono || '🎯', monedas, xp, m.forzada ? true : false]
    );
    if (m.url_destino) {
      try {
        await query(
          `UPDATE misiones_diarias SET url_destino = $1
           WHERE user_id = $2 AND fecha = $3 AND tipo_mision = $4`,
          [m.url_destino, userId, fecha, m.tipo]
        );
      } catch (_) { }
    }
  }

  return await query(
    `SELECT * FROM misiones_diarias WHERE user_id = $1 AND fecha = $2 ORDER BY created_at ASC`,
    [userId, fecha]
  );
}

// Sorteo ponderado por peso_sorteo
function sorteoMisiones(misiones, cantidad) {
  if (misiones.length <= cantidad) return [...misiones];
  const resultado = [];
  const pool = [...misiones];
  for (let i = 0; i < cantidad && pool.length > 0; i++) {
    const pesoTotal = pool.reduce((s, m) => s + Number(m.peso_sorteo || 5), 0);
    let rand = Math.random() * pesoTotal;
    let idx = 0;
    for (let j = 0; j < pool.length; j++) {
      rand -= Number(pool[j].peso_sorteo || 5);
      if (rand <= 0) { idx = j; break; }
    }
    resultado.push(pool.splice(idx, 1)[0]);
  }
  return resultado;
}

// ============================================
// GENERAR MISIONES SEMANALES
// ============================================
async function generarSemanales(userId, semanaStr, perfil) {
  const banco = await getBancoMisiones();
  const evento = await getEventoGlobal();

  const anioActual = new Date().getFullYear();
  const gradoActual = (perfil.grado_ingreso || 1) + (anioActual - (perfil.anio_ingreso || anioActual));
  const nivelActual = perfil.nivel || 1;

  const aptas = banco.filter(m => {
    if (!m.es_semanal) return false;
    if (Number(m.nivel_minimo || 1) > nivelActual) return false;
    const gradosRaw = m.grados_aptos;
    const grados = Array.isArray(gradosRaw)
      ? gradosRaw.map(Number)
      : (typeof gradosRaw === 'string' && gradosRaw.startsWith('{'))
        ? gradosRaw.replace(/[{}]/g, '').split(',').filter(Boolean).map(Number)
        : [];
    if (grados.length > 0 && !grados.includes(gradoActual)) return false;
    return true;
  });

  const seleccionadas = sorteoMisiones(aptas, 4);

  for (const m of seleccionadas) {
    let multiplicador = 1;
    if (evento) {
      const aplica = evento.alcance === 'todas' || m.evento_activo;
      if (aplica) multiplicador = Number(evento.multiplicador || 1);
    }
    const monedas = Math.round(Number(m.recompensa_base || 300) * multiplicador);
    const xp = Math.round(Number(m.recompensa_xp || 150) * multiplicador);

    await query(
      `INSERT INTO misiones_semanales
       (user_id, semana, tipo_mision, descripcion, icono, recompensa_monedas, recompensa_xp, progreso)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0)
       ON CONFLICT (user_id, semana, tipo_mision) DO NOTHING`,
      [userId, semanaStr, m.tipo, m.descripcion, m.icono || '📅', monedas, xp]
    );
    if (m.url_destino) {
      try {
        await query(
          `UPDATE misiones_semanales SET url_destino = $1
           WHERE user_id = $2 AND semana = $3 AND tipo_mision = $4`,
          [m.url_destino, userId, semanaStr, m.tipo]
        );
      } catch (_) { }
    }
  }

  return await query(
    `SELECT * FROM misiones_semanales WHERE user_id = $1 AND semana = $2 ORDER BY created_at ASC`,
    [userId, semanaStr]
  );
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  if (request.method === 'GET') return getMisiones(auth.clerkId);

  if (request.method === 'POST') {
    const body = await request.json();
    if (body.action === 'completar') return completarMision(auth.clerkId, body);
    if (body.action === 'verificar_trigger') return verificarTrigger(auth.clerkId, body);
    return resError('Acción no reconocida');
  }

  return resError('Método no permitido', 405);
}
