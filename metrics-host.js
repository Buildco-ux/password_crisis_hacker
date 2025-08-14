// metrics-host.js - Enhanced Remote Metrics Host Server
// Run: node metrics-host.js

const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { MongoClient } = require("mongodb");
const os = require("os");
const crypto = require("crypto");
const path = require("path");

// ======== Configuration ========
const CONFIG = {
  PORT: process.env.PORT || 8080,
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017",
  DATABASE: "metrics_host",
  COLLECTION: "client_metrics",
  SESSIONS: "client_sessions",
  MAX_CLIENTS_PER_ROOM: 50,
  METRICS_RETENTION_DAYS: 30,
  CLEANUP_INTERVAL: 24 * 60 * 60 * 1000, // 24 hours
  AUTH_TIMEOUT: 30000, // 30 seconds
  HEARTBEAT_INTERVAL: 30000 // 30 seconds
};

// ======== MongoDB Setup ========
let db, metricsCollection, sessionsCollection;

async function connectDB() {
  try {
    const client = new MongoClient(CONFIG.MONGODB_URI);
    await client.connect();
    db = client.db(CONFIG.DATABASE);
    metricsCollection = db.collection(CONFIG.COLLECTION);
    sessionsCollection = db.collection(CONFIG.SESSIONS);
    
    // Create indexes for performance
    await metricsCollection.createIndex({ "timestamp": -1 });
    await metricsCollection.createIndex({ "clientId": 1 });
    await metricsCollection.createIndex({ "roomCode": 1 });
    await sessionsCollection.createIndex({ "roomCode": 1 });
    await sessionsCollection.createIndex({ "expiresAt": 1 }, { expireAfterSeconds: 0 });
    
    console.log("✅ Connected to MongoDB");
    return true;
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    return false;
  }
}

// ======== Utility Functions ========
function getLocalIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "localhost";
}

function generateRoomCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateClientId() {
  return crypto.randomBytes(8).toString('hex');
}

function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>\"'&]/g, '').substring(0, 100);
}

// ======== Room Management ========
class MetricsRoom {
  constructor(code) {
    this.code = code;
    this.controller = null;
    this.clients = new Map(); // clientId -> WebSocket
    this.metrics = []; // Recent metrics for this room
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.settings = {
      maxMetricsHistory: 1000,
      enableRealTime: true,
      enableAlerts: true
    };
  }

  addClient(clientId, ws, role) {
    if (role === 'controller') {
      this.controller = ws;
      ws.roomCode = this.code;
      ws.clientId = clientId;
      ws.role = 'controller';
    } else {
      this.clients.set(clientId, ws);
      ws.roomCode = this.code;
      ws.clientId = clientId;
      ws.role = 'client';
    }
    this.lastActivity = Date.now();
    
    // Send room info to new client
    this.sendToClient(ws, {
      type: 'room_info',
      roomCode: this.code,
      clientId: clientId,
      role: role,
      clientCount: this.clients.size,
      controllerConnected: !!this.controller
    });
    
    // Notify controller about new client
    if (role === 'client' && this.controller) {
      this.sendToClient(this.controller, {
        type: 'client_joined',
        clientId: clientId,
        clientCount: this.clients.size
      });
    }
    
    console.log(`📱 ${role} joined room ${this.code} (${clientId.slice(0, 8)}...)`);
  }

  removeClient(clientId, role) {
    if (role === 'controller') {
      this.controller = null;
    } else {
      this.clients.delete(clientId);
    }
    this.lastActivity = Date.now();
    
    // Notify remaining clients
    if (role === 'client' && this.controller) {
      this.sendToClient(this.controller, {
        type: 'client_left',
        clientId: clientId,
        clientCount: this.clients.size
      });
    }
    
    console.log(`👋 ${role} left room ${this.code} (${clientId.slice(0, 8)}...)`);
  }

  broadcastToClients(message, excludeClient = null) {
    for (const [clientId, client] of this.clients) {
      if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
        this.sendToClient(client, message);
      }
    }
  }

  sendToController(message) {
    if (this.controller && this.controller.readyState === WebSocket.OPEN) {
      this.sendToClient(this.controller, message);
    }
  }

  sendToClient(ws, message) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      }
    } catch (error) {
      console.error("Failed to send message to client:", error);
    }
  }

  addMetrics(clientId, metrics) {
    const metricEntry = {
      ...metrics,
      clientId,
      roomCode: this.code,
      timestamp: new Date(),
      receivedAt: Date.now()
    };
    
    this.metrics.push(metricEntry);
    
    // Keep only recent metrics
    if (this.metrics.length > this.settings.maxMetricsHistory) {
      this.metrics = this.metrics.slice(-this.settings.maxMetricsHistory);
    }
    
    this.lastActivity = Date.now();
    
    // Store in database
    this.storeMetrics(metricEntry);
    
    // Forward to controller
    this.sendToController({
      type: 'metrics',
      from: clientId,
      payload: metrics,
      timestamp: metricEntry.timestamp
    });
    
    // Check for alerts
    this.checkAlerts(clientId, metrics);
  }

  async storeMetrics(metricEntry) {
    try {
      await metricsCollection.insertOne(metricEntry);
    } catch (error) {
      console.error("Failed to store metrics:", error);
    }
  }

  checkAlerts(clientId, metrics) {
    if (!this.settings.enableAlerts) return;
    
    const alerts = [];
    
    // Check for suspicious patterns
    if (metrics.entropy < 20) {
      alerts.push({
        type: 'low_entropy',
        severity: 'warning',
        message: `Client ${clientId.slice(0, 8)} has very low password entropy: ${metrics.entropy}`
      });
    }
    
    if (metrics.breached) {
      alerts.push({
        type: 'breached_password',
        severity: 'critical',
        message: `Client ${clientId.slice(0, 8)} attempted to use a breached password!`
      });
    }
    
    // Send alerts to controller
    if (alerts.length > 0) {
      this.sendToController({
        type: 'alerts',
        alerts: alerts
      });
    }
  }

  getStats() {
    return {
      roomCode: this.code,
      clientCount: this.clients.size,
      controllerConnected: !!this.controller,
      metricsCount: this.metrics.length,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      uptime: Date.now() - this.createdAt
    };
  }
}

// ======== Global State ========
const rooms = new Map(); // roomCode -> MetricsRoom
const clientSessions = new Map(); // clientId -> session info

// ======== Express App Setup ========
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ======== API Endpoints ========

// Get server info
app.get('/api/info', (req, res) => {
  res.json({
    server: 'Metrics Host Server',
    version: '1.0.0',
    uptime: process.uptime(),
    rooms: rooms.size,
    totalClients: Array.from(rooms.values()).reduce((sum, room) => sum + room.clients.size, 0),
    wsUrl: `ws://${getLocalIp()}:${CONFIG.PORT}`,
    localUrl: `ws://localhost:${CONFIG.PORT}`
  });
});

// Create new room
app.post('/api/rooms', async (req, res) => {
  try {
    const roomCode = generateRoomCode();
    const room = new MetricsRoom(roomCode);
    rooms.set(roomCode, room);
    
    // Store room session
    await sessionsCollection.insertOne({
      roomCode,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    });
    
    res.json({
      success: true,
      roomCode,
      message: 'Room created successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to create room',
      error: error.message
    });
  }
});

// Get room statistics
app.get('/api/rooms/:roomCode/stats', (req, res) => {
  const room = rooms.get(req.params.roomCode);
  if (!room) {
    return res.status(404).json({
      success: false,
      message: 'Room not found'
    });
  }
  
  res.json({
    success: true,
    stats: room.getStats()
  });
});

// Get room metrics history
app.get('/api/rooms/:roomCode/metrics', async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const metrics = await metricsCollection
      .find({ roomCode: req.params.roomCode })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .toArray();
    
    res.json({
      success: true,
      metrics,
      count: metrics.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to fetch metrics',
      error: error.message
    });
  }
});

// Delete room
app.delete('/api/rooms/:roomCode', async (req, res) => {
  try {
    const room = rooms.get(req.params.roomCode);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: 'Room not found'
      });
    }
    
    // Close all connections
    if (room.controller) {
      room.controller.close();
    }
    for (const [clientId, client] of room.clients) {
      client.close();
    }
    
    // Remove from memory
    rooms.delete(req.params.roomCode);
    
    // Clean up database
    await sessionsCollection.deleteOne({ roomCode: req.params.roomCode });
    
    res.json({
      success: true,
      message: 'Room deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to delete room',
      error: error.message
    });
  }
});

// Get all rooms
app.get('/api/rooms', (req, res) => {
  const roomList = Array.from(rooms.values()).map(room => room.getStats());
  res.json({
    success: true,
    rooms: roomList,
    total: roomList.length
  });
});

// ======== WebSocket Server ========
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  const clientId = generateClientId();
  let room = null;
  let authTimeout = null;
  
  console.log(`🔌 New WebSocket connection: ${clientId.slice(0, 8)}...`);
  
  // Set up authentication timeout
  authTimeout = setTimeout(() => {
    if (!room) {
      console.log(`⏰ Authentication timeout for ${clientId.slice(0, 8)}...`);
      ws.close(1000, 'Authentication timeout');
    }
  }, CONFIG.AUTH_TIMEOUT);
  
  // Set up heartbeat
  const heartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, CONFIG.HEARTBEAT_INTERVAL);
  
  ws.on('message', async (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle authentication
      if (message.type === 'hello') {
        clearTimeout(authTimeout);
        
        const { role, code } = message;
        if (!role || !code) {
          ws.close(1000, 'Invalid authentication');
          return;
        }
        
        // Validate room code
        if (!rooms.has(code)) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Invalid room code'
          }));
          ws.close(1000, 'Invalid room code');
          return;
        }
        
        room = rooms.get(code);
        
        // Check room capacity
        if (role === 'client' && room.clients.size >= CONFIG.MAX_CLIENTS_PER_ROOM) {
          ws.send(JSON.stringify({
            type: 'error',
            message: 'Room is full'
          }));
          ws.close(1000, 'Room is full');
          return;
        }
        
        // Add client to room
        room.addClient(clientId, ws, role);
        
        // Store session
        clientSessions.set(clientId, {
          roomCode: code,
          role,
          connectedAt: Date.now(),
          ip: req.socket.remoteAddress
        });
        
        console.log(`✅ ${role} authenticated in room ${code}`);
      }
      
      // Handle metrics from clients
      else if (message.type === 'metrics' && room && ws.role === 'client') {
        const { payload } = message;
        if (payload) {
          room.addMetrics(clientId, {
            ...payload,
            ip: req.socket.remoteAddress,
            userAgent: req.headers['user-agent'] || 'unknown'
          });
        }
      }
      
      // Handle room settings from controller
      else if (message.type === 'room_settings' && room && ws.role === 'controller') {
        const { settings } = message;
        if (settings) {
          room.settings = { ...room.settings, ...settings };
          room.sendToController({
            type: 'settings_updated',
            settings: room.settings
          });
        }
      }
      
      // Handle ping/pong
      else if (message.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
      }
      
    } catch (error) {
      console.error('WebSocket message error:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Invalid message format'
      }));
    }
  });
  
  ws.on('close', (code, reason) => {
    clearInterval(heartbeat);
    clearTimeout(authTimeout);
    
    if (room) {
      room.removeClient(clientId, ws.role);
      
      // Remove empty rooms after delay
      if (room.clients.size === 0 && !room.controller) {
        setTimeout(() => {
          if (room.clients.size === 0 && !room.controller) {
            console.log(`🗑️ Removing empty room ${room.code}`);
            rooms.delete(room.code);
          }
        }, 60000); // 1 minute delay
      }
    }
    
    clientSessions.delete(clientId);
    console.log(`🔌 WebSocket closed: ${clientId.slice(0, 8)}... (${code}: ${reason})`);
  });
  
  ws.on('error', (error) => {
    console.error(`WebSocket error for ${clientId.slice(0, 8)}:`, error);
  });
  
  ws.on('pong', () => {
    // Client responded to ping
  });
});

// ======== Cleanup Tasks ========
async function cleanupOldMetrics() {
  try {
    const cutoffDate = new Date(Date.now() - CONFIG.METRICS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await metricsCollection.deleteMany({
      timestamp: { $lt: cutoffDate }
    });
    
    if (result.deletedCount > 0) {
      console.log(`🧹 Cleaned up ${result.deletedCount} old metrics`);
    }
  } catch (error) {
    console.error('Cleanup failed:', error);
  }
}

// Run cleanup every 24 hours
setInterval(cleanupOldMetrics, CONFIG.CLEANUP_INTERVAL);

// ======== Graceful Shutdown ========
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Close all WebSocket connections
  wss.clients.forEach(client => {
    client.close(1000, 'Server shutdown');
  });
  
  // Close server
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
  
  // Force exit after 5 seconds
  setTimeout(() => {
    console.log('⚠️ Forced shutdown');
    process.exit(1);
  }, 5000);
});

// ======== Start Server ========
async function startServer() {
  // Connect to database
  const dbConnected = await connectDB();
  if (!dbConnected) {
    console.log('⚠️ Starting server without database connection');
  }
  
  // Start HTTP server
  server.listen(CONFIG.PORT, () => {
    console.log('\n🚀 Metrics Host Server Started!');
    console.log('================================');
    console.log(`📍 Local:   http://localhost:${CONFIG.PORT}`);
    console.log(`🌐 Network: http://${getLocalIp()}:${CONFIG.PORT}`);
    console.log(`🔌 WebSocket: ws://${getLocalIp()}:${CONFIG.PORT}`);
    console.log(`📊 API:     http://localhost:${CONFIG.PORT}/api/info`);
    console.log(`📱 Dashboard: http://localhost:${CONFIG.PORT}/dashboard`);
    console.log('================================\n');
    
    if (dbConnected) {
      console.log('✅ MongoDB connected');
    } else {
      console.log('❌ MongoDB disconnected - some features may not work');
    }
  });
}

startServer().catch(console.error);
