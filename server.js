ws.on('message', async (data) => {
  let msg;
  try { msg = JSON.parse(data); } catch { return; }

  // Join room
  if (msg.type === 'hello' && (msg.role === 'controller' || msg.role === 'client') && msg.code) {
    const room = getRoom(msg.code);
    ws.role = msg.role;
    ws.code = msg.code;

    // Capture IP address
    const forwarded = ws._socket.remoteAddress;
    ws.ip = forwarded?.startsWith('::ffff:') ? forwarded.slice(7) : forwarded;

    if (ws.role === 'controller') {
      room.controller = ws;
      send(ws, { type: 'joined', role: 'controller', code: msg.code });
    } else {
      room.clients.add(ws);
      send(ws, { type: 'joined', role: 'client', code: msg.code });
      room.controller && send(room.controller, { type: 'client_joined', clientId: ws.id });
    }
    return;
  }

  // Relay client metrics to controller + store in DB
  if (msg.type === 'metrics' && ws.role === 'client' && ws.code) {
    const room = rooms.get(ws.code);

    // Relay to controller
    room?.controller && send(room.controller, {
      type: 'metrics',
      from: ws.id,
      payload: msg.payload
    });

    // Store in MongoDB
    try {
      const attempts = await connectDB();
      await attempts.insertOne({
        ts: new Date().toISOString(),
        clientId: ws.id,
        code: ws.code,
        ip: ws.ip || 'unknown',
        metrics: msg.payload
      });
    } catch (e) {
      console.error('Failed to store metrics:', e);
    }

    return;
  }

  // Relay message from controller to clients
  if (msg.type === 'relay' && ws.role === 'controller' && ws.code) {
    const room = rooms.get(ws.code);
    if (room) {
      for (const client of room.clients) {
        send(client, { type: 'relay', from: ws.id, payload: msg.payload });
      }
    }
    return;
  }

  console.warn('Unknown message type:', msg.type);
});