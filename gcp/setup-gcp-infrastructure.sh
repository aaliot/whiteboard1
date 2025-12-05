#!/bin/bash
# ==============================================================================
# GCP Distributed Whiteboard Setup Script
# Project: cloud-computing-480222
# ==============================================================================

set -e

# Configuration Variables
PROJECT_ID="cloud-computing-480222"
REGION="us-central1"
ZONE="us-central1-a"
NETWORK_NAME="whiteboard-network"
SUBNET_NAME="whiteboard-subnet"
FIREWALL_NAME="whiteboard-firewall"

# VM Configuration
VM_PREFIX="whiteboard-node"
MACHINE_TYPE="e2-medium"
IMAGE_FAMILY="ubuntu-2204-lts"
IMAGE_PROJECT="ubuntu-os-cloud"
BOOT_DISK_SIZE="20GB"

# Redis Configuration
REDIS_INSTANCE_NAME="whiteboard-redis"
REDIS_TIER="BASIC"
REDIS_SIZE="1"

echo "=============================================="
echo "Setting up Distributed Whiteboard on GCP"
echo "Project: $PROJECT_ID"
echo "=============================================="

# Set the project
echo "[1/8] Setting GCP project..."
gcloud config set project $PROJECT_ID

# Create VPC Network
echo "[2/8] Creating VPC network..."
gcloud compute networks create $NETWORK_NAME \
    --subnet-mode=custom \
    --description="Network for distributed whiteboard application" \
    2>/dev/null || echo "Network already exists"

# Create Subnet
echo "[3/8] Creating subnet..."
gcloud compute networks subnets create $SUBNET_NAME \
    --network=$NETWORK_NAME \
    --region=$REGION \
    --range=10.0.0.0/24 \
    2>/dev/null || echo "Subnet already exists"

# Create Firewall Rules
echo "[4/8] Creating firewall rules..."

# Allow internal communication
gcloud compute firewall-rules create ${FIREWALL_NAME}-internal \
    --network=$NETWORK_NAME \
    --allow=tcp,udp,icmp \
    --source-ranges=10.0.0.0/24 \
    --description="Allow internal communication" \
    2>/dev/null || echo "Internal firewall rule already exists"

# Allow HTTP/HTTPS
gcloud compute firewall-rules create ${FIREWALL_NAME}-http \
    --network=$NETWORK_NAME \
    --allow=tcp:80,tcp:443,tcp:8080,tcp:8081,tcp:8082 \
    --source-ranges=0.0.0.0/0 \
    --target-tags=whiteboard-server \
    --description="Allow HTTP/HTTPS traffic" \
    2>/dev/null || echo "HTTP firewall rule already exists"

# Allow SSH
gcloud compute firewall-rules create ${FIREWALL_NAME}-ssh \
    --network=$NETWORK_NAME \
    --allow=tcp:22 \
    --source-ranges=0.0.0.0/0 \
    --target-tags=whiteboard-server \
    --description="Allow SSH access" \
    2>/dev/null || echo "SSH firewall rule already exists"

# Allow Redis
gcloud compute firewall-rules create ${FIREWALL_NAME}-redis \
    --network=$NETWORK_NAME \
    --allow=tcp:6379 \
    --source-ranges=10.0.0.0/24 \
    --target-tags=redis-server \
    --description="Allow Redis traffic" \
    2>/dev/null || echo "Redis firewall rule already exists"

# Create Redis Instance (Memorystore)
echo "[5/8] Creating Redis instance (this may take a few minutes)..."
gcloud redis instances create $REDIS_INSTANCE_NAME \
    --size=$REDIS_SIZE \
    --region=$REGION \
    --network=$NETWORK_NAME \
    --tier=$REDIS_TIER \
    --redis-version=redis_7_0 \
    2>/dev/null || echo "Redis instance already exists"

# Get Redis IP
REDIS_IP=$(gcloud redis instances describe $REDIS_INSTANCE_NAME --region=$REGION --format="value(host)" 2>/dev/null || echo "")
echo "Redis IP: $REDIS_IP"

# Create VM instances
echo "[6/8] Creating VM instances..."

for i in 1 2; do
    VM_NAME="${VM_PREFIX}-${i}"
    echo "Creating $VM_NAME..."
    
    gcloud compute instances create $VM_NAME \
        --zone=$ZONE \
        --machine-type=$MACHINE_TYPE \
        --network=$NETWORK_NAME \
        --subnet=$SUBNET_NAME \
        --image-family=$IMAGE_FAMILY \
        --image-project=$IMAGE_PROJECT \
        --boot-disk-size=$BOOT_DISK_SIZE \
        --tags=whiteboard-server \
        --metadata=startup-script='#!/bin/bash
# Update system
apt-get update
apt-get install -y docker.io docker-compose git

# Start Docker
systemctl start docker
systemctl enable docker

# Add user to docker group
usermod -aG docker $USER

echo "VM setup complete"
' \
        2>/dev/null || echo "$VM_NAME already exists"
done

# Create Load Balancer components
echo "[7/8] Setting up HTTP Load Balancer..."

# Create instance group
gcloud compute instance-groups unmanaged create whiteboard-group \
    --zone=$ZONE \
    --description="Whiteboard instance group" \
    2>/dev/null || echo "Instance group already exists"

# Add instances to group
for i in 1 2; do
    gcloud compute instance-groups unmanaged add-instances whiteboard-group \
        --zone=$ZONE \
        --instances=${VM_PREFIX}-${i} \
        2>/dev/null || echo "Instance ${VM_PREFIX}-${i} already in group"
done

# Create health check
gcloud compute health-checks create http whiteboard-health-check \
    --port=8080 \
    --request-path=/api/health \
    --check-interval=10s \
    --timeout=5s \
    --healthy-threshold=2 \
    --unhealthy-threshold=3 \
    2>/dev/null || echo "Health check already exists"

# Create backend service
gcloud compute backend-services create whiteboard-backend \
    --protocol=HTTP \
    --port-name=http \
    --health-checks=whiteboard-health-check \
    --global \
    2>/dev/null || echo "Backend service already exists"

# Set named port on instance group
gcloud compute instance-groups unmanaged set-named-ports whiteboard-group \
    --zone=$ZONE \
    --named-ports=http:8080 \
    2>/dev/null || echo "Named ports already set"

# Add instance group to backend
gcloud compute backend-services add-backend whiteboard-backend \
    --instance-group=whiteboard-group \
    --instance-group-zone=$ZONE \
    --balancing-mode=UTILIZATION \
    --max-utilization=0.8 \
    --global \
    2>/dev/null || echo "Backend already added"

# Create URL map
gcloud compute url-maps create whiteboard-lb \
    --default-service=whiteboard-backend \
    2>/dev/null || echo "URL map already exists"

# Create HTTP proxy
gcloud compute target-http-proxies create whiteboard-http-proxy \
    --url-map=whiteboard-lb \
    2>/dev/null || echo "HTTP proxy already exists"

# Create forwarding rule
gcloud compute forwarding-rules create whiteboard-http-rule \
    --global \
    --target-http-proxy=whiteboard-http-proxy \
    --ports=80 \
    2>/dev/null || echo "Forwarding rule already exists"

# Get Load Balancer IP
echo "[8/8] Getting deployment information..."
LB_IP=$(gcloud compute forwarding-rules describe whiteboard-http-rule --global --format="value(IPAddress)" 2>/dev/null || echo "Pending")

echo ""
echo "=============================================="
echo "GCP Setup Complete!"
echo "=============================================="
echo ""
echo "Resources Created:"
echo "  - VPC Network: $NETWORK_NAME"
echo "  - Subnet: $SUBNET_NAME"
echo "  - Redis Instance: $REDIS_INSTANCE_NAME (IP: $REDIS_IP)"
echo "  - VM Instances: ${VM_PREFIX}-1, ${VM_PREFIX}-2"
echo "  - Load Balancer IP: $LB_IP"
echo ""
echo "Next Steps:"
echo "  1. SSH into each VM and clone your repository"
echo "  2. Configure the REDIS_URL environment variable"
echo "  3. Run the whiteboard application"
echo ""
echo "SSH Commands:"
echo "  gcloud compute ssh ${VM_PREFIX}-1 --zone=$ZONE"
echo "  gcloud compute ssh ${VM_PREFIX}-2 --zone=$ZONE"
echo ""
