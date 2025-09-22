#!/bin/bash

# Development script for encrypted survey tool using plain Docker

echo "🐳 Starting Encrypted Survey Development Environment"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Build the Docker image
echo "📦 Building Docker image..."
docker build -t encrypted-survey-dev .

# Initialize database
echo "🗄️  Setting up local database..."
docker run --rm -v $(pwd):/app encrypted-survey-dev wrangler d1 execute encrypted-survey-db --local --file=./schemas/001-initial.sql

# Start development server
echo "🚀 Starting development server..."
echo "   Server will be available at: http://localhost:8787"
echo "   Press Ctrl+C to stop"
echo ""

# Run with port mapping and volume mount for live reload
docker run --rm -it \
    -p 8787:8787 \
    -v $(pwd):/app \
    -v /app/node_modules \
    encrypted-survey-dev