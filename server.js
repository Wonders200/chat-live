const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const db = new Database("chat-live.db");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    api_key TEXT PRIMARY KEY,
    site_name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    site_api_key TEXT NOT NULL,
    visitor_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    sender_type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

if (!db.prepare("SELECT * FROM sites").get()) {
  const demoKey = "live_" + crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO sites (api_key, site_name) VALUES (?, ?)").run(demoKey, "Demo Website");
  console.log("=========================================");
  console.log("DEMO API KEY CREATED:", demoKey);
  console.log("=========================================");
}

const visitors = new Map();
const admins = new Map();

function broadcastToVisitor(convId, data) {
  const clients = visitors.get(convId);
  if (clients) clients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

function broadcastToAdmin(apiKey, data) {
  const clients = admins.get(apiKey);
  if (clients) clients.forEach(res => res.write(`data: ${JSON.stringify(data)}\n\n`));
}

app.get("/api/sse/visitor/:convId", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const convId = req.params.convId;
  if (!visitors.has(convId)) visitors.set(convId, new Set());
  visitors.get(convId).add(res);
  req.on("close", () => {
    visitors.get(convId).delete(res);
    if (visitors.get(convId).size === 0) visitors.delete(convId);
  });
});

app.get("/api/sse/admin", (req, res) => {
  const apiKey = req.query.api_key;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  if (!admins.has(apiKey)) admins.set(apiKey, new Set());
  admins.get(apiKey).add(res);
  req.on("close", () => {
    admins.get(apiKey).delete(res);
    if (admins.get(apiKey).size === 0) admins.delete(apiKey);
  });
});

app.post("/api/chat/init", (req, res) => {
  const { apiKey, visitorId } = req.body;
  const site = db.prepare("SELECT * FROM sites WHERE api_key = ?").get(apiKey);
  if (!site) return res.status(401).json({ error: "Invalid API Key" });
  let conv = db.prepare("SELECT id FROM conversations WHERE site_api_key = ? AND visitor_id = ?").get(apiKey, visitorId);
  if (!conv) {
    const convId = "conv_" + crypto.randomBytes(8).toString("hex");
    db.prepare("INSERT INTO conversations (id, site_api_key, visitor_id) VALUES (?, ?, ?)").run(convId, apiKey, visitorId);
    conv = { id: convId };
  }
  const messages = db.prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(conv.id);
  res.json({ conversationId: conv.id, messages });
});

app.post("/api/chat/send", (req, res) => {
  const { conversationId, senderType, message } = req.body;
  const info = db.prepare("INSERT INTO messages (conversation_id, sender_type, message) VALUES (?, ?, ?)").run(conversationId, senderType, message);
  const newMsg = { id: info.lastInsertRowid, conversation_id: conversationId, sender_type: senderType, message, created_at: new Date().toISOString() };
  const conv = db.prepare("SELECT site_api_key FROM conversations WHERE id = ?").get(conversationId);
  if (senderType === "visitor") {
    broadcastToAdmin(conv.site_api_key, { type: "new_message", data: newMsg });
    broadcastToVisitor(conversationId, { type: "new_message", data: newMsg });
  } else {
    broadcastToVisitor(conversationId, { type: "new_message", data: newMsg });
    broadcastToAdmin(conv.site_api_key, { type: "new_message", data: newMsg });
  }
  res.json({ ok: true, message: newMsg });
});

app.get("/api/admin/conversations", (req, res) => {
  const apiKey = req.query.api_key;
  const convs = db.prepare(`
    SELECT c.id, c.visitor_id, c.created_at,
    (SELECT message FROM messages WHERE conversation_id = c.id ORDER BY id DESC LIMIT 1) as last_message
    FROM conversations c WHERE c.site_api_key = ? ORDER BY c.created_at DESC
  `).all(apiKey);
  res.json(convs);
});

app.listen(4000, () => console.log("Chat Live API running on http://localhost:4000"));