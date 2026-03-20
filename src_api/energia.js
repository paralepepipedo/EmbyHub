// ============================================
// lib/energia.js — Sistema de energía diaria
// Usado en el FRONTEND por cada página
// ============================================
// ÍNDICE
// 1. Obtener hora actual en Santiago, Chile
// 2. Verificar si corresponde recargar energía
// 3. Recargar energía vía /api/energia
// 4. Iniciar generación pasiva de monedas
// 5. Renderizar barra de energía en el header
// ============================================

import { apiGet, apiPost } from './clerk.js';

// Hora de reset diario (20:00 hora Chile)
const HORA_RESET = 20;

// ============================================
// 1. HORA EN CHILE (America/Santiago)
// ============================================
export function horaChile() {
  return new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Santiago' })
  );
}

export function fechaHoyChile() {
  const d = horaChile();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ============================================
// 2. ¿CORRESPONDE RECARGAR?
// Recarga si:
//   - última recarga fue antes de las 20:00 de hoy, y ya son las 20:00+
//   - o última recarga fue de ayer
// ============================================
export function debeRecargar(ultimaRecarga) {
  const ahora   = horaChile();
  const recarga = new Date(ultimaRecarga);

  // Convertir última recarga a hora Chile
  const recargaChile = new Date(
    recarga.toLocaleString('en-US', { timeZone: 'America/Santiago' })
  );

  const mismaFecha =
    ahora.getFullYear()  === recargaChile.getFullYear() &&
    ahora.getMonth()     === recargaChile.getMonth()    &&
    ahora.getDate()      === recargaChile.getDate();

  if (!mismaFecha) return true; // día diferente → recargar

  // Mismo día: recargar si ahora >= 20:00 y la recarga fue antes de las 20:00
  if (ahora.getHours() >= HORA_RESET && recargaChile.getHours() < HORA_RESET) {
    return true;
  }

  return false;
}

// ============================================
// 3. RECARGAR ENERGÍA
// Llama a /api/energia para actualizar en DB
// ============================================
export async function recargarEnergia() {
  try {
    const resultado = await apiPost('/api/energia', { action: 'recargar' });
    return resultado;
  } catch (err) {
    console.warn('[Energía] No se pudo recargar:', err.message);
    return null;
  }
}

// ============================================
// 4. INICIAR SESIÓN DE ENERGÍA
// Llamar al cargar cualquier página protegida.
// Verifica si hay que recargar y actualiza la UI.
// ============================================
export async function iniciarEnergia() {
  try {
    const perfil = await apiGet('/api/perfil');
    if (!perfil) return null;

    // Verificar si corresponde recargar
    if (debeRecargar(perfil.ultima_recarga)) {
      const resultado = await recargarEnergia();
      if (resultado?.recargada) {
        mostrarToastEnergia();
        return { ...perfil, energia_actual: perfil.energia_max };
      }
    }

    // Actualizar UI con energía actual
    renderBarraEnergia(perfil.energia_actual, perfil.energia_max);
    return perfil;
  } catch (err) {
    console.error('[Energía] Error al iniciar:', err);
    return null;
  }
}

// ============================================
// 5. GENERACIÓN PASIVA DE MONEDAS
// Genera monedas cada N minutos mientras
// el usuario tiene la página abierta y tiene energía
// ============================================
let _intervalGeneracion = null;

export function iniciarGeneracionPasiva(perfil, onMonedas) {
  const INTERVALO_MS = 5 * 60 * 1000; // 5 minutos

  if (_intervalGeneracion) clearInterval(_intervalGeneracion);

  _intervalGeneracion = setInterval(async () => {
    try {
      const resultado = await apiPost('/api/energia', { action: 'generar_monedas' });
      if (resultado?.monedas_generadas > 0 && onMonedas) {
        onMonedas(resultado.monedas_generadas);
      }
    } catch (err) {
      console.warn('[Energía] Error generación pasiva:', err.message);
    }
  }, INTERVALO_MS);

  // Limpiar al salir de la página
  window.addEventListener('beforeunload', () => {
    if (_intervalGeneracion) clearInterval(_intervalGeneracion);
  });
}

export function detenerGeneracionPasiva() {
  if (_intervalGeneracion) {
    clearInterval(_intervalGeneracion);
    _intervalGeneracion = null;
  }
}

// ============================================
// 6. UI — Barra de energía en el header
// ============================================
export function renderBarraEnergia(actual, maximo) {
  const barra = document.getElementById('energia-barra');
  const texto = document.getElementById('energia-texto');
  if (!barra || !texto) return;

  const pct = Math.min(100, Math.round((actual / maximo) * 100));
  barra.style.width = pct + '%';

  // Color según nivel de energía
  if (pct > 60)      barra.style.background = 'linear-gradient(90deg, #f97316, #facc15)';
  else if (pct > 30) barra.style.background = 'linear-gradient(90deg, #f97316, #ef4444)';
  else               barra.style.background = 'linear-gradient(90deg, #ef4444, #7f1d1d)';

  texto.textContent = `${actual}/${maximo}`;
}

function mostrarToastEnergia() {
  // Buscar toast container si existe
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.borderColor = 'rgba(249,115,22,0.5)';
  toast.innerHTML = `<span class="toast-icon">⚡</span><span class="toast-text">¡Energía recargada! A estudiar 🚀</span>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}
