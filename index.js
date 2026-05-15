require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// ----- Configuration -----
const STORE_HASH = process.env.STORE_HASH;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const PORT = process.env.PORT || 3000;
const NGROK_URL = process.env.NGROK_URL;

const BC_API_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;

// Axios instance pre-configured for BigCommerce API
const bcApi = axios.create({
  baseURL: BC_API_BASE,
  headers: {
    "X-Auth-Token": AUTH_TOKEN,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
});

// ----- Middleware -----
app.use(express.json());

// Request logger – prints every incoming request to the console
app.use((req, _res, next) => {
  console.log(`\n[REQUEST]  ${req.method} ${req.path}`);
  if (req.body && Object.keys(req.body).length) {
    console.log("Body:", JSON.stringify(req.body, null, 2));
  }
  next();
});

// =====================================================================
//  Webhook Callback Endpoint  –  POST /webhooks
//  BigCommerce will POST event payloads here.
// =====================================================================
app.post("/webhooks", (req, res) => {
  const { scope, store_id, data, hash, created_at, producer } = req.body;

  console.log("===================================================");
  console.log("  WEBHOOK EVENT RECEIVED");
  console.log("===================================================");
  console.log("  Scope       : " + scope);
  console.log("  Store ID    : " + store_id);
  console.log("  Hash        : " + hash);
  console.log("  Created At  : " + created_at);
  console.log("  Producer    : " + producer);
  console.log("  Data        :", JSON.stringify(data, null, 2));
  console.log("===================================================\n");

  // Respond 200 quickly – BigCommerce expects a fast response
  res.status(200).json({ success: true });
});

// =====================================================================
//  Register Webhooks  –  GET /register?ngrok_url=<YOUR_NGROK_URL>
//  Call this ONCE after you start ngrok to register both webhooks.
// =====================================================================
app.get("/register", async (req, res) => {
  if (!NGROK_URL) {
    return res.status(500).json({
      error: 'NGROK_URL is not set in .env file. Please add it and restart the server.',
    });
  }

  const destination = NGROK_URL.replace(/\/$/, "") + "/webhooks";

  const webhooksToRegister = [
    {
      scope: "store/product/created",
      destination: destination,
      is_active: true,
      headers: {},
    },
    {
      scope: "store/product/updated",
      destination: destination,
      is_active: true,
      headers: {},
    },
  ];

  console.log("\nRegistering webhooks -> destination: " + destination + "\n");

  const results = [];

  for (const webhook of webhooksToRegister) {
    try {
      const response = await bcApi.post("/hooks", webhook);
      console.log("  Registered: " + webhook.scope + "  (id: " + response.data.data.id + ")");
      results.push({ scope: webhook.scope, status: "registered", id: response.data.data.id });
    } catch (err) {
      const errMsg = err.response ? err.response.data : err.message;
      console.error("  Failed: " + webhook.scope, errMsg);
      results.push({ scope: webhook.scope, status: "failed", error: errMsg });
    }
  }

  res.json({ results: results });
});

// =====================================================================
//  List Webhooks  –  GET /list
//  View all currently registered webhooks for this store.
// =====================================================================
app.get("/list", async (_req, res) => {
  try {
    const response = await bcApi.get("/hooks");
    console.log("\nTotal webhooks registered: " + response.data.data.length + "\n");
    response.data.data.forEach(function (wh) {
      console.log("   [" + wh.id + "] " + wh.scope + "  ->  " + wh.destination + "  (active: " + wh.is_active + ")");
    });
    res.json(response.data.data);
  } catch (err) {
    const errMsg = err.response ? err.response.data : err.message;
    console.error("Error listing webhooks:", errMsg);
    res.status(500).json({ error: errMsg });
  }
});

// =====================================================================
//  Delete a Webhook  –  DELETE /delete/:id
//  Handy for cleanup.
// =====================================================================
app.delete("/delete/:id", async (req, res) => {
  try {
    await bcApi.delete("/hooks/" + req.params.id);
    console.log("Deleted webhook " + req.params.id);
    res.json({ success: true, deleted: req.params.id });
  } catch (err) {
    const errMsg = err.response ? err.response.data : err.message;
    console.error("Error deleting webhook:", errMsg);
    res.status(500).json({ error: errMsg });
  }
});

// =====================================================================
//  Health Check  –  GET /
// =====================================================================
app.get("/", (_req, res) => {
  res.json({
    status: "running",
    message: "BigCommerce Webhook Listener",
    ngrok_url: NGROK_URL || "NOT SET",
    endpoints: {
      "GET  /":              "Health check (this page)",
      "GET  /register":      "Register webhooks using NGROK_URL from .env",
      "GET  /list":          "List all registered webhooks",
      "POST /webhooks":      "Webhook callback endpoint (BigCommerce posts here)",
      "DELETE /delete/:id":  "Delete a webhook by ID",
    },
  });
});

// ----- Start Server -----
app.listen(PORT, function () {
  console.log("\n==================================================");
  console.log("   BigCommerce Webhook Listener");
  console.log("==================================================");
  console.log("   Server running at: http://localhost:" + PORT);
  console.log("   Store Hash       : " + STORE_HASH);
  console.log("   Ngrok URL        : " + (NGROK_URL || "NOT SET"));
  console.log("==================================================");
  console.log("   NEXT STEPS:");
  console.log("   1. Make sure ngrok is running:  ngrok http 3000");
  console.log("   2. Visit: " + (NGROK_URL || "http://localhost:" + PORT) + "/register");
  console.log("==================================================\n");
});
