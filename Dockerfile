# Dockerfile for Cloudflare Workers development with Wrangler
# Using Ubuntu base for better workerd compatibility
FROM ubuntu:22.04

# Install Node.js and system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    python3 \
    make \
    g++ \
    ca-certificates \
    gnupg \
    lsb-release \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Install wrangler globally
RUN npm install -g wrangler@latest

# Copy package files
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy project files
COPY . .

# Create directory for wrangler data
RUN mkdir -p .wrangler

# Expose port for development server
EXPOSE 8787

# Default command runs wrangler dev
CMD ["wrangler", "dev", "--host", "0.0.0.0", "--port", "8787"]