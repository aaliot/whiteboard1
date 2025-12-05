# Distributed Whiteboard - Private Cloud Implementation

## Overview

This document describes the implementation of a distributed whiteboard application deployed on Google Cloud Platform (GCP) as a private cloud solution. The system provides consistent, scalable, and low-latency access to a collaborative whiteboard that can be shared across multiple nodes.

## Architecture Diagram

```
                            ┌─────────────────────────────────────────────────┐
                            │                   Internet                       │
                            └─────────────────────┬───────────────────────────┘
                                                  │
                                                  ▼
                            ┌─────────────────────────────────────────────────┐
                            │            GCP Load Balancer                     │
                            │         (HTTP/HTTPS with WebSocket)              │
                            └─────────────────────┬───────────────────────────┘
                                                  │
                         ┌────────────────────────┼────────────────────────┐
                         │                        │                        │
                         ▼                        ▼                        ▼
              ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
              │  Whiteboard      │    │  Whiteboard      │    │  Additional      │
              │  Node 1          │    │  Node 2          │    │  Nodes...        │
              │  (Docker)        │    │  (Docker)        │    │  (Scalable)      │
              │                  │    │                  │    │                  │
              │  - Express.js    │    │  - Express.js    │    │  - Express.js    │
              │  - Socket.IO     │    │  - Socket.IO     │    │  - Socket.IO     │
              │  - Redis Client  │    │  - Redis Client  │    │  - Redis Client  │
              └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
                       │                       │                       │
                       └───────────────────────┼───────────────────────┘
                                               │
                                               ▼
                            ┌─────────────────────────────────────────────────┐
                            │              Redis Server                        │
                            │        (State Synchronization)                   │
                            │                                                  │
                            │  - Whiteboard Data Storage                       │
                            │  - Pub/Sub for Real-time Sync                    │
                            │  - Socket.IO Adapter                             │
                            └─────────────────────────────────────────────────┘
```

## Components

### 1. Load Balancer
- **Technology**: Nginx (or GCP HTTP Load Balancer)
- **Features**:
  - IP Hash-based sticky sessions for WebSocket connections
  - Health checks on `/api/health` endpoint
  - Automatic failover between nodes
  - WebSocket upgrade support

### 2. Application Nodes
- **Technology**: Node.js with Express.js and Socket.IO
- **Features**:
  - Containerized using Docker
  - Each node is stateless (state stored in Redis)
  - Real-time drawing synchronization
  - Horizontal scaling capability

### 3. Redis Server
- **Technology**: Redis 7 (Alpine)
- **Functions**:
  - **Data Storage**: Stores whiteboard drawing data
  - **Pub/Sub**: Broadcasts drawing events across nodes
  - **Socket.IO Adapter**: Enables cross-node socket communication

## Key Files

| File | Purpose |
|------|---------|
| `scripts/services/RedisAdapter.js` | Redis connection and operations wrapper |
| `scripts/services/RedisWhiteboardService.js` | Distributed whiteboard state management |
| `scripts/server-backend-distributed.js` | Main server with Redis integration |
| `docker-compose.distributed.yml` | Multi-node Docker deployment |
| `nginx/nginx.conf` | Load balancer configuration |
| `gcp/cloud-shell-setup.sh` | GCP deployment automation |

## How It Works

### State Synchronization

1. **User draws on whiteboard** → Event sent to connected node via WebSocket
2. **Node processes event** → Stores in Redis, broadcasts to other nodes via Pub/Sub
3. **Other nodes receive event** → Forward to their connected clients
4. **All users see the update** → Consistent view across all nodes

### Data Flow

```
User A (Node 1)                    User B (Node 2)
      │                                  │
      │ draw event                       │
      ▼                                  │
┌─────────────┐                   ┌─────────────┐
│   Node 1    │ ──────Redis───────│   Node 2    │
│             │    Pub/Sub        │             │
└─────────────┘                   └─────────────┘
      │                                  │
      └──────────┬───────────────────────┘
                 ▼
           ┌───────────┐
           │   Redis   │
           │  Storage  │
           └───────────┘
```

### New User Joining

1. User connects to any node (via load balancer)
2. Node fetches current whiteboard state from Redis
3. State is sent to the new user
4. User sees the same whiteboard as everyone else

## Deployment Instructions

### Option 1: Quick Setup (Cloud Shell)

```bash
# In Google Cloud Shell
cd gcp
chmod +x cloud-shell-setup.sh
./cloud-shell-setup.sh
```

### Option 2: Manual Setup

1. **Create GCP Resources**
```bash
# Set project
gcloud config set project cloud-computing-480222

# Create VMs
gcloud compute instances create whiteboard-node-1 \
    --zone=us-central1-a \
    --machine-type=e2-medium \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud

gcloud compute instances create whiteboard-node-2 \
    --zone=us-central1-a \
    --machine-type=e2-medium \
    --image-family=ubuntu-2204-lts \
    --image-project=ubuntu-os-cloud
```

2. **Setup Redis on Node 1**
```bash
gcloud compute ssh whiteboard-node-1 --zone=us-central1-a
sudo apt update && sudo apt install -y docker.io
sudo docker run -d --name redis -p 6379:6379 redis:7-alpine
```

3. **Deploy Whiteboard on Both Nodes**
```bash
# On each node
sudo git clone <your-repo> /opt/whiteboard
cd /opt/whiteboard
sudo docker build -t whiteboard .
sudo docker run -d \
    --name whiteboard \
    -p 8080:8080 \
    -e NODE_ID=nodeX \
    -e REDIS_URL=redis://<redis-ip>:6379 \
    -e USE_REDIS=true \
    whiteboard
```

### Option 3: Docker Compose (Local Testing)

```bash
docker-compose -f docker-compose.distributed.yml up --build
```

## Testing the Distributed Setup

1. **Access both nodes directly**:
   - Node 1: `http://<node1-ip>:8080/?whiteboardid=test`
   - Node 2: `http://<node2-ip>:8080/?whiteboardid=test`

2. **Draw on one node** - verify changes appear on the other

3. **Check health endpoints**:
   - `http://<node1-ip>:8080/api/health`
   - `http://<node2-ip>:8080/api/health`

4. **Check node info**:
   - `http://<node1-ip>:8080/api/node-info`

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ID` | Auto-generated | Unique identifier for this node |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |
| `USE_REDIS` | `true` | Enable distributed mode |
| `PORT` | `8080` | HTTP server port |

## Scaling

To add more nodes:

1. Create a new VM
2. Deploy the whiteboard container with the same Redis URL
3. Add the new VM to the load balancer backend

The system automatically handles:
- State synchronization
- User connections
- Event broadcasting

## Consistency Guarantees

- **Eventual Consistency**: Drawing events are propagated within milliseconds
- **Single Source of Truth**: Redis stores all whiteboard data
- **Conflict Resolution**: Last-write-wins for overlapping operations

## Troubleshooting

### Redis Connection Failed
```bash
# Check Redis is running
docker logs redis

# Test connectivity
redis-cli -h <redis-ip> ping
```

### WebSocket Issues
- Ensure firewall allows port 8080
- Check Nginx WebSocket upgrade headers
- Verify sticky sessions are enabled

### Nodes Not Syncing
```bash
# Check node logs
docker logs whiteboard

# Verify Redis pub/sub
redis-cli subscribe whiteboard:events
```

## Security Considerations

- Use private VPC network for inter-node communication
- Configure firewall rules to restrict access
- Use access tokens for API authentication
- Enable HTTPS for production deployment

## Project Information

- **GCP Project ID**: cloud-computing-480222
- **Region**: us-central1
- **Technology Stack**: Node.js, Socket.IO, Redis, Docker, Nginx
