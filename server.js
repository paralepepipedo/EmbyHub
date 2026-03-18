require('dotenv').config();
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const cron = require('node-cron');
const db = require('./lib/db');

const authRoutes = require('./routes/auth');
const perfilesRoutes = require('./routes/perfiles');
const mediaRoutes = require('./routes/media');
const juegosRoutes = require('./routes/juegos');
const configRoutes = require('./routes/config');
const buscarRoutes = require('./routes/buscar');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new pgSession({
    pool: db.pool,
    tableName: 'session',
    createTableIfMissing: false,
  }),
  secret: process.env.SESSION_SECRET || 'embyhub-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  }
}));

// Rutas API
app.use('/api/auth', authRoutes);
app.use('/api/perfiles', perfilesRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/juegos', juegosRoutes);
app.use('/api/config', configRoutes);
app.use('/api/buscar', buscarRoutes);

// Rutas HTML — sirven archivos estáticos explícitamente
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/portal', (req, res) => res.sendFile(path.join(__dirname, 'public', 'portal.html')));
app.get('/media/peliculas', (req, res) => res.sendFile(path.join(__dirname, 'public', 'media', 'peliculas.html')));
app.get('/media/series', (req, res) => res.sendFile(path.join(__dirname, 'public', 'media', 'series.html')));
app.get('/media/buscar', (req, res) => res.sendFile(path.join(__dirname, 'public', 'media', 'buscar.html')));
app.get('/media/config', (req, res) => res.sendFile(path.join(__dirname, 'public', 'media', 'config.html')));
app.get('/juegos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'juegos', 'index.html')));

// Cron: sincronización Emby cada hora
cron.schedule('0 * * * *', () => {
  console.log('[CRON] Sincronizando Emby con watchlist...');
  require('./jobs/sync-emby')();
});

app.listen(PORT, () => {
  console.log(`\n🎬 EmbyHub corriendo en http://localhost:${PORT}\n`);
});
