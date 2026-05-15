# BigCommerce Webhook Setup & Testing Guide

## Project Overview

Your webhook project is set up with an Express server that:
- **Receives** webhook payloads from BigCommerce at `POST /webhooks`
- **Registers** two webhooks (`store/product/created` & `store/product/updated`) via `GET /register`
- **Lists** all registered webhooks via `GET /list`
- **Deletes** webhooks via `DELETE /delete/:id`

## Files Created

| File | Purpose |
|------|---------|
| [index.js](file:///home/elsner/Nishil/Webhook/index.js) | Express server — webhook listener + registration endpoints |
| [.env](file:///home/elsner/Nishil/Webhook/.env) | BigCommerce credentials (store hash & auth token) |
| [.gitignore](file:///home/elsner/Nishil/Webhook/.gitignore) | Excludes `node_modules/` and `.env` from git |
| [package.json](file:///home/elsner/Nishil/Webhook/package.json) | Dependencies: `express`, `axios`, `dotenv` |

---

## Step-by-Step Testing Guide

### Step 1: Start the Express Server

Open **Terminal 1** and run:

```bash
cd /home/elsner/Nishil/Webhook
node index.js
```

You should see the startup banner with `http://localhost:3000`.

### Step 2: Start ngrok Tunnel

Open **Terminal 2** and run:

```bash
ngrok http 3000
```

ngrok will display a forwarding URL like:
```
Forwarding  https://xxxx-xxx-xxx.ngrok-free.app -> http://localhost:3000
```

> [!IMPORTANT]
> Copy the **https** URL (e.g. `https://abcd-1234.ngrok-free.app`). You'll need it in the next step.

### Step 3: Register the Webhooks

Open your browser or use curl. Replace `YOUR_NGROK_URL` with the actual ngrok URL:

```bash
curl "http://localhost:3000/register?ngrok_url=https://YOUR_NGROK_URL"
```

**Example:**
```bash
curl "http://localhost:3000/register?ngrok_url=https://abcd-1234.ngrok-free.app"
```

You should see a response like:
```json
{
  "results": [
    { "scope": "store/product/created", "status": "registered", "id": 12345 },
    { "scope": "store/product/updated", "status": "registered", "id": 12346 }
  ]
}
```

### Step 4: Verify Registration

```bash
curl http://localhost:3000/list
```

This lists all webhooks registered on your store with their IDs, scopes, and destinations.

### Step 5: Test the Webhooks

Now trigger the events from your BigCommerce admin panel:

#### Test `store/product/created`:
1. Go to your BigCommerce admin → **Products** → **Add Product**
2. Create a new product with any name/price
3. Click **Save**
4. Watch **Terminal 1** — you should see the webhook event logged with the new product's data

#### Test `store/product/updated`:
1. Go to your BigCommerce admin → **Products**
2. Click on any existing product
3. Edit any attribute (name, price, description, etc.)
4. Click **Save**
5. Watch **Terminal 1** — you should see the webhook event logged

### Example Webhook Event Output

When an event fires, your terminal will show something like:

```
═══════════════════════════════════════════════════
🔔  WEBHOOK EVENT RECEIVED
═══════════════════════════════════════════════════
  Scope       : store/product/created
  Store ID    : gn5r3gszhx
  Hash        : abc123...
  Created At  : 1747309200
  Producer    : stores/gn5r3gszhx
  Data        : {
    "type": "product",
    "id": 123
  }
═══════════════════════════════════════════════════
```

---

## Useful Commands

| Action | Command |
|--------|---------|
| Start server | `node index.js` |
| Start ngrok | `ngrok http 3000` |
| Register webhooks | `curl "http://localhost:3000/register?ngrok_url=<NGROK_URL>"` |
| List webhooks | `curl http://localhost:3000/list` |
| Delete a webhook | `curl -X DELETE http://localhost:3000/delete/<WEBHOOK_ID>` |

---

## Troubleshooting

> [!WARNING]
> **ngrok URL changes every time you restart ngrok** (on the free plan). You'll need to re-register webhooks with the new URL each time.

> [!TIP]
> If you get a `422` error during registration, the webhook might already be registered. Use `GET /list` to check, then `DELETE /delete/:id` to remove duplicates before re-registering.

> [!NOTE]
> BigCommerce sends a lightweight payload with the event scope and product ID. To get full product details, you would make a follow-up API call to `GET /v3/catalog/products/{id}`.
