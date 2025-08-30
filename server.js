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
  saveUninitialized: true
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
  const { nome, cognome, codice_fiscale, email, password } = req.body;

  if (!nome || !cognome || !codice_fiscale || !email || !password) {
    return res.status(400).send("⚠️ Tutti i campi obbligatori devono essere compilati!");
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const sql = `
      INSERT INTO users (nome, cognome, codice_fiscale, email, password, ruolo)
      VALUES ($1,$2,$3,$4,$5,'user')
      ON CONFLICT (email) DO NOTHING
    `;

    await db.query(sql, [nome, cognome, codice_fiscale, email, hashedPassword]);

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
    if (result.rows.length === 0) {
      return res.status(401).send("❌ Utente non trovato");
    }

    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return res.status(401).send("❌ Password errata");
    }

    req.session.userId = user.id;
    req.session.nome = user.nome;
    req.session.cognome = user.cognome;
    req.session.email = user.email;
    req.session.ruolo = user.ruolo;

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
      club_appartenenza,anni_esperienza
      FROM users WHERE id=$1`;
    const result = await db.query(sql, [req.session.userId]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).send("Errore caricamento dati.");
  }
});

app.post('/update-profile', requireLogin, async (req, res) => {
  const {
    nome, cognome, data_nascita, luogo_nascita,
    indirizzo_residenza, paese, cap, provincia,
    club_appartenenza, anni_esperienza
  } = req.body;

  try {
    const sql = `
      UPDATE users SET
        nome=$1, cognome=$2, data_nascita=$3, luogo_nascita=$4,
        indirizzo_residenza=$5, paese=$6, cap=$7, provincia=$8,
        club_appartenenza=$9, anni_esperienza=$10
      WHERE id=$11`;
    await db.query(sql, [
      nome, cognome, data_nascita || null, luogo_nascita || null,
      indirizzo_residenza || null, paese || null, cap || null, provincia || null,
      club_appartenenza || null, anni_esperienza || null,
      req.session.userId
    ]);
    res.send("✅ Profilo aggiornato con successo!");
  } catch (err) {
    console.error("Errore update profilo:", err);
    res.status(500).send("❌ Errore aggiornamento profilo.");
  }
});

/////////////////////
// PARTITE & ADMIN //
/////////////////////

// ... (qui lasciamo invariato il resto delle rotte, che hai già corretto con Postgres)

/////////////////////
// AVVIO           //
/////////////////////
app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}`);
});
