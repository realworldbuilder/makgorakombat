import { describe, expect, it } from 'vitest';
import { buildOf, type FeedbackFight, feedbackKey, feedbackOf, MAX_FEEDBACK, sendFeedback } from '../../src/game/feedback';
import { RELAY_URL } from '../../src/game/net/relay';

const fight: FeedbackFight = { mode: 'online', fighters: ['Thrall', 'Jaina Proudmoore'], stage: 'Nagrand Arena', winner: 1, me: 0, game: 'World of Warcraft 3.3.5' };

/** A key press as the box sees it. */
const key = (code: string, more: Partial<KeyboardEvent> = {}) => ({ code, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, repeat: false, isComposing: false, ...more });

describe('the message', () => {
  it('carries the words, the rating, the fight, the build and the lobby name', () => {
    expect(feedbackOf('  The rogue feels slow.  ', 4, fight, { build: '412 a1b2c3d', name: 'Chris' })).toEqual({
      text: 'The rogue feels slow.',
      rating: 4,
      ...fight,
      build: '412 a1b2c3d',
      name: 'Chris',
    });
  });

  it('is nothing when nothing is written, and is cut to the relay\'s limit', () => {
    expect(feedbackOf('   \n ', 5, fight)).toBeUndefined();
    expect(feedbackOf('x'.repeat(MAX_FEEDBACK + 50), undefined, fight)!.text).toHaveLength(MAX_FEEDBACK);
  });

  it('leaves out a rating that is not one to five, and a name never given', () => {
    for (const rating of [undefined, 0, 6, 2.5]) expect(feedbackOf('hi', rating, fight)).not.toHaveProperty('rating');
    expect(feedbackOf('hi', 1, fight)!.rating).toBe(1);
    expect(feedbackOf('hi', 3, fight, { name: undefined })).not.toHaveProperty('name');
  });

  it('names the build by the roster\'s version and the commit', () => {
    expect(buildOf('412', 'a1b2c3d')).toBe('412 a1b2c3d');
    expect(buildOf('', 'a1b2c3d')).toBe('a1b2c3d');
    expect(buildOf('', '')).toBe('dev');
  });
});

describe('sending it', () => {
  const message = feedbackOf('gg', 5, fight, { build: 'test' })!;

  it('posts it once to the site\'s relay as plain text', async () => {
    const calls: [string, RequestInit][] = [];
    const ok = await sendFeedback(message, {
      fetch: (async (url: string, init: RequestInit) => {
        calls.push([url, init]);
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe(`${RELAY_URL}/feedback`);
    expect(init.method).toBe('POST');
    // No Content-Type of its own: a string body goes as text/plain, which the browser sends without asking first.
    expect(init.headers).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual(message);
  });

  it('is false, and tried no more, when the relay refuses it or cannot be reached', async () => {
    let tries = 0;
    const answer = (response: () => Response) =>
      (async () => {
        tries++;
        return response();
      }) as unknown as typeof fetch;
    expect(await sendFeedback(message, { fetch: answer(() => new Response('Thanks, that is plenty for now.', { status: 429 })) })).toBe(false);
    expect(await sendFeedback(message, { fetch: answer(() => new Response('Too long.', { status: 413 })) })).toBe(false);
    expect(tries).toBe(2);
    const offline = (async () => {
      tries++;
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    expect(await sendFeedback(message, { fetch: offline })).toBe(false);
    expect(tries).toBe(3);
  });

  it('gives up on a relay that never answers', async () => {
    const hangs = ((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    const started = Date.now();
    expect(await sendFeedback(message, { fetch: hangs, timeoutMs: 50 })).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('the keys', () => {
  it('closed: a plain F opens the box, and every other key is the screen\'s', () => {
    expect(feedbackKey(key('KeyF'), false)).toBe('open');
    expect(feedbackKey(key('KeyF', { repeat: true }), false)).toBe('pass');
    expect(feedbackKey(key('KeyF', { metaKey: true }), false)).toBe('pass');
    expect(feedbackKey(key('KeyF', { ctrlKey: true }), false)).toBe('pass');
    // The rematch, the roster and the next opponent stay where they were.
    for (const code of ['Enter', 'Escape', 'KeyN', 'KeyJ', 'Space']) expect(feedbackKey(key(code), false)).toBe('pass');
  });

  it('open: Escape closes, Enter sends, and the rest type, the fighters\' keys and N among them', () => {
    expect(feedbackKey(key('Escape'), true)).toBe('close');
    expect(feedbackKey(key('Enter'), true)).toBe('send');
    expect(feedbackKey(key('NumpadEnter'), true)).toBe('send');
    expect(feedbackKey(key('Enter', { shiftKey: true }), true)).toBe('type');
    expect(feedbackKey(key('Enter', { isComposing: true }), true)).toBe('type');
    for (const code of ['KeyF', 'KeyW', 'KeyA', 'KeyD', 'KeyJ', 'KeyN', 'KeyM', 'ArrowLeft', 'Digit1', 'Space', 'Backspace']) expect(feedbackKey(key(code), true)).toBe('type');
  });
});
