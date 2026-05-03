import {
  open,
  Protocol,
  SimConnectDataType,
  SimConnectPeriod,
} from 'node-simconnect';
import type { SimFrame } from './types';
import type { FlightManager } from './flightManager';

const RECONNECT_DELAY_MS = 5000;

const DEF_FLIGHT_DATA = 0;
const REQ_FLIGHT_DATA = 0;

// ClientEventId is number in v4
const EVT_SIM          = 0;
const EVT_PAUSED       = 1;
const EVT_UNPAUSED     = 2;
const EVT_CRASHED      = 3;
const EVT_FLIGHT_LOADED = 4;

// ObjectId.USER = 0 (it's a plain number type alias in v4)
const OBJECT_USER = 0;

export function startSimConnect(flightManager: FlightManager): void {
  const host = process.env.SIMCONNECT_HOST;
  const port = process.env.SIMCONNECT_PORT ? parseInt(process.env.SIMCONNECT_PORT, 10) : undefined;
  const options = host && port ? { remote: { host, port } } : undefined;

  const tryConnect = async () => {
    try {
      console.log('[SimConnect] Connecting...');
      // Protocol.SunRise targets MSFS 2024
      const { recvOpen, handle } = await open('msfslogger', Protocol.SunRise, options);
      console.log(`[SimConnect] Connected — ${recvOpen.applicationName} ${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}`);

      flightManager.appState.connected = true;

      // Data definition — read order below must match registration order exactly
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'PLANE LATITUDE',             'degrees',          SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'PLANE LONGITUDE',            'degrees',          SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'PLANE ALTITUDE',             'feet',             SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'AIRSPEED INDICATED',         'knots',            SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'GROUND VELOCITY',            'knots',            SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'PLANE HEADING DEGREES TRUE', 'degrees',          SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'VERTICAL SPEED',             'feet per minute',  SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'SIM ON GROUND',              'bool',             SimConnectDataType.INT32);
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'IS SLEW ACTIVE',             'bool',             SimConnectDataType.INT32);
      handle.addToDataDefinition(DEF_FLIGHT_DATA, 'TITLE',                      null,               SimConnectDataType.STRING256);

      handle.requestDataOnSimObject(
        REQ_FLIGHT_DATA,
        DEF_FLIGHT_DATA,
        OBJECT_USER,
        SimConnectPeriod.SECOND
      );

      handle.subscribeToSystemEvent(EVT_SIM,           'Sim');
      handle.subscribeToSystemEvent(EVT_PAUSED,        'Paused');
      handle.subscribeToSystemEvent(EVT_UNPAUSED,      'Unpaused');
      handle.subscribeToSystemEvent(EVT_CRASHED,       'Crashed');
      handle.subscribeToSystemEvent(EVT_FLIGHT_LOADED, 'FlightLoaded');

      handle.on('simObjectData', ({ requestID, data }) => {
        if (requestID !== REQ_FLIGHT_DATA) return;

        const lat              = data.readFloat64();
        const lon              = data.readFloat64();
        const altitudeFt       = data.readFloat64();
        const airspeedKnots    = data.readFloat64();
        const groundSpeedKnots = data.readFloat64();
        const headingDeg       = data.readFloat64();
        const verticalSpeedFpm = data.readFloat64();
        const onGround         = data.readInt32() !== 0;
        const isSlew           = data.readInt32() !== 0;
        const aircraft         = data.readString256() ?? 'Unknown';

        const frame: SimFrame = {
          lat,
          lon,
          altitudeFt,
          airspeedKnots,
          groundSpeedKnots,
          headingDeg,
          verticalSpeedFpm,
          onGround,
          simRunning: isSlew ? 3 : 2,
          aircraft,
        };

        flightManager.onFrame(frame);
      });

      handle.on('event', ({ clientEventId }) => {
        switch (clientEventId) {
          case EVT_PAUSED:
            flightManager.setPaused(true);
            break;
          case EVT_UNPAUSED:
            flightManager.setPaused(false);
            break;
          case EVT_CRASHED:
            console.log('[SimConnect] Crash detected');
            flightManager.onCrash();
            break;
          case EVT_FLIGHT_LOADED:
            console.log('[SimConnect] Flight loaded');
            break;
        }
      });

      const handleDisconnect = () => {
        console.log('[SimConnect] Disconnected — retrying in 5s...');
        flightManager.appState.connected = false;
        flightManager.onSimDisconnect();
        setTimeout(tryConnect, RECONNECT_DELAY_MS);
      };

      handle.on('quit', handleDisconnect);
      handle.on('close', handleDisconnect);
      handle.on('error', (err: Error) => {
        console.error('[SimConnect] Error:', err.message);
      });

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[SimConnect] Could not connect (${msg}) — retrying in 5s...`);
      flightManager.appState.connected = false;
      setTimeout(tryConnect, RECONNECT_DELAY_MS);
    }
  };

  tryConnect();
}
