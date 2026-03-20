// ============================================================
// ARCHIVO: /Api/juegos.js
// ============================================================
// GET  /api/juegos                               → estadísticas del día + niveles por juego
// GET  /api/juegos?action=nivel&juego_id=X       → nivel+config actual (para un juego al cargar)
// GET  /api/juegos?action=mapa&juego_id=X        → mapa completo niveles con estado
// GET  /api/juegos?action=catalogo               → lista de juegos activos (para juegos.html)
// GET  /api/juegos?action=catalogo_admin         → lista completa para admin
// GET  /api/juegos?action=mapa_niveles&juego_id  → niveles de un juego para admin
// POST /api/juegos { action:'completar', ... }   → registra partida, sube nivel si corresponde
// POST /api/juegos { action:'crear_juego', ... } → admin: crear juego en catálogo
// POST /api/juegos { action:'crear_nivel_juego'} → admin: crear nivel
// PUT  /api/juegos { action:'editar_juego', ... } → admin: editar juego
// PUT  /api/juegos { action:'editar_nivel_juego'} → admin: editar nivel
// DELETE /api/juegos { action:'eliminar_nivel_juego' } → admin: eliminar nivel
// ============================================================

import {
  query, getPerfil, agregarMonedas, agregarXP, actualizarRacha,
  res, resError, verificarAuth, getConfigEconomia
} from '../lib/neon.js';

// ============================================================
// RESET AUTOMÁTICO 20:00 — sin cron
// Calcula el timestamp del último reset esperado y aplica
// si el alumno no se ha reseteado desde entonces.
// ============================================================
function getResetEsperado() {
  const ahora = new Date();
  const reset = new Date(ahora);
  reset.setHours(20, 0, 0, 0);
  // Si aún no llegaron las 20:00 hoy, el último reset fue ayer a las 20:00
  if (ahora < reset) reset.setDate(reset.getDate() - 1);
  return reset;
}

async function verificarReset(perfilId) {
  const resetEsperado = getResetEsperado();

  // Resetear intentos_hoy y nivel_actual de todos los juegos del alumno
  await query(
    `UPDATE alumno_juego_nivel
     SET nivel_actual  = 1,
         intentos_hoy  = 0,
         ultimo_reset  = $1,
         updated_at    = NOW()
     WHERE user_id = $2
       AND ultimo_reset < $1`,
    [resetEsperado, perfilId]
  );

  // Resetear energía si el alumno no la ha recargado desde el último reset
  await query(
    `UPDATE perfiles
     SET energia_actual       = energia_max,
         ultimo_reset_energia = $1,
         updated_at           = NOW()
     WHERE id = $2
       AND (ultimo_reset_energia IS NULL OR ultimo_reset_energia < $1)`,
    [resetEsperado, perfilId]
  );
}

// ============================================================
// HELPERS — Nivel actual y config
// ============================================================
async function getNivelActual(perfilId, juegoId) {
  const rows = await query(
    `SELECT * FROM alumno_juego_nivel WHERE user_id = $1 AND juego_id = $2`,
    [perfilId, juegoId]
  );
  if (rows.length > 0) return rows[0];

  // Primera vez que el alumno juega este juego → crear registro
  const ins = await query(
    `INSERT INTO alumno_juego_nivel
       (user_id, juego_id, nivel_actual, intentos_hoy, intentos_totales, ultimo_reset)
     VALUES ($1, $2, 1, 0, 0, $3)
     RETURNING *`,
    [perfilId, juegoId, getResetEsperado()]
  );
  return ins[0];
}

async function getConfigNivel(juegoId, nivel) {
  const rows = await query(
    `SELECT * FROM juego_niveles WHERE juego_id = $1 AND nivel = $2`,
    [juegoId, nivel]
  );
  return rows[0] || null;
}

// NUEVO: nivel máximo dinámico desde BD (en vez de hardcodear 10)
async function getNivelMaximo(juegoId) {
  const rows = await query(
    `SELECT MAX(nivel) AS max_nivel FROM juego_niveles WHERE juego_id = $1`,
    [juegoId]
  );
  return Number(rows[0]?.max_nivel ?? 10);
}

// NUEVO: obtener recompensas desde config_recompensas
async function getRecompensaEtapa(nivel, etapa) {
  const rows = await query(
    `SELECT * FROM config_recompensas WHERE nivel = $1 AND etapa = $2`,
    [nivel, etapa]
  );
  return rows[0] || null;
}

// NUEVO: obtener multiplicador del juego desde juegos_catalogo
async function getMultiplicadorJuego(juegoId) {
  const rows = await query(
    `SELECT multiplicador FROM juegos_catalogo WHERE juego_id = $1`,
    [juegoId]
  );
  return Number(rows[0]?.multiplicador ?? 1.0);
}

// NUEVO: obtener config del juego desde juegos_catalogo
async function getConfigJuego(juegoId) {
  const rows = await query(
    `SELECT config FROM juegos_catalogo WHERE juego_id = $1`,
    [juegoId]
  );
  return rows[0]?.config || {};
}

// ============================================================
// GET — Estadísticas + niveles actuales
// ============================================================
async function getEstadisticas(clerkId, url) {
  const action = url.searchParams.get('action');
  const juegoId = url.searchParams.get('juego_id');

  // Endpoints sin auth de alumno (catálogo, mapa de niveles para admin)
  if (action === 'catalogo') {
    const juegos = await query(
      `SELECT * FROM juegos_catalogo WHERE activo = true ORDER BY orden ASC`
    );
    return res({ juegos });
  }

  if (action === 'catalogo_admin') {
    const juegos = await query(`SELECT * FROM juegos_catalogo ORDER BY orden ASC`);
    return res({ juegos });
  }

  if (action === 'mapa_niveles' && juegoId) {
    const niveles = await query(
      `SELECT * FROM juego_niveles WHERE juego_id = $1 ORDER BY nivel ASC`,
      [juegoId]
    );
    return res({ mapa_niveles: niveles });
  }

  // Endpoints con perfil de alumno
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  // Aplicar reset automático antes de leer cualquier dato
  await verificarReset(perfil.id);
  const perfilActual = await getPerfil(clerkId); // refrescar tras reset

  // GET nivel actual de un juego específico (lo llama el juego al cargar)
  if (action === 'nivel' && juegoId) {
    const nivelData = await getNivelActual(perfil.id, juegoId);
    const configNivel = await getConfigNivel(juegoId, nivelData.nivel_actual);
    const nivelMax = await getNivelMaximo(juegoId);

    // ══════════════════════════════════════════════════════════════
    // NUEVO: Obtener config del juego (unidades activas por asignatura)
    // ══════════════════════════════════════════════════════════════
    const configJuego = await getConfigJuego(juegoId);

    // Contar etapas desde el último reset (20:00), no desde medianoche
    const resetEsperado = getResetEsperado();
    const etapasHoy = await query(
      `SELECT COUNT(*) AS total FROM juegos_partidas
       WHERE user_id = $1 AND juego_id = $2
         AND etapa_completada IS NOT NULL
         AND created_at >= $3`,
      [perfil.id, juegoId, resetEsperado]
    );
    const etapasCompletadasHoy = Number(etapasHoy[0]?.total ?? 0);
    return res({
      nivel_actual: nivelData.nivel_actual,
      intentos_hoy: nivelData.intentos_hoy,
      intentos_requeridos: configNivel?.intentos_requeridos ?? 3,
      nombre_nivel: configNivel?.nombre ?? ('Nivel ' + nivelData.nivel_actual),
      descripcion: configNivel?.descripcion ?? '',
      config: configNivel?.config ?? {},

      // ══════════════════════════════════════════════════════════════
      // NUEVO: config_juego con las unidades activas por asignatura
      // El juego (cuestionario.html) usa esto para CONFIG_ACTIVA
      // ══════════════════════════════════════════════════════════════
      config_juego: configJuego,

      recompensa_monedas: configNivel?.recompensa_monedas ?? 0,
      recompensa_xp: configNivel?.recompensa_xp ?? 0,
      nivel_maximo: nivelMax,
      es_maestro: nivelData.nivel_actual >= nivelMax,
      etapas_completadas_hoy: etapasCompletadasHoy,
    });
  }

  // GET mapa completo de un juego con estado por alumno
  if (action === 'mapa' && juegoId) {
    const nivelData = await getNivelActual(perfil.id, juegoId);
    const niveles = await query(
      `SELECT * FROM juego_niveles WHERE juego_id = $1 ORDER BY nivel ASC`,
      [juegoId]
    );
    const mapa = niveles.map(n => ({
      nivel: n.nivel,
      nombre: n.nombre,
      descripcion: n.descripcion,
      config: n.config,
      intentos_requeridos: n.intentos_requeridos,
      recompensa_monedas: n.recompensa_monedas,
      recompensa_xp: n.recompensa_xp,
      estado:
        n.nivel < nivelData.nivel_actual ? 'completado' :
          n.nivel === nivelData.nivel_actual ? 'actual' : 'bloqueado',
      intentos_hoy: n.nivel === nivelData.nivel_actual ? nivelData.intentos_hoy : 0,
    }));
    return res({ mapa, nivel_actual: nivelData.nivel_actual });
  }

  // GET estadísticas generales del día
  const hoy = new Date().toISOString().split('T')[0];

  const partidasHoy = await query(
    `SELECT juego_id, puntos, monedas_ganadas, xp_ganado, completado, created_at
     FROM juegos_partidas
     WHERE user_id = $1 AND DATE(created_at) = $2
     ORDER BY created_at DESC`,
    [perfil.id, hoy]
  );

  const topHoy = await query(
    `SELECT p2.nombre, p2.avatar_base, jp.juego_id, MAX(jp.puntos) AS mejor_puntuacion
     FROM juegos_partidas jp
     JOIN perfiles p2 ON p2.id = jp.user_id
     WHERE DATE(jp.created_at) = $1 AND jp.completado = TRUE
     GROUP BY p2.nombre, p2.avatar_base, jp.juego_id
     ORDER BY jp.juego_id, mejor_puntuacion DESC`,
    [hoy]
  );

  const juegosPorUsuario = {};
  topHoy.forEach(r => {
    if (!juegosPorUsuario[r.juego_id]) juegosPorUsuario[r.juego_id] = [];
    if (juegosPorUsuario[r.juego_id].length < 3) {
      juegosPorUsuario[r.juego_id].push({
        nombre: r.nombre,
        avatar: r.avatar_base,
        pts: Number(r.mejor_puntuacion),
      });
    }
  });

  // Niveles actuales de todos los juegos del alumno (para las cards)
  const nivelesRows = await query(
    `SELECT ajn.juego_id, ajn.nivel_actual, ajn.intentos_hoy,
            jn.intentos_requeridos, jn.nombre
     FROM alumno_juego_nivel ajn
     LEFT JOIN juego_niveles jn
       ON jn.juego_id = ajn.juego_id AND jn.nivel = ajn.nivel_actual
     WHERE ajn.user_id = $1`,
    [perfil.id]
  );
  const nivelesPorJuego = {};
  nivelesRows.forEach(r => {
    const intentosReq = r.intentos_requeridos ?? 3;
    const intentosHoy = Math.min(r.intentos_hoy, intentosReq); // nunca puede superar el máximo
    nivelesPorJuego[r.juego_id] = {
      nivel_actual: r.nivel_actual,
      intentos_hoy: intentosHoy,
      intentos_requeridos: intentosReq,
      nombre_nivel: r.nombre ?? ('Nivel ' + r.nivel_actual),
    };
  });

  const juegosDiferentes = [...new Set(
    partidasHoy.filter(p => p.completado).map(p => p.juego_id)
  )];

  return res({
    partidas_hoy: partidasHoy,
    juegos_jugados_hoy: juegosDiferentes.length,
    juegos_completados_hoy: juegosDiferentes,
    top_hoy: juegosPorUsuario,
    energia_actual: perfilActual.energia_actual,
    xp_actual: perfilActual.xp,
    nivel_actual: perfilActual.nivel,
    xp_siguiente_nivel: perfilActual.nivel * 1000,
    niveles_juegos: nivelesPorJuego,
  });
}

// ============================================================
// POST — Completar partida
// ============================================================
async function completarPartida(clerkId, body, clerkToken) {
  const { juego_id, puntos = 0, duracion_seg = 0, session_id, nivel_completado = false, etapa_completada = null } = body;
  if (!juego_id) return resError('Falta juego_id');

  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  // Aplicar reset antes de cualquier operación
  await verificarReset(perfil.id);

  // Obtener datos del nivel actual del alumno
  const nivelData = await getNivelActual(perfil.id, juego_id);
  const configNivel = await getConfigNivel(juego_id, nivelData.nivel_actual);
  const intentosReq = configNivel?.intentos_requeridos ?? 3;
  const nivelMax = await getNivelMaximo(juego_id);
  const esMaestroActual = nivelData.nivel_actual >= nivelMax;

  // Obtener multiplicador del juego
  const multiplicador = await getMultiplicadorJuego(juego_id);

  // Calcular número de etapa actual
  // CoinClik envía etapa_completada explícita (1, 2 o 3) — usar directamente
  // Otros juegos usan intentos_hoy + 1
  const etapaActual = (juego_id === 'coinclik' && etapa_completada)
    ? Number(etapa_completada)
    : nivelData.intentos_hoy + 1;

  // ============================================================
  // NUEVO SISTEMA: Recompensas desde config_recompensas
  // ============================================================
  let monedas = 0;
  let xp = 0;
  let bonusMonedas = 0;
  let bonusXp = 0;

  // Obtener recompensa de la etapa desde config_recompensas
  const recompensaEtapa = await getRecompensaEtapa(nivelData.nivel_actual, etapaActual);

  if (recompensaEtapa) {
    // Recompensa base de la etapa × multiplicador del juego
    monedas = Math.floor(recompensaEtapa.monedas * multiplicador);
    xp = Math.floor(recompensaEtapa.xp * multiplicador);

    // Si es la última etapa del nivel, agregar bonus
    if (etapaActual >= intentosReq) {
      bonusMonedas = Math.floor(recompensaEtapa.bonus_nivel_monedas * multiplicador);
      bonusXp = Math.floor(recompensaEtapa.bonus_nivel_xp * multiplicador);
    }
  } else {
    // Fallback si no existe en config_recompensas (compatibilidad)
    const config = await getConfigEconomia();
    const baseMonedas = Number(config.juego_completado ?? 80);
    monedas = baseMonedas;
    if (puntos >= 1000) monedas = Math.floor(baseMonedas * 1.5);
    else if (puntos >= 500) monedas = Math.floor(baseMonedas * 1.2);
    xp = Math.floor(monedas / 2);
  }

  // Registrar partida
  const monedasTotales = monedas + bonusMonedas;
  const xpTotal = xp + bonusXp;

  if (session_id) {
    await query(
      `UPDATE juegos_partidas
       SET puntos          = $1,
           duracion_seg    = $2,
           monedas_ganadas = $3,
           xp_ganado       = $4,
           completado      = TRUE
       WHERE id = $5 AND user_id = $6`,
      [puntos, duracion_seg, monedasTotales, xpTotal, session_id, perfil.id]
    );
  } else {
    await query(
      `INSERT INTO juegos_partidas
         (user_id, juego_id, puntos, duracion_seg, monedas_ganadas, xp_ganado, completado, etapa_completada)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7)`,
      [perfil.id, juego_id, puntos, duracion_seg, monedasTotales, xpTotal, etapa_completada]
    );
  }

  // Sistema de niveles del juego
  const nuevosIntentos = nivelData.intentos_hoy + 1;
  let subiNivel = false;
  let nivelNuevo = nivelData.nivel_actual;
  let configNivelNuevo = configNivel;

  // nivel_completado=true lo envía coinclik al terminar 4 etapas (sin depender de intentos)
  // Para otros juegos se mantiene el comportamiento original por intentos
  const debeSubirNivel = !esMaestroActual && (
    nivel_completado === true ? true : nuevosIntentos >= intentosReq
  );

  if (debeSubirNivel) {
    // El alumno completó el nivel → sube de nivel
    nivelNuevo = nivelData.nivel_actual + 1;
    subiNivel = true;
    configNivelNuevo = await getConfigNivel(juego_id, nivelNuevo);

    await query(
      `UPDATE alumno_juego_nivel
       SET nivel_actual     = $1,
           intentos_hoy     = 0,
           intentos_totales = intentos_totales + 1,
           updated_at       = NOW()
       WHERE user_id = $2 AND juego_id = $3`,
      [nivelNuevo, perfil.id, juego_id]
    );

  } else {
    // Solo incrementar intentos
    await query(
      `UPDATE alumno_juego_nivel
       SET intentos_hoy     = $1,
           intentos_totales = intentos_totales + 1,
           updated_at       = NOW()
       WHERE user_id = $2 AND juego_id = $3`,
      [nuevosIntentos, perfil.id, juego_id]
    );
  }

  // Otorgar monedas y XP
  if (monedasTotales > 0) {
    const descripcion = bonusMonedas > 0
      ? `🏆 Nivel ${nivelData.nivel_actual} completado en ${juego_id}`
      : `Etapa ${etapaActual} completada en ${juego_id}`;
    await agregarMonedas(perfil.id, monedasTotales, descripcion);
  }

  const resultadoXP = xpTotal > 0 ? await agregarXP(perfil.id, xpTotal) : null;

  // Actualizar racha (completar cualquier juego cuenta)
  await actualizarRacha(perfil.id);

  // Verificar y completar misiones
  const misionesCompletadas = await verificarMisiones(perfil, juego_id, puntos, clerkToken);

  return res({
    ok: true,

    // Recompensa de la etapa
    monedas_ganadas: monedas,
    xp_ganado: xp,

    // Bonus por completar nivel (si aplica)
    bonus_monedas: bonusMonedas,
    bonus_xp: bonusXp,

    // Estado del perfil (nivel de EduCoins)
    subio_nivel: resultadoXP?.subioNivel ?? false,
    nuevo_nivel: resultadoXP?.nuevoNivel,
    xp_total: resultadoXP?.nuevoXP,
    xp_siguiente_nivel: (resultadoXP?.nuevoNivel ?? perfil.nivel) * 1000,

    // Estado del nivel del juego
    nivel_juego: nivelNuevo,
    intentos_hoy: subiNivel ? 0 : nuevosIntentos,
    intentos_req: intentosReq,
    subi_nivel_juego: subiNivel,
    nombre_nivel: configNivelNuevo?.nombre ?? ('Nivel ' + nivelNuevo),
    descripcion_nivel: configNivelNuevo?.descripcion ?? '',
    config_nivel: configNivelNuevo?.config ?? {},
    nivel_maximo: nivelMax,
    es_maestro: nivelNuevo >= nivelMax,

    // Misiones
    misiones_completadas: misionesCompletadas,
  });
}

// ============================================================
// HELPER — Verificar misiones via banco (api/misiones verificarTrigger)
// Reemplaza el mapa hardcodeado — el banco es la única fuente de verdad
// ============================================================
async function verificarMisiones(perfil, juego_id, puntos, clerkToken) {
  try {
    // Determinar BASE_URL según entorno
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000';

    const r = await fetch(`${base}/api/misiones`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${clerkToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'verificar_trigger',
        trigger: 'juego_completado',
        juego_id,
        puntos,
      }),
    });
    if (!r.ok) return [];
    const data = await r.json();
    return data.completadas || [];
  } catch (_) {
    return [];
  }
}

// ============================================================
// ADMIN — CRUD Juegos en catálogo
// ============================================================
async function adminCrearJuego(body) {
  const {
    juego_id, nombre, emoji = '🎮', descripcion = null,
    url, color = '#7c3aed', rgb = '124,58,237',
    bg = 'linear-gradient(135deg,#1e1b4b,#312e81)',
    recompensa = 'hasta +300', energia = 10, dificultad = 2,
    multiplicador = 1.0,
    badge = null, orden = 10, activo = true, tiene_niveles = false,
    config = {},  // NUEVO: config de unidades
  } = body;
  if (!juego_id || !nombre || !url) return resError('Faltan campos obligatorios');

  await query(
    `INSERT INTO juegos_catalogo
       (juego_id, nombre, emoji, descripcion, url, color, rgb, bg,
        recompensa, energia, dificultad, multiplicador, badge, orden, activo, tiene_niveles, config)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [juego_id, nombre, emoji, descripcion, url, color, rgb, bg,
      recompensa, energia, dificultad, multiplicador, badge, orden, activo, tiene_niveles,
      JSON.stringify(config)]
  );
  return res({ ok: true });
}

async function adminEditarJuego(body) {
  const {
    juego_id, nombre, emoji, descripcion, url, color, rgb, bg,
    recompensa, energia, dificultad, multiplicador, badge, orden, activo, tiene_niveles,
    config,  // NUEVO: config de unidades
  } = body;
  if (!juego_id) return resError('Falta juego_id');

  // ══════════════════════════════════════════════════════════════
  // ACTUALIZADO: incluir config en el UPDATE
  // ══════════════════════════════════════════════════════════════
  await query(
    `UPDATE juegos_catalogo
     SET nombre=$1, emoji=$2, descripcion=$3, url=$4, color=$5, rgb=$6, bg=$7,
         recompensa=$8, energia=$9, dificultad=$10, multiplicador=$11, badge=$12, orden=$13,
         activo=$14, tiene_niveles=$15, config=$16, updated_at=now()
     WHERE juego_id = $17`,
    [nombre, emoji, descripcion, url, color, rgb, bg,
      recompensa, energia, dificultad, multiplicador, badge, orden, activo, tiene_niveles,
      config ? JSON.stringify(config) : '{}', juego_id]
  );
  return res({ ok: true });
}

// ============================================================
// ADMIN — CRUD Niveles
// ============================================================
async function adminCrearNivel(body) {
  const {
    juego_id, nivel, nombre, descripcion = null,
    config = {}, intentos_requeridos = 3,
    recompensa_bonus_monedas = 0, recompensa_bonus_xp = 0,
  } = body;
  if (!juego_id || !nivel || !nombre) return resError('Faltan campos obligatorios');

  await query(
    `INSERT INTO juego_niveles
       (juego_id, nivel, nombre, descripcion, config, intentos_requeridos,
        recompensa_monedas, recompensa_xp)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [juego_id, nivel, nombre, descripcion,
      JSON.stringify(config), intentos_requeridos,
      recompensa_bonus_monedas, recompensa_bonus_xp]
  );
  return res({ ok: true });
}

async function adminEditarNivel(body) {
  const {
    id, nombre, descripcion = null, config = {},
    intentos_requeridos = 3,
    recompensa_bonus_monedas = 0, recompensa_bonus_xp = 0,
  } = body;
  if (!id) return resError('Falta id del nivel');

  await query(
    `UPDATE juego_niveles
     SET nombre=$1, descripcion=$2, config=$3, intentos_requeridos=$4,
         recompensa_monedas=$5, recompensa_xp=$6
     WHERE id = $7`,
    [nombre, descripcion, JSON.stringify(config), intentos_requeridos,
      recompensa_bonus_monedas, recompensa_bonus_xp, id]
  );
  return res({ ok: true });
}

async function adminEliminarNivel(body) {
  const { id } = body;
  if (!id) return resError('Falta id');
  await query(`DELETE FROM juego_niveles WHERE id = $1`, [id]);
  return res({ ok: true });
}

// ============================================================
// HANDLER PRINCIPAL
// ============================================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  const url = new URL(request.url);

  if (request.method === 'GET') {
    return getEstadisticas(auth.clerkId, url);
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const clerkToken = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (body.action === 'completar') return completarPartida(auth.clerkId, body, clerkToken);
    if (body.action === 'crear_juego') return adminCrearJuego(body);
    if (body.action === 'crear_nivel_juego') return adminCrearNivel(body);
    return resError('Acción no reconocida');
  }

  if (request.method === 'PUT') {
    const body = await request.json();
    if (body.action === 'editar_juego') return adminEditarJuego(body);
    if (body.action === 'editar_nivel_juego') return adminEditarNivel(body);
    return resError('Acción no reconocida');
  }

  if (request.method === 'DELETE') {
    const body = await request.json();
    if (body.action === 'eliminar_nivel_juego') return adminEliminarNivel(body);
    return resError('Acción no reconocida');
  }

  return resError('Método no permitido', 405);
}