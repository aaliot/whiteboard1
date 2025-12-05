#!/bin/bash
# ==============================================================================
# Simple VM-based Deployment (No Docker required)
# Run this on each GCP VM to set up the whiteboard directly
# ==============================================================================

set -e

NODE_ID=${1:-"node1"}
REDIS_HOST=${2:-"localhost"}
REDIS_PORT=${3:-"6379"}

echo "=============================================="
echo "Setting up Whiteboard Node: $NODE_ID"
echo "Redis: $REDIS_HOST:$REDIS_PORT"
echo "=============================================="

# Update system
echo "[1/6] Updating system packages..."
sudo apt-get update
sudo apt-get install -y curl git

# Install Node.js 18
echo "[2/6] Installing Node.js 18..."
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify Node.js installation
node --version
npm --version

# Clone repository
echo "[3/6] Cloning whiteboard repository..."
if [ -d "/opt/whiteboard" ]; then
    cd /opt/whiteboard
    sudo git pull
else
    sudo git clone https://github.com/cracker0dks/whiteboard.git /opt/whiteboard
    cd /opt/whiteboard
fi

# Install dependencies
echo "[4/6] Installing dependencies..."
sudo npm install

# Build frontend
echo "[5/6] Building frontend..."
sudo npm run build

# Create systemd service
echo "[6/6] Creating systemd service..."
sudo tee /etc/systemd/system/whiteboard.service > /dev/null <<EOF
[Unit]
Description=Distributed Whiteboard Application
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/whiteboard
Environment=NODE_ID=$NODE_ID
Environment=REDIS_URL=redis://$REDIS_HOST:$REDIS_PORT
Environment=USE_REDIS=true
Environment=PORT=8080
ExecStart=/usr/bin/npm run start
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable whiteboard
sudo systemctl restart whiteboard

echo ""
echo "=============================================="
echo "Whiteboard node setup complete!"
echo "=============================================="
echo ""
echo "Service status:"
sudo systemctl status whiteboard --no-pager

echo ""
echo "Access the whiteboard at:"
EXTERNAL_IP=$(curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google" 2>/dev/null || echo "localhost")
echo "  http://$EXTERNAL_IP:8080"
echo ""
echo "Useful commands:"
echo "  View logs: sudo journalctl -u whiteboard -f"
echo "  Restart:   sudo systemctl restart whiteboard"
echo "  Stop:      sudo systemctl stop whiteboard"
