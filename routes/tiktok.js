const express = require("express");
const tiktokEventsService = require("../services/tiktokEventsService");

const router = express.Router();

router.post("/events", async (req, res) => {
  try {
    const result = await tiktokEventsService.sendEvent(req, req.body);
    return res.json({
      ok: true,
      result,
    });
  } catch (error) {
    console.error("[TikTok Events API] Falha no endpoint:", error.message);
    return res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || "Erro ao enviar evento TikTok.",
    });
  }
});

module.exports = router;
