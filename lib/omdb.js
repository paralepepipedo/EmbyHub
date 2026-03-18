// ============================================================
// RUTA: lib/omdb.js
// VERSIÓN: v1.1
// CAMBIOS:
//   - getRatingsRapid(): consulta imdb236 en RapidAPI
//     como fallback cuando OMDb no tiene el rating
//   - getRatings() sigue igual — solo OMDb, sin cambios
//   - getRatingsConFallback(): OMDb primero, si imdb_rating
//     es null intenta RapidAPI, devuelve el mejor resultado
// ============================================================

const fetch = require('node-fetch');

const KEY = process.env.OMDB_API_KEY;
const BASE = process.env.OMDB_BASE_URL;
const RAPID_KEY = process.env.RAPIDAPI_KEY;
const RAPID_HOST = 'imdb236.p.rapidapi.com';

// ── OMDb — sin cambios ────────────────────────────────────────
async function getRatings(imdbId) {
  if (!imdbId) return null;
  try {
    const res = await fetch(`${BASE}/?i=${imdbId}&apikey=${KEY}`);
    const data = await res.json();
    if (data.Response === 'False') return null;

    const rt = data.Ratings?.find(r => r.Source === 'Rotten Tomatoes');
    const mc = data.Ratings?.find(r => r.Source === 'Metacritic');

    return {
      imdb_rating: data.imdbRating !== 'N/A' ? parseFloat(data.imdbRating) : null,
      imdb_votes: data.imdbVotes !== 'N/A' ? parseInt(data.imdbVotes.replace(/,/g, '')) : null,
      rt_score: rt ? parseInt(rt.Value) : null,
      metacritic_score: mc ? parseInt(mc.Value) : null,
    };
  } catch (e) {
    console.error('[OMDb] Error:', e.message);
    return null;
  }
}

// ── RapidAPI imdb236 — fallback ───────────────────────────────
async function getRatingsRapid(imdbId) {
  if (!imdbId || !RAPID_KEY) return null;
  try {
    const res = await fetch(`https://${RAPID_HOST}/api/imdb/${imdbId}`, {
      headers: {
        'x-rapidapi-key': RAPID_KEY,
        'x-rapidapi-host': RAPID_HOST,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    const data = await res.json();

    return {
      imdb_rating: data.averageRating ? parseFloat(data.averageRating) : null,
      imdb_votes: data.numVotes ? parseInt(data.numVotes) : null,
      rt_score: null, // imdb236 no devuelve RT
      metacritic_score: data.metascore ? parseInt(data.metascore) : null,
    };
  } catch (e) {
    console.error('[RapidAPI imdb236] Error:', e.message);
    return null;
  }
}

// ── Con fallback — OMDb → RapidAPI ────────────────────────────
async function getRatingsConFallback(imdbId) {
  if (!imdbId) return null;

  const omdbResult = await getRatings(imdbId);

  // Si OMDb tiene imdb_rating, usarlo directamente
  if (omdbResult?.imdb_rating) return omdbResult;

  // Si OMDb no tiene imdb_rating, intentar RapidAPI
  const rapidResult = await getRatingsRapid(imdbId);
  if (rapidResult?.imdb_rating) {
    // Combinar — usar rt_score y metacritic de OMDb si los tiene
    return {
      imdb_rating: rapidResult.imdb_rating,
      imdb_votes: rapidResult.imdb_votes,
      rt_score: omdbResult?.rt_score || null,
      metacritic_score: rapidResult.metacritic_score || omdbResult?.metacritic_score || null,
    };
  }

  // Ambos fallaron — devolver lo que tenga OMDb (puede tener rt/mc sin imdb)
  return omdbResult;
}

module.exports = { getRatings, getRatingsRapid, getRatingsConFallback };