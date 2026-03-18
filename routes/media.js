// ============================================================
// RUTA: routes/media.js
// VERSIÓN: v1.4
// CAMBIOS:
//   - Detalle usa getRatingsConFallback (OMDb → RapidAPI)
//   - Nueva ruta POST /ratings/manual para guardar rating manual
//   - La renovación de caché (7 días) sigue usando solo OMDb
// ============================================================

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const tmdb = require('../lib/tmdb');
const omdb = require('../lib/omdb');
const { getRatingsConFallback } = require('../lib/omdb');
const emby = require('../lib/emby');
const { isAuth } = require('./auth');

// ── Helpers ──────────────────────────────────────────────────

async function getExcluidos(perfilId) {
  const { rows } = await db.query(
    'SELECT generos_excluidos FROM perfil_config WHERE perfil_id = $1',
    [perfilId]
  );
  return rows.length ? rows[0].generos_excluidos.join(',') : '';
}

async function getIgnoradosIds(perfilId, tipo) {
  const { rows } = await db.query(
    'SELECT tmdb_id FROM ignorados WHERE perfil_id = $1 AND tipo = $2',
    [perfilId, tipo]
  );
  return new Set(rows.map(r => r.tmdb_id));
}

// ── PELÍCULAS ─────────────────────────────────────────────────

router.get('/peliculas/estrenos', isAuth, async (req, res) => {
  try {
    const excl = await getExcluidos(req.session.perfil.id);
    const ignorados = await getIgnoradosIds(req.session.perfil.id, 'movie');

    const [tmdbData, embyData] = await Promise.all([
      tmdb.proximosEstrenosPeliculas(excl, parseInt(req.query.page) || 1),
      emby.getItems({ tipo: 'movie', limit: 500 }),
    ]);

    const embyTmdbIds = new Set(
      (embyData.Items || [])
        .filter(i => i.ProviderIds?.Tmdb)
        .map(i => parseInt(i.ProviderIds.Tmdb))
    );

    const filtrados = (tmdbData.results || []).filter(i =>
      !ignorados.has(i.id) && !embyTmdbIds.has(i.id)
    );

    // Top 10 por popularidad, resto por fecha ascendente
    const top10 = [...filtrados].sort((a, b) => (b.popularity || 0) - (a.popularity || 0)).slice(0, 10);
    const top10Ids = new Set(top10.map(i => i.id));
    const resto = filtrados
      .filter(i => !top10Ids.has(i.id))
      .sort((a, b) => new Date(a.release_date) - new Date(b.release_date));

    res.json([...top10, ...resto]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/watchlist/:tipo', isAuth, async (req, res) => {
  try {
    const { tipo } = req.params;
    const { rows } = await db.query(
      `SELECT * FROM watchlist
       WHERE perfil_id = $1 AND tipo = $2 AND estado = 'pendiente'
       ORDER BY fecha_agregado DESC`,
      [req.session.perfil.id, tipo]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/emby/:tipo', isAuth, async (req, res) => {
  try {
    const embyType = req.params.tipo === 'movie' ? 'movie' : 'tv';
    const data = await emby.getItems({ tipo: embyType, limit: 30 });
    const items = data.Items || [];

    // Cruzar con TMDB para obtener poster_path
    const enriquecidos = await Promise.all(items.map(async (i) => {
      const tmdbId = i.ProviderIds?.Tmdb ? parseInt(i.ProviderIds.Tmdb) : null;
      let poster_path = null;

      if (tmdbId) {
        try {
          const detalle = embyType === 'movie'
            ? await tmdb.peliculaDetalle(tmdbId)
            : await tmdb.serieDetalle(tmdbId);
          poster_path = detalle?.poster_path || null;
        } catch (e) {
          // Si falla TMDB, continuar sin poster
        }
      }

      return { ...i, tmdb_poster_path: poster_path };
    }));

    res.json(enriquecidos);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── IGNORADOS ─────────────────────────────────────────────────

// Ignorar una película o serie
router.post('/ignorar', isAuth, async (req, res) => {
  const { tmdb_id, tipo, titulo } = req.body;
  if (!tmdb_id || !tipo) return res.status(400).json({ error: 'Faltan campos' });

  try {
    await db.query(`
      INSERT INTO ignorados (perfil_id, tmdb_id, tipo, titulo)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (perfil_id, tmdb_id, tipo) DO NOTHING
    `, [req.session.perfil.id, tmdb_id, tipo, titulo]);
    res.json({ success: true });
  } catch (e) {
    console.error('[POST /ignorar]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// Quitar un ignorado
router.delete('/ignorar/:tipo/:id', isAuth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM ignorados WHERE perfil_id = $1 AND tmdb_id = $2 AND tipo = $3',
      [req.session.perfil.id, req.params.id, req.params.tipo]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// Listar ignorados
router.get('/ignorar/:tipo', isAuth, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM ignorados WHERE perfil_id = $1 AND tipo = $2 ORDER BY fecha_agregado DESC',
      [req.session.perfil.id, req.params.tipo]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── RATINGS EN LOTE ───────────────────────────────────────────

router.get('/ratings-lote', isAuth, async (req, res) => {
  try {
    const { ids, tipo = 'movie' } = req.query;
    if (!ids) return res.json({});

    const tmdbIds = ids.split(',').map(Number).filter(Boolean);
    if (!tmdbIds.length) return res.json({});

    const { rows: cached } = await db.query(
      `SELECT tmdb_id, imdb_rating, rt_score, metacritic_score
       FROM cache_ratings
       WHERE tmdb_id = ANY($1) AND tipo = $2
         AND ultima_actualizacion > now() - interval '7 days'`,
      [tmdbIds, tipo]
    );

    const resultado = {};
    const idsCached = new Set();

    cached.forEach(r => {
      resultado[r.tmdb_id] = {
        imdb_rating: r.imdb_rating,
        rt_score: r.rt_score,
        metacritic_score: r.metacritic_score,
      };
      idsCached.add(r.tmdb_id);
    });

    const idsFaltantes = tmdbIds.filter(id => !idsCached.has(id));

    await Promise.all(idsFaltantes.map(async (tmdbId) => {
      try {
        const detalle = tipo === 'movie'
          ? await tmdb.peliculaDetalle(tmdbId)
          : await tmdb.serieDetalle(tmdbId);

        const imdbId = detalle?.external_ids?.imdb_id;
        if (!imdbId) return;

        const ratings = await omdb.getRatings(imdbId);
        if (!ratings) return;

        await db.query(`
          INSERT INTO cache_ratings
            (tmdb_id, tipo, imdb_id, imdb_rating, imdb_votes, rt_score, metacritic_score, ultima_actualizacion)
          VALUES ($1,$2,$3,$4,$5,$6,$7,now())
          ON CONFLICT (tmdb_id, tipo) DO UPDATE SET
            imdb_rating          = EXCLUDED.imdb_rating,
            imdb_votes           = EXCLUDED.imdb_votes,
            rt_score             = EXCLUDED.rt_score,
            metacritic_score     = EXCLUDED.metacritic_score,
            ultima_actualizacion = now()
        `, [tmdbId, tipo, imdbId, ratings.imdb_rating, ratings.imdb_votes, ratings.rt_score, ratings.metacritic_score]);

        resultado[tmdbId] = {
          imdb_rating: ratings.imdb_rating,
          rt_score: ratings.rt_score,
          metacritic_score: ratings.metacritic_score,
        };
      } catch (e) {
        console.error(`[ratings-lote] Error tmdbId ${tmdbId}:`, e.message);
      }
    }));

    res.json(resultado);
  } catch (e) {
    console.error('[ratings-lote]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── SERIES ────────────────────────────────────────────────────

router.get('/series/nuevas', isAuth, async (req, res) => {
  try {
    const excl = await getExcluidos(req.session.perfil.id);
    const ignorados = await getIgnoradosIds(req.session.perfil.id, 'tv');

    const [tmdbData, embyData] = await Promise.all([
      tmdb.seriesAlAire(excl),
      emby.getItems({ tipo: 'tv', limit: 500 }),
    ]);

    const embyTmdbIds = new Set(
      (embyData.Items || [])
        .filter(i => i.ProviderIds?.Tmdb)
        .map(i => parseInt(i.ProviderIds.Tmdb))
    );

    // Obtener IDs en watchlist del perfil
    const { rows: enWatchlist } = await db.query(
      "SELECT tmdb_id FROM watchlist WHERE perfil_id = $1",
      [req.session.perfil.id]
    );
    const watchlistIds = new Set(enWatchlist.map(r => r.tmdb_id));

    const results = (tmdbData.results || []).filter(i =>
      !ignorados.has(i.id) && !embyTmdbIds.has(i.id) && !watchlistIds.has(i.id)
    );
    res.json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── BÚSQUEDA ──────────────────────────────────────────────────

router.get('/buscar', isAuth, async (req, res) => {
  try {
    const { q, tipo } = req.query;
    let data;
    if (tipo === 'movie') data = await tmdb.buscarPeliculas(q);
    else if (tipo === 'tv') data = await tmdb.buscarSeries(q);
    else if (tipo === 'person') data = await tmdb.buscarPersonas(q);
    else data = await tmdb.buscarMulti(q);
    res.json(data.results || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DETALLE ───────────────────────────────────────────────────

router.get('/detalle/:tipo/:id', isAuth, async (req, res) => {
  try {
    const { tipo, id } = req.params;
    const data = tipo === 'movie'
      ? await tmdb.peliculaDetalle(id)
      : await tmdb.serieDetalle(id);

    const { rows } = await db.query(
      'SELECT estado, emby_item_id FROM watchlist WHERE perfil_id = $1 AND tmdb_id = $2 AND tipo = $3',
      [req.session.perfil.id, id, tipo]
    );
    data.neon_estado = rows.length ? rows[0].estado : null;
    data.emby_id = rows.length ? rows[0].emby_item_id : null;

    // Verificar si está ignorado
    const { rows: ign } = await db.query(
      'SELECT id FROM ignorados WHERE perfil_id = $1 AND tmdb_id = $2 AND tipo = $3',
      [req.session.perfil.id, id, tipo]
    );
    data.ignorado = ign.length > 0;

    let ratings = null;
    const imdbId = data.external_ids?.imdb_id;
    if (imdbId) {
      const { rows: cache } = await db.query(
        'SELECT * FROM cache_ratings WHERE tmdb_id = $1 AND tipo = $2',
        [id, tipo]
      );
      const cacheVigente = cache.length > 0 &&
        (Date.now() - new Date(cache[0].ultima_actualizacion).getTime()) < 7 * 24 * 60 * 60 * 1000;

      if (cacheVigente) {
        // Usar caché — incluye ratings manuales
        ratings = cache[0];
      } else if (cache.length > 0 && cache[0].imdb_rating_manual) {
        // Si hay rating manual guardado, solo renovar rt/mc con OMDb pero mantener imdb manual
        const omdbFresh = await omdb.getRatings(imdbId);
        ratings = {
          ...cache[0],
          rt_score: omdbFresh?.rt_score || cache[0].rt_score,
          metacritic_score: omdbFresh?.metacritic_score || cache[0].metacritic_score,
        };
        await db.query(`
          UPDATE cache_ratings SET
            rt_score             = $1,
            metacritic_score     = $2,
            ultima_actualizacion = now()
          WHERE tmdb_id = $3 AND tipo = $4
        `, [ratings.rt_score, ratings.metacritic_score, id, tipo]);
      } else {
        // Sin caché o caché expirado sin manual — usar OMDb → RapidAPI
        ratings = await getRatingsConFallback(imdbId);
        if (ratings) {
          await db.query(`
            INSERT INTO cache_ratings
              (tmdb_id, tipo, imdb_id, imdb_rating, imdb_votes, rt_score, metacritic_score, ultima_actualizacion)
            VALUES ($1,$2,$3,$4,$5,$6,$7,now())
            ON CONFLICT (tmdb_id, tipo) DO UPDATE SET
              imdb_rating          = EXCLUDED.imdb_rating,
              imdb_votes           = EXCLUDED.imdb_votes,
              rt_score             = EXCLUDED.rt_score,
              metacritic_score     = EXCLUDED.metacritic_score,
              ultima_actualizacion = now()
          `, [id, tipo, imdbId, ratings.imdb_rating, ratings.imdb_votes, ratings.rt_score, ratings.metacritic_score]);
        }
      }
    }

    data.ratings = ratings;
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/persona/:id', isAuth, async (req, res) => {
  try {
    const data = await tmdb.personaDetalle(req.params.id);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── WATCHLIST ACCIONES ────────────────────────────────────────

router.post('/watchlist', isAuth, async (req, res) => {
  const { tmdb_id, tipo, titulo, titulo_original, poster_url, año, release_date } = req.body;

  if (!tmdb_id || !tipo || !titulo) {
    return res.status(400).json({ error: 'Faltan campos requeridos: tmdb_id, tipo, titulo' });
  }

  try {
    await db.query(`
      INSERT INTO watchlist
        (perfil_id, tmdb_id, tipo, titulo, titulo_original, poster_url, año, release_date, estado)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pendiente')
      ON CONFLICT (perfil_id, tmdb_id, tipo) DO UPDATE SET
        titulo          = EXCLUDED.titulo,
        titulo_original = EXCLUDED.titulo_original,
        poster_url      = EXCLUDED.poster_url,
        año             = EXCLUDED.año,
        release_date    = EXCLUDED.release_date,
        fecha_actualizado = now()
    `, [req.session.perfil.id, tmdb_id, tipo, titulo, titulo_original, poster_url, año, release_date]);

    res.json({ success: true, estado: 'pendiente' });
  } catch (e) {
    console.error('[POST /watchlist]', e);
    res.status(500).json({ error: 'Error interno al guardar en watchlist' });
  }
});

router.delete('/watchlist/:tipo/:id', isAuth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM watchlist WHERE perfil_id = $1 AND tmdb_id = $2 AND tipo = $3',
      [req.session.perfil.id, req.params.id, req.params.tipo]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── PROXIES ───────────────────────────────────────────────────

router.get('/img/:path', (req, res) => {
  const size = req.query.size || 'w500';
  res.redirect(tmdb.imgUrl('/' + req.params.path, size));
});

router.get('/generos/:tipo', isAuth, async (req, res) => {
  try {
    const data = req.params.tipo === 'movie'
      ? await tmdb.generosPeliculas()
      : await tmdb.generosSeries();
    res.json(data.genres || []);
  } catch (e) {
    res.json([]);
  }
});

// ── RATING MANUAL ─────────────────────────────────────────────
// POST /api/media/ratings/manual
// Guarda un rating IMDb ingresado manualmente por el usuario
router.post('/ratings/manual', isAuth, async (req, res) => {
  const { tmdb_id, tipo, imdb_id, imdb_rating } = req.body;
  if (!tmdb_id || !tipo || !imdb_rating) {
    return res.status(400).json({ error: 'Faltan campos' });
  }
  const rating = parseFloat(imdb_rating);
  if (isNaN(rating) || rating < 0 || rating > 10) {
    return res.status(400).json({ error: 'Rating debe ser entre 0 y 10' });
  }
  try {
    await db.query(`
      INSERT INTO cache_ratings
        (tmdb_id, tipo, imdb_id, imdb_rating, imdb_rating_manual, ultima_actualizacion)
      VALUES ($1, $2, $3, $4, true, now())
      ON CONFLICT (tmdb_id, tipo) DO UPDATE SET
        imdb_rating        = EXCLUDED.imdb_rating,
        imdb_rating_manual = true,
        ultima_actualizacion = now()
    `, [tmdb_id, tipo, imdb_id || null, rating]);
    res.json({ success: true, imdb_rating: rating });
  } catch (e) {
    console.error('[POST /ratings/manual]', e);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── SYNC RÁPIDO — se llama al cargar peliculas.html ──────────
router.get('/sync', isAuth, async (req, res) => {
  try {
    const { rows: pendientes } = await db.query(
      "SELECT id, tmdb_id, tipo FROM watchlist WHERE perfil_id = $1 AND estado = 'pendiente'",
      [req.session.perfil.id]
    );
    if (!pendientes.length) return res.json({ actualizados: 0 });

    const [dataMovies, dataSeries] = await Promise.all([
      emby.getItems({ tipo: 'movie', limit: 500 }),
      emby.getItems({ tipo: 'tv', limit: 500 }),
    ]);

    const embyMap = new Map();
    for (const item of (dataMovies.Items || [])) {
      if (item.ProviderIds?.Tmdb) embyMap.set(`${item.ProviderIds.Tmdb}:movie`, item.Id);
    }
    for (const item of (dataSeries.Items || [])) {
      if (item.ProviderIds?.Tmdb) embyMap.set(`${item.ProviderIds.Tmdb}:tv`, item.Id);
    }

    let actualizados = 0;
    for (const item of pendientes) {
      const embyId = embyMap.get(`${item.tmdb_id}:${item.tipo}`);
      if (embyId) {
        await db.query(
          "UPDATE watchlist SET estado = 'en_emby', emby_item_id = $1, fecha_actualizado = now() WHERE id = $2",
          [embyId, item.id]
        );
        actualizados++;
      }
    }

    res.json({ actualizados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── SYNC RÁPIDO ───────────────────────────────────────────────
router.get('/sync', isAuth, async (req, res) => {
  try {
    const { rows: pendientes } = await db.query(
      "SELECT id, tmdb_id, tipo FROM watchlist WHERE perfil_id = $1 AND estado = 'pendiente'",
      [req.session.perfil.id]
    );
    if (!pendientes.length) return res.json({ actualizados: 0 });

    const [dataMovies, dataSeries] = await Promise.all([
      emby.getItems({ tipo: 'movie', limit: 500 }),
      emby.getItems({ tipo: 'tv', limit: 500 }),
    ]);

    const embyMap = new Map();
    for (const item of (dataMovies.Items || [])) {
      if (item.ProviderIds?.Tmdb) embyMap.set(`${item.ProviderIds.Tmdb}:movie`, item.Id);
    }
    for (const item of (dataSeries.Items || [])) {
      if (item.ProviderIds?.Tmdb) embyMap.set(`${item.ProviderIds.Tmdb}:tv`, item.Id);
    }

    let actualizados = 0;
    for (const item of pendientes) {
      const embyId = embyMap.get(`${item.tmdb_id}:${item.tipo}`);
      if (embyId) {
        await db.query(
          "UPDATE watchlist SET estado = 'en_emby', emby_item_id = $1, fecha_actualizado = now() WHERE id = $2",
          [embyId, item.id]
        );
        actualizados++;
      }
    }

    res.json({ actualizados });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;