# Dockerfile for AdPilot V3 (Unified Dashboard + Agents)
FROM node:20-slim

# 1. Install System Dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    build-essential \
    libffi-dev \
    libssl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Create Python virtual environment (required for Debian Bookworm / PEP 668)
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 3. Install Python dependencies inside the venv
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir --prefer-binary \
    facebook-business \
    google-ads \
    requests \
    python-dotenv \
    pandas

# 4. Set Workspace & copy project files
WORKDIR /app
COPY . .

# 5. Build the AdPilot Dashboard (Node.js)
WORKDIR /app/adpilot
RUN npm install
RUN npm run build

# 6. Environment & Permissions
# Create persistence layer for data JSONs
RUN mkdir -p /app/ads_agent/data && chmod -R 777 /app/ads_agent/data

EXPOSE 5000
ENV NODE_ENV=production
ENV PORT=5000

# Start the dashboard — it will automatically trigger the Python scheduler
CMD ["npm", "start"]
