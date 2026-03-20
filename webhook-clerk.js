// ============================================
// api/webhook-clerk.js
//
// Clerk llama a este endpoint automáticamente
// cuando ocurren eventos: usuario creado,
// actualizado, eliminado, etc.
//
// CONFIGURACIÓN (lo haces una sola vez):
//   1. Ir a dashboard.clerk.com
//   2. Configure → Webhooks → Add endpoint
//   3. URL: https://tuapp.vercel.app/api/webhook-clerk
//   4. Events: marcar "user.created"
//   5. Copiar el "Signing Secret" que te da Clerk
//   6. Pegarlo en tu .env como CLERK_WEBHOOK_SECRET
//
// LO QUE HACE:
//   Cuando un alumno se registra en Clerk,
//   este endpoint crea automáticamente su fila
//   en la tabla `perfiles` de Neon con valores
//   iniciales (nivel 1, 0 monedas, etc.)
// ============================================

import { query, resError } from '../lib/neon.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(request) {
  // Solo acepta POST
  if (request.method !== 'POST') {
    return new Response(null, { status: 405 });
  }

  // ——————————————————————————————————————————
  // 1. Verificar firma del webhook
  //
  // Clerk firma cada webhook con HMAC-SHA256.
  // Si no verificamos la firma, cualquiera
  // podría mandar requests falsos a esta URL.
  // ——————————————————————————————————————————
  const svix_id        = request.headers.get('svix-id');
  const svix_timestamp = request.headers.get('svix-timestamp');
  const svix_signature = request.headers.get('svix-signature');

  if (!svix_id || !svix_timestamp || !svix_signature) {
    return resError('Webhook inválido — faltan headers Svix', 400);
  }

  // Leer el body como texto (necesario para verificar firma)
  const body = await request.text();

  // Verificar la firma manualmente con crypto
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET || '';
  if (!webhookSecret) {
    console.error('[webhook] Falta CLERK_WEBHOOK_SECRET en .env');
    return resError('Configuración incompleta', 500);
  }

  const esValido = await verificarFirmaWebhook(
    body, svix_id, svix_timestamp, svix_signature, webhookSecret
  );

  if (!esValido) {
    return resError('Firma de webhook inválida', 401);
  }

  // ——————————————————————————————————————————
  // 2. Procesar el evento
  // ——————————————————————————————————————————
  const evento = JSON.parse(body);

  if (evento.type === 'user.created') {
    await crearPerfil(evento.data);
  }

  if (evento.type === 'user.deleted') {
    await eliminarPerfil(evento.data.id);
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ——————————————————————————————————————————
// Crear perfil en Neon al registrarse
// ——————————————————————————————————————————
async function crearPerfil(data) {
  const clerkId  = data.id;
  const username = data.username || data.first_name || 'Alumno' + Date.now();
  const email    = data.email_addresses?.[0]?.email_address || '';

  // Verificar si ya existe (idempotencia)
  const existe = await query(
    'SELECT id FROM perfiles WHERE clerk_id = $1',
    [clerkId]
  );
  if (existe.length > 0) return;

  // Insertar perfil inicial
  await query(`
    INSERT INTO perfiles (
      clerk_id, nombre, email,
      nivel, xp, monedas,
      energia_actual, energia_max,
      racha_actual, racha_max,
      categoria_rango, sub_rango,
      rol, activo,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3,
      1, 0, 0,
      100, 100,
      0, 0,
      'Novato', 'Bronce',
      'alumno', true,
      NOW(), NOW()
    )
  `, [clerkId, username, email]);

  console.log('[webhook] Perfil creado para:', username, '(' + clerkId + ')');
}

// ——————————————————————————————————————————
// Eliminar perfil cuando Clerk borra el usuario
// ——————————————————————————————————————————
async function eliminarPerfil(clerkId) {
  await query(
    'UPDATE perfiles SET activo = false WHERE clerk_id = $1',
    [clerkId]
  );
  console.log('[webhook] Perfil desactivado para clerkId:', clerkId);
}

// ——————————————————————————————————————————
// Verificar firma HMAC-SHA256 del webhook
// Implementación manual con Web Crypto API
// (disponible en Vercel Edge Runtime)
// ——————————————————————————————————————————
async function verificarFirmaWebhook(body, svixId, svixTimestamp, svixSignature, secret) {
  try {
    // El mensaje que firmó Clerk es: id.timestamp.body
    const mensaje = svixId + '.' + svixTimestamp + '.' + body;

    // Decodificar el secret (viene en base64 sin el prefijo "whsec_")
    const secretLimpio = secret.replace('whsec_', '');
    const secretBytes  = Uint8Array.from(atob(secretLimpio), c => c.charCodeAt(0));

    // Importar la clave
    const clave = await crypto.subtle.importKey(
      'raw', secretBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['verify']
    );

    // Firmar el mensaje
    const mensajeBytes = new TextEncoder().encode(mensaje);
    const firmaBytes   = await crypto.subtle.sign('HMAC', clave, mensajeBytes);
    const firmaBase64  = btoa(String.fromCharCode(...new Uint8Array(firmaBytes)));

    // Comparar con la firma que mandó Clerk
    // svix_signature puede tener múltiples firmas separadas por espacio
    const firmasRecibidas = svixSignature.split(' ').map(f => f.replace('v1,', ''));
    return firmasRecibidas.includes(firmaBase64);

  } catch (err) {
    console.error('[webhook] Error verificando firma:', err);
    return false;
  }
}
