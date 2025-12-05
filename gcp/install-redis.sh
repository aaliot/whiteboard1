#!/bin/bash
# ==============================================================================
# Install Redis on a VM
# Run this on the VM that will host Redis
# ==============================================================================

set -e

echo "=============================================="
echo "Installing Redis Server"
echo "=============================================="

# Update system
echo "[1/4] Updating system..."
sudo apt-get update

# Install Redis
echo "[2/4] Installing Redis..."
sudo apt-get install -y redis-server

# Configure Redis to accept external connections
echo "[3/4] Configuring Redis..."
sudo cp /etc/redis/redis.conf /etc/redis/redis.conf.backup

# Modify Redis config
sudo sed -i 's/^bind 127.0.0.1/bind 0.0.0.0/' /etc/redis/redis.conf
sudo sed -i 's/^protected-mode yes/protected-mode no/' /etc/redis/redis.conf
sudo sed -i 's/^# maxmemory <bytes>/maxmemory 256mb/' /etc/redis/redis.conf
sudo sed -i 's/^# maxmemory-policy noeviction/maxmemory-policy allkeys-lru/' /etc/redis/redis.conf

# Enable appendonly for persistence
sudo sed -i 's/^appendonly no/appendonly yes/' /etc/redis/redis.conf

# Restart Redis
echo "[4/4] Starting Redis..."
sudo systemctl restart redis-server
sudo systemctl enable redis-server

# Verify
echo ""
echo "=============================================="
echo "Redis Installation Complete!"
echo "=============================================="
echo ""
echo "Redis status:"
sudo systemctl status redis-server --no-pager

echo ""
echo "Testing Redis..."
redis-cli ping

INTERNAL_IP=$(hostname -I | awk '{print $1}')
EXTERNAL_IP=$(curl -s http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip -H "Metadata-Flavor: Google" 2>/dev/null || echo "N/A")

echo ""
echo "Redis connection URLs:"
echo "  Internal: redis://$INTERNAL_IP:6379"
echo "  External: redis://$EXTERNAL_IP:6379 (if firewall allows)"
echo ""
echo "Use the Internal IP for other VMs in the same network!"
