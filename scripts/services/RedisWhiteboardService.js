/**
 * Redis-based Whiteboard Storage Service
 * Replaces file-based storage for distributed consistency across nodes
 */
import redisAdapter from "./RedisAdapter.js";

const WHITEBOARD_PREFIX = "whiteboard:data:";
const UNDO_PREFIX = "whiteboard:undo:";
const CHANNEL_WHITEBOARD_EVENTS = "whiteboard:events";

class RedisWhiteboardService {
    constructor() {
        this.localCache = {}; // Local cache for performance
        this.nodeId = process.env.NODE_ID || `node-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        this.eventHandlers = [];
    }

    /**
     * Initialize the Redis whiteboard service
     */
    async initialize() {
        if (!redisAdapter.isReady()) {
            console.warn("Redis not ready, using local storage only");
            return false;
        }

        // Subscribe to whiteboard events for cross-node sync
        await redisAdapter.subscribe(CHANNEL_WHITEBOARD_EVENTS, (message) => {
            this.handleRemoteEvent(message);
        });

        console.log(`✅ RedisWhiteboardService initialized (Node: ${this.nodeId})`);
        return true;
    }

    /**
     * Handle events from other nodes
     * @param {Object} message Event message
     */
    handleRemoteEvent(message) {
        // Ignore events from this node
        if (message.nodeId === this.nodeId) return;

        // Update local cache with remote data
        if (message.type === "update" && message.wid) {
            this.localCache[message.wid] = message.data;
        } else if (message.type === "clear" && message.wid) {
            delete this.localCache[message.wid];
        }

        // Notify registered handlers
        this.eventHandlers.forEach((handler) => handler(message));
    }

    /**
     * Register event handler for cross-node events
     * @param {Function} handler Handler function
     */
    onRemoteEvent(handler) {
        this.eventHandlers.push(handler);
    }

    /**
     * Load whiteboard data
     * @param {string} wid Whiteboard ID
     * @returns {Array} Whiteboard data
     */
    async loadStoredData(wid) {
        // Check local cache first
        if (this.localCache[wid]) {
            return this.localCache[wid];
        }

        // Try to load from Redis
        if (redisAdapter.isReady()) {
            const data = await redisAdapter.listGetAll(WHITEBOARD_PREFIX + wid);
            if (data && data.length > 0) {
                this.localCache[wid] = data;
                return data;
            }
        }

        // Initialize empty whiteboard
        this.localCache[wid] = [];
        return this.localCache[wid];
    }

    /**
     * Handle whiteboard events and save data
     * @param {Object} content Event content
     */
    async handleEventsAndData(content) {
        const tool = content["t"];
        const wid = content["wid"];
        const username = content["username"];

        if (tool === "clear") {
            await this.clearWhiteboard(wid);
        } else if (tool === "undo") {
            await this.handleUndo(wid, username);
        } else if (tool === "redo") {
            await this.handleRedo(wid, username);
        } else if (this.isDrawingTool(tool)) {
            await this.saveDrawingAction(wid, content);
        }

        // Publish event to other nodes
        await this.publishEvent({
            type: "update",
            wid: wid,
            tool: tool,
            data: this.localCache[wid],
            content: content,
        });
    }

    /**
     * Check if tool is a drawing tool
     * @param {string} tool Tool name
     * @returns {boolean}
     */
    isDrawingTool(tool) {
        return [
            "line",
            "pen",
            "rect",
            "circle",
            "eraser",
            "addImgBG",
            "recSelect",
            "eraseRec",
            "addTextBox",
            "setTextboxText",
            "removeTextbox",
            "setTextboxPosition",
            "setTextboxFontSize",
            "setTextboxFontColor",
        ].includes(tool);
    }

    /**
     * Save a drawing action
     * @param {string} wid Whiteboard ID
     * @param {Object} content Drawing content
     */
    async saveDrawingAction(wid, content) {
        let savedBoard = await this.loadStoredData(wid);
        
        // Remove wid from content to avoid storing it twice
        const contentToSave = { ...content };
        delete contentToSave["wid"];

        // Handle textbox text updates
        if (content["t"] === "setTextboxText") {
            savedBoard = savedBoard.filter(
                (item) => !(item["t"] === "setTextboxText" && item["d"][0] === content["d"][0])
            );
        }

        savedBoard.push(contentToSave);
        this.localCache[wid] = savedBoard;

        // Save to Redis
        await this.saveToDB(wid);
    }

    /**
     * Clear whiteboard
     * @param {string} wid Whiteboard ID
     */
    async clearWhiteboard(wid) {
        delete this.localCache[wid];
        
        if (redisAdapter.isReady()) {
            await redisAdapter.delete(WHITEBOARD_PREFIX + wid);
            await redisAdapter.delete(UNDO_PREFIX + wid);
        }

        await this.publishEvent({
            type: "clear",
            wid: wid,
        });
    }

    /**
     * Handle undo action
     * @param {string} wid Whiteboard ID
     * @param {string} username Username
     */
    async handleUndo(wid, username) {
        let savedBoard = await this.loadStoredData(wid);
        let undoStack = await this.getUndoStack(wid);

        for (let i = savedBoard.length - 1; i >= 0; i--) {
            if (savedBoard[i]["username"] === username) {
                const drawId = savedBoard[i]["drawId"];
                for (let j = savedBoard.length - 1; j >= 0; j--) {
                    if (savedBoard[j]["drawId"] === drawId && savedBoard[j]["username"] === username) {
                        undoStack.push(savedBoard[j]);
                        savedBoard.splice(j, 1);
                    }
                }
                break;
            }
        }

        // Limit undo stack size
        if (undoStack.length > 1000) {
            undoStack.splice(0, undoStack.length - 1000);
        }

        this.localCache[wid] = savedBoard;
        await this.saveUndoStack(wid, undoStack);
        await this.saveToDB(wid);
    }

    /**
     * Handle redo action
     * @param {string} wid Whiteboard ID
     * @param {string} username Username
     */
    async handleRedo(wid, username) {
        let savedBoard = await this.loadStoredData(wid);
        let undoStack = await this.getUndoStack(wid);

        for (let i = undoStack.length - 1; i >= 0; i--) {
            if (undoStack[i]["username"] === username) {
                const drawId = undoStack[i]["drawId"];
                for (let j = undoStack.length - 1; j >= 0; j--) {
                    if (undoStack[j]["drawId"] === drawId && undoStack[j]["username"] === username) {
                        savedBoard.push(undoStack[j]);
                        undoStack.splice(j, 1);
                    }
                }
                break;
            }
        }

        this.localCache[wid] = savedBoard;
        await this.saveUndoStack(wid, undoStack);
        await this.saveToDB(wid);
    }

    /**
     * Get undo stack for whiteboard
     * @param {string} wid Whiteboard ID
     * @returns {Array} Undo stack
     */
    async getUndoStack(wid) {
        if (redisAdapter.isReady()) {
            return await redisAdapter.listGetAll(UNDO_PREFIX + wid) || [];
        }
        return [];
    }

    /**
     * Save undo stack
     * @param {string} wid Whiteboard ID
     * @param {Array} stack Undo stack
     */
    async saveUndoStack(wid, stack) {
        if (redisAdapter.isReady()) {
            await redisAdapter.listReplace(UNDO_PREFIX + wid, stack);
        }
    }

    /**
     * Save whiteboard to Redis
     * @param {string} wid Whiteboard ID
     */
    async saveToDB(wid) {
        if (!redisAdapter.isReady()) return;

        const data = this.localCache[wid];
        if (data) {
            await redisAdapter.listReplace(WHITEBOARD_PREFIX + wid, data);
        }
    }

    /**
     * Publish event to other nodes
     * @param {Object} event Event data
     */
    async publishEvent(event) {
        if (!redisAdapter.isReady()) return;

        event.nodeId = this.nodeId;
        event.timestamp = Date.now();
        await redisAdapter.publish(CHANNEL_WHITEBOARD_EVENTS, event);
    }

    /**
     * Copy stored data from one whiteboard to another
     * @param {string} sourceWid Source whiteboard ID
     * @param {string} targetWid Target whiteboard ID
     */
    async copyStoredData(sourceWid, targetWid) {
        const sourceData = await this.loadStoredData(sourceWid);
        const targetData = await this.loadStoredData(targetWid);
        
        if (sourceData.length === 0 || targetData.length > 0) {
            return;
        }

        this.localCache[targetWid] = [...sourceData];
        await this.saveToDB(targetWid);
    }

    /**
     * Save raw data to whiteboard
     * @param {string} wid Whiteboard ID
     * @param {string} data JSON string data
     */
    async saveData(wid, data) {
        const existingData = await this.loadStoredData(wid);
        if (existingData.length > 0 || !data) {
            return;
        }

        this.localCache[wid] = JSON.parse(data);
        await this.saveToDB(wid);
    }
}

// Export singleton instance
const redisWhiteboardService = new RedisWhiteboardService();
export { redisWhiteboardService as default, RedisWhiteboardService };
