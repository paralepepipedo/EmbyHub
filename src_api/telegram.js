// ============================================
// Api/telegram.js
// GET  /api/telegram          → genera código de vinculación
// POST /api/telegram          → webhook del bot (recibe mensajes)
// VERSIÓN: v1.0
// ============================================

import { query, res, resError, verificarAuth } from '../lib/neon.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Helper: enviar mensaje a Telegram ────────
async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  });
}

// ── Helper: generar código de 6 dígitos único ─
function generarCodigo() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export default async function handler(request) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

  // ============================================
  // GET — Generar código de vinculación
  // El alumno presiona "Conectar Telegram" y
  // obtiene un código de 6 dígitos válido 30 min
  // ============================================
  if (request.method === 'GET') {
    const auth = await verificarAuth(request);
    if (!auth.ok) return resError('No autorizado', 401);

    // Obtener perfil
    const perfilRows = await query(
      'SELECT id FROM perfiles WHERE clerk_id = $1',
      [auth.clerkId]
    );
    if (!perfilRows[0]) return resError('Perfil no encontrado', 404);
    const userId = perfilRows[0].id;

    // Invalidar códigos anteriores del usuario
    await query(
      'UPDATE telegram_codigos SET usado = true WHERE user_id = $1 AND usado = false',
      [userId]
    );

    // Generar nuevo código único
    let codigo;
    let intentos = 0;
    do {
      codigo = generarCodigo();
      const existe = await query(
        'SELECT id FROM telegram_codigos WHERE codigo = $1 AND usado = false AND expires_at > NOW()',
        [codigo]
      );
      if (existe.length === 0) break;
      intentos++;
    } while (intentos < 10);

    await query(
      `INSERT INTO telegram_codigos (user_id, codigo)
       VALUES ($1, $2)`,
      [userId, codigo]
    );

    return res({ codigo, expira_en_minutos: 30 });
  }

  // ============================================
  // POST — Webhook del bot de Telegram
  // Telegram llama a este endpoint cuando un
  // alumno le escribe al bot
  // ============================================
  if (request.method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return res({ ok: true }); }

    const message = body?.message;
    if (!message) return res({ ok: true });

    const chatId  = message.chat?.id;
    const texto   = (message.text || '').trim();
    const nombre  = message.from?.first_name || 'Alumno';

    if (!chatId) return res({ ok: true });

    // Comando /start
    if (texto === '/start' || texto.startsWith('/start')) {
      await sendMessage(chatId,
        `👋 ¡Hola ${nombre}! Soy el bot de <b>EduCoins</b> 🪙\n\n` +
        `Para conectar tu cuenta:\n` +
        `1️⃣ Ve a tu perfil en EduCoins\n` +
        `2️⃣ Presiona <b>"Conectar Telegram"</b>\n` +
        `3️⃣ Copia el código de 6 dígitos que aparece\n` +
        `4️⃣ Envíamelo aquí\n\n` +
        `¡Recibirás alertas de evaluaciones, tareas y tu racha! 🔥`
      );
      return res({ ok: true });
    }

    // Verificar si es un código de 6 dígitos
    if (/^\d{6}$/.test(texto)) {
      const codigoRows = await query(
        `SELECT tc.id, tc.user_id, p.nombre
         FROM telegram_codigos tc
         JOIN perfiles p ON p.id = tc.user_id
         WHERE tc.codigo = $1
           AND tc.usado = false
           AND tc.expires_at > NOW()`,
        [texto]
      );

      if (codigoRows.length === 0) {
        await sendMessage(chatId,
          `❌ Código inválido o expirado.\n\n` +
          `Ve a tu perfil en EduCoins y genera un nuevo código.`
        );
        return res({ ok: true });
      }

      const { id: codigoId, user_id: userId, nombre: nombreAlumno } = codigoRows[0];

      // Marcar código como usado y guardar chat_id en perfil
      await query('UPDATE telegram_codigos SET usado = true WHERE id = $1', [codigoId]);
      await query(
        'UPDATE perfiles SET telegram_chat_id = $1 WHERE id = $2',
        [String(chatId), userId]
      );

      await sendMessage(chatId,
        `✅ ¡Cuenta vinculada exitosamente, ${nombreAlumno}!\n\n` +
        `🔔 A partir de ahora recibirás alertas de:\n` +
        `📅 Evaluaciones próximas\n` +
        `📝 Tareas calificadas\n` +
        `🔥 Recordatorios de racha\n` +
        `🎯 Misiones por vencer`
      );

      return res({ ok: true });
    }

    // Mensaje no reconocido
    await sendMessage(chatId,
      `No entendí ese mensaje 😅\n\n` +
      `Envíame tu código de 6 dígitos para vincular tu cuenta, ` +
      `o escribe /start para ver las instrucciones.`
    );

    return res({ ok: true });
  }

  return resError('Método no permitido', 405);
}
