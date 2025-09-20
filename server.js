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
const PORT = 3000;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
  secret: 'statsaiasplnp_secret',
  resave: false,
  saveUninitialized: true
}));

app.use(express.static(path.join(__dirname, 'public')));

// ✅ Servire i file caricati
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Connessione MySQL
const db = mysql.createConnection({
  host: 'localhost',
  user: 'statsuser',
  password: 'StatsPass123!',
  database: 'statsaiasplnp'
});
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
// MULTER CONFIG   //
/////////////////////

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const safeName = file.originalname.replace(/\s+/g, '_'); // niente spazi
    cb(null, `${unique}-${safeName}`);
  }
});
const uploadFiles = multer({ storage });
const uploadCSV = multer({ storage });

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
  const sql = "SELECT * FROM users WHERE email=?";
  db.query(sql, [email], async (err, results) => {
    if (err) return res.status(500).send("❌ Errore login.");
    if (results.length === 0) return res.status(401).send("❌ Utente non trovato.");

    const user = results[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).send("❌ Password errata.");

    req.session.userId = user.id;
    req.session.nome = user.nome;
    req.session.cognome = user.cognome;
    req.session.email = user.email;
    req.session.ruolo = user.ruolo;

    res.send("✅ Login effettuato!");
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

// Lista partite
app.get('/partite', requireLogin, (req, res) => {
  db.query("SELECT * FROM partite ORDER BY data_gara ASC", (err, results) => {
    if (err) return res.status(500).send("Errore caricamento partite.");
    res.json(results);
  });
});

// Utente crea partita
app.post('/partite/crea', requireLogin, (req, res) => {
  const { campionato, girone, data_gara, numero_gara, squadra_a, squadra_b, campo_gioco, orario } = req.body;
  if (!campionato || !data_gara || !numero_gara || !squadra_a || !squadra_b) {
    return res.status(400).send("⚠️ Compila i campi obbligatori.");
  }

  const sql = `INSERT INTO partite 
    (campionato, girone, data_gara, numero_gara, squadra_a, squadra_b, campo_gioco, orario, stato, risultato_finale, note_admin)
    VALUES (?,?,?,?,?,?,?,?, 'da_giocare', NULL, NULL)`;

  db.query(sql, [campionato, girone || null, data_gara, numero_gara, squadra_a, squadra_b, campo_gioco || null, orario || null],
    (err) => {
      if (err) {
        console.error("Errore creazione partita:", err);
        return res.status(500).send("❌ Errore creazione partita.");
      }
      res.send("✅ Partita creata con successo!");
    });
});

// Iscrizione utente
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
      return res.status(500).send("Errore registrazione partita.");
    }
    if (ruolo === "caller") {
      db.query("UPDATE partite SET stato='in_corso' WHERE id=? AND stato='da_giocare'", [partita_id]);
    }
    res.send("✅ Ti sei registrato alla partita!");
  });
});

// Fine gara
app.post('/partite/finegara', requireLogin, uploadFiles.fields([
  { name: 'file_stat', maxCount: 1 },
  { name: 'pdf_stat', maxCount: 1 }
]), (req, res) => {
  const { partita_id, risultato_finale, note } = req.body;
  if (!partita_id) return res.status(400).send("⚠️ ID partita mancante.");

  const fileStat = req.files['file_stat'] ? req.files['file_stat'][0].filename : null;
  const pdfStat = req.files['pdf_stat'] ? req.files['pdf_stat'][0].filename : null;

  const sql = `UPDATE iscrizioni SET note=?, file_statistico=?, pdf_statistiche=?, inviato=1
               WHERE partita_id=? AND user_id=?`;
  db.query(sql, [note || null, fileStat, pdfStat, partita_id, req.session.userId], (err) => {
    if (err) {
      console.error("Errore update iscrizione:", err);
      return res.status(500).send("❌ Errore salvataggio dati.");
    }

    db.query(`SELECT ruolo FROM iscrizioni WHERE partita_id=? AND user_id=?`,
      [partita_id, req.session.userId], (err2, rows) => {
        if (err2) return res.status(500).send("Errore verifica ruolo.");
        if (rows.length && rows[0].ruolo === 'caller' && risultato_finale) {
          db.query("UPDATE partite SET stato='terminata', risultato_finale=? WHERE id=?", [risultato_finale, partita_id]);
        }
        res.send("✅ Fine gara inviata!");
      });
  });
});

/////////////////////
// ADMIN           //
/////////////////////

// Upload partite via CSV
app.post('/upload-partite', requireAdmin, uploadCSV.single('file'), (req, res) => {
  if (!req.file) return res.status(400).send("⚠️ Nessun file caricato.");
  const results = [];
  fs.createReadStream(req.file.path)
    .pipe(csv({ separator: ',' }))
    .on('data', row => results.push(row))
    .on('end', () => {
      results.forEach(r => {
        const sql = `INSERT INTO partite 
          (campionato,girone,data_gara,numero_gara,squadra_a,squadra_b,campo_gioco,orario,stato,risultato_finale,note_admin)
          VALUES (?,?,?,?,?,?,?,?, 'da_giocare', NULL, NULL)`;
        db.query(sql, [r.campionato, r.girone, r.data_gara, r.numero_gara, r.squadra_a, r.squadra_b, r.campo_gioco, r.orario]);
      });
      fs.unlinkSync(req.file.path);
      res.send(`✅ Importate ${results.length} partite!`);
    });
});

// Report partite
app.get('/report-partite', requireAdmin, (req, res) => {
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
  db.query(sql, (err, results) => {
    if (err) return res.status(500).send("Errore caricamento report.");
    res.json(results);
  });
});

// Admin aggiorna stato e note
app.post('/partite/stato', requireAdmin, (req, res) => {
  const { partita_id, stato, note_admin } = req.body;
  if (!partita_id || !stato) return res.status(400).send("⚠️ Mancano dati.");
  const sql = `UPDATE partite SET stato=?, note_admin=? WHERE id=?`;
  db.query(sql, [stato, note_admin || null, partita_id], (err) => {
    if (err) return res.status(500).send("❌ Errore aggiornamento stato.");
    res.send("✅ Stato aggiornato!");
  });
});

// Admin aggiorna ruolo
app.post('/iscrizioni/ruolo', requireAdmin, (req, res) => {
  const { iscrizione_id, ruolo } = req.body;
  if (!iscrizione_id || !ruolo) return res.status(400).send("⚠️ Dati mancanti.");
  const sql = `UPDATE iscrizioni SET ruolo=? WHERE id=?`;
  db.query(sql, [ruolo, iscrizione_id], (err) => {
    if (err) return res.status(500).send("❌ Errore aggiornamento ruolo.");
    res.send("✅ Ruolo aggiornato!");
  });
});

// Admin reset
app.post('/admin/reset', requireAdmin, (req, res) => {
  db.query("DELETE FROM iscrizioni", (err) => {
    if (err) return res.status(500).send("❌ Errore reset iscrizioni.");
    db.query("DELETE FROM partite", (err2) => {
      if (err2) return res.status(500).send("❌ Errore reset partite.");
      res.send("✅ Tutto cancellato.");
    });
  });
});

/////////////////////
// AVVIO           //
/////////////////////
app.listen(PORT, () => {
  console.log(`🚀 Server avviato su http://localhost:${PORT}`);
});
