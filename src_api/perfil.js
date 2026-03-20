// ============================================
// api/perfil.js — Perfil del usuario
// GET  /api/perfil  → leer perfil propio
// POST /api/perfil  → crear perfil (registro)
// PUT  /api/perfil  → actualizar campos del perfil
// VERSIÓN: v1.4
// ============================================

import {
  query, getPerfil, updatePerfil, res, resError, verificarAuth, getConfigEconomia
} from '../lib/neon.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);
  const { clerkId } = auth;

  // ============================================
  // GET — Leer perfil
  // ============================================
  if (request.method === 'GET') {
    const perfil = await getPerfil(clerkId);
    if (!perfil) return resError('Perfil no encontrado', 404);

    // Obtener nombre del colegio
    let nombre_colegio = null;
    if (perfil.colegio_id) {
      const colegioRows = await query(
        `SELECT nombre FROM colegios WHERE id = $1`,
        [perfil.colegio_id]
      );
      nombre_colegio = colegioRows[0]?.nombre || null;
    }

    const anioActual = new Date().getFullYear();
    const gradoActual = Math.min(
      perfil.grado_ingreso + (anioActual - perfil.anio_ingreso),
      8
    );

    let categoriaRango = 'Primaria';
    if (gradoActual <= 3) categoriaRango = 'Explorador';
    else if (gradoActual <= 6) categoriaRango = 'Aventurero';
    else categoriaRango = 'Maestro';

    let subRango = 'Bronce';
    if (perfil.nivel >= 20) subRango = 'Diamante';
    else if (perfil.nivel >= 12) subRango = 'Oro';
    else if (perfil.nivel >= 6) subRango = 'Plata';

    // ── Stats adicionales (evaluaciones + juegos) ──
    const [evalStats, juegoStats] = await Promise.all([
      query(
        `SELECT 
          COUNT(*) FILTER (WHERE er.nota_obtenida IS NOT NULL) AS total_evaluaciones,
          ROUND(AVG(er.nota_obtenida) FILTER (WHERE er.nota_obtenida IS NOT NULL), 1) AS promedio_notas
         FROM evaluaciones_resultados er
         WHERE er.user_id = $1`,
        [perfil.id]
      ).then(r => r[0] || {}),
      query(
        `SELECT
          COUNT(*) AS juegos_jugados,
          MODE() WITHIN GROUP (ORDER BY jp.juego_id) AS juego_favorito
         FROM juegos_partidas jp
         WHERE jp.user_id = $1`,
        [perfil.id]
      ).then(r => r[0] || {}),
    ]).catch(() => [{}, {}]);

    // ── Lógica de racha diaria ──────────────────
    const ahora = new Date();
    const hoy = new Date(ahora.toISOString().split('T')[0] + 'T00:00:00Z');
    const ayer = new Date(hoy.getTime() - 86400000);
    const ultimoLogin = perfil.ultimo_login ? new Date(perfil.ultimo_login) : null;
    const ultimoLoginDia = ultimoLogin
      ? new Date(ultimoLogin.toISOString().split('T')[0] + 'T00:00:00Z')
      : null;

    let nuevaRacha = perfil.racha_dias || 0;
    let nuevaRachaMax = perfil.racha_max || 0;
    let actualizarLogin = false;

    if (!ultimoLoginDia || ultimoLoginDia < ayer) {
      // Más de un día sin entrar → resetear racha a 1
      nuevaRacha = 1;
      actualizarLogin = true;
    } else if (ultimoLoginDia.getTime() === ayer.getTime()) {
      // Entró ayer → incrementar racha
      nuevaRacha = (perfil.racha_dias || 0) + 1;
      actualizarLogin = true;
    }
    // Si ultimoLoginDia === hoy → no hacer nada (ya se contó)

    if (actualizarLogin) {
      nuevaRachaMax = Math.max(nuevaRacha, nuevaRachaMax);
      await query(
        `UPDATE perfiles SET racha_dias = $1, racha_max = $2, ultimo_login = $3 WHERE clerk_id = $4`,
        [nuevaRacha, nuevaRachaMax, ahora.toISOString(), clerkId]
      );
    }
    // ────────────────────────────────────────────

    return res({
      ...perfil,
      racha_dias: nuevaRacha,
      racha_max: nuevaRachaMax,
      grado_actual: gradoActual,
      categoria_rango: categoriaRango,
      sub_rango: subRango,
      rango_completo: `${categoriaRango} ${subRango}`,
      nombre_colegio: nombre_colegio,
      total_evaluaciones: Number(evalStats.total_evaluaciones || 0),
      promedio_notas: Number(evalStats.promedio_notas || 0),
      juegos_jugados: Number(juegoStats.juegos_jugados || 0),
      juego_favorito: juegoStats.juego_favorito || '—',
    });
  }

  // ============================================
  // POST — Crear perfil (primer registro)
  // ============================================
  if (request.method === 'POST') {
    const body = await request.json();
    const { nombre, email, grado_ingreso, anio_ingreso, colegio_id } = body;

    if (!nombre || !email || !grado_ingreso) {
      return resError('Faltan campos obligatorios: nombre, email, grado_ingreso');
    }
    if (grado_ingreso < 1 || grado_ingreso > 8) {
      return resError('grado_ingreso debe estar entre 1 y 8');
    }

    const existente = await getPerfil(clerkId);
    if (existente) return resError('El perfil ya existe', 409);

    // Validar colegio_id si viene (es opcional para no romper flujos viejos)
    if (colegio_id) {
      const colegio = await query(
        'SELECT id FROM colegios WHERE id = $1 AND activo = true',
        [colegio_id]
      );
      if (colegio.length === 0) {
        return resError('Colegio no válido', 400);
      }
    }

    const config = await getConfigEconomia();
    const monedasBienvenida = Number(config.bienvenida || 100);

    // Avatar aleatorio de bienvenida
    const avatarsDisponibles = ['🐰', '🐸', '🦋', '🤖', '🐶', '🐱', '🦊', '🐼'];
    const avatarAleatorio = avatarsDisponibles[Math.floor(Math.random() * avatarsDisponibles.length)];

    const rows = await query(
      `INSERT INTO perfiles
        (clerk_id, nombre, email, grado_ingreso, anio_ingreso, monedas, colegio_id, avatar_base)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        clerkId,
        nombre.trim(),
        email.toLowerCase(),
        grado_ingreso,
        anio_ingreso || new Date().getFullYear(),
        monedasBienvenida,
        colegio_id || null,
        avatarAleatorio,
      ]
    );

    const nuevoPerfil = rows[0];

    await query(
      `INSERT INTO transacciones (user_id, tipo, monto, concepto)
       VALUES ($1, 'ganancia', $2, 'Bienvenida a EduCoins 🎉')`,
      [nuevoPerfil.id, monedasBienvenida]
    );

    return res(nuevoPerfil, 201);
  }

  // ============================================
  // PUT — Actualizar perfil
  // ============================================
  if (request.method === 'PUT') {
    const body = await request.json();

    const camposPermitidos = ['nombre', 'avatar_base', 'accesorios', 'telegram_chat_id', 'colegio_id'];
    const campos = {};
    for (const campo of camposPermitidos) {
      if (body[campo] !== undefined) campos[campo] = body[campo];
    }

    if (Object.keys(campos).length === 0) {
      return resError('No se enviaron campos válidos para actualizar');
    }

    // Validar colegio_id si se está actualizando
    if (campos.colegio_id) {
      const colegio = await query(
        'SELECT id FROM colegios WHERE id = $1 AND activo = true',
        [campos.colegio_id]
      );
      if (colegio.length === 0) {
        return resError('Colegio no válido', 400);
      }
    }

    const actualizado = await updatePerfil(clerkId, campos);
    if (!actualizado) return resError('Perfil no encontrado', 404);

    return res(actualizado);
  }

  return resError('Método no permitido', 405);
}