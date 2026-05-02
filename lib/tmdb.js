const fetch = require('node-fetch');

const BASE = process.env.TMDB_BASE_URL;
const KEY = process.env.TMDB_API_KEY;
const IMG = process.env.TMDB_IMAGE_BASE;

function url(endpoint, params = {}) {
  const p = new URLSearchParams({ api_key: KEY, language: 'es-ES', ...params });
  return `${BASE}${endpoint}?${p}`;
}

module.exports = {
  imgUrl: (path, size = 'w500') => path ? `${IMG}/${size}${path}` : null,
  backdropUrl: (path) => path ? `${IMG}/original${path}` : null,

  // Películas
  proximosEstrenosPeliculas: async (withoutGenres = '', page = 1) => {
    const hoy = new Date();
    const mesAnterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    const desde = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}-01`;
    return fetch(url('/discover/movie', {
      without_genres: withoutGenres,
      'primary_release_date.gte': desde,
      sort_by: 'popularity.desc',
      'popularity.gte': 10,
      'with_runtime.gte': 60,
      without_keywords: '158718|6513',
      with_original_language: 'en',
      region: 'US',
      page,
    })).then(r => r.json());
  },

  peliculaDetalle: (id) =>
    fetch(url(`/movie/${id}`, { append_to_response: 'credits,videos,external_ids' })).then(r => r.json()),

  // Series
  seriesAlAire: async (withoutGenres = '') => {
    const desde = `${new Date().getFullYear()}-01-01`;
    return fetch(url('/discover/tv', {
      without_genres: withoutGenres,
      'first_air_date.gte': desde,
      sort_by: 'popularity.desc',
      'popularity.gte': 10,
      without_keywords: '158718|6513',
    })).then(r => r.json());
  },

  serieDetalle: (id) =>
    fetch(url(`/tv/${id}`, { append_to_response: 'credits,videos,external_ids' })).then(r => r.json()),

  // Búsqueda
  buscarPeliculas: (query) =>
    fetch(url('/search/movie', { query })).then(r => r.json()),

  buscarSeries: (query) =>
    fetch(url('/search/tv', { query })).then(r => r.json()),

  buscarPersonas: (query) =>
    fetch(url('/search/person', { query })).then(r => r.json()),

  buscarMulti: (query) =>
    fetch(url('/search/multi', { query })).then(r => r.json()),

  // Persona (actor/director)
  personaDetalle: (id) =>
    fetch(url(`/person/${id}`, { append_to_response: 'combined_credits' })).then(r => r.json()),

  // Géneros
  generosPeliculas: () =>
    fetch(url('/genre/movie/list')).then(r => r.json()),

  generosSeries: () =>
    fetch(url('/genre/tv/list')).then(r => r.json()),
};
