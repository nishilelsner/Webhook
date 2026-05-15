require("dotenv").config();
const express = require("express");
const axios = require("axios");

const app = express();

// ----- Configuration -----
const STORE_HASH = process.env.STORE_HASH;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || process.env.NGROK_URL;

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
app.post("/webhooks", async (req, res) => {
    const { scope, data } = req.body;

    console.log("===================================================");
    console.log(`🔔  EVENT RECEIVED: ${scope}`);
    console.log(`📦  PRODUCT ID: ${data.id}`);

    // Perform the logic
    if (data && data.type === "product") {
        try {
            // STEP A: Get the product to find its categories
            console.log(`🔍  Fetching categories for product ${data.id}...`);
            const productRes = await bcApi.get(`/catalog/products/${data.id}`);
            const productCategories = productRes.data.data.categories;

            if (!productCategories || productCategories.length === 0) {
                console.log("ℹ️   Skipping: Product has no categories.");
            } else {
                // STEP B: Get details for these categories to check the name
                const catIds = productCategories.join(",");
                const categoriesRes = await bcApi.get(`/catalog/categories?id:in=${catIds}`);
                const categoryDetails = categoriesRes.data.data;

                // Check if any of the categories are named "VIP"
                const isVipProduct = categoryDetails.some(cat => cat.name.toUpperCase() === "VIP");

                if (isVipProduct) {
                    console.log(`⭐  Confirmed: Product ${data.id} is in the VIP category!`);
                    console.log(`🚀  Adding VIP custom field...`);

                    try {
                        const cfRes = await bcApi.post(`/catalog/products/${data.id}/custom-fields`, {
                            name: "VIP",
                            value: "VIP"
                        });
                        console.log(`✅  Custom Field Created! ID: ${cfRes.data.data.id}`);
                    } catch (cfErr) {
                        if (cfErr.response && cfErr.response.status === 422) {
                            console.log(`ℹ️   Note: Custom field already exists.`);
                        } else {
                            throw cfErr;
                        }
                    }
                } else {
                    console.log(`⏭️   Product ${data.id} is NOT in a VIP category. Checking for cleanup...`);
                    
                    const cfListRes = await bcApi.get(`/catalog/products/${data.id}/custom-fields`);
                    const existingVipField = cfListRes.data.data.find(f => f.name === "VIP" && f.value === "VIP");

                    if (existingVipField) {
                        console.log(`🗑️   Cleaning up: Deleting VIP custom field (ID: ${existingVipField.id}) from product ${data.id}...`);
                        await bcApi.delete(`/catalog/products/${data.id}/custom-fields/${existingVipField.id}`);
                        console.log("✅  Custom field deleted.");
                    } else {
                        console.log("ℹ️   Nothing to clean up.");
                    }
                }
            }
        } catch (err) {
            const errorMsg = err.response ? JSON.stringify(err.response.data) : err.message;
            console.error("❌  Error in VIP check logic:", errorMsg);
        }
    }
    
    console.log("===================================================\n");
    
    // Respond 200 OK at the END so Vercel doesn't kill the function early
    res.status(200).json({ success: true });
});

// =====================================================================
//  Register Webhooks  –  GET /register?ngrok_url=<YOUR_NGROK_URL>
//  Call this ONCE after you start ngrok to register both webhooks.
// =====================================================================
app.get("/register", async (req, res) => {
    // Properly trim and remove ALL trailing slashes
    const baseUrl = (BASE_URL || "").trim().replace(/\/+$/, "");
    
    if (!baseUrl) {
        return res.status(500).json({
            error: 'BASE_URL is not set in environment variables.',
        });
    }

    const destination = baseUrl + "/webhooks";

    const webhooksToRegister = [
        { scope: "store/product/created", destination: destination, is_active: true },
        { scope: "store/product/updated", destination: destination, is_active: true },
    ];

    console.log("\n🧹  Cleaning up existing webhooks before registering...");
    const results = [];

    try {
        // 1. Fetch all currently registered webhooks
        const existing = await bcApi.get("/hooks");
        const existingHooks = existing.data.data;

        for (const webhook of webhooksToRegister) {
            // 2. Delete any existing hooks that match the scope we are registering
            const duplicates = existingHooks.filter(h => h.scope === webhook.scope);
            for (const dup of duplicates) {
                console.log(`    🗑️   Deleting old webhook for ${webhook.scope} (ID: ${dup.id})`);
                await bcApi.delete(`/hooks/${dup.id}`);
            }

            // 3. Register the new clean webhook
            try {
                const response = await bcApi.post("/hooks", webhook);
                console.log(`    ✅  Registered: ${webhook.scope} (ID: ${response.data.data.id})`);
                results.push({ scope: webhook.scope, status: "registered", id: response.data.data.id });
            } catch (err) {
                const errMsg = err.response ? err.response.data : err.message;
                console.error(`    ❌  Failed to register ${webhook.scope}:`, errMsg);
                results.push({ scope: webhook.scope, status: "failed", error: errMsg });
            }
        }
        res.json({ message: "Cleanup and Registration Complete", results });
    } catch (err) {
        console.error("Error during registration process:", err.message);
        res.status(500).json({ error: err.message });
    }
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
//  Delete a Webhook  –  GET /delete/:id
//  Handy for cleanup.
// =====================================================================
app.get("/delete/:id", async (req, res) => {
    try {
        if (req.params.id === "all") {
            const existing = await bcApi.get("/hooks");
            const hooks = existing.data.data;
            for (const h of hooks) {
                await bcApi.delete(`/hooks/${h.id}`);
            }
            return res.json({ success: true, message: `Deleted all ${hooks.length} webhooks.` });
        }

        await bcApi.delete(`/hooks/${req.params.id}`);
        console.log(`🗑️   Deleted webhook ${req.params.id}`);
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
        base_url: BASE_URL || "NOT SET",
        endpoints: {
            "GET  /": "Health check (this page)",
            "GET  /register": "Register webhooks using BASE_URL from env",
            "GET  /list": "List all registered webhooks",
            "POST /webhooks": "Webhook callback endpoint",
            "DELETE /delete/:id": "Delete a webhook by ID",
        },
    });
});

// ----- Start Server (Only locally) -----
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, function () {
        console.log("\n==================================================");
        console.log("   BigCommerce Webhook Listener (LOCAL)");
        console.log("==================================================");
        console.log("   Server running at: http://localhost:" + PORT);
        console.log("   Store Hash       : " + STORE_HASH);
        console.log("   Base URL         : " + (BASE_URL || "NOT SET"));
        console.log("==================================================");
    });
}

// Export for Vercel
module.exports = app;
