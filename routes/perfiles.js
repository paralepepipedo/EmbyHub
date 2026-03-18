const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const db = require('../lib/db');

// Obtener todos los perfiles activos (para el seletor de inicio)
router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, nombre, avatar FROM perfiles WHERE activo = true ORDER BY nombre'
    );
    res.json(rows);
  } catch (e) {
    console.error('[Perfiles] Error al listar:', e);
    res.status(500).json({ error: 'Error de servidor' });
  }
});

module.exports = router;
