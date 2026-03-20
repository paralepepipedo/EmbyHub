// api/test-bd.js
import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

export default async function handler(req, res) {
  try {
    // Tomar URL directamente
    const sql = neon(process.env.DATABASE_URL);
    
    // Consulta mínima a tu tabla colegios
    const colegios = await sql`SELECT * FROM colegios LIMIT 5`;
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, datos: colegios }));
  } catch (error) {
    console.error('Error en Test:', error.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}
