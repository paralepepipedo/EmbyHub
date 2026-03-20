// ============================================
// api/alertas.js — Disparar alertas Telegram
// GET /api/alertas?cron_secret=xxx  ← cron job
// POST /api/alertas { action: 'mi_alerta' } ← usuario
// ============================================

import { query, res, resError, verificarAuth } from '../lib/neon.js';
import { enviarAlertaEvaluacion, debeAlertarse } from '../lib/telegram.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  // ── CRON JOB (sin auth de Clerk, usa secret propio) ──
  if (request.method === 'GET') {
    const url    = new URL(request.url);
    const secret = url.searchParams.get('cron_secret');
    if (secret !== process.env.CRON_SECRET) {
      return resError('No autorizado', 401);
    }
    return ejecutarCronAlertas();
  }

  // ── USUARIO: verificar alertas propias ──
  const auth = await verificarAuth(request);
  if (!auth.ok) return resError('No autorizado', 401);

  const body = await request.json().catch(() => ({}));
  if (body.action === 'mi_alerta') {
    return alertasUsuario(auth.clerkId);
  }

  return resError('Acción no reconocida');
}

// Ejecutar alertas para TODOS los usuarios (cron)
async function ejecutarCronAlertas() {
  const evaluaciones = await query(`
    SELECT e.*, p.nombre, p.telegram_chat_id
    FROM evaluaciones e
    JOIN perfiles p ON p.id = e.user_id
    WHERE e.estado IN ('pendiente', 'estudiado')
      AND p.telegram_chat_id IS NOT NULL
      AND e.fecha_evaluacion >= CURRENT_DATE
      AND e.fecha_evaluacion <= CURRENT_DATE + INTERVAL '3 days'
  `);

  let enviadas = 0;
  for (const ev of evaluaciones) {
    if (!debeAlertarse(ev)) continue;
    const resultado = await enviarAlertaEvaluacion(ev, { nombre: ev.nombre, telegram_chat_id: ev.telegram_chat_id });
    if (resultado.ok) {
      enviadas++;
      await query(
        `UPDATE evaluaciones SET alerta_enviada_at = NOW() WHERE id = $1`,
        [ev.id]
      );
    }
    await new Promise(r => setTimeout(r, 300));
  }

  return res({ ok: true, alertas_enviadas: enviadas, total_evaluaciones: evaluaciones.length });
}

// Alertas del usuario actual
async function alertasUsuario(clerkId) {
  const rows = await query(
    `SELECT p.id, p.nombre, p.telegram_chat_id
     FROM perfiles p WHERE p.clerk_id = $1`,
    [clerkId]
  );
  const perfil = rows[0];
  if (!perfil) return resError('Perfil no encontrado', 404);

  const evaluaciones = await query(
    `SELECT * FROM evaluaciones
     WHERE user_id = $1
       AND estado IN ('pendiente','estudiado')
       AND fecha_evaluacion >= CURRENT_DATE
       AND fecha_evaluacion <= CURRENT_DATE + INTERVAL '3 days'`,
    [perfil.id]
  );

  let enviadas = 0;
  for (const ev of evaluaciones) {
    if (!debeAlertarse(ev)) continue;
    const r = await enviarAlertaEvaluacion(ev, perfil);
    if (r.ok) enviadas++;
  }

  return res({ ok: true, alertas_enviadas: enviadas });
}
