// ============================================================
// RUTA: public/js/juegos.js
// VERSIÓN: v2.2
// CAMBIOS:
//   - Agrega estado 'terminado' al objeto SECCIONES
//   - Agrega opción Terminado en selectores de estado
// ============================================================

let igdbTimeout = null;
let currentGame = null;
let modoActualizacion = false;

const SECCIONES = {
  instalado: { sec: 'instalados', car: 'car-instalados', cnt: 'cnt-instalados', badge: 'instalado', label: '✅ INSTALADO' },
  en_biblioteca: { sec: 'biblioteca', car: 'car-biblioteca', cnt: 'cnt-biblioteca', badge: 'en_biblioteca', label: '📚 BIBLIOTECA' },
  descargado_no_instalable: { sec: 'descargados', car: 'car-descargados', cnt: 'cnt-descargados', badge: 'descargado', label: '⬇️ DESCARGADO' },
  por_descargar: { sec: 'pordescargar', car: 'car-pordescargar', cnt: 'cnt-pordescargar', badge: 'por_descargar', label: '📥 POR DESCARGAR' },
  descargado_no_instalable_recursos: { sec: 'recursos', car: 'car-recursos', cnt: 'cnt-recursos', badge: 'falta_recursos', label: '⚠️ RECURSOS' },
  deseado: { sec: 'deseados', car: 'car-deseados', cnt: 'cnt-deseados', badge: 'deseado', label: '❤️ DESEADO' },
  terminado: { sec: 'terminados', car: 'car-terminados', cnt: 'cnt-terminados', badge: 'terminado', label: '🏆 TERMINADO' },
};

const PLACEHOLDER = 'https://placehold.co/150x200/1a1a1a/666?text=Sin+imagen';

function igdbImg(url, size = 't_cover_big') {
  if (!url) return PLACEHOLDER;
  return 'https:' + url.replace(/t_[a-z_]+/, size);
}

document.addEventListener('DOMContentLoaded', async () => {
  const me = await requireAuth();
  if (!me) return;
  document.getElementById('userName').innerText = me.nombre;
  document.getElementById('userAvatar').innerText = me.avatar;

  cargarBiblioteca();
  cargarProximos();

  document.getElementById('igdbInput').addEventListener('input', e => {
    clearTimeout(igdbTimeout);
    igdbTimeout = setTimeout(() => buscarIGDB(e.target.value), 600);
  });
});

// ─────────────────────────────────────────
// CARGAR BIBLIOTECA
// ─────────────────────────────────────────
async function cargarBiblioteca() {
  try {
    const res = await fetch('/api/juegos/lista');
    const juegos = await res.json();

    Object.values(SECCIONES).forEach(s => {
      document.getElementById('sec-' + s.sec).style.display = 'none';
      document.getElementById(s.car).innerHTML = '';
      document.getElementById(s.cnt).innerText = '0';
    });

    const contadores = {};
    Object.keys(SECCIONES).forEach(k => { contadores[k] = 0; });

    juegos.forEach(j => {
      const sec = SECCIONES[j.estado];
      if (!sec) return;
      contadores[j.estado]++;
      document.getElementById('sec-' + sec.sec).style.display = 'block';
      document.getElementById(sec.car).appendChild(crearTarjetaJuego(j, sec));
    });

    Object.entries(contadores).forEach(([estado, n]) => {
      const s = SECCIONES[estado];
      if (s) document.getElementById(s.cnt).innerText = n;
    });

  } catch (e) {
    console.error('[cargarBiblioteca]', e);
  }
}

function crearTarjetaJuego(j, sec) {
  const img = j.cover_url || PLACEHOLDER;
  const div = document.createElement('div');
  div.className = 'juego-card';
  div.innerHTML = `
    <img src="${img}" loading="lazy" onerror="this.src='${PLACEHOLDER}'">
    <div class="juego-badge ${sec.badge}">${sec.label}</div>
    <div class="info">
      <div class="title">${j.titulo}</div>
      <div class="year">${j.año || ''}</div>
    </div>
  `;
  div.addEventListener('click', () => abrirDetalle(j));
  return div;
}

// ─────────────────────────────────────────
// PRÓXIMOS ESTRENOS
// ─────────────────────────────────────────
async function cargarProximos() {
  const car = document.getElementById('car-proximos');
  const cnt = document.getElementById('cnt-proximos');
  car.innerHTML = '<span class="juegos-vacio">Cargando...</span>';

  try {
    const res = await fetch('/api/juegos/proximos');
    const items = await res.json();
    car.innerHTML = '';
    cnt.innerText = items.length;

    if (!items.length) {
      car.innerHTML = '<span class="juegos-vacio">No hay próximos estrenos disponibles.</span>';
      return;
    }

    items.forEach(item => {
      const img = igdbImg(item.cover?.url, 't_cover_big');
      const año = item.first_release_date
        ? new Date(item.first_release_date * 1000).getFullYear() : '';

      const div = document.createElement('div');
      div.className = 'juego-card';
      div.innerHTML = `
        <img src="${img}" loading="lazy" onerror="this.src='${PLACEHOLDER}'">
        <div class="juego-badge proximo">🔜 PRÓXIMO</div>
        <div class="info">
          <div class="title">${item.name}</div>
          <div class="year">${año}</div>
        </div>
      `;
      div.addEventListener('click', () => agregarDesdeIGDB(item, 'deseado', true));
      car.appendChild(div);
    });

  } catch (e) {
    console.error('[cargarProximos]', e);
    car.innerHTML = '<span class="juegos-vacio">Error al cargar próximos estrenos.</span>';
  }
}

// ─────────────────────────────────────────
// BUSCADOR IGDB
// ─────────────────────────────────────────
function abrirBuscadorIGDB() {
  modoActualizacion = false;
  document.getElementById('igdbEstado').style.display = 'block';
  document.getElementById('igdb-modo-label').innerText = 'Agregar en sección:';
  document.getElementById('modalIGDB').classList.add('active');
  document.getElementById('igdbInput').value = '';
  document.getElementById('igdbResults').innerHTML = '';
  document.getElementById('igdbLoading').style.display = 'none';
  setTimeout(() => document.getElementById('igdbInput').focus(), 100);
}

function abrirBuscadorActualizacion() {
  modoActualizacion = true;
  document.getElementById('igdbEstado').style.display = 'none';
  document.getElementById('igdb-modo-label').innerText = `Selecciona el resultado correcto para "${currentGame.titulo}":`;
  document.getElementById('modalIGDB').classList.add('active');
  const input = document.getElementById('igdbInput');
  input.value = currentGame.titulo;
  document.getElementById('igdbResults').innerHTML = '';
  document.getElementById('igdbLoading').style.display = 'none';
  buscarIGDB(currentGame.titulo);
  setTimeout(() => input.focus(), 100);
}

function cerrarIGDB() {
  document.getElementById('modalIGDB').classList.remove('active');
  modoActualizacion = false;
}

async function buscarIGDB(query) {
  if (!query || query.length < 3) return;

  const loading = document.getElementById('igdbLoading');
  const results = document.getElementById('igdbResults');
  loading.style.display = 'block';
  results.innerHTML = '';

  try {
    const res = await fetch(`/api/juegos/buscar?q=${encodeURIComponent(query)}`);
    const items = await res.json();
    loading.style.display = 'none';

    if (!items.length) {
      results.innerHTML = '<div class="igdb-loading">Sin resultados.</div>';
      return;
    }

    items.forEach(item => {
      const img = igdbImg(item.cover?.url, 't_cover_small');
      const año = item.first_release_date
        ? new Date(item.first_release_date * 1000).getFullYear() : '';
      const devs = item.involved_companies?.map(c => c.company.name).join(', ') || 'Desconocido';
      const btnLabel = modoActualizacion ? '✔ Usar este' : '+ Añadir';

      const div = document.createElement('div');
      div.className = 'igdb-item';
      div.innerHTML = `
        <img src="${img}" onerror="this.src='https://placehold.co/48x64/1a1a1a/666?text=NA'">
        <div class="igdb-item-info">
          <div class="igdb-item-title">${item.name}</div>
          <div class="igdb-item-meta">${año} • ${devs}</div>
        </div>
        <button class="btn btn-emby" style="padding:5px 14px; font-size:0.85rem; flex-shrink:0;">${btnLabel}</button>
      `;
      div.querySelector('button').addEventListener('click', (e) => {
        e.stopPropagation();
        if (modoActualizacion) {
          actualizarDatosDesdeIGDB(item);
        } else {
          const estado = document.getElementById('igdbEstado').value;
          agregarDesdeIGDB(item, estado, false);
        }
      });
      results.appendChild(div);
    });

  } catch (e) {
    loading.innerText = 'Error al buscar.';
  }
}

async function agregarDesdeIGDB(item, estado, esProximo = false) {
  if (!esProximo) cerrarIGDB();

  const coverUrl = item.cover?.url ? igdbImg(item.cover.url, 't_cover_big') : null;

  const payload = {
    igdb_id: item.id,
    titulo: item.name,
    cover_url: coverUrl,
    descripcion: item.summary || '',
    generos: item.genres?.map(g => g.name) || [],
    plataformas: item.platforms?.map(p => p.name) || [],
    desarrollador: item.involved_companies?.[0]?.company?.name || null,
    año: item.first_release_date
      ? new Date(item.first_release_date * 1000).getFullYear() : null,
    estado,
    notas_personales: '',
  };

  try {
    const res = await fetch('/api/juegos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) cargarBiblioteca();
    else console.error('[agregarDesdeIGDB]', await res.json());
  } catch (e) {
    console.error('[agregarDesdeIGDB]', e);
  }
}

async function actualizarDatosDesdeIGDB(item) {
  if (!currentGame) return;
  cerrarIGDB();

  const coverUrl = item.cover?.url ? igdbImg(item.cover.url, 't_cover_big') : currentGame.cover_url;

  const payload = {
    igdb_id: item.id,
    cover_url: coverUrl,
    descripcion: item.summary || currentGame.descripcion,
    generos: item.genres?.map(g => g.name) || currentGame.generos,
    plataformas: item.platforms?.map(p => p.name) || currentGame.plataformas,
    desarrollador: item.involved_companies?.[0]?.company?.name || currentGame.desarrollador,
    año: item.first_release_date
      ? new Date(item.first_release_date * 1000).getFullYear()
      : currentGame.año,
  };

  try {
    const res = await fetch(`/api/juegos/${currentGame.id}/metadata`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      cerrarModal();
      cargarBiblioteca();
    } else {
      console.error('[actualizarDatosDesdeIGDB]', await res.json());
    }
  } catch (e) {
    console.error('[actualizarDatosDesdeIGDB]', e);
  }
}

// ─────────────────────────────────────────
// MODAL DETALLE / EDICIÓN
// ─────────────────────────────────────────
function abrirDetalle(juego) {
  currentGame = juego;

  const modal = document.getElementById('modalDetalle');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  const img = juego.cover_url || PLACEHOLDER;
  document.getElementById('md-poster').src = img;
  document.getElementById('md-bg').style.backgroundImage = `url(${img})`;
  document.getElementById('md-title').innerText = juego.titulo;
  document.getElementById('md-meta').innerText =
    `${juego.año || '???'} • ${juego.desarrollador || 'Desconocido'}`;
  document.getElementById('md-desc').innerText = juego.descripcion || 'Sin descripción.';

  const genDiv = document.getElementById('md-generos');
  genDiv.innerHTML = '';
  (juego.generos || []).forEach(g => {
    const sp = document.createElement('span');
    sp.className = 'juego-tag';
    sp.innerText = g;
    genDiv.appendChild(sp);
  });

  const platDiv = document.getElementById('md-plataformas');
  platDiv.innerHTML = '';
  (juego.plataformas || []).slice(0, 4).forEach(p => {
    const sp = document.createElement('span');
    sp.className = 'juego-tag plat';
    sp.innerText = p;
    platDiv.appendChild(sp);
  });

  document.getElementById('md-estado').value = juego.estado;
  document.getElementById('md-notas').value = juego.notas_personales || '';
}

function cerrarModal() {
  document.getElementById('modalDetalle').classList.remove('active');
  document.body.style.overflow = 'auto';
  currentGame = null;
}

async function guardarEdicion() {
  if (!currentGame) return;
  const estado = document.getElementById('md-estado').value;
  const notas = document.getElementById('md-notas').value;

  try {
    const res = await fetch(`/api/juegos/${currentGame.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado, notas_personales: notas }),
    });
    if (res.ok) {
      cerrarModal();
      cargarBiblioteca();
    }
  } catch (e) {
    console.error('[guardarEdicion]', e);
  }
}

async function eliminarJuego() {
  if (!currentGame) return;
  if (!confirm(`¿Eliminar "${currentGame.titulo}" de tu biblioteca?`)) return;

  try {
    const res = await fetch(`/api/juegos/${currentGame.id}`, { method: 'DELETE' });
    if (res.ok) {
      cerrarModal();
      cargarBiblioteca();
    }
  } catch (e) {
    console.error('[eliminarJuego]', e);
  }
}