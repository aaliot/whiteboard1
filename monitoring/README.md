# Monitoring Setup for Whiteboard Application

This directory contains a complete **Prometheus + Grafana** monitoring stack for the distributed whiteboard application.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Monitoring Stack                          │
│  ┌─────────────┐      ┌─────────────┐                       │
│  │  Prometheus │ ───► │   Grafana   │ ◄── Browser           │
│  │   :9090     │      │   :3000     │                       │
│  └──────┬──────┘      └─────────────┘                       │
│         │                                                    │
│         │  Scrapes /metrics                                  │
│         │                                                    │
└─────────┼────────────────────────────────────────────────────┘
          │
    ┌─────┴─────────────────────────┐
    │                               │
    ▼                               ▼
┌─────────────┐            ┌─────────────┐
│  Node 1     │            │  Node 2     │
│  :8080      │            │  :8080      │
│  /metrics   │            │  /metrics   │
└─────────────┘            └─────────────┘
```

## Quick Start

### 1. Push code to GitHub
```bash
cd ~/whiteboard1
git add .
git commit -m "Add monitoring with Prometheus and Grafana"
git push origin master
```

### 2. Update whiteboard nodes
SSH into each whiteboard node and pull the latest code:
```bash
# On whiteboard-node-1 and whiteboard-node-2
cd ~/whiteboard1
git pull
docker stop whiteboard-app || true
docker rm whiteboard-app || true
docker build -t whiteboard-app .
docker run -d --name whiteboard-app -p 8080:8080 \
  -e NODE_ID=node-1 \
  -e USE_REDIS=true \
  -e REDIS_URL=redis://10.0.0.2:6379 \
  whiteboard-app
```

### 3. Deploy monitoring on redis-server
SSH into the redis-server VM and run:
```bash
cd ~/whiteboard1/monitoring
chmod +x deploy-monitoring.sh
./deploy-monitoring.sh
```

Or manually:
```bash
docker-compose -f docker-compose.monitoring.yml up -d
```

## Access URLs

| Service    | URL                        | Credentials           |
|------------|----------------------------|----------------------|
| Prometheus | http://10.0.0.2:9090       | No auth required     |
| Grafana    | http://10.0.0.2:3000       | admin / whiteboard123 |

## Metrics Exposed

Each whiteboard node exposes these metrics at `/metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `whiteboard_active_connections` | Gauge | Current WebSocket connections |
| `whiteboard_total_connections` | Counter | Total connections since start |
| `whiteboard_active_boards` | Gauge | Unique whiteboards accessed |
| `whiteboard_draw_events_total` | Counter | Total draw events |
| `whiteboard_undo_events_total` | Counter | Total undo events |
| `whiteboard_redo_events_total` | Counter | Total redo events |
| `whiteboard_redis_connected` | Gauge | Redis connection status (0/1) |
| `whiteboard_redis_publish_total` | Counter | Redis publish operations |
| `whiteboard_uptime_seconds` | Gauge | Node uptime |

## Pre-configured Dashboard

The Grafana dashboard includes:

1. **Overview Stats**
   - Total active connections
   - Active whiteboards
   - Redis connection status
   - Node uptime

2. **Time Series Charts**
   - Connections per node over time
   - Draw events rate
   - Redis publish rate
   - Total connections history

## Firewall Rules

If monitoring is not accessible, create firewall rules:
```bash
# Prometheus
gcloud compute firewall-rules create allow-prometheus \
  --allow tcp:9090 \
  --source-ranges=0.0.0.0/0 \
  --description="Allow Prometheus"

# Grafana
gcloud compute firewall-rules create allow-grafana \
  --allow tcp:3000 \
  --source-ranges=0.0.0.0/0 \
  --description="Allow Grafana"
```

## Testing Metrics

Test that metrics are exposed correctly:
```bash
# From any machine
curl http://35.246.58.22:8080/metrics   # Node 1
curl http://34.142.100.164:8080/metrics # Node 2

# JSON format
curl http://35.246.58.22:8080/api/metrics
```

## Why Prometheus + Grafana?

1. **Industry Standard** - Used by Google, AWS, and major tech companies
2. **Pull-based** - Prometheus scrapes targets, no agents needed on nodes
3. **Powerful Queries** - PromQL for complex metrics analysis
4. **Beautiful Dashboards** - Grafana provides rich visualization
5. **Alerting** - Can set up alerts for thresholds (optional)
6. **Free & Open Source** - No licensing costs
7. **Container-native** - Easy deployment with Docker
