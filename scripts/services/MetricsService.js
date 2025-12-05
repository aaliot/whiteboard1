/**
 * Prometheus Metrics Endpoint for Whiteboard Application
 * Exposes metrics for monitoring with Prometheus/Grafana
 */

class MetricsService {
    constructor() {
        this.metrics = {
            // Connection metrics
            activeConnections: 0,
            totalConnections: 0,
            totalDisconnections: 0,
            
            // Whiteboard metrics
            activeWhiteboards: new Set(),
            totalDrawEvents: 0,
            totalUndoEvents: 0,
            totalRedoEvents: 0,
            totalClearEvents: 0,
            
            // Performance metrics
            requestCount: 0,
            errorCount: 0,
            
            // Redis metrics
            redisConnected: false,
            redisPublishCount: 0,
            redisSubscribeCount: 0,
            
            // Timestamps
            startTime: Date.now(),
            lastActivityTime: Date.now()
        };
    }

    // Connection tracking
    connectionOpened() {
        this.metrics.activeConnections++;
        this.metrics.totalConnections++;
        this.metrics.lastActivityTime = Date.now();
    }

    connectionClosed() {
        this.metrics.activeConnections = Math.max(0, this.metrics.activeConnections - 1);
        this.metrics.totalDisconnections++;
    }

    // Whiteboard tracking
    whiteboardJoined(wid) {
        this.metrics.activeWhiteboards.add(wid);
        this.metrics.lastActivityTime = Date.now();
    }

    whiteboardLeft(wid) {
        // Don't remove - we want to track all whiteboards accessed
    }

    // Event tracking
    drawEvent() {
        this.metrics.totalDrawEvents++;
        this.metrics.lastActivityTime = Date.now();
    }

    undoEvent() {
        this.metrics.totalUndoEvents++;
    }

    redoEvent() {
        this.metrics.totalRedoEvents++;
    }

    clearEvent() {
        this.metrics.totalClearEvents++;
    }

    // Request tracking
    requestReceived() {
        this.metrics.requestCount++;
    }

    errorOccurred() {
        this.metrics.errorCount++;
    }

    // Redis tracking
    setRedisConnected(connected) {
        this.metrics.redisConnected = connected;
    }

    redisPublish() {
        this.metrics.redisPublishCount++;
    }

    redisSubscribe() {
        this.metrics.redisSubscribeCount++;
    }

    // Get uptime in seconds
    getUptime() {
        return Math.floor((Date.now() - this.metrics.startTime) / 1000);
    }

    // Generate Prometheus format metrics
    getPrometheusMetrics(nodeId = 'unknown') {
        const lines = [
            '# HELP whiteboard_active_connections Current number of active WebSocket connections',
            '# TYPE whiteboard_active_connections gauge',
            `whiteboard_active_connections{node="${nodeId}"} ${this.metrics.activeConnections}`,
            '',
            '# HELP whiteboard_total_connections Total number of WebSocket connections since start',
            '# TYPE whiteboard_total_connections counter',
            `whiteboard_total_connections{node="${nodeId}"} ${this.metrics.totalConnections}`,
            '',
            '# HELP whiteboard_active_boards Number of unique whiteboards accessed',
            '# TYPE whiteboard_active_boards gauge',
            `whiteboard_active_boards{node="${nodeId}"} ${this.metrics.activeWhiteboards.size}`,
            '',
            '# HELP whiteboard_draw_events_total Total number of draw events',
            '# TYPE whiteboard_draw_events_total counter',
            `whiteboard_draw_events_total{node="${nodeId}"} ${this.metrics.totalDrawEvents}`,
            '',
            '# HELP whiteboard_undo_events_total Total number of undo events',
            '# TYPE whiteboard_undo_events_total counter',
            `whiteboard_undo_events_total{node="${nodeId}"} ${this.metrics.totalUndoEvents}`,
            '',
            '# HELP whiteboard_redo_events_total Total number of redo events',
            '# TYPE whiteboard_redo_events_total counter',
            `whiteboard_redo_events_total{node="${nodeId}"} ${this.metrics.totalRedoEvents}`,
            '',
            '# HELP whiteboard_clear_events_total Total number of clear events',
            '# TYPE whiteboard_clear_events_total counter',
            `whiteboard_clear_events_total{node="${nodeId}"} ${this.metrics.totalClearEvents}`,
            '',
            '# HELP whiteboard_requests_total Total HTTP requests',
            '# TYPE whiteboard_requests_total counter',
            `whiteboard_requests_total{node="${nodeId}"} ${this.metrics.requestCount}`,
            '',
            '# HELP whiteboard_errors_total Total errors',
            '# TYPE whiteboard_errors_total counter',
            `whiteboard_errors_total{node="${nodeId}"} ${this.metrics.errorCount}`,
            '',
            '# HELP whiteboard_redis_connected Redis connection status',
            '# TYPE whiteboard_redis_connected gauge',
            `whiteboard_redis_connected{node="${nodeId}"} ${this.metrics.redisConnected ? 1 : 0}`,
            '',
            '# HELP whiteboard_redis_publish_total Total Redis publish operations',
            '# TYPE whiteboard_redis_publish_total counter',
            `whiteboard_redis_publish_total{node="${nodeId}"} ${this.metrics.redisPublishCount}`,
            '',
            '# HELP whiteboard_uptime_seconds Server uptime in seconds',
            '# TYPE whiteboard_uptime_seconds gauge',
            `whiteboard_uptime_seconds{node="${nodeId}"} ${this.getUptime()}`,
            '',
            '# HELP node_info Node information',
            '# TYPE node_info gauge',
            `node_info{node="${nodeId}",version="1.0.0"} 1`,
        ];
        
        return lines.join('\n');
    }

    // Get JSON metrics for API
    getJsonMetrics(nodeId = 'unknown') {
        return {
            nodeId,
            uptime: this.getUptime(),
            connections: {
                active: this.metrics.activeConnections,
                total: this.metrics.totalConnections,
                disconnections: this.metrics.totalDisconnections
            },
            whiteboards: {
                active: this.metrics.activeWhiteboards.size,
                list: Array.from(this.metrics.activeWhiteboards).slice(0, 10) // First 10
            },
            events: {
                draw: this.metrics.totalDrawEvents,
                undo: this.metrics.totalUndoEvents,
                redo: this.metrics.totalRedoEvents,
                clear: this.metrics.totalClearEvents
            },
            redis: {
                connected: this.metrics.redisConnected,
                publishCount: this.metrics.redisPublishCount,
                subscribeCount: this.metrics.redisSubscribeCount
            },
            requests: this.metrics.requestCount,
            errors: this.metrics.errorCount,
            lastActivity: new Date(this.metrics.lastActivityTime).toISOString()
        };
    }
}

// Export singleton
const metricsService = new MetricsService();
export { metricsService as default, MetricsService };
