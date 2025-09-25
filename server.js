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
  cookie: { secure: false } // se usi HTTPS metti true
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

app.post('/update-profile', requireLogin, async (req, res) => {
  const {
    nome, cognome, data_nascita, luogo_nascita,
    indirizzo_residenza, paese, cap, provincia,
    club_appartenenza, anni_esperienza,
    sede_corso, data_corso, certificato_lnp
  } = req.body;

  try {
    const sql = `
      UPDATE users SET
        nome=$1, cognome=$2, data_nascita=$3, luogo_nascita=$4,
        indirizzo_residenza=$5, paese=$6, cap=$7, provincia=$8,
        club_appartenenza=$9, anni_esperienza=$10,
        sede_corso=$11, data_corso=$12, certificato_lnp=$13
      WHERE id=$14
    `;
    await db.query(sql, [
      nome, cognome, data_nascita || null, luogo_nascita || null,
      indirizzo_residenza || null, paese || null, cap || null, provincia || null,
      club_appartenenza || null, anni_esperienza || null,
      sede_corso || null, data_corso || null, certificato_lnp === "true",
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

// (qui restano le rotte per partite, iscrizioni, fine gara, report, ecc. 
// che avevi già: non le riscrivo per brevità, ma il codice resta invariato)

/////////////////////
// ADMIN UTENTI    //
/////////////////////

// Lista utenti
app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const sql = `
      SELECT id, nome, cognome, email, codice_fiscale, ruolo,
             data_nascita, luogo_nascita, indirizzo_residenza,
             paese, cap, provincia, club_appartenenza, anni_esperienza,
             sede_corso, data_corso, certificato_lnp
      FROM users
      ORDER BY cognome, nome
    `;
    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error("Errore caricamento utenti:", err);
    res.status(500).send("❌ Errore caricamento utenti.");
  }
});

// Aggiorna ruolo
app.post('/admin/users/update-role', requireAdmin, async (req, res) => {
  const { user_id, ruolo } = req.body;
  if (!user_id || !ruolo) return res.status(400).send("⚠️ Dati mancanti.");
  try {
    await db.query("UPDATE users SET ruolo=$1 WHERE id=$2", [ruolo, user_id]);
    res.send("✅ Ruolo aggiornato con successo!");
  } catch (err) {
    console.error("Errore aggiornamento ruolo:", err);
    res.status(500).send("❌ Errore aggiornamento ruolo.");
  }
});

// Elimina utente
app.delete('/admin/users/delete/:id', requireAdmin, async (req, res) => {
  const userId = req.params.id;
  try {
    await db.query("DELETE FROM users WHERE id=$1", [userId]);
    res.send("✅ Utente eliminato!");
  } catch (err) {
    console.error("Errore eliminazione utente:", err);
    res.status(500).send("❌ Errore eliminazione utente.");
  }
});

// Dettaglio utente
app.get('/admin/users/:id', requireAdmin, async (req, res) => {
  const userId = req.params.id;
  try {
    const sql = `
      SELECT id, nome, cognome, email, codice_fiscale, ruolo,
             data_nascita, luogo_nascita, indirizzo_residenza,
             paese, cap, provincia, club_appartenenza, anni_esperienza,
             sede_corso, data_corso, certificato_lnp
      FROM users WHERE id=$1
    `;
    const result = await db.query(sql, [userId]);
    if (result.rows.length === 0) return res.status(404).send("❌ Utente non trovato");
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Errore dettaglio utente:", err);
    res.status(500).send("❌ Errore caricamento utente.");
  }
});

// Aggiorna dati utente (admin)
app.post('/admin/users/update', requireAdmin, async (req, res) => {
  const {
    id, nome, cognome, email, codice_fiscale, ruolo,
    data_nascita, luogo_nascita, indirizzo_residenza,
    paese, cap, provincia, club_appartenenza, anni_esperienza,
    sede_corso, data_corso, certificato_lnp
  } = req.body;

  if (!id) return res.status(400).send("⚠️ ID utente mancante.");

  try {
    const sql = `
      UPDATE users SET
        nome=$1, cognome=$2, email=$3, codice_fiscale=$4, ruolo=$5,
        data_nascita=$6, luogo_nascita=$7, indirizzo_residenza=$8,
        paese=$9, cap=$10, provincia=$11, club_appartenenza=$12, anni_esperienza=$13,
        sede_corso=$14, data_corso=$15, certificato_lnp=$16
      WHERE id=$17
    `;
    await db.query(sql, [
      nome, cognome, email, codice_fiscale, ruolo,
      data_nascita || null, luogo_nascita || null, indirizzo_residenza || null,
      paese || null, cap || null, provincia || null,
      club_appartenenza || null, anni_esperienza || null,
      sede_corso || null, data_corso || null, certificato_lnp === "true",
      id
    ]);
    res.send("✅ Profilo utente aggiornato!");
  } catch (err) {
    console.error("Errore update utente (admin):", err);
    res.status(500).send("❌ Errore aggiornamento utente.");
  }
});

// Admin: crea i campi mancanti
app.post('/admin/create-missing-fields', requireAdmin, async (req, res) => {
  try {
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS sede_corso VARCHAR(255)`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS data_corso DATE`);
    await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS certificato_lnp BOOLEAN DEFAULT FALSE`);
    res.send("✅ Campi aggiunti (se mancanti).");
  } catch (err) {
    console.error("Errore creazione campi:", err);
    res.status(500).send("❌ Errore creazione campi.");
  }
});

// Admin: elenco utenti per stampa
app.get('/admin/users/print', requireAdmin, async (req, res) => {
  const { filter } = req.query; // "all", "certificati", "non_certificati"
  try {
    let sql = `
      SELECT nome, cognome, club_appartenenza, certificato_lnp
      FROM users
      ORDER BY cognome, nome
    `;

    let result = await db.query(sql);

    if (filter === "certificati") {
      result.rows = result.rows.filter(u => u.certificato_lnp);
    } else if (filter === "non_certificati") {
      result.rows = result.rows.filter(u => !u.certificato_lnp);
    }

    res.json(result.rows);
  } catch (err) {
    console.error("Errore caricamento utenti stampa:", err);
    res.status(500).send("❌ Errore caricamento elenco utenti.");
  }
});


/////////////////////
// AVVIO           //
/////////////////////
app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}`);
});
