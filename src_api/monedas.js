// ============================================
// api/monedas.js — Transacciones de monedas
// GET  /api/monedas          → saldo + historial
// POST /api/monedas/gastar   → gastar monedas (tienda)
// ============================================
// ÍNDICE
// 1. GET — saldo actual + historial paginado
// 2. POST — gastar monedas con validación
// ============================================

import { query, getPerfil, gastarMonedas, res, resError, verificarAuth } from '../lib/neon.js';

// ============================================
// 1. GET — Saldo + historial
// ============================================
async function getSaldo(clerkId, url) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const pagina  = parseInt(url.searchParams.get('pagina') || '1');
  const porPagina = 20;
  const offset  = (pagina - 1) * porPagina;

  const historial = await query(
    `SELECT id, tipo, monto, concepto, created_at
     FROM transacciones
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [perfil.id, porPagina, offset]
  );

  const totalRows = await query(
    `SELECT COUNT(*) AS total FROM transacciones WHERE user_id = $1`,
    [perfil.id]
  );

  // Resumen: ganancias y gastos del mes actual
  const resumenMes = await query(
    `SELECT
       tipo,
       SUM(monto) AS total,
       COUNT(*)   AS cantidad
     FROM transacciones
     WHERE user_id = $1
       AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM NOW())
       AND EXTRACT(YEAR  FROM created_at) = EXTRACT(YEAR  FROM NOW())
     GROUP BY tipo`,
    [perfil.id]
  );

  return res({
    saldo:   perfil.monedas,
    historial,
    pagina,
    total_registros: Number(totalRows[0].total),
    resumen_mes: resumenMes,
  });
}

// ============================================
// 2. POST — Gastar monedas
// ============================================
async function gastar(clerkId, body) {
  const { monto, concepto } = body;
  if (!monto || !concepto) return resError('Faltan campos: monto, concepto');
  if (monto <= 0)          return resError('El monto debe ser mayor a 0');

  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  try {
    await gastarMonedas(perfil.id, monto, concepto);
  } catch (err) {
    return resError(err.message, 400);
  }

  // Leer saldo actualizado
  const rows   = await query('SELECT monedas FROM perfiles WHERE id = $1', [perfil.id]);
  const saldo  = rows[0]?.monedas ?? 0;

  return res({ ok: true, saldo_anterior: perfil.monedas, saldo_actual: saldo, gastado: monto });
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  const url = new URL(request.url);

  if (request.method === 'GET') return getSaldo(auth.clerkId, url);

  if (request.method === 'POST') {
    const body = await request.json();
    if (body.action === 'gastar') return gastar(auth.clerkId, body);
    return resError('Acción no reconocida');
  }

  return resError('Método no permitido', 405);
}
