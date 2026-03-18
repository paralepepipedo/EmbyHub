const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const { isAuth } = require('./auth');

// Obtener config del perfil logueado
router.get('/', isAuth, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM perfil_config WHERE perfil_id = $1', [req.session.perfil.id]);
    
    // Si no tiene config, devolvemos default
    if (rows.length === 0) {
      return res.json({ generos_excluidos: [], orden_default: 'fecha_agregado' });
    }
    
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// Guardar o actualizar config
router.post('/', isAuth, async (req, res) => {
  const { generos_excluidos } = req.body;
  const generos = generos_excluidos || [];

  try {
    await db.query(`
      INSERT INTO perfil_config (perfil_id, generos_excluidos)
      VALUES ($1, $2::int[])
      ON CONFLICT (perfil_id) DO UPDATE SET 
        generos_excluidos = EXCLUDED.generos_excluidos,
        actualizado_en = now()
    `, [req.session.perfil.id, generos]);

    res.json({ success: true });
  } catch (e) {
    console.error('Error config:', e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

module.exports = router;
