window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.createBot = function createBot() {
  const cleanups = [];
  const defaultAlarmAudioSrc = "https://upload.wikimedia.org/wikipedia/commons/transcoded/3/3f/ACA_Allertor_125_video.ogv/ACA_Allertor_125_video.ogv.480p.vp9.webm";
  const alarmAudioSrcStorageKey = "k9x.audio.alarmSrc";
  const recentSentChats = [];
  const reconnectButtonSelectors = [
    "button",
    "[role=\"button\"]",
    "input[type=\"button\"]",
    "input[type=\"submit\"]",
    "a",
    ".button",
    ".btn",
  ];
  let alarmAudio = null;
  let reconnectObserver = null;
  let reconnectPollTimerId = null;
  let lastReconnectClickAt = 0;

  function addCleanup(fn) {
    if (typeof fn === "function") {
      cleanups.push(fn);
    }
  }

  function runCleanups() {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try {
        fn();
      } catch (error) {
        console.error("[minibia-bot] cleanup failed", error);
      }
    }
  }

  function getStoredAlarmAudioSrc() {
    try {
      const value = window.localStorage.getItem(alarmAudioSrcStorageKey);
      return value == null ? defaultAlarmAudioSrc : JSON.parse(value);
    } catch (error) {
      return defaultAlarmAudioSrc;
    }
  }

  function setStoredAlarmAudioSrc(src) {
    window.localStorage.setItem(alarmAudioSrcStorageKey, JSON.stringify(src));
    return src;
  }

  function destroyAlarmAudio() {
    if (!alarmAudio) {
      return;
    }

    try {
      alarmAudio.pause();
      alarmAudio.removeAttribute("src");
      alarmAudio.load();
    } catch (error) {
      console.error("[minibia-bot] audio cleanup failed", error);
    }

    alarmAudio = null;
  }

  function getAlarmAudio() {
    const src = getStoredAlarmAudioSrc();
    if (!src) {
      return null;
    }

    if (!alarmAudio) {
      alarmAudio = new Audio(src);
      alarmAudio.preload = "auto";
    } else if (alarmAudio.src !== src) {
      alarmAudio.pause();
      alarmAudio = new Audio(src);
      alarmAudio.preload = "auto";
    }

    return alarmAudio;
  }

  function normalizeChatText(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function rememberSentChat(text) {
    const normalized = normalizeChatText(text);
    if (!normalized) {
      return;
    }

    recentSentChats.push({
      text: normalized,
      at: Date.now(),
    });

    const maxEntries = 20;
    if (recentSentChats.length > maxEntries) {
      recentSentChats.splice(0, recentSentChats.length - maxEntries);
    }
  }

  function isRecentSentChat(text, withinMs = 45000) {
    const normalized = normalizeChatText(text);
    if (!normalized) {
      return false;
    }

    const cutoff = Date.now() - withinMs;
    for (let index = recentSentChats.length - 1; index >= 0; index -= 1) {
      const entry = recentSentChats[index];
      if (entry.at < cutoff) {
        continue;
      }

      if (entry.text === normalized) {
        return true;
      }
    }

    return false;
  }

  function normalizeUiText(text) {
    return String(text || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function getSkillWindowValue(skillNames = []) {
    for (const skillName of skillNames) {
      const value =
        document.querySelector(`#skill-window div[skill="${skillName}"] .skill`)?.textContent?.trim() ||
        null;
      if (value) {
        return value;
      }
    }

    return null;
  }

  function parseNumberText(value) {
    if (value == null) {
      return null;
    }

    const normalized = String(value).replace(/[^\d.-]/g, "");
    if (!normalized) {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeSpellWords(words) {
    return String(words || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function normalizeSpellSid(sid) {
    const value = Number(sid);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : null;
  }

  function resolveSpellSid(options = {}) {
    const explicitSid = normalizeSpellSid(options.sid);
    if (explicitSid != null) {
      return explicitSid;
    }

    const normalizedWords = normalizeSpellWords(options.words);
    if (!normalizedWords) {
      return null;
    }

    const spells = window.gameClient?.interface?.SPELLS;
    if (!spells || typeof spells.forEach !== "function") {
      return null;
    }

    let matchedSid = null;
    spells.forEach((spell, spellSid) => {
      if (matchedSid != null) {
        return;
      }

      if (normalizeSpellWords(spell?.words) === normalizedWords) {
        matchedSid = spellSid;
      }
    });

    return matchedSid;
  }

  function isSpellOnCooldown(spellbook, spellSid) {
    if (!spellbook || spellSid == null) {
      return false;
    }

    const bucket =
      typeof spellbook.__bucketFor === "function"
        ? spellbook.__bucketFor(spellSid)
        : spellbook.GLOBAL_COOLDOWN_HEAL;

    return !!(
      spellbook.cooldowns?.has?.(spellbook.GLOBAL_COOLDOWN) ||
      spellbook.cooldowns?.has?.(spellbook.GLOBAL_COOLDOWN_HEAL) ||
      spellbook.cooldowns?.has?.(bucket) ||
      spellbook.cooldowns?.has?.(spellSid)
    );
  }

  function castSpellPacket(spellSid) {
    const spellbook = window.gameClient?.player?.spellbook;
    if (!spellbook?.spells?.has?.(spellSid)) {
      return false;
    }

    if (isSpellOnCooldown(spellbook, spellSid)) {
      return false;
    }

    if (typeof spellbook.castSpell === "function") {
      spellbook.castSpell(spellSid);
      return true;
    }

    if (typeof SpellCastPacket === "function" && typeof window.gameClient?.send === "function") {
      window.gameClient.send(new SpellCastPacket(spellSid));
      return true;
    }

    return false;
  }

  function isVisibleElement(element) {
    if (!(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  }

  function getElementUiText(element) {
    if (!(element instanceof Element)) {
      return "";
    }

    return normalizeUiText(
      element.textContent ||
      element.innerText ||
      element.getAttribute("value") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      ""
    );
  }

  function findReconnectElement() {
    for (const selector of reconnectButtonSelectors) {
      const candidates = document.querySelectorAll(selector);
      for (const candidate of candidates) {
        if (!isVisibleElement(candidate)) {
          continue;
        }

        if (getElementUiText(candidate) === "reconnect") {
          return candidate;
        }
      }
    }

    return null;
  }

  function tryClickReconnect() {
    const now = Date.now();
    if (now - lastReconnectClickAt < 3000) {
      return false;
    }

    const reconnectElement = findReconnectElement();
    if (!reconnectElement) {
      return false;
    }

    reconnectElement.click();
    lastReconnectClickAt = now;
    console.log("[minibia-bot] clicked reconnect");
    return true;
  }

  function startReconnectWatcher() {
    if (reconnectObserver || reconnectPollTimerId) {
      return;
    }

    const runCheck = () => {
      try {
        tryClickReconnect();
      } catch (error) {
        console.error("[minibia-bot] reconnect watcher failed", error);
      }
    };

    reconnectObserver = new MutationObserver(runCheck);
    reconnectObserver.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "hidden", "aria-hidden", "value"],
    });

    reconnectPollTimerId = window.setInterval(runCheck, 2000);
    runCheck();
  }

  function stopReconnectWatcher() {
    if (reconnectObserver) {
      reconnectObserver.disconnect();
      reconnectObserver = null;
    }

    if (reconnectPollTimerId) {
      window.clearInterval(reconnectPollTimerId);
      reconnectPollTimerId = null;
    }
  }

  startReconnectWatcher();

  return {
    version: "0.3.1",
    addCleanup,
    destroy() {
      if (this.panic?.stop) {
        this.panic.stop();
      }

      if (this.rune?.stop) {
        this.rune.stop({ persistEnabled: false });
      }

      if (this.heal?.stop) {
        this.heal.stop({ persistEnabled: false });
      }

      if (this.invisible?.stop) {
        this.invisible.stop({ persistEnabled: false });
      }

      if (this.attack?.stop) {
        this.attack.stop({ persistEnabled: false });
      }

      if (this.cave?.stop) {
        this.cave.stop({ persistEnabled: false });
      }

      if (this.equipRing?.stop) {
        this.equipRing.stop({ persistEnabled: false });
      }

      if (this.eat?.stop) {
        this.eat.stop({ persistEnabled: false });
      }

      if (this.fishing?.stop) {
        this.fishing.stop({ persistEnabled: false });
      }

      if (this.talk?.stop) {
        this.talk.stop({ persistEnabled: false });
      }

      if (this.ui?.destroy) {
        this.ui.destroy();
      }

      stopReconnectWatcher();
      destroyAlarmAudio();
      runCleanups();
    },
    log(...args) {
      console.log("[minibia-bot]", ...args);
    },
    storage: {
      get(key, fallback = null) {
        try {
          const value = window.localStorage.getItem(key);
          return value == null ? fallback : JSON.parse(value);
        } catch (error) {
          return fallback;
        }
      },
      set(key, value) {
        window.localStorage.setItem(key, JSON.stringify(value));
        return value;
      },
      remove(key) {
        window.localStorage.removeItem(key);
      },
    },
    getPlayerPosition() {
      return window.gameClient?.player?.getPosition?.() || null;
    },
    getPlayerState() {
      return window.gameClient?.player?.state || null;
    },
    getPlayerName() {
      return (
        String(
          this.getPlayerState()?.name ||
          window.gameClient?.player?.name ||
          window.gameClient?.player?.state?.name ||
          ""
        ).trim() || null
      );
    },
    getPlayerSnapshot() {
      const playerState = this.getPlayerState() || {};
      const levelText = getSkillWindowValue(["level"]);
      const magicLevelText = getSkillWindowValue(["magic", "magic-level", "mlvl"]);
      const experienceText = getSkillWindowValue(["experience", "exp"]);
      const capacityText = getSkillWindowValue(["capacity", "cap"]);

      return {
        name: this.getPlayerName(),
        level: parseNumberText(playerState.level) ?? parseNumberText(levelText),
        magicLevel: parseNumberText(playerState.magicLevel ?? playerState.magic_level) ?? parseNumberText(magicLevelText),
        health: parseNumberText(playerState.health),
        maxHealth: parseNumberText(playerState.maxHealth),
        mana: parseNumberText(playerState.mana),
        maxMana: parseNumberText(playerState.maxMana),
        experience: parseNumberText(playerState.experience ?? playerState.exp) ?? parseNumberText(experienceText),
        capacity: parseNumberText(playerState.capacity ?? playerState.cap) ?? parseNumberText(capacityText),
        food: getSkillWindowValue(["food"]),
      };
    },
    sendChat(text) {
      const channelManager = window.gameClient?.interface?.channelManager;
      if (!channelManager || !text) {
        return false;
      }

      channelManager.sendMessageText(text);
      rememberSentChat(text);
      this.log("sent chat:", text);
      return true;
    },
    isRecentSentChat(text, withinMs) {
      return isRecentSentChat(text, withinMs);
    },
    clickReconnect() {
      return tryClickReconnect();
    },
    clickHotbar(index) {
      const button = window.gameClient?.interface?.hotbarManager?.slots?.[index]?.canvas?.canvas;
      if (!button) {
        return false;
      }

      button.click();
      return true;
    },
    resolveSpellSid(options = {}) {
      return resolveSpellSid(options);
    },
    castSpell(options = {}) {
      const words = String(options.words || "").trim();
      const hotbarSlot = Number(options.hotbarSlot);
      const fallbackChat = options.fallbackChat !== false;
      const spellSid = resolveSpellSid(options);

      if (spellSid != null) {
        const spellbook = window.gameClient?.player?.spellbook;
        if (spellbook?.spells?.has?.(spellSid)) {
          if (isSpellOnCooldown(spellbook, spellSid)) {
            return { ok: false, method: "cooldown", sid: spellSid, words: words || null };
          }

          if (castSpellPacket(spellSid)) {
            this.log("cast spell", { sid: spellSid, words: words || null });
            return { ok: true, method: "packet", sid: spellSid, words: words || null };
          }
        }
      }

      if (Number.isFinite(hotbarSlot) && hotbarSlot >= 1 && hotbarSlot <= 12) {
        if (this.clickHotbar(hotbarSlot - 1)) {
          return { ok: true, method: "hotbar", sid: spellSid, slot: Math.trunc(hotbarSlot) };
        }
      }

      if (fallbackChat && words && this.sendChat(words)) {
        return { ok: true, method: "chat", sid: spellSid, words };
      }

      return { ok: false, method: null, sid: spellSid, words: words || null };
    },
    castSpellByWords(words, options = {}) {
      return this.castSpell({ ...options, words });
    },
    getAlarmAudioSrc() {
      return getStoredAlarmAudioSrc();
    },
    setAlarmAudioSrc(src) {
      const nextSrc = String(src || "").trim();
      if (!nextSrc) {
        return false;
      }

      setStoredAlarmAudioSrc(nextSrc);
      destroyAlarmAudio();
      this.log("alarm audio updated", nextSrc);
      return true;
    },
    unlockAudio() {
      try {
        const audio = getAlarmAudio();
        if (!audio) {
          return false;
        }

        audio.muted = true;
        const playResult = audio.play();

        if (playResult && typeof playResult.then === "function") {
          playResult
            .then(() => {
              audio.pause();
              audio.currentTime = 0;
              audio.muted = false;
            })
            .catch((error) => {
              audio.muted = false;
              this.log("audio unlock failed", error?.message || error);
            });
        } else {
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        }

        return true;
      } catch (error) {
        console.error("[minibia-bot] audio unlock failed", error);
        return false;
      }
    },
    playAlarm() {
      try {
        const audio = getAlarmAudio();
        if (!audio) {
          return false;
        }

        audio.pause();
        audio.currentTime = 0;
        audio.muted = false;
        const playResult = audio.play();

        if (playResult && typeof playResult.catch === "function") {
          playResult.catch((error) => {
            this.log("alarm playback failed", error?.message || error);
          });
        }

        return true;
      } catch (error) {
        console.error("[minibia-bot] alarm failed", error);
        return false;
      }
    },
  };
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installPzModule = function installPzModule(bot) {
  const homeStorageKey = "k9x.pz.home";

  function getLoadedTiles() {
    const chunks = window.gameClient?.world?.chunks || [];
    const tiles = [];

    for (const chunk of chunks) {
      if (!chunk?.tiles) continue;

      for (const tile of chunk.tiles) {
        if (tile?.__position) {
          tiles.push(tile);
        }
      }
    }

    return tiles;
  }

  function hasPzFlag(tile) {
    return !!tile && ((tile.flags || 0) & 1) !== 0;
  }

  function getPzCandidates() {
    const me = bot.getPlayerPosition();
    if (!me) return [];

    return getLoadedTiles()
      .filter((tile) => hasPzFlag(tile) && tile.__position?.z === me.z)
      .map((tile) => {
        const p = tile.__position;
        return {
          tile,
          x: p.x,
          y: p.y,
          z: p.z,
          flags: tile.flags || 0,
          dist: Math.abs(p.x - me.x) + Math.abs(p.y - me.y),
        };
      })
      .sort((a, b) => a.dist - b.dist);
  }

  function goToTile(tile) {
    if (!tile?.__position) return false;

    const from = bot.getPlayerPosition();
    if (!from) return false;

    const p = tile.__position;
    const to = new Position(p.x, p.y, p.z);

    try {
      window.gameClient?.world?.pathfinder?.findPath?.(from, to);
      bot.log("pathing to", { x: p.x, y: p.y, z: p.z, flags: tile.flags });
      return true;
    } catch (error) {
      bot.log("pathing failed", { x: p.x, y: p.y, z: p.z, error: error?.message });
      return false;
    }
  }

  function goToNearestPz(maxAttempts = 20) {
    const candidates = getPzCandidates().slice(0, maxAttempts);

    if (!candidates.length) {
      bot.log("No PZ candidates found");
      return false;
    }

    for (const candidate of candidates) {
      if (goToTile(candidate.tile)) {
        bot.log("selected PZ", {
          x: candidate.x,
          y: candidate.y,
          z: candidate.z,
          flags: candidate.flags,
          dist: candidate.dist,
        });
        return true;
      }
    }

    bot.log("No PZ candidate accepted by pathfinder");
    return false;
  }

  function setHomePz(x, y, z) {
    const home = { x, y, z };
    bot.storage.set(homeStorageKey, home);
    bot.log("home PZ set", home);
    return home;
  }

  function setHomePzCurrentSpot() {
    const pos = bot.getPlayerPosition();
    if (!pos) {
      bot.log("Could not read current position");
      return null;
    }

    return setHomePz(pos.x, pos.y, pos.z);
  }

  function getHomePz() {
    return bot.storage.get(homeStorageKey, null);
  }

  function clearHomePz() {
    bot.storage.remove(homeStorageKey);
    bot.log("home PZ cleared");
  }

  function getNearestPzTo(x, y, z) {
    const candidates = getLoadedTiles()
      .filter((tile) => hasPzFlag(tile) && tile.__position?.z === z)
      .map((tile) => {
        const p = tile.__position;
        return {
          tile,
          x: p.x,
          y: p.y,
          z: p.z,
          flags: tile.flags || 0,
          dist: Math.abs(p.x - x) + Math.abs(p.y - y),
        };
      })
      .sort((a, b) => a.dist - b.dist);

    return candidates[0] || null;
  }

  function goToHomePz() {
    const home = getHomePz();
    if (!home) {
      bot.log("No home PZ set");
      return false;
    }

    const candidate = getNearestPzTo(home.x, home.y, home.z);
    if (!candidate) {
      bot.log("No loaded PZ found near saved home", home);
      return false;
    }

    bot.log("home candidate", {
      x: candidate.x,
      y: candidate.y,
      z: candidate.z,
      flags: candidate.flags,
      distFromHome: candidate.dist,
    });

    return goToTile(candidate.tile);
  }

  function printPzCandidates(limit = 10) {
    const rows = getPzCandidates()
      .slice(0, limit)
      .map((candidate) => ({
        x: candidate.x,
        y: candidate.y,
        z: candidate.z,
        flags: candidate.flags,
        dist: candidate.dist,
      }));

    console.table(rows);
    return rows;
  }

  bot.pz = {
    getLoadedTiles,
    getPzCandidates,
    goToTile,
    goToNearestPz,
    setHomePz,
    setHomePzCurrentSpot,
    getHomePz,
    clearHomePz,
    getNearestPzTo,
    goToHomePz,
    printPzCandidates,
  };

  bot.goToNearestPz = goToNearestPz;
  bot.setHomePz = setHomePz;
  bot.setHomePzCurrentSpot = setHomePzCurrentSpot;
  bot.getHomePz = getHomePz;
  bot.clearHomePz = clearHomePz;
  bot.goToHomePz = goToHomePz;
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installXrayModule = function installXrayModule(bot) {
  const configStorageKey = "k9x.xray.config";
  const overlayRootId = "minibia-bot-xray-overlay";
  const overlayStyleId = "minibia-bot-xray-overlay-style";
  const overlayState = {
    running: false,
    timerId: null,
  };
  const config = Object.assign(
    {
      overlayEnabled: false,
      selectedFloor: null,
    },
    bot.storage.get(configStorageKey, {})
  );

  config.selectedFloor = normalizeSelectedFloor(config.selectedFloor);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function normalizeSelectedFloor(value) {
    if (value == null || value === "" || value === "all") {
      return null;
    }

    const floor = Number(value);
    if (!Number.isFinite(floor)) {
      return null;
    }

    return Math.trunc(floor);
  }

  function isWithinVisibleRange(me, pos) {
    if (!me || !pos) {
      return false;
    }

    const dx = Math.abs(pos.x - me.x);
    const dy = Math.abs(pos.y - me.y);
    return dx <= 8 && dy <= 6;
  }

  function getTrackedCreatures() {
    const myState = bot.getPlayerState();
    const myId = window.gameClient?.player?.id;
    const myName = normalizeName(myState?.name);

    return Object.values(window.gameClient?.world?.activeCreatures || {}).filter((creature) => {
      if (!creature) return false;
      if (creature.id === myId) return false;

      const name = normalizeName(creature.name);
      if (name && name === myName) return false;

      return true;
    });
  }

  function getVisibleCreatures() {
    const me = bot.getPlayerPosition();
    if (!me) {
      return [];
    }

    // Keep the visible query strict; panic logic relies on this staying screen-limited.
    return getTrackedCreatures().filter((creature) => isWithinVisibleRange(me, creature.__position));
  }

  function getVisiblePlayers(options = {}) {
    const { sameFloorOnly = false } = options;
    const me = bot.getPlayerPosition();
    if (!me) {
      return [];
    }

    return getVisibleCreatures().filter((creature) => {
      if (creature?.type !== 0) {
        return false;
      }

      if (!sameFloorOnly) {
        return true;
      }

      return creature.__position?.z === me.z;
    });
  }

  function getVisibleMonsters(options = {}) {
    const { sameFloorOnly = false } = options;
    const me = bot.getPlayerPosition();
    if (!me) {
      return [];
    }

    return getVisibleCreatures().filter((creature) => {
      if (creature?.type === 0) {
        return false;
      }

      if (!sameFloorOnly) {
        return true;
      }

      return creature.__position?.z === me.z;
    });
  }

  function readCreatureHealth(creature) {
    if (!creature) {
      return null;
    }

    const current = [
      creature.health,
      creature.hp,
      creature.currentHealth,
      creature.state?.health,
    ].find((value) => Number.isFinite(Number(value)));

    const max = [
      creature.maxHealth,
      creature.maxHp,
      creature.maximumHealth,
      creature.state?.maxHealth,
    ].find((value) => Number.isFinite(Number(value)));

    const percent = [
      creature.healthPercent,
      creature.hpPercent,
      creature.healthpercentage,
      creature.state?.healthPercent,
    ].find((value) => Number.isFinite(Number(value)));

    if (current != null && max != null) {
      return `${Number(current)}/${Number(max)} HP`;
    }

    if (percent != null) {
      return `${Math.round(Number(percent))}% HP`;
    }

    if (current != null) {
      return `${Number(current)} HP`;
    }

    return null;
  }

  function getCreatureLabel(creature) {
    if (creature?.name) {
      return creature.name;
    }

    return creature?.type === 0 ? "Player" : "Mob";
  }

  function getOverlayCreatures() {
    const me = bot.getPlayerPosition();
    if (!me) {
      return [];
    }

    return getTrackedCreatures().filter((creature) => {
      const pos = creature?.__position;
      if (!pos || pos.z == null) {
        return false;
      }

      if (config.selectedFloor != null && pos.z !== config.selectedFloor) {
        return false;
      }

      if (pos.z !== me.z) {
        return isWithinVisibleRange(me, pos);
      }

      return !isWithinVisibleRange(me, pos);
    });
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function getSameFloorOffscreenMarkerText(creature, healthLabel) {
    return healthLabel
      ? `${getCreatureLabel(creature)} ${healthLabel}`
      : `${getCreatureLabel(creature)}`;
  }

  function ensureOverlayStyle() {
    if (document.getElementById(overlayStyleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = overlayStyleId;
    style.textContent = `
      #${overlayRootId} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 999998;
      }

      #${overlayRootId} .mb-xray-marker {
        position: fixed;
        transform: translate(-50%, -50%);
        padding: 2px 6px;
        border: 1px solid rgba(255, 211, 128, 0.85);
        border-radius: 999px;
        background: rgba(65, 24, 12, 0.72);
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.35);
        color: #ffe7ae;
        font: 11px/1.2 Verdana, sans-serif;
        white-space: nowrap;
      }

      #${overlayRootId} .mb-xray-marker.mb-xray-marker-offscreen {
        border-color: rgba(123, 235, 178, 0.92);
        background: rgba(11, 61, 43, 0.8);
        color: #d8ffea;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureOverlayRoot() {
    let root = document.getElementById(overlayRootId);
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = overlayRootId;
    document.body.appendChild(root);
    return root;
  }

  function destroyOverlayElements() {
    document.getElementById(overlayRootId)?.remove();
    document.getElementById(overlayStyleId)?.remove();
  }

  function getViewportRect() {
    const canvases = Array.from(document.querySelectorAll("canvas"))
      .map((canvas) => ({ canvas, rect: canvas.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width >= 200 && rect.height >= 150)
      .sort((a, b) => (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height));

    return canvases[0]?.rect || null;
  }

  function renderOverlay() {
    if (!overlayState.running) {
      return;
    }

    const root = ensureOverlayRoot();
    const me = bot.getPlayerPosition();
    const viewportRect = getViewportRect();
    const creatures = getOverlayCreatures();
    root.innerHTML = "";

    if (!me || !viewportRect || !creatures.length) {
      return;
    }

    const tileWidth = viewportRect.width / 17;
    const tileHeight = viewportRect.height / 13;
    const edgePadding = 48;

    creatures.forEach((creature) => {
      const pos = creature?.__position;
      if (!pos) return;

      const dx = pos.x - me.x;
      const dy = pos.y - me.y;
      const healthLabel = readCreatureHealth(creature);
      const marker = document.createElement("div");
      marker.className = "mb-xray-marker";

      if (pos.z === me.z) {
        marker.classList.add("mb-xray-marker-offscreen");
        marker.textContent = getSameFloorOffscreenMarkerText(creature, healthLabel);
        marker.style.left = `${clamp(
          viewportRect.left + ((dx + 8.5) * tileWidth),
          viewportRect.left + edgePadding,
          viewportRect.right - edgePadding
        )}px`;
        marker.style.top = `${clamp(
          viewportRect.top + ((dy + 6.5) * tileHeight),
          viewportRect.top + edgePadding,
          viewportRect.bottom - edgePadding
        )}px`;
      } else {
        const floorOffset = me.z - pos.z;
        const floorLabel = floorOffset === 0 ? "0" : floorOffset > 0 ? `+${floorOffset}` : `${floorOffset}`;
        marker.textContent = healthLabel
          ? `${getCreatureLabel(creature)} (${floorLabel}) ${healthLabel}`
          : `${getCreatureLabel(creature)} (${floorLabel})`;
        marker.style.left = `${viewportRect.left + ((dx + 8.5) * tileWidth)}px`;
        marker.style.top = `${viewportRect.top + ((dy + 6.5) * tileHeight)}px`;
      }

      root.appendChild(marker);
    });
  }

  function startOverlay() {
    config.overlayEnabled = true;
    persistConfig();

    if (overlayState.running) {
      return false;
    }

    overlayState.running = true;
    ensureOverlayStyle();
    renderOverlay();
    overlayState.timerId = window.setInterval(renderOverlay, 250);
    return true;
  }

  function stopOverlay() {
    config.overlayEnabled = false;
    persistConfig();

    if (!overlayState.running && overlayState.timerId == null) {
      return false;
    }

    overlayState.running = false;
    if (overlayState.timerId != null) {
      window.clearInterval(overlayState.timerId);
      overlayState.timerId = null;
    }

    destroyOverlayElements();
    return true;
  }

  function setOverlayEnabled(enabled) {
    const nextEnabled = !!enabled;

    if (nextEnabled) {
      if (overlayState.running) {
        config.overlayEnabled = true;
        persistConfig();
        return true;
      }

      return startOverlay();
    }

    if (!overlayState.running) {
      config.overlayEnabled = false;
      persistConfig();
      destroyOverlayElements();
      return true;
    }

    return stopOverlay();
  }

  function setSelectedFloor(floor) {
    config.selectedFloor = normalizeSelectedFloor(floor);
    persistConfig();

    if (overlayState.running) {
      renderOverlay();
    }

    return config.selectedFloor;
  }

  function status() {
    return {
      visibleCreatures: getVisibleCreatures().map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
      visiblePlayers: getVisiblePlayers().map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      visiblePlayersCurrentFloor: getVisiblePlayers({ sameFloorOnly: true }).map((player) => ({
        id: player.id,
        name: player.name,
        position: player.__position || null,
      })),
      visibleMonsters: getVisibleMonsters().map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
      visibleMonstersCurrentFloor: getVisibleMonsters({ sameFloorOnly: true }).map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
      overlayCreatures: getOverlayCreatures().map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
      config: { ...config },
      overlayRunning: overlayState.running,
    };
  }

  bot.xray = {
    getVisibleCreatures,
    getVisiblePlayers,
    getVisibleMonsters,
    getOverlayCreatures,
    startOverlay,
    stopOverlay,
    setOverlayEnabled,
    setSelectedFloor,
    status,
    config,
  };

  if (config.overlayEnabled) {
    startOverlay();
  } else {
    destroyOverlayElements();
  }
  bot.addCleanup(stopOverlay);
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installPanicModule = function installPanicModule(bot) {
  const configStorageKey = "k9x.panic.config";
  const state = {
    running: false,
    timerId: null,
    lastHealth: null,
    lastTriggerAt: 0,
    lastDamageEventKey: null,
    pendingReturnOrigin: null,
    pendingReturnModules: null,
    returnNotBeforeAt: 0,
    lastThreatAt: 0,
    lastReturnAttemptAt: 0,
  };

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
    return (window.gameClient?.interface?.channelManager?.channels || []).flatMap((channel) =>
      (channel?.__contents || []).map((entry) => ({
        channelName: channel?.name || null,
        message: String(entry?.message || ""),
        time: entry?.__time || null,
      }))
    );
  }

  function parseDamageMessage(entry) {
    const match = entry.message.match(
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
        const aTime = a.time ? Date.parse(a.time) : 0;
        const bTime = b.time ? Date.parse(b.time) : 0;
        return bTime - aTime;
      });

    return messages[0] || null;
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
      const triggered = checkGameMasters() || checkUnknownPlayers() || checkHealthLoss();
      if (!triggered) {
        tryReturnToOrigin();
      }
    } finally {
      scheduleNextTick();
    }
  }

  function shouldRun() {
    return !!(getGameMasterNames().length || config.unknownPlayerEnabled || config.healthLossEnabled);
  }

  function start() {
    if (state.running) {
      return false;
    }

    state.running = true;
    state.lastHealth = Number(bot.getPlayerState()?.health ?? 0);
    state.lastDamageEventKey = getLatestDamageEvent()?.key || null;
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
    clearPendingReturn();
    bot.log("panic runner stopped");
    return true;
  }

  function syncRunningState() {
    if (shouldRun()) {
      start();
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
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installRuneModule = function installRuneModule(bot) {
  const configStorageKey = "k9x.rune.config";
  const state = {
    running: false,
    timerId: null,
    lastRuneAt: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 250,
      minHpPercent: 50,
      minFoodSeconds: 30,
      runeSpellWords: "adori vita vis",
      runeHotbarSlot: null,
      runeManaCost: 600,
      runeCooldownMs: 3500,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 250;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeHotbarSlot(slot) {
    const value = Number(slot);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    if (normalized < 1 || normalized > 12) {
      return null;
    }

    return normalized;
  }

  function hasCastMethod() {
    const slot = normalizeHotbarSlot(config.runeHotbarSlot);
    const words = String(config.runeSpellWords || "").trim();
    return !!slot || !!words;
  }

  function readStats() {
    const playerState = bot.getPlayerState();

    const hp = playerState
      ? { current: playerState.health ?? 0, max: playerState.maxHealth ?? 0 }
      : null;

    const mana = playerState
      ? { current: playerState.mana ?? 0, max: playerState.maxMana ?? 0 }
      : null;

    const foodText =
      document.querySelector('#skill-window div[skill="food"] .skill')?.textContent?.trim() ||
      null;

    let food = null;
    if (foodText) {
      const match = foodText.match(/^(\d{1,2}):(\d{2})$/);
      food = match
        ? {
            text: foodText,
            seconds: Number(match[1]) * 60 + Number(match[2]),
          }
        : { text: foodText, seconds: null };
    }

    return { hp, mana, food };
  }

  function getGateStatus(now = Date.now()) {
    const { hp, mana, food } = readStats();
    const castMethodReady = hasCastMethod();

    if (!hp || !mana) {
      return {
        hasStats: false,
        hasCastMethod: castMethodReady,
        enoughHp: false,
        enoughMana: false,
        enoughFood: false,
        cooldownReady: false,
        cooldownRemainingMs: config.runeCooldownMs,
        canMakeRune: false,
      };
    }

    const hpPercent = hp.max > 0 ? (hp.current / hp.max) * 100 : 0;
    const enoughHp = hpPercent >= config.minHpPercent;
    const enoughMana = mana.current >= config.runeManaCost;
    const enoughFood = food?.seconds == null || food.seconds >= config.minFoodSeconds;
    const cooldownElapsedMs = now - state.lastRuneAt;
    const cooldownRemainingMs = Math.max(0, config.runeCooldownMs - cooldownElapsedMs);
    const cooldownReady = cooldownRemainingMs === 0;

    return {
      hasStats: true,
      hasCastMethod: castMethodReady,
      enoughHp,
      enoughMana,
      enoughFood,
      cooldownReady,
      cooldownRemainingMs,
      canMakeRune:
        castMethodReady && enoughHp && enoughMana && enoughFood && cooldownReady,
    };
  }

  function canMakeRune(now = Date.now()) {
    return getGateStatus(now).canMakeRune;
  }

  function tryMakeRune() {
    if (!canMakeRune()) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.runeHotbarSlot);
    const words = String(config.runeSpellWords || "").trim();
    const castResult = bot.castSpell({
      words,
      hotbarSlot: slot,
      fallbackChat: !slot && !!words,
    });

    if (castResult.ok) {
      state.lastRuneAt = Date.now();
      bot.log("cast rune", {
        method: castResult.method,
        spellWords: words || null,
        slot: castResult.slot ?? slot ?? null,
        sid: castResult.sid ?? null,
      });
    }

    return castResult.ok;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function runImmediateTick() {
    if (!state.running) return;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    tick();
  }

  function handleResume() {
    if (document.hidden) {
      return;
    }

    runImmediateTick();
  }

  function attachResumeListeners() {
    if (resumeListenersAttached) {
      return;
    }

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    resumeListenersAttached = true;
  }

  function detachResumeListeners() {
    if (!resumeListenersAttached) {
      return;
    }

    document.removeEventListener("visibilitychange", handleResume);
    window.removeEventListener("focus", handleResume);
    window.removeEventListener("pageshow", handleResume);
    resumeListenersAttached = false;
  }

  function tick() {
    if (!state.running) return;

    try {
      tryMakeRune();
    } catch (error) {
      bot.log("rune tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 250;
    persistConfig();

    if (state.running) {
      bot.log("rune maker already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("rune maker started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    detachResumeListeners();

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("rune maker stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
        config: { ...config },
        stats: readStats(),
        gates: getGateStatus(),
        lastRuneAt: state.lastRuneAt,
      };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "runeHotbarSlot")) {
      nextConfig.runeHotbarSlot = normalizeHotbarSlot(nextConfig.runeHotbarSlot);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 250;
    persistConfig();
    bot.log("rune config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.rune = {
    start,
    stop,
    status,
    readStats,
    getGateStatus,
    canMakeRune,
    tryMakeRune,
    normalizeHotbarSlot,
    config,
    updateConfig,
  };

  bot.startRuneLoop = start;
  bot.stopRuneLoop = stop;
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installHealModule = function installHealModule(bot) {
  const configStorageKey = "k9x.heal.config";
  const state = {
    running: false,
    timerId: null,
    lastHpHealAt: 0,
    lastManaHealAt: 0,
    lastHpAttemptAt: 0,
    lastManaAttemptAt: 0,
    pendingHpAttempt: null,
    pendingManaAttempt: null,
  };

  const config = Object.assign(
    {
      tickMs: 50,
      healCooldownMs: 1200,
      healRetryMs: 200,
      healConfirmMs: 250,
      minHp: 250,
      hpHotbarSlot: 1,
      hpSpellWords: "exura",
      hpSpellSid: null,
      minMana: 150,
      manaHotbarSlot: 2,
      manaSpellWords: null,
      manaSpellSid: null,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function readStats() {
    const playerState = bot.getPlayerSnapshot?.();

    return playerState
      ? {
          hp: {
            current: Number(playerState.health ?? 0),
            max: Number(playerState.maxHealth ?? 0),
          },
          mana: {
            current: Number(playerState.mana ?? 0),
            max: Number(playerState.maxMana ?? 0),
          },
        }
      : { hp: null, mana: null };
  }

  function normalizeHotbarSlot(slot) {
    const value = Number(slot);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    if (normalized < 1 || normalized > 12) {
      return null;
    }

    return normalized;
  }

  function hasPendingAttempt() {
    return !!(state.pendingHpAttempt || state.pendingManaAttempt);
  }

  function didHpHealSucceed(stats, attempt) {
    if (!stats?.hp || !attempt) {
      return false;
    }

    return (
      stats.hp.current > attempt.hpBefore ||
      (Number.isFinite(attempt.manaBefore) && Number.isFinite(stats.mana?.current) && stats.mana.current < attempt.manaBefore)
    );
  }

  function didManaHealSucceed(stats, attempt) {
    if (!stats?.mana || !attempt) {
      return false;
    }

    return (
      stats.mana.current > attempt.manaBefore ||
      (Number.isFinite(attempt.hpBefore) && Number.isFinite(stats.hp?.current) && stats.hp.current > attempt.hpBefore)
    );
  }

  function resolvePendingAttempts(stats, now = Date.now()) {
    const hpAttempt = state.pendingHpAttempt;
    if (hpAttempt) {
      if (didHpHealSucceed(stats, hpAttempt)) {
        state.lastHpHealAt = hpAttempt.attemptedAt;
        state.pendingHpAttempt = null;
        bot.log("confirmed hp heal", {
          slot: hpAttempt.slot,
          method: hpAttempt.method || null,
          sid: hpAttempt.sid ?? null,
        });
      } else if (now - hpAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) {
        state.pendingHpAttempt = null;
        bot.log("hp heal did not register", { slot: hpAttempt.slot });
      }
    }

    const manaAttempt = state.pendingManaAttempt;
    if (manaAttempt) {
      if (didManaHealSucceed(stats, manaAttempt)) {
        state.lastManaHealAt = manaAttempt.attemptedAt;
        state.pendingManaAttempt = null;
        bot.log("confirmed mana heal", {
          slot: manaAttempt.slot,
          method: manaAttempt.method || null,
          sid: manaAttempt.sid ?? null,
        });
      } else if (now - manaAttempt.attemptedAt >= Math.max(50, Number(config.healConfirmMs) || 0)) {
        state.pendingManaAttempt = null;
        bot.log("mana heal did not register", { slot: manaAttempt.slot });
      }
    }
  }

  function hasHpCastOption() {
    return !!(
      normalizeHotbarSlot(config.hpHotbarSlot) ||
      normalizeSpellWords(config.hpSpellWords) ||
      normalizeSpellSid(config.hpSpellSid) != null
    );
  }

  function hasManaCastOption() {
    return !!(
      normalizeHotbarSlot(config.manaHotbarSlot) ||
      normalizeSpellWords(config.manaSpellWords) ||
      normalizeSpellSid(config.manaSpellSid) != null
    );
  }

  function normalizeSpellWords(words) {
    return String(words || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function normalizeSpellSid(sid) {
    const value = Number(sid);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    return normalized >= 0 ? normalized : null;
  }

  function canUseHpHeal(now = Date.now(), stats = readStats()) {
    const { hp } = stats;
    if (!hp || !hasHpCastOption() || state.pendingHpAttempt) return false;

    return (
      hp.current > 0 &&
      hp.current <= Math.max(0, Number(config.minHp) || 0) &&
      now - state.lastHpHealAt >= config.healCooldownMs &&
      now - state.lastHpAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0)
    );
  }

  function canUseManaHeal(now = Date.now(), stats = readStats()) {
    const { mana } = stats;
    if (!mana || !hasManaCastOption() || state.pendingManaAttempt || state.pendingHpAttempt) return false;

    return (
      mana.current <= Math.max(0, Number(config.minMana) || 0) &&
      now - state.lastManaHealAt >= config.healCooldownMs &&
      now - state.lastManaAttemptAt >= Math.max(50, Number(config.healRetryMs) || 0)
    );
  }

  function triggerHpHeal(now = Date.now(), stats = readStats()) {
    if (!canUseHpHeal(now, stats)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.hpHotbarSlot);
    const castResult = bot.castSpell({
      sid: config.hpSpellSid,
      words: config.hpSpellWords,
      hotbarSlot: slot,
    });

    if (castResult.ok) {
      state.lastHpAttemptAt = now;
      state.pendingHpAttempt = {
        attemptedAt: now,
        slot,
        method: castResult.method,
        sid: castResult.sid ?? null,
        hpBefore: Number(stats.hp?.current ?? 0),
        manaBefore: Number(stats.mana?.current ?? 0),
      };
      bot.log("cast hp heal", {
        method: castResult.method,
        sid: castResult.sid ?? null,
        slot,
        minHp: config.minHp,
      });
    }

    return castResult.ok;
  }

  function triggerManaHeal(now = Date.now(), stats = readStats()) {
    if (!canUseManaHeal(now, stats)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.manaHotbarSlot);
    const castResult = bot.castSpell({
      sid: config.manaSpellSid,
      words: config.manaSpellWords,
      hotbarSlot: slot,
      fallbackChat: !!normalizeSpellWords(config.manaSpellWords),
    });

    if (castResult.ok) {
      state.lastManaAttemptAt = now;
      state.pendingManaAttempt = {
        attemptedAt: now,
        slot,
        method: castResult.method,
        sid: castResult.sid ?? null,
        hpBefore: Number(stats.hp?.current ?? 0),
        manaBefore: Number(stats.mana?.current ?? 0),
      };
      bot.log("cast mana heal", {
        method: castResult.method,
        sid: castResult.sid ?? null,
        slot,
        minMana: config.minMana,
      });
    }

    return castResult.ok;
  }

  function tryHeal() {
    if (!config.enabled) {
      return false;
    }

    const now = Date.now();
    const stats = readStats();

    resolvePendingAttempts(stats, now);

    if (hasPendingAttempt()) {
      return false;
    }

    if (triggerHpHeal(now, stats)) {
      return true;
    }

    return triggerManaHeal(now, stats);
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
      tryHeal();
    } catch (error) {
      bot.log("auto heal tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    persistConfig();

    if (state.running) {
      bot.log("auto heal already running");
      return false;
    }

    state.running = true;
    bot.log("auto heal started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("auto heal stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      stats: readStats(),
      lastHpHealAt: state.lastHpHealAt,
      lastManaHealAt: state.lastManaHealAt,
      lastHpAttemptAt: state.lastHpAttemptAt,
      lastManaAttemptAt: state.lastManaAttemptAt,
      pendingHpAttempt: state.pendingHpAttempt ? { ...state.pendingHpAttempt } : null,
      pendingManaAttempt: state.pendingManaAttempt ? { ...state.pendingManaAttempt } : null,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "hpHotbarSlot")) {
      nextConfig.hpHotbarSlot = normalizeHotbarSlot(nextConfig.hpHotbarSlot) ?? config.hpHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaHotbarSlot")) {
      nextConfig.manaHotbarSlot = normalizeHotbarSlot(nextConfig.manaHotbarSlot) ?? config.manaHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "minHp")) {
      nextConfig.minHp = Math.max(0, Number(nextConfig.minHp) || 0);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "minMana")) {
      nextConfig.minMana = Math.max(0, Number(nextConfig.minMana) || 0);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "healRetryMs")) {
      nextConfig.healRetryMs = Math.max(50, Number(nextConfig.healRetryMs) || 50);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "healConfirmMs")) {
      nextConfig.healConfirmMs = Math.max(50, Number(nextConfig.healConfirmMs) || 50);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "hpSpellSid")) {
      nextConfig.hpSpellSid = normalizeSpellSid(nextConfig.hpSpellSid);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaSpellSid")) {
      nextConfig.manaSpellSid = normalizeSpellSid(nextConfig.manaSpellSid);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "hpSpellWords")) {
      const words = normalizeSpellWords(nextConfig.hpSpellWords);
      nextConfig.hpSpellWords = words || null;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "manaSpellWords")) {
      const words = normalizeSpellWords(nextConfig.manaSpellWords);
      nextConfig.manaSpellWords = words || null;
    }

    Object.assign(config, nextConfig);
    persistConfig();
    bot.log("auto heal config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.heal = {
    start,
    stop,
    status,
    updateConfig,
    readStats,
    tryHeal,
    canUseHpHeal,
    canUseManaHeal,
    triggerHpHeal,
    triggerManaHeal,
    normalizeHotbarSlot,
    config,
  };
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoInvisibleModule = function installAutoInvisibleModule(bot) {
  const configStorageKey = "k9x.invisible.config";
  const INVISIBLE_CONDITION_ID = 4;
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 500,
      spellWords: "utana vid",
      recastCooldownMs: 2000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 500;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getInvisibleConditionId() {
    return window.ConditionManager?.prototype?.INVISIBLE ?? INVISIBLE_CONDITION_ID;
  }

  function isInvisibleActive() {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;
    const invisibleConditionId = getInvisibleConditionId();

    if (conditions?.has) {
      return conditions.has(invisibleConditionId);
    }

    if (player?.hasCondition) {
      return player.hasCondition(invisibleConditionId);
    }

    return false;
  }

  function getGateStatus(now = Date.now()) {
    const cooldownRemainingMs = Math.max(0, config.recastCooldownMs - (now - state.lastCastAt));
    const cooldownReady = cooldownRemainingMs === 0;
    const invisibleActive = isInvisibleActive();

    return {
      invisibleActive,
      cooldownReady,
      cooldownRemainingMs,
      canCast: !invisibleActive && cooldownReady,
    };
  }

  function canCastInvisible(now = Date.now()) {
    return getGateStatus(now).canCast;
  }

  function tryCastInvisible(now = Date.now()) {
    if (!config.enabled || !canCastInvisible(now)) {
      return false;
    }

    const castResult = bot.castSpell({ words: config.spellWords });
    if (castResult.ok) {
      state.lastCastAt = now;
      bot.log("cast invisible spell", {
        spellWords: config.spellWords,
        method: castResult.method,
        sid: castResult.sid ?? null,
      });
    }

    return castResult.ok;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function runImmediateTick() {
    if (!state.running) return;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    tick();
  }

  function handleResume() {
    if (document.hidden) {
      return;
    }

    runImmediateTick();
  }

  function attachResumeListeners() {
    if (resumeListenersAttached) {
      return;
    }

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    resumeListenersAttached = true;
  }

  function detachResumeListeners() {
    if (!resumeListenersAttached) {
      return;
    }

    document.removeEventListener("visibilitychange", handleResume);
    window.removeEventListener("focus", handleResume);
    window.removeEventListener("pageshow", handleResume);
    resumeListenersAttached = false;
  }

  function tick() {
    if (!state.running) return;

    try {
      tryCastInvisible();
    } catch (error) {
      bot.log("auto invisible tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 500;
    persistConfig();

    if (state.running) {
      bot.log("auto invisible already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("auto invisible started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    detachResumeListeners();

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    bot.log("auto invisible stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      lastCastAt: state.lastCastAt,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim() || config.spellWords;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "recastCooldownMs")) {
      nextConfig.recastCooldownMs = Math.max(0, Number(nextConfig.recastCooldownMs) || 0);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 500;
    persistConfig();
    bot.log("auto invisible config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.invisible = {
    start,
    stop,
    status,
    updateConfig,
    isInvisibleActive,
    canCastInvisible,
    tryCastInvisible,
    config,
  };
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoMagicShieldModule = function installAutoMagicShieldModule(bot) {
  const configStorageKey = "k9x.magicShield.config";
  const MAGIC_SHIELD_FALLBACK_DURATION_MS = 180000;
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
    assumedActiveUntil: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 500,
      spellWords: "utamo vita",
      recastCooldownMs: 2000,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 500;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getMagicShieldConditionId() {
    const conditionManagerPrototype = window.ConditionManager?.prototype;
    const playerConditions = window.gameClient?.player?.conditions;
    const candidateKeys = [
      "MAGIC_SHIELD",
      "MANA_SHIELD",
      "MAGICSHIELD",
      "MANASHIELD",
      "UTAMO_VITA",
    ];

    for (const key of candidateKeys) {
      const value = conditionManagerPrototype?.[key] ?? playerConditions?.[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  function isMagicShieldActive(now = Date.now()) {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;
    const magicShieldConditionId = getMagicShieldConditionId();

    if (magicShieldConditionId != null) {
      if (conditions?.has) {
        return conditions.has(magicShieldConditionId);
      }

      if (player?.hasCondition) {
        return player.hasCondition(magicShieldConditionId);
      }
    }

    return now < state.assumedActiveUntil;
  }

  function getGateStatus(now = Date.now()) {
    const cooldownRemainingMs = Math.max(0, config.recastCooldownMs - (now - state.lastCastAt));
    const cooldownReady = cooldownRemainingMs === 0;
    const magicShieldActive = isMagicShieldActive(now);

    return {
      magicShieldActive,
      cooldownReady,
      cooldownRemainingMs,
      canCast: !magicShieldActive && cooldownReady,
    };
  }

  function canCastMagicShield(now = Date.now()) {
    return getGateStatus(now).canCast;
  }

  function tryCastMagicShield(now = Date.now()) {
    if (!config.enabled || !canCastMagicShield(now)) {
      return false;
    }

    const castResult = bot.castSpell({ words: config.spellWords });
    if (castResult.ok) {
      state.lastCastAt = now;
      state.assumedActiveUntil = now + MAGIC_SHIELD_FALLBACK_DURATION_MS;
      bot.log("cast magic shield spell", {
        spellWords: config.spellWords,
        method: castResult.method,
        sid: castResult.sid ?? null,
      });
    }

    return castResult.ok;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function runImmediateTick() {
    if (!state.running) return;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    tick();
  }

  function handleResume() {
    if (document.hidden) {
      return;
    }

    runImmediateTick();
  }

  function attachResumeListeners() {
    if (resumeListenersAttached) {
      return;
    }

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    resumeListenersAttached = true;
  }

  function detachResumeListeners() {
    if (!resumeListenersAttached) {
      return;
    }

    document.removeEventListener("visibilitychange", handleResume);
    window.removeEventListener("focus", handleResume);
    window.removeEventListener("pageshow", handleResume);
    resumeListenersAttached = false;
  }

  function tick() {
    if (!state.running) return;

    try {
      tryCastMagicShield();
    } catch (error) {
      bot.log("auto magic shield tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 500;
    persistConfig();

    if (state.running) {
      bot.log("auto magic shield already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("auto magic shield started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    detachResumeListeners();

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    bot.log("auto magic shield stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      lastCastAt: state.lastCastAt,
      assumedActiveUntil: state.assumedActiveUntil,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "spellWords")) {
      nextConfig.spellWords = String(nextConfig.spellWords || "").trim() || config.spellWords;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "recastCooldownMs")) {
      nextConfig.recastCooldownMs = Math.max(0, Number(nextConfig.recastCooldownMs) || 0);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 500;
    persistConfig();
    bot.log("auto magic shield config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.magicShield = {
    start,
    stop,
    status,
    updateConfig,
    isMagicShieldActive,
    canCastMagicShield,
    tryCastMagicShield,
    config,
  };
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoAttackModule = function installAutoAttackModule(bot) {
  const configStorageKey = "k9x.attack.config";
  const state = {
    running: false,
    timerId: null,
    lastTargetHotkeyAt: 0,
    lastRuneHotkeyAt: 0,
    engagedTargetId: null,
    combatStartedAt: 0,
    lastChaseAt: 0,
    lastChaseDestinationKey: null,
    lastFollowTargetId: null,
    lastFollowDistance: Number.POSITIVE_INFINITY,
    lastFollowProgressAt: 0,
    lastFollowStallAt: 0,
    skippedTargetIds: new Map(),
  };

  const storedConfig = bot.storage.get(configStorageKey, {}) || {};
  const config = Object.assign(
    {
      tickMs: 500,
      targetHotbarSlot: 3,
      runeHotbarSlot: null,
      targetCooldownMs: 1200,
      runeCooldownMs: 1200,
      maxTargetDistance: 8,
      meleeMode: true,
      targetFilterMode: "all",
      includedCreatureNames: [],
      excludedCreatureNames: [],
      enabled: false,
    },
    storedConfig
  );
  if (config.targetHotbarSlot == null && storedConfig.hotbarSlot != null) {
    config.targetHotbarSlot = storedConfig.hotbarSlot;
  }
  config.targetFilterMode = normalizeTargetFilterMode(config.targetFilterMode);
  config.includedCreatureNames = normalizeCreatureNameList(config.includedCreatureNames);
  config.excludedCreatureNames = normalizeCreatureNameList(config.excludedCreatureNames);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeHotbarSlot(slot) {
    const value = Number(slot);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    if (normalized < 1 || normalized > 12) {
      return null;
    }

    return normalized;
  }

  function normalizeCreatureName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function normalizeCreatureNameList(list) {
    if (!Array.isArray(list)) {
      return [];
    }

    const seen = new Set();
    const normalized = [];
    list.forEach((name) => {
      const cleaned = String(name || "").trim();
      if (!cleaned) {
        return;
      }

      const key = cleaned.toLowerCase();
      if (seen.has(key)) {
        return;
      }

      seen.add(key);
      normalized.push(cleaned);
    });

    return normalized;
  }

  function normalizeTargetFilterMode(value) {
    return value === "include" || value === "exclude" ? value : "all";
  }

  function shouldTargetCreature(target) {
    if (!target) {
      return false;
    }

    const mode = normalizeTargetFilterMode(config.targetFilterMode);
    const targetName = normalizeCreatureName(target.name || "Mob");
    const includedNames = new Set((config.includedCreatureNames || []).map(normalizeCreatureName));
    const excludedNames = new Set((config.excludedCreatureNames || []).map(normalizeCreatureName));

    if (mode === "include") {
      if (!includedNames.size) {
        return true;
      }

      return includedNames.has(targetName) && !excludedNames.has(targetName);
    }

    if (mode === "exclude") {
      return !excludedNames.has(targetName);
    }

    return true;
  }

  function getNearbyMonsters() {
    return bot.xray?.getVisibleMonsters?.({ sameFloorOnly: true }) || [];
  }

  function normalizePosition(value) {
    if (!value) {
      return null;
    }

    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return {
      x: Math.trunc(x),
      y: Math.trunc(y),
      z: Math.trunc(z),
    };
  }

  function getPositionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : null;
  }

  function isAdjacentTile(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return false;
    }

    const dx = Math.abs(Number(from.x) - Number(to.x));
    const dy = Math.abs(Number(from.y) - Number(to.y));
    return (dx !== 0 || dy !== 0) && dx <= 1 && dy <= 1;
  }

  function getTileDistance(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.max(
      Math.abs(Number(from.x) - Number(to.x)),
      Math.abs(Number(from.y) - Number(to.y))
    );
  }

  function isSameCreature(left, right) {
    if (!left || !right) {
      return false;
    }

    return left === right || left.id === right.id;
  }

  function findNearbyMonster(creature) {
    if (!creature) {
      return null;
    }

    const nearbyMonsters = getNearbyMonsters();
    return nearbyMonsters.find((monster) => isSameCreature(monster, creature)) || null;
  }

  function findNearbyMonsterById(id) {
    if (id == null) {
      return null;
    }

    return getNearbyMonsters().find((monster) => monster?.id === id) || null;
  }

  function getTrackedCreature(id) {
    if (id == null) {
      return null;
    }

    return window.gameClient?.world?.activeCreatures?.[id] || null;
  }

  function readCreatureHealth(creature) {
    if (!creature) {
      return null;
    }

    const candidates = [
      creature.state?.health,
      creature.health,
      creature.hp,
      creature.currentHealth,
    ];

    const value = candidates.find((entry) => Number.isFinite(Number(entry)));
    return value == null ? null : Number(value);
  }

  function isCreatureDead(creature) {
    if (!creature) {
      return true;
    }

    const health = readCreatureHealth(creature);
    return health === 0;
  }

  function isCreatureGone(id) {
    return id != null && !getTrackedCreature(id);
  }

  function reconcileDeadTargets(now = Date.now()) {
    const candidateIds = new Set();
    const currentTarget = getCurrentTarget();
    const followTarget = getCurrentFollowTarget();

    if (currentTarget?.id != null) {
      candidateIds.add(currentTarget.id);
    }

    if (followTarget?.id != null) {
      candidateIds.add(followTarget.id);
    }

    if (state.engagedTargetId != null) {
      candidateIds.add(state.engagedTargetId);
    }

    let handled = false;

    candidateIds.forEach((id) => {
      const tracked = getTrackedCreature(id);

      if (isCreatureGone(id)) {
        if (currentTarget?.id === id) {
          clearCurrentTarget();
        }

        if (followTarget?.id === id) {
          clearCurrentFollowTarget();
        }

        if (state.engagedTargetId === id) {
          clearEngagedTarget();
        }

        state.skippedTargetIds.set(id, now + 500);
        bot.log("target gone after kill", { id });
        handled = true;
        return;
      }

      if (isCreatureDead(tracked)) {
        skipTarget(tracked, "target dead", now, 500);
        handled = true;
      }
    });

    return handled;
  }

  function getCurrentTarget() {
    return window.gameClient?.player?.__target || null;
  }

  function getCurrentFollowTarget() {
    return window.gameClient?.player?.__followTarget || null;
  }

  function pruneSkippedTargets(now = Date.now()) {
    for (const [id, expiresAt] of state.skippedTargetIds.entries()) {
      if (expiresAt <= now) {
        state.skippedTargetIds.delete(id);
      }
    }
  }

  function resetFollowProgress() {
    state.lastFollowTargetId = null;
    state.lastFollowDistance = Number.POSITIVE_INFINITY;
    state.lastFollowProgressAt = 0;
    state.lastFollowStallAt = 0;
  }

  function clearEngagedTarget() {
    state.engagedTargetId = null;
    state.combatStartedAt = 0;
    state.lastChaseDestinationKey = null;
    resetFollowProgress();
  }

  function clearCurrentFollowTarget() {
    if (!window.gameClient?.player || typeof window.gameClient.send !== "function") {
      return false;
    }

    if (typeof FollowPacket !== "function") {
      return false;
    }

    if (!getCurrentFollowTarget()) {
      return false;
    }

    window.gameClient.player.setFollowTarget(null);
    window.gameClient.send(new FollowPacket(0));
    return true;
  }

  function clearCurrentTarget() {
    if (!window.gameClient?.player || typeof window.gameClient.send !== "function") {
      return false;
    }

    if (typeof TargetPacket !== "function") {
      return false;
    }

    if (!getCurrentTarget()) {
      return false;
    }

    window.gameClient.player.setTarget(null);
    window.gameClient.send(new TargetPacket(0));
    return true;
  }

  function markCombatActive(now = Date.now()) {
    if (!state.combatStartedAt) {
      state.combatStartedAt = now;
    }
  }

  function getCombatTargetCount() {
    return getEngagedTarget() ? 1 : 0;
  }

  function isCombatActive() {
    if (!config.enabled || !state.running) {
      return false;
    }

    return !!getEngagedTarget();
  }

  function syncCombatState(now = Date.now()) {
    if (isCombatActive()) {
      markCombatActive(now);
      return true;
    }

    state.combatStartedAt = 0;
    return false;
  }

  function getEngagedTarget() {
    const currentTarget = getCurrentTarget();
    if (currentTarget) {
      state.engagedTargetId = currentTarget.id;
      return currentTarget;
    }

    if (state.engagedTargetId == null) {
      return null;
    }

    const followTarget = getCurrentFollowTarget();
    if (followTarget && followTarget.id === state.engagedTargetId) {
      return findNearbyMonster(followTarget) || followTarget;
    }

    const nearbyTarget = findNearbyMonsterById(state.engagedTargetId);
    if (nearbyTarget) {
      if (isCreatureDead(nearbyTarget)) {
        skipTarget(nearbyTarget, "engaged target dead", Date.now(), 500);
        return null;
      }

      return nearbyTarget;
    }

    const trackedTarget = getTrackedCreature(state.engagedTargetId);
    if (trackedTarget) {
      if (isCreatureDead(trackedTarget)) {
        skipTarget(trackedTarget, "engaged target dead", Date.now(), 500);
        return null;
      }

      return trackedTarget;
    }

    clearEngagedTarget();
    return null;
  }

  function setCurrentTarget(target) {
    if (!target || !window.gameClient?.player || typeof window.gameClient.send !== "function") {
      return false;
    }

    if (typeof TargetPacket !== "function") {
      return false;
    }

    window.gameClient.player.setTarget(target);
    window.gameClient.send(new TargetPacket(target.id));
    state.engagedTargetId = target.id;
    return true;
  }

  function setCurrentFollowTarget(target) {
    if (!target || !window.gameClient?.player || typeof window.gameClient.send !== "function") {
      return false;
    }

    if (typeof FollowPacket !== "function") {
      return false;
    }

    if (isSameCreature(getCurrentFollowTarget(), target)) {
      return true;
    }

    window.gameClient.player.setFollowTarget(target);
    window.gameClient.send(new FollowPacket(target.id));
    return true;
  }

  function skipTarget(target, reason, now = Date.now(), skipMs = 4000) {
    if (!target?.id) {
      return false;
    }

    const until = now + Math.max(500, Number(skipMs) || 0);
    state.skippedTargetIds.set(target.id, until);

    const clearedTarget = isSameCreature(getCurrentTarget(), target) ? clearCurrentTarget() : false;
    const clearedFollow = isSameCreature(getCurrentFollowTarget(), target) ? clearCurrentFollowTarget() : false;

    if (state.engagedTargetId === target.id) {
      clearEngagedTarget();
    } else if (state.lastFollowTargetId === target.id) {
      resetFollowProgress();
    }

    bot.log("skipping auto attack target", {
      id: target.id,
      name: target.name || "Mob",
      reason,
      skippedForMs: Math.max(500, Number(skipMs) || 0),
      clearedTarget,
      clearedFollow,
    });
    return true;
  }

  function isTargetSkipped(target, now = Date.now()) {
    pruneSkippedTargets(now);
    return !!target?.id && (state.skippedTargetIds.get(target.id) || 0) > now;
  }

  function getMonsterCandidates(now = Date.now()) {
    pruneSkippedTargets(now);

    const playerPosition = normalizePosition(bot.getPlayerPosition());
    return getNearbyMonsters()
      .filter((monster) => shouldTargetCreature(monster))
      .filter((monster) => !isTargetSkipped(monster, now))
      .sort((left, right) => {
        const leftDistance = getTileDistance(playerPosition, normalizePosition(left?.getPosition?.() || left?.__position));
        const rightDistance = getTileDistance(playerPosition, normalizePosition(right?.getPosition?.() || right?.__position));
        return leftDistance - rightDistance || Number(left?.id || 0) - Number(right?.id || 0);
      });
  }

  function shouldGiveUpTarget(target) {
    const maxTargetDistance = Math.max(1, Number(config.maxTargetDistance) || 8);
    const playerPosition = normalizePosition(bot.getPlayerPosition());
    const targetPosition = normalizePosition(target?.getPosition?.() || target?.__position);
    if (!playerPosition || !targetPosition) {
      return false;
    }

    return getTileDistance(playerPosition, targetPosition) > maxTargetDistance;
  }

  function resetTargetIfTooFar() {
    const currentTarget = getCurrentTarget();
    if (currentTarget && shouldGiveUpTarget(currentTarget)) {
      skipTarget(currentTarget, "target too far", Date.now(), 2500);
      bot.log("gave up distant auto attack target", {
        id: currentTarget.id,
        name: currentTarget.name || "Mob",
        position: normalizePosition(currentTarget.getPosition?.() || currentTarget.__position),
        maxTargetDistance: Math.max(1, Number(config.maxTargetDistance) || 8),
      });
      return true;
    }

    const engagedTarget = getEngagedTarget();
    if (engagedTarget && shouldGiveUpTarget(engagedTarget)) {
      skipTarget(engagedTarget, "engaged target too far", Date.now(), 2500);
      bot.log("gave up distant auto attack target", {
        id: engagedTarget.id,
        name: engagedTarget.name || "Mob",
        position: normalizePosition(engagedTarget.getPosition?.() || engagedTarget.__position),
        maxTargetDistance: Math.max(1, Number(config.maxTargetDistance) || 8),
      });
      return true;
    }

    return false;
  }

  function getTileFromPosition(position) {
    if (!position || typeof Position !== "function") {
      return null;
    }

    return window.gameClient?.world?.getTileFromWorldPosition?.(
      new Position(position.x, position.y, position.z)
    ) || null;
  }

  function findReachableAdjacentPosition(targetPosition, playerPosition) {
    if (!targetPosition || !playerPosition) {
      return null;
    }

    const offsets = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
    ];

    offsets.sort((a, b) => {
      const da = Math.abs(targetPosition.x + a.x - playerPosition.x) +
        Math.abs(targetPosition.y + a.y - playerPosition.y);
      const db = Math.abs(targetPosition.x + b.x - playerPosition.x) +
        Math.abs(targetPosition.y + b.y - playerPosition.y);
      return da - db;
    });

    const pathfinder = window.gameClient?.world?.pathfinder;
    const startTile = getTileFromPosition(playerPosition);
    if (!pathfinder || !startTile || typeof pathfinder.search !== "function") {
      return null;
    }

    for (const offset of offsets) {
      const candidatePosition = {
        x: targetPosition.x + offset.x,
        y: targetPosition.y + offset.y,
        z: targetPosition.z,
      };
      const tile = getTileFromPosition(candidatePosition);
      if (!tile?.isWalkable?.()) {
        continue;
      }

      if (candidatePosition.x === playerPosition.x && candidatePosition.y === playerPosition.y) {
        return candidatePosition;
      }

      try {
        const path = pathfinder.search(startTile, tile);
        if (Array.isArray(path) && path.length > 0) {
          return candidatePosition;
        }
      } catch (error) {
        bot.log("auto attack reachability check failed", {
          ...candidatePosition,
          error: error?.message || error,
        });
        return null;
      }
    }

    return null;
  }

  function syncMeleeChase(now = Date.now()) {
    if (!config.meleeMode) {
      return false;
    }

    const target = getEngagedTarget();
    if (!target) {
      clearEngagedTarget();
      return false;
    }

    const playerPosition = normalizePosition(bot.getPlayerPosition());
    const targetPosition = normalizePosition(target.getPosition?.() || target.__position);
    if (!playerPosition || !targetPosition || playerPosition.z !== targetPosition.z) {
      return false;
    }

    const giveUpDelayMs = Math.max(5000, (Number(config.tickMs) || 0) * 10);

    if (isAdjacentTile(playerPosition, targetPosition)) {
      state.lastChaseDestinationKey = null;
      clearCurrentFollowTarget();
      resetFollowProgress();
      return false;
    }

    const adjacentPosition = findReachableAdjacentPosition(targetPosition, playerPosition);
    if (!adjacentPosition) {
      if (!state.lastFollowStallAt) {
        state.lastFollowStallAt = now;
        return false;
      }

      if (now - state.lastFollowStallAt > giveUpDelayMs) {
        return skipTarget(target, "no reachable adjacent tile", now);
      }

      return false;
    }

    const currentDistance = getTileDistance(playerPosition, targetPosition);
    if (state.lastFollowTargetId !== target.id) {
      state.lastFollowTargetId = target.id;
      state.lastFollowDistance = currentDistance;
      state.lastFollowProgressAt = now;
      state.lastFollowStallAt = 0;
    } else if (currentDistance < state.lastFollowDistance) {
      state.lastFollowDistance = currentDistance;
      state.lastFollowProgressAt = now;
      state.lastFollowStallAt = 0;
    }

    const followed = setCurrentFollowTarget(target);
    if (followed) {
      state.lastChaseAt = now;
      state.lastChaseDestinationKey = getPositionKey(adjacentPosition);
      bot.log("following auto attack target", {
        id: target.id,
        name: target.name || "Mob",
        followTargetId: target.id,
      });
    }

    if (state.lastFollowDistance <= currentDistance) {
      if (!state.lastFollowStallAt) {
        state.lastFollowStallAt = now;
      } else if (now - state.lastFollowStallAt > giveUpDelayMs) {
        return skipTarget(target, "follow made no progress", now);
      }
    }

    return followed;
  }

  function canAttack(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.targetHotbarSlot);
    if (!slot) {
      return false;
    }

    if (now - state.lastTargetHotkeyAt < Math.max(0, Number(config.targetCooldownMs) || 0)) {
      return false;
    }

    if (config.meleeMode) {
      return getMonsterCandidates(now).length > 0 && !getCurrentTarget();
    }

    return getMonsterCandidates(now).length > 0;
  }

  function triggerAttack(now = Date.now()) {
    if (!canAttack(now)) {
      return false;
    }

    const engagedTarget = getEngagedTarget();
    const preferredTarget = engagedTarget && !isTargetSkipped(engagedTarget, now)
      ? engagedTarget
      : (getMonsterCandidates(now)[0] || null);
    if (preferredTarget && setCurrentTarget(preferredTarget)) {
      state.lastTargetHotkeyAt = now;
      markCombatActive(now);
      bot.log("selected auto attack target", {
        id: preferredTarget.id,
        name: preferredTarget.name || "Mob",
        reason: isSameCreature(preferredTarget, engagedTarget) ? "engaged target" : "nearest candidate",
      });
      return true;
    }

    if (config.meleeMode) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.targetHotbarSlot);
    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      const monsters = getNearbyMonsters();
      state.lastTargetHotkeyAt = now;
      markCombatActive(now);
      bot.log("used auto attack target hotkey", {
        slot,
        nearbyMonsters: monsters.map((creature) => creature.name || "Mob"),
      });
    }

    return clicked;
  }

  function canUseRune(now = Date.now()) {
    const slot = normalizeHotbarSlot(config.runeHotbarSlot);
    if (!slot || !getCurrentTarget()) {
      return false;
    }

    if (now - state.lastRuneHotkeyAt < Math.max(0, Number(config.runeCooldownMs) || 0)) {
      return false;
    }

    return true;
  }

  function triggerRune(now = Date.now()) {
    if (!canUseRune(now)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.runeHotbarSlot);
    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      state.lastRuneHotkeyAt = now;
      markCombatActive(now);
      bot.log("used auto attack rune hotkey", {
        slot,
        target: getCurrentTarget()?.name || "Mob",
      });
    }

    return clicked;
  }

  function tryAttack() {
    if (!config.enabled) {
      return false;
    }

    const now = Date.now();

    if (reconcileDeadTargets(now)) {
      return triggerAttack(now) || true;
    }

    const engagedTarget = getEngagedTarget();
    if (engagedTarget && !shouldTargetCreature(engagedTarget)) {
      skipTarget(engagedTarget, "target does not match configured filters", now, 2000);
      return true;
    }

    if (resetTargetIfTooFar()) {
      return true;
    }

    syncCombatState(now);

    if (config.meleeMode) {
      const chased = syncMeleeChase(now);
      if (getCurrentTarget()) {
        return false;
      }

      if (chased) {
        return triggerAttack(now) || true;
      }
    }

    if (getCurrentTarget()) {
      return triggerRune(now);
    }

    return triggerAttack(now);
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
      tryAttack();
    } catch (error) {
      bot.log("auto attack tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    persistConfig();

    if (state.running) {
      bot.log("auto attack already running");
      return false;
    }

    state.running = true;
    bot.log("auto attack started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    clearEngagedTarget();
    state.lastChaseAt = 0;
    clearCurrentFollowTarget();
    state.skippedTargetIds.clear();

    bot.log("auto attack stopped");
    return true;
  }

  function status() {
    const combatActive = syncCombatState(Date.now());
    return {
      running: state.running,
      config: { ...config },
      lastTargetHotkeyAt: state.lastTargetHotkeyAt,
      lastRuneHotkeyAt: state.lastRuneHotkeyAt,
      engagedTargetId: state.engagedTargetId,
      combatActive,
      combatStartedAt: state.combatStartedAt || 0,
      combatDurationMs: state.combatStartedAt ? Math.max(0, Date.now() - state.combatStartedAt) : 0,
      targetCount: getCombatTargetCount(),
      lastChaseAt: state.lastChaseAt,
      currentTarget: getCurrentTarget()
        ? {
            id: getCurrentTarget().id,
            name: getCurrentTarget().name,
            type: getCurrentTarget().type,
            position: getCurrentTarget().__position || null,
          }
        : null,
      nearbyMonsters: getNearbyMonsters().map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: creature.__position || null,
      })),
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "targetHotbarSlot")) {
      nextConfig.targetHotbarSlot = normalizeHotbarSlot(nextConfig.targetHotbarSlot) ?? config.targetHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "runeHotbarSlot")) {
      nextConfig.runeHotbarSlot = normalizeHotbarSlot(nextConfig.runeHotbarSlot);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "maxTargetDistance")) {
      nextConfig.maxTargetDistance = Math.max(1, Math.trunc(Number(nextConfig.maxTargetDistance) || config.maxTargetDistance || 8));
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "targetFilterMode")) {
      nextConfig.targetFilterMode = normalizeTargetFilterMode(nextConfig.targetFilterMode);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "includedCreatureNames")) {
      nextConfig.includedCreatureNames = normalizeCreatureNameList(nextConfig.includedCreatureNames);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "excludedCreatureNames")) {
      nextConfig.excludedCreatureNames = normalizeCreatureNameList(nextConfig.excludedCreatureNames);
    }

    Object.assign(config, nextConfig);
    persistConfig();
    bot.log("auto attack config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.addCleanup(() => {
    stop({ persistEnabled: false });
  });

  bot.attack = {
    start,
    stop,
    status,
    updateConfig,
    tryAttack,
    canAttack,
    triggerAttack,
    canUseRune,
    triggerRune,
    getNearbyMonsters,
    getCurrentTarget,
    getCurrentFollowTarget,
    isCombatActive,
    syncMeleeChase,
    reconcileDeadTargets,
    getTrackedCreature,
    readCreatureHealth,
    isCreatureDead,
    normalizeHotbarSlot,
    config,
  };
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installCaveModule = function installCaveModule(bot) {
  const configStorageKey = "k9x.cave.config";
  const routeStorageKey = "k9x.cave.route";
  const transitionStorageKey = "k9x.cave.transitions";
  const presetStorageKey = "k9x.cave.presets";
  const defaultPresetName = "Default";
  const minimapOverlayRootId = "minibia-bot-cave-minimap-overlay";
  const minimapOverlayStyleId = "minibia-bot-cave-minimap-overlay-style";
  const ladderItemIds = new Set([1948, 1968]);
  const ropeNamePattern = /\brope\b/i;
  const shovelNamePattern = /\bshovel\b/i;
  const shovelTargetNamePatterns = [
    /\bstone pile\b/i,
    /\bloose stone pile\b/i,
    /\bgravel pile\b/i,
    /\bdirt pile\b/i,
  ];
  const state = {
    running: false,
    timerId: null,
    observerTimerId: null,
    currentIndex: 0,
    direction: 1,
    lastPathAt: 0,
    lastPositionKey: null,
    lastProgressAt: 0,
    lastStairsUseAt: 0,
    lastObservedPosition: null,
    pendingTransitionSource: null,
    pausedForCombat: false,
    lastUsedTransition: null,
    lastFloorChange: null,
    blockedTransitions: {},
  };
  const minimapOverlayState = {
    timerId: null,
  };

  const config = Object.assign(
    {
      tickMs: 500,
      repathMs: 1500,
      waypointTolerance: 0,
      cycleWaypoints: false,
      enabled: false,
      activePresetName: defaultPresetName,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 500;
  config.cycleWaypoints = !!config.cycleWaypoints;

  function normalizePresetName(value) {
    const normalized = String(value || "").trim().replace(/\s+/g, " ");
    return normalized || null;
  }

  function cloneValue(value) {
    return value ? JSON.parse(JSON.stringify(value)) : null;
  }

  function normalizePreset(value) {
    if (!value) {
      return null;
    }

    const name = normalizePresetName(value.name);
    if (!name) {
      return null;
    }

    return {
      name,
      route: normalizeRoute(value.route),
      transitions: normalizeTransitions(value.transitions),
    };
  }

  function normalizePresets(value) {
    const entries = Array.isArray(value) ? value : [];
    const deduped = new Map();

    entries.map(normalizePreset).filter(Boolean).forEach((preset) => {
      deduped.set(preset.name.toLowerCase(), preset);
    });

    return Array.from(deduped.values());
  }

  let route = normalizeRoute(bot.storage.get(routeStorageKey, []));
  let transitions = normalizeTransitions(bot.storage.get(transitionStorageKey, []));
  let presets = normalizePresets(bot.storage.get(presetStorageKey, []));

  if (!presets.length && (route.length || transitions.length)) {
    presets = [{
      name: defaultPresetName,
      route: route.map((waypoint) => cloneValue(waypoint)),
      transitions: transitions.map((transition) => cloneValue(transition)),
    }];
  }

  function getPresetNames() {
    return presets.map((preset) => preset.name);
  }

  function getPresetByName(name) {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) {
      return null;
    }

    return presets.find((preset) => preset.name.toLowerCase() === normalizedName.toLowerCase()) || null;
  }

  function getActivePresetName() {
    const configuredName = normalizePresetName(config.activePresetName);
    if (configuredName && getPresetByName(configuredName)) {
      return getPresetByName(configuredName).name;
    }

    if (presets.length) {
      return presets[0].name;
    }

    return configuredName || defaultPresetName;
  }

  function persistPresets() {
    bot.storage.set(
      presetStorageKey,
      presets.map((preset) => ({
        name: preset.name,
        route: preset.route.map((waypoint) => ({ ...waypoint })),
        transitions: preset.transitions.map((transition) => cloneValue(transition)),
      }))
    );
  }

  function persistLegacyActivePreset() {
    bot.storage.set(routeStorageKey, route.map((waypoint) => ({ ...waypoint })));
    bot.storage.set(transitionStorageKey, transitions.map((transition) => cloneValue(transition)));
  }

  function setActivePresetName(name) {
    config.activePresetName = normalizePresetName(name) || defaultPresetName;
    persistConfig();
    return config.activePresetName;
  }

  function upsertPreset(name, nextRoute = route, nextTransitions = transitions) {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) {
      return null;
    }

    const preset = {
      name: normalizedName,
      route: normalizeRoute(nextRoute).map((waypoint) => cloneValue(waypoint)),
      transitions: normalizeTransitions(nextTransitions).map((transition) => cloneValue(transition)),
    };
    const existingIndex = presets.findIndex((entry) => entry.name.toLowerCase() === normalizedName.toLowerCase());

    if (existingIndex >= 0) {
      presets[existingIndex] = preset;
    } else {
      presets.push(preset);
    }

    persistPresets();
    return preset;
  }

  function persistActivePreset() {
    upsertPreset(getActivePresetName(), route, transitions);
    persistLegacyActivePreset();
  }

  function loadPresetState(name) {
    const preset = getPresetByName(name);
    if (!preset) {
      return null;
    }

    route = normalizeRoute(preset.route);
    transitions = normalizeTransitions(preset.transitions);
    state.currentIndex = 0;
    state.direction = 1;
    state.pendingTransitionSource = null;
    setActivePresetName(preset.name);
    persistLegacyActivePreset();
    return preset;
  }

  const initialActivePreset = getActivePresetName();
  if (loadPresetState(initialActivePreset)) {
    config.activePresetName = initialActivePreset;
  } else {
    setActivePresetName(initialActivePreset);
  }

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function persistRoute() {
    persistActivePreset();
  }

  function normalizePosition(value) {
    if (!value) {
      return null;
    }

    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    return {
      x: Math.trunc(x),
      y: Math.trunc(y),
      z: Math.trunc(z),
    };
  }

  function normalizeWaypoint(waypoint) {
    return normalizePosition(waypoint);
  }

  function normalizeRoute(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map(normalizeWaypoint).filter(Boolean);
  }

  function normalizeTransition(transition) {
    if (!transition) {
      return null;
    }

    const from = normalizePosition(transition.from || transition);
    const to = normalizePosition(transition.to || {
      x: transition.targetX,
      y: transition.targetY,
      z: transition.targetZ,
    });

    if (!from || !to || from.z === to.z) {
      return null;
    }

    const count = Math.max(1, Math.trunc(Number(transition.count) || 1));
    const lastSeenAt = Math.max(0, Math.trunc(Number(transition.lastSeenAt) || Date.now()));

    return { from, to, count, lastSeenAt };
  }

  function normalizeTransitions(value) {
    if (!Array.isArray(value)) {
      return [];
    }

    const deduped = new Map();
    value.map(normalizeTransition).filter(Boolean).forEach((transition) => {
      deduped.set(getPositionKey(transition.from), transition);
    });
    return Array.from(deduped.values());
  }

  function getRoute() {
    return route.map((waypoint) => cloneValue(waypoint));
  }

  function getTransitions() {
    return transitions.map((transition) => cloneValue(transition));
  }

  function persistTransitions() {
    persistActivePreset();
  }

  function savePreset(name, options = {}) {
    const preset = upsertPreset(name, route, transitions);
    if (!preset) {
      bot.log("cave preset name is required");
      return null;
    }

    if (options.activate !== false) {
      setActivePresetName(preset.name);
      persistLegacyActivePreset();
    }

    bot.log("cave preset saved", {
      name: preset.name,
      waypoints: preset.route.length,
      transitions: preset.transitions.length,
    });
    return {
      name: preset.name,
      route: preset.route.map((waypoint) => cloneValue(waypoint)),
      transitions: preset.transitions.map((transition) => cloneValue(transition)),
    };
  }

  function createPreset(name) {
    const normalizedName = normalizePresetName(name);
    if (!normalizedName) {
      bot.log("cave preset name is required");
      return null;
    }

    if (getPresetByName(normalizedName)) {
      bot.log("cave preset already exists", { name: normalizedName });
      return null;
    }

    if (state.running) {
      stop();
    }

    const preset = upsertPreset(normalizedName, [], []);
    if (!preset) {
      return null;
    }

    loadPresetState(preset.name);
    bot.log("cave preset created", { name: preset.name });
    return {
      name: preset.name,
      route: [],
      transitions: [],
    };
  }

  function loadPreset(name) {
    const preset = getPresetByName(name);
    if (!preset) {
      bot.log("cave preset not found", { name });
      return null;
    }

    if (state.running) {
      stop();
    }

    loadPresetState(preset.name);
    bot.log("cave preset loaded", {
      name: preset.name,
      waypoints: route.length,
      transitions: transitions.length,
    });
    return {
      name: preset.name,
      route: getRoute(),
      transitions: getTransitions(),
    };
  }

  function deletePreset(name) {
    const preset = getPresetByName(name);
    if (!preset) {
      bot.log("cave preset not found", { name });
      return false;
    }

    presets = presets.filter((entry) => entry.name.toLowerCase() !== preset.name.toLowerCase());
    persistPresets();

    if (preset.name.toLowerCase() === getActivePresetName().toLowerCase()) {
      const fallbackPreset = presets[0] || null;
      if (state.running) {
        stop();
      }

      if (fallbackPreset) {
        loadPresetState(fallbackPreset.name);
      } else {
        route = [];
        transitions = [];
        state.currentIndex = 0;
        state.direction = 1;
        state.pendingTransitionSource = null;
        setActivePresetName(defaultPresetName);
        persistLegacyActivePreset();
      }
    }

    bot.log("cave preset deleted", { name: preset.name });
    return true;
  }

  function getCurrentWaypoint() {
    if (!route.length) {
      return null;
    }

    if (state.currentIndex < 0 || state.currentIndex >= route.length) {
      state.currentIndex = 0;
    }

    return route[state.currentIndex] || null;
  }

  function getPositionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : null;
  }

  function getBlockedTransitionKey(source, targetZ) {
    const sourceKey = getPositionKey(normalizePosition(source));
    const normalizedTargetZ = Math.trunc(Number(targetZ));
    if (!sourceKey || !Number.isFinite(normalizedTargetZ)) {
      return null;
    }

    return `${sourceKey}->${normalizedTargetZ}`;
  }

  function isTransitionBlocked(source, targetZ, now = Date.now()) {
    const key = getBlockedTransitionKey(source, targetZ);
    if (!key) {
      return false;
    }

    const blockedUntil = Number(state.blockedTransitions[key] || 0);
    if (!blockedUntil || blockedUntil <= now) {
      if (state.blockedTransitions[key]) {
        delete state.blockedTransitions[key];
      }
      return false;
    }

    return true;
  }

  function blockTransition(source, targetZ, durationMs, reason, now = Date.now()) {
    const key = getBlockedTransitionKey(source, targetZ);
    if (!key) {
      return;
    }

    const until = now + Math.max(1000, Math.trunc(Number(durationMs) || 0));
    state.blockedTransitions[key] = until;
    bot.log("cave temporarily blocked transition source", {
      source: normalizePosition(source),
      targetZ,
      blockedForMs: until - now,
      reason,
    });
  }

  function getDistance(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return Number.POSITIVE_INFINITY;
    }

    return Math.abs(Number(from.x) - Number(to.x)) + Math.abs(Number(from.y) - Number(to.y));
  }

  function isBesideOrSameTile(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return false;
    }

    return Math.abs(Number(from.x) - Number(to.x)) <= 1 &&
      Math.abs(Number(from.y) - Number(to.y)) <= 1;
  }

  function isAdjacentTile(from, to) {
    if (!from || !to || Number(from.z) !== Number(to.z)) {
      return false;
    }

    const dx = Math.abs(Number(from.x) - Number(to.x));
    const dy = Math.abs(Number(from.y) - Number(to.y));
    return (dx !== 0 || dy !== 0) && dx <= 1 && dy <= 1;
  }

  function getDistanceToWaypoint(position, waypoint) {
    if (!position || !waypoint) {
      return null;
    }

    return getDistance(position, waypoint);
  }

  function isSameTile(a, b) {
    if (!a || !b) {
      return false;
    }

    return Number(a.x) === Number(b.x) &&
      Number(a.y) === Number(b.y) &&
      Number(a.z) === Number(b.z);
  }

  function findClosestWaypointIndex(position) {
    if (!position || !route.length) {
      return 0;
    }

    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    route.forEach((waypoint, index) => {
      const distance = getDistanceToWaypoint(position, waypoint);
      if (!Number.isFinite(distance)) {
        return;
      }

      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  function getTileAt(position) {
    if (!position) {
      return null;
    }

    return window.gameClient?.world?.getTileFromWorldPosition?.(
      new Position(position.x, position.y, position.z)
    ) || null;
  }

  function getTilePosition(tile) {
    return normalizePosition(tile?.__position);
  }

  function getThingDefinition(itemId) {
    if (!itemId) {
      return null;
    }

    return (
      window.gameClient?.itemDefinitionsByCid?.[itemId] ||
      window.gameClient?.itemDefinitionsBySid?.[itemId] ||
      window.gameClient?.itemDefinitions?.[itemId] ||
      null
    );
  }

  function getThingName(thing) {
    const definition = getThingDefinition(thing?.id);
    return String(definition?.properties?.name || thing?.name || "").trim().toLowerCase();
  }

  function isLadderThing(thing) {
    if (!thing?.id) {
      return false;
    }

    if (ladderItemIds.has(Number(thing.id))) {
      return true;
    }

    return getThingName(thing).includes("ladder");
  }

  function isFloorChangeThing(thing) {
    const definition = getThingDefinition(thing?.id);
    return !!definition?.properties?.floorchange || isLadderThing(thing);
  }

  function isFloorChangeTile(tile) {
    const tilePosition = getTilePosition(tile);
    if (!tilePosition) {
      return false;
    }

    if (isFloorChangeThing(tile)) {
      return true;
    }

    return Array.isArray(tile.items) && tile.items.some((item) => isFloorChangeThing(item));
  }

  function getTileThings(tile) {
    if (!tile) {
      return [];
    }

    const things = [];
    if (tile.id) {
      things.push(tile);
    }
    if (Array.isArray(tile.items)) {
      tile.items.forEach((item) => {
        if (item) {
          things.push(item);
        }
      });
    }
    return things;
  }

  function tileHasNamedThing(tile, needle) {
    const value = String(needle || "").trim().toLowerCase();
    if (!value) {
      return false;
    }

    return getTileThings(tile).some((thing) => getThingName(thing).includes(value));
  }

  function isLadderTile(tile) {
    return getTileThings(tile).some((thing) => isLadderThing(thing));
  }

  function isStairsTile(tile) {
    return tileHasNamedThing(tile, "stairs");
  }

  function isHoleTile(tile) {
    return tileHasNamedThing(tile, "hole");
  }

  function isRopeSpotTile(tile) {
    return tileHasNamedThing(tile, "rope spot");
  }

  function isRopeTargetTile(tile) {
    return isHoleTile(tile) || isRopeSpotTile(tile);
  }

  function isShovelTargetThing(thing) {
    const name = getThingName(thing);
    if (!name) {
      return false;
    }

    return shovelTargetNamePatterns.some((pattern) => pattern.test(name));
  }

  function isShovelTargetTile(tile) {
    return getTileThings(tile).some((thing) => isShovelTargetThing(thing));
  }

  function isTransitionCandidateTile(tile, waypoint, position) {
    if (!tile) {
      return false;
    }

    if (isFloorChangeTile(tile)) {
      return true;
    }

    const hasWaypointDelta =
      waypoint &&
      position &&
      Number.isFinite(waypoint.z) &&
      Number.isFinite(position.z);

    if (!hasWaypointDelta) {
      return false;
    }

    if (waypoint.z > position.z) {
      return isShovelTargetTile(tile);
    }

    if (waypoint.z < position.z) {
      return isRopeTargetTile(tile);
    }

    return false;
  }

  function getFloorChangeTileBias(tile, position, waypoint) {
    if (!tile || !position || !waypoint || position.z === waypoint.z) {
      return 0;
    }

    const goingDown = waypoint.z > position.z;
    const goingUp = waypoint.z < position.z;

    if (goingDown) {
      if (isLadderTile(tile)) return -30;
      if (isHoleTile(tile)) return -20;
      if (isStairsTile(tile)) return 25;
    }

    if (goingUp) {
      if (isStairsTile(tile)) return -20;
      if (isHoleTile(tile)) return 20;
    }

    return 0;
  }

  function getLoadedTiles() {
    const chunks = window.gameClient?.world?.chunks || [];
    const tiles = [];

    for (const chunk of chunks) {
      if (!chunk?.tiles) continue;

      for (const tile of chunk.tiles) {
        if (tile?.__position) {
          tiles.push(tile);
        }
      }
    }

    return tiles;
  }

  function ensureMinimapOverlayStyle() {
    if (document.getElementById(minimapOverlayStyleId)) {
      return;
    }

    const style = document.createElement("style");
    style.id = minimapOverlayStyleId;
    style.textContent = `
      #${minimapOverlayRootId} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 999997;
      }

      #${minimapOverlayRootId} canvas {
        position: fixed;
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureMinimapOverlayRoot() {
    let root = document.getElementById(minimapOverlayRootId);
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = minimapOverlayRootId;
    root.innerHTML = '<canvas></canvas>';
    document.body.appendChild(root);
    return root;
  }

  function destroyMinimapOverlayElements() {
    document.getElementById(minimapOverlayRootId)?.remove();
    document.getElementById(minimapOverlayStyleId)?.remove();
  }

  function getMinimapCanvas() {
    return window.gameClient?.renderer?.minimap?.minimap?.canvas || document.getElementById("minimap") || null;
  }

  function getMinimapViewport() {
    const canvas = getMinimapCanvas();
    if (!(canvas instanceof HTMLCanvasElement)) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }

    return { canvas, rect };
  }

  function getWaypointCanvasPoint(waypoint, viewport, playerPosition, minimap) {
    if (!waypoint || !viewport || !playerPosition || !minimap) {
      return null;
    }

    if (waypoint.z !== minimap.__renderLayer) {
      return null;
    }

    const zoomScale = 1 << (Number(minimap.__zoomLevel) || 0);
    const center = minimap.center || { x: 0, y: 0 };
    const internalWidth = Number(viewport.canvas.width) || 160;
    const internalHeight = Number(viewport.canvas.height) || 160;
    const internalX = (internalWidth / 2) + (waypoint.x - playerPosition.x - Number(center.x || 0)) * zoomScale;
    const internalY = (internalHeight / 2) + (waypoint.y - playerPosition.y - Number(center.y || 0)) * zoomScale;

    return {
      x: internalX * (viewport.rect.width / internalWidth),
      y: internalY * (viewport.rect.height / internalHeight),
    };
  }

  function renderMinimapOverlay() {
    const viewport = getMinimapViewport();
    const minimap = window.gameClient?.renderer?.minimap;
    const playerPosition = normalizePosition(bot.getPlayerPosition());
    const root = ensureMinimapOverlayRoot();
    const canvas = root.querySelector("canvas");

    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    if (!viewport || !minimap || !playerPosition || !route.length) {
      canvas.width = 0;
      canvas.height = 0;
      return;
    }

    const rect = viewport.rect;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    canvas.style.left = `${Math.round(rect.left)}px`;
    canvas.style.top = `${Math.round(rect.top)}px`;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const visibleWaypoints = route
      .map((waypoint, index) => ({
        waypoint,
        index,
        point: getWaypointCanvasPoint(waypoint, viewport, playerPosition, minimap),
      }))
      .filter((entry) => entry.point);

    if (!visibleWaypoints.length) {
      return;
    }

    context.save();
    context.lineCap = "round";
    context.lineJoin = "round";

    for (let index = 1; index < visibleWaypoints.length; index += 1) {
      const previous = visibleWaypoints[index - 1];
      const current = visibleWaypoints[index];
      if (current.index !== previous.index + 1) {
        continue;
      }

      context.strokeStyle = "rgba(92, 228, 196, 0.7)";
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(previous.point.x, previous.point.y);
      context.lineTo(current.point.x, current.point.y);
      context.stroke();
    }

    visibleWaypoints.forEach(({ point, index }) => {
      const isCurrent = state.running && index === state.currentIndex;
      const radius = isCurrent ? 7 : 5;

      context.fillStyle = isCurrent ? "#ffcf5a" : "#2bd1c4";
      context.strokeStyle = isCurrent ? "#6a2400" : "#083f49";
      context.lineWidth = 2;
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.fillStyle = "#ffffff";
      context.font = "bold 11px Verdana, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(String(index + 1), point.x, point.y);
    });

    context.restore();
  }

  function startMinimapOverlay() {
    if (minimapOverlayState.timerId != null) {
      return;
    }

    ensureMinimapOverlayStyle();
    renderMinimapOverlay();
    minimapOverlayState.timerId = window.setInterval(renderMinimapOverlay, 250);
  }

  function stopMinimapOverlay() {
    if (minimapOverlayState.timerId != null) {
      window.clearInterval(minimapOverlayState.timerId);
      minimapOverlayState.timerId = null;
    }

    destroyMinimapOverlayElements();
  }

  function getNearbyTransitionTiles(position, waypoint, radius = 8) {
    if (!position) {
      return [];
    }

    return getLoadedTiles()
      .map((tile) => ({ tile, position: getTilePosition(tile) }))
      .filter((entry) =>
        entry.position &&
        entry.position.z === position.z &&
        Math.abs(entry.position.x - position.x) <= radius &&
        Math.abs(entry.position.y - position.y) <= radius &&
        isTransitionCandidateTile(entry.tile, waypoint, position)
      );
  }

  function findTransitionTileNearPosition(position, waypoint, radius = 1) {
    if (!position) {
      return null;
    }

    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    getNearbyTransitionTiles(position, waypoint, radius).forEach((entry) => {
      const distance = getDistance(position, entry.position);
      if (!Number.isFinite(distance)) {
        return;
      }

      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    });

    return best;
  }

  function findBestKnownTransition(position, waypoint, now = Date.now()) {
    if (!position || !waypoint) {
      return null;
    }

    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    transitions.forEach((transition) => {
      if (transition.from.z !== position.z || transition.to.z !== waypoint.z) {
        return;
      }

      if (isTransitionBlocked(transition.from, waypoint.z, now)) {
        return;
      }

      const playerDistance = getDistance(position, transition.from);
      const landingDistance = getDistance(transition.to, waypoint);
      if (!Number.isFinite(playerDistance) || !Number.isFinite(landingDistance)) {
        return;
      }

      const score = playerDistance * 10 + landingDistance;
      if (score < bestScore) {
        bestScore = score;
        best = transition;
      }
    });

    return best;
  }

  function findNearbyTransitionTile(position, waypoint, now = Date.now()) {
    if (!position || !waypoint) {
      return null;
    }

    const waypointDistance = Math.abs(position.x - waypoint.x) + Math.abs(position.y - waypoint.y);
    const radius = Math.max(4, Math.min(20, waypointDistance + 2));
    let best = null;
    let bestScore = Number.POSITIVE_INFINITY;

    getNearbyTransitionTiles(position, waypoint, radius).forEach((entry) => {
      if (isTransitionBlocked(entry.position, waypoint.z, now)) {
        return;
      }

      const playerDistance = getDistance(position, entry.position);
      const tileToWaypointDistance =
        Math.abs(entry.position.x - waypoint.x) + Math.abs(entry.position.y - waypoint.y);
      const score =
        playerDistance * 10 +
        tileToWaypointDistance +
        getFloorChangeTileBias(entry.tile, position, waypoint);

      if (score < bestScore) {
        bestScore = score;
        best = {
          tile: entry.tile,
          position: entry.position,
          playerDistance,
          waypointDistance: tileToWaypointDistance,
        };
      }
    });

    return best;
  }

  function isAtWaypoint(position, waypoint) {
    const distance = getDistanceToWaypoint(position, waypoint);
    if (!Number.isFinite(distance)) {
      return false;
    }

    return distance <= Math.max(0, Number(config.waypointTolerance) || 0);
  }

  function goToWaypoint(waypoint) {
    const from = bot.getPlayerPosition();
    if (!from || !waypoint) {
      return false;
    }

    const to = new Position(waypoint.x, waypoint.y, waypoint.z);

    try {
      window.gameClient?.world?.pathfinder?.findPath?.(from, to);
      state.lastPathAt = Date.now();
      bot.log("cave pathing to waypoint", {
        ...waypoint,
        index: state.currentIndex + 1,
        total: route.length,
      });
      return true;
    } catch (error) {
      bot.log("cave pathing failed", { ...waypoint, error: error?.message || error });
      return false;
    }
  }

  function goToPosition(position) {
    if (!position) {
      return false;
    }

    return goToWaypoint(position);
  }

  function markPendingTransitionSource(source) {
    const normalized = normalizePosition(source);
    if (!normalized) {
      return;
    }

    state.pendingTransitionSource = {
      ...normalized,
      at: Date.now(),
    };
  }

  function upsertTransition(from, to) {
    const normalizedFrom = normalizePosition(from);
    const normalizedTo = normalizePosition(to);
    if (!normalizedFrom || !normalizedTo || normalizedFrom.z === normalizedTo.z) {
      return null;
    }

    const key = getPositionKey(normalizedFrom);
    const index = transitions.findIndex((transition) => getPositionKey(transition.from) === key);
    const next = {
      from: normalizedFrom,
      to: normalizedTo,
      count: index >= 0 ? transitions[index].count + 1 : 1,
      lastSeenAt: Date.now(),
    };

    if (index >= 0) {
      transitions[index] = next;
    } else {
      transitions.push(next);
    }

    persistTransitions();
    bot.log("cave learned floor transition", next);
    return cloneValue(next);
  }

  function resolveObservedTransitionSource(previousPosition) {
    const pending = normalizePosition(state.pendingTransitionSource);
    if (pending && pending.z === previousPosition.z) {
      return pending;
    }

    const currentTile = getTileAt(previousPosition);
    if (currentTile && isFloorChangeTile(currentTile)) {
      return previousPosition;
    }

    const nearby = findTransitionTileNearPosition(previousPosition, null, 1);
    if (nearby?.position) {
      return nearby.position;
    }

    return null;
  }

  function observePosition() {
    const current = normalizePosition(bot.getPlayerPosition());
    if (!current) {
      return;
    }

    const previous = state.lastObservedPosition;
    if (previous && !isSameTile(previous, current) && previous.z !== current.z) {
      const now = Date.now();
      const source = resolveObservedTransitionSource(previous);
      if (source) {
        upsertTransition(source, current);
      }

      const lastUsedTransition = state.lastUsedTransition;
      if (lastUsedTransition && now - Number(lastUsedTransition.at || 0) <= 6000) {
        const expectedTargetZ = Number(lastUsedTransition.intendedTargetZ);
        const fromZ = Number(lastUsedTransition.fromZ);
        if (Number.isFinite(expectedTargetZ) && Number.isFinite(fromZ)) {
          const previousDistance = Math.abs(expectedTargetZ - fromZ);
          const currentDistance = Math.abs(expectedTargetZ - current.z);
          if (currentDistance >= previousDistance) {
            blockTransition(
              lastUsedTransition.source,
              expectedTargetZ,
              8000,
              "floor change moved away from target",
              now
            );
          }
        }
      }

      const recentChange = state.lastFloorChange;
      if (
        recentChange &&
        now - Number(recentChange.at || 0) <= 5000 &&
        Number(recentChange.fromZ) === Number(current.z) &&
        Number(recentChange.toZ) === Number(previous.z)
      ) {
        blockTransition(source || previous, current.z, 10000, "detected immediate floor bounce", now);
      }

      state.lastFloorChange = {
        fromZ: previous.z,
        toZ: current.z,
        at: now,
      };
      state.pendingTransitionSource = null;
    }

    state.lastObservedPosition = current;
  }

  function getEquipment() {
    return window.gameClient?.player?.equipment || null;
  }

  function getOpenContainers() {
    return Array.from(window.gameClient?.player?.__openedContainers || []);
  }

  function findAdjacentWalkablePosition(targetPosition, playerPosition) {
    if (!targetPosition || !playerPosition) {
      return null;
    }

    const offsets = [
      { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 },
      { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }, { x: 1, y: 1 },
    ];

    offsets.sort((a, b) => {
      const da = Math.abs(targetPosition.x + a.x - playerPosition.x) +
        Math.abs(targetPosition.y + a.y - playerPosition.y);
      const db = Math.abs(targetPosition.x + b.x - playerPosition.x) +
        Math.abs(targetPosition.y + b.y - playerPosition.y);
      return da - db;
    });

    for (const offset of offsets) {
      const position = new Position(
        targetPosition.x + offset.x,
        targetPosition.y + offset.y,
        targetPosition.z
      );
      const tile = window.gameClient?.world?.getTileFromWorldPosition?.(position);
      if (tile?.isWalkable?.()) {
        return normalizePosition(position);
      }
    }

    return null;
  }

  function isRopeItem(item) {
    const name = getThingName(item);
    return !!name && ropeNamePattern.test(name);
  }

  function isShovelItem(item) {
    const name = getThingName(item);
    return !!name && shovelNamePattern.test(name);
  }

  function findToolSource(predicate) {
    const equipment = getEquipment();

    if (equipment?.slots) {
      for (let slotIndex = 0; slotIndex < equipment.slots.length; slotIndex += 1) {
        const item = equipment.getSlotItem?.(slotIndex);
        if (predicate(item)) {
          return { which: equipment, index: slotIndex, item, location: "equipment" };
        }
      }
    }

    for (const container of getOpenContainers()) {
      const slots = container?.slots || [];
      for (let slotIndex = 0; slotIndex < slots.length; slotIndex += 1) {
        const item = container.getSlotItem?.(slotIndex);
        if (predicate(item)) {
          return { which: container, index: slotIndex, item, location: "container" };
        }
      }
    }

    return null;
  }

  function findRopeSource() {
    return findToolSource(isRopeItem);
  }

  function findShovelSource() {
    return findToolSource(isShovelItem);
  }

  function useToolOnTile(tool, targetTile, targetPosition, actionLabel, now = Date.now()) {
    if (!tool || !targetTile || !targetPosition) {
      return false;
    }

    const playerPosition = normalizePosition(bot.getPlayerPosition());
    if (!playerPosition) {
      return false;
    }

    if (!isAdjacentTile(playerPosition, targetPosition)) {
      const adjacentPosition = findAdjacentWalkablePosition(targetPosition, playerPosition);
      if (adjacentPosition) {
        return goToPosition(adjacentPosition);
      }
    }

    window.gameClient?.mouse?.__handleItemUseWith?.(
      { which: tool.which, index: tool.index },
      { which: targetTile, index: 0xFF }
    );
    state.lastStairsUseAt = now;
    state.lastPathAt = now;
    markPendingTransitionSource(targetPosition);
    bot.log(actionLabel, {
      source: targetPosition,
      toolLocation: tool.location,
      toolSlot: tool.index,
      toolName: getThingName(tool.item),
    });
    return true;
  }

  function useRopeOnTile(targetTile, targetPosition, now = Date.now()) {
    return useToolOnTile(
      findRopeSource(),
      targetTile,
      targetPosition,
      "cave roped transition tile",
      now
    );
  }

  function useShovelOnTile(targetTile, targetPosition, now = Date.now()) {
    return useToolOnTile(
      findShovelSource(),
      targetTile,
      targetPosition,
      "cave shoveled transition tile",
      now
    );
  }

  function useFloorChangeTile(target, waypoint, now = Date.now()) {
    const position = normalizePosition(bot.getPlayerPosition());
    const targetPosition = normalizePosition(target?.position);
    const targetTile = target?.tile || (targetPosition ? getTileAt(targetPosition) : null);
    if (!position || !targetPosition || !targetTile) {
      return false;
    }

    if (now - state.lastStairsUseAt < 1200) {
      return true;
    }

    if (waypoint?.z < position.z && isRopeTargetTile(targetTile)) {
      return useRopeOnTile(targetTile, targetPosition, now);
    }

    if (!isFloorChangeTile(targetTile)) {
      if (waypoint?.z > position.z && isShovelTargetTile(targetTile)) {
        return useShovelOnTile(targetTile, targetPosition, now);
      }
      return false;
    }

    if (isLadderTile(targetTile)) {
      window.gameClient?.mouse?.use?.({ which: targetTile, index: 0xFF });
      state.lastStairsUseAt = now;
      state.lastPathAt = now;
      markPendingTransitionSource(targetPosition);
      state.lastUsedTransition = {
        source: targetPosition,
        fromZ: position.z,
        intendedTargetZ: waypoint?.z ?? null,
        at: now,
      };
      bot.log("cave used ladder tile", {
        source: targetPosition,
        targetZ: waypoint?.z ?? null,
      });
      return true;
    }

    if (!isSameTile(position, targetPosition)) {
      return goToPosition(targetPosition);
    }

    const currentTile = getTileAt(position);
    if (!currentTile || !isFloorChangeTile(currentTile)) {
      return false;
    }

    window.gameClient?.mouse?.use?.({ which: currentTile, index: 0xFF });
    state.lastStairsUseAt = now;
    state.lastPathAt = now;
    markPendingTransitionSource(position);
    state.lastUsedTransition = {
      source: position,
      fromZ: position.z,
      intendedTargetZ: waypoint?.z ?? null,
      at: now,
    };
    bot.log("cave used floor-change tile", {
      source: position,
      targetZ: waypoint?.z ?? null,
    });
    return true;
  }

  function handleFloorChange(waypoint, now = Date.now()) {
    const position = normalizePosition(bot.getPlayerPosition());
    if (!position || !waypoint || position.z === waypoint.z) {
      return false;
    }

    const knownTransition = findBestKnownTransition(position, waypoint, now);
    if (knownTransition) {
      const target = {
        tile: getTileAt(knownTransition.from),
        position: knownTransition.from,
      };
      const moved = useFloorChangeTile(target, waypoint, now);
      if (moved) {
        bot.log("cave using learned floor transition", {
          from: knownTransition.from,
          to: knownTransition.to,
          waypoint,
        });
        return true;
      }

      bot.log("cave learned transition unavailable, falling back to live scan", {
        from: knownTransition.from,
        to: knownTransition.to,
        waypoint,
      });
    }

    const visibleCandidate = findNearbyTransitionTile(position, waypoint, now);
    if (visibleCandidate) {
      const moved = useFloorChangeTile(visibleCandidate, waypoint, now);
      if (moved) {
        bot.log("cave probing visible floor-change tile", {
          tileX: visibleCandidate.position.x,
          tileY: visibleCandidate.position.y,
          tileZ: visibleCandidate.position.z,
          targetZ: waypoint.z,
        });
        return true;
      }
    }
    return false;
  }

  function advanceWaypoint() {
    if (!route.length) {
      return null;
    }

    if (route.length === 1) {
      return route[0];
    }

    if (config.cycleWaypoints) {
      state.currentIndex = (state.currentIndex + 1) % route.length;
      state.direction = 1;

      const nextWaypoint = getCurrentWaypoint();
      bot.log("cave advanced waypoint", {
        index: state.currentIndex + 1,
        total: route.length,
        direction: state.direction,
        mode: "cycle",
        waypoint: nextWaypoint,
      });
      return nextWaypoint;
    }

    let nextIndex = state.currentIndex + state.direction;

    if (nextIndex >= route.length) {
      state.direction = -1;
      nextIndex = route.length - 2;
    } else if (nextIndex < 0) {
      state.direction = 1;
      nextIndex = 1;
    }

    state.currentIndex = Math.max(0, Math.min(route.length - 1, nextIndex));

    const nextWaypoint = getCurrentWaypoint();
    bot.log("cave advanced waypoint", {
      index: state.currentIndex + 1,
      total: route.length,
      direction: state.direction,
      mode: "bounce",
      waypoint: nextWaypoint,
    });
    return nextWaypoint;
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
      observePosition();

      if (!route.length) {
        stop();
        return;
      }

      const position = normalizePosition(bot.getPlayerPosition());
      const positionKey = getPositionKey(position);
      const now = Date.now();
      const attackStatus = bot.attack?.status?.() || null;
      const shouldPauseForCombat =
        !!attackStatus?.combatActive &&
        Number(attackStatus?.combatDurationMs || 0) < 60000;

      if (shouldPauseForCombat) {
        if (!state.pausedForCombat) {
          state.pausedForCombat = true;
          bot.log("cave paused for auto attack", {
            combatDurationMs: Number(attackStatus?.combatDurationMs || 0),
            targetCount: Number(attackStatus?.targetCount || 0),
          });
        }
        return;
      }

      if (state.pausedForCombat) {
        state.pausedForCombat = false;
        bot.log("cave resumed after auto attack", {
          combatDurationMs: Number(attackStatus?.combatDurationMs || 0),
          targetCount: Number(attackStatus?.targetCount || 0),
        });
      }

      if (positionKey && positionKey !== state.lastPositionKey) {
        state.lastPositionKey = positionKey;
        state.lastProgressAt = now;
      }

      let waypoint = getCurrentWaypoint();
      if (!waypoint) {
        stop();
        return;
      }

      if (isAtWaypoint(position, waypoint)) {
        waypoint = advanceWaypoint();
      }

      if (!waypoint) {
        return;
      }

      if (position && waypoint.z !== position.z) {
        handleFloorChange(waypoint, now);
        return;
      }

      const shouldRepath =
        now - state.lastPathAt >= config.repathMs ||
        !state.lastProgressAt ||
        now - state.lastProgressAt >= config.repathMs;

      if (shouldRepath) {
        goToWaypoint(waypoint);
      }
    } catch (error) {
      bot.log("cave tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function startObserver() {
    if (state.observerTimerId != null) {
      return;
    }

    state.observerTimerId = window.setInterval(() => {
      try {
        observePosition();
      } catch (error) {
        bot.log("cave observer failed", error?.message || error);
      }
    }, 200);
  }

  function stopObserver() {
    if (state.observerTimerId == null) {
      return;
    }

    window.clearInterval(state.observerTimerId);
    state.observerTimerId = null;
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 500;
    persistConfig();

    if (!route.length) {
      bot.log("cave bot cannot start without waypoints");
      return false;
    }

    if (state.running) {
      bot.log("cave bot already running");
      return false;
    }

    const position = normalizePosition(bot.getPlayerPosition());
    state.running = true;
    state.currentIndex = findClosestWaypointIndex(position);
    state.direction = config.cycleWaypoints
      ? 1
      : (state.currentIndex >= route.length - 1 ? -1 : 1);
    if (route.length <= 1) {
      state.direction = 1;
    }
    state.lastPathAt = 0;
    state.lastPositionKey = getPositionKey(position);
    state.lastProgressAt = Date.now();
    state.pausedForCombat = false;
    bot.log("cave bot started", {
      waypoints: route.length,
      currentIndex: state.currentIndex + 1,
      direction: state.direction,
      waypoint: getCurrentWaypoint(),
    });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    state.pausedForCombat = false;
    bot.log("cave bot stopped");
    return true;
  }

  function addWaypoint(waypoint) {
    const normalized = normalizeWaypoint(waypoint);
    if (!normalized) {
      return null;
    }

    route.push(normalized);
    persistRoute();
    bot.log("cave waypoint added", { ...normalized, total: route.length });
    return cloneValue(normalized);
  }

  function addWaypointCurrentSpot() {
    const position = normalizePosition(bot.getPlayerPosition());
    if (!position) {
      bot.log("could not read current position for cave waypoint");
      return null;
    }

    return addWaypoint(position);
  }

  function clearWaypoints() {
    route = [];
    state.currentIndex = 0;
    state.direction = 1;
    persistRoute();
    bot.log("cave route cleared");

    if (state.running) {
      stop();
    }

    return [];
  }

  function clearTransitions() {
    transitions = [];
    state.pendingTransitionSource = null;
    persistTransitions();
    bot.log("cave learned transitions cleared");
    return [];
  }

  function removeLastWaypoint() {
    if (!route.length) {
      return null;
    }

    const removed = route.pop();
    if (state.currentIndex >= route.length) {
      state.currentIndex = Math.max(0, route.length - 1);
    }
    if (route.length <= 1) {
      state.direction = 1;
    }
    persistRoute();
    bot.log("cave waypoint removed", removed);

    if (!route.length && state.running) {
      stop();
    }

    return removed;
  }

  function setCurrentIndex(index) {
    if (!route.length) {
      state.currentIndex = 0;
      state.direction = 1;
      return 0;
    }

    const nextIndex = Math.max(0, Math.min(route.length - 1, Math.trunc(Number(index) || 0)));
    state.currentIndex = nextIndex;
    state.direction = config.cycleWaypoints
      ? 1
      : (nextIndex >= route.length - 1 ? -1 : 1);
    if (route.length <= 1) {
      state.direction = 1;
    }
    return state.currentIndex;
  }

  function status() {
    const position = normalizePosition(bot.getPlayerPosition());
    const waypoint = getCurrentWaypoint();

    return {
      running: state.running,
      config: { ...config },
      route: getRoute(),
      transitions: getTransitions(),
      presetNames: getPresetNames(),
      activePresetName: getActivePresetName(),
      currentIndex: state.currentIndex,
      direction: state.direction,
      currentWaypoint: cloneValue(waypoint),
      distanceToWaypoint: getDistanceToWaypoint(position, waypoint),
      lastPathAt: state.lastPathAt,
      lastProgressAt: state.lastProgressAt,
      pendingTransitionSource: cloneValue(state.pendingTransitionSource),
      pausedForCombat: state.pausedForCombat,
    };
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    config.tickMs = 500;
    config.cycleWaypoints = !!config.cycleWaypoints;

    if (config.cycleWaypoints && route.length > 1) {
      state.direction = 1;
    }

    persistConfig();
    bot.log("cave config updated", { ...config });
    return { ...config };
  }

  startObserver();
  bot.addCleanup(stopObserver);
  startMinimapOverlay();
  bot.addCleanup(stopMinimapOverlay);

  if (config.enabled && route.length) {
    start();
  }

  bot.cave = {
    start,
    stop,
    status,
    updateConfig,
    config,
    getRoute,
    getTransitions,
    getPresetNames,
    getActivePresetName,
    getCurrentWaypoint,
    createPreset,
    savePreset,
    loadPreset,
    deletePreset,
    addWaypoint,
    addWaypointCurrentSpot,
    clearWaypoints,
    clearTransitions,
    removeLastWaypoint,
    setCurrentIndex,
    goToWaypoint,
    goToPosition,
    handleFloorChange,
    findClosestWaypointIndex,
    findRopeSource,
    findShovelSource,
    inspectNearbyTiles: (radius = 1) => {
      const position = normalizePosition(bot.getPlayerPosition());
      if (!position) {
        return [];
      }

      return getLoadedTiles()
        .map((tile) => ({ tile, position: getTilePosition(tile) }))
        .filter((entry) =>
          entry.position &&
          entry.position.z === position.z &&
          Math.abs(entry.position.x - position.x) <= radius &&
          Math.abs(entry.position.y - position.y) <= radius
        )
        .map((entry) => ({
          position: entry.position,
          isFloorChange: isFloorChangeTile(entry.tile),
          isHole: isHoleTile(entry.tile),
          isRopeTarget: isRopeTargetTile(entry.tile),
          isShovelTarget: isShovelTargetTile(entry.tile),
          names: getTileThings(entry.tile).map((thing) => getThingName(thing)).filter(Boolean),
        }));
    },
    isAtWaypoint,
  };
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installEquipRingModule = function installEquipRingModule(bot) {
  const configStorageKey = "k9x.equipRing.config";
  const RING_SLOT = 8;
  const state = {
    running: false,
    timerId: null,
    lastEquipAt: 0,
  };
  let resumeListenersAttached = false;

  const config = Object.assign(
    {
      tickMs: 1000,
      equipCooldownMs: 1500,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 1000;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function getEquipment() {
    return window.gameClient?.player?.equipment || null;
  }

  function getOpenContainers() {
    return Array.from(window.gameClient?.player?.__openedContainers || []);
  }

  function getItemDefinition(item) {
    if (!item) return null;

    return (
      window.gameClient?.itemDefinitionsBySid?.[item.sid] ||
      window.gameClient?.itemDefinitions?.[item.id] ||
      null
    );
  }

  function getItemName(item) {
    const definition = getItemDefinition(item);
    return definition?.properties?.name || item?.name || "";
  }

  function isRingItem(item) {
    if (!item) {
      return false;
    }

    const definition = getItemDefinition(item);
    const slotType = String(
      definition?.properties?.slotType ||
      definition?.properties?.slot ||
      ""
    ).trim().toLowerCase();

    if (slotType === "ring") {
      return true;
    }

    return /\bring\b/i.test(getItemName(item));
  }

  function getEquippedRing() {
    const equipment = getEquipment();
    return equipment?.getSlotItem?.(RING_SLOT) || null;
  }

  function hasEquippedRing() {
    return !!getEquippedRing();
  }

  function findBestRingSource() {
    const equipment = getEquipment();
    if (!equipment) {
      return null;
    }

    let best = null;
    let bestCount = -1;

    const consider = (container, slotIndex, item) => {
      if (!isRingItem(item)) {
        return;
      }

      const count = (typeof item.getCount === "function" ? item.getCount() : item.count) || 1;
      if (count > bestCount) {
        bestCount = count;
        best = { container, slotIndex, item, count, name: getItemName(item) };
      }
    };

    for (let slotIndex = 0; slotIndex < equipment.slots.length; slotIndex += 1) {
      if (slotIndex === RING_SLOT) continue;
      consider(equipment, slotIndex, equipment.getSlotItem(slotIndex));
    }

    getOpenContainers().forEach((container) => {
      (container?.slots || []).forEach((slot, slotIndex) => {
        consider(container, slotIndex, container.getSlotItem(slotIndex));
      });
    });

    return best;
  }

  function getGateStatus(now = Date.now()) {
    const equipment = getEquipment();
    const source = findBestRingSource();
    const cooldownRemainingMs = Math.max(0, config.equipCooldownMs - (now - state.lastEquipAt));

    return {
      hasEquipment: !!equipment,
      hasRingEquipped: hasEquippedRing(),
      hasRingAvailable: !!source,
      cooldownReady: cooldownRemainingMs === 0,
      cooldownRemainingMs,
      source,
      canEquip: !!equipment && !hasEquippedRing() && !!source && cooldownRemainingMs === 0,
    };
  }

  function canEquipRing(now = Date.now()) {
    return getGateStatus(now).canEquip;
  }

  function tryEquipRing(now = Date.now()) {
    if (!config.enabled || !canEquipRing(now)) {
      return false;
    }

    const equipment = getEquipment();
    const source = findBestRingSource();
    if (!equipment || !source) {
      return false;
    }

    const from = {
      which: source.container,
      index: source.slotIndex,
    };
    const to = {
      which: equipment,
      index: RING_SLOT,
    };
    const count = source.count || 1;

    window.gameClient.send(new ItemMovePacket(from, to, count));
    state.lastEquipAt = now;
    bot.log("equipped ring", {
      name: source.name,
      fromContainerId: source.container?.__containerId ?? null,
      fromSlot: source.slotIndex,
    });
    return true;
  }

  function scheduleNextTick() {
    if (!state.running) return;

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function runImmediateTick() {
    if (!state.running) return;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    tick();
  }

  function handleResume() {
    if (document.hidden) {
      return;
    }

    runImmediateTick();
  }

  function attachResumeListeners() {
    if (resumeListenersAttached) {
      return;
    }

    document.addEventListener("visibilitychange", handleResume);
    window.addEventListener("focus", handleResume);
    window.addEventListener("pageshow", handleResume);
    resumeListenersAttached = true;
  }

  function detachResumeListeners() {
    if (!resumeListenersAttached) {
      return;
    }

    document.removeEventListener("visibilitychange", handleResume);
    window.removeEventListener("focus", handleResume);
    window.removeEventListener("pageshow", handleResume);
    resumeListenersAttached = false;
  }

  function tick() {
    if (!state.running) return;

    try {
      tryEquipRing();
    } catch (error) {
      bot.log("equip ring tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 1000;
    persistConfig();

    if (state.running) {
      bot.log("equip ring already running");
      return false;
    }

    state.running = true;
    attachResumeListeners();
    bot.log("equip ring started", { ...config });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    detachResumeListeners();

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("equip ring stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      gates: getGateStatus(),
      equippedRing: getEquippedRing(),
      lastEquipAt: state.lastEquipAt,
    };
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    config.tickMs = 1000;
    persistConfig();
    bot.log("equip ring config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.equipRing = {
    start,
    stop,
    status,
    updateConfig,
    config,
    getEquippedRing,
    hasEquippedRing,
    findBestRingSource,
    getGateStatus,
    canEquipRing,
    tryEquipRing,
  };
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoEatModule = function installAutoEatModule(bot) {
  const configStorageKey = "k9x.eat.config";
  const state = {
    running: false,
    timerId: null,
    lastFoodAt: 0,
  };

  const config = Object.assign(
    {
      tickMs: 1000,
      eatCooldownMs: 60000,
      eatHotbarSlot: 10,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  config.tickMs = 1000;

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeHotbarSlot(slot) {
    const value = Number(slot);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    if (normalized < 1 || normalized > 12) {
      return null;
    }

    return normalized;
  }

  function readFoodTimer() {
    const foodText =
      document.querySelector('#skill-window div[skill="food"] .skill')?.textContent?.trim() ||
      null;

    if (!foodText) return null;

    const match = foodText.match(/^(\d{1,2}):(\d{2})$/);
    return match
      ? {
          text: foodText,
          seconds: Number(match[1]) * 60 + Number(match[2]),
        }
      : { text: foodText, seconds: null };
  }

  function isSated() {
    const player = window.gameClient?.player;
    const conditions = player?.conditions;

    if (conditions?.has && conditions.SATED != null) {
      return conditions.has(conditions.SATED);
    }

    const food = readFoodTimer();
    if (food?.seconds != null) {
      return food.seconds > 0;
    }

    return true;
  }

  function tryEat() {
    if (!config.enabled) {
      return false;
    }

    if (isSated()) {
      return false;
    }

    if (Date.now() - state.lastFoodAt < config.eatCooldownMs) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.eatHotbarSlot);
    if (!slot) {
      return false;
    }

    const slotIndex = slot - 1;
    const clicked = bot.clickHotbar(slotIndex);

    if (clicked) {
      state.lastFoodAt = Date.now();
      bot.log("used eat hotkey", { slot });
    }

    return clicked;
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
      tryEat();
    } catch (error) {
      bot.log("auto eat tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    config.tickMs = 1000;
    persistConfig();

    if (state.running) {
      bot.log("auto eat already running");
      return false;
    }

    state.running = true;
    bot.log("auto eat started", { eatCooldownMs: config.eatCooldownMs, eatHotbarSlot: config.eatHotbarSlot });
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }
    bot.log("auto eat stopped");
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      lastFoodAt: state.lastFoodAt,
      isSated: isSated(),
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "eatHotbarSlot")) {
      nextConfig.eatHotbarSlot = normalizeHotbarSlot(nextConfig.eatHotbarSlot) ?? config.eatHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "eatCooldownMs")) {
      nextConfig.eatCooldownMs = Math.max(0, Number(nextConfig.eatCooldownMs) || 0);
    }

    Object.assign(config, nextConfig);
    config.tickMs = 1000;
    persistConfig();
    bot.log("auto eat config updated", { ...config });
    return { ...config };
  }

  if (config.enabled) {
    start();
  }

  bot.eat = {
    start,
    stop,
    status,
    updateConfig,
    isSated,
    tryEat,
    normalizeHotbarSlot,
    config,
  };

  bot.startAutoEat = start;
  bot.stopAutoEat = stop;

  if (bot.rune) {
    bot.rune.startAutoEat = start;
    bot.rune.stopAutoEat = stop;
    bot.rune.tryEat = tryEat;
    bot.rune.isSated = isSated;
  }
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoFishingModule = function installAutoFishingModule(bot) {
  const configStorageKey = "k9x.fishing.config";
  const state = {
    running: false,
    timerId: null,
    lastCastAt: 0,
    mouseX: null,
    mouseY: null,
    listeningForRightClick: false,
  };

  const config = Object.assign(
    {
      tickMs: 200,
      rodHotbarSlot: null,
      enabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );
  const storedTickMs = Number(config.tickMs);
  config.tickMs = !Number.isFinite(storedTickMs) || storedTickMs >= 1000
    ? 200
    : Math.max(50, storedTickMs);

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeHotbarSlot(slot) {
    const value = Number(slot);
    if (!Number.isFinite(value)) {
      return null;
    }

    const normalized = Math.trunc(value);
    if (normalized < 1 || normalized > 12) {
      return null;
    }

    return normalized;
  }

  function readRodHotbarSlotFromPrompt(defaultSlot = null) {
    const fallback = normalizeHotbarSlot(defaultSlot) || 1;
    const input = window.prompt("Fishing rod hotkey slot (1-12)", String(fallback));

    if (input == null) {
      return null;
    }

    const slot = normalizeHotbarSlot(input);
    if (!slot) {
      window.alert("Invalid slot. Use a number from 1 to 12.");
      return null;
    }

    return slot;
  }

  function trackMousePosition(event) {
    state.mouseX = Number(event?.clientX);
    state.mouseY = Number(event?.clientY);
  }

  function dispatchLeftClickAtPointer() {
    if (!Number.isFinite(state.mouseX) || !Number.isFinite(state.mouseY)) {
      return false;
    }

    const target = document.elementFromPoint(state.mouseX, state.mouseY);
    if (!target) {
      return false;
    }

    const eventInit = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: state.mouseX,
      clientY: state.mouseY,
      button: 0,
      buttons: 1,
    };

    target.dispatchEvent(new MouseEvent("mousedown", eventInit));
    target.dispatchEvent(new MouseEvent("mouseup", eventInit));
    target.dispatchEvent(new MouseEvent("click", eventInit));
    return true;
  }

  function handleRightClickToStop(event) {
    if (!state.running) {
      return;
    }

    if (event?.button === 2 || event?.type === "contextmenu") {
      stop();
    }
  }

  function ensureRightClickStopListener() {
    if (state.listeningForRightClick) {
      return;
    }

    window.addEventListener("mousedown", handleRightClickToStop, true);
    window.addEventListener("contextmenu", handleRightClickToStop, true);
    state.listeningForRightClick = true;
  }

  function tryFish() {
    if (!config.enabled) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.rodHotbarSlot);
    if (!slot) {
      return false;
    }

    const hotbarClicked = bot.clickHotbar(slot - 1);
    const waterClicked = dispatchLeftClickAtPointer();

    if (hotbarClicked && waterClicked) {
      state.lastCastAt = Date.now();
      return true;
    }

    return false;
  }

  function scheduleNextTick() {
    if (!state.running) {
      return;
    }

    state.timerId = window.setTimeout(() => {
      tick();
    }, config.tickMs);
  }

  function tick() {
    if (!state.running) {
      return;
    }

    try {
      tryFish();
    } catch (error) {
      bot.log("auto fishing tick failed", error?.message || error);
    } finally {
      scheduleNextTick();
    }
  }

  function start(overrides = {}) {
    const promptHotbarSlot = overrides.promptHotbarSlot !== false;
    let nextRodHotbarSlot = normalizeHotbarSlot(overrides.rodHotbarSlot);

    if (!nextRodHotbarSlot) {
      const fallbackSlot = normalizeHotbarSlot(config.rodHotbarSlot);
      if (promptHotbarSlot) {
        nextRodHotbarSlot = readRodHotbarSlotFromPrompt(fallbackSlot);
        if (!nextRodHotbarSlot) {
          return false;
        }
      } else {
        nextRodHotbarSlot = fallbackSlot;
      }
    }

    if (!nextRodHotbarSlot) {
      bot.log("auto fishing missing rod hotbar slot");
      return false;
    }

    Object.assign(config, overrides, {
      enabled: true,
      rodHotbarSlot: nextRodHotbarSlot,
      tickMs: Math.max(50, Number(overrides.tickMs) || config.tickMs || 200),
    });
    persistConfig();

    if (bot.cave?.status?.().running) {
      bot.cave.stop();
    }

    if (state.running) {
      bot.ui?.refreshAutoFishingStatus?.();
      return false;
    }

    state.running = true;
    ensureRightClickStopListener();
    bot.log("auto fishing started", { rodHotbarSlot: config.rodHotbarSlot });
    bot.ui?.refreshAutoFishingStatus?.();
    tick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    bot.log("auto fishing stopped");
    bot.ui?.refreshAutoFishingStatus?.();
    return true;
  }

  function status() {
    return {
      running: state.running,
      config: { ...config },
      lastCastAt: state.lastCastAt,
    };
  }

  function updateConfig(nextConfig = {}) {
    if (Object.prototype.hasOwnProperty.call(nextConfig, "rodHotbarSlot")) {
      nextConfig.rodHotbarSlot = normalizeHotbarSlot(nextConfig.rodHotbarSlot) ?? config.rodHotbarSlot;
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "tickMs")) {
      nextConfig.tickMs = Math.max(50, Number(nextConfig.tickMs) || config.tickMs || 200);
    }

    Object.assign(config, nextConfig);
    config.tickMs = Math.max(50, Number(config.tickMs) || 200);
    persistConfig();
    bot.log("auto fishing config updated", { ...config });
    return { ...config };
  }

  window.addEventListener("mousemove", trackMousePosition, { passive: true });
  bot.addCleanup(() => {
    window.removeEventListener("mousemove", trackMousePosition, { passive: true });
    window.removeEventListener("mousedown", handleRightClickToStop, true);
    window.removeEventListener("contextmenu", handleRightClickToStop, true);
  });

  if (config.enabled) {
    start({ promptHotbarSlot: false });
  }

  bot.fishing = {
    start,
    stop,
    status,
    updateConfig,
    tryFish,
    normalizeHotbarSlot,
    config,
  };

  bot.startAutoFishing = start;
  bot.stopAutoFishing = stop;
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installTalkModule = function installTalkModule(bot) {
  const configStorageKey = "k9x.talk.config";
  const legacyDefaultModels = ["gemini-3-pro-preview", "gemini-2.0-flash"];
  const defaultModel = "gemini-2.5-flash-lite";
  const defaultSystemPrompt =
    "You are a normal Tibia MMORPG player chatting in Minibia in live in-game chat. Every reply must sound like Tibia player chat: casual, brief, informal, fully lowercase, and natural for a real player typing quickly. Use plain text only. Keep it under 90 characters and under 12 words. Prefer short Tibia-style phrasing, light slang, abbreviations, and simple punctuation when natural. Avoid polished grammar, title case, or assistant-like wording. Write like someone typing mid-hunt or while afk for a sec. Never say you are a bot or AI.";
  const defaultGreetingPrompt =
    "Respond to greetings like a Tibia MMORPG player in chat. Be short, casual, friendly, and in-character for fast Tibia-style game chat. Use lowercase. One sentence only. Plain text only.";
  const defaultQuestionPrompt =
    "Respond to questions like a Tibia MMORPG player in chat, but stay vague and noncommittal. Keep it brief, casual, and a little evasive. Use lowercase and do not explain much. One short sentence only. Plain text only. If asked whether you are a bot, reply with no.";
  const defaultStatementPrompt =
    "Respond to statements like a Tibia MMORPG player in chat. Keep it short, casual, reactive, and natural for live Tibia-style game chat. Use lowercase. One sentence only. Plain text only.";
  const minPollMs = 1000;
  const maxMessageAgeMs = 2 * 60 * 1000;
  const state = {
    running: false,
    pending: false,
    timerId: null,
    lastReplyAt: 0,
    seenKeys: [],
    seenSignatures: [],
  };
  const greetingReplies = ["yo", "sup", "hey", "hiya", "yo lol"];
  const agreeReplies = ["true", "fr", "based", "ya", "real"];
  const vagueQuestionReplies = ["maybe", "not sure", "hard to say", "could be"];
  const denyBotReplies = ["no", "nope", "nah"];

  const config = Object.assign(
    {
      enabled: false,
      apiKey: "",
      model: defaultModel,
      pollMs: minPollMs,
      replyCooldownMs: 1500,
      systemPrompt: defaultSystemPrompt,
      greetingPrompt: defaultGreetingPrompt,
      questionPrompt: defaultQuestionPrompt,
      statementPrompt: defaultStatementPrompt,
    },
    bot.storage.get(configStorageKey, {})
  );

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeText(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function sanitizeConfig() {
    config.apiKey = String(config.apiKey || "").trim();
    config.model = String(config.model || defaultModel).trim() || defaultModel;
    if (legacyDefaultModels.includes(config.model)) {
      config.model = defaultModel;
    }
    config.pollMs = Math.max(minPollMs, Number(config.pollMs) || minPollMs);
    config.replyCooldownMs = Math.max(0, Number(config.replyCooldownMs) || 1500);
    config.systemPrompt = String(config.systemPrompt || defaultSystemPrompt).trim() || defaultSystemPrompt;
    config.greetingPrompt = String(config.greetingPrompt || defaultGreetingPrompt).trim() || defaultGreetingPrompt;
    config.questionPrompt = String(config.questionPrompt || defaultQuestionPrompt).trim() || defaultQuestionPrompt;
    config.statementPrompt = String(config.statementPrompt || defaultStatementPrompt).trim() || defaultStatementPrompt;
  }

  function trimSeen() {
    const maxSeenEntries = 200;
    if (state.seenKeys.length > maxSeenEntries) {
      state.seenKeys = state.seenKeys.slice(-maxSeenEntries);
    }

    if (state.seenSignatures.length > maxSeenEntries) {
      state.seenSignatures = state.seenSignatures.slice(-maxSeenEntries);
    }
  }

  function getSelfNames() {
    return new Set(
      ["you", bot.getPlayerName?.(), window.gameClient?.player?.name, window.gameClient?.player?.state?.name]
        .map((name) => normalizeText(name))
        .filter(Boolean)
    );
  }

  function extractSenderFromMessage(message) {
    const text = String(message || "").trim();
    if (!text) {
      return { sender: null, body: "" };
    }

    const patterns = [
      /^\[[^\]]+\]\s*([^:\n]{2,40}):\s+(.+)$/i,
      /^([^:\n]{2,40}):\s+(.+)$/i,
      /^([^:\n]{2,40})\s+says:\s+(.+)$/i,
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

  function getRawChatEntries() {
    return (window.gameClient?.interface?.channelManager?.channels || []).flatMap((channel) =>
      (channel?.__contents || []).map((entry, index) => ({
        channelName: channel?.name || null,
        entry,
        index,
      }))
    );
  }

  function toChatMessage(rawEntry) {
    const entry = rawEntry?.entry || {};
    const rawMessage = String(entry?.message || entry?.text || "").trim();
    const parsed = extractSenderFromMessage(rawMessage);
    const sender =
      String(entry?.author || entry?.sender || entry?.name || parsed.sender || "").trim() || null;
    const body = String(entry?.text || parsed.body || rawMessage).trim();
    const time = entry?.__time || entry?.time || null;
    const senderType = entry?.type;
    const key = [
      rawEntry?.channelName || "",
      time || "",
      sender || "",
      rawMessage || "",
      rawEntry?.index || 0,
    ].join("|");

    return {
      key,
      channelName: rawEntry?.channelName || null,
      sender,
      body,
      rawMessage,
      time,
      senderType,
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
      normalizeText(message?.channelName),
      normalizeText(message?.sender),
      normalizeText(message?.body || message?.rawMessage),
      String(getMessageTimestamp(message) || ""),
    ].join("|");
  }

  function hasSeenMessage(message) {
    return state.seenKeys.includes(message?.key) || state.seenSignatures.includes(getMessageSignature(message));
  }

  function rememberSeenMessage(message) {
    if (!message) {
      return;
    }

    if (message.key && !state.seenKeys.includes(message.key)) {
      state.seenKeys.push(message.key);
    }

    const signature = getMessageSignature(message);
    if (signature && !state.seenSignatures.includes(signature)) {
      state.seenSignatures.push(signature);
    }

    trimSeen();
  }

  function rememberSeenMessages(messages) {
    messages.forEach((message) => rememberSeenMessage(message));
  }

  function isSelfMessage(message) {
    if (getSelfNames().has(normalizeText(message?.sender))) {
      return true;
    }

    return [message?.body, message?.rawMessage].some((text) => bot.isRecentSentChat?.(text, 20000));
  }

  function isTrustedSender(message) {
    const senderName = normalizeText(message?.sender);
    if (!senderName) {
      return false;
    }

    const trustedNames = bot.panic?.getTrustedNames?.() || [];
    return trustedNames.includes(senderName);
  }

  function isNpcMessage(message) {
    const npcType = window.CONST?.TYPES?.NPC;
    return npcType != null && message?.senderType === npcType;
  }

  function isWithinVisibleRange(me, pos) {
    if (!me || !pos) {
      return false;
    }

    const dx = Math.abs(pos.x - me.x);
    const dy = Math.abs(pos.y - me.y);
    return dx <= 8 && dy <= 6;
  }

  function isSenderVisiblePlayer(message) {
    const me = bot.getPlayerPosition?.();
    const myId = window.gameClient?.player?.id;
    const senderName = normalizeText(message?.sender);
    const playerType = window.CONST?.TYPES?.PLAYER;

    if (!me || !senderName || playerType == null) {
      return false;
    }

    return Object.values(window.gameClient?.world?.activeCreatures || {}).some((creature) => {
      if (!creature) {
        return false;
      }

      if (creature.id === myId || creature.type !== playerType) {
        return false;
      }

      if (normalizeText(creature.name) !== senderName) {
        return false;
      }

      return isWithinVisibleRange(me, creature.__position);
    });
  }

  function getDefaultMessages() {
    return getChatMessages().filter((message) => message.channelName === "Default");
  }

  function getNewestPendingMessage() {
    const pendingMessages = getDefaultMessages().filter((message) => {
      if (!message?.body || !message?.key) {
        return false;
      }

      if (hasSeenMessage(message)) {
        return false;
      }

      if (!message.sender || isSelfMessage(message) || isNpcMessage(message) || isTrustedSender(message)) {
        rememberSeenMessage(message);
        return false;
      }

      const timestamp = getMessageTimestamp(message);
      if (timestamp && Date.now() - timestamp > maxMessageAgeMs) {
        rememberSeenMessage(message);
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

  function buildClassifierPrompt(targetMessage, contextMessages) {
    const transcript = contextMessages
      .map((message) => `${message.sender || "player"}: ${message.body}`)
      .join("\n");

    return [
      "Channel: Default",
      "Recent chat:",
      transcript || "(none)",
      "",
      `Last message from ${targetMessage.sender}: ${targetMessage.body}`,
      "Classify the last message as exactly one label:",
      "greeting",
      "question",
      "statement",
      "Reply with the label only.",
    ].join("\n");
  }

  function getTypePrompt(messageType) {
    if (messageType === "greeting") {
      return config.greetingPrompt;
    }

    if (messageType === "question") {
      return config.questionPrompt;
    }

    return config.statementPrompt;
  }

  function buildReplyPrompt(targetMessage, contextMessages, messageType) {
    const transcript = contextMessages
      .map((message) => `${message.sender || "player"}: ${message.body}`)
      .join("\n");

    return [
      config.systemPrompt,
      getTypePrompt(messageType),
      "",
      "Channel: Default",
      `Message type: ${messageType}`,
      "Recent chat:",
      transcript || "(none)",
      "",
      `Last message from ${targetMessage.sender}: ${targetMessage.body}`,
      "Reply with one short sentence only.",
      "Avoid repeating the same wording again and again.",
      "Reply text only:",
    ].join("\n");
  }

  async function generateText(prompt, generationConfig = {}) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": config.apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: Object.assign(
            {
              temperature: 0.9,
              topP: 0.95,
              maxOutputTokens: 40,
            },
            generationConfig
          ),
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini request failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    return (
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => String(part?.text || ""))
        .join(" ")
        .trim() || ""
    );
  }

  async function classifyMessageType(targetMessage, contextMessages) {
    const rawType = normalizeText(
      await generateText(buildClassifierPrompt(targetMessage, contextMessages), {
        temperature: 0.1,
        topP: 0.8,
        maxOutputTokens: 8,
      })
    );

    if (rawType === "greeting" || rawType === "question" || rawType === "statement") {
      return rawType;
    }

    if (isGreeting(targetMessage?.body)) {
      return "greeting";
    }

    if (/\?/.test(String(targetMessage?.body || ""))) {
      return "question";
    }

    return "statement";
  }

  function sanitizeReply(text) {
    const singleLine = String(text || "")
      .replace(/\s+/g, " ")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();

    if (!singleLine) {
      return "";
    }

    const firstSentence = singleLine.split(/(?<=[.!?])\s+/)[0] || singleLine;
    const trimmed = firstSentence.slice(0, 90).trim();
    if (!trimmed) {
      return "";
    }

    if (trimmed === "?") {
      return bot.isRecentSentChat?.("?", 20000) ? "" : "?";
    }

    const styled = trimmed
      .toLowerCase()
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/\bi am\b/g, "im")
      .replace(/\byou are\b/g, "youre")
      .replace(/\bdo not\b/g, "dont")
      .replace(/\bcannot\b/g, "cant")
      .replace(/\bgoing to\b/g, "gonna")
      .replace(/\bwant to\b/g, "wanna")
      .replace(/\s+([,.!?])/g, "$1")
      .replace(/([!?.,]){2,}/g, "$1")
      .trim();

    const normalized = normalizeText(styled);
    if (!normalized || /^[^a-z0-9]+$/i.test(styled)) {
      return "";
    }

    if (/\b(bot|ai|assistant|language model|automation|script)\b/i.test(styled)) {
      return "";
    }

    if (bot.isRecentSentChat?.(styled, 20000)) {
      return "";
    }

    return styled;
  }

  function pickUnusedReply(replies, withinMs = 30000, fallback = "?") {
    for (const reply of replies) {
      if (!bot.isRecentSentChat?.(reply, withinMs)) {
        return reply;
      }
    }

    return fallback;
  }

  function isGreeting(text) {
    return /^(hi|hey|yo|sup|howdy|hello|hiya)\b/i.test(String(text || "").trim());
  }

  function isBotQuestion(text) {
    return /\b(are you|u)\b.*\bbot\b|\bbot\b.*\?|\bare you a bot\b/i.test(String(text || ""));
  }

  function isSimpleReaction(text) {
    return /^(based|true|real|lol|lmao|xd|nice|ok|kk|k)\b[!.?]*$/i.test(String(text || "").trim());
  }

  function pickFallbackReply(targetMessage, messageType) {
    const messageText = String(targetMessage?.body || "").trim();

    if (isBotQuestion(messageText)) {
      return pickUnusedReply(denyBotReplies, 30000, "no");
    }

    if (messageType === "greeting" || isGreeting(messageText)) {
      return pickUnusedReply(greetingReplies, 15000, "yo");
    }

    if (isSimpleReaction(messageText)) {
      return pickUnusedReply(agreeReplies, 15000, "true");
    }

    if (messageType === "question" || /\?$/.test(messageText)) {
      return pickUnusedReply(vagueQuestionReplies, 20000, "maybe");
    }

    return pickUnusedReply(["lol", "maybe", "ya", "true", "kinda"], 30000, "lol");
  }

  async function maybeRespond() {
    if (!state.running || state.pending || !config.enabled || !config.apiKey) {
      return false;
    }

    if (Date.now() - state.lastReplyAt < config.replyCooldownMs) {
      return false;
    }

    const pending = getNewestPendingMessage();
    if (!pending?.targetMessage) {
      return false;
    }

    state.pending = true;

    try {
      const contextMessages = getDefaultMessages().slice(-6);
      if (!isSenderVisiblePlayer(pending.targetMessage)) {
        rememberSeenMessages(pending.pendingMessages);
        bot.log("talk skipped reply", {
          sender: pending.targetMessage.sender,
          message: pending.targetMessage.body,
          reason: "sender-not-visible",
        });
        return false;
      }

      const messageType = await classifyMessageType(pending.targetMessage, contextMessages);
      const rawReply = isBotQuestion(pending.targetMessage.body)
        ? "no"
        : await generateText(buildReplyPrompt(pending.targetMessage, contextMessages, messageType));
      const reply = sanitizeReply(rawReply) || pickFallbackReply(pending.targetMessage, messageType);

      rememberSeenMessages(pending.pendingMessages);

      if (!reply) {
        bot.log("talk skipped reply", {
          sender: pending.targetMessage.sender,
          message: pending.targetMessage.body,
          messageType,
          rawReply,
        });
        return false;
      }

      const sent = bot.sendChat(reply);
      if (sent) {
        state.lastReplyAt = Date.now();
        bot.log("talk replied", {
          sender: pending.targetMessage.sender,
          message: pending.targetMessage.body,
          messageType,
          reply,
        });
      }

      return sent;
    } finally {
      state.pending = false;
    }
  }

  function scheduleNextTick() {
    if (!state.running) {
      return;
    }

    state.timerId = window.setTimeout(async () => {
      try {
        await maybeRespond();
      } catch (error) {
        bot.log("talk request failed", error?.message || error);
      }

      scheduleNextTick();
    }, config.pollMs);
  }

  function seedSeenMessages() {
    rememberSeenMessages(getDefaultMessages());
  }

  function start(overrides = {}) {
    Object.assign(config, overrides, { enabled: true });
    sanitizeConfig();
    persistConfig();

    if (!config.apiKey) {
      bot.log("talk module requires a Gemini API key");
      return false;
    }

    if (state.running) {
      return false;
    }

    state.running = true;
    seedSeenMessages();
    bot.log("talk module started", {
      model: config.model,
      channel: "Default",
    });
    scheduleNextTick();
    return true;
  }

  function stop(options = {}) {
    const shouldPersistEnabled = options.persistEnabled !== false;
    state.running = false;

    if (shouldPersistEnabled) {
      config.enabled = false;
      persistConfig();
    }

    if (state.timerId != null) {
      window.clearTimeout(state.timerId);
      state.timerId = null;
    }

    return true;
  }

  function status() {
    return {
      running: state.running,
      pending: state.pending,
      lastReplyAt: state.lastReplyAt,
      config: {
        ...config,
        apiKey: config.apiKey ? "***configured***" : "",
      },
    };
  }

  function updateConfig(nextConfig = {}) {
    Object.assign(config, nextConfig);
    sanitizeConfig();
    persistConfig();
    return status().config;
  }

  sanitizeConfig();

  if (config.enabled && config.apiKey) {
    start();
  }

  bot.talk = {
    start,
    stop,
    status,
    updateConfig,
    getChatMessages,
    config,
  };
};
window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installPanel = function installPanel(bot) {
  const panelPositionKey = "k9x.ui.panelPosition";
  const panelCollapsedKey = "k9x.ui.panelCollapsed";
  const sectionCollapsedKey = "k9x.ui.sectionCollapsed";

  function destroy() {
    document.getElementById("k9x-panel")?.remove();
    document.getElementById("k9x-style")?.remove();
  }

  function savePanelPosition(position, key = panelPositionKey) {
    bot.storage.set(key, position);
  }

  function getSavedPanelPosition(key = panelPositionKey) {
    return bot.storage.get(key, null);
  }

  function savePanelCollapsed(collapsed) {
    bot.storage.set(panelCollapsedKey, !!collapsed);
  }

  function getSavedPanelCollapsed() {
    return !!bot.storage.get(panelCollapsedKey, false);
  }

  function getSavedSectionCollapsed() {
    const saved = bot.storage.get(sectionCollapsedKey, {});
    return saved && typeof saved === "object" ? saved : {};
  }

  function saveSectionCollapsed(state) {
    bot.storage.set(sectionCollapsedKey, state);
  }

  function setSectionCollapsed(section, collapsed) {
    if (!section) return;

    const nextCollapsed = !!collapsed;
    const header = section.querySelector(".mb-collapsible-header");
    const body = section.querySelector(".mb-collapsible-body");
    const toggle = section.querySelector(".mb-collapsible-toggle");

    section.dataset.sectionCollapsed = nextCollapsed ? "true" : "false";

    if (header) {
      header.setAttribute("aria-expanded", nextCollapsed ? "false" : "true");
    }

    if (body) {
      body.hidden = nextCollapsed;
    }

    if (toggle) {
      toggle.textContent = nextCollapsed ? "+" : "−";
    }
  }

  function enableCollapsibleSections(panel) {
    const saved = { ...getSavedSectionCollapsed() };

    panel.querySelectorAll("[data-collapsible]").forEach((section) => {
      const key = section.dataset.collapsible;
      if (!key) return;

      setSectionCollapsed(section, !!saved[key]);

      const header = section.querySelector(".mb-collapsible-header");
      header?.addEventListener("click", () => {
        const nextCollapsed = section.dataset.sectionCollapsed !== "true";
        setSectionCollapsed(section, nextCollapsed);
        saved[key] = nextCollapsed;
        saveSectionCollapsed(saved);
      });
    });
  }

  function refreshHomeLabel() {
    const homeLabel = document.getElementById("k9x-home");
    if (!homeLabel) return;

    const home = bot.pz?.getHomePz?.();
    homeLabel.textContent = home
      ? `Panic Runner Home: ${home.x}, ${home.y}, ${home.z}`
      : "Panic Runner Home: not set";
  }

  function refreshPanicStatus() {
    const unknownToggle = document.getElementById("k9x-panic-unknown");
    const healthToggle = document.getElementById("k9x-panic-health");
    const returnToggle = document.getElementById("k9x-panic-return");
    const status = bot.panic?.status?.();

    if (unknownToggle) {
      unknownToggle.checked = !!status?.config?.unknownPlayerEnabled;
    }

    if (healthToggle) {
      healthToggle.checked = !!status?.config?.healthLossEnabled;
    }

    if (returnToggle) {
      returnToggle.checked = !!status?.config?.returnToOriginEnabled;
    }
  }

  function refreshXrayStatus() {
    const status = bot.xray?.status?.();
    const me = bot.getPlayerPosition?.();
    const overlayButton = document.getElementById("k9x-xray-overlay-toggle");
    const overlayLabel = document.getElementById("k9x-xray-overlay-status");
    const floorSelect = document.getElementById("k9x-xray-floor-select");
    const formatFloorOffset = (floor) => {
      if (!me || floor == null) {
        return null;
      }

      const offset = me.z - floor;
      return offset === 0 ? "0" : offset > 0 ? `+${offset}` : `${offset}`;
    };

    if (overlayButton) {
      overlayButton.textContent = status?.config?.overlayEnabled ? "Disable Overlay" : "Enable Overlay";
    }

    if (overlayLabel) {
      const floorLabel = status?.config?.selectedFloor == null
        ? "all floors"
        : `${formatFloorOffset(status.config.selectedFloor) ?? "?"}`;
      overlayLabel.textContent = `${status?.config?.overlayEnabled ? "Overlay: on" : "Overlay: off"} • ${floorLabel}`;
    }

    if (floorSelect) {
      const floors = Array.from(
        new Set(
          (status?.visibleCreatures || [])
            .map((creature) => creature?.position?.z)
            .filter((floor) => floor != null)
        )
      ).sort((a, b) => a - b);
      const selectedFloor = status?.config?.selectedFloor;

      if (selectedFloor != null && !floors.includes(selectedFloor)) {
        floors.push(selectedFloor);
        floors.sort((a, b) => a - b);
      }

      floorSelect.innerHTML = "";

      const allOption = document.createElement("option");
      allOption.value = "all";
      allOption.textContent = "All floors";
      floorSelect.appendChild(allOption);

      floors.forEach((floor) => {
        const option = document.createElement("option");
        option.value = String(floor);
        const offsetLabel = formatFloorOffset(floor);
        option.textContent = offsetLabel == null
          ? String(floor)
          : offsetLabel;
        floorSelect.appendChild(option);
      });

      floorSelect.value = selectedFloor == null ? "all" : String(selectedFloor);
    }
  }

  function renderTrustedNames() {
    const list = document.getElementById("k9x-panic-trusted-list");
    if (!list) return;

    const trustedNames = bot.panic?.config?.trustedNames || [];
    list.innerHTML = "";

    if (!trustedNames.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "No trusted names saved.";
      list.appendChild(empty);
      return;
    }

    trustedNames.forEach((name, index) => {
      const row = document.createElement("div");
      row.className = "mb-list-row";

      const label = document.createElement("span");
      label.textContent = name;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mb-small-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        const nextNames = trustedNames.filter((_, currentIndex) => currentIndex !== index);
        bot.panic.updateConfig({ trustedNames: nextNames });
        renderTrustedNames();
      });

      row.appendChild(label);
      row.appendChild(removeButton);
      list.appendChild(row);
    });
  }

  function renderGameMasterNames() {
    const list = document.getElementById("k9x-panic-gm-list");
    if (!list) return;

    const gameMasterNames = bot.panic?.config?.gameMasterNames || [];
    list.innerHTML = "";

    if (!gameMasterNames.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "No game master names saved.";
      list.appendChild(empty);
      return;
    }

    gameMasterNames.forEach((name, index) => {
      const row = document.createElement("div");
      row.className = "mb-list-row";

      const label = document.createElement("span");
      label.textContent = name;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "mb-small-button";
      removeButton.textContent = "Remove";
      removeButton.addEventListener("click", () => {
        const nextNames = gameMasterNames.filter((_, currentIndex) => currentIndex !== index);
        bot.panic.updateConfig({ gameMasterNames: nextNames });
        renderGameMasterNames();
      });

      row.appendChild(label);
      row.appendChild(removeButton);
      list.appendChild(row);
    });
  }

  function refreshRuneStatus() {
    const runeToggle = document.getElementById("k9x-rune-enabled");
    const runeStatusNote = document.getElementById("k9x-rune-status");
    const status = bot.rune?.status?.();
    const running = !!status?.running;

    if (runeToggle) {
      runeToggle.checked = running;
    }

    if (runeStatusNote && status) {
      const gates = status.gates || {};

      if (!running) {
        runeStatusNote.textContent = "Status: stopped";
      } else if (!gates.hasStats) {
        runeStatusNote.textContent = "Status: running (waiting for player stats)";
      } else if (gates.canMakeRune) {
        runeStatusNote.textContent = "Status: running (ready to cast)";
      } else {
        const waiting = [];
        if (!gates.enoughHp) waiting.push("HP");
        if (!gates.enoughMana) waiting.push("mana");
        if (!gates.hasCastMethod) waiting.push("hotkey or spell");
        if (!gates.enoughFood) waiting.push("food");
        if (!gates.cooldownReady) waiting.push("cooldown");
        runeStatusNote.textContent = `Status: running (waiting: ${waiting.join(", ")})`;
      }
    }
  }

  function refreshAutoEatStatus() {
    const autoEatToggle = document.getElementById("k9x-auto-eat-enabled");
    if (!autoEatToggle) return;

    autoEatToggle.checked = !!bot.eat?.status?.().running;
  }

  function refreshAutoFishingStatus() {
    const autoFishingToggle = document.getElementById("k9x-auto-fishing-enabled");
    if (!autoFishingToggle) return;

    autoFishingToggle.checked = !!bot.fishing?.status?.().running;
  }

  function refreshAutoHealStatus() {
    const autoHealToggle = document.getElementById("k9x-auto-heal-enabled");
    if (!autoHealToggle) return;

    autoHealToggle.checked = !!bot.heal?.status?.().running;
  }

  function refreshAutoInvisibleStatus() {
    const autoInvisibleToggle = document.getElementById("k9x-auto-invisible-enabled");
    if (!autoInvisibleToggle) return;

    autoInvisibleToggle.checked = !!bot.invisible?.status?.().running;
  }

  function refreshAutoMagicShieldStatus() {
    const autoMagicShieldToggle = document.getElementById("k9x-auto-magic-shield-enabled");
    if (!autoMagicShieldToggle) return;

    autoMagicShieldToggle.checked = !!bot.magicShield?.status?.().running;
  }

  function refreshAutoAttackStatus() {
    const autoAttackToggle = document.getElementById("k9x-auto-attack-enabled");
    if (!autoAttackToggle) return;

    autoAttackToggle.checked = !!bot.attack?.status?.().running;
  }

  function refreshAutoAttackFilterControls() {
    const modeSelect = document.getElementById("k9x-auto-attack-filter-mode");
    const includeList = document.getElementById("k9x-auto-attack-include-list");
    const excludeList = document.getElementById("k9x-auto-attack-exclude-list");
    const config = bot.attack?.config || {};
    const includedNames = Array.isArray(config.includedCreatureNames) ? config.includedCreatureNames : [];
    const excludedNames = Array.isArray(config.excludedCreatureNames) ? config.excludedCreatureNames : [];
    const mode = config.targetFilterMode === "include" || config.targetFilterMode === "exclude"
      ? config.targetFilterMode
      : "all";

    if (modeSelect) {
      modeSelect.value = mode;
    }

    const renderNameList = (container, names, key) => {
      if (!container) {
        return;
      }

      container.innerHTML = "";
      if (!names.length) {
        const empty = document.createElement("div");
        empty.className = "mb-small-note";
        empty.textContent = "No names added.";
        container.appendChild(empty);
        return;
      }

      names.forEach((name, index) => {
        const row = document.createElement("div");
        row.className = "mb-list-row";

        const label = document.createElement("span");
        label.textContent = name;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "mb-small-button";
        removeButton.textContent = "Remove";
        removeButton.addEventListener("click", () => {
          const nextNames = names.filter((_, currentIndex) => currentIndex !== index);
          bot.attack.updateConfig({ [key]: nextNames });
          refreshAutoAttackFilterControls();
        });

        row.appendChild(label);
        row.appendChild(removeButton);
        container.appendChild(row);
      });
    };

    renderNameList(includeList, includedNames, "includedCreatureNames");
    renderNameList(excludeList, excludedNames, "excludedCreatureNames");
  }

  function refreshCaveStatus() {
    const statusLabel = document.getElementById("k9x-cave-status");
    const startButton = document.getElementById("k9x-cave-start");
    const stopButton = document.getElementById("k9x-cave-stop");
    const route = bot.cave?.getRoute?.() || [];
    const status = bot.cave?.status?.();

    if (statusLabel) {
      const modeLabel = status?.config?.cycleWaypoints ? "cycle" : "bounce";
      if (!route.length) {
        statusLabel.textContent = "Status: no waypoints";
      } else if (status?.running) {
        const waypointNumber = (status.currentIndex ?? 0) + 1;
        const distanceLabel =
          Number.isFinite(status?.distanceToWaypoint) && status.distanceToWaypoint >= 0
            ? `, dist ${status.distanceToWaypoint}`
            : "";
        statusLabel.textContent = `Status: running (${waypointNumber}/${route.length}${distanceLabel}, ${modeLabel})`;
      } else {
        statusLabel.textContent = `Status: idle (${route.length} waypoint${route.length === 1 ? "" : "s"}, ${modeLabel})`;
      }
    }

    if (startButton) {
      startButton.disabled = !route.length || !!status?.running;
    }

    if (stopButton) {
      stopButton.disabled = !status?.running;
    }
  }

  function refreshCaveModeStatus() {
    const caveCycleToggle = document.getElementById("k9x-cave-cycle");
    const status = bot.cave?.status?.();

    if (!caveCycleToggle) {
      return;
    }

    caveCycleToggle.checked = !!status?.config?.cycleWaypoints;
  }

  function refreshCavePresetControls() {
    const select = document.getElementById("k9x-cave-preset-select");
    const label = document.getElementById("k9x-cave-preset-status");
    const deleteButton = document.getElementById("k9x-cave-preset-delete");
    const status = bot.cave?.status?.();
    const presetNames = status?.presetNames || bot.cave?.getPresetNames?.() || [];
    const activePresetName = status?.activePresetName || bot.cave?.getActivePresetName?.() || "Default";

    if (select) {
      const previousValue = select.value;
      select.innerHTML = "";

      if (!presetNames.length) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = "No saved presets";
        select.appendChild(option);
        select.disabled = true;
      } else {
        presetNames.forEach((name) => {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          select.appendChild(option);
        });
        select.disabled = false;
        const nextValue = presetNames.includes(activePresetName) ? activePresetName : previousValue;
        if (nextValue) {
          select.value = nextValue;
        }
      }
    }

    if (label) {
      label.textContent = presetNames.length
        ? `Preset: ${activePresetName} (${presetNames.length} saved)`
        : `Preset: ${activePresetName}`;
    }

    if (deleteButton) {
      deleteButton.disabled = !presetNames.length || !select?.value;
    }
  }

  function refreshCaveClosestStatus() {
    const label = document.getElementById("k9x-cave-closest");
    if (!label) return;

    const position = bot.getPlayerPosition?.();
    const route = bot.cave?.getRoute?.() || [];

    if (!position) {
      label.textContent = "Closest start: current position unavailable";
      return;
    }

    if (!route.length) {
      label.textContent = "Closest start: no waypoints";
      return;
    }

    const closestIndex = bot.cave?.findClosestWaypointIndex?.(position) ?? 0;
    const waypoint = route[closestIndex];

    if (!waypoint) {
      label.textContent = "Closest start: unavailable";
      return;
    }

    label.textContent = `Closest start: ${closestIndex + 1}. ${waypoint.x}, ${waypoint.y}, ${waypoint.z}`;
  }

  function refreshCaveTransitionStatus() {
    const label = document.getElementById("k9x-cave-transition-status");
    if (!label) return;

    const transitions = bot.cave?.getTransitions?.() || [];
    if (!transitions.length) {
      label.textContent = "Transitions learned: none";
      return;
    }

    const latest = transitions
      .slice()
      .sort((a, b) => Number(b?.lastSeenAt || 0) - Number(a?.lastSeenAt || 0))[0];

    if (!latest?.from || !latest?.to) {
      label.textContent = `Transitions learned: ${transitions.length}`;
      return;
    }

    const extra = transitions.length > 1 ? ` (+${transitions.length - 1} more)` : "";
    label.textContent =
      `Transitions learned: ${latest.from.x}, ${latest.from.y}, ${latest.from.z} -> ` +
      `${latest.to.x}, ${latest.to.y}, ${latest.to.z}${extra}`;
  }

  function refreshEquipRingStatus() {
    const equipRingToggle = document.getElementById("k9x-equip-ring-enabled");
    if (!equipRingToggle) return;

    equipRingToggle.checked = !!bot.equipRing?.status?.().running;
  }

  function refreshTalkStatus() {
    const talkToggle = document.getElementById("k9x-talk-enabled");
    const statusLabel = document.getElementById("k9x-talk-status");
    const status = bot.talk?.status?.();

    if (talkToggle) {
      talkToggle.checked = !!status?.running;
    }

    if (statusLabel) {
      if (!status?.config?.apiKey) {
        statusLabel.textContent = "Status: API key missing";
      } else if (status?.pending) {
        statusLabel.textContent = "Status: generating";
      } else if (status?.running) {
        statusLabel.textContent = "Status: listening to Default";
      } else {
        statusLabel.textContent = "Status: idle";
      }
    }
  }

  function refreshVisibleCreatures() {
    const list = document.getElementById("k9x-visible-creatures-list");
    if (!list) return;

    const me = bot.getPlayerPosition?.();
    const status = bot.xray?.status?.();
    const creatures = status?.visibleCreatures || [];
    const selectedFloor = status?.config?.selectedFloor;
    list.innerHTML = "";

    if (!me) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = "Current position unavailable.";
      list.appendChild(empty);
      return;
    }

    const getFloorOffset = (creature) => (creature.position?.z || 0) - me.z;
    const getFloorDistance = (creature) => Math.abs(getFloorOffset(creature));

    const visibleCreatures = creatures
      .filter((creature) => {
        const floor = creature?.position?.z;
        if (floor == null) {
          return false;
        }

        if (selectedFloor != null) {
          return floor === selectedFloor;
        }

        return floor !== me.z;
      })
      .sort((a, b) => {
      const floorDistanceDiff = getFloorDistance(a) - getFloorDistance(b);
      if (floorDistanceDiff !== 0) return floorDistanceDiff;

      const floorOffsetDiff = getFloorOffset(a) - getFloorOffset(b);
      if (floorOffsetDiff !== 0) return floorOffsetDiff;

      const aDist = Math.abs((a.position?.x || 0) - me.x) + Math.abs((a.position?.y || 0) - me.y);
      const bDist = Math.abs((b.position?.x || 0) - me.x) + Math.abs((b.position?.y || 0) - me.y);
      return aDist - bDist;
    });

    if (!visibleCreatures.length) {
      const empty = document.createElement("div");
      empty.className = "mb-small-note";
      empty.textContent = selectedFloor == null
        ? "No off-floor creatures."
        : `No creatures on floor ${selectedFloor}.`;
      list.appendChild(empty);
      return;
    }

    let currentFloor = null;

    visibleCreatures.forEach((creature) => {
      const floor = creature.position?.z;
      if (floor !== currentFloor) {
        currentFloor = floor;
        const floorOffset = me.z - floor;
        const floorOffsetLabel =
          floorOffset === 0 ? "0" : floorOffset > 0 ? `+${floorOffset}` : `${floorOffset}`;

        const floorLabel = document.createElement("div");
        floorLabel.className = "mb-floor-label";
        floorLabel.textContent = floorOffsetLabel;
        list.appendChild(floorLabel);
      }

      const row = document.createElement("div");
      row.className = "mb-creature-row";

      const name = document.createElement("div");
      name.className = "mb-creature-name";
      name.textContent = creature.name || (creature.type === 0 ? "Player" : "Mob");

      const meta = document.createElement("div");
      meta.className = "mb-small-note";
      meta.textContent = `${creature.type === 0 ? "Player" : "Mob"} at ${creature.position.x}, ${creature.position.y}, ${creature.position.z}`;

      row.appendChild(name);
      row.appendChild(meta);
      list.appendChild(row);
    });
  }

  function setPanelCollapsed(panel, collapsed) {
    if (!panel) return;

    const body = panel.querySelector(".mb-body");
    const toggle = panel.querySelector("#k9x-collapse");
    const nextCollapsed = !!collapsed;

    panel.dataset.collapsed = nextCollapsed ? "true" : "false";

    if (body) {
      body.hidden = nextCollapsed;
    }

    if (toggle) {
      toggle.textContent = nextCollapsed ? "+" : "−";
      toggle.setAttribute("aria-label", nextCollapsed ? "Maximize panel" : "Minimize panel");
      toggle.setAttribute("title", nextCollapsed ? "Maximize" : "Minimize");
    }

    savePanelCollapsed(nextCollapsed);
  }

  function applySavedPanelPosition(panel, key = panelPositionKey) {
    const position = getSavedPanelPosition(key);
    if (!position) return;

    if (typeof position.top === "number") {
      panel.style.top = `${position.top}px`;
    }

    if (typeof position.left === "number") {
      panel.style.left = `${position.left}px`;
      panel.style.right = "auto";
    }
  }

  function clampPanelPosition(panel, left, top) {
    const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - panel.offsetHeight);

    return {
      left: Math.min(Math.max(0, left), maxLeft),
      top: Math.min(Math.max(0, top), maxTop),
    };
  }

  function enableDrag(panel, key = panelPositionKey) {
    const handle = panel.querySelector(".mb-title");
    if (!handle) return;

    let dragState = null;

    const onMouseMove = (event) => {
      if (!dragState) return;

      const next = clampPanelPosition(
        panel,
        event.clientX - dragState.offsetX,
        event.clientY - dragState.offsetY
      );

      panel.style.left = `${next.left}px`;
      panel.style.top = `${next.top}px`;
      panel.style.right = "auto";
    };

    const onMouseUp = () => {
      if (!dragState) return;

      dragState = null;
      const rect = panel.getBoundingClientRect();
      savePanelPosition({ left: rect.left, top: rect.top }, key);
    };

    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;

      const rect = panel.getBoundingClientRect();
      dragState = {
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
      };

      event.preventDefault();
    });

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    bot.addCleanup(() => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    });
  }

  function inject() {
    destroy();

    const style = document.createElement("style");
    style.id = "k9x-style";
    style.textContent = `
      #k9x-panel {
        position: fixed;
        z-index: 999999;
        max-width: calc(100vw - 32px);
        padding: 12px;
        border: 1px solid rgba(112, 168, 170, 0.42);
        border-radius: 10px;
        background: linear-gradient(180deg, rgba(15, 22, 24, 0.96), rgba(8, 12, 14, 0.98));
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
        color: #c6dfdd;
        font: 12px/1.35 Verdana, sans-serif;
        user-select: none;
      }

      #k9x-panel {
        top: 16px;
        right: 16px;
        width: 1180px;
      }

      #k9x-panel[data-collapsed="true"] {
        width: 220px;
      }

      #k9x-panel .mb-title {
        margin: 0;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        cursor: move;
      }

      #k9x-panel .mb-titlebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin: 0 0 8px;
      }

      #k9x-panel .mb-icon-button {
        width: 24px;
        min-width: 24px;
        padding: 2px 0;
        border-radius: 6px;
        font-weight: 700;
        line-height: 1;
      }

      #k9x-panel[data-collapsed="true"] .mb-titlebar {
        margin-bottom: 0;
      }

      #k9x-panel .mb-body {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        align-items: start;
      }

      #k9x-panel .mb-body[hidden] {
        display: none !important;
      }

      #k9x-panel .mb-side-column,
      #k9x-panel .mb-main-column,
      #k9x-panel .mb-talk-column,
      #k9x-panel .mb-cave-column {
        display: grid;
        gap: 10px;
      }

      #k9x-panel .mb-section {
        padding-top: 10px;
        border-top: 1px solid rgba(112, 168, 170, 0.2);
      }

      #k9x-panel .mb-column-section:first-child {
        padding-top: 0;
        border-top: 0;
      }

      #k9x-panel .mb-label {
        margin: 0 0 8px;
        color: #a9c5c3;
        word-break: break-word;
      }

      #k9x-panel .mb-actions {
        display: grid;
        gap: 6px;
      }

      #k9x-panel .mb-actions-inline-three {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      #k9x-panel .mb-actions-inline-two {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      #k9x-panel button {
        width: 100%;
        padding: 8px 10px;
        border: 1px solid rgba(112, 168, 170, 0.36);
        border-radius: 8px;
        background: linear-gradient(180deg, #30474a, #1f2f32);
        color: #d3ebe8;
        font: inherit;
        cursor: pointer;
      }

      #k9x-panel button:hover {
        background: linear-gradient(180deg, #3a5659, #24393c);
      }

      #k9x-panel .mb-collapsible-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        margin: 0 0 8px;
        padding: 0;
        border: 0;
        border-radius: 0;
        background: transparent;
        color: #a9c5c3;
        font: inherit;
        font-weight: 700;
        text-align: left;
        cursor: pointer;
      }

      #k9x-panel .mb-collapsible-header:hover {
        background: transparent;
        color: #d3ebe8;
      }

      #k9x-panel .mb-collapsible-header .mb-label {
        margin: 0;
      }

      #k9x-panel .mb-collapsible-toggle {
        flex-shrink: 0;
        width: 20px;
        text-align: center;
        color: #88a7a5;
        font-weight: 700;
        line-height: 1;
      }

      #k9x-panel .mb-collapsible[data-section-collapsed="true"] .mb-collapsible-header {
        margin-bottom: 0;
      }

      #k9x-panel .mb-collapsible-body[hidden] {
        display: none !important;
      }

      #k9x-panel input,
      #k9x-panel textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 8px 10px;
        border: 1px solid rgba(112, 168, 170, 0.34);
        border-radius: 8px;
        background: rgba(8, 14, 16, 0.9);
        color: #d3ebe8;
        font: inherit;
      }

      #k9x-panel textarea {
        min-height: 72px;
        resize: vertical;
      }

      #k9x-panel .mb-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #a9c5c3;
      }

      #k9x-panel .mb-toggle input[type="checkbox"] {
        width: auto;
        margin: 0;
      }

      #k9x-panel .mb-row {
        display: grid;
        grid-template-columns: auto 1fr;
        align-items: center;
        gap: 8px;
      }

      #k9x-panel .mb-row-compact {
        grid-template-columns: auto auto;
        justify-content: start;
      }

      #k9x-panel .mb-row .mb-toggle {
        white-space: nowrap;
      }

      #k9x-panel .mb-row input[type="text"] {
        min-width: 0;
      }

      #k9x-panel .mb-row-three {
        display: grid;
        grid-template-columns: auto minmax(120px, 1fr) 72px;
        align-items: center;
        gap: 8px;
      }

      #k9x-panel .mb-row-three input[type="text"],
      #k9x-panel .mb-row-three input[type="number"] {
        min-width: 0;
      }

      #k9x-panel .mb-row-five {
        display: grid;
        grid-template-columns: auto 82px 72px 82px 72px;
        align-items: center;
        gap: 8px;
      }

      #k9x-panel .mb-row-five input[type="number"] {
        min-width: 0;
      }

      #k9x-panel .mb-field-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }

      #k9x-panel .mb-field {
        display: grid;
        gap: 4px;
      }

      #k9x-panel .mb-field-compact {
        width: 96px;
        justify-self: end;
      }

      #k9x-panel .mb-field-label {
        color: #a9c5c3;
        font-size: 11px;
      }

      #k9x-panel .mb-stack {
        display: grid;
        gap: 8px;
      }

      #k9x-panel .mb-inline {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
      }

      #k9x-panel .mb-list {
        display: grid;
        gap: 6px;
      }

      #k9x-panel .mb-list-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
        color: #a9c5c3;
      }

      #k9x-panel .mb-creature-row {
        padding: 6px 8px;
        border: 1px solid rgba(112, 168, 170, 0.18);
        border-radius: 8px;
        background: rgba(162, 218, 220, 0.04);
      }

      #k9x-panel .mb-creature-name {
        color: #d3ebe8;
        word-break: break-word;
      }

      #k9x-panel .mb-floor-label {
        margin-top: 4px;
        color: #9ec6c3;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      #k9x-panel #k9x-visible-creatures-list {
        max-height: 150px;
        overflow-y: auto;
        padding-right: 2px;
      }

      #k9x-panel #k9x-panic-trusted-list {
        max-height: 140px;
        overflow-y: auto;
        padding-right: 2px;
      }

      #k9x-panel .mb-small-button {
        width: auto;
        padding: 4px 8px;
        border-radius: 6px;
      }

      #k9x-panel .mb-small-note {
        color: #88a7a5;
        font-size: 11px;
      }

      #k9x-panel .mb-note {
        margin-top: 8px;
        color: #88a7a5;
        font-size: 11px;
      }

      #k9x-panel .mb-footer {
        margin-top: 10px;
        padding-top: 8px;
        border-top: 1px solid rgba(112, 168, 170, 0.2);
        text-align: right;
        font-size: 10px;
        color: #88a7a5;
      }

      #k9x-panel .mb-footer a {
        color: #9ccfcd;
        text-decoration: none;
      }

      #k9x-panel .mb-footer a:hover {
        color: #bde7e4;
        text-decoration: underline;
      }

      #k9x-panel[data-collapsed="true"] .mb-footer {
        display: none;
      }

      @media (max-width: 760px) {
        #k9x-panel {
          width: min(900px, calc(100vw - 32px));
        }

        #k9x-panel .mb-body {
          grid-template-columns: 1fr;
        }

        #k9x-panel .mb-field-grid {
          grid-template-columns: 1fr;
        }
      }
    `;
    document.head.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "k9x-panel";
    panel.innerHTML = `
        <div class="mb-titlebar">
        <div class="mb-title">K9X</div>
        <button type="button" class="mb-icon-button" id="k9x-collapse" aria-label="Minimize panel" title="Minimize">−</button>
      </div>
      <div class="mb-body">
        <div class="mb-main-column">
          <div class="mb-actions mb-column-section">
            <button type="button" id="k9x-reload">Reload Bot</button>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="panic">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title mb-label" id="k9x-home">Panic Runner Home: not set</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <button type="button" id="k9x-set-home">Set Home</button>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-panic-unknown" />
                <span>Unknown Player</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-panic-health" />
                <span>Lose Health</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-panic-return" />
                <span>Auto Return</span>
              </label>
              <div class="mb-inline">
                <input type="text" id="k9x-panic-trusted-input" placeholder="Trusted name" />
                <button type="button" class="mb-small-button" id="k9x-panic-trusted-add">Add</button>
              </div>
              <div class="mb-list" id="k9x-panic-trusted-list"></div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="gm-kill">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">GM Kill Switch</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <div class="mb-inline">
                <input type="text" id="k9x-panic-gm-input" placeholder="Game master name" />
                <button type="button" class="mb-small-button" id="k9x-panic-gm-add">Add</button>
              </div>
              <div class="mb-list" id="k9x-panic-gm-list"></div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="routines">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Quick Routines</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-actions">
              <div class="mb-row mb-row-compact">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-auto-eat-enabled" />
                  <span>Auto Eat</span>
                </label>
                <label class="mb-field mb-field-compact" for="k9x-auto-eat-hotkey">
                  <span class="mb-field-label">Eat Hotkey (1-12)</span>
                  <input type="number" id="k9x-auto-eat-hotkey" min="1" max="12" placeholder="10" />
                </label>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-auto-fishing-enabled" />
                  <span>Auto Fishing</span>
                </label>
                <div class="mb-small-note">On enable it asks for the rod hotkey slot, then uses it and left-clicks fast (about every 200ms). Right-click disables it.</div>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-auto-invisible-enabled" />
                  <span>Auto Invisible</span>
                </label>
                <div class="mb-small-note">Casts utana vid whenever invisibility is not active.</div>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-auto-magic-shield-enabled" />
                  <span>Auto Utamo Vita</span>
                </label>
                <div class="mb-small-note">Casts utamo vita whenever magic shield is not active.</div>
              </div>
              <div class="mb-row">
                <label class="mb-toggle">
                  <input type="checkbox" id="k9x-equip-ring-enabled" />
                  <span>Equip Ring</span>
                </label>
                <div></div>
              </div>
            </div>
          </div>
        </div>
        <div class="mb-side-column">
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="xray">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Xray</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <button type="button" class="mb-small-button" id="k9x-xray-overlay-toggle">Disable Overlay</button>
              <div class="mb-small-note" id="k9x-xray-overlay-status">Overlay: on</div>
              <label class="mb-field" for="k9x-xray-floor-select">
                <span class="mb-field-label">Floor Filter</span>
                <select id="k9x-xray-floor-select">
                  <option value="all">All floors</option>
                </select>
              </label>
              <div class="mb-list" id="k9x-visible-creatures-list"></div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="rune">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Magic Level Trainer</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-rune-enabled" />
                <span>Enable Magic Level Trainer</span>
              </label>
              <div class="mb-field-grid">
                <label class="mb-field" for="k9x-rune-spell">
                  <span class="mb-field-label">Spell Words</span>
                  <input type="text" id="k9x-rune-spell" placeholder="adori vita vis" />
                </label>
                <label class="mb-field" for="k9x-rune-hotkey">
                  <span class="mb-field-label">Spell Hotkey (1-12)</span>
                  <input type="number" id="k9x-rune-hotkey" min="1" max="12" placeholder="optional" />
                </label>
                <label class="mb-field" for="k9x-rune-mana">
                  <span class="mb-field-label">Mana Cost</span>
                  <input type="number" id="k9x-rune-mana" min="0" placeholder="600" />
                </label>
                <label class="mb-field" for="k9x-rune-min-hp">
                  <span class="mb-field-label">Min HP (%)</span>
                  <input type="number" id="k9x-rune-min-hp" min="0" max="100" placeholder="50" />
                </label>
                <label class="mb-field" for="k9x-rune-min-food">
                  <span class="mb-field-label">Min Food (sec)</span>
                  <input type="number" id="k9x-rune-min-food" min="0" placeholder="30" />
                </label>
                <label class="mb-field" for="k9x-rune-cooldown">
                  <span class="mb-field-label">Cooldown (ms)</span>
                  <input type="number" id="k9x-rune-cooldown" min="0" placeholder="3500" />
                </label>
              </div>
              <div class="mb-small-note" id="k9x-rune-status">Status: stopped</div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="heal">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Auto Heal</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-auto-heal-enabled" />
                <span>Enable Auto Heal</span>
              </label>
              <div class="mb-field-grid">
                <label class="mb-field" for="k9x-auto-heal-min-hp">
                  <span class="mb-field-label">Minimum HP</span>
                  <input type="number" id="k9x-auto-heal-min-hp" min="0" placeholder="250" />
                </label>
                <label class="mb-field" for="k9x-auto-heal-hp-hotkey">
                  <span class="mb-field-label">HP Hotkey (1-12)</span>
                  <input type="number" id="k9x-auto-heal-hp-hotkey" min="1" max="12" placeholder="1" />
                </label>
                <label class="mb-field" for="k9x-auto-heal-min-mana">
                  <span class="mb-field-label">Minimum Mana</span>
                  <input type="number" id="k9x-auto-heal-min-mana" min="0" placeholder="150" />
                </label>
                <label class="mb-field" for="k9x-auto-heal-mana-hotkey">
                  <span class="mb-field-label">Mana Hotkey (1-12)</span>
                  <input type="number" id="k9x-auto-heal-mana-hotkey" min="1" max="12" placeholder="2" />
                </label>
              </div>
              <div class="mb-small-note">Checks about twenty times per second. HP is used before mana, and unregistered hotkey presses are retried quickly.</div>
            </div>
          </div>
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="talk">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Talk</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-talk-enabled" />
                <span>Enable Auto Reply</span>
              </label>
              <input type="password" id="k9x-talk-api-key" placeholder="Gemini API key" />
              <textarea id="k9x-talk-prompt" placeholder="Reply style prompt"></textarea>
              <div class="mb-small-note" id="k9x-talk-status">Status: idle</div>
              <div class="mb-small-note">Replies only to the newest unseen message in Default chat.</div>
              <div class="mb-small-note">It will not reply to itself and will not admit it is a bot.</div>
            </div>
          </div>
        </div>
        <div class="mb-talk-column">
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="attack">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Auto Attack</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-auto-attack-enabled" />
                <span>Enable Auto Attack</span>
              </label>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-auto-attack-melee" />
                <span>Melee Mode</span>
              </label>
              <label class="mb-field" for="k9x-auto-attack-hotkey">
                <span class="mb-field-label">Target Hotkey (1-12)</span>
                <input type="number" id="k9x-auto-attack-hotkey" min="1" max="12" placeholder="3" />
              </label>
              <label class="mb-field" for="k9x-auto-attack-rune-hotkey">
                <span class="mb-field-label">Rune Hotkey (1-12)</span>
                <input type="number" id="k9x-auto-attack-rune-hotkey" min="1" max="12" placeholder="4" />
              </label>
              <label class="mb-field" for="k9x-auto-attack-filter-mode">
                <span class="mb-field-label">Target Filter</span>
                <select id="k9x-auto-attack-filter-mode">
                  <option value="all">All monsters</option>
                  <option value="include">Only include list</option>
                  <option value="exclude">Exclude list</option>
                </select>
              </label>
              <div class="mb-inline">
                <input type="text" id="k9x-auto-attack-filter-name" placeholder="Creature name" />
                <button type="button" class="mb-small-button" id="k9x-auto-attack-include-add">Include</button>
              </div>
              <button type="button" class="mb-small-button" id="k9x-auto-attack-exclude-add">Exclude</button>
              <div class="mb-small-note">Include list (used when Target Filter is "Only include list")</div>
              <div class="mb-list" id="k9x-auto-attack-include-list"></div>
              <div class="mb-small-note">Exclude list (used when Target Filter is "Exclude list")</div>
              <div class="mb-list" id="k9x-auto-attack-exclude-list"></div>
              <div class="mb-small-note">Melee mode uses the target hotkey, then walks adjacent to the target. Non-melee mode uses the target hotkey to acquire a target and the rune hotkey to cast on that target.</div>
            </div>
          </div>
        </div>
        <div class="mb-cave-column">
          <div class="mb-section mb-column-section mb-collapsible" data-collapsible="cave">
            <button type="button" class="mb-collapsible-header" aria-expanded="true">
              <span class="mb-collapsible-title">Cave Bot</span>
              <span class="mb-collapsible-toggle" aria-hidden="true">−</span>
            </button>
            <div class="mb-collapsible-body mb-stack">
              <div class="mb-field-grid">
                <label class="mb-field" for="k9x-cave-preset-select">
                  <select id="k9x-cave-preset-select"></select>
                </label>
              </div>
              <div class="mb-actions mb-actions-inline-two">
                <button type="button" class="mb-small-button" id="k9x-cave-preset-new">New</button>
                <button type="button" class="mb-small-button" id="k9x-cave-preset-delete">Delete</button>
              </div>
              <div class="mb-actions mb-actions-inline-two">
                <button type="button" class="mb-small-button" id="k9x-cave-record">Record Spot</button>
                <button type="button" class="mb-small-button" id="k9x-cave-remove-last">Remove Last</button>
              </div>
              <label class="mb-toggle">
                <input type="checkbox" id="k9x-cave-cycle" />
                <span>Cycle route (loop)</span>
              </label>
              <div class="mb-small-note" id="k9x-cave-closest">Closest start: no waypoints</div>
              <div class="mb-small-note" id="k9x-cave-transition-status">Transitions learned: none</div>
              <div class="mb-actions mb-actions-inline-two">
                <button type="button" class="mb-small-button" id="k9x-cave-start">Start</button>
                <button type="button" class="mb-small-button" id="k9x-cave-stop">Stop</button>
              </div>
              <div class="mb-small-note" id="k9x-cave-status">Status: no waypoints</div>
            </div>
          </div>
        </div>
      </div>
      <div class="mb-footer">
        source:
        <a href="https://github.com/pasqualguerrero/k9x" target="_blank" rel="noopener noreferrer">github.com/pasqualguerrero/k9x</a>
      </div>
    `;
    document.body.appendChild(panel);

    const unlockAudio = () => {
      bot.unlockAudio?.();
    };

    panel.addEventListener("pointerdown", unlockAudio, { passive: true });
    panel.addEventListener("keydown", unlockAudio);

    bot.addCleanup(() => {
      panel.removeEventListener("pointerdown", unlockAudio);
      panel.removeEventListener("keydown", unlockAudio);
    });

    applySavedPanelPosition(panel);
    enableDrag(panel);
    setPanelCollapsed(panel, getSavedPanelCollapsed());
    enableCollapsibleSections(panel);

    const spellInput = panel.querySelector("#k9x-rune-spell");
    const runeHotkeyInput = panel.querySelector("#k9x-rune-hotkey");
    const manaInput = panel.querySelector("#k9x-rune-mana");
    const runeMinHpInput = panel.querySelector("#k9x-rune-min-hp");
    const runeMinFoodInput = panel.querySelector("#k9x-rune-min-food");
    const runeCooldownInput = panel.querySelector("#k9x-rune-cooldown");
    const runeEnabledInput = panel.querySelector("#k9x-rune-enabled");
    const autoEatEnabledInput = panel.querySelector("#k9x-auto-eat-enabled");
    const autoEatHotkeyInput = panel.querySelector("#k9x-auto-eat-hotkey");
    const autoFishingEnabledInput = panel.querySelector("#k9x-auto-fishing-enabled");
    const autoInvisibleEnabledInput = panel.querySelector("#k9x-auto-invisible-enabled");
    const autoMagicShieldEnabledInput = panel.querySelector("#k9x-auto-magic-shield-enabled");
    const equipRingEnabledInput = panel.querySelector("#k9x-equip-ring-enabled");
    const autoHealEnabledInput = panel.querySelector("#k9x-auto-heal-enabled");
    const autoHealMinHpInput = panel.querySelector("#k9x-auto-heal-min-hp");
    const autoHealHpHotkeyInput = panel.querySelector("#k9x-auto-heal-hp-hotkey");
    const autoHealMinManaInput = panel.querySelector("#k9x-auto-heal-min-mana");
    const autoHealManaHotkeyInput = panel.querySelector("#k9x-auto-heal-mana-hotkey");
    const autoAttackEnabledInput = panel.querySelector("#k9x-auto-attack-enabled");
    const autoAttackMeleeInput = panel.querySelector("#k9x-auto-attack-melee");
    const autoAttackHotkeyInput = panel.querySelector("#k9x-auto-attack-hotkey");
    const autoAttackRuneHotkeyInput = panel.querySelector("#k9x-auto-attack-rune-hotkey");
    const autoAttackFilterModeInput = panel.querySelector("#k9x-auto-attack-filter-mode");
    const autoAttackFilterNameInput = panel.querySelector("#k9x-auto-attack-filter-name");
    const autoAttackIncludeAddButton = panel.querySelector("#k9x-auto-attack-include-add");
    const autoAttackExcludeAddButton = panel.querySelector("#k9x-auto-attack-exclude-add");
    const talkEnabledInput = panel.querySelector("#k9x-talk-enabled");
    const talkApiKeyInput = panel.querySelector("#k9x-talk-api-key");
    const talkPromptInput = panel.querySelector("#k9x-talk-prompt");
    const panicGmNameInput = panel.querySelector("#k9x-panic-gm-input");
    const panicGmAddButton = panel.querySelector("#k9x-panic-gm-add");
    const panicUnknownInput = panel.querySelector("#k9x-panic-unknown");
    const panicHealthInput = panel.querySelector("#k9x-panic-health");
    const panicReturnInput = panel.querySelector("#k9x-panic-return");
    const panicTrustedInput = panel.querySelector("#k9x-panic-trusted-input");
    const panicTrustedAddButton = panel.querySelector("#k9x-panic-trusted-add");
    const xrayOverlayButton = panel.querySelector("#k9x-xray-overlay-toggle");
    const xrayFloorSelect = panel.querySelector("#k9x-xray-floor-select");
    const collapseButton = panel.querySelector("#k9x-collapse");
    const reloadButton = panel.querySelector("#k9x-reload");
    const caveRecordButton = panel.querySelector("#k9x-cave-record");
    const caveRemoveLastButton = panel.querySelector("#k9x-cave-remove-last");
    const caveStartButton = panel.querySelector("#k9x-cave-start");
    const caveStopButton = panel.querySelector("#k9x-cave-stop");
    const caveCycleToggle = panel.querySelector("#k9x-cave-cycle");
    const cavePresetSelect = panel.querySelector("#k9x-cave-preset-select");
    const cavePresetNewButton = panel.querySelector("#k9x-cave-preset-new");
    const cavePresetDeleteButton = panel.querySelector("#k9x-cave-preset-delete");

    if (collapseButton) {
      collapseButton.addEventListener("click", () => {
        const isCollapsed = panel.dataset.collapsed === "true";
        setPanelCollapsed(panel, !isCollapsed);
      });
    }

    if (reloadButton) {
      reloadButton.addEventListener("click", () => {
        window.minibiaBotReload?.();
      });
    }

    function addTrustedName() {
      const rawName = panicTrustedInput?.value?.trim() || "";
      if (!rawName) {
        return;
      }

      const currentNames = bot.panic?.config?.trustedNames || [];
      const exists = currentNames.some(
        (name) => String(name).trim().toLowerCase() === rawName.toLowerCase()
      );

      if (!exists) {
        bot.panic.updateConfig({ trustedNames: [...currentNames, rawName] });
      }

      if (panicTrustedInput) {
        panicTrustedInput.value = "";
      }

      renderTrustedNames();
    }

    function addGameMasterName() {
      const rawName = panicGmNameInput?.value?.trim() || "";
      if (!rawName) {
        return;
      }

      const currentNames = bot.panic?.config?.gameMasterNames || [];
      const exists = currentNames.some(
        (name) => String(name).trim().toLowerCase() === rawName.toLowerCase()
      );

      if (!exists) {
        bot.panic.updateConfig({ gameMasterNames: [...currentNames, rawName] });
      }

      if (panicGmNameInput) {
        panicGmNameInput.value = "";
      }

      renderGameMasterNames();
    }

    if (panicGmAddButton) {
      panicGmAddButton.addEventListener("click", addGameMasterName);
    }

    if (panicGmNameInput) {
      panicGmNameInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addGameMasterName();
        }
      });
    }

    if (panicTrustedAddButton) {
      panicTrustedAddButton.addEventListener("click", addTrustedName);
    }

    if (panicTrustedInput) {
      panicTrustedInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          addTrustedName();
        }
      });
    }

    function readRuneHotbarSlotFromInput() {
      const rawValue = Number(runeHotkeyInput?.value);
      return Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12
        ? Math.trunc(rawValue)
        : null;
    }

    function readRuneConfigFromInputs() {
      const runeSpellWords = spellInput?.value?.trim() || bot.rune?.config?.runeSpellWords || "";
      const runeHotbarSlot = readRuneHotbarSlotFromInput() ?? bot.rune?.config?.runeHotbarSlot ?? null;
      const runeManaCost = Math.max(0, Number(manaInput?.value) || bot.rune?.config?.runeManaCost || 0);
      const minHpPercent = Math.min(
        100,
        Math.max(0, Number(runeMinHpInput?.value) ?? bot.rune?.config?.minHpPercent ?? 50)
      );
      const minFoodSeconds = Math.max(
        0,
        Number(runeMinFoodInput?.value) ?? bot.rune?.config?.minFoodSeconds ?? 30
      );
      const runeCooldownMs = Math.max(
        0,
        Number(runeCooldownInput?.value) ?? bot.rune?.config?.runeCooldownMs ?? 3500
      );

      return {
        runeSpellWords,
        runeHotbarSlot,
        runeManaCost,
        minHpPercent,
        minFoodSeconds,
        runeCooldownMs,
      };
    }

    if (spellInput) {
      spellInput.value = bot.rune?.config?.runeSpellWords || "";
      spellInput.addEventListener("change", () => {
        bot.rune.updateConfig({ runeSpellWords: spellInput.value.trim() });
      });
    }

    if (runeHotkeyInput) {
      runeHotkeyInput.value = bot.rune?.config?.runeHotbarSlot
        ? String(bot.rune.config.runeHotbarSlot)
        : "";
      runeHotkeyInput.addEventListener("change", () => {
        const runeHotbarSlot = readRuneHotbarSlotFromInput();
        runeHotkeyInput.value = runeHotbarSlot ? String(runeHotbarSlot) : "";
        bot.rune.updateConfig({ runeHotbarSlot });
      });
    }

    if (manaInput) {
      manaInput.value = String(bot.rune?.config?.runeManaCost ?? 0);
      manaInput.addEventListener("change", () => {
        const runeManaCost = Math.max(0, Number(manaInput.value) || 0);
        manaInput.value = String(runeManaCost);
        bot.rune.updateConfig({ runeManaCost });
      });
    }

    if (runeMinHpInput) {
      runeMinHpInput.value = String(bot.rune?.config?.minHpPercent ?? 50);
      runeMinHpInput.addEventListener("change", () => {
        const minHpPercent = Math.min(100, Math.max(0, Number(runeMinHpInput.value) || 0));
        runeMinHpInput.value = String(minHpPercent);
        bot.rune.updateConfig({ minHpPercent });
      });
    }

    if (runeMinFoodInput) {
      runeMinFoodInput.value = String(bot.rune?.config?.minFoodSeconds ?? 30);
      runeMinFoodInput.addEventListener("change", () => {
        const minFoodSeconds = Math.max(0, Number(runeMinFoodInput.value) || 0);
        runeMinFoodInput.value = String(minFoodSeconds);
        bot.rune.updateConfig({ minFoodSeconds });
      });
    }

    if (runeCooldownInput) {
      runeCooldownInput.value = String(bot.rune?.config?.runeCooldownMs ?? 3500);
      runeCooldownInput.addEventListener("change", () => {
        const runeCooldownMs = Math.max(0, Number(runeCooldownInput.value) || 0);
        runeCooldownInput.value = String(runeCooldownMs);
        bot.rune.updateConfig({ runeCooldownMs });
      });
    }

    if (runeEnabledInput) {
      runeEnabledInput.checked = !!bot.rune?.status?.().running;
      runeEnabledInput.addEventListener("change", () => {
        if (runeEnabledInput.checked) {
          bot.rune.start(readRuneConfigFromInputs());
        } else {
          bot.rune.stop();
        }

        refreshRuneStatus();
      });
    }

    if (autoEatHotkeyInput) {
      autoEatHotkeyInput.value = String(bot.eat?.config?.eatHotbarSlot ?? 10);
      autoEatHotkeyInput.addEventListener("change", () => {
        const eatHotbarSlot = Math.min(12, Math.max(1, Number(autoEatHotkeyInput.value) || 1));
        autoEatHotkeyInput.value = String(eatHotbarSlot);
        bot.eat.updateConfig({ eatHotbarSlot });
      });
    }

    if (autoEatEnabledInput) {
      autoEatEnabledInput.checked = !!bot.eat?.status?.().running;
      autoEatEnabledInput.addEventListener("change", () => {
        const eatHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoEatHotkeyInput?.value) || bot.eat.config.eatHotbarSlot || 1)
        );

        if (autoEatEnabledInput.checked) {
          bot.eat.start({ eatHotbarSlot });
        } else {
          bot.eat.stop();
        }

        refreshAutoEatStatus();
      });
    }

    if (autoFishingEnabledInput) {
      autoFishingEnabledInput.checked = !!bot.fishing?.status?.().running;
      autoFishingEnabledInput.addEventListener("change", () => {
        if (autoFishingEnabledInput.checked) {
          const started = bot.fishing.start({ promptHotbarSlot: true });
          if (!started) {
            autoFishingEnabledInput.checked = false;
          }
        } else {
          bot.fishing.stop();
        }

        refreshAutoFishingStatus();
      });
    }

    if (autoInvisibleEnabledInput) {
      autoInvisibleEnabledInput.checked = !!bot.invisible?.status?.().running;
      autoInvisibleEnabledInput.addEventListener("change", () => {
        if (autoInvisibleEnabledInput.checked) {
          bot.invisible.start();
        } else {
          bot.invisible.stop();
        }

        refreshAutoInvisibleStatus();
      });
    }

    if (autoMagicShieldEnabledInput) {
      autoMagicShieldEnabledInput.checked = !!bot.magicShield?.status?.().running;
      autoMagicShieldEnabledInput.addEventListener("change", () => {
        if (autoMagicShieldEnabledInput.checked) {
          bot.magicShield.start();
        } else {
          bot.magicShield.stop();
        }

        refreshAutoMagicShieldStatus();
      });
    }

    if (equipRingEnabledInput) {
      equipRingEnabledInput.checked = !!bot.equipRing?.status?.().running;
      equipRingEnabledInput.addEventListener("change", () => {
        if (equipRingEnabledInput.checked) {
          bot.equipRing.start();
        } else {
          bot.equipRing.stop();
        }

        refreshEquipRingStatus();
      });
    }

    if (caveRecordButton) {
      caveRecordButton.addEventListener("click", () => {
        bot.cave.addWaypointCurrentSpot();
        refreshCavePresetControls();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveRemoveLastButton) {
      caveRemoveLastButton.addEventListener("click", () => {
        bot.cave.removeLastWaypoint();
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveStartButton) {
      caveStartButton.addEventListener("click", () => {
        bot.cave.start();
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveStopButton) {
      caveStopButton.addEventListener("click", () => {
        bot.cave.stop();
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (caveCycleToggle) {
      caveCycleToggle.checked = !!bot.cave?.status?.()?.config?.cycleWaypoints;
      caveCycleToggle.addEventListener("change", () => {
        bot.cave.updateConfig({ cycleWaypoints: caveCycleToggle.checked });
        refreshCaveModeStatus();
      });
    }

    if (cavePresetSelect) {
      cavePresetSelect.addEventListener("change", () => {
        const name = cavePresetSelect.value || "";
        const activePresetName = bot.cave?.getActivePresetName?.() || "";
        if (!name || name === activePresetName) {
          refreshCavePresetControls();
          return;
        }

        const loadedPreset = bot.cave.loadPreset(name);
        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (cavePresetNewButton) {
      cavePresetNewButton.addEventListener("click", () => {
        const name = window.prompt("Name the new cave preset:");
        if (name == null) {
          return;
        }

        const createdPreset = bot.cave.createPreset(name);
        if (!createdPreset) {
          return;
        }

        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (cavePresetDeleteButton) {
      cavePresetDeleteButton.addEventListener("click", () => {
        const name = cavePresetSelect?.value || "";
        if (!name) {
          return;
        }

        const deleted = bot.cave.deletePreset(name);
        if (!deleted) {
          return;
        }

        refreshCavePresetControls();
        refreshCaveStatus();
        refreshCaveClosestStatus();
        refreshCaveTransitionStatus();
      });
    }

    if (autoHealMinHpInput) {
      autoHealMinHpInput.value = String(bot.heal?.config?.minHp ?? 0);
      autoHealMinHpInput.addEventListener("change", () => {
        const minHp = Math.max(0, Number(autoHealMinHpInput.value) || 0);
        autoHealMinHpInput.value = String(minHp);
        bot.heal.updateConfig({ minHp });
      });
    }

    if (autoHealHpHotkeyInput) {
      autoHealHpHotkeyInput.value = String(bot.heal?.config?.hpHotbarSlot ?? 1);
      autoHealHpHotkeyInput.addEventListener("change", () => {
        const hpHotbarSlot = Math.min(12, Math.max(1, Number(autoHealHpHotkeyInput.value) || 1));
        autoHealHpHotkeyInput.value = String(hpHotbarSlot);
        bot.heal.updateConfig({ hpHotbarSlot });
      });
    }

    if (autoHealMinManaInput) {
      autoHealMinManaInput.value = String(bot.heal?.config?.minMana ?? 0);
      autoHealMinManaInput.addEventListener("change", () => {
        const minMana = Math.max(0, Number(autoHealMinManaInput.value) || 0);
        autoHealMinManaInput.value = String(minMana);
        bot.heal.updateConfig({ minMana });
      });
    }

    if (autoHealManaHotkeyInput) {
      autoHealManaHotkeyInput.value = String(bot.heal?.config?.manaHotbarSlot ?? 1);
      autoHealManaHotkeyInput.addEventListener("change", () => {
        const manaHotbarSlot = Math.min(12, Math.max(1, Number(autoHealManaHotkeyInput.value) || 1));
        autoHealManaHotkeyInput.value = String(manaHotbarSlot);
        bot.heal.updateConfig({ manaHotbarSlot });
      });
    }

    if (autoHealEnabledInput) {
      autoHealEnabledInput.checked = !!bot.heal?.status?.().running;
      autoHealEnabledInput.addEventListener("change", () => {
        const minHp = Math.max(0, Number(autoHealMinHpInput?.value) || bot.heal.config.minHp || 0);
        const hpHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoHealHpHotkeyInput?.value) || bot.heal.config.hpHotbarSlot || 1)
        );
        const minMana = Math.max(0, Number(autoHealMinManaInput?.value) || bot.heal.config.minMana || 0);
        const manaHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoHealManaHotkeyInput?.value) || bot.heal.config.manaHotbarSlot || 1)
        );

        if (autoHealEnabledInput.checked) {
          bot.heal.start({ minHp, hpHotbarSlot, minMana, manaHotbarSlot });
        } else {
          bot.heal.stop();
        }

        refreshAutoHealStatus();
      });
    }

    if (autoAttackHotkeyInput) {
      autoAttackHotkeyInput.value = String(bot.attack?.config?.targetHotbarSlot ?? 3);
      autoAttackHotkeyInput.addEventListener("change", () => {
        const targetHotbarSlot = Math.min(12, Math.max(1, Number(autoAttackHotkeyInput.value) || 1));
        autoAttackHotkeyInput.value = String(targetHotbarSlot);
        bot.attack.updateConfig({ targetHotbarSlot });
      });
    }

    if (autoAttackRuneHotkeyInput) {
      autoAttackRuneHotkeyInput.value = bot.attack?.config?.runeHotbarSlot
        ? String(bot.attack.config.runeHotbarSlot)
        : "";
      autoAttackRuneHotkeyInput.addEventListener("change", () => {
        const rawValue = Number(autoAttackRuneHotkeyInput.value);
        const runeHotbarSlot = Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12
          ? Math.trunc(rawValue)
          : null;
        autoAttackRuneHotkeyInput.value = runeHotbarSlot ? String(runeHotbarSlot) : "";
        bot.attack.updateConfig({ runeHotbarSlot });
      });
    }

    if (autoAttackMeleeInput) {
      autoAttackMeleeInput.checked = bot.attack?.config?.meleeMode !== false;
      autoAttackMeleeInput.addEventListener("change", () => {
        bot.attack.updateConfig({ meleeMode: autoAttackMeleeInput.checked });
      });
    }

    function addNameToAutoAttackList(listKey) {
      const rawName = autoAttackFilterNameInput?.value?.trim() || "";
      if (!rawName) {
        return;
      }

      const config = bot.attack?.config || {};
      const currentList = Array.isArray(config[listKey]) ? config[listKey] : [];
      const exists = currentList.some(
        (name) => String(name).trim().toLowerCase() === rawName.toLowerCase()
      );

      if (!exists) {
        bot.attack.updateConfig({ [listKey]: [...currentList, rawName] });
      }

      if (autoAttackFilterNameInput) {
        autoAttackFilterNameInput.value = "";
      }

      refreshAutoAttackFilterControls();
    }

    if (autoAttackFilterModeInput) {
      autoAttackFilterModeInput.value = bot.attack?.config?.targetFilterMode || "all";
      autoAttackFilterModeInput.addEventListener("change", () => {
        const mode = autoAttackFilterModeInput.value;
        bot.attack.updateConfig({ targetFilterMode: mode });
        refreshAutoAttackFilterControls();
      });
    }

    if (autoAttackIncludeAddButton) {
      autoAttackIncludeAddButton.addEventListener("click", () => {
        addNameToAutoAttackList("includedCreatureNames");
      });
    }

    if (autoAttackExcludeAddButton) {
      autoAttackExcludeAddButton.addEventListener("click", () => {
        addNameToAutoAttackList("excludedCreatureNames");
      });
    }

    if (autoAttackFilterNameInput) {
      autoAttackFilterNameInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") {
          return;
        }

        event.preventDefault();
        const mode = autoAttackFilterModeInput?.value === "exclude"
          ? "excludedCreatureNames"
          : "includedCreatureNames";
        addNameToAutoAttackList(mode);
      });
    }

    if (autoAttackEnabledInput) {
      autoAttackEnabledInput.checked = !!bot.attack?.status?.().running;
      autoAttackEnabledInput.addEventListener("change", () => {
        const targetHotbarSlot = Math.min(
          12,
          Math.max(1, Number(autoAttackHotkeyInput?.value) || bot.attack.config.targetHotbarSlot || 1)
        );
        const runeHotbarSlot = (() => {
          const rawValue = Number(autoAttackRuneHotkeyInput?.value);
          if (Number.isFinite(rawValue) && rawValue >= 1 && rawValue <= 12) {
            return Math.trunc(rawValue);
          }

          return bot.attack.config.runeHotbarSlot ?? null;
        })();
        const meleeMode = !!autoAttackMeleeInput?.checked;

        if (autoAttackEnabledInput.checked) {
          bot.attack.start({ targetHotbarSlot, runeHotbarSlot, meleeMode });
        } else {
          bot.attack.stop();
        }

        refreshAutoAttackStatus();
      });
    }

    if (talkApiKeyInput) {
      talkApiKeyInput.value = bot.talk?.config?.apiKey || "";
      talkApiKeyInput.addEventListener("change", () => {
        bot.talk.updateConfig({ apiKey: talkApiKeyInput.value.trim() });
        refreshTalkStatus();
      });
    }

    if (talkPromptInput) {
      talkPromptInput.value = bot.talk?.config?.systemPrompt || "";
      talkPromptInput.addEventListener("change", () => {
        bot.talk.updateConfig({ systemPrompt: talkPromptInput.value.trim() });
      });
    }

    if (talkEnabledInput) {
      talkEnabledInput.checked = !!bot.talk?.status?.().running;
      talkEnabledInput.addEventListener("change", () => {
        if (talkEnabledInput.checked) {
          bot.talk.updateConfig({
            apiKey: talkApiKeyInput?.value?.trim() || "",
            systemPrompt: talkPromptInput?.value?.trim() || bot.talk.config.systemPrompt || "",
          });
          const started = bot.talk.start();
          if (!started) {
            talkEnabledInput.checked = false;
          }
        } else {
          bot.talk.stop();
        }

        refreshTalkStatus();
      });
    }

    if (panicUnknownInput) {
      panicUnknownInput.checked = !!bot.panic?.status?.().config?.unknownPlayerEnabled;
      panicUnknownInput.addEventListener("change", () => {
        bot.panic.updateConfig({ unknownPlayerEnabled: panicUnknownInput.checked });
        refreshPanicStatus();
      });
    }

    if (panicHealthInput) {
      panicHealthInput.checked = !!bot.panic?.status?.().config?.healthLossEnabled;
      panicHealthInput.addEventListener("change", () => {
        bot.panic.updateConfig({ healthLossEnabled: panicHealthInput.checked });
        refreshPanicStatus();
      });
    }

    if (panicReturnInput) {
      panicReturnInput.checked = !!bot.panic?.status?.().config?.returnToOriginEnabled;
      panicReturnInput.addEventListener("change", () => {
        bot.panic.updateConfig({ returnToOriginEnabled: panicReturnInput.checked });
        refreshPanicStatus();
      });
    }

    if (xrayOverlayButton) {
      xrayOverlayButton.addEventListener("click", () => {
        const enabled = !!bot.xray?.status?.().config?.overlayEnabled;
        bot.xray?.setOverlayEnabled?.(!enabled);
        refreshXrayStatus();
      });
    }

    if (xrayFloorSelect) {
      xrayFloorSelect.addEventListener("change", () => {
        const rawValue = xrayFloorSelect.value;
        bot.xray?.setSelectedFloor?.(rawValue === "all" ? null : Number(rawValue));
        refreshXrayStatus();
        refreshVisibleCreatures();
      });
    }

    panel.querySelector("#k9x-set-home")?.addEventListener("click", () => {
      bot.pz.setHomePzCurrentSpot();
      refreshHomeLabel();
    });

    refreshHomeLabel();
    refreshPanicStatus();
    refreshXrayStatus();
    renderGameMasterNames();
    renderTrustedNames();
    refreshRuneStatus();
    refreshAutoHealStatus();
    refreshAutoInvisibleStatus();
    refreshAutoMagicShieldStatus();
    refreshAutoAttackStatus();
    refreshAutoAttackFilterControls();
    refreshAutoEatStatus();
    refreshAutoFishingStatus();
    refreshCaveStatus();
    refreshCaveModeStatus();
    refreshEquipRingStatus();
    refreshTalkStatus();
    refreshVisibleCreatures();
    refreshCavePresetControls();
    refreshCaveClosestStatus();
    refreshCaveTransitionStatus();

    const autoAttackFilterTimerId = window.setInterval(refreshAutoAttackFilterControls, 1000);
    bot.addCleanup(() => {
      window.clearInterval(autoAttackFilterTimerId);
    });

    const visibleCreaturesTimerId = window.setInterval(refreshVisibleCreatures, 1000);
    bot.addCleanup(() => {
      window.clearInterval(visibleCreaturesTimerId);
    });

    const talkStatusTimerId = window.setInterval(refreshTalkStatus, 1000);
    bot.addCleanup(() => {
      window.clearInterval(talkStatusTimerId);
    });

    const autoFishingStatusTimerId = window.setInterval(refreshAutoFishingStatus, 1000);
    bot.addCleanup(() => {
      window.clearInterval(autoFishingStatusTimerId);
    });

    const runeStatusTimerId = window.setInterval(refreshRuneStatus, 1000);
    bot.addCleanup(() => {
      window.clearInterval(runeStatusTimerId);
    });

    const caveStatusTimerId = window.setInterval(() => {
      refreshCaveStatus();
      refreshCaveModeStatus();
      refreshCavePresetControls();
      refreshCaveClosestStatus();
      refreshCaveTransitionStatus();
    }, 1000);
    bot.addCleanup(() => {
      window.clearInterval(caveStatusTimerId);
    });

  }

  bot.ui = {
    inject,
    destroy,
    refreshHomeLabel,
    refreshPanicStatus,
    refreshXrayStatus,
    refreshRuneStatus,
    refreshAutoHealStatus,
    refreshAutoInvisibleStatus,
    refreshAutoMagicShieldStatus,
    refreshAutoAttackStatus,
    refreshAutoAttackFilterControls,
    refreshAutoEatStatus,
    refreshAutoFishingStatus,
    refreshCaveStatus,
    refreshCaveModeStatus,
    refreshCavePresetControls,
    refreshEquipRingStatus,
    refreshTalkStatus,
    refreshVisibleCreatures,
    refreshCaveClosestStatus,
    refreshCaveTransitionStatus,
    getSavedPanelPosition,
    getSavedPanelCollapsed,
    setPanelCollapsed: (collapsed) => {
      const panel = document.getElementById("k9x-panel");
      setPanelCollapsed(panel, collapsed);
    },
  };
};
(() => {
  const bundle = window.__minibiaBotBundle || window.__minibiaBotReloadBundle || {};
  const storageKeyMigrations = [
    ["minibiaBot.audio.alarmSrc", "k9x.audio.alarmSrc"],
    ["minibiaBot.rune.config", "k9x.rune.config"],
    ["minibiaBot.heal.config", "k9x.heal.config"],
    ["minibiaBot.invisible.config", "k9x.invisible.config"],
    ["minibiaBot.magicShield.config", "k9x.magicShield.config"],
    ["minibiaBot.attack.config", "k9x.attack.config"],
    ["minibiaBot.cave.config", "k9x.cave.config"],
    ["minibiaBot.cave.route", "k9x.cave.route"],
    ["minibiaBot.cave.transitions", "k9x.cave.transitions"],
    ["minibiaBot.cave.presets", "k9x.cave.presets"],
    ["minibiaBot.equipRing.config", "k9x.equipRing.config"],
    ["minibiaBot.eat.config", "k9x.eat.config"],
    ["minibiaBot.fishing.config", "k9x.fishing.config"],
    ["minibiaBot.talk.config", "k9x.talk.config"],
    ["minibiaBot.panic.config", "k9x.panic.config"],
    ["minibiaBot.pz.home", "k9x.pz.home"],
    ["minibiaBot.xray.config", "k9x.xray.config"],
    ["minibiaBot.ui.panelPosition", "k9x.ui.panelPosition"],
    ["minibiaBot.ui.panelCollapsed", "k9x.ui.panelCollapsed"],
    ["gameHelper.audio.alarmSrc", "k9x.audio.alarmSrc"],
    ["gameHelper.rune.config", "k9x.rune.config"],
    ["gameHelper.heal.config", "k9x.heal.config"],
    ["gameHelper.invisible.config", "k9x.invisible.config"],
    ["gameHelper.magicShield.config", "k9x.magicShield.config"],
    ["gameHelper.attack.config", "k9x.attack.config"],
    ["gameHelper.cave.config", "k9x.cave.config"],
    ["gameHelper.cave.route", "k9x.cave.route"],
    ["gameHelper.cave.transitions", "k9x.cave.transitions"],
    ["gameHelper.cave.presets", "k9x.cave.presets"],
    ["gameHelper.equipRing.config", "k9x.equipRing.config"],
    ["gameHelper.eat.config", "k9x.eat.config"],
    ["gameHelper.fishing.config", "k9x.fishing.config"],
    ["gameHelper.talk.config", "k9x.talk.config"],
    ["gameHelper.panic.config", "k9x.panic.config"],
    ["gameHelper.pz.home", "k9x.pz.home"],
    ["gameHelper.xray.config", "k9x.xray.config"],
    ["gameHelper.ui.panelPosition", "k9x.ui.panelPosition"],
    ["gameHelper.ui.panelCollapsed", "k9x.ui.panelCollapsed"],
  ];
  const persistedEnabledModules = [
    ["rune", "k9x.rune.config"],
    ["heal", "k9x.heal.config"],
    ["invisible", "k9x.invisible.config"],
    ["magicShield", "k9x.magicShield.config"],
    ["attack", "k9x.attack.config"],
    ["cave", "k9x.cave.config"],
    ["equipRing", "k9x.equipRing.config"],
    ["eat", "k9x.eat.config"],
    ["fishing", "k9x.fishing.config"],
    ["talk", "k9x.talk.config"],
  ];

  function migrateLegacyStorageKeys() {
    storageKeyMigrations.forEach(([legacyKey, nextKey]) => {
      if (!legacyKey || !nextKey || legacyKey === nextKey) {
        return;
      }

      try {
        const legacyValue = window.localStorage.getItem(legacyKey);
        if (legacyValue == null) {
          return;
        }

        const nextValue = window.localStorage.getItem(nextKey);
        if (nextValue == null) {
          window.localStorage.setItem(nextKey, legacyValue);
        }

        window.localStorage.removeItem(legacyKey);
      } catch (error) {
        console.error("[minibia-bot] failed to migrate storage key", {
          legacyKey,
          nextKey,
          error,
        });
      }
    });
  }

  function getPersistedEnabledSnapshot(bot) {
    const snapshot = {};
    const status = typeof bot?.status === "function" ? bot.status() : null;

    persistedEnabledModules.forEach(([moduleName]) => {
      const enabled = status?.[moduleName]?.config?.enabled;
      if (typeof enabled === "boolean") {
        snapshot[moduleName] = enabled;
      }
    });

    return snapshot;
  }

  function restorePersistedEnabledSnapshot(snapshot) {
    persistedEnabledModules.forEach(([moduleName, storageKey]) => {
      if (typeof snapshot?.[moduleName] !== "boolean") {
        return;
      }

      try {
        const rawValue = window.localStorage.getItem(storageKey);
        const config = rawValue ? JSON.parse(rawValue) : {};
        config.enabled = snapshot[moduleName];
        window.localStorage.setItem(storageKey, JSON.stringify(config));
      } catch (error) {
        console.error("[minibia-bot] failed to restore persisted enabled state", {
          module: moduleName,
          error,
        });
      }
    });
  }

  function boot(currentBundle = bundle) {
    migrateLegacyStorageKeys();
    const previousEnabledSnapshot = getPersistedEnabledSnapshot(window.minibiaBot);

    if (window.minibiaBot?.destroy) {
      window.minibiaBot.destroy();
    }

    restorePersistedEnabledSnapshot(previousEnabledSnapshot);

    const bot = currentBundle.createBot();

    currentBundle.installPzModule(bot);
    currentBundle.installXrayModule(bot);
    currentBundle.installPanicModule(bot);
    currentBundle.installRuneModule(bot);
    currentBundle.installHealModule(bot);
    currentBundle.installAutoInvisibleModule(bot);
    currentBundle.installAutoMagicShieldModule(bot);
    currentBundle.installAutoAttackModule(bot);
    currentBundle.installCaveModule(bot);
    currentBundle.installEquipRingModule(bot);
    currentBundle.installAutoEatModule(bot);
    currentBundle.installAutoFishingModule(bot);
    currentBundle.installTalkModule(bot);
    currentBundle.installPanel(bot);

    bot.ui.inject();

    bot.start = (...args) => bot.rune.start(...args);
    bot.stop = (...args) => bot.rune.stop(...args);
    bot.reload = () => window.minibiaBotReload?.();
    bot.status = () => ({
      version: bot.version,
      pz: {
        home: bot.pz.getHomePz(),
      },
      xray: bot.xray.status(),
      panic: bot.panic.status(),
      rune: bot.rune.status(),
      heal: bot.heal.status(),
      invisible: bot.invisible.status(),
      magicShield: bot.magicShield.status(),
      attack: bot.attack.status(),
      cave: bot.cave.status(),
      equipRing: bot.equipRing.status(),
      eat: bot.eat.status(),
      fishing: bot.fishing.status(),
      talk: bot.talk.status(),
    });

    window.minibiaBot = bot;
    window.pzBot = bot.pz;

    console.log("[minibia-bot] ready", {
      version: bot.version,
      modules: ["pz", "xray", "panic", "rune", "heal", "invisible", "magicShield", "attack", "cave", "equipRing", "eat", "fishing", "talk", "ui"],
    });
    console.log("minibiaBot.reload()");
    console.log("minibiaBot.xray.status()");
    console.log("minibiaBot.panic.status()");
    console.log("minibiaBot.pz.goToNearestPz()");
    console.log("minibiaBot.pz.setHomePzCurrentSpot()");
    console.log("minibiaBot.pz.goToHomePz()");
    console.log("minibiaBot.rune.start()");
    console.log("minibiaBot.rune.stop()");
    console.log("minibiaBot.heal.start()");
    console.log("minibiaBot.heal.stop()");
    console.log("minibiaBot.invisible.start()");
    console.log("minibiaBot.invisible.stop()");
    console.log("minibiaBot.magicShield.start()");
    console.log("minibiaBot.magicShield.stop()");
    console.log("minibiaBot.attack.start()");
    console.log("minibiaBot.attack.stop()");
    console.log("minibiaBot.cave.addWaypointCurrentSpot()");
    console.log("minibiaBot.cave.start()");
    console.log("minibiaBot.cave.stop()");
    console.log("minibiaBot.equipRing.start()");
    console.log("minibiaBot.equipRing.stop()");
    console.log("minibiaBot.eat.start()");
    console.log("minibiaBot.eat.stop()");
    console.log("minibiaBot.fishing.start()");
    console.log("minibiaBot.fishing.stop()");
    console.log("minibiaBot.talk.updateConfig({ apiKey: \"...\" })");
    console.log("minibiaBot.talk.start()");
    console.log("minibiaBot.talk.stop()");
    return bot;
  }

  window.__minibiaBotReloadBundle = bundle;
  window.minibiaBotReload = () => boot(window.__minibiaBotReloadBundle || bundle);
  delete window.__minibiaBotBundle;
  boot(bundle);
})();
