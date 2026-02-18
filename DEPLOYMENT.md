# Deployment Guide

This guide explains how to deploy the Encrypted Survey application to Cloudflare Workers using the REST API.

## Prerequisites

1. **Cloudflare Account**: Sign up at https://dash.cloudflare.com
2. **Node.js & npm**: For building static assets only
3. **curl**: Command-line tool for HTTP requests (pre-installed on most systems)
4. **jq**: JSON processor for parsing API responses

### Installing jq

**macOS:**
```bash
brew install jq
```

**Ubuntu/Debian:**
```bash
sudo apt-get install jq
```

**Other systems:** See https://stedolan.github.io/jq/download/

> **Note:** This deployment script uses the Cloudflare REST API directly and does NOT require wrangler or any Cloudflare CLI tools.

## Setup Steps

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Deployment Configuration

Copy the example configuration file:

```bash
cp .deploy.example .deploy.production
```

Edit `.deploy.production` and fill in your values:

```bash
# Get your API token from: https://dash.cloudflare.com/profile/api-tokens
# Required permissions: Workers Scripts:Edit, D1:Edit, Account Settings:Read
CLOUDFLARE_API_TOKEN="your-api-token-here"

# Find your Account ID in the Workers & Pages overview
CLOUDFLARE_ACCOUNT_ID="your-account-id-here"

# Choose a name for your worker (this becomes your subdomain)
WORKER_NAME="encrypted-survey"

# Database name
DATABASE_NAME="encrypted-survey-db"

# Optional: Environment label
ENVIRONMENT="production"
```

### 3. Run Deployment Script

```bash
./deploy.sh .deploy.production
```

The script will:
- Build static assets from `public/` and `src/shared/`
- Create D1 database if it doesn't exist
- Run all database migrations
- Update `wrangler.toml` with the database ID
- Deploy the worker to Cloudflare
- Display the deployment URL

## What Gets Created

### Cloudflare Worker
- **Name**: The value from `WORKER_NAME` in your config
- **URL**: `https://your-worker-name.your-subdomain.workers.dev`
- **Code**: Your built worker script with inlined assets

### D1 Database
- **Name**: The value from `DATABASE_NAME` in your config
- **Tables**: `surveys` and `responses` with proper indexes
- **Migrations**: All SQL files from `schemas/` directory are applied

## Multiple Environments

You can create different deployment configurations for staging, production, etc:

```bash
# Create staging config
cp .deploy.example .deploy.staging
# Edit .deploy.staging with staging values

# Deploy to staging
./deploy.sh .deploy.staging

# Create production config
cp .deploy.example .deploy.production
# Edit .deploy.production with production values

# Deploy to production
./deploy.sh .deploy.production
```

## Troubleshooting

### "Database not found" Error
The script automatically creates the database. If you see this error, check:
- Your `CLOUDFLARE_API_TOKEN` has D1:Edit permission
- Your `CLOUDFLARE_ACCOUNT_ID` is correct

### "Build failed" Error
Ensure all dependencies are installed:
```bash
npm install
```

### Migration Errors
The script ignores "already exists" errors, so re-running is safe. If you need to reset:
```bash
# Delete and recreate the database
wrangler d1 delete encrypted-survey-db
./deploy.sh .deploy.production
```

### Deployment Fails
Check that:
- Your API token has Workers Scripts:Edit permission
- The worker name is available (not already taken)
- Your account has sufficient Workers/D1 quota

### jq Not Found
Install jq using your package manager:
```bash
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq
```

## How It Works

The deployment script uses the Cloudflare REST API exclusively:

1. **D1 Database Management**:
   - `GET /accounts/{id}/d1/database` - Lists existing databases
   - `POST /accounts/{id}/d1/database` - Creates new database
   - `POST /accounts/{id}/d1/database/{db_id}/query` - Executes SQL

2. **Worker Deployment**:
   - `PUT /accounts/{id}/workers/scripts/{name}` - Uploads worker with bindings
   - `POST /accounts/{id}/workers/scripts/{name}/subdomain` - Enables workers.dev

3. **Asset Building**:
   - `npm run build` - Bundles static assets into src/worker/assets.js

## Monitoring

### View Deployment Status
Check in Cloudflare Dashboard:
- Workers & Pages → Your worker → Deployments

### View Database Contents
Use the API to query your database:
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/d1/database/{DB_ID}/query" \
  -H "Authorization: Bearer {API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"sql":"SELECT * FROM surveys LIMIT 10"}'
```

### Check Worker Logs
View logs in Cloudflare Dashboard under Workers & Pages → Your worker → Logs

Or use wrangler if you have it installed:
```bash
npx wrangler tail your-worker-name
```

## Security Notes

- **Never commit** `.deploy.production` or `.deploy.staging` files (they contain API tokens)
- The `.deploy.*` pattern is already in `.gitignore`
- Only `.deploy.example` should be committed to version control
- Rotate your API tokens regularly
- Use separate tokens for production and staging environments

## Updating an Existing Deployment

Simply run the deploy script again:

```bash
./deploy.sh .deploy.production
```

The script will:
- Rebuild assets
- Re-apply migrations (safely, ignoring duplicates)
- Update the worker code
- Keep existing data in the database

## Rollback

Cloudflare Workers doesn't have built-in rollback. To revert:

1. Check out the previous version in git:
   ```bash
   git checkout <previous-commit>
   ```

2. Redeploy:
   ```bash
   ./deploy.sh .deploy.production
   ```

3. Return to main branch:
   ```bash
   git checkout main
   ```

## Custom Domain (Optional)

To use a custom domain:

1. Add your domain to Cloudflare
2. In Cloudflare dashboard, go to Workers & Pages → your worker
3. Click "Add Custom Domain"
4. Follow the instructions to set up DNS

Or use the API to add a custom domain route:
```bash
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/workers/scripts/{WORKER_NAME}/routes" \
  -H "Authorization: Bearer {API_TOKEN}" \
  -H "Content-Type: application/json" \
  --data '{"pattern":"survey.example.com/*","zone_id":"{ZONE_ID}"}'
```

## API-Only Deployment Benefits

This deployment script uses only the Cloudflare REST API, which provides several advantages:

✅ **No Wrangler dependency** - Only requires curl, jq, and Node.js for builds
✅ **CI/CD friendly** - Easy to integrate into any deployment pipeline
✅ **Transparent** - See exactly what API calls are being made
✅ **Portable** - Works on any system with bash, curl, and jq
✅ **Minimal footprint** - No need to install Cloudflare CLI tools

The script handles:
- D1 database creation and migrations via API
- Worker deployment with D1 bindings via API
- Workers.dev subdomain enablement via API
- All resource management through REST endpoints
