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
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
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
