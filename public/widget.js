(function() {
  var scriptTag = document.currentScript;
  var apiKey = scriptTag.getAttribute("data-api-key");
  var serverUrl = scriptTag.getAttribute("data-server") || "http://localhost:4000";
  if (!apiKey) return console.error("Chat Live: Missing data-api-key");

  var visitorId = localStorage.getItem("chatlive_visitor_id");
  if (!visitorId) {
    visitorId = "vis_" + Math.random().toString(36).substring(2, 15);
    localStorage.setItem("chatlive_visitor_id", visitorId);
  }
  
  // Allow embedding site to pass a visitor name
  var visitorName = scriptTag.getAttribute("data-visitor-name") || "Visitor";

  var convId = null;
  var isOpen = false;
  var evtSource = null;
  var selectedFile = null;

  var style = document.createElement("style");
  style.textContent = "#cl-bubble{position:fixed;bottom:24px;right:24px;width:60px;height:60px;background:linear-gradient(135deg,#1438f5,#0a1c8a);color:#fff;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 8px 32px rgba(20,56,245,.4);z-index:999999;transition:all .3s cubic-bezier(0.175,0.885,0.32,1.275)}#cl-bubble:hover{transform:scale(1.1) translateY(-4px);box-shadow:0 12px 40px rgba(20,56,245,.5)}#cl-window{position:fixed;bottom:100px;right:24px;width:360px;height:500px;background:#fff;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.15);display:none;flex-direction:column;z-index:999999;overflow:hidden;border:1px solid #e7e8ee;font-family:sans-serif}#cl-window.open{display:flex}#cl-header{background:#1438f5;color:#fff;padding:16px;font-weight:bold;display:flex;justify-content:space-between;align-items:center}#cl-close{cursor:pointer;font-size:20px}#cl-body{flex:1;padding:16px;background:#fbfcff;overflow-y:auto;display:flex;flex-direction:column;gap:10px}.cl-msg{max-width:80%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word}.cl-msg.visitor{align-self:flex-end;background:#1438f5;color:#fff;border-bottom-right-radius:4px}.cl-msg.admin{align-self:flex-start;background:#fff;color:#0b0b0d;border:1px solid #e7e8ee;border-bottom-left-radius:4px}.cl-msg img{max-width:100%;border-radius:8px;margin-top:8px;display:block;cursor:pointer}#cl-input-wrap{padding:12px;border-top:1px solid #e7e8ee;display:flex;align-items:center;gap:8px}#cl-input{flex:1;padding:10px;border:1px solid #e7e8ee;border-radius:20px;outline:none}#cl-send{background:#1438f5;color:#fff;border:none;padding:10px 16px;border-radius:20px;cursor:pointer;font-weight:bold}#cl-attach{background:none;border:none;color:#6d6e75;cursor:pointer;padding:4px;display:flex;align-items:center;justify-content:center}";
  document.head.appendChild(style);

  var wrap = document.createElement("div");
  wrap.innerHTML = '<div id="cl-bubble"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg></div><div id="cl-window"><div id="cl-header"><span>Chat Live</span><span id="cl-close">&times;</span></div><div id="cl-body"></div><div id="cl-input-wrap"><button id="cl-attach"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></button><input type="file" id="cl-file" accept="image/*" style="display:none" /><input id="cl-input" type="text" placeholder="Type a message..." /><button id="cl-send">Send</button></div></div>';
  document.body.appendChild(wrap);

  var bubble = document.getElementById("cl-bubble");
  var win = document.getElementById("cl-window");
  var closeBtn = document.getElementById("cl-close");
  var body = document.getElementById("cl-body");
  var input = document.getElementById("cl-input");
  var sendBtn = document.getElementById("cl-send");
  var attachBtn = document.getElementById("cl-attach");
  var fileInput = document.getElementById("cl-file");

  function appendMsg(m) {
    var el = document.createElement("div");
    el.className = "cl-msg " + m.sender_type;
    var html = "";
    if (m.message) html += m.message.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    if (m.attachment_url) html += '<img src="' + (m.attachment_url.startsWith('http') ? m.attachment_url : serverUrl + m.attachment_url) + '" onclick="window.open(this.src)" />';
    el.innerHTML = html;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
  }

  function doSend() {
    var text = input.value.trim();
    if (!text && !selectedFile) return;
    
    var doSendApi = function(base64) {
      input.value = "";
      var payload = { conversationId: convId, senderType: "visitor", message: text };
      if (base64) payload.attachmentData = base64;
      
      selectedFile = null;
      fileInput.value = "";

      fetch(serverUrl + "/api/chat/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    };

    if (selectedFile) {
      var reader = new FileReader();
      reader.onload = function() { doSendApi(reader.result); };
      reader.readAsDataURL(selectedFile);
    } else {
      doSendApi(null);
    }
  }

  attachBtn.onclick = function() { fileInput.click(); };
  fileInput.onchange = function() {
    if (this.files && this.files[0]) selectedFile = this.files[0];
  };

  bubble.onclick = function() {
    isOpen = !isOpen;
    win.classList.toggle("open", isOpen);
    if (isOpen && !convId) {
      fetch(serverUrl + "/api/chat/init", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey, visitorId: visitorId, visitorName: visitorName })
      }).then(function(r) { return r.json(); }).then(function(data) {
        convId = data.conversationId;
        data.messages.forEach(appendMsg);
        evtSource = new EventSource(serverUrl + "/api/sse/visitor/" + convId);
        evtSource.onmessage = function(e) {
          var payload = JSON.parse(e.data);
          if (payload.type === "new_message") appendMsg(payload.data);
        };
      });
    }
  };

  closeBtn.onclick = function() {
    isOpen = false;
    win.classList.remove("open");
  };

  sendBtn.onclick = doSend;
  input.addEventListener("keydown", function(e) {
    if (e.key === "Enter") { e.preventDefault(); doSend(); }
  });
})();