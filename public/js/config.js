document.addEventListener('DOMContentLoaded', async () => {
  const me = await requireAuth();
  if(!me) return;
  document.getElementById('userName').innerText = me.nombre;
  document.getElementById('userAvatar').innerText = me.avatar;

  cargarConfiguracion();
});

async function cargarConfiguracion() {
  // 1. Obtener la config actual del user
  const resConf = await fetch('/api/config');
  const conf = await resConf.json();
  const excluidos = conf.generos_excluidos || [];

  // 2. Obtener lista de generos tmdb
  const [resM, resT] = await Promise.all([
    fetch('/api/media/generos/movie'),
    fetch('/api/media/generos/tv')
  ]);
  const genMovie = await resM.json();
  const genTv = await resT.json();

  renderGeneros('genresMovie', genMovie, excluidos);
  renderGeneros('genresTv', genTv, excluidos);
}

function renderGeneros(idContenedor, lista, arrExcluidos) {
  const cont = document.getElementById(idContenedor);
  cont.innerHTML = '';
  
  lista.forEach(g => {
    const isChecked = arrExcluidos.includes(g.id);
    const div = document.createElement('div');
    div.className = 'genre-item';
    div.innerHTML = `
      <input type="checkbox" id="g_${g.id}" value="${g.id}" ${isChecked ? 'checked' : ''}>
      <label for="g_${g.id}">${g.name}</label>
    `;
    cont.appendChild(div);
  });
}

async function guardarConfig() {
  const checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
  const idsMap = new Set();
  checkboxes.forEach(chk => idsMap.add(parseInt(chk.value)));
  
  const generos_excluidos = Array.from(idsMap);

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({ generos_excluidos }) // Array de ints
    });

    if(res.ok) {
      const msg = document.getElementById('saveMsg');
      msg.innerText = '¡Guardado correctamente!';
      setTimeout(() => msg.innerText='', 3000);
    }
  } catch(e) {
    alert("Error al guardar");
  }
}
