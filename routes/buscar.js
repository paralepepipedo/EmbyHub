// ============================================================
// RUTA: routes/buscar.js
// VERSIÓN: v1.0
// Rutas de búsqueda en fuentes locales: Neon y Emby
// Se monta en server.js como /api/buscar
// ============================================================

const express = require('express');
const router  = express.Router();
const db      = require('../lib/db');
const emby    = require('../lib/emby');
const { isAuth } = require('./auth');

// ── BUSCAR EN NEON — watchlist (películas y series) ──────────
// GET /api/buscar/neon/media?q=batman&tipo=movie
router.get('/neon/media', isAuth, async (req, res) => {
  try {
    const { q, tipo } = req.query;
    if (!q) return res.json([]);

    let query = `
      SELECT tmdb_id, tipo, titulo, titulo_original, poster_url, año, estado, emby_item_id
      FROM watchlist
      WHERE perfil_id = $1
        AND (LOWER(titulo) LIKE $2 OR LOWER(titulo_original) LIKE $2)
    `;
    const params = [req.session.perfil.id, `%${q.toLowerCase()}%`];

    if (tipo && tipo !== 'all') {
      query += ` AND tipo = $3`;
      params.push(tipo);
    }

    query += ` ORDER BY fecha_agregado DESC LIMIT 50`;

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (e) {
    console.error('[buscar/neon/media]', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── BUSCAR EN NEON — juegos ───────────────────────────────────
// GET /api/buscar/neon/juegos?q=batman
router.get('/neon/juegos', isAuth, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);

    const { rows } = await db.query(`
      SELECT id, titulo, cover_url, año, estado, desarrollador, generos
      FROM juegos
      WHERE perfil_id = $1
        AND (LOWER(titulo) LIKE $2 OR LOWER(titulo_original) LIKE $2)
      ORDER BY titulo ASC
      LIMIT 50
    `, [req.session.perfil.id, `%${q.toLowerCase()}%`]);

    res.json(rows);
  } catch (e) {
    console.error('[buscar/neon/juegos]', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── BUSCAR EN EMBY ────────────────────────────────────────────
// GET /api/buscar/emby?q=batman&tipo=movie
router.get('/emby', isAuth, async (req, res) => {
  try {
    const { q, tipo } = req.query;
    if (!q) return res.json([]);

    const BASE = process.env.EMBY_BASE_URL;
    const KEY  = process.env.EMBY_API_KEY;

    const params = new URLSearchParams({
      SearchTerm: q,
      Recursive:  'true',
      Fields:     'ProviderIds,ProductionYear,ImageTags',
      Limit:      50,
    });

    if (tipo === 'movie') params.set('IncludeItemTypes', 'Movie');
    else if (tipo === 'tv') params.set('IncludeItemTypes', 'Series');
    else params.set('IncludeItemTypes', 'Movie,Series');

    const url = `${BASE}/Items?${params}`;
    const embyRes = await fetch(url, {
      headers: { 'X-Emby-Token': KEY, 'Content-Type': 'application/json' }
    });

    if (!embyRes.ok) throw new Error(`Emby HTTP ${embyRes.status}`);
    const data = await embyRes.json();
    res.json(data.Items || []);

  } catch (e) {
    console.error('[buscar/emby]', e.message);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
