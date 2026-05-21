<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e0461c19-757b-433b-a93d-621d90329c34

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Add the required Cloudflare Pages secrets for server-side features
3. Run the app:
   `npm run dev`

## Database Setup

MTAANI POS uses Cloudflare D1 for data storage. To initialize the database:

### Quick Setup

```bash
# Start the backend server (in one terminal)
npm run wrangler:dev

# In another terminal, initialize the database
npm run db:setup
```

### Advanced Setup Options

```bash
# Setup for local development
npm run db:setup:local

# Setup for remote/production deployment
npm run db:setup:remote

# Custom API URL and secret
node scripts/db-setup.js --api-url=https://your-app.pages.dev --api-secret=your-secret
```

### Default Admin Login
After setup, you can login with:
- **Username**: Admin
- **Password**: admin123

### Manual Schema Execution

You can also manually execute the schema:

```bash
# Remote database
npm run d1:setup

# Local database
npm run d1:local
```

For detailed instructions, see [scripts/README.md](scripts/README.md).

## WhatsApp Business Webhook

The WhatsApp Cloud API webhook is available at:

```text
/api/whatsapp/webhook
```

Configure these Cloudflare Pages secrets before enabling the Meta webhook:

```bash
wrangler pages secret put WHATSAPP_ACCESS_TOKEN --project-name mtaanipos
wrangler pages secret put WHATSAPP_PHONE_NUMBER_ID --project-name mtaanipos
wrangler pages secret put WHATSAPP_VERIFY_TOKEN --project-name mtaanipos
```

Optional hardening:

```bash
wrangler pages secret put WHATSAPP_APP_SECRET --project-name mtaanipos
```

WhatsApp examples:

```text
link YOURBUSINESSCODE
summary
branches
stock
approvals
approve A1 1234
reject A1 1234
audit orders
create LPO from Supplier Name: 10 Product A, 5 Product B
confirm PO ABC123 1234
unlink
```

The same actions can be phrased naturally, for example:

```text
My business code is ABC123
Show me what needs approval
Approve the first expense, pin 1234
Please reject the stock adjustment with pin 1234
Make an LPO for Acme Supplies with 10 sugar and 5 flour
Yes create that LPO, pin 1234
Review our recent purchase orders for risks
```

After linking, any normal WhatsApp message is sent to Mtaani AI with that business's POS snapshot, for example:

```text
Which products are not moving?
Which customers owe us most?
How are sales today?
```

WhatsApp write actions require an admin PIN/password in the message. LPO creation is two-step: the bot drafts the LPO first, then creates it only after `confirm PO <code> <admin-pin>`.
