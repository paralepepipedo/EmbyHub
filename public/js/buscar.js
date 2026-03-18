// ============================================================
// RUTA: public/js/buscar.js
// VERSIÓN: v2.0
// CAMBIOS:
//   - Selector de fuente: TMDB, Mi Biblioteca (Neon), Emby, IGDB
//   - Tabs dinámicos según la fuente seleccionada
//   - Búsqueda en Neon: watchlist + juegos
//   - Búsqueda en Emby: películas y series del servidor
//   - Búsqueda en IGDB: juegos
//   - Badges de color por fuente en cada resultado
// ============================================================

let currentTab = 'multi';
let currentFuente = 'tmdb';
let searchTimeout = null;

// Configuración de tabs por fuente
const TABS_POR_FUENTE = {
  tmdb: [
    { id: 'multi', label: 'Todo' },
    { id: 'movie', label: 'Películas' },
    { id: 'tv', label: 'Series' },
    { id: 'person', label: 'Personas' },
  ],
  neon: [
    { id: 'all', label: 'Todo' },
    { id: 'movie', label: 'Películas' },
    { id: 'tv', label: 'Series' },
    { id: 'juegos', label: 'Juegos' },
  ],
  emby: [
    { id: 'all', label: 'Todo' },
    { id: 'movie', label: 'Películas' },
    { id: 'tv', label: 'Series' },
  ],
  igdb: [],
};

document.addEventListener('DOMContentLoaded', async () => {
  const me = await requireAuth();
  if (!me) return;
  document.getElementById('userName').innerText = me.nombre;
  document.getElementById('userAvatar').innerText = me.avatar;

  const input = document.getElementById('searchInput');
  if (input) {
    input.focus();
    input.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => realizarBusqueda(e.target.value), 500);
    });
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('persona')) abrirPerfilPersona(params.get('persona'));
});

// ─────────────────────────────────────────
// CAMBIO DE FUENTE
// ─────────────────────────────────────────
function setFuente(fuente) {
  currentFuente = fuente;
  currentTab = TABS_POR_FUENTE[fuente][0]?.id || 'all';

  // Actualizar botones de fuente
  document.querySelectorAll('.source-tab').forEach(b => {
    b.className = 'source-tab';
  });
  document.getElementById(`src-${fuente}`).classList.add(`active-${fuente}`);

  // Actualizar tabs de tipo
  renderTabs(fuente);

  // Limpiar resultados y re-buscar si hay query
  const q = document.getElementById('searchInput').value;
  if (q.trim()) realizarBusqueda(q);
  else document.getElementById('searchGrid').innerHTML = '';
}

function renderTabs(fuente) {
  const tabs = TABS_POR_FUENTE[fuente];
  const cont = document.getElementById('typeTabs');

  if (!tabs.length) {
    cont.style.display = 'none';
    return;
  }

  cont.style.display = 'flex';
  cont.innerHTML = tabs.map((t, idx) =>
    `<div class="tab ${idx === 0 ? 'active' : ''}" onclick="setTab('${t.id}')">${t.label}</div>`
  ).join('');
}

function setTab(tipo) {
  currentTab = tipo;
  document.querySelectorAll('#typeTabs .tab').forEach(t => t.classList.remove('active'));
  event.target.classList.add('active');
  realizarBusqueda(document.getElementById('searchInput').value);
}

// ─────────────────────────────────────────
// BÚSQUEDA SEGÚN FUENTE
// ─────────────────────────────────────────
async function realizarBusqueda(query) {
  if (!query || query.trim() === '') {
    document.getElementById('searchGrid').innerHTML = '';
    return;
  }

  document.getElementById('searchGrid').innerHTML = '<span class="cargando">Buscando...</span>';

  try {
    switch (currentFuente) {
      case 'tmdb': await buscarTMDB(query); break;
      case 'neon': await buscarNeon(query); break;
      case 'emby': await buscarEmby(query); break;
      case 'igdb': await buscarIGDB(query); break;
    }
  } catch (e) {
    console.error('[buscar]', e);
    document.getElementById('searchGrid').innerHTML = '<span class="vacio">Error al buscar.</span>';
  }
}

// ── TMDB ─────────────────────────────────
async function buscarTMDB(query) {
  const [tmdbRes, embyRes, watchRes] = await Promise.all([
    fetch(`/api/media/buscar?q=${encodeURIComponent(query)}&tipo=${currentTab}`),
    fetch('/api/media/emby/movie').catch(() => ({ json: () => [] })),
    fetch('/api/media/watchlist/movie').catch(() => ({ json: () => [] })),
  ]);
  const items = await tmdbRes.json();
  const embyItems = await embyRes.json();
  const watchItems = await watchRes.json();
  const embyIds = new Set((Array.isArray(embyItems) ? embyItems : []).filter(i => i.ProviderIds?.Tmdb).map(i => parseInt(i.ProviderIds.Tmdb)));
  const watchIds = new Set((Array.isArray(watchItems) ? watchItems : []).map(i => i.tmdb_id));
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';
  if (!items.length) { grid.innerHTML = '<span class="vacio">Sin resultados en TMDB.</span>'; return; }
  items.forEach(i => {
    if (i.media_type === 'person' && !i.profile_path) return;
    let tipoLocal = i.media_type || currentTab;
    if (tipoLocal === 'multi') tipoLocal = 'movie';
    const imgP = i.poster_path || i.profile_path;
    const img = imgP ? `/api/media/img${imgP}?size=w500` : 'https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen';
    let badgeHtml = '<div class="badge" style="background:#01b4e4;color:white;">TMDB</div>';
    if (tipoLocal !== 'person') {
      if (embyIds.has(i.id)) badgeHtml = '<div class="badge" style="background:rgba(82,181,75,0.9);color:white;">✅ EMBY</div>';
      else if (watchIds.has(i.id)) badgeHtml = '<div class="badge" style="background:rgba(255,152,0,0.9);color:white;">🕒 ESPERA</div>';
    }
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<img src="${img}" loading="lazy" onerror="this.src='https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen'">${badgeHtml}<div class="info"><div class="title">${i.title || i.name}</div><div class="year">${(i.release_date || i.first_air_date || '').split('-')[0]}${tipoLocal === 'person' ? ' · Actor' : ''}</div></div>`;
    div.onclick = () => tipoLocal === 'person' ? abrirPerfilPersona(i.id) : abrirModal(tipoLocal, i.id, null, img);
    grid.appendChild(div);
  });
}

// ── NEON (Mi Biblioteca) ─────────────────
async function buscarNeon(query) {
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';

  const q = query.toLowerCase();

  // Determinar qué buscar según el tab
  const buscarMedia = currentTab === 'all' || currentTab === 'movie' || currentTab === 'tv';
  const buscarJuegos = currentTab === 'all' || currentTab === 'juegos';

  let hayResultados = false;

  if (buscarMedia) {
    const tipoFiltro = currentTab === 'movie' ? 'movie' : currentTab === 'tv' ? 'tv' : null;
    const res = await fetch('/api/buscar/neon/media?q=' + encodeURIComponent(query) + (tipoFiltro ? '&tipo=' + tipoFiltro : ''));
    const items = await res.json();

    items.forEach(i => {
      hayResultados = true;
      const img = i.poster_url ? `/api/media/img${i.poster_url}?size=w500` : 'https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen';
      const div = document.createElement('div');
      div.className = 'card';
      const estadoColor = i.estado === 'en_emby' ? '#52B54B' : i.estado === 'pendiente' ? '#FF9800' : '#555';
      div.innerHTML = `
        <img src="${img}" loading="lazy" onerror="this.src='https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen'">
        <div class="badge" style="background:${estadoColor};color:white;">${i.estado === 'en_emby' ? '✅ EMBY' : '🕒 ESPERA'}</div>
        <div class="info">
          <div class="title">${i.titulo}</div>
          <div class="year">${i.año || ''}</div>
        </div>
      `;
      div.onclick = () => abrirModal(i.tipo, i.tmdb_id, i.emby_item_id, img);
      grid.appendChild(div);
    });
  }

  if (buscarJuegos) {
    const res = await fetch('/api/buscar/neon/juegos?q=' + encodeURIComponent(query));
    const items = await res.json();

    items.forEach(j => {
      hayResultados = true;
      const img = j.cover_url || 'https://placehold.co/150x200/1a1a1a/666?text=Sin+imagen';
      const div = document.createElement('div');
      div.className = 'card';
      div.innerHTML = `
        <img src="${img}" loading="lazy" onerror="this.src='https://placehold.co/150x200/1a1a1a/666?text=Sin+imagen'">
        <div class="badge" style="background:#9146ff;color:white;">🎮 JUEGO</div>
        <div class="info">
          <div class="title">${j.titulo}</div>
          <div class="year">${j.año || ''} · ${j.estado || ''}</div>
        </div>
      `;
      grid.appendChild(div);
    });
  }

  if (!hayResultados) grid.innerHTML = '<span class="vacio">Sin resultados en tu biblioteca.</span>';
}

// ── EMBY ─────────────────────────────────
async function buscarEmby(query) {
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';

  const tipo = currentTab === 'movie' ? 'movie' : currentTab === 'tv' ? 'tv' : null;
  const url = `/api/buscar/emby?q=${encodeURIComponent(query)}${tipo ? '&tipo=' + tipo : ''}`;
  const res = await fetch(url);
  const items = await res.json();

  if (!items.length) { grid.innerHTML = '<span class="vacio">Sin resultados en Emby.</span>'; return; }

  const embyBaseUrl = 'http://emby4.ddns.net:8096';

  items.forEach(i => {
    const img = i.ImageTags?.Primary
      ? `${embyBaseUrl}/Items/${i.Id}/Images/Primary?maxHeight=750&quality=90`
      : 'https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen';

    const tmdbId = i.ProviderIds?.Tmdb ? parseInt(i.ProviderIds.Tmdb) : null;
    const tipoItem = i.Type === 'Movie' ? 'movie' : 'tv';

    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <img src="${img}" loading="lazy" onerror="this.src='https://placehold.co/500x750/1a1a1a/666?text=Sin+Imagen'">
      <div class="badge" style="background:#52B54B;color:white;">✅ EMBY</div>
      <div class="info">
        <div class="title">${i.Name}</div>
        <div class="year">${i.ProductionYear || ''}</div>
      </div>
    `;
    div.onclick = () => {
      if (tmdbId) abrirModal(tipoItem, tmdbId, i.Id, img);
      else window.open(`${embyBaseUrl}/web/index.html#!/details?id=${i.Id}`, '_blank');
    };
    grid.appendChild(div);
  });
}

// ── IGDB ─────────────────────────────────
async function buscarIGDB(query) {
  const grid = document.getElementById('searchGrid');
  grid.innerHTML = '';

  const res = await fetch(`/api/juegos/buscar?q=${encodeURIComponent(query)}`);
  const items = await res.json();

  if (!items.length) { grid.innerHTML = '<span class="vacio">Sin resultados en IGDB.</span>'; return; }

  items.forEach(item => {
    const img = item.cover?.url
      ? 'https:' + item.cover.url.replace(/t_[a-z_]+/, 't_cover_big')
      : 'https://placehold.co/150x200/1a1a1a/666?text=Sin+imagen';
    const año = item.first_release_date ? new Date(item.first_release_date * 1000).getFullYear() : '';
    const devs = item.involved_companies?.map(c => c.company.name).join(', ') || '';

    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `
      <img src="${img}" loading="lazy" onerror="this.src='https://placehold.co/150x200/1a1a1a/666?text=Sin+imagen'">
      <div class="badge" style="background:#9146ff;color:white;">IGDB</div>
      <div class="info">
        <div class="title">${item.name}</div>
        <div class="year">${año}${devs ? ' · ' + devs : ''}</div>
      </div>
    `;
    grid.appendChild(div);
  });
}

// ─────────────────────────────────────────
// PERFIL DE ACTOR / DIRECTOR
// ─────────────────────────────────────────
async function abrirPerfilPersona(id) {
  const modal = document.getElementById('modalDetalle');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  document.getElementById('md-title').innerText = 'Cargando...';
  document.getElementById('md-desc').innerText = '';
  document.getElementById('md-ratings').innerHTML = '';
  document.getElementById('md-genres').innerHTML = '';
  document.getElementById('md-actions').innerHTML = window._modalAnterior
    ? `<button class="btn btn-quitar" onclick="volverModalAnterior()">← Volver a ${window._modalAnterior.title || window._modalAnterior.name || 'película'}</button>`
    : '';
  document.getElementById('md-cast').innerHTML = '';
  document.getElementById('md-bg').style.backgroundImage = 'none';
  document.getElementById('md-status').innerText = '';

  try {
    const res = await fetch(`/api/media/persona/${id}`);
    const data = await res.json();

    if (data.profile_path)
      document.getElementById('md-poster').src = `/api/media/img${data.profile_path}?size=w342`;

    document.getElementById('md-title').innerText = data.name || '';
    document.getElementById('md-type').innerText = '🎭 ' + (data.known_for_department || 'Actor');
    document.getElementById('md-year').innerText = data.birthday ? `Nació: ${formatearFecha(data.birthday)}` : '';
    document.getElementById('md-desc').innerText = data.biography || 'Sin biografía disponible.';

    const soloFilmes = (data.combined_credits?.cast || [])
      .filter(c => c.media_type === 'movie' && c.poster_path && c.release_date)
      .sort((a, b) => (parseInt(b.release_date) || 0) - (parseInt(a.release_date) || 0));

    const vistos = new Set();
    const filmes = soloFilmes.filter(c => { if (vistos.has(c.id)) return false; vistos.add(c.id); return true; });

    let embyTmdbIds = new Set();
    try {
      const resEmby = await fetch('/api/media/emby/movie');
      const embyItems = await resEmby.json();
      embyItems.forEach(i => { if (i.ProviderIds?.Tmdb) embyTmdbIds.add(parseInt(i.ProviderIds.Tmdb)); });
    } catch (e) { }

    const enEmby = filmes.filter(c => embyTmdbIds.has(c.id));
    const resto = filmes.filter(c => !embyTmdbIds.has(c.id));
    const ordenados = [...enEmby, ...resto];

    const ratDiv = document.getElementById('md-ratings');
    ratDiv.innerHTML += `<div style="width:100%; margin-top:0.5rem;"><h3 style="color:white; font-size:1rem;">Filmografía (${ordenados.length} películas)</h3></div>`;

    const castDiv = document.getElementById('md-cast');
    castDiv.innerHTML = '';
    const carrusel = document.createElement('div');
    carrusel.style.cssText = 'display:flex; gap:0.8rem; overflow-x:auto; padding-bottom:0.5rem; width:100%;';

    ordenados.forEach(c => {
      const url = `/api/media/img${c.poster_path}?size=w342`;
      const año = c.release_date?.split('-')[0] || '';
      const enEm = embyTmdbIds.has(c.id);

      const item = document.createElement('div');
      item.style.cssText = 'flex:0 0 120px; cursor:pointer; position:relative;';
      item.innerHTML = `
        <img src="${url}" style="width:120px; height:180px; object-fit:cover; border-radius:8px; display:block;">
        ${enEm ? '<div style="position:absolute;top:5px;left:5px;background:rgba(82,181,75,0.9);color:white;font-size:0.6rem;font-weight:700;padding:2px 6px;border-radius:4px;">✅ EMBY</div>' : ''}
        <div style="font-size:0.75rem; font-weight:600; margin-top:4px; line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden;">${c.title || ''}</div>
        <div style="font-size:0.68rem; color:#888; margin-top:2px;">${año}</div>
      `;
      item.onclick = () => {
        window._modalAnterior = null;
        closeModal();
        setTimeout(() => abrirModal('movie', c.id, null, url), 300);
      };
      carrusel.appendChild(item);
    });

    castDiv.appendChild(carrusel);

  } catch (e) {
    console.error('[abrirPerfilPersona]', e);
    document.getElementById('md-title').innerText = 'Error al cargar el perfil.';
  }
}

function volverModalAnterior() {
  if (!window._modalAnterior) return;
  const item = window._modalAnterior;
  window._modalAnterior = null;
  closeModal();
  setTimeout(() => abrirModal(item.tipo || 'movie', item.id, item.emby_id || null, null), 300);
}