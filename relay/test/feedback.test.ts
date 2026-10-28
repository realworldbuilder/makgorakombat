import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { asText, authorized, FEEDBACK_PER_DAY, FEEDBACK_PER_IP, FEEDBACK_WINDOW_MS, type Feedback, type FeedbackStore, type Incoming, KEEP_FEEDBACK, KEEP_MS, MAX_BODY, MAX_FEEDBACK, readFeedback } from '../src/feedback';

const GAME = 'https://realworldbuilder.github.io';
const TOKEN = 'test-feedback-token';

let stores = 0;
/** A store of its own for each test. */
const store = () => env.FEEDBACK.getByName(`feedback-test-${++stores}`);

let addresses = 0;
/** A request's address of its own, so no test runs into another's limit. */
const address = () => `203.0.113.${++addresses}`;

const message = (more: Record<string, unknown> = {}) => ({
  text: 'The rogue feels slow to dash.',
  rating: 4,
  mode: 'online',
  fighters: ['Thrall', 'Jaina Proudmoore'],
  stage: 'Nagrand Arena',
  winner: 1,
  me: 0,
  game: 'World of Warcraft',
  build: '412 a1b2c3d',
  name: 'Chris',
  ...more,
});

const incoming = (text = 'hello'): Incoming => ({ text, mode: 'cpu', fighters: ['Thrall', 'Rexxar'] });

const post = (body: unknown, ip = address(), origin = GAME) =>
  SELF.fetch('https://relay.test/feedback', {
    method: 'POST',
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'text/plain', Origin: origin, 'CF-Connecting-IP': ip },
  });

const read = (query = '', token: string | null = TOKEN) =>
  SELF.fetch(`https://relay.test/feedback${query}`, { headers: token === null ? {} : { Authorization: `Bearer ${token}` } });

describe('a message as a page sends it', () => {
  it('is read with the fight it followed, and nothing it does not know', () => {
    expect(readFeedback(JSON.stringify(message({ extra: 'dropped', ip: '1.2.3.4' })))).toEqual({
      text: 'The rogue feels slow to dash.',
      rating: 4,
      mode: 'online',
      fighters: ['Thrall', 'Jaina Proudmoore'],
      stage: 'Nagrand Arena',
      winner: 1,
      me: 0,
      game: 'World of Warcraft',
      build: '412 a1b2c3d',
      name: 'Chris',
    });
  });

  it('needs words, a mode and the two champions; a rating is optional and one to five', () => {
    const minimal = { text: '  gg  ', mode: 'local', fighters: ['Thrall', 'Rexxar'] };
    expect(readFeedback(JSON.stringify(minimal))).toEqual({ text: 'gg', mode: 'local', fighters: ['Thrall', 'Rexxar'] });
    expect(readFeedback(JSON.stringify({ ...minimal, rating: null }))).toEqual({ text: 'gg', mode: 'local', fighters: ['Thrall', 'Rexxar'] });
    const refused = (body: unknown) => readFeedback(typeof body === 'string' ? body : JSON.stringify(body));
    expect(refused('not json')).toMatchObject({ status: 400 });
    expect(refused([1, 2])).toMatchObject({ status: 400 });
    expect(refused({ ...minimal, text: '   ' })).toMatchObject({ status: 400 });
    expect(refused({ ...minimal, mode: 'ranked' })).toMatchObject({ status: 400 });
    expect(refused({ ...minimal, fighters: ['Thrall'] })).toMatchObject({ status: 400 });
    expect(refused({ ...minimal, fighters: ['Thrall', 7] })).toMatchObject({ status: 400 });
    expect(refused({ ...minimal, rating: 6 })).toMatchObject({ status: 400 });
    expect(refused({ ...minimal, rating: 2.5 })).toMatchObject({ status: 400 });
  });

  it('is at most a thousand characters, and the request at most four kilobytes', () => {
    const ok = readFeedback(JSON.stringify(message({ text: 'x'.repeat(MAX_FEEDBACK) })));
    expect('refused' in ok).toBe(false);
    expect(readFeedback(JSON.stringify(message({ text: 'x'.repeat(MAX_FEEDBACK + 1) })))).toMatchObject({ status: 413 });
    expect(readFeedback(JSON.stringify(message({ stage: 's'.repeat(MAX_BODY) })))).toMatchObject({ status: 413 });
  });

  it('cuts the context to size and keeps a lobby name only when it is one', () => {
    const long = readFeedback(JSON.stringify(message({ stage: 's'.repeat(300), build: 'b'.repeat(100), fighters: ['t'.repeat(100), 'Rexxar'] }))) as Incoming;
    expect(long.stage).toHaveLength(80);
    expect(long.build).toHaveLength(40);
    expect(long.fighters[0]).toHaveLength(60);
    expect((readFeedback(JSON.stringify(message({ name: '<script>' }))) as Incoming).name).toBeUndefined();
    expect((readFeedback(JSON.stringify(message({ winner: 2, me: 'host' }))) as Incoming).winner).toBeUndefined();
  });
});

describe('the store', () => {
  it('keeps messages and lists them newest first, a page at a time', async () => {
    const box = store();
    for (let n = 1; n <= 5; n++) expect(await box.add(incoming(`message ${n}`), `addr-${n}`)).toMatchObject({ ok: true });
    const newest = await box.list(2);
    expect(newest.map((m) => m.text)).toEqual(['message 5', 'message 4']);
    const older = await box.list(10, newest[1]!.id);
    expect(older.map((m) => m.text)).toEqual(['message 3', 'message 2', 'message 1']);
  });

  it('takes a few from one address in ten minutes, then more once they have passed', async () => {
    const box = store();
    const now = Date.now();
    for (let n = 0; n < FEEDBACK_PER_IP; n++) expect(await box.add(incoming(), 'one', now + n)).toMatchObject({ ok: true });
    expect(await box.add(incoming(), 'one', now + 10)).toMatchObject({ ok: false, status: 429 });
    expect(await box.add(incoming(), 'another', now + 10)).toMatchObject({ ok: true });
    expect(await box.add(incoming(), 'one', now + FEEDBACK_WINDOW_MS + 10)).toMatchObject({ ok: true });
  });

  it('takes a day\'s worth from everyone together, whatever their addresses', async () => {
    const box = store();
    const now = Date.now();
    for (let n = 0; n < FEEDBACK_PER_DAY; n++) await box.add(incoming(), `addr-${n}`, now);
    expect(await box.add(incoming(), 'somebody new', now)).toMatchObject({ ok: false, status: 429 });
    expect(await box.add(incoming(), 'somebody new', now + 24 * 60 * 60 * 1000 + 1)).toMatchObject({ ok: true });
  });

  it('lets the oldest go past the ten thousandth, and any older than a year', async () => {
    const box = store();
    const now = Date.now();
    await runInDurableObject(box, (instance: FeedbackStore) => {
      const sql = (instance as unknown as { sql: SqlStorage }).sql;
      sql.exec("INSERT INTO feedback (t, text, mode, p1, p2) VALUES (?, 'too old', 'cpu', 'Thrall', 'Rexxar')", now - KEEP_MS - 1000);
      for (let n = 0; n < KEEP_FEEDBACK + 3; n++) sql.exec("INSERT INTO feedback (t, text, mode, p1, p2) VALUES (?, ?, 'cpu', 'Thrall', 'Rexxar')", now - 1000 + n, `m${n}`);
      instance.prune(now);
      expect(sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM feedback').one().n).toBe(KEEP_FEEDBACK);
      // The newest stay; the first three in and the one from over a year ago went.
      expect(sql.exec<{ text: string }>('SELECT text FROM feedback ORDER BY id LIMIT 1').one().text).toBe('m3');
    });
    expect((await box.list(1))[0]!.text).toBe(`m${KEEP_FEEDBACK + 2}`);
  });
});

describe('POST /feedback', () => {
  it('keeps a message from the game\'s page and answers nothing', async () => {
    const response = await post(message({ text: 'Loved the fatality.' }));
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(GAME);
    const { feedback } = await (await read('?limit=5')).json<{ feedback: Feedback[] }>();
    expect(feedback.find((m) => m.text === 'Loved the fatality.')).toMatchObject({ mode: 'online', fighters: ['Thrall', 'Jaina Proudmoore'], winner: 1, me: 0, rating: 4, name: 'Chris' });
  });

  it('refuses what is not a message, one too long, another page, and an address that has sent enough', async () => {
    expect((await post('nope')).status).toBe(400);
    expect((await post(message({ text: 'x'.repeat(MAX_FEEDBACK + 1) }))).status).toBe(413);
    expect((await post(message(), address(), 'https://evil.example')).status).toBe(403);
    const ip = address();
    for (let n = 0; n < FEEDBACK_PER_IP; n++) expect((await post(message({ text: `again ${n}` }), ip)).status).toBe(204);
    const limited = await post(message(), ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Access-Control-Allow-Origin')).toBe(GAME);
  });
});

describe('GET /feedback', () => {
  it('needs the token', async () => {
    expect((await read('', null)).status).toBe(401);
    expect((await read('', 'wrong')).status).toBe(401);
    expect((await read('', `${TOKEN}x`)).status).toBe(401);
    expect((await read('')).status).toBe(200);
    expect(await authorized(`Bearer ${TOKEN}`, undefined)).toBe(false);
    expect(await authorized(TOKEN, TOKEN)).toBe(false);
  });

  it('reads as text in a terminal', async () => {
    await post(message({ text: 'As text, please.', rating: 2 }));
    const response = await read('?format=text&limit=1');
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    const text = await response.text();
    expect(text).toContain('As text, please.');
    expect(text).toContain('Thrall [sender] vs Jaina Proudmoore (won)');
    expect(text).toContain('**...');
    expect(asText([])).toBe('');
  });
});
