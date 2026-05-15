window.__minibiaBotBundle = window.__minibiaBotBundle || {};

window.__minibiaBotBundle.installXrayModule = function installXrayModule(bot) {
  const configStorageKey = "minibiaBot.xray.config";
  const overlayRootId = "minibia-bot-xray-overlay";
  const overlayStyleId = "minibia-bot-xray-overlay-style";
  const overlayState = {
    running: false,
    timerId: null,
  };
  const config = Object.assign(
    {
      overlayEnabled: false,
    },
    bot.storage.get(configStorageKey, {})
  );

  function persistConfig() {
    bot.storage.set(configStorageKey, { ...config });
  }

  function normalizeName(name) {
    return String(name || "").trim().toLowerCase();
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
