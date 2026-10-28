// A run through a deployed relay's lobby from node, as two pages would: both come in by name,
// see each other, one challenges and the other accepts, and both go into the room they are given
// and hear each other there; then the same two again by quick match, and a decline; then both
// back for the next opponent (requeue=1), the numbers at /lobby/stats while they are in the room.
// The queue parts are skipped when a real player is already waiting, so the probe never takes them.
//   node scripts/lobby.mjs [https://makgora-relay.<you>.workers.dev]
const base = (process.argv[2] ?? 'https://makgora-relay.clawdgross.workers.dev').replace(/\/$/, '');
const ws = base.replace(/^http/, 'ws');
const tag = Math.random().toString(36).slice(2, 8);

/** A socket and the messages it has been sent, with a way to wait for one of a kind. */
function open(url) {
  const socket = new WebSocket(url);
  const got = [];
  const waiting = [];
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string' || event.data === 'pong') return;
    got.push(JSON.parse(event.data));
    waiting.splice(0).forEach((wake) => wake());
  });
  const next = async (t, test = () => true) => {
    const deadline = Date.now() + 5000;
    for (;;) {
      const k = got.findIndex((m) => m.t === t && test(m));
      if (k >= 0) return got.splice(0, k + 1).pop();
      if (Date.now() > deadline) throw new Error(`waited for ${t}; had ${JSON.stringify(got)}`);
      await new Promise((resolve) => {
        waiting.push(resolve);
        setTimeout(resolve, 100);
      });
    }
  };
  const send = (message) => socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  return new Promise((resolve, reject) => {
    socket.onopen = () => resolve({ socket, next, send });
    socket.onerror = () => reject(new Error(`could not open ${url}`));
  });
}

const enter = (name, id, extra = '') => open(`${ws}/lobby/ws?name=${encodeURIComponent(name)}&id=${id}${extra}`);
const stats = async () => (await fetch(`${base}/lobby/stats`)).json();
const counts = (m) => `${m.online} online · ${m.waiting} waiting · ${m.fighting} fighting`;
const ids = { chris: `probe-chris-${tag}`, will: `probe-will-${tag}` };
const has = (...want) => (m) => want.every((id) => m.players.some((p) => p.id === id));

let t = performance.now();
const chris = await enter(`Chris ${tag}`, ids.chris);
const will = await enter(`Will ${tag}`, ids.will);
const here = await chris.next('here', has(ids.chris, ids.will));
console.log(`both in the lobby after ${(performance.now() - t).toFixed(0)} ms; here: ${here.players.map((p) => `${p.name} (${p.status})`).join(', ')}; ${counts(here)}`);

async function intoRoom(fightA, fightB) {
  if (fightA.code !== fightB.code) throw new Error('two codes');
  const room = (role) => open(`${ws}/rooms/${fightA.code}/ws?role=${role}`);
  const [host, guest] = fightA.role === 'host' ? [await room('host'), await room('guest')] : [await room('guest'), await room('host')];
  await host.next('peer');
  await guest.next('peer');
  host.send({ t: 'meet', version: 'probe' });
  const met = await guest.next('meet');
  host.socket.close(1000, 'done');
  guest.socket.close(1000, 'done');
  return met;
}

t = performance.now();
chris.send({ t: 'challenge', to: ids.will });
const challenged = await will.next('challenged');
console.log(`Will is challenged by ${challenged.from.name} after ${(performance.now() - t).toFixed(0)} ms, ${challenged.ttl / 1000} s to answer`);
will.send({ t: 'accept', from: ids.chris });
const [a, b] = [await chris.next('fight'), await will.next('fight')];
console.log(`accepted: room ${a.code}, Chris ${a.role}, Will ${b.role}, ${(performance.now() - t).toFixed(0)} ms from the challenge`);
const busy = await chris.next('here', (m) => m.players.filter((p) => p.id === ids.chris || p.id === ids.will).every((p) => p.status === 'busy'));
console.log(`both busy in the list (${busy.players.length} here)`);
await intoRoom(a, b);
console.log('both went into the room and heard each other');

// Back from the fight: the lobby sockets come again, free.
chris.socket.close(1000, 'fight');
will.socket.close(1000, 'fight');
const chris2 = await enter(`Chris ${tag}`, ids.chris);
const will2 = await enter(`Will ${tag}`, ids.will);
await chris2.next('here', (m) => has(ids.chris, ids.will)(m) && m.players.filter((p) => p.id === ids.chris || p.id === ids.will).every((p) => p.status === 'free'));
console.log('back in the lobby, both free');

chris2.send({ t: 'challenge', to: ids.will });
await will2.next('challenged');
will2.send({ t: 'decline', from: ids.chris });
const declined = await chris2.next('declined');
console.log(`a second challenge declined: ${declined.reason}`);

const before = await stats();
console.log(`GET /lobby/stats: ${counts(before)}`);
if (before.waiting > 0) {
  console.log('somebody real is in the queue: the quick match and the requeue are left out');
  chris2.socket.close(1000, 'done');
  will2.socket.close(1000, 'done');
  process.exit(0);
}

t = performance.now();
will2.send({ t: 'quick' });
await will2.next('queued');
const waiting = await chris2.next('here', (m) => m.waiting >= 1);
console.log(`Will in the queue: ${counts(waiting)}`);
chris2.send({ t: 'quick' });
const [q1, q2] = [await will2.next('fight'), await chris2.next('fight')];
console.log(`quick match: room ${q1.code}, Will ${q1.role} (waited first), Chris ${q2.role}, ${(performance.now() - t).toFixed(0)} ms`);
await intoRoom(q1, q2);
console.log('both went into the quick match room and heard each other');

// NEXT OPPONENT: back from the match asking for the queue again; the first waits, the second is matched at once.
chris2.socket.close(1000, 'fight');
will2.socket.close(1000, 'fight');
t = performance.now();
const chris3 = await enter(`Chris ${tag}`, ids.chris, '&busy=0&requeue=1');
await chris3.next('queued');
console.log(`Chris back with requeue=1: in the queue after ${(performance.now() - t).toFixed(0)} ms`);
const will3 = await enter(`Will ${tag}`, ids.will, '&busy=0&requeue=1');
const [r1, r2] = [await chris3.next('fight'), await will3.next('fight')];
console.log(`Will back with requeue=1: matched with ${r2.with.name} at once, room ${r1.code}, Chris ${r1.role}, ${(performance.now() - t).toFixed(0)} ms`);
const room = (role) => open(`${ws}/rooms/${r1.code}/ws?role=${role}`);
const [host, guest] = [await room('host'), await room('guest')];
await host.next('peer');
let during = await stats();
for (let tries = 0; during.fighting < 2 && tries < 10; tries++) during = await stats();
console.log(`both in the room: ${counts(during)}`);
if (during.fighting < 2) throw new Error('the room was not counted as a fight');
host.socket.close(1000, 'done');
guest.socket.close(1000, 'done');
chris3.socket.close(1000, 'done');
will3.socket.close(1000, 'done');
