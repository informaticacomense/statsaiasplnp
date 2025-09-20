// Creazione partita da parte di un utente
app.post('/partite/crea', requireLogin, async (req, res) => {
  const { campionato, girone, data_gara, numero_gara, squadra_a, squadra_b, campo_gioco, orario } = req.body;

  if (!campionato || !data_gara || !numero_gara || !squadra_a || !squadra_b) {
    return res.status(400).send("⚠️ Compila tutti i campi obbligatori (campionato, data, numero gara, squadra A, squadra B).");
  }

  try {
    const sql = `
      INSERT INTO partite (campionato, girone, data_gara, numero_gara, squadra_a, squadra_b, campo_gioco, orario, stato)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'da_giocare')
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
    res.status(500).send("❌ Errore durante la creazione della partita.");
  }
});
