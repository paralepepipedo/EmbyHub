// ============================================================
// RUTA: public/js/peliculas.js
// VERSIÓN: v1.8
// CAMBIOS:
//   - Rating IMDb en tarjetas de estrenos (en segundo plano)
//   - Rating IMDb en tarjetas de watchlist (en segundo plano)
//   - Se muestra ⭐ X.X a la derecha del año en .year
// ============================================================

const embyBaseUrl = window.EMBY_BASE_URL || 'http://emby4.ddns.net:8096';
let estrenosPagina = 1;
let estrenosCargando = false;
let estrenosVistos = new Set();

function formatearFecha(fechaStr) {
  if (!fechaStr) return '';
  const partes = fechaStr.split('-');
  if (partes.length < 2) return fechaStr;
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const y = partes[0];
  const m = parseInt(partes[1]) - 1;
  const d = partes[2] ? parseInt(partes[2]) : null;
  return d ? `${d} ${meses[m]} ${y}` : `${meses[m]} ${y}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const me = await requireAuth();
  if (!me) return;
  document.getElementById('userName').innerText = me.nombre;
  document.getElementById('userAvatar').innerText = me.avatar;

  if (!document.getElementById('car-estrenos')) return;

  cargarEstrenos();
  cargarWatchlist();
  cargarEmby();
  fetch('/api/media/sync').catch(() => { });
  fetch('/api/media/sync').catch(() => { });
});

// ─────────────────────────────────────────
// 1. Próximos estrenos
// ─────────────────────────────────────────
async function cargarEstrenos(pagina = 1) {
  if (estrenosCargando) return;
  estrenosCargando = true;

  if (pagina === 1) setCargando('car-estrenos');

  try {
    const res = await fetch(`/api/media/peliculas/estrenos?page=${pagina}`);
    const items = await res.json();

    if (!Array.isArray(items) || items.length === 0) {
      if (pagina === 1) setVacio('car-estrenos', 'No hay estrenos próximos.');
      estrenosCargando = false;
      return;
    }

    if (pagina === 1) {
      document.getElementById('car-estrenos').innerHTML = '';
      estrenosVistos = new Set();
    }

    const itemsNuevos = items.filter(i => !estrenosVistos.has(i.id));
    itemsNuevos.forEach(i => estrenosVistos.add(i.id));

    renderCarruselEstrenos('car-estrenos', itemsNuevos, pagina === 1);
    estrenosPagina = pagina;

    const ids = items.filter(i => i.id).map(i => i.id);
    if (ids.length) cargarRatingsCarrusel('car-estrenos', ids);

  } catch (e) {
    console.error('[Estrenos]', e);
    if (pagina === 1) setVacio('car-estrenos', 'Error al cargar estrenos.');
  }

  estrenosCargando = false;
}

// ─────────────────────────────────────────
// 2. Watchlist personal
// ─────────────────────────────────────────
async function cargarWatchlist() {
  setCargando('car-watchlist');
  try {
    const res = await fetch('/api/media/watchlist/movie');
    const items = await res.json();
    renderCarruselDb('car-watchlist', items);
    // Cargar ratings IMDb en segundo plano
    const ids = items.filter(i => i.tmdb_id).map(i => i.tmdb_id);
    if (ids.length) cargarRatingsCarrusel('car-watchlist', ids);
  } catch (e) {
    console.error('[Watchlist]', e);
    setVacio('car-watchlist', 'Error al cargar tu lista.');
  }
}

// ─────────────────────────────────────────
// 3. Catálogo Emby
// ─────────────────────────────────────────
async function cargarEmby() {
  setCargando('car-emby');
  try {
    const res = await fetch('/api/media/emby/movie');
    const items = await res.json();

    if (!Array.isArray(items) || items.length === 0) {
      setVacio('car-emby', 'No se encontraron películas en Emby.');
      return;
    }

    const embyItems = items.map(i => ({
      _embyId: i.Id,
      id: i.ProviderIds?.Tmdb ? parseInt(i.ProviderIds.Tmdb) : null,
      title: i.Name,
      release_date: i.ProductionYear ? String(i.ProductionYear) : '',
      embyImage: i.tmdb_poster_path
        ? `/api/media/img${i.tmdb_poster_path}?size=w500`
        : null,
    }));

    renderCarruselEmby('car-emby', embyItems);

    const idsConTmdb = embyItems.filter(i => i.id).map(i => i.id);
    if (idsConTmdb.length) cargarRatingsEmby(idsConTmdb);

  } catch (e) {
    console.error('[Emby]', e);
    setVacio('car-emby', 'Error al conectar con Emby.');
  }
}

async function cargarRatingsEmby(tmdbIds) {
  try {
    const res = await fetch(`/api/media/ratings-lote?ids=${tmdbIds.join(',')}&tipo=movie`);
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
    console.error('[cargarRatingsEmby]', e);
  }
}

// Carga ratings IMDb para cualquier carrusel por contenedor ID
async function cargarRatingsCarrusel(idContenedor, tmdbIds) {
  try {
    const res = await fetch(`/api/media/ratings-lote?ids=${tmdbIds.join(',')}&tipo=movie`);
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



function renderCarruselEstrenos(idContenedor, items, reset = false) {
  const cont = document.getElementById(idContenedor);
  if (reset) cont.innerHTML = '';

  items.forEach(i => {
    const img = i.poster_path
      ? `/api/media/img${i.poster_path}?size=w500`
      : 'https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen';

    const fechaDisplay = formatearFecha(i.release_date);
    const año = (i.release_date || '').split('-')[0] || '';

    const div = document.createElement('div');
    div.className = 'card card-estreno';
    div.dataset.tmdbId = i.id;
    div.innerHTML = `
      <img src="${img}" loading="lazy" onerror="this.src='https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen'">
      <div class="badge estreno">🆕 ESTRENO</div>
      <div class="card-btn-agregar"
           title="Agregar a mi lista"
           data-id="${i.id}"
           data-title="${encodeURIComponent(i.title || '')}"
           data-orig="${encodeURIComponent(i.original_title || '')}"
           data-poster="${encodeURIComponent(i.poster_path || '')}"
           data-año="${año}"
           data-fecha="${i.release_date || ''}">＋</div>
      <div class="info">
        <div class="title">${i.title || i.name || ''}</div>
        <div class="year">${fechaDisplay || año}</div>
      </div>
    `;

    div.addEventListener('click', (e) => {
      if (e.target.closest('.card-btn-agregar')) return;
      abrirModal('movie', i.id, null, img);
    });

    div.querySelector('.card-btn-agregar').addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = e.currentTarget;
      agregarDesdeEstreno({
        tmdb_id: parseInt(btn.dataset.id),
        tipo: 'movie',
        titulo: decodeURIComponent(btn.dataset.title),
        titulo_original: decodeURIComponent(btn.dataset.orig),
        poster_url: decodeURIComponent(btn.dataset.poster),
        año: parseInt(btn.dataset.año) || null,
        release_date: btn.dataset.fecha || null,
      }, btn);
    });

    cont.appendChild(div);
  });

  // Detector de scroll infinito — solo registrar una vez
  if (reset) {
    cont.onscroll = () => {
      const distanciaAlFinal = cont.scrollWidth - cont.clientWidth - cont.scrollLeft;
      if (distanciaAlFinal <= 300 && !estrenosCargando) {
        cargarEstrenos(estrenosPagina + 1);
      }
    };
  }
}

function renderCarruselEmby(idContenedor, items) {
  const cont = document.getElementById(idContenedor);
  cont.innerHTML = '';

  items.forEach(i => {
    const img = i.embyImage || 'https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen';

    const div = document.createElement('div');
    div.className = 'card';
    if (i.id) div.dataset.tmdbId = i.id;

    div.innerHTML = `
      <img src="${img}" loading="lazy" onerror="this.src='https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen'">
      <div class="badge emby">✅ EMBY</div>
      <div class="info">
        <div class="title">${i.title || ''}</div>
        <div class="year">${i.release_date || ''}</div>
      </div>
    `;

    div.addEventListener('click', () => {
      if (i.id) {
        abrirModal('movie', i.id, i._embyId, img);
      } else {
        window.open(`${embyBaseUrl}/web/index.html#!/details?id=${i._embyId}`, '_blank');
      }
    });

    cont.appendChild(div);
  });
}

function renderCarruselDb(idContenedor, items) {
  const cont = document.getElementById(idContenedor);
  cont.innerHTML = '';

  if (!items.length) {
    setVacio(idContenedor, 'No hay películas en tu lista de espera.');
    return;
  }

  items.forEach(i => {
    const img = i.poster_url
      ? `/api/media/img${i.poster_url}?size=w500`
      : 'https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen';

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
    div.addEventListener('click', () => abrirModal('movie', i.tmdb_id, i.emby_item_id, img));
    cont.appendChild(div);
  });
}

// ─────────────────────────────────────────
// AGREGAR DESDE TARJETA
// ─────────────────────────────────────────
async function agregarDesdeEstreno(datos, btn) {
  btn.innerText = '⏳';
  btn.style.pointerEvents = 'none';

  try {
    const res = await fetch('/api/media/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });

    if (res.ok) {
      btn.innerText = '✔';
      btn.style.background = '#52B54B';
      btn.style.opacity = '1';
      btn.style.transform = 'scale(1)';
      cargarWatchlist();
    } else {
      const err = await res.json().catch(() => ({}));
      console.error('[agregarDesdeEstreno]', err);
      btn.innerText = '✕';
      btn.style.background = '#666';
      btn.style.pointerEvents = 'auto';
    }
  } catch (e) {
    console.error('[agregarDesdeEstreno]', e);
    btn.innerText = '✕';
    btn.style.pointerEvents = 'auto';
  }
}

// ─────────────────────────────────────────
// IGNORAR
// ─────────────────────────────────────────
async function ignorarItem() {
  const { id, title, name, tipo } = currentModalItem;

  const res = await fetch('/api/media/ignorar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmdb_id: id, tipo, titulo: title || name }),
  });

  if (res.ok) {
    closeModal();
    cargarEstrenos();
  }
}

async function dejarDeIgnorar() {
  const { id, tipo } = currentModalItem;

  const res = await fetch(`/api/media/ignorar/${tipo}/${id}`, { method: 'DELETE' });

  if (res.ok) {
    closeModal();
    cargarEstrenos();
  }
}

// ─────────────────────────────────────────
// MODAL DE DETALLE
// ─────────────────────────────────────────
let currentModalItem = null;

async function abrirModal(tipo, tmdbId, embyId, localCover) {
  if (!tmdbId) return;

  const modal = document.getElementById('modalDetalle');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  document.getElementById('md-title').innerText = 'Cargando...';
  document.getElementById('md-desc').innerText = '';
  document.getElementById('md-ratings').innerHTML = '';
  document.getElementById('md-cast').innerHTML = '';
  document.getElementById('md-genres').innerHTML = '';
  document.getElementById('md-actions').innerHTML = '';
  document.getElementById('md-poster').src = localCover || '';
  document.getElementById('md-bg').style.backgroundImage = '';

  try {
    const res = await fetch(`/api/media/detalle/${tipo}/${tmdbId}`);
    const data = await res.json();
    currentModalItem = { ...data, tipo };

    if (data.poster_path)
      document.getElementById('md-poster').src = `/api/media/img${data.poster_path}?size=w500`;
    if (data.backdrop_path)
      document.getElementById('md-bg').style.backgroundImage = `url(/api/media/img${data.backdrop_path}?size=original)`;

    document.getElementById('md-title').innerText = data.title || data.name || '';
    document.getElementById('md-type').innerText = tipo === 'movie' ? '🎬 Película' : '📺 Serie';

    const fechaRaw = data.release_date || data.first_air_date || '';
    let metaTexto = formatearFecha(fechaRaw) || fechaRaw.split('-')[0] || '';
    if (tipo === 'movie' && data.runtime) metaTexto += ` • ${data.runtime} min`;
    document.getElementById('md-year').innerText = metaTexto;

    const statusEl = document.getElementById('md-status');
    if (data.neon_estado === 'en_emby') {
      statusEl.innerText = '✅ Disponible en Emby';
      statusEl.style.color = '#52B54B';
    } else if (data.neon_estado === 'pendiente') {
      statusEl.innerText = '🕒 En lista de espera';
      statusEl.style.color = '#FF9800';
    } else {
      statusEl.innerText = '';
    }

    document.getElementById('md-desc').innerText = data.overview || 'Sin sinopsis disponible.';

    const genDiv = document.getElementById('md-genres');
    (data.genres || []).forEach(g => {
      const sp = document.createElement('span');
      sp.innerText = g.name;
      genDiv.appendChild(sp);
    });

    const ratDiv = document.getElementById('md-ratings');
    const imdbId = data.external_ids?.imdb_id;
    if (data.ratings?.imdb_rating) {
      ratDiv.innerHTML += `<div class="rating-item"><img src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" alt="IMDb"> ${data.ratings.imdb_rating}/10</div>`;
    } else {
      // Sin rating IMDb — mostrar logo con link + botón manual
      ratDiv.innerHTML += `
        <div class="rating-item" style="gap:6px;">
          <a href="https://www.imdb.com/title/${imdbId || ''}/" target="_blank" title="Ver en IMDb">
            <img src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" alt="IMDb" style="height:20px;">
          </a>
          <button onclick="abrirModalRatingManual()" style="background:#f5c518;color:#000;border:none;border-radius:4px;padding:2px 8px;font-weight:700;cursor:pointer;font-size:0.9rem;" title="Ingresar rating manualmente">?</button>
        </div>`;
    }
    if (data.ratings?.rt_score)
      ratDiv.innerHTML += `<div class="rating-item"><img src="https://upload.wikimedia.org/wikipedia/commons/5/5b/Rotten_Tomatoes.svg" alt="RT"> ${data.ratings.rt_score}%</div>`;
    if (data.ratings?.metacritic_score)
      ratDiv.innerHTML += `<div class="rating-item"><span style="background:#66CC33;color:white;padding:2px 6px;border-radius:4px;font-weight:bold;">M</span> ${data.ratings.metacritic_score}</div>`;

    const castDiv = document.getElementById('md-cast');
    (data.credits?.cast || []).slice(0, 10).forEach(c => {
      const foto = c.profile_path
        ? `/api/media/img${c.profile_path}?size=w185`
        : 'https://placehold.co/150x150/1a1a1a/666?text=?';
      castDiv.innerHTML += `
        <div class="cast-card" onclick="abrirPersona(${c.id})">
          <img src="${foto}">
          <div class="cast-name">${c.name}</div>
          <div class="cast-char">${c.character || ''}</div>
        </div>`;
    });

    renderBotonesModal(data, tipo);

  } catch (e) {
    console.error('[Modal]', e);
    document.getElementById('md-title').innerText = 'Error al cargar la información.';
  }
}

function renderBotonesModal(data, tipo) {
  const acts = document.getElementById('md-actions');
  acts.innerHTML = '';

  // Tráiler
  const trailer = data.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer');
  if (trailer)
    acts.innerHTML += `<a href="https://www.youtube.com/watch?v=${trailer.key}" target="_blank" class="btn btn-trailer">▶ Tráiler</a>`;

  // Acción principal según estado
  if (data.neon_estado === 'en_emby' && data.emby_id) {
    acts.innerHTML += `<a href="${embyBaseUrl}/web/index.html#!/details?id=${data.emby_id}" target="_blank" class="btn btn-emby">▶ Reproducir en Emby</a>`;
  } else if (data.neon_estado === 'pendiente') {
    acts.innerHTML += `<button class="btn btn-quitar" onclick="quitarWatchlist(${data.id}, '${tipo}')">✕ Quitar de lista</button>`;
  } else {
    acts.innerHTML += `<button class="btn btn-add" onclick="agregarWatchlist()">+ Ver luego</button>`;
  }

  // Botón ignorar — solo para ítems que no están en Emby ni en lista
  // (no tiene sentido ignorar algo que ya estás siguiendo)
  if (!data.neon_estado) {
    if (data.ignorado) {
      acts.innerHTML += `<button class="btn btn-quitar" onclick="dejarDeIgnorar()" style="background:#444;">↩ Dejar de ignorar</button>`;
    } else {
      acts.innerHTML += `<button class="btn btn-quitar" onclick="ignorarItem()" style="background:#333;">🚫 Ignorar</button>`;
    }
  }
}

async function agregarWatchlist() {
  const { id, title, name, original_title, original_name, poster_path, release_date, first_air_date, tipo } = currentModalItem;

  const res = await fetch('/api/media/watchlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tmdb_id: id,
      tipo,
      titulo: title || name,
      titulo_original: original_title || original_name,
      poster_url: poster_path,
      año: parseInt((release_date || first_air_date || '').split('-')[0]) || null,
      release_date: release_date || first_air_date || null,
    }),
  });

  if (res.ok) {
    closeModal();
    cargarWatchlist();
  }
}

async function quitarWatchlist(tmdbId, tipo) {
  await fetch(`/api/media/watchlist/${tipo}/${tmdbId}`, { method: 'DELETE' });
  closeModal();
  cargarWatchlist();
}

async function abrirPersona(personaId) {
  // Guardar estado del modal actual para poder volver
  window._modalAnterior = currentModalItem ? { ...currentModalItem } : null;
  closeModal();
  setTimeout(() => abrirPerfilPersona(personaId), 300);
}

function closeModal() {
  document.getElementById('modalDetalle').classList.remove('active');
  document.body.style.overflow = 'auto';
  currentModalItem = null;
}

function setCargando(id) {
  const cont = document.getElementById(id);
  if (cont) cont.innerHTML = '<span class="cargando">Cargando...</span>';
}

function setVacio(id, mensaje) {
  const cont = document.getElementById(id);
  if (cont) cont.innerHTML = `<span class="vacio">${mensaje}</span>`;
}
// ─────────────────────────────────────────
// RATING MANUAL
// ─────────────────────────────────────────
function abrirModalRatingManual() {
  const modal = document.getElementById('modalRatingManual');
  if (modal) {
    document.getElementById('inputRatingManual').value = '';
    modal.classList.add('active');
  }
}

function cerrarModalRatingManual() {
  document.getElementById('modalRatingManual').classList.remove('active');
}

async function guardarRatingManual() {
  const valor = document.getElementById('inputRatingManual').value.trim().replace(',', '.');
  const rating = parseFloat(valor);

  if (isNaN(rating) || rating < 0 || rating > 10) {
    document.getElementById('errorRatingManual').innerText = 'Ingresa un número entre 0 y 10 (ej: 7.6)';
    return;
  }

  const { id, tipo } = currentModalItem;
  const imdbId = currentModalItem.external_ids?.imdb_id;

  const res = await fetch('/api/media/ratings/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tmdb_id: id, tipo, imdb_id: imdbId, imdb_rating: rating }),
  });

  if (res.ok) {
    cerrarModalRatingManual();
    // Recargar el modal para mostrar el nuevo rating
    abrirModal(tipo, id, currentModalItem.emby_id, null);
  } else {
    document.getElementById('errorRatingManual').innerText = 'Error al guardar.';
  }
}