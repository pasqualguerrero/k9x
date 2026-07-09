(() => {
  const nm = window.gameClient?.networkManager;
  if (!nm?.socket) {
    console.warn("Not connected — log in first.");
    return;
  }
  if (!window.CONST?.PROTOCOL) {
    console.warn("CONST.PROTOCOL not loaded yet.");
    return;
  }

  const pick = (table, names) =>
    new Set(names.map((n) => table[n]).filter((v) => v != null));

  const WATCH_IN = pick(CONST.PROTOCOL.SERVER, [
    "CREATURE_MOVE",
    "CREATURE_STATE",
    "CREATURE_PROPERTY",
    "CREATURE_SAY",
    "CREATURE_REMOVE",
    "MESSAGE_SERVER",
    "PLAYER_STATISTICS",
    "TARGET",
    "COMBAT_LOCK",
    "MAGIC_EFFECT",
    "DISTANCE_EFFECT",
    "GAIN_EXPERIENCE",
    "CANCEL_WALK",
    "TOGGLE_CONDITION",
    "LATENCY",
  ]);

  const WATCH_OUT = pick(CONST.PROTOCOL.CLIENT, [
    "MOVE",
    "STRICT_MOVE",
    "AUTO_WALK",
    "WALK_TO_DESTINATION",
    "TARGET",
    "CAST_SPELL",
    "THING_USE",
    "THING_USE_WITH",
    "THING_MOVE",
    "CHANNEL_MESSAGE",
  ]);

  const serverNames = Object.fromEntries(
    Object.entries(CONST.PROTOCOL.SERVER).map(([k, v]) => [v, k])
  );
  const clientNames = Object.fromEntries(
    Object.entries(CONST.PROTOCOL.CLIENT).map(([k, v]) => [v, k])
  );
  const propertyNames = Object.fromEntries(
    Object.entries(CONST.PROPERTIES || {}).map(([k, v]) => [v, k])
  );

  const DIR_NAMES = ["north", "east", "south", "west", "ne", "se", "sw", "nw"];

  const hex = (bytes) =>
    [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");

  const readerFrom = (bytes) => {
    const copy = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return new PacketReader(copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength));
  };

  const decodeOut = (buf, opcode) => {
    const C = CONST.PROTOCOL.CLIENT;
    try {
      const r = readerFrom(buf);
      r.readUInt8();

      if (opcode === C.TARGET || opcode === C.FOLLOW) {
        return { creatureId: r.readUInt32() };
      }
      if (opcode === C.CAST_SPELL) {
        return { spellSid: r.readUInt16() };
      }
      if (opcode === C.MOVE || opcode === C.TURN) {
        return { direction: r.readUInt8(), directionName: DIR_NAMES[r.buffer[r.index - 1]] };
      }
      if (opcode === C.STRICT_MOVE) {
        const direction = r.readUInt8();
        const x = r.readUInt16();
        const y = r.readUInt16();
        const z = r.readUInt8();
        return { direction, directionName: DIR_NAMES[direction], from: { x, y, z } };
      }
      if (opcode === C.WALK_TO_DESTINATION) {
        return {
          to: { x: r.readUInt16(), y: r.readUInt16(), z: r.readUInt8() },
        };
      }
      if (opcode === C.AUTO_WALK) {
        const count = r.readUInt8();
        const directions = [];
        for (let i = 0; i < count; i += 1) {
          const d = r.readUInt8();
          directions.push(DIR_NAMES[d] ?? d);
        }
        return { steps: count, directions };
      }
      if (opcode === C.CHANNEL_MESSAGE) {
        const channel = r.readUInt8();
        const loudness = r.readUInt8();
        const text = r.readString();
        return { channel, loudness, text };
      }
      if (opcode === C.THING_MOVE) {
        return { note: "item move — see hex for full 19-byte layout" };
      }
    } catch (error) {
      return { decodeError: error?.message || String(error) };
    }
    return null;
  };

  const decodeIn = (buf, opcode) => {
    const S = CONST.PROTOCOL.SERVER;
    try {
      const r = readerFrom(buf);
      r.readUInt8();

      if (opcode === S.CREATURE_PROPERTY) {
        const guid = r.readUInt32();
        const propertyId = r.readUInt8();
        const value = r.readUInt32();
        return {
          guid,
          property: propertyNames[propertyId] || propertyId,
          value,
        };
      }
      if (opcode === S.CREATURE_MOVE) {
        const id = r.readUInt32();
        const x = r.readUInt16();
        const y = r.readUInt16();
        const z = r.readUInt8();
        const speed = r.readUInt16();
        return { id, position: { x, y, z }, speed };
      }
      if (opcode === S.CANCEL_WALK) {
        r.readUInt8();
        const x = r.readUInt16();
        const y = r.readUInt16();
        const z = r.readUInt8();
        return { position: { x, y, z } };
      }
      if (opcode === S.CREATURE_REMOVE || opcode === S.TARGET) {
        return { id: r.readUInt32() };
      }
      if (opcode === S.MESSAGE_SERVER) {
        const color = r.readUInt8();
        const priority = r.readUInt8();
        const text = r.readString();
        return { color, priority, text };
      }
      if (opcode === S.GAIN_EXPERIENCE) {
        return { id: r.readUInt32(), experience: r.readUInt16() };
      }
      if (opcode === S.TOGGLE_CONDITION) {
        return {
          guid: r.readUInt32(),
          condition: r.readUInt8(),
          enabled: r.readBoolean(),
        };
      }
      if (opcode === S.MAGIC_EFFECT || opcode === S.DISTANCE_EFFECT) {
        const x = r.readUInt16();
        const y = r.readUInt16();
        const z = r.readUInt8();
        const type = r.readUInt8();
        return { position: { x, y, z }, effectType: type };
      }
      if (opcode === S.LATENCY) {
        return { pong: true };
      }
    } catch (error) {
      return { decodeError: error?.message || String(error) };
    }
    return null;
  };

  const logPacket = (dir, opcode, bytes) => {
    const watch = dir === "IN" ? WATCH_IN : WATCH_OUT;
    if (!watch.has(opcode)) return;

    const names = dir === "IN" ? serverNames : clientNames;
    const name = names[opcode] || "?";
    const payload = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const body = payload.length > 1 ? payload.subarray(1) : payload;
    const decoded =
      dir === "IN" ? decodeIn(payload, opcode) : decodeOut(payload, opcode);

    const playerId = window.gameClient?.player?.id;
    const actor =
      dir === "IN" && decoded && playerId != null && decoded.guid === playerId
        ? " (you)"
        : dir === "IN" && decoded && decoded.id === playerId
          ? " (you)"
          : "";

    console.groupCollapsed(
      `${dir} 0x${opcode.toString(16).padStart(2, "0")} ${name}${actor} (${payload.length} bytes)`
    );
    console.log("raw", hex(payload));
    if (body.length) {
      console.log("body", hex(body));
    }
    if (decoded) {
      console.log("decoded", decoded);
    } else {
      console.log("decoded", "(no decoder for this opcode yet — use raw/body hex)");
    }
    console.groupEnd();
  };

  if (!nm.__sniffSend) {
    nm.__sniffSend = nm.send.bind(nm);
    nm.send = function (packet) {
      try {
        const buf = packet.getBuffer();
        logPacket("OUT", buf[0], buf);
      } catch (error) {
        console.warn("[sniffer] OUT log failed", error);
      }
      return nm.__sniffSend(packet);
    };
  }

  if (!NetworkManager.prototype.__sniffReadPacket) {
    NetworkManager.prototype.__sniffReadPacket = NetworkManager.prototype.readPacket;
    NetworkManager.prototype.readPacket = function (packet) {
      const start = packet.index;
      const result = NetworkManager.prototype.__sniffReadPacket.call(this, packet);
      const end = packet.index;

      try {
        const slice = packet.buffer.subarray(start, end);
        if (slice.length > 0) {
          logPacket("IN", slice[0], slice);
        }
      } catch (error) {
        console.warn("[sniffer] IN log failed", error);
      }

      return result;
    };
  }

  window.__minibiaSniffer = {
    WATCH_IN,
    WATCH_OUT,
    logPacket,
    decodeIn,
    decodeOut,
    hex,
  };

  console.log("[sniffer] payload logging installed");
  console.log("WATCH_IN", [...WATCH_IN].map((v) => serverNames[v]));
  console.log("WATCH_OUT", [...WATCH_OUT].map((v) => clientNames[v]));
  console.log("Expand console groups to see raw hex + decoded fields");
})();
