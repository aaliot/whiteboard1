#!/bin/bash
# ==============================================================================
# Quick Setup Script for GCP Cloud Shell
# This is the main script to run in Google Cloud Shell
# Project: cloud-computing-480222
# ==============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     Distributed Whiteboard - GCP Cloud Shell Setup          ║"
echo "║              Project: cloud-computing-480222                  ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Configuration
PROJECT_ID="cloud-computing-480222"
REGION="us-central1"
ZONE="us-central1-a"

# Set project
echo -e "${YELLOW}[Step 1/6] Setting GCP project...${NC}"
gcloud config set project $PROJECT_ID

# Enable required APIs
echo -e "${YELLOW}[Step 2/6] Enabling required APIs...${NC}"
gcloud services enable compute.googleapis.com
gcloud services enable redis.googleapis.com
gcloud services enable container.googleapis.com

# Check if VMs exist
echo -e "${YELLOW}[Step 3/6] Checking existing infrastructure...${NC}"

VM1_EXISTS=$(gcloud compute instances list --filter="name=whiteboard-node-1" --format="value(name)" 2>/dev/null || echo "")
VM2_EXISTS=$(gcloud compute instances list --filter="name=whiteboard-node-2" --format="value(name)" 2>/dev/null || echo "")

if [ -z "$VM1_EXISTS" ] || [ -z "$VM2_EXISTS" ]; then
    echo -e "${YELLOW}Creating VMs...${NC}"
    
    # Create VMs if they don't exist
    for i in 1 2; do
        VM_NAME="whiteboard-node-$i"
        if [ -z "$(gcloud compute instances list --filter="name=$VM_NAME" --format="value(name)" 2>/dev/null)" ]; then
            echo "Creating $VM_NAME..."
            gcloud compute instances create $VM_NAME \
                --zone=$ZONE \
                --machine-type=e2-medium \
                --image-family=ubuntu-2204-lts \
                --image-project=ubuntu-os-cloud \
                --boot-disk-size=20GB \
                --tags=http-server,https-server \
                --metadata=startup-script='#!/bin/bash
apt-get update
apt-get install -y docker.io docker-compose git nodejs npm
systemctl start docker
systemctl enable docker
usermod -aG docker $USER
'
        fi
    done
else
    echo -e "${GREEN}VMs already exist!${NC}"
fi

# Create firewall rules
echo -e "${YELLOW}[Step 4/6] Setting up firewall rules...${NC}"
gcloud compute firewall-rules create allow-whiteboard \
    --allow=tcp:8080,tcp:8081,tcp:8082,tcp:6379 \
    --target-tags=http-server \
    --description="Allow whiteboard traffic" \
    2>/dev/null || echo "Firewall rule already exists"

# Setup Redis on one of the VMs (simpler than Memorystore for demo)
echo -e "${YELLOW}[Step 5/6] Setting up Redis...${NC}"
REDIS_VM="whiteboard-node-1"

gcloud compute ssh $REDIS_VM --zone=$ZONE --command="
sudo docker run -d --name redis --restart always -p 6379:6379 redis:7-alpine redis-server --appendonly yes
" 2>/dev/null || echo "Redis might already be running"

# Get internal IP of Redis VM
REDIS_INTERNAL_IP=$(gcloud compute instances describe $REDIS_VM --zone=$ZONE --format="value(networkInterfaces[0].networkIP)")

# Deploy whiteboard to both VMs
echo -e "${YELLOW}[Step 6/6] Deploying whiteboard application...${NC}"

for i in 1 2; do
    VM_NAME="whiteboard-node-$i"
    echo "Deploying to $VM_NAME..."
    
    gcloud compute ssh $VM_NAME --zone=$ZONE --command="
        # Clone repository if not exists
        if [ ! -d '/opt/whiteboard' ]; then
            sudo git clone https://github.com/cracker0dks/whiteboard.git /opt/whiteboard
        fi
        
        cd /opt/whiteboard
        sudo git pull
        
        # Stop existing container
        sudo docker stop whiteboard 2>/dev/null || true
        sudo docker rm whiteboard 2>/dev/null || true
        
        # Build and run
        sudo docker build -t whiteboard:latest .
        sudo docker run -d \\
            --name whiteboard \\
            --restart always \\
            -p 8080:8080 \\
            -e NODE_ID=node$i \\
            -e REDIS_URL=redis://$REDIS_INTERNAL_IP:6379 \\
            -e USE_REDIS=true \\
            whiteboard:latest
            
        echo 'Container status:'
        sudo docker ps | grep whiteboard
    " 2>&1 || echo "Deployment to $VM_NAME may need manual intervention"
done

# Get external IPs
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║                    DEPLOYMENT COMPLETE!                       ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""

NODE1_IP=$(gcloud compute instances describe whiteboard-node-1 --zone=$ZONE --format="value(networkInterfaces[0].accessConfigs[0].natIP)")
NODE2_IP=$(gcloud compute instances describe whiteboard-node-2 --zone=$ZONE --format="value(networkInterfaces[0].accessConfigs[0].natIP)")

echo -e "${YELLOW}Access your distributed whiteboard at:${NC}"
echo ""
echo -e "  Node 1: ${GREEN}http://$NODE1_IP:8080${NC}"
echo -e "  Node 2: ${GREEN}http://$NODE2_IP:8080${NC}"
echo ""
echo -e "${YELLOW}Test with a specific whiteboard ID:${NC}"
echo -e "  ${GREEN}http://$NODE1_IP:8080/?whiteboardid=test${NC}"
echo -e "  ${GREEN}http://$NODE2_IP:8080/?whiteboardid=test${NC}"
echo ""
echo -e "${YELLOW}Health checks:${NC}"
echo -e "  ${GREEN}http://$NODE1_IP:8080/api/health${NC}"
echo -e "  ${GREEN}http://$NODE2_IP:8080/api/health${NC}"
echo ""
echo -e "${YELLOW}Both URLs should show the same whiteboard content!${NC}"
