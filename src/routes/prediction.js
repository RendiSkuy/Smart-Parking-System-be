const express = require('express');
const router = express.Router();
const { execFile } = require('child_process');
const path = require('path');

// GET /api/parking/predict
router.get('/predict', (req, res) => {
  const { section } = req.query;

  // Validate section parameter
  if (!section) {
    return res.status(400).json({ error: "Parameter query 'section' wajib disertakan." });
  }

  // Sanitize section (only allow letters and numbers)
  if (!/^[a-zA-Z0-9]+$/.test(section)) {
    return res.status(400).json({ error: "Parameter 'section' tidak valid." });
  }

  // Get current Hour and Day of Week from server time
  const now = new Date();
  const hour = now.getHours();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.

  // Define absolute path to python script
  const scriptPath = path.join(__dirname, '../../predict.py');

  // Spawn Python process safely using execFile
  execFile('python', [scriptPath, hour, dayOfWeek, section], (error, stdout, stderr) => {
    if (error) {
      console.error(`Error executing predict.py:`, error);
      console.error(`Python Stderr:`, stderr);
      return res.status(500).json({ 
        error: "Gagal menjalankan skrip prediksi model ML.", 
        details: stderr || error.message 
      });
    }

    const output = stdout.trim();
    let predictionResult = "Tidak Diketahui";

    // Map output to Penuh / Kosong
    if (output === '1') {
      predictionResult = "Penuh";
    } else if (output === '0') {
      predictionResult = "Kosong";
    }

    return res.status(200).json({
      section: section.toUpperCase(),
      hour: hour,
      day_of_week: dayOfWeek,
      prediction: predictionResult
    });
  });
});

module.exports = router;
