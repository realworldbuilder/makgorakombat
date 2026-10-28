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

## The night's report

- Every match a room sees, from the host's `hello` or `rematch` to its end, becomes one record the
  room hands the lobby: `{"code","lobby","start","end","game","host"?:{id,name},"guest"?:{id,name},"stage"?,"ended","desyncAt"?,"by"?,"winner"?,"rounds"?,"ticks"?,"reconnects","waits"?:[host,guest]}`.
  `ended` is `finished` (both results agree), `desync` (the hashes in the two players' frames
  differ, `desyncAt` being the first tick they do, or the two results differ), `left` (back to
  the roster or a closed tab before the end, `by` whom), `dropped` (a socket gone and not back
  within the 20 seconds) or `never` (the room closed with no match started in it, after the lobby
  matched two for it or somebody came in). `reconnects` counts drops that came back in time;
  `waits` is the seconds each waited in the queue (null for one who challenged or was
  challenged), on a room's first record only. Times are ms since 1970; players are named by the
  ids and names the board uses (the lobby's, or in a room made by code the `me` of a result).
- The lobby also notes who came to it, one row per player per hour. Both are kept in the lobby's
  storage for 30 days at most, the records 2,000 at most, the oldest going first.
- `GET /lobby/report?span=night|day|week|all` adds them up:
  `{"span","night","from","to","players","started","finished","desyncs","left","drops","never","reconnects","wait":{"n","median","worst"},"busiest":{"hour","fights"}|null,"hours":[24],"fights"?:[...]}`.
  `night` is the board's night (4 AM to 4 AM in New York) and the default; `day` and `week` the
  last 24 hours and 7 days; `all` everything kept. `players` is the different ids seen in the
  lobby or in a match; `started` the matches begun, of which `finished`, `desyncs`, `left` and
  `drops`; `never` the rooms with none. The queue waits are in seconds; `busiest` is the hour in
  New York with the most matches started and `hours` those started by hour of the day there.
  `fights`, every record oldest first, comes with `night` and `day` only.
- Each page also tells its room how the match is going on the wire, every ten seconds and at the
  end: `{"t":"net","game","delay","rtt","rttSlow","fps","fpsSlow","ticks","held","heldMs","eased","wall"}`
  (round trips to the other page in ms, the middle and the one slower than nine in ten; frames a
  second, the middle and the slow tenth; ticks played; frames and ms the fight stood waiting for
  the other's inputs; ms its clock gave back easing off; ms since the match began). The room keeps
  the latest from each side, passes it to nobody, and puts it in the match's record as
  `net:{host,guest}`, with the hello's `delay` and `colos:{host,guest}`, the Cloudflare edge each
  player came in by (an airport code). The report's `wire:{told,rtt,laggy}` counts the matches with
  a word on the wire, their middle round trip, and those where a side stood waiting a tenth of the
  match or more.

## Voice on Discord

- With a Discord bot in the game's server (below), the two players in a room can talk while they
  fight. `GET /voice` answers `{"on":true|false}`: whether this relay has the bot. The game shows
  its VOICE tab (top of the screen, right of the music tab, or V) only in an online match on a
  relay that says `on`.
- `POST /rooms/:code/voice?role=host|guest&id=<id>`, with the id the page joined the room with,
  answers `{"url":"https://discord.gg/..."}`. The first ask has the bot make a voice channel,
  `⚔ Chris vs Will` (the names the lobby matched, or `⚔ Room <code>` for a room made by code),
  room for two, and an invite to it; every ask after answers the same invite. The other player
  hears `{"t":"voice","url","by":"host"|"guest"}` on their socket (held for them if they are
  away). Anyone else, a watcher or a wrong id, is 403; a relay without the bot 404; Discord
  refusing 502.
- The room deletes its channel when it closes (ten minutes after the last player left), and once
  an hour (`17 * * * *`) the relay deletes any voice channel of its own, those named with `⚔ `
  (and under `DISCORD_CATEGORY` if one is set), older than twelve hours.

To switch it on, once:

1. In the Discord Developer Portal (discord.com/developers/applications), **New Application**,
   then **Bot** → **Reset Token** and copy the token. It needs no privileged intents.
2. **OAuth2 → URL Generator**: scope `bot`, permissions **Manage Channels**, **Create Instant
   Invite** and **View Channels**; open the URL it makes and add the bot to the game's server.
3. In Discord, **User Settings → Advanced → Developer Mode** on; right-click the server's icon →
   **Copy Server ID**. For the channels under a category of their own (say "MAK'GORA"), make one,
   right-click it → **Copy Channel ID**, and give the bot Manage Channels on it.
4. In the GitHub repository: the secret `DISCORD_TOKEN` (`gh secret set DISCORD_TOKEN`), the
   variable `DISCORD_GUILD` (`gh variable set DISCORD_GUILD -b <server id>`), and if there is one
   `DISCORD_CATEGORY`. Run **Relay** (`gh workflow run relay.yml`).

By hand instead: `wrangler secret put DISCORD_TOKEN`, and
`wrangler deploy --var DISCORD_GUILD:<id> [--var DISCORD_CATEGORY:<id>]`.

## The site's numbers

- The welcome page and the game (`src/game/track.ts`) send `POST /site/hit` with a plain-text
  body `{"v","p","k","d"?,"x"?,"r"?,"w"?}`: `v` a random id the browser keeps, `p` the page
  (`welcome` or `game`), `k` what happened (`view` the page opened, `folder` a World of Warcraft
  folder read with `d` its edition, `fight` a fight begun with `d` cpu, local or online and `x` the
  champion, `watch` a fight watched, `error` a loose error with `x` its message, `ping` once a
  minute while the page is in front), `r` the referrer and `w` the window's width on a view. The
  relay adds the country Cloudflare reads off the request and the browser, system and device from
  the user agent; robots and headless browsers are dropped. No address and no name are kept.
- One Durable Object, `Site` (`src/site.ts`), keeps the hits in SQLite for 90 days, 200,000 at most.
- `GET /site/report?span=day|week|month|all` adds them up: who is on the site now (a hit or ping
  in the last three minutes), visitors, new visitors, page views, a series by hour (day) or by
  date in New York, how far visitors got (welcome, game, folder, fight, online), and the top
  referrers, countries, browsers, systems, devices, pages, editions, fight modes, champions and
  errors. `week` is the default. The game's `/stats/` page, linked from the welcome page, shows it.

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

It needs no secrets (but the Discord bot's, for voice), no storage of its own and no custom domain; wrangler prints the
`https://makgora-relay.<your-subdomain>.workers.dev` address to put in SETTINGS. Both players
must use the same relay.

## Working on it

- `pnpm test` runs the room's, the lobby's, the board's and voice's tests (Discord stood in for) inside the Workers runtime (`@cloudflare/vitest-plugin`).
- `pnpm build` type-checks it.
- `pnpm dev` serves it on `http://localhost:8787`.
- `node scripts/probe.mjs [url] [rounds]` makes a room on a deployed relay, joins it twice and
  prints how long a ping to the room and an echo through it take.
- `node scripts/lobby.mjs [url]` comes into a deployed relay's lobby as two players, has one
  challenge the other, both go into the room they are given, then a decline, a quick match and
  both back for the next opponent with `requeue=1`, reading `/lobby/stats` while they fight.
