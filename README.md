# 🔐 Password Crisis Early Warning System + Metrics Host

A comprehensive password security analysis system with remote metrics collection capabilities.

## 🚀 Features

### Core Password Analysis
- **Password Strength Assessment**: Real-time entropy calculation and security scoring
- **Breach Database Checking**: Integration with HaveIBeenPwned API
- **Pattern Recognition**: Identifies common password patterns and weaknesses
- **Password Generation**: Creates strong, secure passwords
- **Clustering Analysis**: Groups similar passwords by hash or pattern

### Remote Metrics Host
- **Multi-room Architecture**: Support for multiple concurrent monitoring sessions
- **Real-time WebSocket Communication**: Live metrics streaming
- **Role-based Access**: Separate controller and client roles
- **MongoDB Storage**: Persistent metrics storage with automatic cleanup
- **Alert System**: Real-time notifications for security issues
- **Dashboard Interface**: Comprehensive monitoring and management UI

## 🏗️ Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Main App      │    │  Metrics Host    │    │   Remote       │
│  (index.html)   │◄──►│    Server        │◄──►│   Clients      │
│                 │    │  (metrics-host.js)│    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Dashboard     │    │    MongoDB       │    │  WebSocket      │
│  (dashboard.html)│    │   Database      │    │   Connections   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

## 📋 Prerequisites

- Node.js (v14 or higher)
- MongoDB (local or remote instance)
- Modern web browser with WebSocket support

## 🛠️ Installation

1. **Clone or download the project files**

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start MongoDB** (if using local instance):
   ```bash
   # Windows
   mongod
   
   # macOS/Linux
   sudo systemctl start mongod
   ```

4. **Configure environment** (optional):
   ```bash
   # Create .env file
   PORT=8080
   MONGODB_URI=mongodb://127.0.0.1:27017
   ```

## 🚀 Running the System

### 1. Start the Metrics Host Server

```bash
node metrics-host.js
```

The server will start on port 8080 (or the port specified in your environment).

**Expected Output:**
```
🚀 Metrics Host Server Started!
================================
📍 Local:   http://localhost:8080
🌐 Network: http://192.168.1.100:8080
🔌 WebSocket: ws://192.168.1.100:8080
📊 API:     http://localhost:8080/api/info
📱 Dashboard: http://localhost:8080/dashboard
================================

✅ MongoDB connected
```

### 2. Access the Main Application

Open `index.html` in your browser or serve it using a local server.

### 3. Access the Dashboard

Navigate to `http://localhost:8080/dashboard` for the comprehensive monitoring interface.

## 📱 Usage Guide

### Creating a Metrics Room

1. **In the main app**: Click "Create New Room" in the Remote Metrics section
2. **Room code generated**: A unique 6-character room code will be created
3. **Share the code**: Provide the room code to clients who need to connect

### Connecting as a Controller

1. **Create a room** (if not already done)
2. **Click "Connect as Controller"**
3. **Monitor clients**: Watch for client connections and incoming metrics
4. **View real-time data**: See password analysis results as they arrive

### Connecting as a Client

1. **Use the metrics client**: Open `public/metrics-client.html`
2. **Enter connection details**:
   - Server URL: `ws://localhost:8080` (or your server IP)
   - Room Code: The code provided by your controller
3. **Click "Connect"**
4. **Send metrics**: Analyze passwords or use auto-send for testing

### Using the Dashboard

1. **Room Management**: Create, view, and delete rooms
2. **Real-time Monitoring**: Watch live metrics from connected clients
3. **Historical Data**: Access stored metrics and generate reports
4. **System Status**: Monitor server health and connection status

## 🔌 API Endpoints

### Server Information
- `GET /api/info` - Server status and configuration

### Room Management
- `POST /api/rooms` - Create a new room
- `GET /api/rooms` - List all active rooms
- `GET /api/rooms/:roomCode/stats` - Get room statistics
- `GET /api/rooms/:roomCode/metrics` - Get room metrics history
- `DELETE /api/rooms/:roomCode` - Delete a room

## 📊 WebSocket Protocol

### Authentication Message
```json
{
  "type": "hello",
  "role": "controller|client",
  "code": "ROOM_CODE"
}
```

### Metrics Message (from client)
```json
{
  "type": "metrics",
  "payload": {
    "entropy": 45.2,
    "time": "Years",
    "pattern": "UlDSUlDSUlDSUlDS",
    "length": 16,
    "breached": false,
    "ts": 1640995200000
  }
}
```

### Server Responses
- `room_info` - Confirmation of room join
- `client_joined` - Notification of new client
- `client_left` - Notification of client disconnect
- `metrics` - Forwarded metrics from clients
- `alerts` - Security alerts and warnings

## 🎯 Use Cases

### Security Research
- Collect password strength data across different user populations
- Analyze password patterns and trends
- Identify common security weaknesses

### Educational Purposes
- Demonstrate password security concepts
- Show real-time entropy calculations
- Visualize password strength metrics

### Penetration Testing
- Assess password policies in organizations
- Monitor password-related security events
- Generate security reports

### Development Testing
- Test password validation systems
- Benchmark password strength algorithms
- Validate security implementations

## 🔒 Security Features

- **Room-based Isolation**: Clients can only access their assigned rooms
- **Authentication Required**: All connections must authenticate with valid room codes
- **Input Sanitization**: All user inputs are sanitized and validated
- **Connection Limits**: Maximum client limits per room to prevent abuse
- **Automatic Cleanup**: Old metrics and sessions are automatically removed

## 🚨 Troubleshooting

### Common Issues

1. **"MongoDB connection failed"**
   - Ensure MongoDB is running
   - Check connection string in configuration
   - Verify network access

2. **"WebSocket connection failed"**
   - Check if the metrics host server is running
   - Verify the WebSocket URL format
   - Check firewall settings

3. **"Room not found"**
   - Ensure the room code is correct
   - Check if the room still exists
   - Verify the room hasn't expired

4. **"Authentication timeout"**
   - Clients must authenticate within 30 seconds
   - Check network connectivity
   - Verify room code validity

### Debug Mode

Enable detailed logging by setting environment variables:
```bash
DEBUG=* node metrics-host.js
```

## 🔧 Configuration

### Server Configuration (`metrics-host.js`)

```javascript
const CONFIG = {
  PORT: process.env.PORT || 8080,
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017",
  DATABASE: "metrics_host",
  MAX_CLIENTS_PER_ROOM: 50,
  METRICS_RETENTION_DAYS: 30,
  AUTH_TIMEOUT: 30000, // 30 seconds
  HEARTBEAT_INTERVAL: 30000 // 30 seconds
};
```

### Environment Variables

- `PORT` - Server port (default: 8080)
- `MONGODB_URI` - MongoDB connection string
- `NODE_ENV` - Environment mode (development/production)

## 📈 Performance

- **Concurrent Connections**: Supports up to 50 clients per room
- **Metrics Storage**: Automatic cleanup of old data (30-day retention)
- **Memory Usage**: Efficient room management with automatic cleanup
- **Scalability**: Room-based architecture allows horizontal scaling

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For issues and questions:
1. Check the troubleshooting section
2. Review the API documentation
3. Check browser console for error messages
4. Verify server logs for detailed information

## 🔮 Future Enhancements

- [ ] Real-time charts and visualizations
- [ ] Advanced alerting and notification system
- [ ] User authentication and role management
- [ ] API rate limiting and security
- [ ] Metrics export in multiple formats
- [ ] Mobile-responsive dashboard
- [ ] Integration with security tools
- [ ] Machine learning-based threat detection

---

**Happy Password Security Monitoring! 🔐✨**
