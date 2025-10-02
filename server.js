const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
  secret: 'statsaiasplnp_secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

app.use(express.static(path.join(__dirname, 'public')));

// Connessione PostgreSQL
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

db.connect()
  .then(() => console.log('✅ Connesso a PostgreSQL'))
  .catch(err => console.error('❌ Errore connessione PostgreSQL:', err));

// Middleware auth
function requireLogin(req, res, next) {
  if (!req.session.userId) return res.status(401).send("❌ Devi fare login.");
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.userId || req.session.ruolo !== 'admin') {
    return res.status(403).send("❌ Accesso riservato agli admin.");
  }
  next();
}

/////////////////////
// UPLOAD FILE     //
/////////////////////

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const uploadFiles = multer({ storage: storage });

/////////////////////
// AUTENTICAZIONE  //
/////////////////////

// Registrazione
app.post('/register', async (req, res) => {
  const { nome, cognome, codice_fiscale, email, password, club_appartenenza } = req.body;

  if (!nome || !cognome || !codice_fiscale || !email || !password || !club_appartenenza) {
    return res.status(400).send("⚠️ Tutti i campi obbligatori devono essere compilati!");
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `
      INSERT INTO users (nome, cognome, codice_fiscale, email, password, ruolo, club_appartenenza)
      VALUES ($1,$2,$3,$4,$5,'user',$6)
      ON CONFLICT (email) DO NOTHING
    `;
    await db.query(sql, [nome, cognome, codice_fiscale, email, hashedPassword, club_appartenenza]);
    res.send("✅ Registrazione completata!");
  } catch (err) {
    console.error("❌ Errore registrazione:", err);
    res.status(500).send("❌ Errore registrazione utente.");
  }
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await db.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).send("❌ Utente non trovato");

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).send("❌ Password errata");

    req.session.userId = user.id;
    req.session.nome = user.nome;
    req.session.cognome = user.cognome;
    req.session.email = user.email;
    req.session.ruolo = user.ruolo;

    console.log(`👤 Login effettuato: ${user.email} (${user.ruolo})`);

    res.send("✅ Login effettuato!");
  } catch (err) {
    console.error("❌ Errore login:", err);
    res.status(500).send("Errore interno login.");
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.send("👋 Logout effettuato."));
});

/////////////////////
// UTENTE LOGGATO  //
/////////////////////

app.get('/me', requireLogin, async (req, res) => {
  try {
    const sql = `SELECT id,nome,cognome,email,codice_fiscale,ruolo,
      data_nascita,luogo_nascita,indirizzo_residenza,paese,cap,provincia,
      club_appartenenza,anni_esperienza,
      sede_corso,data_corso,certificato_lnp
      FROM users WHERE id=$1`;
    const result = await db.query(sql, [req.session.userId]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Errore caricamento /me:", err);
    res.status(500).send("Errore caricamento dati.");
  }
});

/////////////////////
// PARTITE         //
/////////////////////

// Lista partite
app.get('/partite', requireLogin, async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM partite ORDER BY data_gara ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("Errore caricamento partite:", err);
    res.status(500).send("Errore caricamento partite.");
  }
});

// Creazione partita
app.post('/partite/crea', requireLogin, async (req, res) => {
  const { campionato, girone, data_gara, numero_gara, squadra_a, squadra_b, campo_gioco, orario } = req.body;

  if (!campionato || !data_gara || !numero_gara || !squadra_a || !squadra_b) {
    return res.status(400).send("⚠️ Compila tutti i campi obbligatori.");
  }

  try {
    const sql = `
      INSERT INTO partite (campionato, girone, data_gara, numero_gara, squadra_a, squadra_b, campo_gioco, orario, stato, visualizzata_da)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'da_giocare','[]')
    `;
    await db.query(sql, [
      campionato,
      girone || null,
      data_gara,
      numero_gara,
      squadra_a,
      squadra_b,
      campo_gioco || null,
      orario || null
    ]);
    res.send("✅ Partita creata con successo!");
  } catch (err) {
    console.error("Errore creazione partita:", err);
    res.status(500).send("❌ Errore creazione partita.");
  }
});

// Conferma visualizzazione revisione
app.post('/partite/conferma-visualizzazione', requireLogin, async (req, res) => {
  const userId = req.session.userId;
  const { partita_id } = req.body;

  if (!partita_id) return res.status(400).send("⚠️ ID partita mancante.");

  try {
    const result = await db.query("SELECT visualizzata_da FROM partite WHERE id=$1", [partita_id]);
    if (result.rows.length === 0) return res.status(404).send("❌ Partita non trovata.");

    let visualizzata = result.rows[0].visualizzata_da || [];
    if (typeof visualizzata === "string") {
      try { visualizzata = JSON.parse(visualizzata); } catch { visualizzata = []; }
    }

    if (!visualizzata.includes(userId)) {
      visualizzata.push(userId);
      await db.query("UPDATE partite SET visualizzata_da=$1 WHERE id=$2", [JSON.stringify(visualizzata), partita_id]);
    }

    res.send("✅ Conferma salvata");
  } catch (err) {
    console.error("Errore conferma visualizzazione:", err);
    res.status(500).send("❌ Errore salvataggio conferma.");
  }
});

// --- Qui restano tutte le tue altre route: registrati, finegara, mie-iscrizioni (le ho lasciate uguali)

// Report iscrizioni (admin)
app.get('/report-partite', requireAdmin, async (req, res) => {
  try {
    const sql = `
      SELECT 
        p.id AS partita_id, 
        p.campionato, 
        p.girone, 
        p.data_gara, 
        p.numero_gara, 
        p.squadra_a, 
        p.squadra_b, 
        p.campo_gioco, 
        p.orario, 
        p.stato, 
        p.risultato_finale, 
        p.note_admin,
        u.id AS user_id, 
        u.nome, 
        u.cognome, 
        u.email,
        i.id AS iscrizione_id, 
        i.ruolo, 
        i.orario_arrivo, 
        i.note, 
        i.file_statistico, 
        i.pdf_statistiche, 
        i.foto_statistiche, 
        i.inviato
      FROM partite p
      LEFT JOIN iscrizioni i ON p.id = i.partita_id
      LEFT JOIN users u ON i.user_id = u.id
      ORDER BY p.data_gara ASC, p.id, u.cognome
    `;
    const result = await db.query(sql);
    res.json(result.rows || []);
  } catch (err) {
    console.error("❌ Errore query report-partite:", err);
    res.status(500).send("Errore caricamento partite.");
  }
});

/////////////////////
// AVVIO           //
/////////////////////
app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}`);
});


