// Team-vs-Set view glue.
// Builds 3 attacker panels + a defender species picker, and renders the damage
// grid (out + in) for every BF set the chosen opp species can run.

(function () {
  "use strict";

  // ---- helpers ----

  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") n.className = attrs[k];
        else if (k === "html") n.innerHTML = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k.startsWith("on") && typeof attrs[k] === "function")
          n.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        else n.setAttribute(k, attrs[k]);
      });
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }

  // Species that have BF sets, sorted alphabetically.
  var BF_SPECIES = Object.keys(setdex).filter(function (s) {
    return Object.keys(setdex[s]).length > 0;
  }).sort();

  var STATUSES = ["Healthy", "Burned", "Paralyzed", "Poisoned", "Badly Poisoned"];
  var STAGE_STATS = [
    { key: "at", label: "Atk" },
    { key: "df", label: "Def" },
    { key: "sa", label: "SpA" },
    { key: "sd", label: "SpD" },
    { key: "sp", label: "Spe" },
  ];

  // Gen 4 BF IV table: round (1..8) -> player draft / opp trainer IV.
  // Source: altissimo battle-factory.html.
  var ROUND_IVS = { 1: 0, 2: 4, 3: 8, 4: 12, 5: 16, 6: 20, 7: 24, 8: 31 };

  // For a given set name, return the BF sets only (skip Hall sets, e.g. "-H").
  function bfSetsFor(species) {
    var entries = setdex[species] || {};
    return Object.keys(entries).filter(function (k) {
      // Hall sets end with "-H" (no parenthetical number); skip them
      return /\([0-9]+\)\s*$/.test(k);
    });
  }

  // ---- type matchup helpers ----

  function computeTypeMatchups(type1, type2) {
    var groups = { quad: [], double: [], half: [], quarter: [], immune: [] };
    Object.keys(typeChart).forEach(function (atkType) {
      var row = typeChart[atkType];
      var m1 = (row[type1] != null) ? row[type1] : 1;
      var m2 = (type2 && type2 !== "" && row[type2] != null) ? row[type2] : 1;
      var mult = m1 * m2;
      if      (mult === 0)   groups.immune.push(atkType);
      else if (mult <= 0.25) groups.quarter.push(atkType);
      else if (mult < 1)     groups.half.push(atkType);
      else if (mult >= 4)    groups.quad.push(atkType);
      else if (mult >= 2)    groups.double.push(atkType);
    });
    return groups;
  }

  function makeTypeMatchupDiv(type1, type2) {
    var g = computeTypeMatchups(type1, type2);
    var children = [];

    function addRow(label, tags) {
      if (tags.length === 0) return;
      children.push(el("span", { class: "label" }, [label]));
      children.push(el("div", { class: "type-matchup-row" }, tags));
    }

    var weakTags = [];
    g.quad.forEach(function (t) {
      weakTags.push(el("span", { class: "type-tag type-tag-quad" }, [t + " ×4"]));
    });
    g.double.forEach(function (t) {
      weakTags.push(el("span", { class: "type-tag type-tag-double" }, [t]));
    });
    addRow("Weak", weakTags);

    var resTags = [];
    g.quarter.forEach(function (t) {
      resTags.push(el("span", { class: "type-tag type-tag-quarter" }, [t + " ¼"]));
    });
    g.half.forEach(function (t) {
      resTags.push(el("span", { class: "type-tag type-tag-half" }, [t]));
    });
    addRow("Resist", resTags);

    addRow("Immune", g.immune.map(function (t) {
      return el("span", { class: "type-tag type-tag-immune" }, [t]);
    }));

    return el("div", { class: "type-matchup" }, children);
  }

  // ---- team coverage ----

  function computeTeamCoverage(teamSlots) {
    var matchups = teamSlots.map(function (slot) {
      var dex = pokedex[slot.species];
      return dex ? computeTypeMatchups(dex.t1, dex.t2 || "") : null;
    });

    var allTypes = Object.keys(typeChart);
    var sharedWeak = [];
    var missingRes = [];

    allTypes.forEach(function (atkType) {
      var weakCount = 0;
      var hasRes    = false;
      matchups.forEach(function (m) {
        if (!m) return;
        if (m.quad.indexOf(atkType) !== -1 || m.double.indexOf(atkType) !== -1) weakCount++;
        if (m.quarter.indexOf(atkType) !== -1 || m.half.indexOf(atkType) !== -1 || m.immune.indexOf(atkType) !== -1) hasRes = true;
      });
      if (weakCount >= 2) sharedWeak.push({ type: atkType, count: weakCount });
      if (!hasRes)        missingRes.push(atkType);
    });

    return { sharedWeak: sharedWeak, missingRes: missingRes };
  }

  function renderTeamCoverage(teamSlots) {
    var box = document.getElementById("team-coverage");
    if (!box) return;

    var valid = teamSlots.filter(function (s) { return s.species && pokedex[s.species]; });
    if (valid.length === 0) { box.style.display = "none"; return; }

    var cov = computeTeamCoverage(teamSlots);
    box.innerHTML = "";

    var body = el("div", { class: "team-coverage-body" });

    // Shared weaknesses column
    var swCol = el("div", { class: "team-coverage-col" });
    swCol.appendChild(el("span", { class: "label" }, ["Shared weakness (2+ mons)"]));
    if (cov.sharedWeak.length === 0) {
      swCol.appendChild(el("div", { class: "type-matchup-row" }, [
        el("span", { class: "type-tag type-tag-ok" }, ["None"]),
      ]));
    } else {
      var swRow = el("div", { class: "type-matchup-row" });
      cov.sharedWeak.forEach(function (sw) {
        var cls = sw.count >= 3 ? "type-tag-shared3" : "type-tag-shared2";
        var tip = sw.count + " of " + teamSlots.length + " mons weak";
        swRow.appendChild(el("span", { class: "type-tag " + cls, title: tip }, [sw.type]));
      });
      swCol.appendChild(swRow);
    }
    body.appendChild(swCol);

    // Uncovered types column
    var mrCol = el("div", { class: "team-coverage-col" });
    mrCol.appendChild(el("span", { class: "label" }, ["No resistance on team"]));
    if (cov.missingRes.length === 0) {
      mrCol.appendChild(el("div", { class: "type-matchup-row" }, [
        el("span", { class: "type-tag type-tag-ok" }, ["All covered"]),
      ]));
    } else {
      var mrRow = el("div", { class: "type-matchup-row" });
      cov.missingRes.forEach(function (t) {
        mrRow.appendChild(el("span", { class: "type-tag type-tag-exposed", title: "No mon resists or is immune" }, [t]));
      });
      mrCol.appendChild(mrRow);
    }
    body.appendChild(mrCol);

    box.appendChild(body);
    box.style.display = "";
  }

  // ---- attacker panel ----

  function makeAttackerPanel(idx) {
    var speciesSelect = el("select");
    var setSelect     = el("select");
    var ivInput       = el("input", { type: "number", min: "0", max: "31", value: "31", class: "iv-inp" });

    var statusSelect = el("select");
    STATUSES.forEach(function (s) {
      statusSelect.appendChild(el("option", { value: s, text: s }));
    });

    var stageInputs = {};
    var stageCells = STAGE_STATS.map(function (ss) {
      var inp = el("input", { type: "number", min: "-6", max: "6", value: "0", class: "stage-inp" });
      stageInputs[ss.key] = inp;
      inp.addEventListener("change", onChange);
      return el("span", { class: "stage-cell" }, [
        el("span", { class: "stage-lbl" }, [ss.label]),
        inp,
      ]);
    });
    var stageRow = el("div", { class: "stage-row" }, stageCells);

    var metaDiv = el("div", { class: "mon-meta" }, []);
    var typeDiv = el("div", { class: "type-matchup" }, []);

    function updateTypeDisplay() {
      var dexEntry = pokedex[speciesSelect.value];
      typeDiv.innerHTML = "";
      if (!dexEntry) return;
      var built = makeTypeMatchupDiv(dexEntry.t1, dexEntry.t2 || "");
      while (built.firstChild) typeDiv.appendChild(built.firstChild);
    }

    var berryUsedChk = el("input", { type: "checkbox" });
    berryUsedChk.addEventListener("change", onChange);
    var berryItemSpan = el("span", null, []);
    var berryRow = el("div", { class: "berry-used-row" }, [
      el("label", null, [berryUsedChk, " ", berryItemSpan, " used"]),
    ]);
    berryRow.style.display = "none";

    function updateBerryRow() {
      var sp = speciesSelect.value;
      var sn = setSelect.value;
      var setEntry = setdex[sp] && setdex[sp][sn];
      var item = (setEntry && setEntry.item) || "";

      var dexEntry = pokedex[sp];
      var nature  = (setEntry && setEntry.nature) || "Hardy";
      var ability = (dexEntry && dexEntry.abilities && dexEntry.abilities.length > 0)
                  ? dexEntry.abilities.join(" / ")
                  : "?";
      metaDiv.textContent = nature + " · " + (item || "no item") + " · " + ability;

      berryUsedChk.checked = false;
      if (getBerryResistType(item) !== "") {
        berryItemSpan.textContent = item;
        berryRow.style.display = "";
      } else {
        berryRow.style.display = "none";
      }
    }

    BF_SPECIES.forEach(function (s) {
      speciesSelect.appendChild(el("option", { value: s, text: s }));
    });

    function refreshSetOptions() {
      var sp = speciesSelect.value;
      setSelect.innerHTML = "";
      bfSetsFor(sp).forEach(function (setName) {
        setSelect.appendChild(el("option", { value: setName, text: setName }));
      });
      updateBerryRow();
      updateTypeDisplay();
    }
    refreshSetOptions();

    speciesSelect.addEventListener("change", function () {
      refreshSetOptions();
      onChange();
    });
    setSelect.addEventListener("change", function () {
      updateBerryRow();
      onChange();
    });
    ivInput.addEventListener("change", onChange);
    statusSelect.addEventListener("change", onChange);

    var card = el("div", { class: "card mon-card" }, [
      el("div", { class: "head", style: "grid-column: 1 / -1" }, [
        el("span", { class: "title" }, ["Mon " + (idx + 1)]),
      ]),
      metaDiv,
      el("span", { class: "label" }, ["Species"]),
      speciesSelect,
      el("span", { class: "label" }, ["Set"]),
      setSelect,
      typeDiv,
      el("span", { class: "label" }, ["IVs"]),
      ivInput,
      el("span", { class: "label" }, ["Status"]),
      statusSelect,
      el("span", { class: "label" }, ["Stages"]),
      stageRow,
      berryRow,
    ]);

    return {
      card: card,
      get: function () {
        return {
          species:   speciesSelect.value,
          setName:   setSelect.value,
          ivs:       parseInt(ivInput.value, 10) || 0,
          status:    statusSelect.value,
          boosts:    STAGE_STATS.reduce(function (acc, ss) {
            acc[ss.key] = parseInt(stageInputs[ss.key].value, 10) || 0;
            return acc;
          }, {}),
          berryUsed: berryUsedChk.checked,
        };
      },
    };
  }

  // Speed indicator: returns a small <span> showing the speed *delta* (yours
  // minus opp's), colored by whether you outspeed. Hover for absolute values.
  function speedBadge(yourSpd, oppSpd) {
    var delta = yourSpd - oppSpd;
    var arrow, cls, sign;
    if (delta > 0)      { arrow = "↑"; cls = "spd-fast"; sign = "+"; }
    else if (delta < 0) { arrow = "↓"; cls = "spd-slow"; sign = "";  }   // negative number already has '-'
    else                { arrow = "="; cls = "spd-tie";  sign = "±"; }
    var title = "Your Spe " + yourSpd + " vs opp Spe " + oppSpd;
    return el("span", { class: "spd", title: title },
              [sign + delta + " ", el("span", { class: cls }, [arrow])]);
  }

  // ---- damage helpers ----

  // Eisencalc returns either {damage, ...} or {damage: [...]} depending on path.
  // damage may be a number, an array of rolls, or an array of two rolls (parental bond).
  function damageRolls(result) {
    if (!result) return null;
    var d = result.damage !== undefined ? result.damage : result;
    if (typeof d === "number") return [d];
    if (!Array.isArray(d)) return null;
    if (d.length === 0) return null;
    // parental bond / multi-strike returns nested arrays sometimes
    if (Array.isArray(d[0])) {
      // sum corresponding rolls — pessimistic enough for matchup vibe
      var hits = d.length;
      var rolls = d[0].slice();
      for (var h = 1; h < hits; h++) {
        for (var i = 0; i < rolls.length; i++) rolls[i] += d[h][i];
      }
      return rolls;
    }
    return d;
  }

  function fmtDamageCell(rolls, defenderHP, moveName) {
    function withName(td) {
      if (!moveName) return td;
      // Prepend the move name in dim text so the cell is self-describing
      td.insertBefore(el("span", { class: "spd" }, [moveName + " "]), td.firstChild);
      return td;
    }
    if (!rolls) return withName(el("td", { class: "num dmg-none" }, ["—"]));
    var min = rolls[0], max = rolls[rolls.length - 1];
    if (max === 0) return withName(el("td", { class: "num dmg-zero" }, ["0"]));
    var minPct = (100 * min / defenderHP);
    var maxPct = (100 * max / defenderHP);
    var label = minPct.toFixed(0) + "–" + maxPct.toFixed(0) + "%";
    var cls = "dmg-some";
    if (min >= defenderHP) cls = "dmg-ohko";
    else if (max >= defenderHP) cls = "dmg-2hko";  // chance to OHKO; treat as warning
    return withName(el("td", { class: "num " + cls, title: min + "-" + max + " HP" }, [label]));
  }

  // ---- render ----

  function readFieldState() {
    return {
      weather: $("#weather-select").value,
      you: {
        isReflect:     $("#your-reflect").checked,
        isLightScreen: $("#your-lscreen").checked,
      },
      opp: {
        isReflect:     $("#opp-reflect").checked,
        isLightScreen: $("#opp-lscreen").checked,
      },
    };
  }
  var fieldState = { weather: "", you: {}, opp: {} };

  function renderResults(team, oppSpecies, oppIvs, oppStatus, oppBoosts, oppSetFilter) {
    var root = document.getElementById("results");
    root.innerHTML = "";


    if (!oppSpecies) {
      root.appendChild(el("p", { class: "results-empty" }, ["Pick an opponent species."]));
      return;
    }
    var oppSets = bfSetsFor(oppSpecies);
    oppSets = oppSets.filter(function (s) { return oppSetFilter.indexOf(s) !== -1; });
    if (oppSets.length === 0) {
      root.appendChild(el("p", { class: "results-empty" }, ["No BF sets found for " + oppSpecies + "."]));
      return;
    }

    // Build attacker POJOs once (used against all opp sets).
    var teamPokes = team.map(function (slot) {
      try {
        return Factory.makePokemon({
          species: slot.species,
          setName: slot.setName,
          ivs:     slot.ivs,
          status:  slot.status,
          boosts:  slot.boosts,
          item:    slot.berryUsed ? "" : undefined,
        });
      } catch (e) { return null; }
    });

    oppSets.forEach(function (oppSetName) {
      var oppPoke;
      try {
        oppPoke = Factory.makePokemon({ species: oppSpecies, setName: oppSetName, ivs: oppIvs, status: oppStatus, boosts: oppBoosts, item: oppBerryUsed[oppSetName] ? "" : undefined });
      } catch (e) {
        root.appendChild(el("div", { class: "card opp-block" }, [
          el("h3", null, [oppSetName]),
          el("p", { class: "bad" }, ["Failed to build opp set: " + e.message]),
        ]));
        return;
      }

      // Field used only for speed lookups (weather affects Chlorophyll etc.);
      // direction-specific Side state isn't read by getFinalSpeed.
      var spdField = Factory.makeField({ weather: fieldState.weather });
      var oppSpd = getFinalSpeed(oppPoke, oppPoke, spdField);
      var teamSpds = teamPokes.map(function (p) {
        return p ? getFinalSpeed(p, oppPoke, spdField) : null;
      });

      var setEntry = setdex[oppSpecies][oppSetName];
      var oppDex = pokedex[oppSpecies];
      var oppAbility = (oppDex && oppDex.abilities && oppDex.abilities.length > 0)
                     ? oppDex.abilities.join(" / ")
                     : "?";
      var meta = (setEntry.nature || "?") + " · " + (setEntry.item || "no item") +
                 " · " + oppAbility;

      var oppBerryControl = null;
      var oppItem = setEntry.item || "";
      if (getBerryResistType(oppItem) !== "") {
        var berryChk = el("input", { type: "checkbox" });
        berryChk.checked = !!oppBerryUsed[oppSetName];
        berryChk.addEventListener("change", function () {
          oppBerryUsed[oppSetName] = berryChk.checked;
          onChange();
        });
        oppBerryControl = el("div", { class: "opp-berry-row" }, [
          el("label", null, [berryChk, " " + oppItem + " used"]),
        ]);
      }

      // Out: your moves into opp set
      var outRows = [];
      teamPokes.forEach(function (att, i) {
        var labelCell = el("td");
        labelCell.appendChild(document.createTextNode(
          (att ? att.name : team[i].species)
        ));
        if (att && teamSpds[i] != null) {
          labelCell.appendChild(speedBadge(teamSpds[i], oppSpd));
        }
        var cells = [labelCell];
        if (!att) {
          for (var c = 0; c < 4; c++) cells.push(el("td", { class: "num dmg-none" }, ["—"]));
        } else {
          // You attacking opp: defender side = opp side
          var f = Factory.makeField({
            weather: fieldState.weather,
            defenderSide: fieldState.opp,
            attackerSide: fieldState.you,
          });
          var results = CALCULATE_MOVES_OF_ATTACKER_PTHGSS(att, oppPoke, f);
          for (var m = 0; m < 4; m++) {
            var moveName = att.moves[m] && att.moves[m].name;
            var rolls = damageRolls(results[m]);
            var cell = fmtDamageCell(rolls, oppPoke.maxHP, moveName);
            cells.push(cell);
          }
        }
        outRows.push(el("tr", null, cells));
      });
      var outTable = el("table", null, [
        el("caption", null, ["Out — your moves into this set"]),
        el("tr", null, [
          el("th", null, ["Your mon"]),
          el("th", null, ["Move 1"]),
          el("th", null, ["Move 2"]),
          el("th", null, ["Move 3"]),
          el("th", null, ["Move 4"]),
        ]),
      ].concat(outRows));

      // In: this opp set's moves into each of your mons
      var inRows = [];
      for (var m = 0; m < 4; m++) {
        var moveName = oppPoke.moves[m] && oppPoke.moves[m].name;
        var cells = [el("td", null, [moveName || "—"])];
        teamPokes.forEach(function (def, i) {
          if (!def) {
            cells.push(el("td", { class: "num dmg-none" }, ["—"]));
          } else {
            // Opp attacking you: defender side = your side
            var att = Factory.makePokemon({ species: oppSpecies, setName: oppSetName, ivs: oppIvs, status: oppStatus, boosts: oppBoosts });
            var f = Factory.makeField({
              weather: fieldState.weather,
              defenderSide: fieldState.you,
              attackerSide: fieldState.opp,
            });
            var results = CALCULATE_MOVES_OF_ATTACKER_PTHGSS(att, def, f);
            cells.push(fmtDamageCell(damageRolls(results[m]), def.maxHP));
          }
        });
        inRows.push(el("tr", null, cells));
      }
      var inHeader = [el("th", null, ["Opp move"])];
      teamPokes.forEach(function (p, i) {
        var th = el("th");
        th.appendChild(document.createTextNode((p ? p.name : "Mon " + (i + 1)) + "-" + (i + 1)));
        if (p && teamSpds[i] != null) {
          th.appendChild(speedBadge(teamSpds[i], oppSpd));
        }
        inHeader.push(th);
      });
      var inTable = el("table", null, [
        el("caption", null, ["In — this set's moves into your team"]),
        el("tr", null, inHeader),
      ].concat(inRows));

      root.appendChild(el("div", { class: "card opp-block" }, [
        el("h3", null, [oppSetName]),
        el("div", { class: "meta" }, [meta]),
        oppBerryControl,
        outTable,
        inTable,
      ]));
    });
  }

  // ---- top-level ----

  var oppBerryUsed = {};  // oppSetName -> boolean; persists across re-renders
  var teamPanels = [];
  var oppStageInputs = {};
  function buildPanels() {
    // Insert the 3 attacker cards as the first 3 children of the layout row
    // (the opponent card is already in the markup as the 4th column).
    var host = document.getElementById("layout-row");
    var oppCard = host.querySelector(".opp-card");
    for (var i = 0; i < 3; i++) {
      var p = makeAttackerPanel(i);
      teamPanels.push(p);
      host.insertBefore(p.card, oppCard);
    }
  }

  function refreshOppSetList() {
    var species = $("#opp-species").value;
    var sets = species ? bfSetsFor(species) : [];
    var container = document.getElementById("opp-set-list");
    container.innerHTML = "";
    if (sets.length === 0) return;

    container.appendChild(el("div", { class: "opp-set-heading" }, ["Show sets"]));

    sets.forEach(function (setName, i) {
      var cid = "opp-set-" + i;
      var cb = el("input", { type: "checkbox", name: "opp-set-filter", value: setName, id: cid });
      cb.checked = true;
      cb.addEventListener("change", onChange);
      container.appendChild(el("label", { class: "opp-set-label", for: cid }, [cb, setName]));
    });
  }

  // Pre-pick a sensible default team for sanity-checking on first load
  function defaultPick() {
    var defaults = ["Latios", "Garchomp", "Heatran"];
    teamPanels.forEach(function (p, i) {
      var sp = defaults[i];
      if (sp && BF_SPECIES.indexOf(sp) !== -1) {
        var sel = p.card.querySelector("select"); // species (first select)
        sel.value = sp;
        sel.dispatchEvent(new Event("change"));
      }
    });
    var oppSp = $("#opp-species");
    if (oppSp.querySelector('option[value="Salamence"]')) oppSp.value = "Salamence";
  }

  function onChange() {
    fieldState = readFieldState();
    var team = teamPanels.map(function (p) { return p.get(); });
    renderTeamCoverage(team);
    var rawOppIvs = parseInt($("#opp-ivs").value, 10);
    var oppIvs = isNaN(rawOppIvs) ? 31 : rawOppIvs;
    var oppStatus = $("#opp-status").value;
    var oppBoosts = STAGE_STATS.reduce(function (acc, ss) {
      acc[ss.key] = parseInt(oppStageInputs[ss.key].value, 10) || 0;
      return acc;
    }, {});
    var oppSetFilter = Array.from(
      document.querySelectorAll('input[name="opp-set-filter"]:checked')
    ).map(function (cb) { return cb.value; });
    renderResults(team, $("#opp-species").value, oppIvs, oppStatus, oppBoosts, oppSetFilter);
  }

  function applyRound() {
    var round = parseInt($("#round-select").value, 10) || 8;
    var iv = ROUND_IVS[round];
    $("#opp-ivs").value = iv;
    teamPanels.forEach(function (p) {
      var ivInput = p.card.querySelector('input[type="number"]');
      if (ivInput) ivInput.value = iv;
    });
    $("#round-iv-hint").textContent = "→ IVs: " + iv;
    onChange();
  }

  function init() {
    buildPanels();

    // Build opponent stage inputs into the static #opp-stage-row placeholder
    STAGE_STATS.forEach(function (ss) {
      var inp = el("input", { type: "number", min: "-6", max: "6", value: "0", class: "stage-inp" });
      oppStageInputs[ss.key] = inp;
      inp.addEventListener("change", onChange);
      document.getElementById("opp-stage-row").appendChild(el("span", { class: "stage-cell" }, [
        el("span", { class: "stage-lbl" }, [ss.label]),
        inp,
      ]));
    });
    $("#opp-status").addEventListener("change", onChange);

    var oppSel = $("#opp-species");
    BF_SPECIES.forEach(function (s) {
      oppSel.appendChild(el("option", { value: s, text: s }));
    });
    oppSel.addEventListener("change", function () {
      oppBerryUsed = {};
      refreshOppSetList();
      onChange();
    });
    $("#opp-ivs").addEventListener("change", onChange);

    // Field state listeners
    ["weather-select", "your-reflect", "your-lscreen", "opp-reflect", "opp-lscreen"].forEach(function (id) {
      document.getElementById(id).addEventListener("change", onChange);
    });
    $("#round-select").addEventListener("change", applyRound);

    defaultPick();
    refreshOppSetList();
    // applyRound also calls onChange and seeds the round-iv hint
    applyRound();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
