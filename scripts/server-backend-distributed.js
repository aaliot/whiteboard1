/**
 * Distributed Server Backend for Whiteboard Application
 * This version uses Redis for distributed state management
 */
import path from "path";

import config from "./config/config.js";
import ROBackendService from "./services/ReadOnlyBackendService.js";
const ReadOnlyBackendService = new ROBackendService();
import WBInfoBackendService from "./services/WhiteboardInfoBackendService.js";
const WhiteboardInfoBackendService = new WBInfoBackendService();

import redisAdapter from "./services/RedisAdapter.js";
import redisWhiteboardService from "./services/RedisWhiteboardService.js";
import metricsService from "./services/MetricsService.js";

import { getSafeFilePath } from "./utils.js";

import fs from "fs-extra";
import express from "express";
import formidable from "formidable";

import createDOMPurify from "dompurify";
import { JSDOM } from "jsdom";

import { createClient } from "webdav";
import s_whiteboard from "./s_whiteboard.js";

import http from "http";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";

import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Node identification
const NODE_ID = process.env.NODE_ID || `node-${Date.now()}`;

export default async function startBackendServer(port) {
    const window = new JSDOM("").window;
    const DOMPurify = createDOMPurify(window);

    var app = express();
    var server = http.Server(app);
    
    // Initialize Socket.IO
    var io = new Server(server, { 
        path: "/ws-api",
        // Enable sticky sessions for load balancer compatibility
        transports: ["websocket", "polling"],
        // Allow cross-origin for distributed setup
        cors: {
            origin: "*",
            methods: ["GET", "POST"]
        }
    });

    // Initialize Redis connection
    const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
    const useRedis = process.env.USE_REDIS !== "false";
    
    let useDistributed = false;
    
    if (useRedis) {
        try {
            // Connect Redis adapter
            const connected = await redisAdapter.connect({ url: redisUrl });
            
            if (connected) {
                // Setup Socket.IO Redis adapter for cross-node communication
                const pubClient = (await import("redis")).createClient({ url: redisUrl });
                const subClient = pubClient.duplicate();
                
                await Promise.all([pubClient.connect(), subClient.connect()]);
                
                io.adapter(createAdapter(pubClient, subClient));
                console.log(`✅ Socket.IO Redis adapter enabled`);
                
                // Initialize Redis whiteboard service
                await redisWhiteboardService.initialize();
                
                // Listen for remote whiteboard events
                redisWhiteboardService.onRemoteEvent((event) => {
                    if (event.type === "update" && event.content) {
                        // Broadcast to local clients
                        io.to(event.wid).emit("drawToWhiteboard", event.content);
                    }
                });
                
                useDistributed = true;
                metricsService.setRedisConnected(true);
                console.log(`✅ Distributed mode enabled (Node: ${NODE_ID})`);
            }
        } catch (error) {
            console.warn("⚠️ Redis connection failed, falling back to standalone mode:", error.message);
            metricsService.setRedisConnected(false);
        }
    }

    // Use appropriate whiteboard service
    const whiteboardService = useDistributed ? redisWhiteboardService : s_whiteboard;

    server.listen(port);
    WhiteboardInfoBackendService.start(io);

    console.log(`🚀 Whiteboard server running on port: ${port} (Node: ${NODE_ID})`);

    const { accessToken, enableWebdav } = config.backend;

    // Expose static folders
    app.use(express.static(path.join(__dirname, "..", "dist")));
    app.use("/uploads", express.static(path.join(__dirname, "..", "public", "uploads")));

    // Health check endpoint for load balancer
    app.get("/api/health", function (req, res) {
        metricsService.requestReceived();
        res.status(200).json({
            status: "healthy",
            nodeId: NODE_ID,
            distributed: useDistributed,
            timestamp: new Date().toISOString()
        });
    });

    // Prometheus metrics endpoint
    app.get("/metrics", function (req, res) {
        res.set("Content-Type", "text/plain");
        res.send(metricsService.getPrometheusMetrics(NODE_ID));
    });

    // JSON metrics endpoint
    app.get("/api/metrics", function (req, res) {
        metricsService.requestReceived();
        res.json(metricsService.getJsonMetrics(NODE_ID));
    });

    // Node info endpoint
    app.get("/api/node-info", function (req, res) {
        res.json({
            nodeId: NODE_ID,
            distributed: useDistributed,
            redisConnected: redisAdapter.isReady(),
            uptime: process.uptime()
        });
    });

    // Load whiteboard data
    app.get("/api/loadwhiteboard", async function (req, res) {
        let query = escapeAllContentStrings(req["query"]);
        const wid = query["wid"];
        const at = query["at"];
        
        if (accessToken === "" || accessToken == at) {
            const widForData = ReadOnlyBackendService.isReadOnly(wid)
                ? ReadOnlyBackendService.getIdFromReadOnlyId(wid)
                : wid;
            
            let ret;
            if (useDistributed) {
                ret = await whiteboardService.loadStoredData(widForData);
            } else {
                ret = whiteboardService.loadStoredData(widForData);
            }
            res.send(ret);
            res.end();
        } else {
            res.status(401);
            res.end();
        }
    });

    // Get read-only whiteboard ID
    app.get("/api/getReadOnlyWid", function (req, res) {
        let query = escapeAllContentStrings(req["query"]);
        const wid = query["wid"];
        const at = query["at"];
        
        if (accessToken === "" || accessToken == at) {
            res.send(ReadOnlyBackendService.getReadOnlyId(wid));
            res.end();
        } else {
            res.status(401);
            res.end();
        }
    });

    // Upload endpoint
    app.post("/api/upload", function (req, res) {
        var form = formidable({});
        var formData = { files: {}, fields: {} };

        form.on("file", function (name, file) {
            formData["files"][file.name] = file;
        });

        form.on("field", function (name, value) {
            formData["fields"][name] = value;
        });

        form.on("error", function (err) {
            console.log("File upload Error!");
        });

        form.on("end", function () {
            if (accessToken === "" || accessToken == formData["fields"]["at"]) {
                progressUploadFormData(formData, function (err) {
                    if (err) {
                        res.status(err == "403" ? 403 : 500);
                        res.end();
                    } else {
                        res.send("done");
                    }
                });
            } else {
                res.status(401);
                res.end();
            }
        });
        form.parse(req);
    });

    // Draw to whiteboard via API
    app.get("/api/drawToWhiteboard", async function (req, res) {
        let query = escapeAllContentStrings(req["query"]);
        const wid = query["wid"];
        const at = query["at"];
        
        if (!wid || ReadOnlyBackendService.isReadOnly(wid)) {
            res.status(401);
            res.end();
            return;
        }

        if (accessToken === "" || accessToken == at) {
            const broadcastTo = (targetWid) => io.compress(false).to(targetWid).emit("drawToWhiteboard", query);
            broadcastTo(wid);
            
            const readOnlyId = ReadOnlyBackendService.getReadOnlyId(wid);
            broadcastTo(readOnlyId);
            
            try { query.th = parseFloat(query.th); } catch (e) {}
            try { query.d = JSON.parse(query.d); } catch (e) {}
            
            if (useDistributed) {
                await whiteboardService.handleEventsAndData(query);
            } else {
                whiteboardService.handleEventsAndData(query);
            }
            res.send("done");
        } else {
            res.status(401);
            res.end();
        }
    });

    function progressUploadFormData(formData, callback) {
        console.log("Progress new Form Data");
        const fields = escapeAllContentStrings(formData.fields);
        const wid = fields["wid"];
        if (ReadOnlyBackendService.isReadOnly(wid)) return;

        const readOnlyWid = ReadOnlyBackendService.getReadOnlyId(wid);
        const date = fields["date"] || +new Date();
        const filename = `${readOnlyWid}_${date}.png`;
        let webdavaccess = fields["webdavaccess"] || false;
        
        try { webdavaccess = JSON.parse(webdavaccess); } catch (e) { webdavaccess = false; }

        const savingDir = getSafeFilePath("public/uploads", readOnlyWid);
        fs.ensureDir(savingDir, function (err) {
            if (err) {
                console.log("Could not create upload folder!", err);
                return;
            }
            let imagedata = fields["imagedata"];
            if (imagedata && imagedata != "") {
                imagedata = imagedata
                    .replace(/^data:image\/png;base64,/, "")
                    .replace(/^data:image\/jpeg;base64,/, "");
                console.log(filename, "uploaded");
                const savingPath = getSafeFilePath(savingDir, filename);
                fs.writeFile(savingPath, imagedata, "base64", function (err) {
                    if (err) {
                        console.log("error", err);
                        callback(err);
                    } else {
                        if (webdavaccess && enableWebdav) {
                            saveImageToWebdav(savingPath, filename, webdavaccess, callback);
                        } else if (webdavaccess) {
                            callback("Webdav is not enabled on the server!");
                        } else {
                            callback();
                        }
                    }
                });
            } else {
                callback("no imagedata!");
                console.log("No image Data found for this upload!", filename);
            }
        });
    }

    function saveImageToWebdav(imagepath, filename, webdavaccess, callback) {
        if (webdavaccess) {
            const webdavserver = webdavaccess["webdavserver"] || "";
            const webdavpath = webdavaccess["webdavpath"] || "/";
            const webdavusername = webdavaccess["webdavusername"] || "";
            const webdavpassword = webdavaccess["webdavpassword"] || "";

            const client = createClient(webdavserver, {
                username: webdavusername,
                password: webdavpassword,
            });
            client
                .getDirectoryContents(webdavpath)
                .then((items) => {
                    const cloudpath = webdavpath + "" + filename;
                    console.log("webdav saving to:", cloudpath);
                    fs.createReadStream(imagepath).pipe(client.createWriteStream(cloudpath));
                    callback();
                })
                .catch((error) => {
                    callback("403");
                    console.log("Could not connect to webdav!");
                });
        } else {
            callback("Error: no access data!");
        }
    }

    // Socket.IO connection handling
    io.on("connection", function (socket) {
        let whiteboardId = null;
        
        metricsService.connectionOpened();
        console.log(`[${NODE_ID}] Client connected: ${socket.id}`);

        socket.on("disconnect", function () {
            metricsService.connectionClosed();
            console.log(`[${NODE_ID}] Client disconnected: ${socket.id}`);
            WhiteboardInfoBackendService.leave(socket.id, whiteboardId);
            socket.compress(false).broadcast.to(whiteboardId).emit("refreshUserBadges", null);
        });

        socket.on("drawToWhiteboard", async function (content) {
            if (!whiteboardId || ReadOnlyBackendService.isReadOnly(whiteboardId)) return;

            content = escapeAllContentStrings(content);
            content = purifyEncodedStrings(content);

            if (accessToken === "" || accessToken == content["at"]) {
                metricsService.drawEvent();
                
                const broadcastTo = (wid) =>
                    socket.compress(false).broadcast.to(wid).emit("drawToWhiteboard", content);
                
                broadcastTo(whiteboardId);
                const readOnlyId = ReadOnlyBackendService.getReadOnlyId(whiteboardId);
                broadcastTo(readOnlyId);
                
                if (useDistributed) {
                    await whiteboardService.handleEventsAndData(content);
                } else {
                    whiteboardService.handleEventsAndData(content);
                }
            } else {
                socket.emit("wrongAccessToken", true);
            }
        });

        socket.on("joinWhiteboard", function (content) {
            content = escapeAllContentStrings(content);
            if (accessToken === "" || accessToken == content["at"]) {
                whiteboardId = content["wid"];
                metricsService.whiteboardJoined(whiteboardId);

                socket.emit("whiteboardConfig", {
                    common: config.frontend,
                    whiteboardSpecific: {
                        correspondingReadOnlyWid: ReadOnlyBackendService.getReadOnlyId(whiteboardId),
                        isReadOnly: ReadOnlyBackendService.isReadOnly(whiteboardId),
                    },
                });

                socket.join(whiteboardId);
                const screenResolution = content["windowWidthHeight"];
                WhiteboardInfoBackendService.join(socket.id, whiteboardId, screenResolution);
                
                console.log(`[${NODE_ID}] User joined whiteboard: ${whiteboardId}`);
            } else {
                socket.emit("wrongAccessToken", true);
            }
        });

        socket.on("updateScreenResolution", function (content) {
            content = escapeAllContentStrings(content);
            if (accessToken === "" || accessToken == content["at"]) {
                const screenResolution = content["windowWidthHeight"];
                WhiteboardInfoBackendService.setScreenResolution(socket.id, whiteboardId, screenResolution);
            }
        });
    });

    function escapeAllContentStrings(content, cnt) {
        if (!cnt) cnt = 0;
        if (typeof content === "string") {
            return DOMPurify.sanitize(content);
        }
        for (var i in content) {
            if (typeof content[i] === "string") {
                content[i] = DOMPurify.sanitize(content[i]);
            }
            if (typeof content[i] === "object" && cnt < 10) {
                content[i] = escapeAllContentStrings(content[i], ++cnt);
            }
        }
        return content;
    }

    function purifyEncodedStrings(content) {
        if (content.hasOwnProperty("t") && content["t"] === "setTextboxText") {
            return purifyTextboxTextInContent(content);
        }
        return content;
    }

    function purifyTextboxTextInContent(content) {
        const raw = content["d"][1];
        const decoded = base64decode(raw);
        const purified = DOMPurify.sanitize(decoded, {
            ALLOWED_TAGS: ["div", "br"],
            ALLOWED_ATTR: [],
            ALLOW_DATA_ATTR: false,
        });

        if (purified !== decoded) {
            console.warn("setTextboxText payload needed be DOMpurified");
        }

        content["d"][1] = base64encode(purified);
        return content;
    }

    function base64encode(s) {
        return Buffer.from(s, "utf8").toString("base64");
    }

    function base64decode(s) {
        return Buffer.from(s, "base64").toString("utf8");
    }

    process.on("unhandledRejection", (error) => {
        console.log("unhandledRejection", error.message);
    });
}
