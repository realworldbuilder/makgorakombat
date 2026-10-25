// A run through a deployed relay's lobby from node, as two pages would: both come in by name,
// see each other, one challenges and the other accepts, and both go into the room they are given
// and hear each other there; then the same two again by quick match, and a decline.
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

const enter = (name, id) => open(`${ws}/lobby/ws?name=${encodeURIComponent(name)}&id=${id}`);
const ids = { chris: `probe-chris-${tag}`, will: `probe-will-${tag}` };
const has = (...want) => (m) => want.every((id) => m.players.some((p) => p.id === id));

let t = performance.now();
const chris = await enter(`Chris ${tag}`, ids.chris);
const will = await enter(`Will ${tag}`, ids.will);
const here = await chris.next('here', has(ids.chris, ids.will));
console.log(`both in the lobby after ${(performance.now() - t).toFixed(0)} ms; here: ${here.players.map((p) => `${p.name} (${p.status})`).join(', ')}`);

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

t = performance.now();
will2.send({ t: 'quick' });
await will2.next('queued');
chris2.send({ t: 'quick' });
const [q1, q2] = [await will2.next('fight'), await chris2.next('fight')];
console.log(`quick match: room ${q1.code}, Will ${q1.role} (waited first), Chris ${q2.role}, ${(performance.now() - t).toFixed(0)} ms`);
await intoRoom(q1, q2);
console.log('both went into the quick match room and heard each other');
chris2.socket.close(1000, 'done');
will2.socket.close(1000, 'done');
