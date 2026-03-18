// ============================================================
// RUTA: scripts/rellenar-covers.js
// USO:  node scripts/rellenar-covers.js
// 
// Recorre todos los juegos en Neon que tienen cover_url = null,
// busca cada uno en IGDB por nombre y actualiza la BD.
// Incluye pausa de 300ms entre búsquedas para no saturar IGDB.
// ============================================================

require('dotenv').config();
const db   = require('../lib/db');
const igdb = require('../lib/igdb');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function rellenarCovers() {
  console.log('🎮 Iniciando relleno de covers...\n');

  const { rows } = await db.query(
    `SELECT id, titulo, igdb_id FROM juegos WHERE cover_url IS NULL ORDER BY titulo`
  );

  console.log(`📋 ${rows.length} juegos sin cover encontrados.\n`);

  let ok = 0, fail = 0;

  for (const juego of rows) {
    try {
      let coverUrl = null;

      // Intento 1: si tiene igdb_id, buscar directo por ID
      if (juego.igdb_id) {
        const detalle = await igdb.detalleJuego(juego.igdb_id);
        if (detalle?.cover?.url) {
          coverUrl = igdb.coverUrl(detalle.cover.url);
        }
      }

      // Intento 2: buscar por nombre si no encontró por ID
      if (!coverUrl) {
        const resultados = await igdb.buscarJuegos(juego.titulo);
        const match = resultados?.[0];
        if (match?.cover?.url) {
          coverUrl = igdb.coverUrl(match.cover.url);
          // Aprovechar a guardar igdb_id si no lo tenía
          if (!juego.igdb_id && match.id) {
            await db.query(
              'UPDATE juegos SET igdb_id = $1 WHERE id = $2',
              [match.id, juego.id]
            );
          }
        }
      }

      if (coverUrl) {
        await db.query(
          'UPDATE juegos SET cover_url = $1, fecha_actualizado = now() WHERE id = $2',
          [coverUrl, juego.id]
        );
        console.log(`  ✅ ${juego.titulo}`);
        ok++;
      } else {
        console.log(`  ⚠️  ${juego.titulo} — sin cover en IGDB`);
        fail++;
      }

    } catch (e) {
      console.error(`  ❌ ${juego.titulo} — error: ${e.message}`);
      fail++;
    }

    // Pausa entre requests para no saturar la API
    await sleep(350);
  }

  console.log(`\n✅ Completados: ${ok} | ⚠️ Sin cover: ${fail}`);
  process.exit(0);
}

rellenarCovers();
