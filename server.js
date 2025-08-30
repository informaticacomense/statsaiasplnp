const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');

const app = express();


// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
  secret: 'statsaiasplnp_secret',
  resave: false,
  saveUninitialized: true
}));

app.use(express.static(path.join(__dirname, 'public')));

// Connessione MySQL
// 
const PORT = process.env.PORT || 3000;
const { Pool } = require('pg');

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

db.connect()
  .then(() => console.log('✅ Connesso a PostgreSQL'))
  .catch(err => console.error('❌ Errore connessione PostgreSQL:', err));

db.connect(err => {
  if (err) console.error('❌ Errore connessione MySQL:', err);
  else console.log('✅ Connesso a MySQL');
});

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

app.post('/register', async (req, res) => {
  const { nome, cognome, codice_fiscale, email, password } = req.body;
  if (!nome || !cognome || !codice_fiscale || !email || !password) {
    return res.status(400).send("⚠️ Tutti i campi obbligatori devono essere compilati!");
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const sql = `INSERT INTO users (nome,cognome,codice_fiscale,email,password,ruolo)
                 VALUES (?,?,?,?,?,'user')`;
    db.query(sql, [nome, cognome, codice_fiscale, email, hashedPassword], (err) => {
      if (err) {
        console.error("Errore registrazione:", err);
        return res.status(500).send("❌ Errore registrazione.");
      }
      res.send("✅ Registrazione completata!");
    });
  } catch (err) {
    res.status(500).send("❌ Errore interno.");
  }
});

app.post('/login', (req, res) => {
  const { email, password } = req.body;
  console.log("🟢 Tentativo login:", email, password);

  db.query('SELECT * FROM users WHERE email = $1', [email], (err, results) => {
    if (err) {
      console.error("❌ Errore DB:", err);
      return res.send("Errore interno DB");
    }

    console.log("📊 Risultati query:", results);

    if (results.length === 0 || !results.rows || results.rows.length === 0) {
      console.warn("⚠️ Nessun utente trovato con email:", email);
      return res.send('❌ Utente non trovato');
    }

    const user = results.rows ? results.rows[0] : results[0];
    console.log("👤 Utente trovato:", user);

    bcrypt.compare(password, user.password, (err, isMatch) => {
      if (err) {
        console.error("❌ Errore bcrypt:", err);
        return res.send("Errore di validazione password");
      }

      console.log("🔐 Risultato compare:", isMatch);

      if (isMatch) {
        req.session.user = user;
        console.log("✅ Login riuscito per:", email);
        res.redirect('/index.html');
      } else {
        console.warn("⚠️ Password errata per:", email);
        res.send('❌ Password errata');
      }
    });
  });
});


app.get('/logout', (req, res) => {
  req.session.destroy(() => res.send("👋 Logout effettuato."));
});

/////////////////////
// UTENTE LOGGATO  //
/////////////////////

app.get('/me', requireLogin, (req, res) => {
  const sql = `SELECT id,nome,cognome,email,codice_fiscale,ruolo,
    data_nascita,luogo_nascita,indirizzo_residenza,paese,cap,provincia,
    club_appartenenza,anni_esperienza
    FROM users WHERE id=?`;
  db.query(sql, [req.session.userId], (err, results) => {
    if (err) return res.status(500).send("Errore caricamento dati.");
    res.json(results[0]);
  });
});

// Aggiorna profilo utente
app.post('/update-profile', requireLogin, (req, res) => {
  const {
    nome, cognome, data_nascita, luogo_nascita,
    indirizzo_residenza, paese, cap, provincia,
    club_appartenenza, anni_esperienza
  } = req.body;

  const sql = `
    UPDATE users SET
      nome=?, cognome=?, data_nascita=?, luogo_nascita=?,
      indirizzo_residenza=?, paese=?, cap=?, provincia=?,
      club_appartenenza=?, anni_esperienza=?
    WHERE id=?`;

  db.query(sql, [
    nome, cognome, data_nascita || null, luogo_nascita || null,
    indirizzo_residenza || null, paese || null, cap || null, provincia || null,
    club_appartenenza || null, anni_esperienza || null,
    req.session.userId
  ], (err) => {
    if (err) {
      console.error("Errore update profilo:", err);
      return res.status(500).send("❌ Errore aggiornamento profilo.");
    }
    res.send("✅ Profilo aggiornato con successo!");
  });
});


// Lista partite
app.get('/partite', requireLogin, (req, res) => {
  db.query("SELECT * FROM partite ORDER BY data_gara ASC", (err, results) => {
    if (err) return res.status(500).send("Errore caricamento partite.");
    res.json(results);
  });
});

// Iscrizione utente → cambia stato partita in "in_corso"
app.post('/partite/registrati', requireLogin, (req, res) => {
  const { partita_id, ruolo, orario_arrivo } = req.body;
  if (!partita_id || !ruolo || !orario_arrivo) {
    return res.status(400).send("⚠️ Inserisci tutti i campi.");
  }
  const sql = `
    INSERT INTO iscrizioni (user_id, partita_id, ruolo, orario_arrivo) 
    VALUES (?,?,?,?)
    ON DUPLICATE KEY UPDATE ruolo=VALUES(ruolo), orario_arrivo=VALUES(orario_arrivo)
  `;
  db.query(sql, [req.session.userId, partita_id, ruolo, orario_arrivo], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Errore iscrizione.");
    }
    // se è caller → aggiorno la partita a in_corso
    if (ruolo === "caller") {
      db.query("UPDATE partite SET stato='in_corso' WHERE id=? AND stato='da_giocare'", [partita_id]);
    }
    res.send("✅ Iscrizione completata!");
  });
});

// Fine gara → utente carica dati
app.post('/partite/finegara', requireLogin, uploadFiles.fields([
  { name: 'file_stat', maxCount: 1 },       // excel o csv delle statistiche
  { name: 'pdf_stat', maxCount: 1 },        // pdf statistiche
  { name: 'foto_stat', maxCount: 1 }        // foto referto
]), (req, res) => {
  const { partita_id, risultato_finale, note } = req.body;
  if (!partita_id) {
    return res.status(400).send("⚠️ ID partita mancante.");
  }

  const fileStat = req.files['file_stat'] ? req.files['file_stat'][0].filename : null;
  const pdfStat  = req.files['pdf_stat'] ? req.files['pdf_stat'][0].filename : null;
  const fotoStat = req.files['foto_stat'] ? req.files['foto_stat'][0].filename : null;

  // aggiorna iscrizione utente
  const sql = `
    UPDATE iscrizioni 
    SET note=?, file_statistico=?, pdf_statistiche=?, foto_statistiche=?, inviato=1
    WHERE partita_id=? AND user_id=?`;
  db.query(sql, [note || null, fileStat, pdfStat, fotoStat, partita_id, req.session.userId], (err) => {
    if (err) {
      console.error("Errore update iscrizione:", err);
      return res.status(500).send("❌ Errore salvataggio dati iscrizione.");
    }

    // se l’utente è Caller → aggiorna anche risultato e stato partita
    db.query(`SELECT ruolo FROM iscrizioni WHERE partita_id=? AND user_id=?`,
      [partita_id, req.session.userId], (err2, rows) => {
        if (err2) return res.status(500).send("Errore verifica ruolo.");
        if (rows.length && rows[0].ruolo === 'caller' && risultato_finale) {
          db.query("UPDATE partite SET stato='terminata', risultato_finale=? WHERE id=?", 
            [risultato_finale, partita_id], (err3) => {
              if (err3) {
                console.error("Errore update partita:", err3);
                return res.status(500).send("❌ Dati inviati, ma errore aggiornamento partita.");
              }
              res.send("✅ Fine gara inviata! La partita è stata segnata come Terminata.");
          });
        } else {
          res.send("✅ File e note caricati!");
        }
      });
  });
});

// Report iscrizioni (admin)
app.get('/report-partite', requireAdmin, (req, res) => {
  const sql = `
    SELECT p.id AS partita_id, p.campionato, p.girone, p.data_gara, p.numero_gara, 
           p.squadra_a, p.squadra_b, p.campo_gioco, p.orario, p.stato, p.risultato_finale, p.note_admin,
           u.id AS user_id, u.nome, u.cognome, u.email,
           i.id, i.ruolo, i.orario_arrivo, i.note, 
           i.file_statistico, i.pdf_statistiche, i.foto_statistiche, i.inviato
    FROM partite p
    LEFT JOIN iscrizioni i ON p.id = i.partita_id
    LEFT JOIN users u ON i.user_id = u.id
    ORDER BY p.data_gara ASC, p.id, u.cognome
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Errore query report:", err);
      return res.status(500).send("Errore caricamento report.");
    }
    res.json(results);
  });
});

// Admin aggiorna stato + note revisione
app.post('/partite/stato', requireAdmin, (req, res) => {
  const { partita_id, stato, note_admin } = req.body;
  if (!partita_id || !stato) return res.status(400).send("⚠️ Mancano dati.");
  const sql = `UPDATE partite SET stato=?, note_admin=? WHERE id=?`;
  db.query(sql, [stato, note_admin || null, partita_id], (err) => {
    if (err) {
      console.error("Errore update partita:", err);
      return res.status(500).send("❌ Errore aggiornamento stato.");
    }
    res.send("✅ Stato partita aggiornato!");
  });
});

// Admin aggiorna ruolo iscritto
app.post('/iscrizioni/ruolo', requireAdmin, (req, res) => {
  const { iscrizione_id, ruolo } = req.body;
  if (!iscrizione_id || !ruolo) return res.status(400).send("⚠️ Dati mancanti.");
  const sql = `UPDATE iscrizioni SET ruolo=? WHERE id=?`;
  db.query(sql, [ruolo, iscrizione_id], (err) => {
    if (err) {
      console.error(err);
      return res.status(500).send("❌ Errore aggiornamento ruolo.");
    }
    res.send("✅ Ruolo aggiornato!");
  });
});

// Admin reset
app.post('/admin/reset', requireAdmin, (req, res) => {
  db.query("DELETE FROM iscrizioni", (err) => {
    if (err) return res.status(500).send("❌ Errore reset iscrizioni.");
    db.query("DELETE FROM partite", (err2) => {
      if (err2) return res.status(500).send("❌ Errore reset partite.");
      res.send("✅ Tutte le partite e iscrizioni sono state eliminate!");
    });
  });
});

// Admin carica CSV partite
app.post('/admin/upload-csv', requireAdmin, uploadFiles.single('partite_csv'), (req, res) => {
  if (!req.file) return res.status(400).send("⚠️ Nessun file caricato.");

  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv({ separator: ',' }))
    .on('data', (row) => {
      results.push(row);
    })
    .on('end', () => {
      if (results.length === 0) return res.status(400).send("⚠️ CSV vuoto.");

      // Inserimento nel DB
      results.forEach(r => {
        const sql = `
          INSERT INTO partite (campionato, girone, data_gara, numero_gara, squadra_a, squadra_b, campo_gioco, orario, stato)
          VALUES (?,?,?,?,?,?,?,?, 'da_giocare')
        `;
        db.query(sql, [
          r.campionato,
          r.girone || null,
          r.data_gara,
          r.numero_gara,
          r.squadra_a,
          r.squadra_b,
          r.campo_gioco,
          r.orario
        ], (err) => {
          if (err) console.error("Errore inserimento partita:", err);
        });
      });

      res.send(`✅ Caricate ${results.length} partite dal CSV!`);
    });
});

// Restituisce le iscrizioni dell’utente loggato
app.get('/mie-iscrizioni', requireLogin, (req, res) => {
  const sql = `
    SELECT i.partita_id, i.ruolo, i.orario_arrivo, i.note, i.file_statistico, i.pdf_statistiche, i.foto_statistiche
    FROM iscrizioni i
    WHERE i.user_id=?`;
  db.query(sql, [req.session.userId], (err, results) => {
    if (err) {
      console.error("Errore query mie-iscrizioni:", err);
      return res.status(500).send("Errore caricamento iscrizioni utente.");
    }
    res.json(results);
  });
});

// Report avanzato partite per admin
app.get('/admin/report-advanced', requireAdmin, (req, res) => {
  const sql = `
    SELECT p.id AS partita_id, p.campionato, p.girone, p.data_gara, p.numero_gara,
           p.squadra_a, p.squadra_b, p.campo_gioco, p.orario, p.stato, p.risultato_finale,
           COALESCE(MAX(i.file_statistico), '') AS file_statistico,
           COALESCE(MAX(i.pdf_statistiche), '') AS pdf_statistiche,
           COALESCE(MAX(i.foto_statistiche), '') AS foto_statistiche
    FROM partite p
    LEFT JOIN iscrizioni i ON p.id = i.partita_id
    GROUP BY p.id
    ORDER BY p.campionato, p.girone, p.data_gara ASC;
  `;
  db.query(sql, (err, results) => {
    if (err) {
      console.error("Errore query report avanzato:", err);
      return res.status(500).send("Errore caricamento report avanzato.");
    }
    res.json(results);
  });
});


/////////////////////
// AVVIO           //
/////////////////////
app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}`);
});
