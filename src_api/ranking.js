// ============================================
// api/ranking.js — Podio y ranking global
// GET /api/ranking?tipo=global&grado=6&limit=10
// ============================================
// ÍNDICE
// 1. Caché en memoria (1 minuto)
// 2. GET — ranking global
// 3. GET — ranking por grado
// 4. GET — posición del usuario actual
// ============================================

import { query, getPerfil, res, resError, verificarAuth } from '../lib/neon.js';

// ============================================
// 1. CACHÉ EN MEMORIA
// Evita consultas repetidas en páginas del podio
// Se invalida cada 60 segundos
// ============================================
const CACHE_TTL = 60 * 1000; // 1 minuto
const _cache = {};

function getCache(key) {
  const entry = _cache[key];
  if (entry && Date.now() - entry.at < CACHE_TTL) return entry.data;
  return null;
}
function setCache(key, data) {
  _cache[key] = { data, at: Date.now() };
}

// ============================================
// 2 & 3. GET — Rankings
// ============================================
async function getRanking(clerkId, url) {
  const tipo  = url.searchParams.get('tipo')  || 'global';
  const grado = url.searchParams.get('grado') || null;
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10'), 50);

  const cacheKey = `ranking_${tipo}_${grado}_${limit}`;
  const cached = getCache(cacheKey);
  if (cached) {
    // Agregar posición del usuario si está autenticado
    return res({ ...cached, desde_cache: true });
  }

  let sqlRanking;
  const params = [limit];

  if (tipo === 'grado' && grado) {
    // Ranking dentro del mismo grado (calculado dinámicamente)
    const anioActual = new Date().getFullYear();
    params.push(grado, anioActual);
    sqlRanking = `
      SELECT
        p.id, p.nombre, p.avatar_base, p.accesorios,
        p.nivel, p.monedas, p.racha_dias,
        p.grado_ingreso,
        (p.grado_ingreso + ($3 - p.anio_ingreso)) AS grado_actual,
        ROW_NUMBER() OVER (ORDER BY p.monedas DESC) AS posicion
      FROM perfiles p
      WHERE p.rol = 'alumno'
        AND (p.grado_ingreso + ($3 - p.anio_ingreso)) = $2
      ORDER BY p.monedas DESC
      LIMIT $1
    `;
  } else {
    // Ranking global
    const anioActual = new Date().getFullYear();
    params.push(anioActual);
    sqlRanking = `
      SELECT
        p.id, p.nombre, p.avatar_base, p.accesorios,
        p.nivel, p.monedas, p.racha_dias,
        (p.grado_ingreso + ($2 - p.anio_ingreso)) AS grado_actual,
        ROW_NUMBER() OVER (ORDER BY p.monedas DESC) AS posicion
      FROM perfiles p
      WHERE p.rol = 'alumno'
      ORDER BY p.monedas DESC
      LIMIT $1
    `;
  }

  const ranking = await query(sqlRanking, params);

  // Top 3 con emoji especial
  const top3 = ranking.slice(0, 3).map((u, i) => ({
    ...u,
    medalla: ['🥇', '🥈', '🥉'][i],
  }));

  const resultado = { ranking, top3, tipo, grado, total: ranking.length };
  setCache(cacheKey, resultado);

  return res(resultado);
}

// ============================================
// 4. Posición del usuario actual
// ============================================
async function getMiPosicion(clerkId) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const anioActual = new Date().getFullYear();

  const rows = await query(
    `SELECT COUNT(*) AS posicion
     FROM perfiles
     WHERE monedas > $1 AND rol = 'alumno'`,
    [perfil.monedas]
  );

  const posicionGlobal = Number(rows[0].posicion) + 1;

  const gradoActual = Math.min(
    perfil.grado_ingreso + (anioActual - perfil.anio_ingreso),
    8
  );

  // Posición dentro de su grado
  const rowsGrado = await query(
    `SELECT COUNT(*) AS posicion
     FROM perfiles
     WHERE monedas > $1
       AND rol = 'alumno'
       AND (grado_ingreso + ($2 - anio_ingreso)) = $3`,
    [perfil.monedas, anioActual, gradoActual]
  );
  const posicionGrado = Number(rowsGrado[0].posicion) + 1;

  return res({ posicion_global: posicionGlobal, posicion_grado: posicionGrado, grado_actual: gradoActual });
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  const url = new URL(request.url);

  if (request.method === 'GET') {
    if (url.searchParams.get('mi_posicion') === '1') {
      return getMiPosicion(auth.clerkId);
    }
    return getRanking(auth.clerkId, url);
  }

  return resError('Método no permitido', 405);
}
