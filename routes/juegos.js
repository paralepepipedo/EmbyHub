// ============================================================
// RUTA: routes/juegos.js
// VERSIÓN: v3.0 — MyGameLib
// El módulo de juegos viejo (estados descargado/instalado/etc.,
// horas_jugadas, rating_personal) fue retirado. Este es el nuevo
// modelo: compatibilidad contra tu PC, FPS por calidad, requisitos,
// notas, capturas y próximos lanzamientos desde IGDB.
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const igdb = require('../lib/igdb');
const { isAuth } = require('./auth');

const ESTADOS = ['wishlist', 'pending', 'downloaded', 'playing', 'completed'];

// Specs de "Mi PC" del perfil — alimentan el prompt de análisis y las tarjetas de compatibilidad
router.get('/pc', isAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT pc_cpu, pc_gpu, pc_ram, pc_storage, pc_os, pc_resolucion FROM perfiles WHERE id = $1`,
      [req.session.perfil.id]
    );
    const p = rows[0] || {};
    res.json({
      cpu: p.pc_cpu || '', gpu: p.pc_gpu || '', ram: p.pc_ram || '',
      storage: p.pc_storage || '', os: p.pc_os || '', resolucion: p.pc_resolucion || '',
    });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.put('/pc', isAuth, async (req, res) => {
  const { cpu, gpu, ram, storage, os, resolucion } = req.body || {};
  try {
    await db.query(
      `UPDATE perfiles SET pc_cpu=$1, pc_gpu=$2, pc_ram=$3, pc_storage=$4, pc_os=$5, pc_resolucion=$6, actualizado_en=now() WHERE id=$7`,
      [cpu || '', gpu || '', ram || '', storage || '', os || '', resolucion || '', req.session.perfil.id]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

function toRow(g) {
  return {
    id: g.id,
    name: g.titulo,
    year: g.año,
    genre: g.genero_texto || '',
    developer: g.desarrollador || '',
    compatibility: g.compatibilidad || 'warn',
    recommendedQuality: g.calidad_recomendada || '',
    fps: g.fps || { ultra: 'N/A', high: 'N/A', medium: 'N/A', low: 'N/A' },
    requirements: g.requisitos || { min: {}, rec: {} },
    recommendation: g.recomendacion || '',
    notes: g.notas || [],
    status: ESTADOS.includes(g.estado) ? g.estado : 'wishlist',
    image: g.cover_url || '',
    screenshots: g.screenshots || [],
    youtubeLink: g.youtube_link || '',
    steamLink: g.steam_link || '',
    storageGB: g.tamaño_gb != null ? Number(g.tamaño_gb) : 0,
    requiresSSD: !!g.requiere_ssd,
    igdbId: g.igdb_id || null,
    addedAt: g.fecha_agregado,
  };
}

// Listar juegos del perfil (todo el estado de la biblioteca en un solo GET)
router.get('/lista', isAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM juegos WHERE perfil_id = $1 ORDER BY fecha_agregado ASC`,
      [req.session.perfil.id]
    );
    res.json({ games: rows.map(toRow) });
  } catch (e) {
    console.error('[GET /juegos/lista]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Crear juego (manual, IGDB o parser de Claude — el cliente ya normalizó los campos)
router.post('/', isAuth, async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'Falta el nombre' });
  try {
    const { rows } = await db.query(`
      INSERT INTO juegos
        (perfil_id, igdb_id, titulo, cover_url, genero_texto, desarrollador, año,
         compatibilidad, calidad_recomendada, fps, requisitos, recomendacion, notas,
         estado, youtube_link, steam_link, tamaño_gb, requiere_ssd, screenshots,
         fecha_agregado, fecha_actualizado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19, now(), now())
      RETURNING *
    `, [
      req.session.perfil.id, b.igdbId || null, b.name, b.image || null,
      b.genre || null, b.developer || null, b.year || null,
      b.compatibility || 'warn', b.recommendedQuality || null,
      JSON.stringify(b.fps || {}), JSON.stringify(b.requirements || {}),
      b.recommendation || null, JSON.stringify(b.notes || []),
      ESTADOS.includes(b.status) ? b.status : 'wishlist',
      b.youtubeLink || null, b.steamLink || null, b.storageGB || null,
      !!b.requiresSSD, b.screenshots || [],
    ]);
    res.json({ game: toRow(rows[0]) });
  } catch (e) {
    console.error('[POST /juegos]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Actualizar juego (edición completa desde el modal)
router.put('/:id', isAuth, async (req, res) => {
  const b = req.body || {};
  try {
    const { rows } = await db.query(`
      UPDATE juegos SET
        igdb_id = $1, titulo = $2, cover_url = $3, genero_texto = $4, desarrollador = $5, año = $6,
        compatibilidad = $7, calidad_recomendada = $8, fps = $9, requisitos = $10,
        recomendacion = $11, notas = $12, estado = $13, youtube_link = $14, steam_link = $15,
        tamaño_gb = $16, requiere_ssd = $17, screenshots = $18, fecha_actualizado = now()
      WHERE id = $19 AND perfil_id = $20
      RETURNING *
    `, [
      b.igdbId || null, b.name, b.image || null, b.genre || null, b.developer || null, b.year || null,
      b.compatibility || 'warn', b.recommendedQuality || null,
      JSON.stringify(b.fps || {}), JSON.stringify(b.requirements || {}),
      b.recommendation || null, JSON.stringify(b.notes || []),
      ESTADOS.includes(b.status) ? b.status : 'wishlist',
      b.youtubeLink || null, b.steamLink || null, b.storageGB || null,
      !!b.requiresSSD, b.screenshots || [],
      req.params.id, req.session.perfil.id,
    ]);
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
    res.json({ game: toRow(rows[0]) });
  } catch (e) {
    console.error('[PUT /juegos/:id]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Cambio rápido de estado (botones del panel de detalle) e imagen/capturas (selector IGDB)
router.patch('/:id', isAuth, async (req, res) => {
  const sets = [];
  const vals = [];
  let i = 1;
  const map = {
    status: ['estado', v => (ESTADOS.includes(v) ? v : 'wishlist')],
    image: ['cover_url', v => v],
    screenshots: ['screenshots', v => v],
    youtubeLink: ['youtube_link', v => v],
    steamLink: ['steam_link', v => v],
    year: ['año', v => v],
    genre: ['genero_texto', v => v],
    developer: ['desarrollador', v => v],
  };
  for (const [key, [col, fn]] of Object.entries(map)) {
    if (req.body[key] !== undefined) { sets.push(`${col} = $${i++}`); vals.push(fn(req.body[key])); }
  }
  if (!sets.length) return res.status(400).json({ error: 'Nada que actualizar' });
  vals.push(req.params.id, req.session.perfil.id);
  try {
    const { rows } = await db.query(
      `UPDATE juegos SET ${sets.join(', ')}, fecha_actualizado = now() WHERE id = $${i++} AND perfil_id = $${i} RETURNING *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
    res.json({ game: toRow(rows[0]) });
  } catch (e) {
    console.error('[PATCH /juegos/:id]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Eliminar juego
router.delete('/:id', isAuth, async (req, res) => {
  try {
    await db.query('DELETE FROM juegos WHERE id = $1 AND perfil_id = $2', [req.params.id, req.session.perfil.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /juegos/:id]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Buscar juegos en IGDB (Método B del modal de agregar)
router.get('/buscar', isAuth, async (req, res) => {
  try {
    const items = await igdb.buscarJuegos(req.query.q || '');
    res.json(items.map(x => ({
      id: x.id,
      name: x.name,
      year: x.first_release_date ? new Date(x.first_release_date * 1000).getUTCFullYear() : null,
      genre: (x.genres || []).map(g => g.name).join(' / '),
      developer: (x.involved_companies || []).find(c => c.developer)?.company?.name || '',
      image: igdb.coverUrl(x.cover?.url) || '',
      shots: (x.screenshots || []).map(s => igdb.coverUrl(s.url)).filter(Boolean).slice(0, 12),
    })));
  } catch (e) {
    console.error('[GET /juegos/buscar]', e);
    res.status(500).json({ error: e.message });
  }
});

// Próximos estrenos, paginado (scroll infinito en el cliente)
router.get('/proximos', isAuth, async (req, res) => {
  try {
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const items = await igdb.proximosEstrenos(offset, 24);
    res.json(items.map(x => ({
      id: x.id,
      name: x.name,
      date: x.first_release_date || null,
      hypes: x.hypes || 0,
      genre: (x.genres || []).map(g => g.name).slice(0, 2).join(' / '),
      platforms: (x.platforms || []).map(p => p.name).slice(0, 3).join(' · '),
      image: igdb.coverUrl(x.cover?.url) || '',
      shots: (x.screenshots || []).map(s => igdb.coverUrl(s.url)).filter(Boolean),
    })));
  } catch (e) {
    console.error('[GET /juegos/proximos]', e.message);
    res.json([]);
  }
});

module.exports = router;
