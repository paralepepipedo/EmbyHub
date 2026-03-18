// ============================================================
// RUTA: public/js/peliculas.js
// VERSIÓN: v1.7
// CAMBIOS:
//   - Botón "🚫 Ignorar" en modal de detalle para estrenos
//   - Si ya está ignorado muestra "↩ Dejar de ignorar"
//   - Al ignorar se recarga el carrusel de estrenos
//   - ignorarItem() y dejarDeIgnorar() como funciones globales
// ============================================================

const embyBaseUrl = window.EMBY_BASE_URL || 'http://emby4.ddns.net:8096';

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
});

// ─────────────────────────────────────────
// 1. Próximos estrenos
// ─────────────────────────────────────────
async function cargarEstrenos() {
  setCargando('car-estrenos');
  try {
    const res = await fetch('/api/media/peliculas/estrenos');
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      setVacio('car-estrenos', 'No hay estrenos próximos.');
      return;
    }
    renderCarruselEstrenos('car-estrenos', items);
  } catch (e) {
    console.error('[Estrenos]', e);
    setVacio('car-estrenos', 'Error al cargar estrenos.');
  }
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
      embyImage: i.ImageTags?.Primary
        ? `${embyBaseUrl}/Items/${i.Id}/Images/Primary?maxHeight=750&quality=90`
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

// ─────────────────────────────────────────
// RENDERS
// ─────────────────────────────────────────

function renderCarruselEstrenos(idContenedor, items) {
  const cont = document.getElementById(idContenedor);
  cont.innerHTML = '';

  items.forEach(i => {
    const img = i.poster_path
      ? `/api/media/img${i.poster_path}?size=w500`
      : 'https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen';

    const fechaDisplay = formatearFecha(i.release_date);
    const año = (i.release_date || '').split('-')[0] || '';

    const div = document.createElement('div');
    div.className = 'card card-estreno';
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
    if (data.ratings) {
      if (data.ratings.imdb_rating)
        ratDiv.innerHTML += `<div class="rating-item"><img src="https://upload.wikimedia.org/wikipedia/commons/6/69/IMDB_Logo_2016.svg" alt="IMDb"> ${data.ratings.imdb_rating}/10</div>`;
      if (data.ratings.rt_score)
        ratDiv.innerHTML += `<div class="rating-item"><img src="https://upload.wikimedia.org/wikipedia/commons/5/5b/Rotten_Tomatoes.svg" alt="RT"> ${data.ratings.rt_score}%</div>`;
      if (data.ratings.metacritic_score)
        ratDiv.innerHTML += `<div class="rating-item"><span style="background:#66CC33;color:white;padding:2px 6px;border-radius:4px;font-weight:bold;">M</span> ${data.ratings.metacritic_score}</div>`;
    }

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