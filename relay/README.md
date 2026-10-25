# makgora-relay

The wire between two players of MAK'GORA KOMBAT online. It is a Cloudflare Worker with one
Durable Object per room; a room is a six-letter code of consonants (no vowels, no L or Y), holds
at most one host and one guest, and passes every message one of them sends to the other exactly
as it came, text or bytes. It reads none of it and keeps none of it: both machines run the fight
themselves in lockstep, each from its own World of Warcraft folder, and the relay only carries
their inputs between them. A room nobody has been in for ten minutes is forgotten.

Before the room there is the lobby, one Durable Object for everyone, where players find each
other by name: one challenges another, or both sit in the queue, and the lobby makes the room
and tells each of them its code and whether they host. Nobody reads a code out.

## The lobby

- `GET /lobby/ws?name=<name>&id=<id>` upgrades to a WebSocket; while it is open the player is
  here. A name is 2 to 16 letters, digits and spaces; the id is a random one the page makes once
  and keeps, so a reload or a second tab takes the old place instead of making a second player.
  `&busy=1` is a page in an online match coming back between fights; `&busy=0&requeue=1` a page
  back from one that wants the next opponent, and goes straight into the queue.
- Everyone hears `{"t":"here","players":[{"id","name","status":"free"|"busy","night"?:[wins,losses]}],"online","waiting","fighting"}`
  whenever somebody comes, goes, joins or leaves the queue or starts a match, and every 20
  seconds besides. `online` is the players here, `waiting` those in the queue, `fighting` the
  players in a room with their opponent (the pages leave the lobby for the fight itself, so the
  rooms tell the lobby how many are in them). With them comes `"fights":[{"code","names":[host,guest],"ids":[host,guest],"since"}]`,
  the rooms the lobby made that have both players in, longest going first, for anyone who wants
  to watch one. A room made with a code is not the lobby's and is not listed.
- `GET /lobby/stats` answers the same, `{"online","waiting","fighting","fights"}`, for a
  page that is not in the lobby (the game's title) or a bot.
- `{"t":"challenge","to":id}`: the other player hears `{"t":"challenged","from":{id,name},"ttl":30000}`
  and the challenger `{"t":"challenging","to":{id,name},"ttl":30000}`. One open challenge at a
  time each way; challenging somebody busy, or somebody already answering one, is an
  `{"t":"error","message"}`.
- The one challenged answers `{"t":"accept","from":id}` or `{"t":"decline","from":id}`; the
  challenger may take it back with `{"t":"cancel","to":id}`. Unanswered, it lapses after 30
  seconds. When one ends without a match the challenger hears `{"t":"declined","by":id,"reason"}`
  and the one challenged `{"t":"withdrawn","from":id,"reason"}`, the reason being `declined`,
  `cancelled`, `timeout`, `left` or `busy`.
- `{"t":"quick"}` pairs the sender with the player who has waited longest in the queue, or puts
  them at the back of it (`{"t":"queued","queued":true,"since"}`); `{"t":"unquick"}` leaves it
  (`{"t":"unqueued","queued":false}`). A player in the queue can still be challenged by name and
  leaves it for the match if they accept; one who challenges somebody leaves it too. Ten minutes
  in the queue with nobody coming and the lobby lets them go, `{"t":"unqueued","queued":false,"reason":"idle"}`.
- A match: the lobby makes a room as `POST /rooms` would and tells both
  `{"t":"fight","code","role":"host"|"guest","with":{id,name}}`. The challenger hosts, or in a
  quick match the one who waited longer. Both are busy until their lobby sockets come back.
- `ping` is answered `pong`, as in a room.

## The board

- When a match ends, both pages say so to their room (below); the room passes the result to the
  lobby, which keeps in its storage, per player id, the name last seen, wins, losses, the longest
  run of wins and the run going now, and the same for the night. A night runs from 4 AM to 4 AM
  in New York. A match one page left before the end, or that the two pages tell differently,
  counts for nothing; so does a browser fighting itself.
- `GET /lobby/board?span=night|all[&id=<id>]` answers
  `{"span","night":"2026-10-24","rows":[{"rank","name","wins","losses","best","streak","me"?}],"mine"?}`:
  the top twenty, most wins first, then the longest run, then the run now, then the fewest
  losses. With the asking player's id, their row is marked `me` and also given alone as `mine`,
  whether or not it is in the twenty. No ids go out on the board. `night` is the default span.
- Everyone in the lobby is listed with tonight's `night:[wins,losses]` once they have fought tonight.

## The room

- `POST /rooms` makes a room and answers `{"code":"HXBXDC"}`.
- `GET /rooms/:code/ws?role=host|guest[&id=]` upgrades to a WebSocket. A code nobody made is 404, a
  second host or guest is 409. `id` is any string the page keeps for as long as it is in the room.
- When the other player is in the room (on joining, or when they arrive) the relay sends
  `{"t":"peer","joined":true}`; when they leave, `{"t":"peer","joined":false}`.
- A page that gave an `id` and whose socket drops (any close but 1000 or 1001) keeps its seat for
  20 seconds. The other hears `{"t":"peer","joined":true,"away":true}`, and what it sends meanwhile
  is held (the last 600 messages; frames give way before text). If a socket with the same role
  and `id` comes in time, it takes the seat, both hear `{"t":"peer","joined":true,"back":true}`,
  and the held messages follow in order. A socket with the seat's `id` also takes over from one
  the room still thinks is open. After the 20 seconds the other hears `joined:false` as for a
  leave. A page without an `id` leaves the moment its socket closes.
- A page with an `id` should send something at least every couple of seconds (the game pings every
  two): one that has sent nothing, not even a ping, for 6 seconds while the other is talking is
  taken for dropped, as above, and its socket shut. That is how a pulled Wi-Fi, which never sends
  a close, is noticed.
- `ping` is answered `pong` by the room itself without waking it: a keep-alive, and a way to
  time the wire.
- `{"t":"result","game","winner":"host"|"guest","rounds","ticks","me"?:{id,name}}` is a page's
  word that match number `game` is over: the room keeps it until the other page's comes, and
  when the two agree it tells the lobby who won, under the ids and names the lobby matched, or in
  a room made by code the `me` each page gives. It is not passed on.
- Every other message goes to the other player unchanged.
- `GET /rooms/:code/ws?role=watch` comes in to watch, up to 50 at once (the 51st is 409). A
  watcher sends nothing: whatever it says is dropped. It is sent `{"t":"seats","host","guest"}`
  on arriving and whenever a player comes or goes; the host's `hello` and `rematch` and either
  player's `back` as they were sent; and every frame of the fight from either player with one
  byte in front, 0 for the host's and 1 for the guest's. The players stop sending an input once
  the other has it, so the room keeps the current game's inputs, and a watcher who comes in
  mid-fight is sent the hello, the last rematch and those inputs (as frames, 255 at most each)
  before anything live. The players hear nothing of the watchers. A seat kept for a player who
  dropped still reads as in under `seats`; the watchers go on getting the other's frames, and the
  returning page's when it is back.

Pages on `https://realworldbuilder.github.io`, `https://makgora.clawdioslave.com` and `http://localhost:*` (or `127.0.0.1`) may use
it, and those listed in the `ORIGINS` variable (comma separated, given at deploy as
`--var ORIGINS:https://a,https://b`); other sites are refused. Node and other clients that send no
`Origin` are let in.

## Deployed from GitHub

The **Relay** workflow (`.github/workflows/relay.yml`) tests the relay and deploys it with wrangler
whenever main changes `relay/` (Ship starts it after merging such a pull request), or when it is
run by hand from the Actions tab. The game is built for whichever relay the repository's
`RELAY_URL` variable names, and Chris's deploy until one is set. Once, by whoever's Cloudflare
account will host it (the free plan is enough):

1. In the Cloudflare dashboard open **Workers & Pages** once, so the account has its
   `<name>.workers.dev` subdomain.
2. **My Profile → API Tokens → Create Token → Edit Cloudflare Workers**, all of this account,
   and copy the token. The account id is on the Workers & Pages overview, right column.
3. In the GitHub repository, as two secrets (Settings → Secrets and variables → Actions, or
   `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID`, which ask for
   the value).
4. Run **Relay** (`gh workflow run relay.yml`). Its summary gives the address,
   `https://makgora-relay.<name>.workers.dev`; set it as the variable `RELAY_URL`
   (`gh variable set RELAY_URL -b <address>`) and run **Deploy** (`gh workflow run deploy.yml`).
   Every page loaded after that uses it; one that saved a relay in SETTINGS keeps that one.

A relay on a new account starts with an empty board. A domain of the game's own goes in the
variable `SITE_DOMAIN` (`makgora.gg`, no `https://`): Deploy then builds the game for the root of
that domain, and Relay lets it and its `www.` in.

## Your own relay

The game uses the relay it was built for (above) unless SETTINGS on the title names another
(NETWORK, remembered in the browser as `makgora.relay`). To run your own on your Cloudflare
account by hand (the free plan is enough):

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

- `pnpm test` runs the room's, the lobby's and the board's tests inside the Workers runtime (`@cloudflare/vitest-plugin`).
- `pnpm build` type-checks it.
- `pnpm dev` serves it on `http://localhost:8787`.
- `node scripts/probe.mjs [url] [rounds]` makes a room on a deployed relay, joins it twice and
  prints how long a ping to the room and an echo through it take.
- `node scripts/lobby.mjs [url]` comes into a deployed relay's lobby as two players, has one
  challenge the other, both go into the room they are given, then a decline, a quick match and
  both back for the next opponent with `requeue=1`, reading `/lobby/stats` while they fight.
