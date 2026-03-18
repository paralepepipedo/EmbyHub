// ============================================================
// RUTA: public/js/series.js
// VERSIÓN: v1.2
// CAMBIOS:
//   - Reescrito completo para ser compatible con peliculas.js v1.5
//   - Sobreescribe el DOMContentLoaded de peliculas.js correctamente
//   - Usa las mismas funciones de render pero con tipo 'tv'
//   - cargarEmbyTv verifica ImageTags.Primary antes de construir URL
//   - cargarRatingsEmbyTv pinta badge IMDb en carrusel Emby de series
// ============================================================

// Sobreescribir el DOMContentLoaded que registró peliculas.js
// no es posible directamente, pero peliculas.js revisa IDs que no
// existen en series.html (car-estrenos, car-watchlist con tipo movie),
// por eso necesitamos que series.js cargue DESPUÉS y controle
// los carruseles correctos.
//
// La solución es que peliculas.js no rompa cuando los IDs no existen
// — ya está protegido con getElementById que retorna null —
// y series.js simplemente llena los carruseles de series.

document.addEventListener('DOMContentLoaded', async () => {
  // requireAuth y datos de perfil ya los maneja peliculas.js
  // Solo necesitamos cargar los datos de series
  cargarNuevasSeries();
  cargarWatchlistSeries();
  cargarEmbySeries();
});

// ─────────────────────────────────────────
// 1. Nuevas series / en emisión (TMDB)
// ─────────────────────────────────────────
async function cargarNuevasSeries() {
  setCargando('car-nuevas');
  try {
    const res = await fetch('/api/media/series/nuevas');
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      setVacio('car-nuevas', 'No hay series nuevas disponibles.');
      return;
    }
    renderCarruselSeries('car-nuevas', items);
    const ids = items.filter(i => i.id).map(i => i.id);
    if (ids.length) cargarRatingsCarrusel('car-nuevas', ids, 'tv');
  } catch (e) {
    console.error('[Series nuevas]', e);
    setVacio('car-nuevas', 'Error al cargar series.');
  }
}

// ─────────────────────────────────────────
// 2. Watchlist de series (Neon)
// ─────────────────────────────────────────
async function cargarWatchlistSeries() {
  setCargando('car-watchlist');
  try {
    const res = await fetch('/api/media/watchlist/tv');
    const items = await res.json();
    renderCarruselDbSeries('car-watchlist', items);
    const ids = items.filter(i => i.tmdb_id).map(i => i.tmdb_id);
    if (ids.length) cargarRatingsCarrusel('car-watchlist', ids, 'tv');
  } catch (e) {
    console.error('[Watchlist series]', e);
    setVacio('car-watchlist', 'Error al cargar tu lista.');
  }
}

// ─────────────────────────────────────────
// 3. Catálogo Emby — series
// ─────────────────────────────────────────
async function cargarEmbySeries() {
  setCargando('car-emby');
  try {
    const res = await fetch('/api/media/emby/tv');
    const items = await res.json();

    if (!Array.isArray(items) || items.length === 0) {
      setVacio('car-emby', 'No se encontraron series en Emby.');
      return;
    }

    const embyItems = items.map(i => ({
      _embyId: i.Id,
      id: i.ProviderIds?.Tmdb ? parseInt(i.ProviderIds.Tmdb) : null,
      title: i.Name,
      release_date: i.ProductionYear ? String(i.ProductionYear) : '',
      embyImage: i.ImageTags?.Primary
        ? `${embyBaseUrl}/Items/${i.Id}/Images/Primary?maxHeight=750&quality=90`
        : null,
    }));

    renderCarruselEmbySeries('car-emby', embyItems);

    const idsConTmdb = embyItems.filter(i => i.id).map(i => i.id);
    if (idsConTmdb.length) cargarRatingsEmbySeries(idsConTmdb);

  } catch (e) {
    console.error('[Emby series]', e);
    setVacio('car-emby', 'Error al conectar con Emby.');
  }
}

async function cargarRatingsEmbySeries(tmdbIds) {
  try {
    const res = await fetch(`/api/media/ratings-lote?ids=${tmdbIds.join(',')}&tipo=tv`);
    const ratings = await res.json();

    document.querySelectorAll('#car-emby .card[data-tmdb-id]').forEach(card => {
      const tmdbId = parseInt(card.dataset.tmdbId);
      const r = ratings[tmdbId];
      if (r?.imdb_rating && !card.querySelector('.badge-imdb')) {
        const badge = document.createElement('div');
        badge.className = 'badge-imdb';
        badge.innerHTML = `⭐ ${r.imdb_rating}`;
        card.appendChild(badge);
      }
    });
  } catch (e) {
    console.error('[cargarRatingsEmbySeries]', e);
  }
}

async function cargarRatingsCarrusel(idContenedor, tmdbIds) {
  try {
    const res = await fetch(`/api/media/ratings-lote?ids=${tmdbIds.join(',')}&tipo=tv`);
    const ratings = await res.json();

    document.querySelectorAll(`#${idContenedor} .card[data-tmdb-id]`).forEach(card => {
      const tmdbId = parseInt(card.dataset.tmdbId);
      const r = ratings[tmdbId];
      if (r?.imdb_rating) {
        const yearEl = card.querySelector('.year');
        if (yearEl && !yearEl.querySelector('.imdb-inline')) {
          const span = document.createElement('span');
          span.className = 'imdb-inline';
          span.style.cssText = 'color:#f5c518; font-weight:700; margin-left:6px; font-size:0.72em; white-space:nowrap;';
          span.innerText = `⭐ ${r.imdb_rating}`;
          yearEl.appendChild(span);
        }
      }
    });
  } catch (e) {
    console.error(`[cargarRatingsCarrusel:${idContenedor}]`, e);
  }
}

// ─────────────────────────────────────────
// RENDERS
// ─────────────────────────────────────────

function renderCarruselSeries(idContenedor, items) {
  const cont = document.getElementById(idContenedor);
  if (!cont) return;
  cont.innerHTML = '';

  items.forEach(i => {
    const img = i.poster_path
      ? `/api/media/img${i.poster_path}?size=w500`
      : 'https://via.placeholder.com/500x750?text=Sin+Imagen';

    const fechaDisplay = formatearFecha(i.first_air_date);
    const año = (i.first_air_date || '').split('-')[0] || '';

    const div = document.createElement('div');
    div.className = 'card card-estreno';
    div.dataset.tmdbId = i.id;
    div.innerHTML = `
      <img src="${img}" loading="lazy" onerror="this.src='https://via.placeholder.com/500x750?text=Sin+Imagen'">
      <div class="badge estreno">🆕 NUEVA</div>
      <div class="card-btn-agregar"
           title="Agregar a mi lista"
           data-id="${i.id}"
           data-title="${encodeURIComponent(i.name || '')}"
           data-orig="${encodeURIComponent(i.original_name || '')}"
           data-poster="${encodeURIComponent(i.poster_path || '')}"
           data-año="${año}"
           data-fecha="${i.first_air_date || ''}">＋</div>
      <div class="info">
        <div class="title">${i.name || ''}</div>
        <div class="year">${fechaDisplay || año}</div>
      </div>
    `;

    div.addEventListener('click', (e) => {
      if (e.target.closest('.card-btn-agregar')) return;
      abrirModal('tv', i.id, null, img);
    });

    div.querySelector('.card-btn-agregar').addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      agregarDesdeEstreno({
        tmdb_id: parseInt(btn.dataset.id),
        tipo: 'tv',
        titulo: decodeURIComponent(btn.dataset.title),
        titulo_original: decodeURIComponent(btn.dataset.orig),
        poster_url: decodeURIComponent(btn.dataset.poster),
        año: parseInt(btn.dataset.año) || null,
        release_date: btn.dataset.fecha || null,
      }, btn);
    });

    cont.appendChild(div);
  });
}

function renderCarruselEmbySeries(idContenedor, items) {
  const cont = document.getElementById(idContenedor);
  if (!cont) return;
  cont.innerHTML = '';

  items.forEach(i => {
    const img = i.embyImage || 'https://via.placeholder.com/500x750?text=Sin+Imagen';

    const div = document.createElement('div');
    div.className = 'card';
    if (i.id) div.dataset.tmdbId = i.id;

    div.innerHTML = `
      <img src="${img}" loading="lazy" onerror="this.src='https://via.placeholder.com/500x750?text=Sin+Imagen'">
      <div class="badge emby">✅ EMBY</div>
      <div class="info">
        <div class="title">${i.title || ''}</div>
        <div class="year">${i.release_date || ''}</div>
      </div>
    `;

    div.addEventListener('click', () => {
      if (i.id) {
        abrirModal('tv', i.id, i._embyId, img);
      } else {
        window.open(`${embyBaseUrl}/web/index.html#!/details?id=${i._embyId}`, '_blank');
      }
    });

    cont.appendChild(div);
  });
}

function renderCarruselDbSeries(idContenedor, items) {
  const cont = document.getElementById(idContenedor);
  if (!cont) return;
  cont.innerHTML = '';

  if (!items.length) {
    setVacio(idContenedor, 'No hay series en tu lista de espera.');
    return;
  }

  items.forEach(i => {
    const img = i.poster_url
      ? `/api/media/img${i.poster_url}?size=w500`
      : 'https://via.placeholder.com/500x750?text=Sin+Imagen';

    const div = document.createElement('div');
    div.className = 'card';
    div.dataset.tmdbId = i.tmdb_id;
    div.innerHTML = `
      <img src="${img}" loading="lazy">
      <div class="badge espera">🕒 ESPERA</div>
      <div class="info">
        <div class="title">${i.titulo}</div>
        <div class="year">${formatearFecha(i.release_date) || i.año || ''}</div>
      </div>
    `;
    div.addEventListener('click', () => abrirModal('tv', i.tmdb_id, i.emby_item_id, img));
    cont.appendChild(div);
  });
}