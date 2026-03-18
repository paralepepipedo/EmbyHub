const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../lib/db');

// Middleware manual para verificar sesión activa (lo usaremos en otras rutas)
const isAuth = (req, res, next) => {
  if (req.session.perfil) return next();
  res.status(401).json({ error: 'No autorizado' });
};

// Login de perfil
router.post('/login', async (req, res) => {
  const { id, pin } = req.body;
  
  if (!id) return res.status(400).json({ error: 'Falta perfil ID' });

  try {
    const { rows } = await db.query('SELECT * FROM perfiles WHERE id = $1', [id]);
    const perfil = rows[0];

    if (!perfil) return res.status(404).json({ error: 'Perfil no encontrado' });

    // Si tiene PIN, verificamos via bcrypt
    if (perfil.pin_hash && pin) {
      const match = await bcrypt.compare(pin, perfil.pin_hash);
      if (!match) return res.status(401).json({ error: 'PIN incorrecto' });
    } else if (perfil.pin_hash && !pin) {
      return res.status(401).json({ error: 'PIN requerido' });
    }

    // Guardar en sesión
    req.session.perfil = {
      id: perfil.id,
      nombre: perfil.nombre,
      avatar: perfil.avatar,
      es_admin: perfil.es_admin
    };

    res.json({ success: true, perfil: req.session.perfil });

  } catch (e) {
    console.error('[Auth] Error de login:', e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Obtener perfil actual logueado
router.get('/me', (req, res) => {
  if (req.session.perfil) {
    res.json({ perfil: req.session.perfil });
  } else {
    res.status(401).json({ error: 'No autorizado' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

module.exports = router;
module.exports.isAuth = isAuth;
