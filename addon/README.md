# Mak'gora Kombat, the WoW add-on

Who else wants a fight, seen from inside World of Warcraft. Blizzard does not let add-ons reach
the internet, so it comes in two halves:

- **The add-on** (`MakgoraKombat/`, retail 12.1.5 and WoW Forever). Everyone who has it can say
  they are looking for a fight, and everyone else who has it sees so, live. A new name sounds the
  ready check, shows in the middle of the screen, flashes WoW's icon in the Dock and opens a small
  window that can be left up to keep an eye on who is looking. Click a name to whisper them. It
  reaches the guild, the group, Battle.net friends playing WoW (any realm, either faction) and
  everyone on the same realm through a hidden channel, `MakgoraKombat`.
- **The watcher** (`watch.ts`), outside the game: it watches the game's own queue on the relay
  and puts a macOS banner over WoW when somebody starts waiting there.

## The add-on

Copy the `MakgoraKombat` folder into `World of Warcraft/_retail_/Interface/AddOns/` (on a Mac,
`/Applications/World of Warcraft/_retail_/Interface/AddOns/`), then `/reload`, or restart WoW if
it is not in the AddOns list. For WoW Forever it goes in `_forever_/Interface/AddOns/`.

| | |
|---|---|
| `/mk` | the window (also in the add-ons menu by the minimap) |
| `/mk look` | say you are looking, for half an hour |
| `/mk stop` | stop |
| `/mk name <name>` | the name you fight under on the site, shown to the others so they can challenge you there |
| `/mk quiet` | new names only in chat, no ready check |
| `/mk channel` | stop using the shared channel (guild, group and Battle.net friends only) |
| `/mk test` | a pretend player, to see what a call looks like |

The messages and their timing are described at the top of `MakgoraKombat.lua`.
`addon/test/world.lua` runs it in a few WoW clients stood in for in plain Lua (`lua
addon/test/world.lua`, Lua 5.3 or later); `pnpm test` runs it when Lua is installed, and the
Check workflow installs it.

## The watcher

```sh
node addon/watch.ts --name <your name on the site>
```

It asks the relay's `/lobby/stats` every 15 seconds (it is not in the lobby, so nobody sees it)
and shows a banner with the names of those newly waiting, never yours. `--test` shows one banner
and stops; `--relay <url>` watches another relay. It needs Node 22.18 or later.

To have it always running on a Mac, a LaunchAgent at
`~/Library/LaunchAgents/com.makgora.watch.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.makgora.watch</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/path/to/makgorakombat/addon/watch.ts</string>
    <string>--name</string><string>YourName</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/makgora-watch.log</string>
  <key>StandardErrorPath</key><string>/tmp/makgora-watch.log</string>
</dict></plist>
```

then `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.makgora.watch.plist`
(`launchctl bootout gui/$(id -u)/com.makgora.watch` stops it). The first banner may need
notifications allowed for Script Editor in System Settings → Notifications.
