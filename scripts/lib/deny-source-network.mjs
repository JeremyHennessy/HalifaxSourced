// Preload only in offline PR validation, never in manual/scheduled collectors.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';
let attempts = 0;
function deny() {
  attempts++;
  throw new Error('Source network access is forbidden during offline PR validation');
}
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = deny;
net.connect = net.createConnection = net.Socket.prototype.connect = deny;
syncBuiltinESMExports();
process.on('exit', () => {
  if (attempts) {
    console.error(`Offline PR validation blocked ${attempts} network attempt(s).`);
    process.exitCode = 1;
  }
});
