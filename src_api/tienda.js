// ============================================
// api/tienda.js — Tienda de EduCoins
// GET  /api/tienda                         → listar ítems + estado de compra
// GET  /api/tienda?action=inventario       → inventario del alumno
// POST /api/tienda { action:'comprar', item_id, cantidad? } → comprar ítem
// POST /api/tienda { action:'activar', inventario_id }      → activar boost
// ============================================

import {
  query, getPerfil, gastarMonedas,
  res, resError, verificarAuth
} from '../lib/neon.js';

// ============================================
// GET — Listar ítems con estado de compra
// ============================================
async function listarItems(clerkId) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const items = await query(
    `SELECT * FROM tienda_items WHERE disponible = TRUE ORDER BY orden ASC, created_at ASC`
  );

  // Ítems comprados (solo los no repetibles cuentan como "ya comprado")
  const compras = await query(
    `SELECT item_id FROM tienda_inventario WHERE user_id = $1`,
    [perfil.id]
  );
  const compradosSet = new Set(compras.map(c => c.item_id));

  const itemsConEstado = items.map(function (item) {
    const yaComprado = compradosSet.has(item.id) && !item.compra_repetida;
    const sinStock = item.stock !== null && (item.stock - (item.stock_usado || 0)) <= 0;
    return {
      ...item,
      comprado: yaComprado,
      puede_comprar: !yaComprado && !sinStock && perfil.monedas >= item.precio,
    };
  });

  return res({
    items: itemsConEstado,
    saldo: perfil.monedas,
    nombre: perfil.nombre,
  });
}

// ============================================
// GET — Inventario del alumno
// ============================================
async function listarInventario(clerkId) {
  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  const rows = await query(
    `SELECT inv.*, 
            ti.nombre, ti.emoji, ti.tipo, ti.categoria,
            ti.descripcion, ti.imagen_url,
            ti.duracion_horas, ti.alcance, ti.multiplicador
     FROM tienda_inventario inv
     JOIN tienda_items ti ON ti.id = inv.item_id
     WHERE inv.user_id = $1
     ORDER BY inv.created_at DESC`,
    [perfil.id]
  );

  return res({ inventario: rows });
}

// ============================================
// POST — Comprar ítem
// ============================================
async function comprar(clerkId, body) {
  const { item_id, cantidad } = body;
  if (!item_id) return resError('Falta item_id');
  const cant = Math.max(1, parseInt(cantidad) || 1);

  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  // Verificar ítem
  const itemRows = await query(
    `SELECT * FROM tienda_items WHERE id = $1 AND disponible = TRUE`,
    [item_id]
  );
  const item = itemRows[0];
  if (!item) return resError('Ítem no encontrado o no disponible', 404);

  // Verificar duplicado solo si NO es compra_repetida
  if (!item.compra_repetida) {
    const yaCompro = await query(
      `SELECT id FROM tienda_inventario WHERE user_id = $1 AND item_id = $2`,
      [perfil.id, item_id]
    );
    if (yaCompro.length > 0) return resError('Ya tienes este ítem', 409);
  }

  // Verificar stock
  if (item.stock !== null) {
    const restante = item.stock - (item.stock_usado || 0);
    if (restante < cant) return resError('Stock insuficiente', 400);
  }

  const totalPrecio = item.precio * cant;

  // Verificar saldo
  if (perfil.monedas < totalPrecio) {
    return resError('Saldo insuficiente', 400);
  }

  // Descontar monedas
  await gastarMonedas(perfil.id, totalPrecio,
    `Compra tienda: ${cant > 1 ? cant + 'x ' : ''}${item.nombre}`);

  // Actualizar stock_usado si aplica
  if (item.stock !== null) {
    await query(
      `UPDATE tienda_items SET stock_usado = stock_usado + $1 WHERE id = $2`,
      [cant, item_id]
    );
  }

  // Insertar en tienda_inventario (una fila por unidad)
  for (let i = 0; i < cant; i++) {
    await query(
      `INSERT INTO tienda_inventario
        (user_id, item_id, origen, estado, precio_pagado)
       VALUES ($1, $2, 'compra', 'inactivo', $3)`,
      [perfil.id, item_id, item.precio]
    );
  }

  // ─── TELEGRAM: notificar al admin cuando se compra un ítem canjeable ───
  // Pendiente de configurar — activar cuando se despliegue en Vercel:
  // const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN; // '8617578510:AAEZUO-siYqpQmx9j8fI-nvFQhMoZa_YLEo'
  // const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;   // Envía /start al bot t.me/Educoin_web_Bot y copia el chat_id
  // if (item.tipo === 'canjeable' && TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
  //   const msg = [
  //     '🔔 *EduCoins · Canje pendiente*',
  //     `👤 Alumno: ${perfil.nombre}`,
  //     `🎁 Ítem: ${item.emoji || ''} ${item.nombre}`,
  //     `💰 Pagó: ${(item.precio * cant).toLocaleString('es-CL')} EC`,
  //     cant > 1 ? `📦 Cantidad: ${cant}` : '',
  //     `🕐 ${new Date().toLocaleString('es-CL')}`,
  //   ].filter(Boolean).join('\n');
  //   fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
  //     method: 'POST',
  //     headers: { 'Content-Type': 'application/json' },
  //     body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: msg, parse_mode: 'Markdown' })
  //   }).catch(() => {}); // no bloquear la compra si Telegram falla
  // }
  // ───────────────────────────────────────────────────────────────────────

  // Saldo actualizado
  const perfilActualizado = await query(
    `SELECT monedas FROM perfiles WHERE id = $1`,
    [perfil.id]
  );

  return res({
    ok: true,
    item_comprado: item,
    cantidad: cant,
    saldo_nuevo: Number(perfilActualizado[0]?.monedas || 0),
    mensaje: `🎉 ¡Compraste ${cant > 1 ? cant + '× ' : ''}${item.emoji} ${item.nombre}!`,
  });
}

// ============================================
// POST — Activar ítem del inventario (boosts)
// ============================================
async function activarItem(clerkId, body) {
  const { inventario_id } = body;
  if (!inventario_id) return resError('Falta inventario_id');

  const perfil = await getPerfil(clerkId);
  if (!perfil) return resError('Perfil no encontrado', 404);

  // Verificar que le pertenece y está inactivo
  const rows = await query(
    `SELECT inv.*, ti.duracion_horas, ti.tipo
     FROM tienda_inventario inv
     JOIN tienda_items ti ON ti.id = inv.item_id
     WHERE inv.id = $1 AND inv.user_id = $2`,
    [inventario_id, perfil.id]
  );
  const inv = rows[0];
  if (!inv) return resError('Ítem no encontrado en tu inventario', 404);
  if (inv.estado !== 'inactivo') return resError('Este ítem ya fue activado o usado', 409);
  if (inv.tipo !== 'activable') return resError('Este ítem no es activable', 400);

  const expira_at = inv.duracion_horas
    ? new Date(Date.now() + inv.duracion_horas * 3600000).toISOString()
    : null;

  await query(
    `UPDATE tienda_inventario
     SET estado = 'activo', activado_at = NOW(), expira_at = $1
     WHERE id = $2`,
    [expira_at, inventario_id]
  );

  return res({ ok: true, expira_at });
}

// ============================================
// HANDLER PRINCIPAL
// ============================================
export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');
    if (action === 'inventario') return listarInventario(auth.clerkId);
    return listarItems(auth.clerkId);
  }

  const body = await request.json();

  if (request.method === 'POST') {
    if (body.action === 'comprar') return comprar(auth.clerkId, body);
    if (body.action === 'activar') return activarItem(auth.clerkId, body);
    return resError('Acción no reconocida');
  }

  return resError('Método no permitido', 405);
}


// ============================================