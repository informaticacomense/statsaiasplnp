const express = require("express");
const router = express.Router();
const db = require("./db"); // modulo db con pool/query

// Elenco partite con visualizzazioni
router.get("/partite", async (req, res) => {
  try {
    const result = await db.query("SELECT * FROM partite ORDER BY data_gara ASC");
    const partite = result.rows;

    // Recupero conferme di visualizzazione
    const vis = await db.query("SELECT partita_id, user_id FROM partite_visualizzazioni");
    const mapVis = {};
    vis.rows.forEach(v => {
      if (!mapVis[v.partita_id]) mapVis[v.partita_id] = [];
      mapVis[v.partita_id].push(v.user_id);
    });

    // Aggiungo visualizzata_da ad ogni partita
    partite.forEach(p => {
      p.visualizzata_da = mapVis[p.id] || [];
    });

    res.json(partite);
  } catch (err) {
    console.error(err);
    res.status(500).send("Errore caricamento partite");
  }
});

// Conferma visualizzazione
router.post("/partite/conferma-visualizzazione", async (req, res) => {
  try {
    const userId = req.session.user.id;
    const { partita_id } = req.body;

    if (!partita_id) return res.status(400).send("Partita non valida");

    await db.query(
      `INSERT INTO partite_visualizzazioni (partita_id, user_id, data_conferma)
       VALUES ($1, $2, NOW())
       ON CONFLICT (partita_id, user_id) DO NOTHING`,
      [partita_id, userId]
    );

    res.send("✅ Conferma salvata");
  } catch (err) {
    console.error(err);
    res.status(500).send("Errore salvataggio conferma");
  }
});

module.exports = router;
