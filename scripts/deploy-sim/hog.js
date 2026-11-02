// Stand-in for the box's other pm2 apps (SuperConnections and friends): holds HOG_MB of
// incompressible, touched memory and idles. The buffers hang off globalThis because an
// unreferenced array is garbage-collected, and the "pressure" silently disappears.
const crypto = require('node:crypto');
const mb = parseInt(process.env.HOG_MB || '200', 10);
const bufs = [];
for (let i = 0; i < mb; i++) { const b = Buffer.allocUnsafe(1 << 20); crypto.randomFillSync(b); bufs.push(b); }
globalThis.bufs = bufs;
console.log(`hog holding ${mb}MB`);
setInterval(() => { globalThis.keep = bufs.length; }, 1 << 30);
