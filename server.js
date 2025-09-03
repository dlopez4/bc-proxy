import express from "express";
import fetch from "node-fetch";
import "dotenv/config";

const app = express();
const { BC_STORE_HASH, BC_ADMIN_TOKEN, PORT = 3000 } = process.env;

// CORS simple (ajusta si quieres restringir)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Salud
app.get("/", (_req, res) => res.send("BigCommerce Proxy OK"));

// GET /api/order-meta?orderId=145[&namespace=factura]
app.get("/api/order-meta", async (req, res) => {
  try {
    const orderId = Number(req.query.orderId);
    const ns = (req.query.namespace || "").toString();
    if (!orderId) return res.status(400).json({ error: "Falta orderId" });

    const url = `https://api.bigcommerce.com/stores/${BC_STORE_HASH}/v3/orders/${orderId}/metafields`;
    const r = await fetch(url, {
      headers: {
        "X-Auth-Token": BC_ADMIN_TOKEN,
        "Accept": "application/json"
      }
    });
    if (!r.ok) return res.status(r.status).send(await r.text());

    const json = await r.json();
    let data = json.data || [];
    if (ns) data = data.filter(m => (m.namespace || "") === ns);

    // responde { key: value }
    const obj = Object.fromEntries(data.map(m => [m.key, m.value]));
    res.setHeader("Cache-Control", "private, max-age=60");
    return res.json(obj);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Error del servidor" });
  }
});

app.listen(PORT, () => console.log(`Proxy en http://localhost:${PORT}`));

