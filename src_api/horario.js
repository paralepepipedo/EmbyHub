// ============================================
// api/horario.js
//
// GET  /api/horario?colegio_id=X&grado=Y
//   → Retorna horario completo + config de bloques
//   → PÚBLICO: no requiere auth (invitados pueden ver)
//
// PUT  /api/horario
//   → Actualizar celda de asignatura o rango horario
//   → PRIVADO: solo admin
// ============================================

import { query, res, resError, verificarAuth } from '../lib/neon.js';

export default async function handler(request) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  // ============================================
  // GET — Leer horario completo (público)
  // ============================================
  if (request.method === 'GET') {
    const url        = new URL(request.url);
    const colegio_id = url.searchParams.get('colegio_id');
    const grado      = parseInt(url.searchParams.get('grado'));

    if (!colegio_id || !grado || grado < 1 || grado > 8) {
      return resError('Parámetros requeridos: colegio_id, grado (1-8)', 400);
    }

    // Verificar que el colegio existe y está activo
    const colegio = await query(
      'SELECT id, nombre, comuna, region FROM colegios WHERE id = $1 AND activo = true',
      [colegio_id]
    );
    if (colegio.length === 0) {
      return resError('Colegio no encontrado', 404);
    }

    // Obtener celdas del horario (asignaturas por día y bloque)
    const celdas = await query(
      `SELECT dia_semana, bloque, asignatura
       FROM horarios
       WHERE colegio_id = $1 AND grado = $2
       ORDER BY dia_semana, bloque`,
      [colegio_id, grado]
    );

    // Obtener config de bloques (rangos horarios)
    const bloques = await query(
      `SELECT bloque, hora_lj, hora_v
       FROM horarios_config
       WHERE colegio_id = $1
       ORDER BY bloque`,
      [colegio_id]
    );

    // Construir matriz dia[1-5] -> bloque[1-8] -> asignatura
    // para que el frontend pueda acceder fácilmente
    const matriz = {};
    for (let dia = 1; dia <= 5; dia++) {
      matriz[dia] = {};
      for (let blq = 1; blq <= 8; blq++) {
        matriz[dia][blq] = null;
      }
    }
    celdas.forEach(function(c) {
      matriz[c.dia_semana][c.bloque] = c.asignatura;
    });

    return res({
      colegio:  colegio[0],
      grado,
      matriz,   // matriz[dia][bloque] = 'Matematicas' | null
      bloques,  // [{bloque:1, hora_lj:'08:00-08:45', hora_v:'08:00-08:45'}, ...]
    });
  }

  // ============================================
  // PUT — Editar horario (solo admin)
  // ============================================
  if (request.method === 'PUT') {
    const auth = await verificarAuth(request);
    if (!auth.ok) return resError('No autorizado', 401);

    // Verificar rol admin
    const perfil = await query(
      'SELECT rol FROM perfiles WHERE clerk_id = $1',
      [auth.clerkId]
    );
    if (!perfil.length || perfil[0].rol !== 'admin') {
      return resError('Solo los administradores pueden editar el horario', 403);
    }

    const body = await request.json();
    const { accion } = body;

    // ── Editar asignatura de una celda ──
    if (accion === 'celda') {
      const { colegio_id, grado, dia_semana, bloque, asignatura } = body;

      if (!colegio_id || !grado || !dia_semana || !bloque) {
        return resError('Faltan campos: colegio_id, grado, dia_semana, bloque', 400);
      }

      if (asignatura === null || asignatura === '') {
        // Borrar la celda
        await query(
          `DELETE FROM horarios
           WHERE colegio_id = $1 AND grado = $2
             AND dia_semana = $3 AND bloque = $4`,
          [colegio_id, grado, dia_semana, bloque]
        );
      } else {
        // Upsert — insertar o actualizar
        await query(
          `INSERT INTO horarios (colegio_id, grado, dia_semana, bloque, asignatura, created_by)
           VALUES ($1, $2, $3, $4, $5, (SELECT id FROM perfiles WHERE clerk_id = $6))
           ON CONFLICT (colegio_id, grado, dia_semana, bloque)
           DO UPDATE SET asignatura = EXCLUDED.asignatura,
                         updated_at = NOW()`,
          [colegio_id, grado, dia_semana, bloque, asignatura, auth.clerkId]
        );
      }

      return res({ ok: true, accion: 'celda', dia_semana, bloque, asignatura });
    }

    // ── Editar rango horario de un bloque ──
    if (accion === 'bloque') {
      const { colegio_id, bloque, hora_lj, hora_v } = body;

      if (!colegio_id || !bloque) {
        return resError('Faltan campos: colegio_id, bloque', 400);
      }

      // Validar formato HH:MM-HH:MM (flexible — puede estar vacío para V en blq 7-8)
      const formatoValido = /^\d{2}:\d{2}-\d{2}:\d{2}$|^$/;
      if (hora_lj !== undefined && !formatoValido.test(hora_lj)) {
        return resError('Formato inválido para hora_lj. Usar HH:MM-HH:MM', 400);
      }
      if (hora_v !== undefined && !formatoValido.test(hora_v)) {
        return resError('Formato inválido para hora_v. Usar HH:MM-HH:MM o vacío', 400);
      }

      await query(
        `UPDATE horarios_config
         SET hora_lj    = COALESCE($1, hora_lj),
             hora_v     = COALESCE($2, hora_v),
             updated_at = NOW()
         WHERE colegio_id = $3 AND bloque = $4`,
        [hora_lj ?? null, hora_v ?? null, colegio_id, bloque]
      );

      return res({ ok: true, accion: 'bloque', bloque, hora_lj, hora_v });
    }

    return resError('accion debe ser "celda" o "bloque"', 400);
  }

  return resError('Método no permitido', 405);
}
