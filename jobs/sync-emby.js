// ============================================================
// RUTA: jobs/sync-emby.js
// VERSIÓN: v2.0
// CAMBIOS:
//   - Cruce por TMDB ID en ProviderIds en lugar de búsqueda
//     por nombre. Elimina definitivamente los falsos positivos.
//   - Estrategia: obtener TODO el catálogo de Emby de una vez,
//     construir un Set de TMDB IDs disponibles, y cruzar contra
//     la watchlist pendiente. Sin búsquedas individuales.
//   - Si Emby no tiene ProviderIds.Tmdb para un ítem, se ignora
//     ese ítem (no se marca como en_emby por coincidencia de nombre)
// ============================================================

const db = require('../lib/db');
const emby = require('../lib/emby');

async function syncEmbyWatchlist() {
  try {
    // 1. Traer watchlist pendiente
    const { rows: pendientes } = await db.query(
      "SELECT id, tmdb_id, tipo FROM watchlist WHERE estado = 'pendiente'"
    );
    if (pendientes.length === 0) return;

    // 2. Obtener catálogo completo de Emby (películas y series)
    //    en una sola llamada cada uno, sin búsquedas individuales
    const [dataMovies, dataSeries] = await Promise.all([
      emby.getItems({ tipo: 'movie', limit: 500 }),
      emby.getItems({ tipo: 'tv', limit: 500 }),
    ]);

    // 3. Construir mapa tmdbId → embyId solo para ítems que tengan ProviderIds.Tmdb
    const embyMap = new Map(); // key: "tmdbId:tipo", value: embyItemId

    for (const item of (dataMovies.Items || [])) {
      const tmdbId = item.ProviderIds?.Tmdb;
      if (tmdbId) embyMap.set(`${tmdbId}:movie`, item.Id);
    }

    for (const item of (dataSeries.Items || [])) {
      const tmdbId = item.ProviderIds?.Tmdb;
      if (tmdbId) embyMap.set(`${tmdbId}:tv`, item.Id);
    }

    console.log(`[Sync] Catálogo Emby cargado: ${embyMap.size} ítems con TMDB ID`);

    // 4. Cruzar watchlist pendiente contra el mapa
    let actualizados = 0;

    for (const item of pendientes) {
      const key = `${item.tmdb_id}:${item.tipo}`;
      const embyId = embyMap.get(key);

      if (embyId) {
        await db.query(
          "UPDATE watchlist SET estado = 'en_emby', emby_item_id = $1, fecha_actualizado = now() WHERE id = $2",
          [embyId, item.id]
        );
        actualizados++;
        console.log(`[Sync] TMDB ${item.tmdb_id} encontrado en Emby → emby_id: ${embyId}`);
      }
    }

    console.log(`[Sync] Finalizado. ${actualizados} ítems movidos a en_emby.`);

  } catch (e) {
    console.error('[Sync] Error:', e.message);
  }
}

module.exports = syncEmbyWatchlist;