// ============================================================
// RUTA: scripts/rellenar-metadata.js
// VERSIÓN: v2.0
// USO: node scripts/rellenar-metadata.js
//
// Actualiza TODOS los campos de metadata desde IGDB:
// año, descripcion, cover_url, generos, plataformas,
// desarrollador, publicador.
// Fuerza actualización de arrays vacíos {} también.
// ============================================================

require('dotenv').config();
const db   = require('../lib/db');
const igdb = require('../lib/igdb');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function limpiarTitulo(titulo) {
  return titulo
    .replace(/\[.*?\]/g, '')
    .replace(/\((\d{4})\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function rellenarMetadata() {
  console.log('🎮 Iniciando relleno completo de metadata...\n');

  // Traer todos los juegos que les falte cualquier campo
  const { rows } = await db.query(`
    SELECT id, titulo, igdb_id, año, descripcion, cover_url, generos, plataformas, desarrollador
    FROM juegos
    WHERE año IS NULL
       OR descripcion IS NULL
       OR cover_url IS NULL
       OR generos = '{}'
       OR plataformas = '{}'
       OR desarrollador IS NULL
    ORDER BY titulo
  `);

  console.log(`📋 ${rows.length} juegos con metadata incompleta.\n`);

  let ok = 0, fail = 0;

  for (const juego of rows) {
    try {
      let match = null;

      // Intento 1: por igdb_id
      if (juego.igdb_id) {
        match = await igdb.detalleJuego(juego.igdb_id);
      }

      // Intento 2: por título limpio
      if (!match) {
        const tituloLimpio = limpiarTitulo(juego.titulo);
        const resultados   = await igdb.buscarJuegos(tituloLimpio);
        match = resultados?.[0] || null;
      }

      if (!match) {
        console.log(`  ⚠️  ${juego.titulo} — sin resultados en IGDB`);
        fail++;
        await sleep(350);
        continue;
      }

      // Extraer todos los campos disponibles
      const año          = match.first_release_date
                             ? new Date(match.first_release_date * 1000).getFullYear()
                             : juego.año;
      const descripcion  = match.summary || juego.descripcion;
      const coverUrl     = match.cover?.url
                             ? igdb.coverUrl(match.cover.url)
                             : juego.cover_url;
      const igdbId       = match.id || juego.igdb_id;
      const generos      = match.genres?.map(g => g.name) || [];
      const plataformas  = match.platforms?.map(p => p.name) || [];

      // Separar desarrollador y publicador
      const desarrollador = match.involved_companies
        ?.find(c => c.developer)?.company?.name
        || match.involved_companies?.[0]?.company?.name
        || juego.desarrollador;

      const publicador = match.involved_companies
        ?.find(c => c.publisher)?.company?.name
        || null;

      // UPDATE forzado — sin COALESCE para arrays
      await db.query(`
        UPDATE juegos SET
          igdb_id       = $1,
          año           = $2,
          descripcion   = $3,
          cover_url     = $4,
          generos       = $5,
          plataformas   = $6,
          desarrollador = $7,
          publicador    = COALESCE($8, publicador),
          fecha_actualizado = now()
        WHERE id = $9
      `, [igdbId, año, descripcion, coverUrl, generos, plataformas, desarrollador, publicador, juego.id]);

      const gen = generos.slice(0, 2).join(', ') || '—';
      console.log(`  ✅ ${juego.titulo} → ${año || '???'} | ${gen}`);
      ok++;

    } catch (e) {
      console.error(`  ❌ ${juego.titulo} — ${e.message}`);
      fail++;
    }

    await sleep(350);
  }

  console.log(`\n✅ Actualizados: ${ok} | ⚠️  Sin datos: ${fail}`);
  process.exit(0);
}

rellenarMetadata();
