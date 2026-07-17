window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installPanicModule = function installPanicModule(bot) {
  const configStorageKey = "k9x.panic.config";
  const state = {
    running: false,
    timerId: null,
    lastHealth: null,
    lastTriggerAt: 0,
    lastDamageEventKey: null,
    lastWhisperAlarmAt: 0,
    lastWhisperKey: null,
    // Same style of de-dupe as the talk module (keys + signatures).
    seenWhisperKeys: [],
    seenWhisperSignatures: [],
    pendingReturnOrigin: null,
    pendingReturnModules: null,
    returnNotBeforeAt: 0,
    lastThreatAt: 0,
    lastReturnAttemptAt: 0,
  };

  // Match talk module: only care about recent chat lines for whisper alarms.
  const maxWhisperAgeMs = 2 * 60 * 1000;
  // Global / system tabs — never treat as private-message channels.
  const blockedChannelNames = new Set([
    "default",
    "console",
    "loot",
    "world",
    "trade",
    "help",
    "team",
  ]);

  const config = Object.assign(
    {
      tickMs: 200,
      triggerCooldownMs: 4000,
      returnToOriginEnabled: false,
      returnDelayMs: 300000,
      returnDelayJitterMs: 30000,
      returnRetryCooldownMs: 2000,
      unknownPlayerEnabled: false,
      healthLossEnabled: false,
      // Alarm only (does not flee) when someone whispers nearby or PMs you.
      whisperAlarmEnabled: false,
      whisperAlarmCooldownMs: 2000,
      // Private-message channels (LocalChannel named after a player) also count.
      whisperIncludePrivate: true,
      trustedNames: [],
      gameMasterNames: [],
    },
    bot.storage.get(configStorageKey, {})
  );

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function normalizeDelayMs(value, fallback = 0) {
    const next = Math.trunc(Number(value));
    return Number.isFinite(next) ? Math.max(0, next) : fallback;
  }

  function normalizePosition(position) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    const z = Number(position?.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return { x, y, z };
  }

  function isSamePosition(left, right) {
    return !!left && !!right && left.x === right.x && left.y === right.y && left.z === right.z;
  }

  function getTrustedNames() {
    return Array.from(
      new Set(
        (config.trustedNames || [])
          .map((name) => normalizeName(name))
          .filter(Boolean)
      )
    );
  }

  function getGameMasterNames() {
    return Array.from(
      new Set(
        (config.gameMasterNames || [])
          .map((name) => normalizeName(name))
          .filter(Boolean)
      )
    );
  }

  function getVisiblePlayers() {
    const me = bot.getPlayerPosition();
    const players = bot.xray?.getVisiblePlayers?.() || [];
    if (!me) {
      return players;
    }

    return players.filter((creature) => {
      const z = Number(creature?.__position?.z);
      return Number.isFinite(z) && Math.abs(z - me.z) <= 1;
    });
  }

  function getUnknownVisiblePlayers() {
    const trusted = new Set(getTrustedNames());

    return getVisiblePlayers().filter((creature) => {
      const name = normalizeName(creature?.name);
      return !!name && !trusted.has(name);
    });
  }

  function getTrustedVisiblePlayers() {
    const trusted = new Set(getTrustedNames());

    return getVisiblePlayers().filter((creature) => {
      const name = normalizeName(creature?.name);
      return !!name && trusted.has(name);
    });
  }

  function getVisibleGameMasters() {
    const gameMasters = new Set(getGameMasterNames());

    return getVisiblePlayers().filter((creature) => {
      const name = normalizeName(creature?.name);
      return !!name && gameMasters.has(name);
    });
  }

  function getRecentChannelMessages() {
    // Kept for damage parsing (health-loss panic).
    return getRawChatEntries().map((raw) => {
      const entry = raw.entry || {};
      return {
        channelName: raw.channelName,
        message: String(entry?.message || entry?.text || ""),
        time: entry?.__time || entry?.time || null,
      };
    });
  }

  function parseDamageMessage(entry) {
    const match = String(entry.message || "").match(
      /^You lose\s+(\d+)\s+hitpoints\s+due to an attack by\s+(.+?)\.$/i
    );

    if (!match) {
      return null;
    }

    return {
      amount: Number(match[1]),
      attackerName: match[2].trim(),
      time: entry.time,
      channelName: entry.channelName,
      key: `${entry.time || "no-time"}|${entry.message}`,
      message: entry.message,
    };
  }

  function getLatestDamageEvent() {
    const messages = getRecentChannelMessages()
      .map(parseDamageMessage)
      .filter(Boolean)
      .sort((a, b) => {
        const aTime = getMessageTimestamp({ time: a.time });
        const bTime = getMessageTimestamp({ time: b.time });
        return bTime - aTime;
      });

    return messages[0] || null;
  }

  // --- Chat helpers (mirrors talk module Default-channel listening) ---

  function getSelfNames() {
    return new Set(
      ["you", bot.getPlayerName?.(), window.gameClient?.player?.name, window.gameClient?.player?.state?.name]
        .map((name) => normalizeName(name))
        .filter(Boolean)
    );
  }

  function extractSenderFromMessage(message) {
    const text = String(message || "").trim();
    if (!text) {
      return { sender: null, body: "" };
    }

    const patterns = [
      /^\[[^\]]+\]\s*(.+?)(?:\s*\[\d+\])?\s+whispers:\s+(.+)$/i,
      /^\[[^\]]+\]\s*(.+?)(?:\s*\[\d+\])?\s+says:\s+(.+)$/i,
      /^\[[^\]]+\]\s*(.+?)(?:\s*\[\d+\])?\s+YELLS:\s+(.+)$/i,
      /^\[[^\]]+\]\s*([^:\n]{2,40}):\s+(.+)$/i,
      /^(.+?)(?:\s*\[\d+\])?\s+whispers:\s+(.+)$/i,
      /^(.+?)(?:\s*\[\d+\])?\s+says:\s+(.+)$/i,
      /^([^:\n]{2,40}):\s+(.+)$/i,
      /^From\s+([^:\n]{2,40}):\s+(.+)$/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        return {
          sender: String(match[1] || "").trim() || null,
          body: String(match[2] || "").trim(),
        };
      }
    }

    return { sender: null, body: text };
  }

  function isPrivateChannelObject(channel) {
    if (!channel) {
      return false;
    }

    if (typeof PrivateChannel === "function" && channel instanceof PrivateChannel) {
      return true;
    }

    // Fallback if the global constructor is unavailable after reloads.
    return channel.constructor?.name === "PrivateChannel";
  }

  function getChannelKind(channel) {
    const name = normalizeName(channel?.name);
    if (name === "default") {
      return "default";
    }

    if (blockedChannelNames.has(name)) {
      return "blocked";
    }

    if (isPrivateChannelObject(channel)) {
      return "private";
    }

    return "other";
  }

  function getRawChatEntries() {
    return (window.gameClient?.interface?.channelManager?.channels || []).flatMap((channel) =>
      (channel?.__contents || []).map((entry, index) => ({
        channelName: channel?.name || null,
        channelKind: getChannelKind(channel),
        entry,
        index,
      }))
    );
  }

  function readFormattedLine(entry) {
    if (!entry || typeof entry.format !== "function") {
      return "";
    }

    try {
      return String(entry.format() || "");
    } catch (error) {
      return "";
    }
  }

  function getInterfaceColorHex(colorId) {
    try {
      const iface = window.gameClient?.interface;
      if (!iface || typeof iface.getHexColor !== "function") {
        return null;
      }

      return String(iface.getHexColor(colorId) || "").toLowerCase();
    } catch (error) {
      return null;
    }
  }

  function toChatMessage(rawEntry) {
    const entry = rawEntry?.entry || {};
    // CharacterMessage.message is the body only; name/loudness/color live on the object.
    const rawMessage = String(entry?.message || entry?.text || "").trim();
    const formatted = readFormattedLine(entry);
    const parsed = extractSenderFromMessage(formatted || rawMessage);
    const sender =
      String(entry?.author || entry?.sender || entry?.name || parsed.sender || "").trim() || null;
    const body = String(entry?.text || parsed.body || rawMessage).trim();
    const time = entry?.__time || entry?.time || null;
    const senderType = entry?.type;
    const loudness = entry?.loudness;
    const color = entry?.color != null ? String(entry.color).toLowerCase() : null;
    const skyBlueHex = getInterfaceColorHex(
      window.gameClient?.interface?.COLORS?.SKYBLUE ?? window.Interface?.prototype?.COLORS?.SKYBLUE ?? 143
    );
    const isSkyBluePrivate = !!(color && skyBlueHex && color === skyBlueHex);
    const key = [
      rawEntry?.channelName || "",
      time instanceof Date ? time.toISOString() : time || "",
      sender || "",
      rawMessage || "",
      rawEntry?.index || 0,
    ].join("|");

    return {
      key,
      channelName: rawEntry?.channelName || null,
      channelKind: rawEntry?.channelKind || "other",
      sender,
      body,
      rawMessage,
      formatted,
      time,
      senderType,
      loudness,
      color,
      isSkyBluePrivate,
    };
  }

  function getChatMessages() {
    return getRawChatEntries().map(toChatMessage).filter((message) => message.body);
  }

  function getMessageTimestamp(message) {
    const rawTime = message?.time;
    if (typeof rawTime === "number" && Number.isFinite(rawTime)) {
      return rawTime < 1e12 ? rawTime * 1000 : rawTime;
    }

    if (rawTime instanceof Date) {
      return rawTime.getTime();
    }

    const parsed = Date.parse(String(rawTime || ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function getMessageSignature(message) {
    return [
      normalizeName(message?.channelName),
      normalizeName(message?.sender),
      normalizeName(message?.body || message?.rawMessage),
      String(getMessageTimestamp(message) || ""),
    ].join("|");
  }

  function trimSeenWhispers() {
    const maxSeenEntries = 200;
    if (state.seenWhisperKeys.length > maxSeenEntries) {
      state.seenWhisperKeys = state.seenWhisperKeys.slice(-maxSeenEntries);
    }

    if (state.seenWhisperSignatures.length > maxSeenEntries) {
      state.seenWhisperSignatures = state.seenWhisperSignatures.slice(-maxSeenEntries);
    }
  }

  function hasSeenWhisper(message) {
    return (
      state.seenWhisperKeys.includes(message?.key) ||
      state.seenWhisperSignatures.includes(getMessageSignature(message))
    );
  }

  function rememberSeenWhisper(message) {
    if (!message) {
      return;
    }

    if (message.key && !state.seenWhisperKeys.includes(message.key)) {
      state.seenWhisperKeys.push(message.key);
    }

    const signature = getMessageSignature(message);
    if (signature && !state.seenWhisperSignatures.includes(signature)) {
      state.seenWhisperSignatures.push(signature);
    }

    trimSeenWhispers();
  }

  function isSelfMessage(message) {
    // Only compare sender names. Do not use isRecentSentChat here — identical
    // text from another player would be wrongly ignored.
    return getSelfNames().has(normalizeName(message?.sender));
  }

  function isTrustedSender(message) {
    const senderName = normalizeName(message?.sender);
    if (!senderName) {
      return false;
    }

    return getTrustedNames().includes(senderName);
  }

  function isSystemMessage(message) {
    const npcType = window.CONST?.TYPES?.NPC;
    return npcType != null && message?.senderType === npcType;
  }

  function isWhisperMessage(message) {
    if (!message) {
      return false;
    }

    // 1) Nearby whisper on Default (client loudness 0 = whisper).
    if (Number(message.loudness) === 0) {
      return true;
    }

    // 2) Formatted UI line: "Name whispers: ..."
    if (/whispers:/i.test(String(message.formatted || ""))) {
      return true;
    }

    if (config.whisperIncludePrivate === false) {
      return false;
    }

    // 3) Real private-message tabs (PrivateChannel named after a player).
    if (message.channelKind === "private") {
      return true;
    }

    // 4) Incoming PM with no private tab open lands on Default as skyblue
    //    "says:" (loudness defaults to 1) — see handleReceivePrivateMessage.
    if (message.channelKind === "default" && message.isSkyBluePrivate) {
      return true;
    }

    return false;
  }

  function getWhisperMessages() {
    return getChatMessages().filter(isWhisperMessage);
  }

  function getNewestPendingWhisper() {
    const pendingMessages = getWhisperMessages().filter((message) => {
      if (!message?.body || !message?.key) {
        return false;
      }

      if (hasSeenWhisper(message)) {
        return false;
      }

      // Skip own messages / NPCs / trusted. Mark seen so they never reappear.
      if (!message.sender || isSelfMessage(message) || isSystemMessage(message) || isTrustedSender(message)) {
        rememberSeenWhisper(message);
        return false;
      }

      const timestamp = getMessageTimestamp(message);
      if (timestamp && Date.now() - timestamp > maxWhisperAgeMs) {
        rememberSeenWhisper(message);
        return false;
      }

      return true;
    });

    if (!pendingMessages.length) {
      return null;
    }

    return {
      targetMessage: pendingMessages[pendingMessages.length - 1],
      pendingMessages,
    };
  }

  function seedSeenWhispers() {
    getWhisperMessages().forEach((message) => rememberSeenWhisper(message));
  }

  function checkWhispers(now = Date.now()) {
    if (!config.whisperAlarmEnabled) {
      return false;
    }

    const pending = getNewestPendingWhisper();
    if (!pending) {
      return false;
    }

    // Mark the whole batch seen so backlog never re-fires.
    pending.pendingMessages.forEach((message) => rememberSeenWhisper(message));

    const cooldownMs = normalizeDelayMs(config.whisperAlarmCooldownMs, 2000);
    if (now - state.lastWhisperAlarmAt < cooldownMs) {
      return false;
    }

    const latest = pending.targetMessage;
    state.lastWhisperAlarmAt = now;
    state.lastWhisperKey = latest.key;
    bot.playAlarm?.();
    bot.log("panic whisper alarm", {
      sender: latest.sender,
      body: latest.body,
      channelName: latest.channelName,
      channelKind: latest.channelKind,
      loudness: latest.loudness,
      isSkyBluePrivate: !!latest.isSkyBluePrivate,
      count: pending.pendingMessages.length,
    });
    // Alarm only — do not flee / stop modules.
    return false;
  }

  function getReturnDelayMs() {
    const baseDelayMs = normalizeDelayMs(config.returnDelayMs, 0);
    const jitterMs = normalizeDelayMs(config.returnDelayJitterMs, 0);
    if (!jitterMs) {
      return baseDelayMs;
    }

    const randomOffset = Math.floor(Math.random() * ((jitterMs * 2) + 1)) - jitterMs;
    return Math.max(0, baseDelayMs + randomOffset);
  }

  function clearPendingReturn() {
    state.pendingReturnOrigin = null;
    state.pendingReturnModules = null;
    state.returnNotBeforeAt = 0;
    state.lastThreatAt = 0;
    state.lastReturnAttemptAt = 0;
  }

  function snapshotInterruptedModules() {
    return {
      caveRunning: !!bot.cave?.status?.().running,
      equipRingRunning: !!bot.equipRing?.status?.().running,
    };
  }

  function armPendingReturn(now = Date.now(), origin = normalizePosition(bot.getPlayerPosition())) {
    if (!config.returnToOriginEnabled) {
      clearPendingReturn();
      return;
    }

    if (!state.pendingReturnOrigin && origin) {
      state.pendingReturnOrigin = origin;
      state.pendingReturnModules = snapshotInterruptedModules();
    }

    if (!state.pendingReturnOrigin) {
      return;
    }

    state.lastThreatAt = now;
    state.returnNotBeforeAt = now + getReturnDelayMs();
  }

  function isReturnCoastClear() {
    return !getVisibleGameMasters().length && !getUnknownVisiblePlayers().length;
  }

  function restoreInterruptedModules() {
    if (state.pendingReturnModules?.caveRunning) {
      bot.cave?.start?.();
    }

    if (state.pendingReturnModules?.equipRingRunning) {
      bot.equipRing?.start?.();
      bot.ui?.refreshEquipRingStatus?.();
    }
  }

  function tryReturnToOrigin(now = Date.now()) {
    if (!config.returnToOriginEnabled || !state.pendingReturnOrigin || !state.returnNotBeforeAt) {
      return false;
    }

    if (now < state.returnNotBeforeAt) {
      return false;
    }

    if (!isReturnCoastClear()) {
      return false;
    }

    if (now - state.lastReturnAttemptAt < normalizeDelayMs(config.returnRetryCooldownMs, 2000)) {
      return false;
    }

    const currentPosition = normalizePosition(bot.getPlayerPosition());
    if (isSamePosition(currentPosition, state.pendingReturnOrigin)) {
      bot.log("panic return completed", {
        origin: state.pendingReturnOrigin,
        threatAgeMs: now - state.lastThreatAt,
      });
      restoreInterruptedModules();
      clearPendingReturn();
      return true;
    }

    state.lastReturnAttemptAt = now;
    const moved =
      !!bot.cave?.goToPosition?.(state.pendingReturnOrigin) ||
      !!bot.pz?.goToTile?.({ __position: state.pendingReturnOrigin });

    if (moved) {
      bot.log("panic returning to origin", {
        origin: state.pendingReturnOrigin,
        threatAgeMs: now - state.lastThreatAt,
      });
      return true;
    }

    bot.log("panic return pathing failed", { origin: state.pendingReturnOrigin });
    return false;
  }

  function triggerPanic(reason, details = {}) {
    const now = Date.now();
    armPendingReturn(now);

    if (now - state.lastTriggerAt < config.triggerCooldownMs) {
      return false;
    }

    state.lastTriggerAt = now;
    bot.playAlarm?.();
    bot.log("panic triggered", { reason, ...details });

    if (bot.cave?.stop) {
      bot.cave.stop({ persistEnabled: false });
    }

    if (bot.equipRing?.stop) {
      bot.equipRing.stop({ persistEnabled: false });
      bot.ui?.refreshEquipRingStatus?.();
    }

    return !!bot.pz?.goToHomePz?.();
  }

  function triggerGameMasterKillSwitch(players) {
    const detectedPlayers = (players || []).map((player) => player?.name).filter(Boolean);

    bot.playAlarm?.();
    bot.log("game master kill switch triggered", { players: detectedPlayers });

    if (bot.rune?.stop) {
      bot.rune.stop();
    }

    if (bot.eat?.stop) {
      bot.eat.stop();
    }

    if (bot.invisible?.stop) {
      bot.invisible.stop();
    }

    if (bot.magicShield?.stop) {
      bot.magicShield.stop();
    }

    if (bot.cave?.stop) {
      bot.cave.stop();
    }

    if (bot.attack?.stop) {
      bot.attack.stop();
    }

    if (bot.equipRing?.stop) {
      bot.equipRing.stop();
    }

    clearPendingReturn();
    config.unknownPlayerEnabled = false;
    config.healthLossEnabled = false;
    persistConfig();
    stop();

    bot.ui?.refreshPanicStatus?.();
    bot.ui?.refreshRuneStatus?.();
    bot.ui?.refreshAutoEatStatus?.();
    bot.ui?.refreshAutoInvisibleStatus?.();
    bot.ui?.refreshAutoMagicShieldStatus?.();
    bot.ui?.refreshAutoAttackStatus?.();
    bot.ui?.refreshCaveStatus?.();
    bot.ui?.refreshEquipRingStatus?.();
    return true;
  }

  function checkGameMasters() {
    if (!getGameMasterNames().length) {
      return false;
    }

    const visibleGameMasters = getVisibleGameMasters();
    if (!visibleGameMasters.length) {
      return false;
    }

    return triggerGameMasterKillSwitch(visibleGameMasters);
  }

  function checkUnknownPlayers() {
    if (!config.unknownPlayerEnabled) {
      return false;
    }

    const unknownPlayers = getUnknownVisiblePlayers();
    if (!unknownPlayers.length) {
      return false;
    }

    return triggerPanic("unknown-player", {
      players: unknownPlayers.map((player) => player.name),
    });
  }

  function checkHealthLoss() {
    if (!config.healthLossEnabled) {
      return false;
    }

    const playerState = bot.getPlayerState();
    const currentHealth = Number(playerState?.health ?? 0);

    if (state.lastHealth == null) {
      state.lastHealth = currentHealth;
      return false;
    }

    const lostHealth = currentHealth < state.lastHealth;
    state.lastHealth = currentHealth;

    if (!lostHealth) {
      return false;
    }

    const latestDamageEvent = getLatestDamageEvent();
    if (latestDamageEvent && latestDamageEvent.key !== state.lastDamageEventKey) {
      state.lastDamageEventKey = latestDamageEvent.key;

      const trustedNames = new Set(getTrustedNames());
      const attackerName = normalizeName(latestDamageEvent.attackerName);

      if (attackerName && trustedNames.has(attackerName)) {
        bot.log("ignored health-loss panic because attacker is trusted", {
          attacker: latestDamageEvent.attackerName,
          amount: latestDamageEvent.amount,
          currentHealth,
        });
        return false;
      }

      return triggerPanic("health-loss", {
        currentHealth,
        attacker: latestDamageEvent.attackerName,
        amount: latestDamageEvent.amount,
      });
    }

    const unknownPlayers = getUnknownVisiblePlayers();
    if (!unknownPlayers.length) {
      const trustedPlayers = getTrustedVisiblePlayers();
      if (trustedPlayers.length) {
        bot.log("ignored health-loss panic because only trusted players are nearby", {
          players: trustedPlayers.map((player) => player.name),
          currentHealth,
        });
        return false;
      }
    }

    return triggerPanic("health-loss", { currentHealth });
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function tick() {
    if (!state.running) return;

    try {
      // Whisper is alarm-only and must not block return-to-origin / flee logic.
      checkWhispers();
      const triggered = checkGameMasters() || checkUnknownPlayers() || checkHealthLoss();
      if (!triggered) {
        tryReturnToOrigin();
      }
    } finally {
      scheduleNextTick();
    }
  }

  function shouldRun() {
    return !!(
      getGameMasterNames().length ||
      config.unknownPlayerEnabled ||
      config.healthLossEnabled ||
      config.whisperAlarmEnabled
    );
  }

  function start() {
    if (state.running) {
      return false;
    }

    state.running = true;
    state.lastHealth = Number(bot.getPlayerState()?.health ?? 0);
    state.lastDamageEventKey = getLatestDamageEvent()?.key || null;
    // Ignore whispers already in chat history so reloading doesn't spam alarms.
    seedSeenWhispers();
    bot.log("panic runner started", { ...config });
    tick();
    return true;
  }

  function stop() {
    if (!state.running && state.timerId == null) {
      state.lastHealth = null;
      return false;
    }

    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    state.lastHealth = null;
    state.lastDamageEventKey = null;
    state.lastWhisperKey = null;
    state.seenWhisperKeys = [];
    state.seenWhisperSignatures = [];
    clearPendingReturn();
    bot.log("panic runner stopped");
    return true;
  }

  function syncRunningState() {
    if (shouldRun()) {
      const wasRunning = state.running;
      start();
      // If runner was already up (e.g. health panic) and whisper was just
      // enabled, seed history so old chat lines do not all fire at once.
      if (wasRunning && config.whisperAlarmEnabled) {
        seedSeenWhispers();
      }
    } else {
      stop();
    }
  }

  function updateConfig(nextConfig = {}) {
    const next = { ...nextConfig };

    if (Array.isArray(next.trustedNames)) {
      next.trustedNames = next.trustedNames
        .map((name) => String(name || "").trim())
        .filter(Boolean);
    }

    if (Array.isArray(next.gameMasterNames)) {
      next.gameMasterNames = next.gameMasterNames
        .map((name) => String(name || "").trim())
        .filter(Boolean);
    }

    if ("triggerCooldownMs" in next) {
      next.triggerCooldownMs = normalizeDelayMs(next.triggerCooldownMs, config.triggerCooldownMs);
    }

    if ("returnDelayMs" in next) {
      next.returnDelayMs = normalizeDelayMs(next.returnDelayMs, config.returnDelayMs);
    }

    if ("returnDelayJitterMs" in next) {
      next.returnDelayJitterMs = normalizeDelayMs(next.returnDelayJitterMs, config.returnDelayJitterMs);
    }

    if ("returnRetryCooldownMs" in next) {
      next.returnRetryCooldownMs = normalizeDelayMs(
        next.returnRetryCooldownMs,
        config.returnRetryCooldownMs
      );
    }

    if ("whisperAlarmCooldownMs" in next) {
      next.whisperAlarmCooldownMs = normalizeDelayMs(
        next.whisperAlarmCooldownMs,
        config.whisperAlarmCooldownMs
      );
    }

    if ("whisperAlarmEnabled" in next) {
      next.whisperAlarmEnabled = !!next.whisperAlarmEnabled;
    }

    if ("whisperIncludePrivate" in next) {
      next.whisperIncludePrivate = next.whisperIncludePrivate !== false;
    }

    Object.assign(config, next);
    if (!config.returnToOriginEnabled) {
      clearPendingReturn();
    }
    persistConfig();
    syncRunningState();
    bot.log("panic runner config updated", { ...config });
    return { ...config };
  }

  function status() {
    return {
      running: state.running,
      config: {
        ...config,
        trustedNames: [...config.trustedNames],
        gameMasterNames: [...config.gameMasterNames],
      },
      visiblePlayers: getVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      unknownVisiblePlayers: getUnknownVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      trustedVisiblePlayers: getTrustedVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      visibleGameMasters: getVisibleGameMasters().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      latestDamageEvent: getLatestDamageEvent(),
      lastTriggerAt: state.lastTriggerAt,
      lastWhisperAlarmAt: state.lastWhisperAlarmAt,
      lastWhisperKey: state.lastWhisperKey,
      recentWhispers: getWhisperMessages().slice(-5).map((message) => ({
        key: message.key,
        sender: message.sender,
        body: message.body,
        channelName: message.channelName,
        channelKind: message.channelKind,
        loudness: message.loudness,
        isSkyBluePrivate: !!message.isSkyBluePrivate,
        isSelf: isSelfMessage(message),
        formatted: message.formatted || null,
        time: message.time,
      })),
      pendingReturn: state.pendingReturnOrigin
        ? {
            origin: { ...state.pendingReturnOrigin },
            modules: state.pendingReturnModules ? { ...state.pendingReturnModules } : null,
            returnNotBeforeAt: state.returnNotBeforeAt,
            lastThreatAt: state.lastThreatAt,
            lastReturnAttemptAt: state.lastReturnAttemptAt,
            coastClear: isReturnCoastClear(),
          }
        : null,
    };
  }

  if (shouldRun()) {
    start();
  }

  bot.panic = {
    start,
    stop,
    status,
    updateConfig,
    getVisiblePlayers,
    getUnknownVisiblePlayers,
    getTrustedVisiblePlayers,
    getVisibleGameMasters,
    getTrustedNames,
    getGameMasterNames,
    config,
  };
};
