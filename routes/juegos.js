// ============================================================
// RUTA: routes/juegos.js
// VERSIÓN: v2.1
// CAMBIOS:
//   - Nueva ruta PUT /:id/metadata para actualizar datos IGDB
//     de un juego existente (cover, año, descripcion, generos,
//     plataformas, desarrollador, igdb_id)
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const igdb = require('../lib/igdb');
const { isAuth } = require('./auth');

// Listar juegos del perfil
router.get('/lista', isAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM juegos WHERE perfil_id = $1 ORDER BY estado, titulo ASC`,
      [req.session.perfil.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Buscar juegos en IGDB
router.get('/buscar', isAuth, async (req, res) => {
  try {
    const items = await igdb.buscarJuegos(req.query.q);
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Próximos estrenos desde IGDB
router.get('/proximos', isAuth, async (req, res) => {
  try {
    const items = await igdb.proximosEstrenos();
    res.json(items);
  } catch (e) {
    console.error('[/proximos]', e.message);
    res.json([]);
  }
});

// Detalle de un juego IGDB
router.get('/detalle/:id', isAuth, async (req, res) => {
  try {
    const data = await igdb.detalleJuego(req.params.id);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agregar juego a biblioteca
router.post('/', isAuth, async (req, res) => {
  const {
    igdb_id, titulo, cover_url, descripcion,
    generos, plataformas, desarrollador, año,
    estado, notas_personales,
  } = req.body;

  if (!titulo) return res.status(400).json({ error: 'Falta el título' });

  try {
    await db.query(`
      INSERT INTO juegos
        (perfil_id, igdb_id, titulo, cover_url, descripcion,
         generos, plataformas, desarrollador, año, estado, notas_personales)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    `, [
      req.session.perfil.id, igdb_id, titulo, cover_url,
      descripcion, generos || [], plataformas || [],
      desarrollador, año, estado || 'deseado', notas_personales || '',
    ]);
    res.json({ success: true });
  } catch (e) {
    console.error('[POST /juegos]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Actualizar estado y notas
router.put('/:id', isAuth, async (req, res) => {
  const { estado, notas_personales } = req.body;
  try {
    await db.query(`
      UPDATE juegos
      SET estado = $1, notas_personales = $2, fecha_actualizado = now()
      WHERE id = $3 AND perfil_id = $4
    `, [estado, notas_personales, req.params.id, req.session.perfil.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Actualizar metadata desde IGDB (cover, año, descripcion, etc.)
router.put('/:id/metadata', isAuth, async (req, res) => {
  const { igdb_id, cover_url, descripcion, generos, plataformas, desarrollador, año } = req.body;
  try {
    await db.query(`
      UPDATE juegos SET
        igdb_id       = COALESCE($1, igdb_id),
        cover_url     = COALESCE($2, cover_url),
        descripcion   = COALESCE($3, descripcion),
        generos       = COALESCE($4, generos),
        plataformas   = COALESCE($5, plataformas),
        desarrollador = COALESCE($6, desarrollador),
        año           = COALESCE($7, año),
        fecha_actualizado = now()
      WHERE id = $8 AND perfil_id = $9
    `, [igdb_id, cover_url, descripcion, generos, plataformas, desarrollador, año,
      req.params.id, req.session.perfil.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[PUT /juegos/metadata]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Eliminar juego
router.delete('/:id', isAuth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM juegos WHERE id = $1 AND perfil_id = $2',
      [req.params.id, req.session.perfil.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;