=== node --check ===
SYNTAX_OK

=== backoff sequence check ===
5000,10000,20000,40000,60000,60000,60000,60000
MATCH

=== git diff ===
diff --git a/agent/README.md b/agent/README.md
index c9b1f72..80ea8d9 100644
--- a/agent/README.md
+++ b/agent/README.md
@@ -32,7 +32,7 @@ This is the supported way to connect a remote server to MSFS. The alternative 
    ```
    and the server's `/api/status` / web UI should show `connected: true`.
 
-Leave this running in the background whenever you want flights logged. It reconnects automatically if MSFS restarts, and retries the server if it's briefly unreachable.
+Leave this running in the background whenever you want flights logged. It reconnects automatically if MSFS restarts, and retries the server if it's briefly unreachable — retries back off from 5s up to a 60s cap so a prolonged outage doesn't hammer SimConnect.
 
 ## Pause handling
 
diff --git a/agent/agent.js b/agent/agent.js
index 2294bf5..b05dff9 100644
--- a/agent/agent.js
+++ b/agent/agent.js
@@ -55,7 +55,12 @@ function resolveSimProtocol(argv) {
 
 const SIM_PROTOCOL = resolveSimProtocol(process.argv.slice(2));
 
-const RECONNECT_DELAY_MS = 5000;
+// Reconnect backoff — capped exponential, starting at the base delay and
+// doubling on each consecutive failure up to the max (5s, 10s, 20s, 40s,
+// 60s, 60s, ...). reconnectAttempt/reconnectScheduled live with the other
+// module-level state below.
+const RECONNECT_BASE_DELAY_MS = 5000;
+const RECONNECT_MAX_DELAY_MS = 60000;
 
 const DEF_FLIGHT_DATA = 0;
 const REQ_FLIGHT_DATA = 0;
@@ -80,6 +85,14 @@ let userLon = null;
 let lastSweepAt = 0;
 let sweepBuffer = [];
 
+// Reconnect backoff state — reconnectAttempt counts consecutive failures
+// since the last successful connect (reset to 0 on recvOpen) and drives
+// nextReconnectDelayMs(); reconnectScheduled guards against scheduling more
+// than one pending reconnect timer when SimConnect fires multiple
+// disconnect-ish events (quit/close/error) for the same drop.
+let reconnectAttempt = 0;
+let reconnectScheduled = false;
+
 /**
  * MSFS `Pause_EX1` bitmask (from the SimConnect SDK). The legacy Paused /
  * Unpaused events do NOT fire for Active Pause, which is why this event exists
@@ -141,7 +154,26 @@ function postTrafficBatch(objects) {
   return postJson('/api/ingest/traffic', { objects });
 }
 
+function nextReconnectDelayMs(attempt) {
+  return Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
+}
+
+// Schedules the next tryConnect() at the current backoff delay, unless one
+// is already pending (see reconnectScheduled above). Bumps reconnectAttempt
+// so the delay doubles next time; tryConnect() clears the guard when the
+// attempt actually starts, and resets reconnectAttempt back to 0 once it
+// succeeds.
+function scheduleReconnect(reason) {
+  if (reconnectScheduled) return;
+  reconnectScheduled = true;
+  const delayMs = nextReconnectDelayMs(reconnectAttempt);
+  reconnectAttempt++;
+  console.log(`[Agent] ${reason} — retrying in ${delayMs / 1000}s (attempt ${reconnectAttempt})...`);
+  setTimeout(tryConnect, delayMs);
+}
+
 async function tryConnect() {
+  reconnectScheduled = false;
   try {
     console.log(`[Agent] Connecting to SimConnect (${SIM_PROTOCOL.name})...`);
     // Protocol is chosen by the --sim/-s CLI flag, resolved above (default
@@ -151,6 +183,10 @@ async function tryConnect() {
     const { recvOpen, handle } = await open('msfslogger-agent', SIM_PROTOCOL.protocol);
     console.log(`[Agent] Connected to SimConnect — ${recvOpen.applicationName} ${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}`);
 
+    // A successful open()+recvOpen means this disconnect episode is over —
+    // the next one (unrelated) starts its backoff from the base delay again.
+    reconnectAttempt = 0;
+
     await sendEvent('connected');
 
     // Data definition — read order below must match registration order exactly
@@ -277,20 +313,23 @@ async function tryConnect() {
     });
 
     const handleDisconnect = () => {
-      console.log('[Agent] SimConnect disconnected — retrying in 5s...');
       sendEvent('disconnected');
-      setTimeout(tryConnect, RECONNECT_DELAY_MS);
+      scheduleReconnect('SimConnect disconnected');
     };
 
     handle.on('quit', handleDisconnect);
     handle.on('close', handleDisconnect);
     handle.on('error', (err) => {
+      // node-simconnect / SimConnect commonly fire 'error' alongside
+      // 'quit'/'close' for the same underlying drop — scheduleReconnect's
+      // reconnectScheduled guard keeps this from double-scheduling.
       console.error('[Agent] SimConnect error:', err.message);
+      sendEvent('disconnected');
+      scheduleReconnect('SimConnect error');
     });
   } catch (err) {
     const msg = err instanceof Error ? err.message : String(err);
-    console.log(`[Agent] Could not connect to SimConnect (${msg}) — retrying in 5s...`);
-    setTimeout(tryConnect, RECONNECT_DELAY_MS);
+    scheduleReconnect(`Could not connect to SimConnect (${msg})`);
   }
 }
 
