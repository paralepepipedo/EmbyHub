// ============================================================
// RUTA: lib/igdb.js
// VERSIÓN: v1.1
// CAMBIOS:
//   - Agrega función proximosEstrenos() para la sección
//     de próximos lanzamientos en el módulo de juegos
// ============================================================

const fetch = require('node-fetch');

const CLIENT_ID = process.env.IGDB_CLIENT_ID;
const CLIENT_SECRET = process.env.IGDB_CLIENT_SECRET;
let accessToken = process.env.IGDB_ACCESS_TOKEN;

async function refreshToken() {
  const res = await fetch(
    `https://id.twitch.tv/oauth2/token?client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&grant_type=client_credentials`,
    { method: 'POST' }
  );
  const data = await res.json();
  accessToken = data.access_token;
  return accessToken;
}

async function igdbFetch(endpoint, body) {
  let res = await fetch(`https://api.igdb.com/v4${endpoint}`, {
    method: 'POST',
    headers: {
      'Client-ID': CLIENT_ID,
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'text/plain',
    },
    body,
  });

  if (res.status === 401) {
    await refreshToken();
    res = await fetch(`https://api.igdb.com/v4${endpoint}`, {
      method: 'POST',
      headers: {
        'Client-ID': CLIENT_ID,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'text/plain',
      },
      body,
    });
  }

  if (!res.ok) throw new Error(`IGDB HTTP ${res.status}`);
  return res.json();
}

async function buscarJuegos(query) {
  const body = `
    search "${query}";
    fields name,cover.url,summary,genres.name,platforms.name,involved_companies.company.name,first_release_date,rating;
    limit 10;
  `;
  return igdbFetch('/games', body);
}

async function detalleJuego(igdbId) {
  const body = `
    where id = ${igdbId};
    fields name,cover.url,summary,genres.name,platforms.name,involved_companies.company.name,first_release_date,rating,screenshots.url,artworks.url;
    limit 1;
  `;
  const results = await igdbFetch('/games', body);
  return results?.[0] || null;
}

// Próximos estrenos: juegos con fecha de lanzamiento futura
async function proximosEstrenos() {
  const ahora = Math.floor(Date.now() / 1000);
  const en6meses = ahora + 60 * 60 * 24 * 180;

  const body = `
  fields name,cover.url,summary,genres.name,platforms.name,first_release_date,hypes;
  where first_release_date >= ${ahora}
    & first_release_date <= ${en6meses}
    & cover != null
    & hypes >= 1;
  sort hypes desc;
  limit 20;
`;
  return igdbFetch('/games', body);
}

// Convierte URL de imagen IGDB a tamaño grande con protocolo https
function coverUrl(url) {
  if (!url) return null;
  return url.replace('t_thumb', 't_cover_big').replace(/^\/\//, 'https://');
}

module.exports = { buscarJuegos, detalleJuego, proximosEstrenos, coverUrl };
