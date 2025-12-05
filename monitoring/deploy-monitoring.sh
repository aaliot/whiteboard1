#!/bin/bash
# Deploy Prometheus + Grafana monitoring stack on redis-server VM
# Run this script on the redis-server VM (10.0.0.2)

set -e

echo "📊 Setting up Prometheus + Grafana monitoring..."

# Navigate to monitoring directory
cd /home/$USER/whiteboard1/monitoring

# Create directories if they don't exist
mkdir -p prometheus
mkdir -p grafana/provisioning/datasources
mkdir -p grafana/provisioning/dashboards

# Start the monitoring stack
echo "🚀 Starting monitoring containers..."
docker-compose -f docker-compose.monitoring.yml up -d

# Wait for services to start
echo "⏳ Waiting for services to start..."
sleep 10

# Check status
echo ""
echo "✅ Monitoring stack deployed!"
echo ""
echo "📊 Access URLs:"
echo "   Prometheus: http://$(hostname -I | awk '{print $1}'):9090"
echo "   Grafana:    http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "🔑 Grafana Login:"
echo "   Username: admin"
echo "   Password: whiteboard123"
echo ""
echo "📈 Dashboard: Whiteboard Distributed Monitoring (pre-configured)"
