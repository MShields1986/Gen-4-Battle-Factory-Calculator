// POJO factories for the eisencalc Gen 4 calc.
//
// The calc functions in lib/damage_gen4.js + lib/damage_modern.js are pure —
// they take Pokemon / Side / Field objects and return damage results without
// touching the DOM. eisencalc's own constructors (in shared_calc.js) read
// from jQuery DOM, which we want to avoid. This file builds equivalent POJOs
// from plain args.
//
// Assumes the Gen 4 globals have been wired up before this script runs:
//   STATS = STATS_GSC, gen = gameId = 4, isNeutralizingGas = false,
//   pokedex = POKEDEX_DPP, setdex = SETDEX_PHGSS, moves = MOVES_DPP,
//   items = ITEMS_DPP, abilities = ABILITIES_DPP, typeChart = TYPE_CHART_GSC.

(function (root) {
  "use strict";

  // ----- stat math (Gen 3+ formula) -----

  function calcHP(level, base, ivs, evs) {
    if (base === 1) return 1;
    return Math.floor((base * 2 + ivs + Math.floor(evs / 4)) * level / 100) + level + 10;
  }

  function calcStat(level, base, ivs, evs, natureMult) {
    return Math.floor((Math.floor((base * 2 + ivs + Math.floor(evs / 4)) * level / 100) + 5) * natureMult);
  }

  function natureMult(natureName, statName) {
    var mods = NATURES[natureName];
    if (!mods) return 1;
    if (mods[0] === statName) return 1.1;
    if (mods[1] === statName) return 0.9;
    return 1;
  }

  // ----- move construction -----

  function makeMove(name) {
    var defaults = moves[name];
    if (!defaults) {
      // Allow display of moves the calc doesn't know — they'll just deal 0
      return { name: name, bp: 0, type: "Normal", category: "Status", isCrit: false, hits: 1, usedTimes: 1 };
    }
    var hits = 1;
    if (defaults.maxMultiHits) hits = defaults.maxMultiHits;   // Bullet Seed etc.
    else if (defaults.isThreeHit) hits = 3;
    else if (defaults.isTwoHit) hits = 2;
    var move = Object.assign({}, defaults, {
      name: name,
      isCrit: !!defaults.alwaysCrit,
      hits: hits,
      usedTimes: 1,
    });
    return move;
  }

  // ----- Pokemon construction -----

  // opts: { species, setName, ivs (number 0-31, default 31), evsOverride, ability, item, status, level, curHP }
  function makePokemon(opts) {
    var species = opts.species;
    var setName = opts.setName;
    var ivs     = opts.ivs == null ? 31 : opts.ivs;

    var dexEntry = pokedex[species];
    if (!dexEntry) throw new Error("Unknown species: " + species);

    var setEntry = setdex[species] && setdex[species][setName];
    if (!setEntry && setName) throw new Error("Unknown set: " + species + " / " + setName);

    var level    = opts.level || 100;
    var nature   = (setEntry && setEntry.nature) || "Hardy";  // Hardy = neutral
    var ability  = opts.ability != null ? opts.ability
                  : (setEntry && setEntry.ability) ? setEntry.ability
                  : (dexEntry.ab || (dexEntry.abilities && dexEntry.abilities[0]) || "");
    var item     = opts.item != null ? opts.item : (setEntry ? setEntry.item : "");
    var status   = opts.status || "Healthy";
    var moveNames = (setEntry && setEntry.moves) || ["(No Move)", "(No Move)", "(No Move)", "(No Move)"];

    // EVs and IVs. STATS_GSC = [at, df, sa, sd, sp, ac, es] — note: no "hp"
    // (eisencalc keeps HP separate via maxHP / HPEVs / HPIVs).
    var srcEvs = opts.evsOverride || (setEntry && setEntry.evs) || {};
    var srcIvs = opts.ivsOverride || {};

    function getEv(s) { return srcEvs[s] || 0; }
    function getIv(s) { return srcIvs[s] != null ? srcIvs[s] : ivs; }

    // HP, computed separately
    var hpEvs = getEv("hp");
    var hpIvs = getIv("hp");
    var maxHP = calcHP(level, dexEntry.bs.hp, hpIvs, hpEvs);
    var curHP = opts.curHP != null ? opts.curHP : maxHP;

    // Combat stats
    var rawStats = {}, stats = {}, boosts = {}, evs = {}, ivMap = {};
    STATS.forEach(function (s) {
      evs[s]   = getEv(s);
      ivMap[s] = getIv(s);
      boosts[s] = (opts.boosts && opts.boosts[s]) || 0;
      if (s === "ac" || s === "es") {
        // accuracy / evasion, not real battle stats — leave 0
        rawStats[s] = 0;
      } else {
        rawStats[s] = calcStat(level, dexEntry.bs[s], ivMap[s], evs[s], natureMult(nature, s));
      }
      stats[s] = rawStats[s];
    });

    var poke = {
      name: species,
      setName: setName || "",
      type1: dexEntry.t1,
      type2: dexEntry.t2 || "",
      dexType1: dexEntry.t1,
      dexType2: dexEntry.t2 || "",
      level: level,
      maxHP: maxHP,
      curHP: curHP,
      HPEVs: evs.hp,
      HPIVs: ivMap.hp,
      isDynamax: false,
      isTerastal: false,
      teraType: "",
      rawStats: rawStats,
      stats: stats,
      boosts: boosts,
      evs: evs,
      ivs: ivMap,
      nature: nature,
      ability: ability,
      isAbilityActivated: false,
      item: item,
      status: status,
      toxicCounter: status === "Badly Poisoned" ? 1 : 0,
      weight: dexEntry.w || 10,
      baseMoveNames: moveNames.slice(),
      moves: moveNames.map(makeMove),
      hasType: function (t) { return this.type1 === t || this.type2 === t; },
      resetCurAbility: function () {
        // Gen 4 has no Neutralizing Gas, so this is always the mon's own ability.
        this.curAbility = (root.isNeutralizingGas && this.item !== "Ability Shield") ? "" : this.ability;
      },
    };
    poke.resetCurAbility();
    return poke;
  }

  // ----- Side / Field construction -----

  // Plain Side POJO. All defaults are "off" except whatever the caller passes.
  function makeSide(opts) {
    opts = opts || {};
    return {
      format:           opts.format           || "singles",
      terrain:          opts.terrain          || "",
      weather:          opts.weather          || "",
      isAuraFairy:      !!opts.isAuraFairy,
      isAuraDark:       !!opts.isAuraDark,
      isAuraBreak:      !!opts.isAuraBreak,
      isGravity:        !!opts.isGravity,
      isSR:             !!opts.isSR,
      spikes:           opts.spikes || 0,
      isReflect:        !!opts.isReflect,
      isLightScreen:    !!opts.isLightScreen,
      isSeeded:         !!opts.isSeeded,
      isHelpingHand:    !!opts.isHelpingHand,
      isCharge:         !!opts.isCharge,
      isMinimized:      !!opts.isMinimized,
      isVictoryStar:    !!opts.isVictoryStar,
      isFriendGuard:    !!opts.isFriendGuard,
      isBattery:        !!opts.isBattery,
      isProtect:        !!opts.isProtect,
      isPowerSpot:      !!opts.isPowerSpot,
      isBusted8:        !!opts.isBusted8,
      isBusted16:       !!opts.isBusted16,
      isSteelySpirit:   !!opts.isSteelySpirit,
      faintedCount:     opts.faintedCount || 0,
      isRuinTablets:    !!opts.isRuinTablets,
      isRuinVessel:     !!opts.isRuinVessel,
      isRuinSword:      !!opts.isRuinSword,
      isRuinBeads:      !!opts.isRuinBeads,
    };
  }

  // Field exposes the methods the calc reads (getWeather, setWeather,
  // clearWeather, getTerrain, getSide). The calc reads `field.getSide(0)`
  // for the *defender* side (mode === "one-vs-one"), so callers should
  // pass the defender's screens/hazards as `defenderSide`.
  //
  // opts: { weather, terrain, defenderSide: {...}, attackerSide: {...} }
  function makeField(opts) {
    opts = opts || {};
    var weather = opts.weather || "";
    var terrain = opts.terrain || "";
    var defSide = makeSide(Object.assign({ weather: weather, terrain: terrain }, opts.defenderSide || {}));
    var atkSide = makeSide(Object.assign({ weather: weather, terrain: terrain }, opts.attackerSide || {}));

    return {
      getWeather:   function () { return weather; },
      setWeather:   function (w) { weather = w; defSide.weather = w; atkSide.weather = w; },
      clearWeather: function () { weather = "";  defSide.weather = "";  atkSide.weather = ""; },
      getTerrain:   function () { return terrain; },
      getSide:      function (i) { return i === 0 ? defSide : atkSide; },
    };
  }

  // ----- exports -----
  root.Factory = {
    calcHP: calcHP,
    calcStat: calcStat,
    natureMult: natureMult,
    makeMove: makeMove,
    makePokemon: makePokemon,
    makeSide: makeSide,
    makeField: makeField,
  };
})(typeof window !== "undefined" ? window : globalThis);
