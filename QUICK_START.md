# Quick Start Guide - Distributed Whiteboard on GCP
## Project: cloud-computing-480222

This guide shows you how to deploy the distributed whiteboard application on your existing GCP infrastructure.

---

## Prerequisites

- Google Cloud Shell access
- Project `cloud-computing-480222` with 2 existing VMs (or we'll create them)
- Firewall rules for ports 8080 and 6379

---

## Option A: Quickest Setup (Using Existing VMs)

### Step 1: Open Cloud Shell
Go to: https://console.cloud.google.com/cloudshell

### Step 2: Clone Your Repository
```bash
git clone <your-whiteboard-repo-url>
cd whiteboard1
```

### Step 3: Upload Files to VMs and Deploy

If you already have 2 VMs, note their names and run:

```bash
# Set your project
gcloud config set project cloud-computing-480222

# Get your VM names
gcloud compute instances list

# SSH into your first VM (Redis + Node 1)
gcloud compute ssh <your-vm-1-name> --zone=<your-zone>
```

On VM 1 (Redis Host):
```bash
# Install Docker
sudo apt update && sudo apt install -y docker.io git
sudo systemctl start docker

# Run Redis
sudo docker run -d --name redis --restart always -p 6379:6379 redis:7-alpine

# Get internal IP for Redis
hostname -I
# Note this IP (e.g., 10.128.0.2)
```

On both VMs (Node 1 and Node 2):
```bash
# Clone and run whiteboard
sudo git clone https://github.com/cracker0dks/whiteboard.git /opt/whiteboard
cd /opt/whiteboard

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Install dependencies and build
sudo npm install
sudo npm run build

# Run with Redis (replace <REDIS_IP> with internal IP from VM 1)
NODE_ID=node1 REDIS_URL=redis://<REDIS_IP>:6379 USE_REDIS=true npm run start
```

---

## Option B: Docker-based Deployment

### On VM 1 (Redis + Whiteboard Node 1):
```bash
# Get internal IP first
INTERNAL_IP=$(hostname -I | awk '{print $1}')
echo "Internal IP: $INTERNAL_IP"

# Run Redis
sudo docker run -d --name redis -p 6379:6379 redis:7-alpine

# Run Whiteboard Node 1
sudo docker run -d \
    --name whiteboard \
    -p 8080:8080 \
    -e NODE_ID=node1 \
    -e REDIS_URL=redis://$INTERNAL_IP:6379 \
    -e USE_REDIS=true \
    rofl256/whiteboard
```

### On VM 2 (Whiteboard Node 2):
```bash
# Run Whiteboard Node 2 (use internal IP of VM 1)
sudo docker run -d \
    --name whiteboard \
    -p 8080:8080 \
    -e NODE_ID=node2 \
    -e REDIS_URL=redis://<VM1_INTERNAL_IP>:6379 \
    -e USE_REDIS=true \
    rofl256/whiteboard
```

---

## Option C: Full Automated Setup

Upload the scripts from `gcp/` folder to Cloud Shell and run:

```bash
# Upload files to Cloud Shell
# Then run:
cd gcp
chmod +x *.sh
./cloud-shell-setup.sh
```

---

## Firewall Rules

If your VMs can't communicate, create firewall rules:

```bash
# Allow internal traffic
gcloud compute firewall-rules create allow-internal \
    --allow tcp,udp,icmp \
    --source-ranges 10.128.0.0/20

# Allow external access to whiteboard
gcloud compute firewall-rules create allow-whiteboard \
    --allow tcp:8080 \
    --target-tags http-server
```

---

## Testing the Setup

### 1. Get External IPs:
```bash
gcloud compute instances list
```

### 2. Access both nodes:
- Node 1: `http://<VM1_EXTERNAL_IP>:8080/?whiteboardid=myboard`
- Node 2: `http://<VM2_EXTERNAL_IP>:8080/?whiteboardid=myboard`

### 3. Test synchronization:
- Draw on Node 1 → Should appear on Node 2
- Draw on Node 2 → Should appear on Node 1

### 4. Check health:
```bash
curl http://<VM1_IP>:8080/api/health
curl http://<VM2_IP>:8080/api/health
```

---

## Troubleshooting

### Check if containers are running:
```bash
sudo docker ps
sudo docker logs whiteboard
```

### Check Redis connectivity:
```bash
redis-cli -h <REDIS_IP> ping
```

### Restart containers:
```bash
sudo docker restart redis whiteboard
```

---

## Architecture Summary

```
Internet → VM1:8080 (Whiteboard + Redis)
        → VM2:8080 (Whiteboard)
                    ↓
              Redis (VM1:6379)
              - Stores whiteboard data
              - Syncs events between nodes
```

Both VMs serve the same whiteboard data because they share state through Redis!

---

## Files Created

| File | Description |
|------|-------------|
| `scripts/services/RedisAdapter.js` | Redis connection wrapper |
| `scripts/services/RedisWhiteboardService.js` | Distributed whiteboard storage |
| `docker-compose.distributed.yml` | Docker multi-node setup |
| `nginx/nginx.conf` | Load balancer config |
| `gcp/cloud-shell-setup.sh` | Automated GCP setup |
| `gcp/install-redis.sh` | Redis installation script |
| `gcp/setup-vm-node.sh` | VM node setup script |
| `DISTRIBUTED_SETUP.md` | Full documentation |
