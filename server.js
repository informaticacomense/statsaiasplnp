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

app.post('/partite/create', requireLogin, async (req, res) => {
  req.url = '/partite/crea';
  app._router.handle(req, res);
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

// Iscrizione utente
app.post('/partite/registrati', requireLogin, async (req, res) => {
  const { partita_id, ruolo, orario_arrivo } = req.body;
  if (!partita_id || !ruolo || !orario_arrivo) {
    return res.status(400).send("⚠️ Inserisci tutti i campi.");
  }
  try {
    const sql = `
      INSERT INTO iscrizioni (user_id, partita_id, ruolo, orario_arrivo) 
      VALUES ($1,$2,$3,$4)
      ON CONFLICT (user_id, partita_id) DO UPDATE 
      SET ruolo = EXCLUDED.ruolo, orario_arrivo = EXCLUDED.orario_arrivo
    `;
    await db.query(sql, [req.session.userId, partita_id, ruolo, orario_arrivo]);

    if (ruolo === "caller") {
      await db.query("UPDATE partite SET stato='in_corso' WHERE id=$1 AND stato='da_giocare'", [partita_id]);
    }
    res.send("✅ Iscrizione completata!");
  } catch (err) {
    console.error("Errore iscrizione:", err);
    res.status(500).send("Errore iscrizione.");
  }
});

// Fine gara
app.post('/partite/finegara', requireLogin, uploadFiles.fields([
  { name: 'file_stat', maxCount: 1 },
  { name: 'pdf_stat', maxCount: 1 }
]), async (req, res) => {
  const { partita_id, risultato_finale, note } = req.body;
  if (!partita_id) return res.status(400).send("⚠️ ID partita mancante.");

  const fileStat = req.files['file_stat'] ? req.files['file_stat'][0].filename : null;
  const pdfStat  = req.files['pdf_stat'] ? req.files['pdf_stat'][0].filename : null;

  try {
    await db.query(
      `UPDATE iscrizioni 
       SET note=$1, file_statistico=$2, pdf_statistiche=$3, inviato=TRUE
       WHERE partita_id=$4 AND user_id=$5`,
      [note || null, fileStat, pdfStat, partita_id, req.session.userId]
    );

    const ruoloResult = await db.query(
      "SELECT ruolo FROM iscrizioni WHERE partita_id=$1 AND user_id=$2",
      [partita_id, req.session.userId]
    );

    if (ruoloResult.rows.length && ruoloResult.rows[0].ruolo === 'caller' && risultato_finale) {
      await db.query("UPDATE partite SET stato='terminata', risultato_finale=$1 WHERE id=$2",
        [risultato_finale, partita_id]);
      res.send("✅ Fine gara inviata! Partita terminata.");
    } else {
      res.send("✅ File e note caricati!");
    }
  } catch (err) {
    console.error("Errore fine gara:", err);
    res.status(500).send("❌ Errore fine gara.");
  }
});

// Le mie iscrizioni
app.get('/mie-iscrizioni', requireLogin, async (req, res) => {
  try {
    const sql = `
      SELECT i.partita_id, i.ruolo, i.orario_arrivo, i.note, 
             i.file_statistico, i.pdf_statistiche
      FROM iscrizioni i
      WHERE i.user_id=$1`;
    const result = await db.query(sql, [req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error("Errore query mie-iscrizioni:", err);
    res.status(500).send("Errore caricamento iscrizioni utente.");
  }
});

/////////////////////
// ADMIN PARTITE   //
/////////////////////

// Report iscrizioni (dettagliato)
app.get('/report-partite', requireAdmin, async (req, res) => {
  try {
    const sql = `
      SELECT p.id AS partita_id, p.campionato, p.girone, p.data_gara, p.numero_gara, 
             p.squadra_a, p.squadra_b, p.campo_gioco, p.orario, p.stato, p.risultato_finale, p.note_admin,
             u.id AS user_id, u.nome, u.cognome, u.email,
             i.id AS iscrizione_id, i.ruolo, i.orario_arrivo, i.note, 
             i.file_statistico, i.pdf_statistiche, i.inviato
      FROM partite p
      LEFT JOIN iscrizioni i ON p.id = i.partita_id
      LEFT JOIN users u ON i.user_id = u.id
      ORDER BY p.data_gara ASC, p.id, u.cognome
    `;
    const result = await db.query(sql);
    res.json(result.rows || []);
  } catch (err) {
    console.error("Errore query report-partite:", err);
    res.status(500).send("Errore caricamento report.");
  }
});

// Admin aggiorna stato partita
app.post('/partite/stato', requireAdmin, async (req, res) => {
  const { partita_id, stato, note_admin } = req.body;
  if (!partita_id || !stato) return res.status(400).send("⚠️ Mancano dati.");
  try {
    await db.query(`UPDATE partite SET stato=$1, note_admin=$2 WHERE id=$3`,
      [stato, note_admin || null, partita_id]);
    res.send("✅ Stato partita aggiornato!");
  } catch (err) {
    console.error("Errore update partita:", err);
    res.status(500).send("❌ Errore aggiornamento stato partita.");
  }
});

// Admin aggiorna ruolo iscritto
app.post('/iscrizioni/ruolo', requireAdmin, async (req, res) => {
  const { iscrizione_id, ruolo } = req.body;
  if (!iscrizione_id || !ruolo) return res.status(400).send("⚠️ Dati mancanti.");
  try {
    await db.query(`UPDATE iscrizioni SET ruolo=$1 WHERE id=$2`, [ruolo, iscrizione_id]);
    res.send("✅ Ruolo aggiornato!");
  } catch (err) {
    console.error("Errore update ruolo iscrizione:", err);
    res.status(500).send("❌ Errore aggiornamento ruolo iscrizione.");
  }
});

// Admin reset partite/iscrizioni
app.post('/admin/reset', requireAdmin, async (req, res) => {
  try {
    await db.query("DELETE FROM iscrizioni");
    await db.query("DELETE FROM partite");
    res.send("✅ Tutte le partite e iscrizioni eliminate!");
  } catch (err) {
    console.error("Errore reset:", err);
    res.status(500).send("❌ Errore reset.");
  }
});

// Admin carica partite da CSV
app.post('/admin/upload-csv', requireAdmin, uploadFiles.single('partite_csv'), async (req, res) => {
  if (!req.file) return res.status(400).send("⚠️ Nessun file caricato.");

  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv({ separator: ',' }))
    .on('data', (row) => results.push(row))
    .on('end', async () => {
      if (results.length === 0) return res.status(400).send("⚠️ CSV vuoto.");

      try {
        for (const r of results) {
          const sql = `
            INSERT INTO partite (campionato, girone, data_gara, numero_gara, squadra_a, squadra_b, campo_gioco, orario, stato, visualizzata_da)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'da_giocare','[]')
          `;
          await db.query(sql, [
            r.campionato,
            r.girone || null,
            r.data_gara,
            r.numero_gara,
            r.squadra_a,
            r.squadra_b,
            r.campo_gioco,
            r.orario
          ]);
        }
        res.send(`✅ Caricate ${results.length} partite dal CSV!`);
      } catch (err) {
        console.error("Errore inserimento partite da CSV:", err);
        res.status(500).send("Errore import CSV.");
      }
    });
});

/////////////////////
// ADMIN UTENTI    //
/////////////////////

// Lista utenti (completa)
app.get('/admin/users', requireAdmin, async (req, res) => {
  try {
    const sql = `
      SELECT id, nome, cognome, email, ruolo,
             club_appartenenza, sede_corso, data_corso, certificato_lnp,
             data_nascita, luogo_nascita, indirizzo_residenza, paese, cap, provincia, anni_esperienza
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
      SELECT id, nome, cognome, email, ruolo,
             club_appartenenza, sede_corso, data_corso, certificato_lnp,
             data_nascita, luogo_nascita, indirizzo_residenza, paese, cap, provincia, anni_esperienza
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
    id, nome, cognome, email, ruolo,
    club_appartenenza, sede_corso, data_corso, certificato_lnp,
    data_nascita, luogo_nascita, indirizzo_residenza, paese, cap, provincia, anni_esperienza
  } = req.body;

  if (!id) return res.status(400).send("⚠️ ID utente mancante.");

  try {
    const sql = `
      UPDATE users SET
        nome=$1, cognome=$2, email=$3, ruolo=$4,
        club_appartenenza=$5, sede_corso=$6, data_corso=$7, certificato_lnp=$8,
        data_nascita=$9, luogo_nascita=$10, indirizzo_residenza=$11, paese=$12, cap=$13, provincia=$14, anni_esperienza=$15
      WHERE id=$16
    `;
    await db.query(sql, [
      nome, cognome, email, ruolo,
      club_appartenenza || null, sede_corso || null, data_corso || null, certificato_lnp === "true",
      data_nascita || null, luogo_nascita || null, indirizzo_residenza || null, paese || null, cap || null, provincia || null, anni_esperienza || null,
      id
    ]);
    res.send("✅ Profilo utente aggiornato!");
  } catch (err) {
    console.error("Errore update utente (admin):", err);
    res.status(500).send("❌ Errore aggiornamento utente.");
  }
});

// Admin: partite a cui un utente è iscritto
app.get('/admin/users/:id/partite', requireAdmin, async (req, res) => {
  const userId = req.params.id;
  try {
    const sql = `
      SELECT p.id, p.campionato, p.numero_gara, p.squadra_a, p.squadra_b, p.data_gara,
             i.ruolo
      FROM iscrizioni i
      INNER JOIN partite p ON i.partita_id = p.id
      WHERE i.user_id = $1
      ORDER BY p.data_gara DESC
    `;
    const result = await db.query(sql, [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error("Errore caricamento partite utente:", err);
    res.status(500).send("❌ Errore caricamento partite utente.");
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

// Admin: stampa elenco utenti
app.get('/admin/users/print', requireAdmin, async (req, res) => {
  const filter = req.query.filter || "all";

  try {
    let sql = `
      SELECT id, nome, cognome, club_appartenenza, certificato_lnp
      FROM users
    `;

    if (filter === "certificati") {
      sql += " WHERE certificato_lnp = true";
    } else if (filter === "non_certificati") {
      sql += " WHERE certificato_lnp = false";
    }

    sql += " ORDER BY club_appartenenza ASC NULLS LAST, cognome ASC";

    const result = await db.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error("❌ Errore caricamento utenti:", err);
    res.status(500).send("Errore caricamento utenti.");
  }
});

/////////////////////
// AVVIO           //
/////////////////////
app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}`);
});

