require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");

const paymentRoutes = require("./routes/payments");
const webhookRoutes = require("./routes/webhooks");
const orderRoutes = require("./routes/orders");
const metaRoutes = require("./routes/meta");

const app = express();
const port = process.env.PORT || 3000;
const host = "0.0.0.0";

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use("/assets", express.static(path.join(__dirname, "assets"), { index: false }));
app.use(
  "/nicolle",
  express.static(path.join(__dirname, "nicole-influencer.site", "nicolle"), { index: false })
);

app.get("/styles.css", (req, res) => {
  res.sendFile(path.join(__dirname, "styles.css"));
});

app.get("/script.js", (req, res) => {
  res.sendFile(path.join(__dirname, "script.js"));
});

app.get("/checkout.css", (req, res) => {
  res.sendFile(path.join(__dirname, "checkout.css"));
});

app.get("/checkout.js", (req, res) => {
  res.sendFile(path.join(__dirname, "checkout.js"));
});

app.use("/api/payments", paymentRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/", webhookRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/meta", metaRoutes);

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptime: Math.round(process.uptime()),
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/checkout.html", (req, res) => {
  res.sendFile(path.join(__dirname, "checkout.html"));
});

app.listen(port, host, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});
