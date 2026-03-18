// auth.js - Utilidades globales para el cliente
async function checkSession() {
  try {
    const res = await fetch('/api/auth/me');
    if(!res.ok) return null;
    const data = await res.json();
    return data.perfil || null;
  } catch(e) {
    return null;
  }
}

async function requireAuth() {
  const me = await checkSession();
  if(!me) {
    window.location.href = '/';
  }
  return me;
}

async function logout() {
  if(confirm('¿Cerrar sesión?')) {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/';
  }
}
