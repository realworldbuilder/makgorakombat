# makgora-relay

The wire between two players of MAK'GORA KOMBAT online. It is a Cloudflare Worker with one
Durable Object per room; a room is a six-letter code of consonants (no vowels, no L or Y), holds
at most one host and one guest, and passes every message one of them sends to the other exactly
as it came, text or bytes. It reads none of it and keeps none of it: both machines run the fight
themselves in lockstep, each from its own World of Warcraft folder, and the relay only carries
their inputs between them. A room nobody has been in for ten minutes is forgotten.

Before the room there is the lobby, one Durable Object for everyone, where players find each
other by name: one challenges another, or both ask for a quick match, and the lobby makes the
room and tells each of them its code and whether they host. Nobody reads a code out.

## The lobby

- `GET /lobby/ws?name=<name>&id=<id>` upgrades to a WebSocket; while it is open the player is
  here. A name is 2 to 16 letters, digits and spaces; the id is a random one the page makes once
  and keeps, so a reload or a second tab takes the old place instead of making a second player.
  `&busy=1` is a page in an online match coming back between fights.
- Everyone hears `{"t":"here","players":[{"id","name","status":"free"|"busy"}]}` whenever
  somebody comes, goes or starts a match, and every 20 seconds besides.
- `{"t":"challenge","to":id}`: the other player hears `{"t":"challenged","from":{id,name},"ttl":30000}`
  and the challenger `{"t":"challenging","to":{id,name},"ttl":30000}`. One open challenge at a
  time each way; challenging somebody busy, or somebody already answering one, is an
  `{"t":"error","message"}`.
- The one challenged answers `{"t":"accept","from":id}` or `{"t":"decline","from":id}`; the
  challenger may take it back with `{"t":"cancel","to":id}`. Unanswered, it lapses after 30
  seconds. When one ends without a match the challenger hears `{"t":"declined","by":id,"reason"}`
  and the one challenged `{"t":"withdrawn","from":id,"reason"}`, the reason being `declined`,
  `cancelled`, `timeout`, `left` or `busy`.
- `{"t":"quick"}` pairs the sender with the player who has waited longest for a quick match, or
  puts them in line (`{"t":"queued"}`); `{"t":"unquick"}` leaves it (`{"t":"unqueued"}`).
- A match: the lobby makes a room as `POST /rooms` would and tells both
  `{"t":"fight","code","role":"host"|"guest","with":{id,name}}`. The challenger hosts, or in a
  quick match the one who waited longer. Both are busy until their lobby sockets come back.
- `ping` is answered `pong`, as in a room.

## The room

- `POST /rooms` makes a room and answers `{"code":"HXBXDC"}`.
- `GET /rooms/:code/ws?role=host|guest` upgrades to a WebSocket. A code nobody made is 404, a
  second host or guest is 409.
- When the other player is in the room (on joining, or when they arrive) the relay sends
  `{"t":"peer","joined":true}`; when they leave, `{"t":"peer","joined":false}`.
- `ping` is answered `pong` by the room itself without waking it: a keep-alive, and a way to
  time the wire.
- Every other message goes to the other player unchanged.

Pages on `https://realworldbuilder.github.io`, `https://makgora.clawdioslave.com` and `http://localhost:*` (or `127.0.0.1`) may use
it; other sites are refused. Node and other clients that send no `Origin` are let in.

## Your own relay

The game uses Chris's deploy, `https://makgora-relay.clawdgross.workers.dev`, unless SETTINGS
on the title names another (NETWORK, remembered in the browser as `makgora.relay`). To run your
own on your Cloudflare account (the free plan is enough):

```sh
cd relay
pnpm install
pnpm exec wrangler login
pnpm run deploy
```

It needs no secrets, no storage of its own and no custom domain; wrangler prints the
`https://makgora-relay.<your-subdomain>.workers.dev` address to put in SETTINGS. Both players
must use the same relay.

## Working on it

- `pnpm test` runs the room's and the lobby's tests inside the Workers runtime (`@cloudflare/vitest-plugin`).
- `pnpm build` type-checks it.
- `pnpm dev` serves it on `http://localhost:8787`.
- `node scripts/probe.mjs [url] [rounds]` makes a room on a deployed relay, joins it twice and
  prints how long a ping to the room and an echo through it take.
- `node scripts/lobby.mjs [url]` comes into a deployed relay's lobby as two players, has one
  challenge the other, both go into the room they are given, then a decline and a quick match.
