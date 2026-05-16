# Database Setup Script

This script provides a comprehensive way to initialize and seed the MTAANI POS database for Cloudflare D1 deployment.

## Overview

The `db-setup.js` script handles:

1. **Schema Creation**: Executes the full SQL schema to create all necessary tables and indexes
2. **Data Seeding**: Populates the database with essential initial data including:
   - Admin and user accounts
   - Product categories
   - Sample products
   - Suppliers and customers
   - Store settings
3. **API Integration**: Uses the same API endpoints as the frontend with proper authentication
4. **Error Handling**: Comprehensive error checking and reporting
5. **Idempotent Operations**: Safe to run multiple times (won't duplicate data)

## Usage

### Quick Start

```bash
# Run with default settings (localhost:8788)
npm run db:setup

# Run for local development
npm run db:setup:local

# Run for remote/production deployment
npm run db:setup:remote
```

### Advanced Usage

```bash
# Custom API URL and secret
node scripts/db-setup.js --api-url=https://your-app.pages.dev --api-secret=your-custom-secret

# Local development with custom port
node scripts/db-setup.js --api-url=http://localhost:3000

# Show help
node scripts/db-setup.js --help
```

## Environment Variables

The script uses the following environment variables:

- `API_SECRET` or `MTAANI_API_SECRET`: service API secret for authentication. There is no default secret.
- `API_BASE_URL`: Base URL for API calls (defaults to `http://localhost:8788`)

## Configuration

### API Base URLs

- **Local Development**: `http://localhost:8788` (default)
- **Remote/Production**: `https://your-app.pages.dev` (replace with your actual domain)

### Default Admin Account

After setup, you can login with:
- **Username**: Admin
- **Password**: admin123

## Seed Data

The script seeds the following data:

### Users
- Admin user with full system access
- Default cashier account
- Store manager account

### Categories
- Food Stuffs
- Beverages  
- Supplies
- Utilities
- Other

### Products
- 7 sample products with realistic pricing and stock levels
- Proper barcodes and tax categories

### Business Data
- Sample suppliers with contact information
- Sample customers
- Store settings and configuration

## Integration with Cloudflare D1

The script works seamlessly with Cloudflare D1 by:

1. Using the same API endpoints as the frontend application
2. Properly handling authentication with the `X-API-Key` header
3. Supporting both local and remote D1 databases
4. Following the same data structure and validation rules

## Error Handling

The script includes comprehensive error handling:

- API connectivity checks
- Schema initialization validation
- Duplicate data prevention
- Detailed error reporting
- Graceful failure handling

## Deployment Integration

For production deployment, ensure:

1. The API secret is set as a Cloudflare Pages environment variable
2. The database setup script runs as part of your deployment pipeline
3. Proper error handling for deployment failures

## Troubleshooting

### Common Issues

1. **API Connection Failed**: Ensure the backend server is running
2. **Authentication Failed**: Verify the API secret matches between frontend and backend
3. **Schema Already Exists**: The script will skip seeding if tables already contain data

### Debug Mode

For detailed debugging, set `NODE_DEBUG=1`:

```bash
NODE_DEBUG=1 node scripts/db-setup.js
```

## Security Notes

- The default admin password should be changed after initial setup
- API secrets should be properly secured in production
- The script should only be run in trusted environments
