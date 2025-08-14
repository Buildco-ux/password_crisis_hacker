// server.js
// Run: npm i express body-parser request-ip maxmind node-fetch@2 mongodb ws

const os = require("os");
const express = require("express");
const bodyParser = require("body-parser");
const requestIp = require("request-ip");
const fs = require("fs");
const maxmind = fs.existsSync("./GeoLite2-City.mmdb") ? require("maxmind") : null;
const fetch = require("node-fetch");
const http = require("http");
const WebSocket = require("ws");

// ======== MongoDB setup without .env file ========
const { MongoClient } = require("mongodb");
// Hardcoded URI for a local MongoDB instance
const uri = "mongodb://127.0.0.1:27017";
const client = new MongoClient(uri);

async function connectDB() {
  try {
    await client.connect();
    return client.db("mydb").collection("attempts");
  } catch (e) {
    console.error("Failed to connect to MongoDB:", e);
    throw e;
  }
}

// ======== Utility: get LAN IPv4 address ========
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

// ======== GeoIP lookup ========
async function lookupGeo(ip) {
  const blank = { country: null, region: null, city: null, lat: null, lon: null, asn: null, org: null };
  if (!ip) return blank;

  // Try local MaxMind DB
  if (maxmind) {
    try {
      const reader = await maxmind.open("./GeoLite2-City.mmdb");
      const g = reader.get(ip);
      if (g) {
        return {
          country: g?.country?.iso_code || null,
          region: g?.subdivisions?.[0]?.names?.en || null,
          city: g?.city?.names?.en || null,
          lat: g?.location?.latitude || null,
          lon: g?.location?.longitude || null,
          asn: g?.traits?.autonomous_system_number || null,
          org: g?.traits?.organization || null
        };
      }
    } catch (e) {
      console.error("MaxMind error:", e);
    }
  }

  // Fallback public API
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,regionName,city,lat,lon,as,org`);
    const j = await r.json();
    if (j.status === "success") {
      return {
        country: j.country || null,
        region: j.regionName || null,
        city: j.city || null,
        lat: j.lat ?? null,
        lon: j.lon ?? null,
        asn: j.as || null,
        org: j.org || null
      };
    }
  } catch (e) {
    console.error("GeoIP fallback failed:", e);
  }

  return blank;
}

// ======== Express setup ========
const app = express();
app.set("trust proxy", true);
app.use(bodyParser.json());
app.use(express.static("./public")); // serve static files like HTML/JS/CSS

// ======== API: Simulated login ========
app.post("/api/login", async (req, res) => {
  const clientIp = requestIp.getClientIp(req) || req.ip || null;
  const {
    username = "",
    ua = req.get("user-agent") || "",
    lang = req.get("accept-language") || "",
    tz,
    screen,
    platform,
    memory_gb,
    cores
  } = req.body || {};

  const success = false; // Replace with real auth
  const geo = await lookupGeo(clientIp);
  const attempts = await connectDB();

  await attempts.insertOne({
    username,
    success: success ? 1 : 0,
    ts: new Date().toISOString(),
    ip: clientIp,
    country: geo.country,
    region: geo.region,
    city: geo.city,
    lat: geo.lat,
    lon: geo.lon,
    asn: geo.asn,
    org: geo.org,
    ua,
    lang,
    tz: tz || null,
    screen: screen || null,
    platform: platform || null,
    memory_gb: Number(memory_gb) || null,
    cores: Number(cores) || null
  });

  res.json({ ok: true, success, message: success ? "Login ok" : "Login failed", ip: clientIp, geo });
});

// ======== API: Get login attempts ========
app.get("/api/attempts", async (req, res) => {
  try {
    const attempts = await connectDB();
    const rows = await attempts.find().sort({ ts: -1 }).limit(500).toArray();
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, message: "Database error" });
  }
});

// ======== API: Get WebSocket info ========
app.get("/api/wsinfo", (req, res) => {
  const PORT = process.env.PORT || 5000;
  res.json({ wsUrl: `ws://${getLocalIp()}:${PORT}` });
});

// ======== Minimal dashboard ========
app.get("/attempts", (req, res) => {
  res.type("html").send(`
<!doctype html>
<html><head><meta charset="utf-8"><title>Login Attempts</title>
<style>
body { font-family: system-ui, Arial; margin: 16px; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 1px solid #ddd; padding: 6px; text-align: left; }
th { background: #f6f6f6; position: sticky; top: 0; }
</style></head><body>
<h2>Recent Login Attempts</h2>
<table id="t"><thead><tr>
<th>ts</th><th>username</th><th>success</th><th>ip</th><th>country</th><th>region</th><th>city</th><th>lat</th><th>lon</th><th>asn</th><th>org</th><th>ua</th><th>lang</th><th>tz</th><th>screen</th><th>platform</th><th>memory_gb</th><th>cores</th>
</tr></thead><tbody></tbody></table>
<script>
fetch('/api/attempts').then(r => r.json()).then(j => {
  const tb = document.querySelector('#t tbody');
  (j.rows || []).forEach(r => {
    const tr = document.createElement('tr');
    ['ts','username','success','ip','country','region','city','lat','lon','asn','org','ua','lang','tz','screen','platform','memory_gb','cores'].forEach(k => {
      const td = document.createElement('td');
      td.textContent = r[k] ?? '';
      tr.appendChild(td);
    });
    tb.appendChild(tr);
  });
});
</script></body></html>
  `);
});

// ======== WebSocket server setup ========
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
let clients = new Map();

wss.on("connection", (ws) => {
  console.log("New WebSocket client connected");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === "pair" && data.code) {
        clients.set(data.code, ws);
        ws.send(JSON.stringify({ type: "paired", code: data.code }));
      }

      if (data.type === "metrics" && data.code) {
        const viewer = clients.get(data.code);
        if (viewer && viewer !== ws && viewer.readyState === WebSocket.OPEN) {
          viewer.send(JSON.stringify({ type: "metrics", payload: data.payload }));
        }
      }
    } catch (err) {
      console.error("Invalid WS message", err);
    }
  });

  ws.on("close", () => {
    for (let [code, socket] of clients.entries()) {
      if (socket === ws) {
        clients.delete(code);
        break;
      }
    }
    console.log("WebSocket client disconnected");
  });
});

// ======== Start server ========
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running at:`);
  console.log(`   Local:   http://localhost:${PORT}`);
  console.log(`   Network: http://${getLocalIp()}:${PORT}`);
  console.log(`WebSocket: ws://${getLocalIp()}:${PORT}`);
});