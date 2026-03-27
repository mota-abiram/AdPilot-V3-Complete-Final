# Dockerfile for AdPilot V3 (Unified Dashboard + Agents)
FROM node:20-slim

# 1. Install System Dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Set Workspace
WORKDIR /app

# 3. Copy root files and setup Python
COPY . .

# Install necessary Python libraries (for Meta and Google Ads)
# Note: google-ads library can be large, consider using a lighter alternative or narrowing dependencies.
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir \
    facebook-business \
    google-ads \
    requests \
    python-dotenv \
    pandas

# 4. Build the AdPilot Dashboard (Node.js)
WORKDIR /app/adpilot
RUN npm install
RUN npm run build

# 5. Environment & Permissions
# Create persistence layer for data JSONs
RUN mkdir -p /app/ads_agent/data && chmod -R 777 /app/ads_agent/data

EXPOSE 5000
ENV NODE_ENV=production
ENV PORT=5000

# Start the dashboard — it will automatically trigger the Python scheduler
CMD ["npm", "start"]
