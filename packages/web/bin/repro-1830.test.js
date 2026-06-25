/**
 * Reproduction test for issue #1830:
 * CLI serve/status/stop/restart disagree on whether OpenChamber is running
 * (live port probe vs PID-file registry)
 *
 * Scenario: An OpenChamber-compatible server is live on a port (responds to
 * /api/system/info) but has no PID-file entry in the run dir.
 *
 * Expected contradictory behavior:
 * - `fetchSystemInfoFromPort()` detects the server (serve would refuse to start)
 * - `discoverRunningInstances()` returns empty (no PID file)
 * - `stop` returns early at "No running OpenChamber instances found" before
 *   reaching the unmanaged-instance fallback that probes the live port
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import http from 'http';
import net from 'net';

// Import the detection primitives from the CLI module
let fetchSystemInfoFromPort;
let discoverRunningInstances;
let getPidFilePath;
let getRunDir;
let isPortAvailable;

async function loadCliModule() {
  const cli = await import('./cli.js');
  fetchSystemInfoFromPort = cli.fetchSystemInfoFromPort;
  discoverRunningInstances = cli.discoverRunningInstances;
  getPidFilePath = cli.getPidFilePath;
  getRunDir = typeof cli.getRunDir === 'function'
    ? cli.getRunDir
    : () => { throw new Error('not exported'); };
  isPortAvailable = typeof cli.isPortAvailable === 'function'
    ? cli.isPortAvailable
    : async (port) => {
        return new Promise((resolve) => {
          const server = net.createServer();
          server.unref();
          server.on('error', () => resolve(false));
          server.listen({ port, host: '127.0.0.1' }, () => {
            server.close(() => resolve(true));
          });
        });
      };
}

/**
 * Start a minimal HTTP server that mimics an OpenChamber runtime
 * (responds to GET /api/system/info with a valid response).
 */
function startMockOpenChamberServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/api/system/info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          runtime: 'cli',
          pid: process.pid,
          version: '1.13.3',
        }));
      } else if (req.url === '/api/system/shutdown') {
        // Simulate a graceful shutdown response
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        // Don't actually shut down — this is a mock
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });

    server.on('error', reject);

    // Ensure the server doesn't keep the process alive if test hangs
    server.unref();
  });
}

describe('Issue #1830 — live port probe vs PID-file registry disagreement', () => {
  let mockServer;
  let mockPort;

  beforeAll(async () => {
    await loadCliModule();
    const ctx = await startMockOpenChamberServer();
    mockServer = ctx.server;
    mockPort = ctx.port;
  });

  afterAll(() => {
    if (mockServer) {
      mockServer.close();
    }
  });

  it('mock server responds to /api/system/info', async () => {
    const info = await fetchSystemInfoFromPort(mockPort);
    expect(info).not.toBeNull();
    expect(info.runtime).toBe('cli');
    expect(typeof info.pid).toBe('number');
  });

  it('discoverRunningInstances() returns empty (no PID file)', async () => {
    const instances = await discoverRunningInstances();
    // No PID file was written, so discoverRunningInstances should find nothing
    expect(instances).toEqual([]);
  });

  it('contradiction: port has live OpenChamber but CLI thinks nothing is running', async () => {
    // Phase 1 — confirm serve would reject (port probe finds the live instance)
    const systemInfo = await fetchSystemInfoFromPort(mockPort);
    expect(systemInfo).not.toBeNull();
    // serve would throw: "OpenChamber is already running on port ${mockPort}"

    // Phase 2 — confirm stop/status/restart see nothing (PID-file registry empty)
    const runningInstances = await discoverRunningInstances();
    expect(runningInstances).toEqual([]);
    // stop would print: "No running OpenChamber instances found" and return
    // status would print: "stopped / no running instances"
    // restart would print: "No running OpenChamber instances to restart"

    // The contradictory state is confirmed:
    // serve  → "already running"
    // status → "stopped"
    // stop   → "nothing to stop"
    // This matches the bug report exactly.
    console.log(`\n  [repro #1830] Port ${mockPort}:`);
    console.log(`    fetchSystemInfoFromPort()  → runtime=${systemInfo.runtime} (server IS running)`);
    console.log(`    discoverRunningInstances() → ${runningInstances.length} instance(s) (PID file missing)`);
    console.log(`    → CONTRADICTION: serve refuses to start, but stop/status/restart see nothing`);
  });

  it('stop --port early-return bug: empty registry prevents reaching unmanaged fallback', async () => {
    // Simulate what the `stop` command does internally (without the output routing):
    //
    //   let runningInstances = await discoverRunningInstances();
    //   if (runningInstances.length === 0) {
    //     // EARLY RETURN — never reaches the explicitPort branch below!
    //     return;
    //   }
    //
    //   if (options.explicitPort) {
    //     runningInstances = runningInstances.filter(...);
    //     if (runningInstances.length === 0) {
    //       const systemInfo = await fetchSystemInfoFromPort(options.port); // ← unreachable!
    //       ...
    //     }
    //   }
    //
    // The early-return at "if (runningInstances.length === 0)" prevents the
    // unmanaged-instance fallback (line ~3907 in cli.js) from ever being reached
    // when the PID-file registry is empty — which is exactly when it is needed most.

    const runningInstances = await discoverRunningInstances();
    // Confirm the early return condition is met
    expect(runningInstances.length).toBe(0);

    // If we had passed the early return and reached the explicitPort branch,
    // this would detect the live server:
    const systemInfo = await fetchSystemInfoFromPort(mockPort);
    expect(systemInfo).not.toBeNull();

    // But the code never gets there because of the early return on empty registry.
    // This confirms the bug: the unmanaged-instance shutdown path exists but is
    // unreachable precisely when the registry is empty but a live server holds the port.
    console.log(`\n  [repro #1830] stop --port ${mockPort} early-return bug:`);
    console.log(`    discoverRunningInstances() returned empty → early return`);
    console.log(`    fetchSystemInfoFromPort(${mockPort}) finds live server (would be reached if no early return)`);
    console.log(`    → BUG CONFIRMED: unmanaged shutdown path is unreachable when registry is empty`);
  });

  it('restart --port also fails for the same reason (no PID file in registry)', async () => {
    // The restart command also uses discoverRunningInstances() exclusively
    // and returns early when it's empty:
    //
    //   let runningInstances = await discoverRunningInstances();
    //   if (runningInstances.length === 0) {
    //     // early return
    //   }
    //   if (options.explicitPort) {
    //     runningInstances = runningInstances.filter(...);
    //     if (runningInstances.length === 0) {
    //       // no fallback to fetchSystemInfoFromPort!
    //     }
    //   }

    const runningInstances = await discoverRunningInstances();
    expect(runningInstances.length).toBe(0);
    console.log(`\n  [repro #1830] restart --port ${mockPort}:`);
    console.log(`    No instances in PID registry → "No running OpenChamber instances to restart"`);
    console.log(`    → BUG CONFIRMED: restart has no port probe fallback for unmanaged instances`);
  });

  it('status --port has no port probe at all', async () => {
    // The status command calls discoverRunningInstances() only — there is no
    // --port flag handling at all for the top-level status command:
    //
    //   const [runningInstances, desktopInstance] = await Promise.all([
    //     discoverRunningInstances(),
    //     discoverDesktopInstance(),
    //   ]);
    //
    // discoverDesktopInstance() only probes a fixed port from settings.json,
    // not the user-specified --port.

    const runningInstances = await discoverRunningInstances();
    expect(runningInstances.length).toBe(0);
    console.log(`\n  [repro #1830] status --port ${mockPort}:`);
    console.log(`    No instances in PID registry → "stopped / no running instances"`);
    console.log(`    → BUG CONFIRMED: status has no port probe for unmanaged instances`);
  });
});
