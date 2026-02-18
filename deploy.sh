#!/bin/bash
set -e

# Encrypted Survey Deployment Script
# Uses Cloudflare REST API exclusively (no wrangler required)
# Dependencies: curl, jq, node/npm (for build only)

# Usage: ./deploy.sh <config_file>
# Example: ./deploy.sh .deploy.production

if [ -z "$1" ]; then
    echo "Usage: ./deploy.sh <config_file>"
    echo "Example: ./deploy.sh .deploy.production"
    exit 1
fi

CONFIG_FILE="$1"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Error: Configuration file '$CONFIG_FILE' not found!"
    exit 1
fi

# Check for required tools
command -v curl >/dev/null 2>&1 || { echo "Error: curl is required but not installed."; exit 1; }
command -v jq >/dev/null 2>&1 || { echo "Error: jq is required but not installed."; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Error: node is required for building assets."; exit 1; }

source "$CONFIG_FILE"
echo "✓ Configuration loaded from $CONFIG_FILE"

# Validate required configuration
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo "Error: CLOUDFLARE_API_TOKEN is required in config file"
    exit 1
fi

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    echo "Error: CLOUDFLARE_ACCOUNT_ID is required in config file"
    exit 1
fi

if [ -z "${WORKER_NAME:-}" ]; then
    echo "Error: WORKER_NAME is required in config file"
    exit 1
fi

if [ -z "${DATABASE_NAME:-}" ]; then
    echo "Error: DATABASE_NAME is required in config file"
    exit 1
fi

# API base URLs
API_BASE="https://api.cloudflare.com/client/v4"
AUTH_HEADER="Authorization: Bearer $CLOUDFLARE_API_TOKEN"

echo ""
echo "========================================"
echo "Encrypted Survey Deployment"
echo "========================================"
echo "Worker Name: $WORKER_NAME"
echo "Database: $DATABASE_NAME"
echo "Environment: ${ENVIRONMENT:-production}"
echo "========================================"
echo ""

# Step 1: Build static assets
echo "► Building static assets..."
npm run build
if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi
echo "✓ Static assets built successfully"
echo ""

# Step 2: Create or verify D1 database exists
echo "► Checking D1 database '$DATABASE_NAME'..."
DB_LIST_RESPONSE=$(curl -s -X GET "$API_BASE/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database" \
    -H "$AUTH_HEADER")

# Check if API call was successful
if ! echo "$DB_LIST_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    echo "❌ Failed to list databases!"
    echo "$DB_LIST_RESPONSE" | jq -r '.errors[] | "Error \(.code): \(.message)"' 2>/dev/null || echo "$DB_LIST_RESPONSE"
    exit 1
fi

# Find existing database
DB_ID=$(echo "$DB_LIST_RESPONSE" | jq -r ".result[] | select(.name == \"$DATABASE_NAME\") | .uuid" | head -n1)

if [ -z "$DB_ID" ] || [ "$DB_ID" == "null" ]; then
    echo "  - Database not found. Creating it..."

    CREATE_RESPONSE=$(curl -s -X POST "$API_BASE/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        --data "{\"name\":\"$DATABASE_NAME\"}")

    if ! echo "$CREATE_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
        echo "❌ Failed to create database!"
        echo "$CREATE_RESPONSE" | jq -r '.errors[] | "Error \(.code): \(.message)"' 2>/dev/null || echo "$CREATE_RESPONSE"
        exit 1
    fi

    DB_ID=$(echo "$CREATE_RESPONSE" | jq -r '.result.uuid')
    echo "✓ Database created with ID: $DB_ID"
else
    echo "✓ Database exists with ID: $DB_ID"
fi
echo ""

# Step 3: Run database migrations
echo "► Running database migrations..."

# Function to execute SQL via D1 API
execute_sql() {
    local sql_content="$1"
    local description="$2"

    # Escape the SQL for JSON
    local sql_escaped=$(echo "$sql_content" | jq -Rs .)

    local response=$(curl -s -X POST "$API_BASE/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database/$DB_ID/query" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        --data "{\"sql\":$sql_escaped}")

    # Check for success (ignore duplicate/already exists errors)
    if echo "$response" | jq -e '.success == true' > /dev/null 2>&1; then
        echo "  ✓ $description"
        return 0
    else
        # Check if it's a benign error (table/column already exists)
        local error_msg=$(echo "$response" | jq -r '.errors[0].message' 2>/dev/null)
        if echo "$error_msg" | grep -q -E "already exists|duplicate"; then
            echo "  ✓ $description (already applied)"
            return 0
        else
            echo "  ⚠ Warning: $description"
            echo "    $error_msg"
            return 1
        fi
    fi
}

# Function to parse and execute SQL file
execute_sql_file() {
    local file_path="$1"
    local file_name=$(basename "$file_path")

    echo "  - Running $file_name..."

    # Use Python to split SQL statements properly
    python3 - "$file_path" <<'PYEOF'
import sys
import re

def parse_sql_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Remove SQL comments
    content = re.sub(r'--[^\n]*\n', '\n', content)

    # Split on semicolons
    statements = content.split(';')

    for stmt in statements:
        stmt = stmt.strip()
        if stmt:
            print(stmt)
            print("---STATEMENT_SEPARATOR---")

parse_sql_file(sys.argv[1])
PYEOF

    # Read Python output and execute each statement
    local statement=""
    while IFS= read -r line; do
        if [ "$line" = "---STATEMENT_SEPARATOR---" ]; then
            if [ -n "$statement" ]; then
                execute_sql "$statement" "SQL statement" || true
                statement=""
            fi
        else
            if [ -n "$statement" ]; then
                statement="$statement
$line"
            else
                statement="$line"
            fi
        fi
    done < <(python3 - "$file_path" <<'PYEOF'
import sys
import re

def parse_sql_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    # Remove SQL comments
    content = re.sub(r'--[^\n]*\n', '\n', content)

    # Split on semicolons
    statements = content.split(';')

    for stmt in statements:
        stmt = stmt.strip()
        if stmt:
            print(stmt)
            print("---STATEMENT_SEPARATOR---")

parse_sql_file(sys.argv[1])
PYEOF
)

    echo "  ✓ $file_name completed"
}

# Run initial schema
if [ -f "schemas/001-initial.sql" ]; then
    execute_sql_file "schemas/001-initial.sql"
fi

# Run analysis_id migration
if [ -f "schemas/002-add-analysis-id.sql" ]; then
    execute_sql_file "schemas/002-add-analysis-id.sql"
fi

echo "✓ Database migrations completed"
echo ""

# Step 4: Package and upload worker
echo "► Deploying worker script '$WORKER_NAME'..."

# Check if worker scripts exist
WORKER_INDEX="src/worker/index.js"
WORKER_DATABASE="src/worker/database.js"
WORKER_ASSETS="src/worker/assets.js"

if [ ! -f "$WORKER_INDEX" ]; then
    echo "❌ Worker script not found at $WORKER_INDEX"
    exit 1
fi

if [ ! -f "$WORKER_DATABASE" ]; then
    echo "❌ Database module not found at $WORKER_DATABASE"
    exit 1
fi

if [ ! -f "$WORKER_ASSETS" ]; then
    echo "❌ Assets module not found at $WORKER_ASSETS"
    exit 1
fi

# Create metadata JSON with D1 binding
METADATA=$(cat <<EOF
{
  "main_module": "index.js",
  "compatibility_date": "2024-08-14",
  "bindings": [
    {
      "type": "d1",
      "name": "DB",
      "id": "$DB_ID"
    }
  ]
}
EOF
)

# Upload worker with all modules
UPLOAD_RESPONSE=$(curl -s -X PUT "$API_BASE/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME" \
    -H "$AUTH_HEADER" \
    -F "metadata=@-;type=application/json" \
    -F "index.js=@$WORKER_INDEX;type=application/javascript+module" \
    -F "database.js=@$WORKER_DATABASE;type=application/javascript+module" \
    -F "assets.js=@$WORKER_ASSETS;type=application/javascript+module" \
    <<< "$METADATA")

if ! echo "$UPLOAD_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    echo "❌ Worker deployment failed!"
    echo "$UPLOAD_RESPONSE" | jq -r '.errors[] | "Error \(.code): \(.message)"' 2>/dev/null || echo "$UPLOAD_RESPONSE"
    exit 1
fi

echo "✓ Worker script uploaded successfully (3 modules)"
echo ""

# Step 5: Enable workers.dev subdomain
echo "► Enabling workers.dev route..."
SUBDOMAIN_RESPONSE=$(curl -s -X POST "$API_BASE/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER_NAME/subdomain" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    --data '{"enabled":true}')

if echo "$SUBDOMAIN_RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    echo "✓ Workers.dev route enabled"
else
    echo "⚠ Warning: Could not enable workers.dev route"
    echo "$SUBDOMAIN_RESPONSE" | jq -r '.errors[] | "Error \(.code): \(.message)"' 2>/dev/null || true
fi
echo ""

# Step 6: Get the deployment URL
# Extract subdomain from account
ACCOUNT_SUBDOMAIN=$(curl -s -X GET "$API_BASE/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" \
    -H "$AUTH_HEADER" | jq -r '.result.subdomain' 2>/dev/null)

if [ -n "$ACCOUNT_SUBDOMAIN" ] && [ "$ACCOUNT_SUBDOMAIN" != "null" ]; then
    DEPLOY_URL="https://$WORKER_NAME.$ACCOUNT_SUBDOMAIN.workers.dev"
else
    DEPLOY_URL="https://$WORKER_NAME.workers.dev"
fi

echo ""
echo "========================================"
echo "Deployment Complete!"
echo "========================================"
echo "Worker: $WORKER_NAME"
echo "Database: $DATABASE_NAME"
echo "Database ID: $DB_ID"
echo "URL: $DEPLOY_URL"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Visit $DEPLOY_URL to test your deployment"
echo "2. Create a survey at $DEPLOY_URL/create"
echo "3. Check deployment status in Cloudflare Dashboard"
echo ""
