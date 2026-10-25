// A run against a deployed relay from node: makes a room, joins it as host and guest, and times
// the wire. "ping" is answered by the room itself (this machine to the room and back); an echo
// goes host to guest and back through the room, the path a frame of the fight takes twice.
//   node scripts/probe.mjs [https://makgora-relay.<you>.workers.dev] [rounds]
const base = (process.argv[2] ?? 'https://makgora-relay.clawdgross.workers.dev').replace(/\/$/, '');
const rounds = Number(process.argv[3] ?? 50);

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))];

function open(code, role) {
  const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/rooms/${code}/ws?role=${role}`);
  ws.binaryType = 'arraybuffer';
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onerror = (event) => reject(new Error(`${role}: ${event.message ?? 'could not connect'}`));
  });
}

const next = (ws, test = () => true) =>
  new Promise((resolve) => {
    const on = (event) => {
      if (!test(event.data)) return;
      ws.removeEventListener('message', on);
      resolve(event.data);
    };
    ws.addEventListener('message', on);
  });

let t = performance.now();
const made = await fetch(`${base}/rooms`, { method: 'POST' });
if (!made.ok) throw new Error(`POST /rooms: ${made.status} ${await made.text()}`);
const { code } = await made.json();
console.log(`room ${code} in ${(performance.now() - t).toFixed(0)} ms`);

t = performance.now();
const host = await open(code, 'host');
const joined = next(host, (d) => typeof d === 'string' && d.includes('"peer"'));
const guest = await open(code, 'guest');
console.log(`both in, peer said ${await joined} after ${(performance.now() - t).toFixed(0)} ms`);

// The guest sends back whatever it is sent.
guest.addEventListener('message', (event) => {
  if (event.data !== 'pong') guest.send(event.data);
});

const pings = [];
const echoes = [];
for (let k = 0; k < rounds; k++) {
  t = performance.now();
  host.send('ping');
  await next(host, (d) => d === 'pong');
  pings.push(performance.now() - t);
  const frame = new Uint8Array([1, k & 255, 0, 0, 0, 1, 0b1011]);
  t = performance.now();
  host.send(frame);
  const back = new Uint8Array(await next(host, (d) => typeof d !== 'string'));
  if (back[1] !== (k & 255)) throw new Error('the echo came back changed');
  echoes.push(performance.now() - t);
}
const left = next(host, (d) => typeof d === 'string' && d.includes('"joined":false'));
guest.close(1000, 'done');
console.log(`guest left, host told: ${await left}`);
host.close(1000, 'done');

const ms = (x) => `${x.toFixed(1)} ms`;
console.log(`ping (here to the room and back), ${rounds} rounds: median ${ms(median(pings))}, p90 ${ms(pct(pings, 0.9))}`);
console.log(`echo (host to guest and back through the room): median ${ms(median(echoes))}, p90 ${ms(pct(echoes, 0.9))}`);
console.log(`one way, host to guest, about ${ms(median(echoes) / 2)}; the input delay of 4 ticks covers 66.7 ms`);
