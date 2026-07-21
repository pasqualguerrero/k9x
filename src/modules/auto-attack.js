window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installAutoAttackModule = function installAutoAttackModule(bot) {
  const configStorageKey = "k9x.attack.config";
  const state = {
    running: false,
    timerId: null,
    lastTargetHotkeyAt: 0,
    lastRuneHotkeyAt: 0,
    lastExoriHotkeyAt: 0,
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
      // Knight AOE (exori): cast when enough filtered monsters are face-to-face.
      exoriEnabled: false,
      exoriHotbarSlot: null,
      exoriMinCreatures: 3,
      exoriCooldownMs: 2000,
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
  config.exoriHotbarSlot = normalizeHotbarSlot(config.exoriHotbarSlot);
  config.exoriMinCreatures = normalizeExoriMinCreatures(config.exoriMinCreatures);
  config.exoriEnabled = !!config.exoriEnabled;
  {
    const cooldown = Math.trunc(Number(config.exoriCooldownMs));
    config.exoriCooldownMs = Number.isFinite(cooldown) ? Math.max(0, cooldown) : 2000;
  }

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
    // Prefer the real creature name; only fall back to "Mob" when the game
    // exposes no name at all (otherwise every unnamed type collapses to one bucket).
    const targetName = normalizeCreatureName(target.name);
    const includedNames = new Set((config.includedCreatureNames || []).map(normalizeCreatureName));
    const excludedNames = new Set((config.excludedCreatureNames || []).map(normalizeCreatureName));

    if (mode === "include") {
      // "Only include list" with an empty list means attack nothing — not everything.
      if (!includedNames.size) {
        return false;
      }

      // Exact case-insensitive match. Also require a real name so blank names never slip through.
      if (!targetName || !includedNames.has(targetName)) {
        return false;
      }

      // Exclude list still wins when a name is on both lists.
      return !excludedNames.has(targetName);
    }

    if (mode === "exclude") {
      // No name → cannot match an exclude entry; still allow (same as "all" for unknowns).
      if (!targetName) {
        return true;
      }

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

    // Support Position-like objects and plain {x,y,z}.
    const x = Number(value.x);
    const y = Number(value.y);
    const z = Number(value.z);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return null;
    }

    // Floor (not trunc) so negative world coords still snap to the correct tile.
    return {
      x: Math.floor(x),
      y: Math.floor(y),
      z: Math.floor(z),
    };
  }

  function readCreaturePosition(creature) {
    if (!creature) {
      return null;
    }

    // Prefer live getPosition(); fall back to cached fields used by the client.
    return normalizePosition(
      creature.getPosition?.() ||
      creature.__position ||
      creature.position ||
      null
    );
  }

  function getPositionKey(position) {
    return position ? `${position.x},${position.y},${position.z}` : null;
  }

  function isAdjacentTile(from, to) {
    if (!from || !to) {
      return false;
    }

    if (Number(from.z) !== Number(to.z)) {
      return false;
    }

    const dx = Math.abs(Number(from.x) - Number(to.x));
    const dy = Math.abs(Number(from.y) - Number(to.y));
    // Face-to-face: same floor, Chebyshev distance 1 (all 8 surrounding tiles).
    return (dx !== 0 || dy !== 0) && dx <= 1 && dy <= 1;
  }

  function normalizeExoriMinCreatures(value) {
    const next = Math.trunc(Number(value));
    if (!Number.isFinite(next)) {
      return 3;
    }

    return Math.min(8, Math.max(1, next));
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

    return bot.withAutomationSendSkip(() => {
      window.gameClient.player.setFollowTarget(null);
      window.gameClient.send(new FollowPacket(0));
      return true;
    });
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

    return bot.withAutomationSendSkip(() => {
      window.gameClient.player.setTarget(null);
      window.gameClient.send(new TargetPacket(0));
      return true;
    });
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

    // Already on this target — re-sending TARGET every tick is pure untrusted
    // intent noise with no gameplay benefit.
    if (isSameCreature(getCurrentTarget(), target)) {
      state.engagedTargetId = target.id;
      return true;
    }

    return bot.withAutomationSendSkip(() => {
      window.gameClient.player.setTarget(target);
      window.gameClient.send(new TargetPacket(target.id));
      state.engagedTargetId = target.id;
      return true;
    });
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

    return bot.withAutomationSendSkip(() => {
      window.gameClient.player.setFollowTarget(target);
      window.gameClient.send(new FollowPacket(target.id));
      return true;
    });
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
    const engagedIsValid = engagedTarget
      && !isTargetSkipped(engagedTarget, now)
      && shouldTargetCreature(engagedTarget);
    const preferredTarget = engagedIsValid
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

    // Hotbar targeting is the game's picker — it ignores our include/exclude lists.
    // Only fall back to it when filters are off ("all"), so filtered modes cannot
    // acquire a creature that failed shouldTargetCreature.
    const filterMode = normalizeTargetFilterMode(config.targetFilterMode);
    if (filterMode !== "all") {
      bot.log("auto attack skipped hotkey fallback (target filter active)", {
        filterMode,
        preferredTarget: preferredTarget
          ? { id: preferredTarget.id, name: preferredTarget.name || "Mob" }
          : null,
      });
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

  function getFloorMonsters() {
    // Scan activeCreatures directly for adjacency. Do not use the xray
    // screen range (8x6) — that path also has strict z=== checks that can
    // drop valid same-floor mobs, which under-counts exori surrounds.
    const player = window.gameClient?.player;
    const myId = player?.id;
    const playerPosition = normalizePosition(bot.getPlayerPosition());
    if (!playerPosition) {
      return [];
    }

    return Object.values(window.gameClient?.world?.activeCreatures || {}).filter((creature) => {
      if (!creature || creature.id === myId) {
        return false;
      }

      // type 0 = player in this client; exori is for monsters/NPCs around you.
      if (creature.type === 0) {
        return false;
      }

      if (isCreatureDead(creature)) {
        return false;
      }

      const creaturePosition = readCreaturePosition(creature);
      if (!creaturePosition || Number(creaturePosition.z) !== Number(playerPosition.z)) {
        return false;
      }

      return true;
    });
  }

  function getAdjacentMonsters(options = {}) {
    const {
      // Target-filter (include/exclude) still applies so "relevant" mobs match attack filters.
      applyTargetFilter = true,
      // Skipped chase targets are still standing next to you — they must count for AOE.
      includeSkipped = true,
      now = Date.now(),
    } = options;

    const playerPosition = normalizePosition(bot.getPlayerPosition());
    if (!playerPosition) {
      return [];
    }

    if (!includeSkipped) {
      pruneSkippedTargets(now);
    }

    return getFloorMonsters()
      .filter((monster) => {
        if (applyTargetFilter && !shouldTargetCreature(monster)) {
          return false;
        }

        if (!includeSkipped && isTargetSkipped(monster, now)) {
          return false;
        }

        const monsterPosition = readCreaturePosition(monster);
        return isAdjacentTile(playerPosition, monsterPosition);
      });
  }

  function getAdjacentMonsterCandidates(now = Date.now()) {
    // Back-compat name used by status/exports: filtered, but NOT skip-gated.
    return getAdjacentMonsters({ applyTargetFilter: true, includeSkipped: true, now });
  }

  function canUseExori(now = Date.now()) {
    if (!config.exoriEnabled) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.exoriHotbarSlot);
    if (!slot) {
      return false;
    }

    if (now - state.lastExoriHotkeyAt < Math.max(0, Number(config.exoriCooldownMs) || 0)) {
      return false;
    }

    const minCreatures = normalizeExoriMinCreatures(config.exoriMinCreatures);
    return getAdjacentMonsters({ applyTargetFilter: true, includeSkipped: true, now }).length >= minCreatures;
  }

  function triggerExori(now = Date.now()) {
    if (!canUseExori(now)) {
      return false;
    }

    const slot = normalizeHotbarSlot(config.exoriHotbarSlot);
    const adjacent = getAdjacentMonsters({ applyTargetFilter: true, includeSkipped: true, now });
    // Always arm cooldown on attempt so OOM / failed cast does not spam every tick
    // or block the rest of the auto-attack loop.
    state.lastExoriHotkeyAt = now;

    const clicked = bot.clickHotbar(slot - 1);
    if (clicked) {
      markCombatActive(now);
      bot.log("used auto attack exori hotkey", {
        slot,
        adjacentCount: adjacent.length,
        minCreatures: normalizeExoriMinCreatures(config.exoriMinCreatures),
        monsters: adjacent.map((creature) => ({
          id: creature.id,
          name: creature.name || "Mob",
          position: readCreaturePosition(creature),
        })),
        playerPosition: normalizePosition(bot.getPlayerPosition()),
      });
    } else {
      bot.log("auto attack exori hotkey failed (continuing normal attack)", {
        slot,
        adjacentCount: adjacent.length,
        minCreatures: normalizeExoriMinCreatures(config.exoriMinCreatures),
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

    // Knight AOE is best-effort only: never return early on success/failure so
    // low mana or a failed cast cannot stall targeting, chase, or runes.
    triggerExori(now);

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
    const now = Date.now();
    const combatActive = syncCombatState(now);
    const playerPosition = normalizePosition(bot.getPlayerPosition());
    const adjacentFiltered = getAdjacentMonsters({ applyTargetFilter: true, includeSkipped: true, now });
    const adjacentRaw = getAdjacentMonsters({ applyTargetFilter: false, includeSkipped: true, now });
    return {
      running: state.running,
      config: { ...config },
      lastTargetHotkeyAt: state.lastTargetHotkeyAt,
      lastRuneHotkeyAt: state.lastRuneHotkeyAt,
      lastExoriHotkeyAt: state.lastExoriHotkeyAt,
      engagedTargetId: state.engagedTargetId,
      combatActive,
      combatStartedAt: state.combatStartedAt || 0,
      combatDurationMs: state.combatStartedAt ? Math.max(0, Date.now() - state.combatStartedAt) : 0,
      targetCount: getCombatTargetCount(),
      lastChaseAt: state.lastChaseAt,
      playerPosition,
      adjacentMonsterCount: adjacentFiltered.length,
      adjacentMonsterCountRaw: adjacentRaw.length,
      canUseExori: canUseExori(now),
      currentTarget: getCurrentTarget()
        ? {
            id: getCurrentTarget().id,
            name: getCurrentTarget().name,
            type: getCurrentTarget().type,
            position: readCreaturePosition(getCurrentTarget()),
          }
        : null,
      nearbyMonsters: getNearbyMonsters().map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: readCreaturePosition(creature),
        tileDistance: getTileDistance(playerPosition, readCreaturePosition(creature)),
        allowed: shouldTargetCreature(creature),
      })),
      adjacentMonsters: adjacentFiltered.map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: readCreaturePosition(creature),
      })),
      adjacentMonstersRaw: adjacentRaw.map((creature) => ({
        id: creature.id,
        name: creature.name,
        type: creature.type,
        position: readCreaturePosition(creature),
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

    if (Object.prototype.hasOwnProperty.call(nextConfig, "exoriHotbarSlot")) {
      nextConfig.exoriHotbarSlot = normalizeHotbarSlot(nextConfig.exoriHotbarSlot);
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "exoriMinCreatures")) {
      nextConfig.exoriMinCreatures = normalizeExoriMinCreatures(
        nextConfig.exoriMinCreatures ?? config.exoriMinCreatures
      );
    }

    if (Object.prototype.hasOwnProperty.call(nextConfig, "exoriCooldownMs")) {
      const cooldown = Math.trunc(Number(nextConfig.exoriCooldownMs));
      nextConfig.exoriCooldownMs = Number.isFinite(cooldown)
        ? Math.max(0, cooldown)
        : config.exoriCooldownMs;
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
    canUseExori,
    triggerExori,
    getAdjacentMonsters,
    getAdjacentMonsterCandidates,
    getFloorMonsters,
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
