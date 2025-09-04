import express from "express";
import fetch from "node-fetch";
import "dotenv/config";
//import {createServer} from 'node:http';

const app = express();
const { BC_STORE_HASH, BC_ADMIN_TOKEN, PORT = 3000 } = process.env;

// CORS simple (ajusta si quieres restringir)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
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

app.get("/api/total", async (req, res) => {
  try {
    const orderId = Number(req.query.orderId); //Obtengo el Id de la orden
    if (!orderId) return res.status(400).json({ error: "Falta orderId"}); //Si no la tengo, manda error

    const v2Url = `https://api.bigcommerce.com/stores/${BC_STORE_HASH}/v2/orders/${orderId}`; //url para la API de busqueda de orden
    const v2Res = await fetch(v2Url, {
      headers: { 
        "X-Auth-Token": BC_ADMIN_TOKEN, 
        "Accept": "application/json"
      }
    }); //Este bloque hace la llamada a la API
    if (!v2Res.ok) return res.status(v2Res.status).send(await v2Res.text()); //Si no hay respuesta, devuelve el estatus
    const json = await v2Res.json(); //Recibo la respuesta
    let orderV2 = json.data || {};
    const totalIncTax = Number(orderV2.total_inc_tax || 0); //Obtengo el campo de total_inc_tax
    const storeCredit = Number(orderV2.store_credit || 0); //Obtengo el campo de store_credit
    const suma = Number((totalIncTax + storeCredit).toFixed(2)); //hago la suma y lo redondeo a solo 2 decimales
    console.log("total:", { orderId, totalIncTax, storeCredit, suma, orderV2});

    //Ahora para insertar o actualizar el metafield
    const v3ListUrl = `https://api.bigcommerce.com/stores/${BC_STORE_HASH}/v3/orders/${orderId}/metafields`;//url para la API de metafields de una orden
    const listRes = await fetch(v3ListUrl, {
      headers: {
        "X-Auth-Token": BC_ADMIN_TOKEN, 
        "Accept": "application/json"
      }
    }); //Este bloque hace un GET a la API de metafields
    if (!listRes.ok) return res.status(listRes.status).send(await listRes.text()); //Si no hay respuesta devuelve el estatus
    const listJson = await listRes.json(); //Recibo la respuesta
    const existing = (listJson.data || []).find(m => (m.namespace === "factura") && (m.key === "MONTO")); //Mapeo si ya hay un dato con namespace = factura y el key = monto para saber si actualizo o creo un nuevo campo, devolviendo un true o false

    let upserted; 
    if (existing) {
      const putUrl = `https://api.bigcommerce.com/stores/${BC_STORE_HASH}/v3/orders/${orderId}/metafields/${existing.id}`;
      const putRes = await fetch(putUrl, {
        method: "PUT",
        headers: {
          "X-Auth-Token": BC_ADMIN_TOKEN, 
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          data: {
            namespace: "factura",
            key: "MONTO",
            value: String(suma),
            permission_set: "read_and_sf_access"
          }
        })
      }); //Este bloque realiza una actualización de monto de acuerdo a la suma realizada anteriormente
      if (!putRes.ok) return res.status(putRes.status).send(await putRes.text()); //Si no hay respuesta, devuelve el estatus
      const putJson = await putRes.json(); //Recibo la respuesta
      upserted = putJson.data; //Recibo los datos finales
    } else {
      const postUrl = `https://api.bigcommerce.com/stores/${BC_STORE_HASH}/v3/orders/${orderId}/metafields`;
      const postRes =await fetch(postUrl, {
        method: "POST",
        headers: {
          "X-Auth-Token": BC_ADMIN_TOKEN, 
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
            namespace: "factura",
            key: "MONTO",
            value: String(suma),
            permission_set: "read_and_sf_access"
        })
      }); //Este bloque realiza una insersión de monto de acuerdo a la suma realizada anteriormente
      if (!postRes.ok) return res.status(postRes.status).send(await postRes.text()); //Si no hay respuesta, devuelve el estatus
      const postJson = await postRes.json(); //Recibo la respuesta
      upserted = (postJson.data && postJson.data[0]) || null; //Recibo los datos finales
    }
  return res.json({
      orderId,
      monto: suma,
      metafield: upserted
    });

  } catch (e) {
    console.error("total:", e.message);
    return res.status(500).json({error: "Error del servidor"});
  }
});

app.listen(PORT, () => console.log(`Proxy en http://localhost:${PORT}`));







