/**
 * Redis Adapter for distributed whiteboard synchronization
 * This enables multiple nodes to share state via Redis Pub/Sub
 */
import { createClient } from "redis";

class RedisAdapter {
    constructor() {
        this.publisher = null;
        this.subscriber = null;
        this.isConnected = false;
        this.handlers = new Map();
    }

    /**
     * Initialize Redis connections
     * @param {Object} config Redis configuration
     */
    async connect(config = {}) {
        const redisUrl = config.url || process.env.REDIS_URL || "redis://localhost:6379";
        const redisPassword = config.password || process.env.REDIS_PASSWORD || null;

        const clientOptions = {
            url: redisUrl,
        };

        if (redisPassword) {
            clientOptions.password = redisPassword;
        }

        try {
            // Create publisher client
            this.publisher = createClient(clientOptions);
            this.publisher.on("error", (err) => console.error("Redis Publisher Error:", err));
            await this.publisher.connect();

            // Create subscriber client (separate connection for pub/sub)
            this.subscriber = this.publisher.duplicate();
            this.subscriber.on("error", (err) => console.error("Redis Subscriber Error:", err));
            await this.subscriber.connect();

            this.isConnected = true;
            console.log("✅ Redis connected successfully to:", redisUrl);

            return true;
        } catch (error) {
            console.error("❌ Failed to connect to Redis:", error.message);
            this.isConnected = false;
            return false;
        }
    }

    /**
     * Publish a message to a channel
     * @param {string} channel Channel name
     * @param {Object} message Message to publish
     */
    async publish(channel, message) {
        if (!this.isConnected) {
            console.warn("Redis not connected, cannot publish");
            return false;
        }

        try {
            const serialized = JSON.stringify(message);
            await this.publisher.publish(channel, serialized);
            return true;
        } catch (error) {
            console.error("Redis publish error:", error);
            return false;
        }
    }

    /**
     * Subscribe to a channel
     * @param {string} channel Channel name
     * @param {Function} handler Message handler function
     */
    async subscribe(channel, handler) {
        if (!this.isConnected) {
            console.warn("Redis not connected, cannot subscribe");
            return false;
        }

        try {
            this.handlers.set(channel, handler);
            await this.subscriber.subscribe(channel, (message) => {
                try {
                    const parsed = JSON.parse(message);
                    handler(parsed);
                } catch (error) {
                    console.error("Error parsing Redis message:", error);
                }
            });
            console.log(`📡 Subscribed to Redis channel: ${channel}`);
            return true;
        } catch (error) {
            console.error("Redis subscribe error:", error);
            return false;
        }
    }

    /**
     * Unsubscribe from a channel
     * @param {string} channel Channel name
     */
    async unsubscribe(channel) {
        if (!this.isConnected) return false;

        try {
            await this.subscriber.unsubscribe(channel);
            this.handlers.delete(channel);
            return true;
        } catch (error) {
            console.error("Redis unsubscribe error:", error);
            return false;
        }
    }

    /**
     * Store data in Redis
     * @param {string} key Key name
     * @param {Object} value Value to store
     * @param {number} ttl Time to live in seconds (optional)
     */
    async set(key, value, ttl = null) {
        if (!this.isConnected) return false;

        try {
            const serialized = JSON.stringify(value);
            if (ttl) {
                await this.publisher.setEx(key, ttl, serialized);
            } else {
                await this.publisher.set(key, serialized);
            }
            return true;
        } catch (error) {
            console.error("Redis set error:", error);
            return false;
        }
    }

    /**
     * Get data from Redis
     * @param {string} key Key name
     * @returns {Object|null} Parsed value or null
     */
    async get(key) {
        if (!this.isConnected) return null;

        try {
            const value = await this.publisher.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            console.error("Redis get error:", error);
            return null;
        }
    }

    /**
     * Delete data from Redis
     * @param {string} key Key name
     */
    async delete(key) {
        if (!this.isConnected) return false;

        try {
            await this.publisher.del(key);
            return true;
        } catch (error) {
            console.error("Redis delete error:", error);
            return false;
        }
    }

    /**
     * Get all keys matching a pattern
     * @param {string} pattern Key pattern (e.g., "whiteboard:*")
     * @returns {Array} Array of matching keys
     */
    async keys(pattern) {
        if (!this.isConnected) return [];

        try {
            return await this.publisher.keys(pattern);
        } catch (error) {
            console.error("Redis keys error:", error);
            return [];
        }
    }

    /**
     * Append to a Redis list
     * @param {string} key List key
     * @param {Object} value Value to append
     */
    async listPush(key, value) {
        if (!this.isConnected) return false;

        try {
            const serialized = JSON.stringify(value);
            await this.publisher.rPush(key, serialized);
            return true;
        } catch (error) {
            console.error("Redis listPush error:", error);
            return false;
        }
    }

    /**
     * Get all items from a Redis list
     * @param {string} key List key
     * @returns {Array} Array of parsed items
     */
    async listGetAll(key) {
        if (!this.isConnected) return [];

        try {
            const items = await this.publisher.lRange(key, 0, -1);
            return items.map((item) => JSON.parse(item));
        } catch (error) {
            console.error("Redis listGetAll error:", error);
            return [];
        }
    }

    /**
     * Replace entire list with new data
     * @param {string} key List key
     * @param {Array} items Array of items
     */
    async listReplace(key, items) {
        if (!this.isConnected) return false;

        try {
            // Delete existing list and create new one
            await this.publisher.del(key);
            if (items.length > 0) {
                const serialized = items.map((item) => JSON.stringify(item));
                await this.publisher.rPush(key, serialized);
            }
            return true;
        } catch (error) {
            console.error("Redis listReplace error:", error);
            return false;
        }
    }

    /**
     * Close Redis connections
     */
    async disconnect() {
        try {
            if (this.subscriber) {
                await this.subscriber.quit();
            }
            if (this.publisher) {
                await this.publisher.quit();
            }
            this.isConnected = false;
            console.log("Redis disconnected");
        } catch (error) {
            console.error("Redis disconnect error:", error);
        }
    }

    /**
     * Check if Redis is connected
     * @returns {boolean}
     */
    isReady() {
        return this.isConnected;
    }
}

// Export singleton instance
const redisAdapter = new RedisAdapter();
export { redisAdapter as default, RedisAdapter };
