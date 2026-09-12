// The single seam between the panel and the desktop shell.
//
// Nothing else in the UI may mention Tauri: every other module talks to the
// object exported here. That is what lets the whole panel run in a plain
// browser — and in headless Chromium for screenshots — with no shell at all.
// When no Tauri host is found we build a stub with the same method names and
// publish it as `window.__FMC_STUB__` so a test harness can feed status
// messages in and read every call back out. The stub is not a dev-only
// branch to be stripped: if the panel cannot find a host, showing a working
// panel that says so beats showing nothing.

/** Command names on the Rust side. Renaming one here breaks the shell. */
const COMMANDS = {
  configGet: 'config_get',
  configSet: 'config_set',
  configPath: 'config_path',
  uplinkStart: 'uplink_start',
  uplinkStop: 'uplink_stop',
  sidecarRestart: 'sidecar_restart',
  statusGet: 'status_get',
};

/** Event names the shell emits into the webview. */
const EVENTS = {
  status: 'sidecar:status',
  log: 'sidecar:log',
  exit: 'sidecar:exit',
};

const DEFAULT_STUB_PATH = 'C:\\Users\\<you>\\AppData\\Roaming\\msfslogger\\config.json';

function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

// ── Real bridge ──────────────────────────────────────────────────────────────

function findHost() {
  const globalApi = typeof window !== 'undefined' ? window.__TAURI__ : undefined;
  const internals = typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : undefined;
  if (!globalApi && !internals) return null;

  // Preferred path: the shell exposes the JS API globally.
  if (globalApi && globalApi.core && typeof globalApi.core.invoke === 'function') {
    const listen = globalApi.event && globalApi.event.listen;
    return {
      invoke: (cmd, args) => globalApi.core.invoke(cmd, args),
      listen:
        typeof listen === 'function'
          ? (name, handler) => listen(name, handler)
          : listenViaInternals(internals),
    };
  }

  // Fallback: only the internals are injected. Events then go through the
  // event plugin directly, which is what the global API does anyway.
  if (internals && typeof internals.invoke === 'function') {
    return {
      invoke: (cmd, args) => internals.invoke(cmd, args),
      listen: listenViaInternals(internals),
    };
  }

  return null;
}

function listenViaInternals(internals) {
  if (!internals || typeof internals.invoke !== 'function' || typeof internals.transformCallback !== 'function') {
    // A host we cannot subscribe to: commands still work, events never fire.
    // Better a panel that only misses live updates than one that throws.
    return async () => () => {};
  }
  return async (name, handler) => {
    const callbackId = internals.transformCallback((event) => {
      handler(event && typeof event === 'object' && 'payload' in event ? event : { payload: event });
    });
    const eventId = await internals.invoke('plugin:event|listen', { event: name, target: { kind: 'Any' }, handler: callbackId });
    return async () => {
      await internals.invoke('plugin:event|unlisten', { event: name, eventId });
    };
  };
}

function createTauriBridge(host) {
  // Unsubscribing is async on the Tauri side; callers get a plain function
  // that starts the teardown and cannot throw at them.
  const subscribe = (eventName, fn) => {
    let unlisten = null;
    let cancelled = false;
    host
      .listen(eventName, (event) => {
        if (!cancelled) fn(event && event.payload !== undefined ? event.payload : event);
      })
      .then((off) => {
        if (cancelled && typeof off === 'function') off();
        else unlisten = off;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (typeof unlisten === 'function') unlisten();
      unlisten = null;
    };
  };

  return {
    isStub: false,
    getConfig: () => host.invoke(COMMANDS.configGet),
    setConfig: (patch) => host.invoke(COMMANDS.configSet, { patch }),
    getConfigPath: () => host.invoke(COMMANDS.configPath),
    startUplink: () => host.invoke(COMMANDS.uplinkStart),
    stopUplink: () => host.invoke(COMMANDS.uplinkStop),
    restartSidecar: () => host.invoke(COMMANDS.sidecarRestart),
    getStatus: () => host.invoke(COMMANDS.statusGet),
    onStatus: (fn) => subscribe(EVENTS.status, fn),
    onLog: (fn) => subscribe(EVENTS.log, fn),
    onExit: (fn) => subscribe(EVENTS.exit, fn),
  };
}

// ── Stub bridge ──────────────────────────────────────────────────────────────

function createStubBridge() {
  const listeners = { status: new Set(), log: new Set(), exit: new Set() };

  const stub = {
    isStub: true,
    config: {
      exists: true,
      path: DEFAULT_STUB_PATH,
      config: {
        version: 1,
        serverUrl: 'https://192.168.0.30:3000',
        certPath: 'C:\\msfslogger\\msfslogger-cert.pem',
        trafficEnabled: true,
        trafficRadiusM: 40000,
        sim: '2020',
        autoUplink: false,
        nodePath: null,
        tokenSet: true,
      },
      raw: {
        version: 1,
        serverUrl: 'https://192.168.0.30:3000',
        certPath: 'C:\\msfslogger\\msfslogger-cert.pem',
        trafficEnabled: true,
        trafficRadiusM: 40000,
        sim: '2020',
        autoUplink: false,
        nodePath: null,
        tokenSet: true,
      },
    },
    status: null,
    calls: [],
    setConfigResult: { ok: true, path: DEFAULT_STUB_PATH },
    emitStatus(status) {
      stub.status = status;
      for (const fn of listeners.status) fn(status);
    },
    emitLog(log) {
      for (const fn of listeners.log) fn(log);
    },
    emitExit(payload) {
      for (const fn of listeners.exit) fn(payload);
    },
  };

  const record = (method, args) => {
    stub.calls.push({ method, args, at: Date.now() });
  };

  const subscribe = (set, fn) => {
    set.add(fn);
    return () => set.delete(fn);
  };

  const bridge = {
    isStub: true,
    async getConfig() {
      record('getConfig', []);
      return clone(stub.config);
    },
    async setConfig(patch) {
      record('setConfig', [clone(patch)]);
      const result = stub.setConfigResult;
      if (result?.ok === true) {
        const { ingestToken, ...safe } = patch;
        const config = { ...stub.config?.config, ...safe };
        if (typeof ingestToken === 'string') config.tokenSet = Boolean(ingestToken.trim());
        stub.config = { exists: true, path: result.path || DEFAULT_STUB_PATH, config, raw: clone(config) };
      }
      return clone(result);
    },
    async getConfigPath() {
      record('getConfigPath', []);
      return stub.config ? stub.config.path : DEFAULT_STUB_PATH;
    },
    async startUplink() {
      record('startUplink', []);
      return null;
    },
    async stopUplink() {
      record('stopUplink', []);
      return null;
    },
    async restartSidecar() {
      record('restartSidecar', []);
      return null;
    },
    async getStatus() {
      record('getStatus', []);
      return clone(stub.status);
    },
    onStatus(fn) {
      record('onStatus', []);
      return subscribe(listeners.status, fn);
    },
    onLog(fn) {
      record('onLog', []);
      return subscribe(listeners.log, fn);
    },
    onExit(fn) {
      record('onExit', []);
      return subscribe(listeners.exit, fn);
    },
  };

  if (typeof window !== 'undefined') window.__FMC_STUB__ = stub;
  return bridge;
}

const host = findHost();

export const bridge = host ? createTauriBridge(host) : createStubBridge();

export const TAURI_COMMANDS = COMMANDS;
export const TAURI_EVENTS = EVENTS;

export default bridge;
