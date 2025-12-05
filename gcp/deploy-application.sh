#!/bin/bash
# ==============================================================================
# Deploy Whiteboard Application to GCP VMs
# Run this script after setup-gcp-infrastructure.sh
# ==============================================================================

set -e

# Configuration
PROJECT_ID="cloud-computing-480222"
ZONE="us-central1-a"
REGION="us-central1"
REDIS_INSTANCE_NAME="whiteboard-redis"
REPO_URL="https://github.com/YOUR_USERNAME/whiteboard1.git"  # Update this!

echo "=============================================="
echo "Deploying Whiteboard Application"
echo "=============================================="

# Get Redis IP
REDIS_IP=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(host)")
echo "Redis IP: $REDIS_IP"

# Deployment script that will run on each VM
DEPLOY_SCRIPT='#!/bin/bash
set -e

NODE_ID=$1
REDIS_URL=$2
REPO_URL=$3

echo "Deploying whiteboard on $NODE_ID..."

# Stop existing containers
docker stop whiteboard 2>/dev/null || true
docker rm whiteboard 2>/dev/null || true

# Clone or update repository
if [ -d "/opt/whiteboard" ]; then
    cd /opt/whiteboard
    git pull
else
    git clone $REPO_URL /opt/whiteboard
    cd /opt/whiteboard
fi

# Build Docker image
docker build -t whiteboard:latest .

# Run container
docker run -d \
    --name whiteboard \
    --restart always \
    -p 8080:8080 \
    -e NODE_ID=$NODE_ID \
    -e REDIS_URL=$REDIS_URL \
    -e USE_REDIS=true \
    -v /opt/whiteboard/data:/opt/app/public/uploads \
    whiteboard:latest

echo "Whiteboard deployed successfully on $NODE_ID!"
docker ps | grep whiteboard
'

# Deploy to Node 1
echo ""
echo "[1/2] Deploying to whiteboard-node-1..."
gcloud compute ssh whiteboard-node-1 --zone=$ZONE --command="
sudo bash -c '$(echo "$DEPLOY_SCRIPT")' -- node1 redis://$REDIS_IP:6379 $REPO_URL
"

# Deploy to Node 2
echo ""
echo "[2/2] Deploying to whiteboard-node-2..."
gcloud compute ssh whiteboard-node-2 --zone=$ZONE --command="
sudo bash -c '$(echo "$DEPLOY_SCRIPT")' -- node2 redis://$REDIS_IP:6379 $REPO_URL
"

# Get external IPs
NODE1_IP=$(gcloud compute instances describe whiteboard-node-1 --zone=$ZONE --format="value(networkInterfaces[0].accessConfigs[0].natIP)")
NODE2_IP=$(gcloud compute instances describe whiteboard-node-2 --zone=$ZONE --format="value(networkInterfaces[0].accessConfigs[0].natIP)")
LB_IP=$(gcloud compute forwarding-rules describe whiteboard-http-rule --global --format="value(IPAddress)" 2>/dev/null || echo "N/A")

echo ""
echo "=============================================="
echo "Deployment Complete!"
echo "=============================================="
echo ""
echo "Access Points:"
echo "  - Load Balancer: http://$LB_IP"
echo "  - Node 1 Direct: http://$NODE1_IP:8080"
echo "  - Node 2 Direct: http://$NODE2_IP:8080"
echo ""
echo "Health Check URLs:"
echo "  - http://$NODE1_IP:8080/api/health"
echo "  - http://$NODE2_IP:8080/api/health"
echo ""
echo "Test the whiteboard at:"
echo "  http://$LB_IP/?whiteboardid=test"
echo ""
