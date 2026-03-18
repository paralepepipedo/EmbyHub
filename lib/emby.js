// VERSIÓN: v1.1
// CAMBIOS: 
//   - Resuelve userId por nombre de usuario → GUID real via /Users endpoint
//   - Cachea el userId en memoria para no repetir la resolución
//   - Agrega logs detallados para diagnóstico
//   - buscarEnEmby también busca por ProviderIds.Tmdb para mayor precisión

const fetch = require('node-fetch');

const BASE = process.env.EMBY_BASE_URL;
const KEY  = process.env.EMBY_API_KEY;

function headers() {
  return { 'X-Emby-Token': KEY, 'Content-Type': 'application/json' };
}

// Cache del GUID real del usuario — se resuelve una vez y queda en memoria
let _resolvedUserId = null;

/**
 * Resuelve el userId configurado en .env:
 *   - Si parece un GUID (contiene guiones o es largo), lo usa directo.
 *   - Si es un nombre de usuario ("dexterh"), consulta /Users para obtener el GUID real.
 */
async function resolverUserId() {
  if (_resolvedUserId) return _resolvedUserId;

  const raw = process.env.EMBY_USER_ID || '';

  // Heurística: un GUID tiene guiones y >20 chars
  const pareceGuid = raw.includes('-') && raw.length > 20;
  if (pareceGuid) {
    _resolvedUserId = raw;
    return _resolvedUserId;
  }

  // Es un nombre de usuario → buscar GUID en /Users
  try {
    console.log(`[Emby] EMBY_USER_ID="${raw}" parece un nombre, resolviendo GUID...`);
    const res = await fetch(`${BASE}/Users?api_key=${KEY}`);
    if (!res.ok) {
      console.error(`[Emby] /Users respondió HTTP ${res.status}. Usando sin userId.`);
      return null;
    }
    const users = await res.json();
    const match = users.find(u =>
      u.Name?.toLowerCase() === raw.toLowerCase() ||
      u.Id === raw
    );
    if (match) {
      console.log(`[Emby] Usuario "${raw}" resuelto → GUID: ${match.Id}`);
      _resolvedUserId = match.Id;
      return _resolvedUserId;
    } else {
      console.warn(`[Emby] No se encontró usuario "${raw}" en Emby. Usando sin userId.`);
      return null;
    }
  } catch (e) {
    console.error('[Emby] Error resolviendo userId:', e.message);
    return null;
  }
}

/**
 * Obtiene ítems del catálogo Emby.
 * @param {object} opts
 * @param {'movie'|'tv'|null} opts.tipo
 * @param {number} opts.limit
 */
async function getItems({ tipo = null, limit = 50 } = {}) {
  try {
    const userId = await resolverUserId();

    const params = new URLSearchParams({
      Recursive:    'true',
      Fields:       'ProviderIds,DateCreated,ProductionYear',
      SortBy:       'DateCreated',
      SortOrder:    'Descending',
      Limit:        limit,
    });

    if (tipo === 'movie') params.set('IncludeItemTypes', 'Movie');
    if (tipo === 'tv')    params.set('IncludeItemTypes', 'Series');

    // Con userId usa la ruta personalizada; sin él usa /Items general
    const path = userId ? `/Users/${userId}/Items` : '/Items';
    const url  = `${BASE}${path}?${params}`;

    console.log(`[Emby] GET ${url}`);
    const res = await fetch(url, { headers: headers() });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
    }

    const data = await res.json();
    console.log(`[Emby] getItems(${tipo}) → ${data.Items?.length ?? 0} ítems`);
    return data;

  } catch (e) {
    console.error('[Emby] Error getItems:', e.message);
    return { Items: [] };
  }
}

/**
 * Busca un título en Emby.
 * Primero intenta cruzar por TMDB ID en ProviderIds (más preciso).
 * Si no, cae a búsqueda por nombre.
 * @param {string} titulo
 * @param {number|string|null} tmdbId  — opcional, mejora la precisión
 */
async function buscarEnEmby(titulo, tmdbId = null) {
  try {
    // Intento 1: buscar por TmdbId en todos los ítems (solo si tenemos el ID)
    if (tmdbId) {
      const params = new URLSearchParams({
        Recursive:   'true',
        Fields:      'ProviderIds',
        AnyProviderIdEquals: `tmdb.${tmdbId}`,
      });
      const res = await fetch(`${BASE}/Items?${params}`, { headers: headers() });
      if (res.ok) {
        const data = await res.json();
        if (data.Items?.length > 0) return data.Items[0];
      }
    }

    // Intento 2: búsqueda por nombre
    const params = new URLSearchParams({
      SearchTerm: titulo,
      Recursive:  'true',
      Fields:     'ProviderIds',
      Limit:      5,
    });
    const res = await fetch(`${BASE}/Items?${params}`, { headers: headers() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.Items?.[0] || null;

  } catch (e) {
    console.error('[Emby] buscarEnEmby error:', e.message);
    return null;
  }
}

/**
 * Devuelve la URL de reproducción para un ítem de Emby.
 */
function getPlayUrl(embyItemId) {
  return `${BASE}/web/index.html#!/details?id=${embyItemId}`;
}

module.exports = { getItems, buscarEnEmby, getPlayUrl, resolverUserId };
