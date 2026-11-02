--[[
  The add-on's tests, outside the game: a few WoW clients stood in for in plain Lua, each running
  MakgoraKombat.lua in its own globals, on one clock, with the guild, Battle.net and the shared
  channel carrying their addon messages between them. Run with `lua addon/test/world.lua` from
  the repository (test/addon.test.ts does, when Lua is installed); it prints each check and exits
  1 if any fail.
]]

local here = debug.getinfo(1, "S").source:sub(2):match("^(.*)/[^/]*$") or "."
local source = assert(io.open(here .. "/../MakgoraKombat/MakgoraKombat.lua")):read("a")

-- The clock and the timers ----------------------------------------------------------------------

local clock = { now = 1000, wall = 1800000000 }
local timers = {}

local function after(client, delay, fn, every)
  timers[#timers + 1] = { at = clock.now + delay, fn = fn, client = client, every = every }
end

-- Runs every timer due in the next `seconds`, in order, a client's only while it is in the game.
local function advance(seconds)
  local stop = clock.now + seconds
  while true do
    local next, index
    for i, t in ipairs(timers) do
      if t.at <= stop and (not next or t.at < next.at) then next, index = t, i end
    end
    if not next then break end
    table.remove(timers, index)
    clock.wall = clock.wall + (next.at - clock.now)
    clock.now = next.at
    if next.client.online then
      next.fn()
      if next.every then after(next.client, next.every, next.fn, next.every) end
    end
  end
  clock.wall = clock.wall + (stop - clock.now)
  clock.now = stop
end

-- Widgets: any method does nothing but those a test reads back -----------------------------------

local function Widget(env, name)
  local w = { scripts = {}, events = {}, shown = false, text = "", points = {} }
  local methods = {
    SetScript = function(self, what, fn) self.scripts[what] = fn end,
    RegisterEvent = function(self, event) self.events[event] = true end,
    Show = function(self)
      if not self.shown then
        self.shown = true
        if self.scripts.OnShow then self.scripts.OnShow(self) end
      end
    end,
    Hide = function(self)
      if self.shown then
        self.shown = false
        if self.scripts.OnHide then self.scripts.OnHide(self) end
      end
    end,
    IsShown = function(self) return self.shown end,
    SetShown = function(self, on) if on then self:Show() else self:Hide() end end,
    SetText = function(self, text) self.text = text end,
    GetText = function(self) return self.text end,
    SetPoint = function(self, ...) self.points = { ... } end,
    GetPoint = function(self) return table.unpack(self.points) end,
    CreateFontString = function() return Widget(env) end,
  }
  setmetatable(w, { __index = function(_, key) return methods[key] or function() end end })
  if name then env[name] = w end
  env.widgets[#env.widgets + 1] = w
  return w
end

-- The clients and the ways between them ---------------------------------------------------------

local clients = {}
local nextAccount = 1

local function deliver(to, event, ...)
  local args = table.pack(...)
  after(to, 0.1, function() to.fire(event, table.unpack(args, 1, args.n)) end)
end

local function sendAddon(from, prefix, text, kind, target)
  from.sent[#from.sent + 1] = kind
  for _, to in ipairs(clients) do
    if to.online and to.prefixes[prefix] then
      local reaches = (kind == "GUILD" and from.guild and to.guild == from.guild)
        or (kind == "CHANNEL" and target == from.channels.MakgoraKombat and to.channels.MakgoraKombat and to.realm == from.realm)
      if reaches then deliver(to, "CHAT_MSG_ADDON", prefix, text, kind, from.full) end
    end
  end
end

local function Client(name, realm, options)
  options = options or {}
  local c = {
    name = name, realm = realm, full = name .. "-" .. realm, guild = options.guild, friends = {}, online = true,
    account = nextAccount, channels = {}, prefixes = {}, chat = {}, sounds = 0, warnings = {}, sent = {},
    db = options.db,
  }
  nextAccount = nextAccount + 1
  local env = setmetatable({ widgets = {} }, { __index = _G })
  c.env = env
  env.MakgoraKombatDB = c.db
  env.time = function() return clock.wall end
  env.GetTime = function() return clock.now end
  env.C_Timer = {
    After = function(delay, fn) after(c, delay, fn) end,
    NewTicker = function(every, fn) after(c, every, fn, every) end,
  }
  env.CreateFrame = function(_, frameName) return Widget(env, frameName) end
  env.UIParent = Widget(env)
  env.GameTooltip = Widget(env)
  env.RaidWarningFrame = Widget(env)
  env.ChatFrame1 = Widget(env)
  env.NUM_CHAT_WINDOWS = 1
  env.UISpecialFrames = {}
  env.SlashCmdList = {}
  env.DEFAULT_CHAT_FRAME = { AddMessage = function(_, text) c.chat[#c.chat + 1] = text end }
  env.UnitFullName = function() return name, realm end
  env.GetNormalizedRealmName = function() return realm end
  env.UnitClass = function() return "Warrior", options.class or "WARRIOR" end
  env.UnitLevel = function() return 80 end
  env.Ambiguate = function(full) return full end
  env.RAID_CLASS_COLORS = { WARRIOR = { colorStr = "ffc69b6d" }, MAGE = { colorStr = "ff3fc7eb" } }
  env.LOCALIZED_CLASS_NAMES_MALE = { WARRIOR = "Warrior", MAGE = "Mage" }
  env.SOUNDKIT = { READY_CHECK = 8960 }
  env.ChatTypeInfo = { RAID_WARNING = {} }
  env.PlaySound = function() c.sounds = c.sounds + 1 end
  env.RaidNotice_AddMessage = function(_, text) c.warnings[#c.warnings + 1] = text end
  env.FlashClientIcon = function() end
  env.ChatFrame_RemoveChannel = function() end
  env.ChatFrame_SendTell = function(to) c.whispered = to end
  env.strlenutf8 = utf8.len
  env.LE_PARTY_CATEGORY_INSTANCE = 2
  env.IsInGuild = function() return c.guild ~= nil end
  env.IsInGroup = function() return false end
  env.IsInRaid = function() return false end
  env.GetChannelName = function(channel) return c.channels[channel] or 0 end
  env.JoinTemporaryChannel = function(channel) c.channels[channel] = 5 end
  env.LeaveChannelByName = function(channel) c.channels[channel] = nil end
  env.C_ChatInfo = {
    RegisterAddonMessagePrefix = function(prefix) c.prefixes[prefix] = true end,
    SendAddonMessage = function(...) sendAddon(c, ...) end,
  }
  env.BNET_CLIENT_WOW = "WoW"
  env.BNGetNumFriends = function() return #c.friends end
  env.C_BattleNet = {
    GetFriendNumGameAccounts = function() return 1 end,
    GetFriendGameAccountInfo = function(i)
      local friend = c.friends[i]
      return { isOnline = friend.online, clientProgram = "WoW", gameAccountID = friend.account }
    end,
  }
  env.BNSendGameData = function(account, prefix, text)
    c.sent[#c.sent + 1] = "BATTLENET"
    for _, to in ipairs(clients) do
      if to.account == account and to.online and to.prefixes[prefix] then
        deliver(to, "BN_CHAT_MSG_ADDON", prefix, text, "WHISPER", c.account)
      end
    end
  end

  function c.fire(event, ...)
    for _, w in ipairs(env.widgets) do
      if w.events[event] and w.scripts.OnEvent then w.scripts.OnEvent(w, event, ...) end
    end
  end
  function c.mk(text) env.SlashCmdList.MAKGORAKOMBAT(text) end
  function c.list() return env.MakgoraKombat.looking end
  function c.saw(who) return c.list()[who] ~= nil end
  function c.logIn()
    assert(load(source, "@MakgoraKombat.lua", "t", env))("MakgoraKombat", {})
    c.fire("ADDON_LOADED", "MakgoraKombat")
    c.fire("PLAYER_ENTERING_WORLD", true, false)
    c.db = env.MakgoraKombatDB
  end
  -- A /reload: the add-on starts again from what it saved; nobody else hears anything of it.
  function c.reload()
    c.fire("PLAYER_LOGOUT")
    local saved = env.MakgoraKombatDB
    for i = #timers, 1, -1 do
      if timers[i].client == c then table.remove(timers, i) end
    end
    local fresh = Client(name, realm, { guild = c.guild, db = saved, class = options.class })
    fresh.friends, fresh.account = c.friends, c.account
    for i, other in ipairs(clients) do
      if other == c then clients[i] = fresh end
      for j, friend in ipairs(other.friends) do
        if friend == c then other.friends[j] = fresh end
      end
    end
    table.remove(clients)
    fresh.logIn()
    return fresh
  end
  clients[#clients + 1] = c
  return c
end

local function friends(a, b)
  a.friends[#a.friends + 1] = b
  b.friends[#b.friends + 1] = a
end

-- The checks ------------------------------------------------------------------------------------

local failed = 0
local function check(ok, what)
  print((ok and "  ok   " or "  FAIL ") .. what)
  if not ok then failed = failed + 1 end
end
local function has(list, pattern)
  for _, line in ipairs(list) do
    if line:find(pattern) then return true end
  end
  return false
end

-- Thrall and Jaina share a guild; Anduin is only Thrall's Battle.net friend, on another realm.
local thrall = Client("Thrall", "Azgalor", { guild = "Horde" })
local jaina = Client("Jaina", "Azgalor", { guild = "Horde", class = "MAGE" })
local anduin = Client("Anduin", "Stormrage")
friends(thrall, anduin)
for _, c in ipairs(clients) do c.logIn() end
advance(10)

print("Logging in")
check(next(jaina.list()) == nil and next(anduin.list()) == nil, "nobody is listed while nobody is looking")
check(thrall.channels.MakgoraKombat ~= nil, "the shared channel is joined")
check(has(thrall.sent, "GUILD") and has(thrall.sent, "CHANNEL") and has(thrall.sent, "BATTLENET"), "the question who is looking goes out by guild, channel and Battle.net")

print("Thrall looks for a fight")
thrall.mk("name Hermajesty")
thrall.mk("look")
advance(1)
check(jaina.saw("Thrall-Azgalor"), "his guildmate hears it")
check(anduin.saw("Thrall-Azgalor"), "his Battle.net friend on another realm hears it")
check(jaina.list()["Thrall-Azgalor"].site == "Hermajesty", "with the name he fights under on the site")
check(jaina.list()["Thrall-Azgalor"].class == "WARRIOR" and jaina.list()["Thrall-Azgalor"].level == 80, "with his class and level")
check(not thrall.saw("Thrall-Azgalor"), "he is not on his own list")
check(jaina.sounds == 1, "heard twice (guild and channel), the ready check sounds once")
check(has(jaina.warnings, "Thrall%-Azgalor.* is looking"), "the middle of the screen says who")
check(has(jaina.chat, "on the site as .*Hermajesty"), "the chat line gives his site name")
check(jaina.env.MakgoraKombatFrame and jaina.env.MakgoraKombatFrame.shown, "the window opens")
local rows = jaina.env.MakgoraKombatFrame.rows
check(rows[1].name.text:find("Thrall%-Azgalor") and rows[1].info.text:find("Hermajesty"), "the window lists him")
check(rows[1].shown and not rows[2].shown, "one row for one player")
rows[1].scripts.OnClick(rows[1])
check(jaina.whispered == "Thrall-Azgalor", "clicking his row whispers him")

print("Keeping it up")
advance(305)
check(jaina.saw("Thrall-Azgalor") and jaina.sounds == 1, "said again every minute, he stays listed and is not called again")
check(rows[1].info.text:find("5m"), "the window counts how long he has been looking")

print("Somebody comes later")
local varian = Client("Varian", "Azgalor")
varian.logIn()
advance(12)
check(varian.saw("Thrall-Azgalor"), "a player logging in later is told who is already looking")

print("Two looking")
jaina.mk("look")
advance(6)
check(thrall.saw("Jaina-Azgalor") and varian.saw("Jaina-Azgalor"), "a second player looking is heard by everyone on the channel")
check(not anduin.saw("Jaina-Azgalor"), "but not by somebody she has no way to reach")
check(thrall.sounds == 1, "Thrall is called for Jaina")

print("Stopping")
thrall.mk("stop")
advance(1)
check(not jaina.saw("Thrall-Azgalor") and not anduin.saw("Thrall-Azgalor") and not varian.saw("Thrall-Azgalor"), "stopping takes him off every list at once")
jaina.mk("stop")
advance(1)

print("A /reload")
thrall.mk("look")
advance(1)
local before = jaina.sounds
thrall = thrall.reload()
advance(10)
check(thrall.db.looking ~= nil, "he is still looking after it")
check(jaina.saw("Thrall-Azgalor") and jaina.sounds == before, "and the others are not called again")
advance(200)
check(jaina.saw("Thrall-Azgalor"), "and he still says so every minute")

print("Going quiet")
thrall.online = false
advance(160)
check(not jaina.saw("Thrall-Azgalor"), "a player not heard from for two and a half minutes is dropped")
thrall.online = true
thrall.db.looking = nil

print("Half an hour")
jaina.mk("look")
advance(1)
check(varian.saw("Jaina-Azgalor"), "Jaina looks")
advance(30 * 60 + 10)
check(jaina.db.looking == nil and has(jaina.chat, "Half an hour"), "her looking lapses after half an hour, and she is told")
check(not varian.saw("Jaina-Azgalor"), "and she is off the others' lists")

print("Quiet, and the test")
varian.mk("quiet")
local sounds = varian.sounds
varian.mk("test")
check(varian.saw("Testgrom-Nowhere") and varian.sounds == sounds, "quiet: a new name shows without the ready check")
varian.mk("quiet")
anduin.mk("test")
check(anduin.saw("Testgrom-Nowhere") and has(anduin.warnings, "Testgrom"), "/mk test shows what a call looks like")
advance(160)
check(not anduin.saw("Testgrom-Nowhere"), "and the test player goes again")

print("Names")
anduin.mk("name x")
check(anduin.db.site == nil and has(anduin.chat, "2 to 16"), "a name of one letter is refused")
anduin.mk("name Ærøsköbing Ærø")
check(anduin.db.site == "Ærøsköbing Ærø", "a name is counted in letters, not bytes")
anduin.mk("name")
check(anduin.db.site == nil, "/mk name alone clears it")

print(failed == 0 and "All passed." or (failed .. " failed."))
os.exit(failed == 0 and 0 or 1)
