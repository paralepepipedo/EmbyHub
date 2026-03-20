// ============================================
// api/colegios.js
// GET  /api/colegios  → lista de colegios activos (público)
// ============================================

import { query, res, resError } from '../lib/neon.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'GET') {
    return resError('Método no permitido', 405);
  }

  // Este endpoint es PÚBLICO — no requiere auth
  // Lo necesita registro.html antes de que el usuario tenga sesión
  try {
    const rows = await query(
      `SELECT id, nombre, comuna, region, pais
       FROM colegios
       WHERE activo = true
       ORDER BY nombre ASC`
    );
    return res({ colegios: rows });
  } catch (err) {
    console.error('[colegios] Error:', err.message);
    return resError('Error al obtener colegios', 500);
  }
}