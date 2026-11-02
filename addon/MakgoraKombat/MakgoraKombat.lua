--[[
  MAK'GORA KOMBAT in World of Warcraft: who else wants a fight.

  An add-on cannot reach the internet, so it cannot see the game's own queue. Instead, everyone
  who has it can say they are looking for a fight (/mk look), and everyone else who has it hears
  so, live: through the guild, the group, Battle.net friends playing WoW, and a hidden chat channel
  of its own. A new name on the list sounds the ready check, shows on the middle of the screen and
  opens the little window, which can be left up to keep an eye on who is looking. A player who
  gives the name they fight under on the site (/mk name <name>) is listed with it, so the others
  can challenge them there by name.

  The messages, under the prefix MAKGORA, are fields between "~": the version, then
    L ~ Name-Realm ~ CLASS ~ level ~ site name   looking (said again every minute while so)
    N ~ Name-Realm                               not looking any more
    Q ~ Name-Realm                               who is looking? (everyone looking says L)
  A player not heard from for two and a half minutes is off the list; one's own looking lapses
  after half an hour, as the site's queue lets a player go who has waited too long.
]]

local ADDON = ...

local PREFIX = "MAKGORA"
local VERSION = "1"
local CHANNEL = "MakgoraKombat"
local SITE = "realworldbuilder.github.io/makgorakombat"
-- Seconds: how often a looking player says so again, when a player not heard from is dropped,
-- how long one's own looking lasts, and how often the list is looked over.
local BEAT = 60
local GONE = 150
local LOOK_FOR = 30 * 60
local TICK = 5
local ROWS = 10

local db
local me
local looking = {}
local lastSaid = 0
local answering = false
local frame

local function Print(text)
  DEFAULT_CHAT_FRAME:AddMessage("|cffff3b30MAK'GORA|r " .. text)
end

-- This character as the other add-ons know it: Name-Realm, once the realm is known.
local function Me()
  if me then return me end
  local name, realm = UnitFullName("player")
  realm = (realm and realm ~= "") and realm or GetNormalizedRealmName()
  if name and realm and realm ~= "" then me = name .. "-" .. realm end
  return me
end

local function Split(text)
  local parts, from = {}, 1
  while true do
    local at = text:find("~", from, true)
    if not at then
      parts[#parts + 1] = text:sub(from)
      return parts
    end
    parts[#parts + 1] = text:sub(from, at - 1)
    from = at + 1
  end
end

local function IsLooking()
  return db.looking ~= nil and time() - db.looking < LOOK_FOR
end

-- One message to everyone the add-on can reach. Any way that is shut (combat in an instance, no
-- guild, the channel not joined yet) is passed over.
local function Send(text)
  local function addon(kind, target)
    pcall(C_ChatInfo.SendAddonMessage, PREFIX, text, kind, target)
  end
  if IsInGuild() then addon("GUILD") end
  if IsInGroup(LE_PARTY_CATEGORY_INSTANCE) then
    addon("INSTANCE_CHAT")
  elseif IsInRaid() then
    addon("RAID")
  elseif IsInGroup() then
    addon("PARTY")
  end
  if db.channel then
    local id = GetChannelName(CHANNEL)
    if id and id > 0 then addon("CHANNEL", id) end
  end
  local friends = BNGetNumFriends() or 0
  for i = 1, friends do
    for j = 1, C_BattleNet.GetFriendNumGameAccounts(i) or 0 do
      local game = C_BattleNet.GetFriendGameAccountInfo(i, j)
      if game and game.isOnline and game.clientProgram == BNET_CLIENT_WOW and game.gameAccountID then
        pcall(BNSendGameData, game.gameAccountID, PREFIX, text)
      end
    end
  end
end

local function Say(kind)
  if not Me() then return end
  local text = VERSION .. "~" .. kind .. "~" .. me
  if kind == "L" then
    local _, class = UnitClass("player")
    text = text .. "~" .. (class or "") .. "~" .. (UnitLevel("player") or 0) .. "~" .. (db.site or "")
    lastSaid = GetTime()
  end
  Send(text)
end

-- Somebody asked who is looking: answer after a second or few, so that everyone looking does
-- not answer at once, and only once however many ways the question came.
local function Answer()
  if answering then return end
  answering = true
  C_Timer.After(1 + math.random() * 3, function()
    answering = false
    if IsLooking() then Say("L") end
  end)
end

local function Short(p)
  local name = Ambiguate(p.name, "none")
  local color = p.class and RAID_CLASS_COLORS and RAID_CLASS_COLORS[p.class]
  return color and color.colorStr and ("|c" .. color.colorStr .. name .. "|r") or name
end

local function ClassName(p)
  return (LOCALIZED_CLASS_NAMES_MALE and LOCALIZED_CLASS_NAMES_MALE[p.class]) or p.class or ""
end

local function Ago(seconds)
  if seconds < 60 then return "now" end
  if seconds < 3600 then return math.floor(seconds / 60) .. "m" end
  return math.floor(seconds / 3600) .. "h"
end

local function Sorted()
  local list = {}
  for _, p in pairs(looking) do list[#list + 1] = p end
  table.sort(list, function(a, b) return a.since < b.since end)
  return list
end

local Refresh, Show

local function Alert(p)
  local site = p.site and (" — on the site as |cffffd100" .. p.site .. "|r") or ""
  Print(Short(p) .. " (" .. ClassName(p) .. " " .. (p.level or "?") .. ") is looking for a fight" .. site .. ". /mk to see who.")
  if db.quiet then return end
  PlaySound(SOUNDKIT.READY_CHECK, "Master")
  if RaidNotice_AddMessage and RaidWarningFrame then
    RaidNotice_AddMessage(RaidWarningFrame, "MAK'GORA: " .. Short(p) .. " is looking for a fight", ChatTypeInfo["RAID_WARNING"])
  end
  if FlashClientIcon then FlashClientIcon() end
  Show()
end

local function Heard(text, via)
  local parts = Split(text)
  local kind, who = parts[2], parts[3]
  if not who or who == "" or who == Me() then return end
  if kind == "L" then
    local known = looking[who]
    local now = GetTime()
    looking[who] = {
      name = who,
      class = parts[4] ~= "" and parts[4] or nil,
      level = tonumber(parts[5]),
      site = (parts[6] and parts[6] ~= "") and parts[6] or nil,
      since = known and known.since or now,
      heard = now,
      via = via,
    }
    if not known then
      Alert(looking[who])
      -- Somebody new to the list may not know we are on it yet.
      if IsLooking() then Answer() end
    end
  elseif kind == "N" then
    looking[who] = nil
  elseif kind == "Q" then
    Answer()
  end
  Refresh()
end

local function SetLooking(on)
  if on then
    db.looking = time()
    Say("L")
    Print("You are looking for a fight. Everyone with the add-on can see it for the next half hour; /mk stop to stop.")
  else
    db.looking = nil
    Say("N")
    Print("You are not looking any more.")
  end
  Refresh()
end

-- The hidden channel: joined but kept out of the chat windows, as it only carries the add-on's own messages.
local function JoinChannel()
  if not db.channel then return end
  pcall(JoinTemporaryChannel, CHANNEL)
  local remove = (ChatFrameUtil and ChatFrameUtil.RemoveChannel) or ChatFrame_RemoveChannel
  if remove then
    for i = 1, NUM_CHAT_WINDOWS or 0 do
      local chat = _G["ChatFrame" .. i]
      if chat then pcall(remove, chat, CHANNEL) end
    end
  end
end

local function Whisper(name)
  local tell = (ChatFrameUtil and ChatFrameUtil.SendTell) or ChatFrame_SendTell
  if tell then tell(name) end
end

-- The window -----------------------------------------------------------------------------------

local function Build()
  frame = CreateFrame("Frame", "MakgoraKombatFrame", UIParent, "BasicFrameTemplateWithInset")
  frame:SetSize(320, 120)
  frame:SetFrameStrata("MEDIUM")
  frame:SetClampedToScreen(true)
  frame:SetMovable(true)
  frame:EnableMouse(true)
  frame:RegisterForDrag("LeftButton")
  frame:SetScript("OnDragStart", frame.StartMoving)
  frame:SetScript("OnDragStop", function(self)
    self:StopMovingOrSizing()
    local point, _, relative, x, y = self:GetPoint()
    db.point = { point, relative, x, y }
  end)
  local p = db.point
  if p then
    frame:SetPoint(p[1], UIParent, p[2], p[3], p[4])
  else
    frame:SetPoint("TOPRIGHT", UIParent, "TOPRIGHT", -220, -180)
  end
  frame:SetScript("OnShow", function() db.shown = true end)
  frame:SetScript("OnHide", function() db.shown = false end)
  table.insert(UISpecialFrames, "MakgoraKombatFrame")

  local title = frame:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
  title:SetPoint("TOP", frame, "TOP", 0, -5)
  title:SetText("MAK'GORA KOMBAT")

  frame.look = CreateFrame("Button", nil, frame, "UIPanelButtonTemplate")
  frame.look:SetSize(130, 22)
  frame.look:SetPoint("TOPLEFT", frame, "TOPLEFT", 12, -30)
  frame.look:SetScript("OnClick", function() SetLooking(not IsLooking()) end)

  frame.status = frame:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
  frame.status:SetPoint("LEFT", frame.look, "RIGHT", 10, 0)
  frame.status:SetPoint("RIGHT", frame, "RIGHT", -12, 0)
  frame.status:SetJustifyH("LEFT")

  frame.empty = frame:CreateFontString(nil, "OVERLAY", "GameFontDisable")
  frame.empty:SetPoint("TOPLEFT", frame, "TOPLEFT", 16, -64)
  frame.empty:SetText("Nobody else is looking right now.")

  frame.rows = {}
  for i = 1, ROWS do
    local row = CreateFrame("Button", nil, frame)
    row:SetSize(296, 18)
    row:SetPoint("TOPLEFT", frame, "TOPLEFT", 12, -60 - (i - 1) * 18)
    row:SetHighlightTexture("Interface\\QuestFrame\\UI-QuestTitleHighlight", "ADD")
    row.name = row:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
    row.name:SetPoint("LEFT", row, "LEFT", 4, 0)
    row.info = row:CreateFontString(nil, "OVERLAY", "GameFontNormalSmall")
    row.info:SetPoint("RIGHT", row, "RIGHT", -4, 0)
    row:SetScript("OnClick", function(self) if self.player then Whisper(self.player.name) end end)
    row:SetScript("OnEnter", function(self)
      local who = self.player
      if not who then return end
      GameTooltip:SetOwner(self, "ANCHOR_RIGHT")
      GameTooltip:AddLine(Short(who))
      GameTooltip:AddLine(ClassName(who) .. " " .. (who.level or "?"), 1, 1, 1)
      if who.site then GameTooltip:AddLine("Challenge " .. who.site .. " on the site, under PLAY ONLINE.", 1, 0.82, 0, true) end
      GameTooltip:AddLine("Click to whisper.", 0.6, 0.6, 0.6)
      GameTooltip:Show()
    end)
    row:SetScript("OnLeave", function() GameTooltip:Hide() end)
    frame.rows[i] = row
  end

  frame.foot = frame:CreateFontString(nil, "OVERLAY", "GameFontDisableSmall")
  frame.foot:SetPoint("BOTTOMLEFT", frame, "BOTTOMLEFT", 14, 10)
  frame.foot:SetText(SITE)
end

function Refresh()
  if not frame or not frame:IsShown() then return end
  local mine = IsLooking()
  frame.look:SetText(mine and "Stop looking" or "Look for a fight")
  if mine then
    frame.status:SetText("|cff40ff40You are looking|r" .. (db.site and (" as " .. db.site) or ""))
  else
    frame.status:SetText(db.site and ("You fight as " .. db.site) or "/mk name <site name>")
  end
  local list, now = Sorted(), GetTime()
  for i, row in ipairs(frame.rows) do
    local p = list[i]
    row.player = p
    if p then
      row.name:SetText(Short(p) .. "  |cffaaaaaa" .. ClassName(p) .. " " .. (p.level or "?") .. "|r")
      row.info:SetText((p.site and (p.site .. "  ") or "") .. "|cffaaaaaa" .. Ago(now - p.since) .. "|r")
      row:Show()
    else
      row:Hide()
    end
  end
  frame.empty:SetShown(#list == 0)
  frame:SetHeight(88 + math.max(1, math.min(#list, ROWS)) * 18)
end

function Show()
  if not frame then Build() end
  frame:Show()
  Refresh()
end

local function Toggle()
  if frame and frame:IsShown() then frame:Hide() else Show() end
end

function MakgoraKombat_OnAddonCompartmentClick()
  Toggle()
end

-- The clock: drop who has gone quiet, say again that we are looking, let our own looking lapse.
local function Tick()
  local now = GetTime()
  for who, p in pairs(looking) do
    if now - p.heard > GONE then looking[who] = nil end
  end
  if db.looking and not IsLooking() then
    db.looking = nil
    Say("N")
    Print("Half an hour looking: you are not looking any more. /mk look to look again.")
  elseif IsLooking() and now - lastSaid >= BEAT then
    Say("L")
  end
  Refresh()
end

local function Command(text)
  local word, rest = (text or ""):match("^%s*(%S*)%s*(.-)%s*$")
  word = word:lower()
  if word == "" then
    Toggle()
  elseif word == "look" or word == "on" then
    SetLooking(true)
  elseif word == "stop" or word == "off" then
    SetLooking(false)
  elseif word == "name" then
    local name = rest:gsub("~", ""):gsub("%s+", " ")
    local length = strlenutf8 and strlenutf8(name) or #name
    if name == "" then
      db.site = nil
      Print("No site name now.")
    elseif length < 2 or length > 16 then
      Print("The name you fight under on the site, 2 to 16 letters.")
      return
    else
      db.site = name
      Print("On the site you are " .. name .. ".")
    end
    if IsLooking() then Say("L") end
    Refresh()
  elseif word == "quiet" then
    db.quiet = not db.quiet
    Print(db.quiet and "Quiet: a new name only shows in chat." or "Loud again: the ready check sounds for a new name.")
  elseif word == "channel" then
    db.channel = not db.channel
    if db.channel then
      JoinChannel()
    else
      pcall(LeaveChannelByName, CHANNEL)
    end
    Print(db.channel and "Using the shared channel too." or "Only the guild, the group and Battle.net friends now.")
  elseif word == "test" then
    Heard(VERSION .. "~L~Testgrom-Nowhere~WARRIOR~80~Test Grom", "test")
  else
    Print("/mk  the window · /mk look · /mk stop · /mk name <site name> · /mk quiet · /mk channel · /mk test")
  end
end

local events = CreateFrame("Frame")
events:RegisterEvent("ADDON_LOADED")
events:RegisterEvent("PLAYER_ENTERING_WORLD")
events:RegisterEvent("PLAYER_LOGOUT")
events:RegisterEvent("CHAT_MSG_ADDON")
events:RegisterEvent("BN_CHAT_MSG_ADDON")
local started = false
events:SetScript("OnEvent", function(_, event, ...)
  if event == "ADDON_LOADED" then
    if ... ~= ADDON then return end
    MakgoraKombatDB = MakgoraKombatDB or {}
    db = MakgoraKombatDB
    if db.channel == nil then db.channel = true end
    C_ChatInfo.RegisterAddonMessagePrefix(PREFIX)
    SLASH_MAKGORAKOMBAT1 = "/mk"
    SLASH_MAKGORAKOMBAT2 = "/makgora"
    SlashCmdList.MAKGORAKOMBAT = Command
    MakgoraKombat = { looking = looking, command = Command }
  elseif event == "PLAYER_ENTERING_WORLD" then
    if started then return end
    started = true
    Me()
    if db.shown then Show() end
    C_Timer.After(3, JoinChannel)
    -- Once the channel and the friends list are in: ask who is looking, and say so if we still are.
    C_Timer.After(6, function()
      Say("Q")
      if IsLooking() then Say("L") end
    end)
    C_Timer.NewTicker(TICK, Tick)
  elseif event == "PLAYER_LOGOUT" then
    if frame then db.shown = frame:IsShown() end
  elseif event == "CHAT_MSG_ADDON" then
    local prefix, text, kind = ...
    if prefix == PREFIX then Heard(text, kind) end
  elseif event == "BN_CHAT_MSG_ADDON" then
    local prefix, text = ...
    if prefix == PREFIX then Heard(text, "BATTLENET") end
  end
end)
