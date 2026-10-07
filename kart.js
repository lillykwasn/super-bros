// =====================================================
// KART RACING MODE  (loaded after index.html's main script)
//
// The road is a long list of short segments. Every frame each segment is
// projected from 3D onto the screen, nearest first, which gives the classic
// "behind the kart" racing view. Curves bend the road sideways and hills
// move it up and down.
//
// Uses things defined in index.html: ctx, W, H, keys, tick, audio, muted,
// CHARACTERS, BRO_TOP, BRO_LEGS, PEACH_TOP, PEACH_LEGS, sounds, tone, melody,
// playSong, stopMusic, SONGS, track, drawCloud, outlinedText, goToMenu
// =====================================================
const Kart = (() => {
    const DT = 1 / 60;
    const SEGMENT_LENGTH = 200;
    const RUMBLE_LENGTH = 3;          // segments per red/white rumble stripe
    const ROAD_WIDTH = 2000;          // half the road's width, in world units
    const CAMERA_HEIGHT = 1000;
    const DRAW_DISTANCE = 200;        // how many segments ahead we draw
    const CAMERA_DEPTH = 1 / Math.tan((100 / 2) * Math.PI / 180); // 100° field of view
    const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH; // how far in front of the camera the kart sits

    const MAX_SPEED = SEGMENT_LENGTH / DT;
    const ACCEL = MAX_SPEED / 5;
    const BRAKING = -MAX_SPEED;
    const DECEL = -MAX_SPEED / 5;
    const OFFROAD_DECEL = -MAX_SPEED / 2;
    const OFFROAD_LIMIT = MAX_SPEED / 4;
    const CENTRIFUGAL = 0.2;          // how hard curves push you outwards

    const SPRITE_SCALE = 0.25 / 64;   // a 64px-wide kart covers a quarter of the road's half-width
    const KART_W = 0.25;
    const LAPS = 3;
    const POINTS = [10, 8, 6, 4, 2, 1];
    const ITEMS = ["mushroom", "banana", "shell", "star"];

    // ---------- small helpers ----------
    const lerp = (a, b, p) => a + (b - a) * p;
    const easeIn = (a, b, p) => a + (b - a) * p * p;
    const easeInOut = (a, b, p) => a + (b - a) * (-Math.cos(p * Math.PI) / 2 + 0.5);
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const wrapZ = (z, L) => ((z % L) + L) % L;
    // how far a is ahead of b around the loop (negative = behind)
    function zDiff(a, b, L) {
        const d = wrapZ(a - b, L);
        return d > L / 2 ? d - L : d;
    }
    function makeCanvas(w, h, paint) {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        paint(c.getContext("2d"));
        return c;
    }
    function shade(hex, amount) {
        const n = parseInt(hex.slice(1), 16);
        const part = shift => clamp(((n >> shift) & 255) + amount, 0, 255);
        return `rgb(${part(16)},${part(8)},${part(0)})`;
    }
    const ordinal = n => n + (["th", "st", "nd", "rd"][n] || "th");
    function formatTime(frames) {
        const s = frames / 60;
        return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`;
    }
    function ellipse(c, x, y, rx, ry) {
        c.beginPath();
        c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
        c.fill();
    }
    function starPath(c, cx, cy, outer, inner) {
        c.beginPath();
        for (let i = 0; i < 10; i++) {
            const r = i % 2 ? inner : outer;
            const a = -Math.PI / 2 + i * Math.PI / 5;
            c.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        c.closePath();
    }

    // =====================================================
    // RACERS
    // =====================================================
    // two extra drivers so there are six karts on the grid
    const EXTRA_RACERS = [
        { name: "Wario", stats: [4, 2], top: BRO_TOP, legs: BRO_LEGS,
          colors: { R: "#f2c12e", S: "#fcb68b", B: "#3a2a1a", O: "#7b2fa8", Y: "#2fa84f", K: "#111" } },
        { name: "Daisy", stats: [3, 4], top: PEACH_TOP, legs: PEACH_LEGS,
          colors: { Y: "#ffd23f", H: "#9a5a2a", S: "#fcd5b0", K: "#111", P: "#ff9f1a", D: "#e07b00", G: "#2fa84f", B: "#c46a00" } },
    ];
    const KART_COLORS = { Mario: "#e52521", Luigi: "#2fa84f", Toad: "#2048d8", Peach: "#ff7eb6", Wario: "#f2c12e", Daisy: "#ff9f1a" };

    // the driver's head and shoulders sticking out of a kart, seen from behind
    function makeKartSprite(ch) {
        const color = KART_COLORS[ch.name];
        return makeCanvas(64, 44, c => {
            ch.top.slice(0, 9).forEach((row, ry) => {
                for (let rx = 0; rx < row.length; rx++) {
                    const col = ch.colors[row[rx]];
                    if (!col) continue;
                    c.fillStyle = col;
                    c.fillRect(14 + rx * 3, ry * 3, 3, 3);
                }
            });
            c.fillStyle = shade(color, -50);
            c.fillRect(10, 20, 44, 6);              // seat back
            c.fillStyle = color;
            c.fillRect(6, 24, 52, 14);              // body
            c.fillStyle = shade(color, -40);
            c.fillRect(6, 34, 52, 4);
            c.fillStyle = "#fff";                   // number plate with the driver's initial
            ellipse(c, 32, 30, 6, 5);
            c.fillStyle = color;
            c.font = "bold 9px monospace";
            c.textAlign = "center";
            c.fillText(ch.name[0], 32, 33);
            c.fillStyle = "#111";                   // big rear wheels
            c.fillRect(0, 26, 12, 18);
            c.fillRect(52, 26, 12, 18);
            c.fillStyle = "#444";
            for (let y = 28; y < 44; y += 4) { c.fillRect(0, y, 12, 1); c.fillRect(52, y, 12, 1); }
            c.fillStyle = "#aaa";                   // exhaust pipes
            c.fillRect(20, 38, 6, 4);
            c.fillRect(38, 38, 6, 4);
        });
    }

    function newRacer(ch, gridSlot, isPlayer, L) {
        const row = Math.floor(gridSlot / 2);
        return {
            ch, isPlayer,
            name: ch.name,
            kartColor: KART_COLORS[ch.name],
            sprite: makeKartSprite(ch),
            topSpeed: 1 + (ch.stats[0] - 3) * 0.025,
            handling: 1 + (ch.stats[1] - 3) * 0.07,
            skill: 0.88 + Math.random() * 0.07,
            rubber: 1,
            z: wrapZ(-(row + 1) * SEGMENT_LENGTH * 4, L), // lined up behind the start line
            offset: gridSlot % 2 ? 0.45 : -0.45,
            speed: 0, lap: -1, place: gridSlot + 1, finished: false,
            spin: 0, boost: 0, star: 0, fall: 0, tilt: 0,
            item: null, roll: 0, pendingItem: null, itemTimer: 0, coins: 0,
            targetOffset: gridSlot % 2 ? 0.45 : -0.45, retarget: 60,
        };
    }

    // =====================================================
    // SPRITES (drawn once, then scaled)
    // =====================================================
    const SPR = {};
    function paintMushroom(c) {
        c.fillStyle = "#f5deb3";
        c.fillRect(9, 16, 14, 13);
        c.fillStyle = "#111";
        c.fillRect(12, 19, 2, 5);
        c.fillRect(18, 19, 2, 5);
        c.fillStyle = "#e52521";
        c.beginPath();
        c.arc(16, 17, 15, Math.PI, 0);
        c.fill();
        c.fillStyle = "#fff";
        ellipse(c, 9, 11, 3.5, 3.5);
        ellipse(c, 23, 11, 3.5, 3.5);
        ellipse(c, 16, 6, 3, 3);
    }
    function paintBanana(c) {
        c.strokeStyle = "#ffd23f";
        c.lineWidth = 8;
        c.lineCap = "round";
        c.beginPath();
        c.arc(16, 4, 20, Math.PI * 0.25, Math.PI * 0.75);
        c.stroke();
        c.strokeStyle = "#e0a800";
        c.lineWidth = 2;
        c.beginPath();
        c.arc(16, 4, 23, Math.PI * 0.3, Math.PI * 0.7);
        c.stroke();
        c.fillStyle = "#6b3a12";
        c.fillRect(27, 14, 4, 4);
        c.fillRect(1, 14, 4, 4);
    }
    function paintShell(c) {
        c.fillStyle = "#fff";
        ellipse(c, 16, 17, 15, 10);
        c.fillStyle = "#2fa84f";
        ellipse(c, 16, 13, 13, 10);
        c.strokeStyle = "#1b6b2e";
        c.lineWidth = 2;
        c.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3;
            c.lineTo(16 + Math.cos(a) * 5, 13 + Math.sin(a) * 4);
        }
        c.closePath();
        c.stroke();
    }
    function buildSprites() {
        if (SPR.tree) return;
        SPR.tree = makeCanvas(80, 120, c => {
            c.fillStyle = "#6b3a12";
            c.fillRect(34, 76, 12, 44);
            c.fillStyle = "#1f7a2a";
            ellipse(c, 40, 52, 38, 36);
            c.fillStyle = "#2e9e3a";
            ellipse(c, 28, 44, 22, 22);
            ellipse(c, 54, 48, 22, 22);
            ellipse(c, 40, 26, 22, 20);
            c.fillStyle = "#5fcf5f";
            ellipse(c, 32, 30, 8, 8);
        });
        SPR.bush = makeCanvas(70, 36, c => {
            c.fillStyle = "#2e8b2e";
            ellipse(c, 18, 26, 16, 14);
            ellipse(c, 36, 20, 20, 18);
            ellipse(c, 54, 26, 16, 14);
            c.fillRect(2, 26, 66, 10);
        });
        SPR.pillar = makeCanvas(40, 150, c => {
            c.fillStyle = "#3d3842";
            c.fillRect(6, 30, 28, 120);
            c.fillStyle = "#2a262e";
            for (let y = 40; y < 150; y += 18) c.fillRect(6, y, 28, 2);
            c.fillStyle = "#57515c";
            c.fillRect(2, 24, 36, 8);
            c.fillStyle = "#ff7a1a";
            ellipse(c, 20, 13, 9, 13);
            c.fillStyle = "#ffd23f";
            ellipse(c, 20, 17, 4, 7);
        });
        SPR.floatStar = makeCanvas(40, 40, c => {
            c.fillStyle = "#ffe066";
            starPath(c, 20, 20, 19, 8);
            c.fill();
        });
        SPR.box = makeCanvas(40, 40, c => {
            c.fillStyle = "rgba(120,200,255,0.6)";
            c.fillRect(2, 2, 36, 36);
            c.strokeStyle = "#fff";
            c.lineWidth = 3;
            c.strokeRect(2, 2, 36, 36);
            c.fillStyle = "#fff";
            c.font = "bold 26px monospace";
            c.textAlign = "center";
            c.fillText("?", 20, 30);
        });
        SPR.coin = makeCanvas(24, 32, c => {
            c.fillStyle = "#ffcc00";
            ellipse(c, 12, 16, 10, 14);
            c.strokeStyle = "#b8860b";
            c.lineWidth = 2;
            c.stroke();
            c.fillStyle = "#fff6b0";
            c.fillRect(10, 8, 4, 16);
        });
        SPR.mushroom = makeCanvas(32, 32, paintMushroom);
        SPR.banana = makeCanvas(32, 32, paintBanana);
        SPR.shell = makeCanvas(32, 28, paintShell);
        SPR.star = makeCanvas(32, 32, c => {
            c.fillStyle = "#ffd23f";
            c.strokeStyle = "#c77800";
            c.lineWidth = 2;
            starPath(c, 16, 16, 15, 6.5);
            c.fill();
            c.stroke();
            c.fillStyle = "#111";
            c.fillRect(12, 13, 2, 5);
            c.fillRect(18, 13, 2, 5);
        });
        // start / finish arch that spans the road
        SPR.arch = makeCanvas(620, 240, c => {
            c.fillStyle = "#d8d8d8";
            c.fillRect(0, 40, 30, 200);
            c.fillRect(590, 40, 30, 200);
            for (let x = 0; x < 620; x += 20) {
                for (let y = 0; y < 50; y += 25) {
                    c.fillStyle = (x / 20 + y / 25) % 2 ? "#111" : "#fff";
                    c.fillRect(x, y, 20, 25);
                }
            }
            c.fillStyle = "#e52521";
            c.fillRect(230, 5, 160, 40);
            c.fillStyle = "#fff";
            c.font = "bold 28px monospace";
            c.textAlign = "center";
            c.fillText("FINISH", 310, 36);
        });
    }

    // =====================================================
    // TRACKS
    // layout rows are [length, curve, hill]: each piece eases in, holds,
    // then eases out over `length` segments. Positive curve = bends right.
    // =====================================================
    const RAINBOW_SONG = { bpm: 170, tracks: [
        track("square", 0.03, "C5 E5 G5 C6 B5 G5 E5 G5 | A5 F5 D5 F5 G5 E5 C5 E5 | F5 A5 C6 F5 E5 G5 C6 E5 | D5 F5 B5 D5 C5 ~ ~ -"),
        track("sine", 0.025, "C6 G6 E6 G6 C6 G6 E6 G6 | F6 C6 A5 C6 G6 D6 B5 D6 | F6 C6 A5 C6 E6 C6 G5 C6 | D6 B5 G5 B5 C6 - - -"),
        track("triangle", 0.1, "C3 C3 G2 G2 A2 A2 E2 E2 | F2 F2 C3 C3 G2 G2 G2 G2 | F2 F2 F2 F2 C3 C3 C3 C3 | G2 G2 G2 G2 C3 - - -"),
    ]};

    const TRACK_DEFS = [
        {
            name: "Mushroom Meadow", short: "MEADOW", theme: "meadow", offroad: "slow",
            song: { bpm: 175, tracks: SONGS.overworld.tracks },
            layout: [[25, 0, 0], [50, 0, 0], [40, 3, 0], [25, 0, 20], [40, -3, 0], [30, 0, -20], [50, 2, 30],
                     [25, 0, 0], [40, -4, 0], [30, 3, -20], [40, 0, 0], [40, -3, 20], [30, 4, -30], [40, 0, 0]],
        },
        {
            name: "Lava Fortress", short: "LAVA", theme: "lava", offroad: "fall",
            song: { bpm: 150, tracks: SONGS.castle.tracks },
            layout: [[30, 0, 0], [40, 4, 0], [20, 0, -20], [40, -4, 20], [30, 3, 0], [30, -3, 0], [40, 0, 40],
                     [40, 4, -40], [25, 0, 0], [40, -4, 20], [30, 3, -20], [40, -2, 0], [40, 0, 0]],
        },
        {
            name: "Rainbow Road", short: "RAINBOW", theme: "rainbow", offroad: "fall",
            song: RAINBOW_SONG,
            layout: [[30, 0, 0], [50, 2, 60], [40, -3, -60], [30, 0, 40], [50, 3, -40], [40, -3, 30],
                     [30, 0, -30], [50, 2, 50], [40, -4, -50], [30, 3, 0], [40, 0, 0]],
        },
    ];

    const builtTracks = [];
    function getTrack(i) {
        if (!builtTracks[i]) builtTracks[i] = buildTrack(TRACK_DEFS[i]);
        return builtTracks[i];
    }

    function buildTrack(def) {
        buildSprites();
        const segments = [];
        const lastY = () => segments.length ? segments[segments.length - 1].p2.world.y : 0;
        function addSegment(curve, y) {
            const n = segments.length;
            segments.push({
                index: n,
                p1: { world: { y: lastY(), z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
                p2: { world: { y, z: (n + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
                curve, decor: [], clip: 0,
            });
        }
        function addRoad(enter, hold, leave, curve, hill) {
            const startY = lastY(), endY = startY + hill * SEGMENT_LENGTH, total = enter + hold + leave;
            for (let n = 0; n < enter; n++) addSegment(easeIn(0, curve, n / enter), easeInOut(startY, endY, n / total));
            for (let n = 0; n < hold; n++) addSegment(curve, easeInOut(startY, endY, (enter + n) / total));
            for (let n = 0; n < leave; n++) addSegment(easeInOut(curve, 0, n / leave), easeInOut(startY, endY, (enter + hold + n) / total));
        }
        for (const [len, curve, hill] of def.layout) addRoad(len, len, len, curve, hill);
        addRoad(30, 30, 30, 0, -lastY() / SEGMENT_LENGTH); // come back down so the loop joins up

        // scenery beside the road
        const side = () => Math.random() < 0.5 ? -1 : 1;
        for (let i = 10; i < segments.length - 10; i++) {
            const seg = segments[i];
            if (def.theme === "meadow") {
                if (i % 12 === 0) seg.decor.push({ img: SPR.tree, offset: side() * (1.5 + Math.random() * 1.5) });
                if (i % 7 === 3) seg.decor.push({ img: SPR.bush, offset: side() * (1.25 + Math.random()) });
            } else if (def.theme === "lava") {
                if (i % 16 === 0) seg.decor.push({ img: SPR.pillar, offset: -1.35 }, { img: SPR.pillar, offset: 1.35 });
            } else if (i % 25 === 0) {
                seg.decor.push({ img: SPR.floatStar, offset: (i % 50 ? -1 : 1) * 1.8, lift: 1500 });
            }
        }
        segments[2].decor.push({ img: SPR.arch, offset: 0 });

        // item boxes in rows across the road, and lines of coins
        const boxes = [], coins = [];
        for (const f of [0.18, 0.5, 0.8]) {
            const z = Math.floor(segments.length * f) * SEGMENT_LENGTH + SEGMENT_LENGTH / 2;
            for (const offset of [-0.6, -0.2, 0.2, 0.6]) boxes.push({ z, offset, hidden: 0 });
        }
        for (const f of [0.32, 0.64, 0.9]) {
            const start = Math.floor(segments.length * f);
            const offset = (Math.random() - 0.5) * 1.0;
            for (let k = 0; k < 5; k++) coins.push({ z: (start + k * 3) * SEGMENT_LENGTH + 100, offset, taken: 0 });
        }

        return { def, segments, length: segments.length * SEGMENT_LENGTH, boxes, coins };
    }

    const findSegment = (t, z) => t.segments[Math.floor(wrapZ(z, t.length) / SEGMENT_LENGTH) % t.segments.length];

    // =====================================================
    // RACE STATE
    // =====================================================
    let T = null;                       // current track
    let racers = [], standings = [], me = null;
    let bananas = [], shells = [];
    let phase = "off";                  // "countdown" | "racing" | "results" | "trophy"
    let timer = 0, raceTime = 0, finishCount = 0;
    let cup = null;
    let results = [];
    let banner = null;
    let raceSong = null, finalSong = null;
    let skyOffset = 0, hillOffset = 0;
    let bumpCooldown = 0;

    const progress = r => r.lap * T.length + r.z;

    function start(entryIndex, ch) {
        buildSprites();
        const trackList = entryIndex === 0 ? [0, 1, 2] : [entryIndex - 1];
        const everyone = CHARACTERS.concat(EXTRA_RACERS);
        const roster = [ch, ...everyone.filter(c => c !== ch)].slice(0, 6);
        cup = { tracks: trackList, race: 0, roster, points: Object.fromEntries(roster.map(c => [c.name, 0])) };
        startRace();
    }

    function startRace() {
        T = getTrack(cup.tracks[cup.race]);
        for (const b of T.boxes) b.hidden = 0;
        for (const c of T.coins) c.taken = 0;

        // you start 5th on the grid
        const ai = cup.roster.slice(1);
        const grid = [ai[0], ai[1], ai[2], ai[3], cup.roster[0], ai[4]];
        racers = grid.map((c, i) => newRacer(c, i, c === cup.roster[0], T.length));
        me = racers.find(r => r.isPlayer);
        standings = racers.slice();

        bananas = [];
        shells = [];
        phase = "countdown";
        timer = 240;
        raceTime = 0;
        finishCount = 0;
        banner = null;
        skyOffset = hillOffset = 0;
        raceSong = T.def.song;
        finalSong = { ...raceSong, bpm: raceSong.bpm * 1.15 };
        stopMusic();
    }

    function currentSong() {
        if (me.star > 0) return SONGS.star;
        return me.lap >= LAPS - 1 ? finalSong : raceSong;
    }

    // =====================================================
    // ITEMS
    // =====================================================
    function giveItem(r) {
        if (r.item || r.roll) return;
        // racers at the back get better items
        const table = r.place <= 2 ? [["banana", 4], ["shell", 4], ["mushroom", 2]]
            : r.place <= 4 ? [["banana", 2], ["shell", 3], ["mushroom", 4], ["star", 1]]
            : [["mushroom", 4], ["shell", 2], ["star", 3]];
        let roll = Math.random() * table.reduce((sum, [, w]) => sum + w, 0);
        let item = table[0][0];
        for (const [name, weight] of table) {
            if ((roll -= weight) < 0) { item = name; break; }
        }
        if (r.isPlayer) {
            r.roll = 50; // spin the item roulette first
            r.pendingItem = item;
            tone("square", 880, 1320, 0.15, 0.08);
        } else {
            r.item = item;
            r.itemTimer = 60 + Math.random() * 180;
        }
    }

    function useItem(r) {
        const item = r.item;
        r.item = null;
        const loud = r.isPlayer || Math.abs(zDiff(r.z, me.z, T.length)) < SEGMENT_LENGTH * 15;
        if (item === "mushroom") {
            r.boost = 90;
            if (loud) tone("sawtooth", 150, 700, 0.5, 0.08);
        } else if (item === "star") {
            r.star = 420;
            if (r.isPlayer) { sounds.powerup(); playSong(SONGS.star); }
        } else if (item === "banana") {
            bananas.push({ z: wrapZ(r.z - SEGMENT_LENGTH * 3, T.length), offset: r.offset });
            if (loud) tone("triangle", 300, 180, 0.12, 0.15);
        } else if (item === "shell") {
            shells.push({ z: wrapZ(r.z + SEGMENT_LENGTH * 2, T.length), offset: r.offset, speed: MAX_SPEED * 1.7, owner: r, life: 240 });
            if (loud) tone("square", 900, 400, 0.15, 0.1);
        }
    }

    // spin a racer out (bananas, shells, star bumps)
    function hit(r) {
        if (r.star > 0 || r.spin > 0 || r.fall > 0) return false;
        r.spin = 60;
        r.speed *= 0.35;
        r.boost = 0;
        if (r.isPlayer) r.coins = Math.max(0, r.coins - 2);
        if (r.isPlayer || Math.abs(zDiff(r.z, me.z, T.length)) < SEGMENT_LENGTH * 15) tone("square", 700, 120, 0.5, 0.1);
        return true;
    }

    // =====================================================
    // UPDATE
    // =====================================================
    function topSpeed(r) {
        let top = MAX_SPEED * r.topSpeed * (1 + r.coins * 0.01);
        if (!r.isPlayer) top *= r.skill * r.rubber;
        if (r.boost > 0) top *= 1.35;
        if (r.star > 0) top *= 1.12;
        return top;
    }

    function move(r) {
        const old = r.z;
        r.z = wrapZ(r.z + r.speed * DT, T.length);
        if (r.z < old - T.length / 2) { // crossed the finish line
            r.lap++;
            onLap(r);
        }
    }

    function onLap(r) {
        if (r.lap >= LAPS && !r.finished) {
            r.finished = true;
            r.place = ++finishCount;
            if (r.isPlayer) {
                timer = 0;
                stopMusic();
                sounds.win();
                banner = { text: `FINISH!  ${ordinal(r.place)}`, timer: 9999 };
            }
            return;
        }
        if (!r.isPlayer || r.lap < 1) return;
        if (r.lap === LAPS - 1) {
            banner = { text: "FINAL LAP!", timer: 120 };
            melody([659, 784, 1047, 1319], 0.1);
            if (!r.star) playSong(finalSong);
        } else {
            banner = { text: `LAP ${r.lap + 1}`, timer: 80 };
            tone("square", 880, 880, 0.2, 0.08);
        }
    }

    function tickTimers(r) {
        if (r.boost > 0) r.boost--;
        if (r.star > 0 && --r.star === 0 && r.isPlayer && !r.finished) playSong(currentSong());
        if (r.roll > 0) {
            r.roll--;
            if (r.roll % 5 === 0) tone("square", 1200, 1200, 0.03, 0.05);
            if (r.roll === 0) r.item = r.pendingItem;
        }
    }

    function updatePlayer(p) {
        tickTimers(p);
        if (p.fall > 0) { // dropped off the track — wait, then get put back on the road
            if (--p.fall === 0) { p.offset = 0; p.speed = 0; }
            return;
        }

        const seg = findSegment(T, p.z);
        const top = topSpeed(p);
        const speedPct = p.speed / MAX_SPEED;
        const dx = DT * 2 * speedPct * p.handling;
        let steer = 0;

        if (p.finished) {
            // cruise along after the finish line
            p.offset = lerp(p.offset, 0, 0.02);
            p.speed = lerp(p.speed, MAX_SPEED * 0.5, 0.02);
        } else if (p.spin > 0) {
            p.spin--;
            p.speed = Math.max(0, p.speed + DECEL * 1.5 * DT);
        } else {
            if (keys["ArrowLeft"] || keys["KeyA"]) { p.offset -= dx; steer = -1; }
            if (keys["ArrowRight"] || keys["KeyD"]) { p.offset += dx; steer = 1; }
            const brake = keys["ArrowDown"] || keys["KeyS"] || keys["KeyZ"];
            // on phones the gas is always on, so you only need to steer
            const gas = keys["ArrowUp"] || keys["KeyW"] || keys["KeyX"] || (touchMode && !brake);
            if (gas) p.speed += ACCEL * DT;
            else if (brake) p.speed += BRAKING * DT;
            else p.speed += DECEL * DT;
            if (p.boost > 0) p.speed = top;
            if (p.speed > top) p.speed = Math.max(top, p.speed + DECEL * DT); // slow down gently after a boost
        }

        // curves push you towards the outside
        p.offset -= dx * speedPct * seg.curve * CENTRIFUGAL;
        p.tilt = lerp(p.tilt, steer * 0.08, 0.2);

        // off the road
        if (Math.abs(p.offset) > 1 && !p.finished) {
            if (T.def.offroad === "fall" && Math.abs(p.offset) > 1.15) {
                p.fall = 70;
                p.spin = 0;
                p.boost = 0;
                if (T.def.theme === "lava") sounds.sizzle(); else sounds.fall();
                banner = { text: "OOPS!", timer: 70 };
                return;
            }
            if (T.def.offroad === "slow" && p.speed > OFFROAD_LIMIT && !p.boost && !p.star) p.speed += OFFROAD_DECEL * DT;
        }
        p.offset = clamp(p.offset, -2.2, 2.2);
        p.speed = clamp(p.speed, 0, Math.max(top, p.speed));

        const oldZ = p.z;
        move(p);

        // scroll the background as the road curves
        const travelled = wrapZ(p.z - oldZ, T.length) / SEGMENT_LENGTH;
        skyOffset = (skyOffset + 0.001 * seg.curve * travelled + 1) % 1;
        hillOffset = (hillOffset + 0.002 * seg.curve * travelled + 1) % 1;
    }

    function updateAI(a) {
        tickTimers(a);
        const seg = findSegment(T, a.z);

        // rubber banding keeps the race close
        const gap = progress(me) - progress(a);
        a.rubber = gap > SEGMENT_LENGTH * 150 ? 1.2
            : gap > SEGMENT_LENGTH * 40 ? 1.1
            : gap < -SEGMENT_LENGTH * 60 ? 0.92 : 1;

        if (a.spin > 0) {
            a.spin--;
            a.speed = Math.max(0, a.speed + DECEL * 1.5 * DT);
        } else {
            const top = topSpeed(a);
            if (a.boost > 0) a.speed = top;
            else if (a.speed < top) a.speed = Math.min(top, a.speed + ACCEL * 0.9 * DT);
            else a.speed = Math.max(top, a.speed + DECEL * DT);
        }

        // wander between lanes, hug the inside of curves, and dodge bananas
        if (--a.retarget <= 0) {
            a.targetOffset = (Math.random() - 0.5) * 1.2;
            a.retarget = 90 + Math.random() * 150;
        }
        let target = a.targetOffset + seg.curve * 0.05;
        for (const b of bananas) {
            const d = zDiff(b.z, a.z, T.length);
            if (d > 0 && d < SEGMENT_LENGTH * 10 && Math.abs(b.offset - target) < 0.3) {
                target = b.offset > 0 ? b.offset - 0.45 : b.offset + 0.45;
            }
        }
        const before = a.offset;
        a.offset = clamp(a.offset + (target - a.offset) * 0.04, -0.85, 0.85);
        a.tilt = lerp(a.tilt, clamp((a.offset - before) * 40, -1, 1) * 0.08, 0.2);

        if (a.item && --a.itemTimer <= 0) useItem(a);
        move(a);
    }

    const near = (r, o, width) =>
        Math.abs(zDiff(r.z, o.z, T.length)) < SEGMENT_LENGTH * 0.6 && Math.abs(r.offset - o.offset) < width;

    function updatePickupsAndHazards() {
        for (const b of T.boxes) if (b.hidden > 0) b.hidden--;
        for (const c of T.coins) if (c.taken > 0) c.taken--;

        for (const r of racers) {
            if (r.fall) continue;
            for (const b of T.boxes) {
                if (!b.hidden && near(r, b, 0.2)) {
                    b.hidden = 120;
                    giveItem(r);
                }
            }
            if (r.isPlayer) {
                for (const c of T.coins) {
                    if (!c.taken && near(r, c, 0.18)) {
                        c.taken = 600;
                        if (r.coins < 10) r.coins++;
                        sounds.coin();
                    }
                }
            }
            for (let i = bananas.length - 1; i >= 0; i--) {
                if (near(r, bananas[i], 0.18)) {
                    bananas.splice(i, 1);
                    hit(r);
                }
            }
        }

        // shells fly forward along the track and knock over whoever they touch
        for (let i = shells.length - 1; i >= 0; i--) {
            const s = shells[i];
            const travel = s.speed * DT;
            const oldZ = s.z;
            s.z = wrapZ(s.z + travel, T.length);
            let gone = --s.life <= 0;
            for (const r of racers) {
                if (gone || r.fall || (r === s.owner && s.life > 200)) continue;
                const d = zDiff(r.z, oldZ, T.length);
                if (d > -120 && d < travel + 120 && Math.abs(r.offset - s.offset) < 0.22) {
                    hit(r);
                    gone = true;
                }
            }
            for (let j = bananas.length - 1; j >= 0 && !gone; j--) {
                if (near(s, bananas[j], 0.2)) { bananas.splice(j, 1); gone = true; }
            }
            if (gone) shells.splice(i, 1);
        }
    }

    // karts bump into each other (and a star knocks others flying)
    function updateCollisions() {
        if (bumpCooldown > 0) bumpCooldown--;
        for (let i = 0; i < racers.length; i++) {
            for (let j = i + 1; j < racers.length; j++) {
                const a = racers[i], b = racers[j];
                if (a.fall || b.fall) continue;
                const d = zDiff(a.z, b.z, T.length);
                if (Math.abs(d) > SEGMENT_LENGTH * 0.8 || Math.abs(a.offset - b.offset) > KART_W * 0.9) continue;
                if (a.star && !b.star) { hit(b); continue; }
                if (b.star && !a.star) { hit(a); continue; }
                const push = a.offset < b.offset ? -0.06 : 0.06;
                a.offset += push;
                b.offset -= push;
                if (!a.isPlayer && !b.isPlayer) continue; // computer karts just nudge each other aside
                const [front, back] = d > 0 ? [a, b] : [b, a];
                if (back.speed > front.speed) back.speed = front.speed * 0.95;
                if (bumpCooldown === 0) {
                    tone("triangle", 160, 60, 0.12, 0.3);
                    bumpCooldown = 20;
                }
            }
        }
    }

    function updatePlaces() {
        standings = racers.slice().sort((a, b) => {
            if (a.finished && b.finished) return a.place - b.place;
            if (a.finished) return -1;
            if (b.finished) return 1;
            return progress(b) - progress(a);
        });
        standings.forEach((r, i) => { if (!r.finished) r.place = i + 1; });
    }

    function showResults() {
        updatePlaces();
        phase = "results";
        results = standings.map((r, i) => ({ r, pts: POINTS[i] }));
        for (const x of results) cup.points[x.r.name] += x.pts;
        stopMusic();
    }

    function finalStandings() {
        return cup.roster.slice().sort((a, b) => cup.points[b.name] - cup.points[a.name]);
    }

    function update() {
        updateEngine();
        if (phase === "results" || phase === "trophy") return;

        if (phase === "countdown") {
            timer--;
            if (timer > 0 && timer <= 180 && timer % 60 === 0) tone("square", 440, 440, 0.25, 0.1);
            if (timer === 0) {
                tone("square", 880, 880, 0.5, 0.12);
                phase = "racing";
                banner = { text: "GO!", timer: 50 };
                playSong(raceSong);
            }
            return;
        }

        if (!me.finished) raceTime++;
        for (const r of racers) r.isPlayer ? updatePlayer(r) : updateAI(r);
        updatePickupsAndHazards();
        updateCollisions();
        updatePlaces();
        if (banner && --banner.timer <= 0) banner = null;
        if (me.finished && ++timer > 210) showResults();
    }

    // engine hum that rises with your speed
    let engine = null;
    function updateEngine() {
        if (!audio) return;
        if (!engine) {
            const osc = audio.createOscillator();
            osc.type = "sawtooth";
            const filter = audio.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.value = 500;
            const gain = audio.createGain();
            gain.gain.value = 0;
            osc.connect(filter).connect(gain).connect(audio.destination);
            osc.start();
            engine = { osc, gain };
        }
        const pct = me ? me.speed / MAX_SPEED : 0;
        const quiet = muted || phase === "results" || phase === "trophy" || phase === "off" || (me && me.fall);
        engine.osc.frequency.setTargetAtTime(55 + pct * 110, audio.currentTime, 0.05);
        engine.gain.gain.setTargetAtTime(quiet ? 0 : 0.03, audio.currentTime, 0.1);
    }

    function stop() {
        phase = "off";
        if (engine) {
            engine.osc.stop();
            engine = null;
        }
        stopMusic();
    }

    function keydown(code) {
        if (phase === "racing" && code === "Space" && me.item && !me.finished && !me.fall && !me.spin) useItem(me);
        if (code !== "Enter" && code !== "Space") return;
        if (phase === "results") {
            cup.race++;
            if (cup.race < cup.tracks.length) {
                startRace();
            } else {
                phase = "trophy";
                const place = finalStandings().indexOf(me.ch) + 1;
                if (place <= 3) sounds.win(); else sounds.die();
            }
        } else if (phase === "trophy") {
            stop();
            goToMenu();
        }
    }

    // =====================================================
    // DRAWING
    // =====================================================
    function project(p, camX, camY, camZ) {
        p.camera.x = -camX;
        p.camera.y = p.world.y - camY;
        p.camera.z = p.world.z - camZ;
        p.screen.scale = CAMERA_DEPTH / p.camera.z;
        p.screen.x = Math.round(W / 2 + p.screen.scale * p.camera.x * W / 2);
        p.screen.y = Math.round(H / 2 - p.screen.scale * p.camera.y * H / 2);
        p.screen.w = Math.round(p.screen.scale * ROAD_WIDTH * W / 2);
    }

    function quad(x1, y1, x2, y2, x3, y3, x4, y4, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.lineTo(x3, y3);
        ctx.lineTo(x4, y4);
        ctx.closePath();
        ctx.fill();
    }

    function segColors(t, seg) {
        const light = Math.floor(seg.index / RUMBLE_LENGTH) % 2 === 0;
        if (t.def.theme === "meadow") {
            return light ? { grass: "#10aa10", rumble: "#fff", road: "#6b6b6b", lane: "#ddd" }
                         : { grass: "#009a00", rumble: "#d42a2a", road: "#666" };
        }
        if (t.def.theme === "lava") {
            return light ? { grass: "#e04e00", rumble: "#ffb300", road: "#4f4a55", lane: "#77727d" }
                         : { grass: "#c43a00", rumble: "#2a2630", road: "#48434e" };
        }
        // rainbow road: no ground at all, just stars underneath
        return { rumble: light ? "#fff" : "#ffe066", road: `hsl(${(seg.index * 6) % 360}, 85%, ${light ? 60 : 54}%)` };
    }

    function drawSegment(t, seg) {
        const p1 = seg.p1.screen, p2 = seg.p2.screen;
        const c = segColors(t, seg);
        if (c.grass) {
            ctx.fillStyle = c.grass;
            ctx.fillRect(0, p2.y, W, p1.y - p2.y);
        }
        const r1 = p1.w / 6, r2 = p2.w / 6;
        quad(p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, c.rumble);
        quad(p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, c.rumble);

        if (seg.index < 3) { // checkered start / finish line
            for (let col = 0; col < 8; col++) {
                const a1 = p1.x - p1.w + col * p1.w / 4, a2 = p2.x - p2.w + col * p2.w / 4;
                quad(a1, p1.y, a1 + p1.w / 4, p1.y, a2 + p2.w / 4, p2.y, a2, p2.y, (col + seg.index) % 2 ? "#fff" : "#111");
            }
            return;
        }
        quad(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, c.road);

        if (c.lane) {
            const l1 = p1.w / 32, l2 = p2.w / 32;
            for (let lane = 1; lane < 3; lane++) {
                const x1 = p1.x - p1.w + lane * p1.w * 2 / 3, x2 = p2.x - p2.w + lane * p2.w * 2 / 3;
                quad(x1 - l1 / 2, p1.y, x1 + l1 / 2, p1.y, x2 + l2 / 2, p2.y, x2 - l2 / 2, p2.y, c.lane);
            }
        }
    }

    const wrapX = (x, span, offset) => ((x % span) + span) % span - offset;
    const STARS = Array.from({ length: 140 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: Math.random() * 1.8 + 0.4 }));

    function drawSky(theme) {
        const horizon = H / 2;
        if (theme === "meadow") {
            const sky = ctx.createLinearGradient(0, 0, 0, horizon);
            sky.addColorStop(0, "#4aa8ff");
            sky.addColorStop(1, "#cdeeff");
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, W, H);
            for (let i = 0; i < 5; i++) {
                drawCloud(wrapX(i * 190 - skyOffset * W * 2, W + 200, 100), 40 + (i % 3) * 28, 0.9 + (i % 2) * 0.4);
            }
            for (let i = 0; i < 7; i++) { // far hills
                ctx.fillStyle = "#6fbf5f";
                ctx.beginPath();
                ctx.arc(wrapX(i * 160 - hillOffset * W * 2, W + 320, 160), horizon + 40, 120, Math.PI, 0);
                ctx.fill();
            }
            for (let i = 0; i < 5; i++) { // near hills
                ctx.fillStyle = "#4c9f45";
                ctx.beginPath();
                ctx.arc(wrapX(i * 230 + 80 - hillOffset * W * 3, W + 300, 150), horizon + 30, 80, Math.PI, 0);
                ctx.fill();
            }
        } else if (theme === "lava") {
            const sky = ctx.createLinearGradient(0, 0, 0, horizon);
            sky.addColorStop(0, "#120203");
            sky.addColorStop(1, "#6a1a05");
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, W, H);
            for (let i = 0; i < 4; i++) { // volcanoes with glowing tops
                const x = wrapX(i * 260 - hillOffset * W * 2, W + 400, 200);
                ctx.fillStyle = "#2a0a06";
                ctx.beginPath();
                ctx.moveTo(x - 160, horizon + 20);
                ctx.lineTo(x - 30, horizon - 110);
                ctx.lineTo(x + 30, horizon - 110);
                ctx.lineTo(x + 160, horizon + 20);
                ctx.fill();
                ctx.fillStyle = "#ff5a00";
                ctx.fillRect(x - 30, horizon - 114, 60, 6);
            }
            ctx.fillStyle = "#ff8c1a"; // drifting embers
            for (let i = 0; i < 30; i++) {
                const x = (i * 97 + tick * (0.3 + (i % 3) * 0.2)) % W;
                const y = horizon - ((tick * 0.8 + i * 53) % horizon);
                ctx.fillRect(x, y, 2, 2);
            }
        } else {
            const sky = ctx.createLinearGradient(0, 0, 0, H);
            sky.addColorStop(0, "#02010a");
            sky.addColorStop(1, "#1b0b45");
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, W, H);
            for (const s of STARS) {
                ctx.fillStyle = `rgba(255,255,255,${0.5 + 0.5 * Math.sin(tick * 0.05 + s.x)})`;
                ctx.fillRect(wrapX(s.x - skyOffset * W * 3, W, 0), s.y, s.r, s.r);
            }
            const px = wrapX(620 - skyOffset * W, W + 300, 150);
            ctx.fillStyle = "#6a4cff";
            ctx.beginPath();
            ctx.arc(px, 90, 45, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = "rgba(255,200,255,0.7)";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.ellipse(px, 90, 75, 14, -0.3, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // draw a scaled sprite standing on the road, cut off below `clipY` (so hills hide things)
    function drawSprite(img, scale, x, y, clipY) {
        const w = img.width * scale * W / 2 * SPRITE_SCALE * ROAD_WIDTH;
        const h = img.height * scale * W / 2 * SPRITE_SCALE * ROAD_WIDTH;
        if (w < 1) return;
        const left = x - w / 2, top = y - h;
        const clipH = Math.max(0, top + h - clipY);
        if (clipH >= h) return;
        ctx.drawImage(img, 0, 0, img.width, img.height - img.height * clipH / h, left, top, w, h - clipH);
    }

    function drawRacer(r, scale, x, y, clipY) {
        const img = r.sprite;
        const w = img.width * scale * W / 2 * SPRITE_SCALE * ROAD_WIDTH;
        const h = img.height * scale * W / 2 * SPRITE_SCALE * ROAD_WIDTH;
        if (w < 2) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, W, clipY);
        ctx.clip();
        if (r.isPlayer && phase === "racing") {
            const bumpy = Math.abs(r.offset) > 1 ? 4 : 1.5;
            y += Math.sin(tick * 0.9) * (r.speed / MAX_SPEED) * bumpy;
        }
        ctx.translate(x, y);
        if (r.fall) { // tumble off the edge
            const f = r.fall / 70;
            ctx.translate(0, (1 - f) * 140);
            ctx.scale(f, f);
        }
        ctx.rotate(r.tilt);
        if (r.spin && Math.floor(r.spin / 5) % 2) ctx.scale(-1, 1);
        if (r.star && Math.floor(tick / 3) % 2) ctx.globalAlpha = 0.65;
        ctx.drawImage(img, -w / 2, -h, w, h);
        ctx.globalAlpha = 1;

        if (r.boost) { // flames out of the exhaust
            ctx.fillStyle = tick % 4 < 2 ? "#ffb300" : "#ff5a00";
            for (const side of [-1, 1]) {
                const fx = side * w * 0.14;
                ctx.beginPath();
                ctx.moveTo(fx - w * 0.06, -h * 0.08);
                ctx.lineTo(fx + w * 0.06, -h * 0.08);
                ctx.lineTo(fx, -h * 0.08 + h * (0.3 + Math.random() * 0.15));
                ctx.fill();
            }
        }
        if (r.star) { // rainbow sparkles spinning around the kart
            for (let k = 0; k < 4; k++) {
                const a = tick * 0.2 + k * Math.PI / 2;
                ctx.fillStyle = `hsl(${(tick * 20 + k * 90) % 360}, 100%, 60%)`;
                ctx.fillRect(Math.cos(a) * w * 0.55, -h / 2 + Math.sin(a) * h * 0.5, w * 0.06, w * 0.06);
            }
        }
        ctx.restore();
    }

    function collectDynamic(t) {
        const map = new Map();
        const add = (z, d) => {
            const wz = wrapZ(z, t.length);
            const idx = Math.floor(wz / SEGMENT_LENGTH) % t.segments.length;
            d.pct = (wz % SEGMENT_LENGTH) / SEGMENT_LENGTH;
            if (!map.has(idx)) map.set(idx, []);
            map.get(idx).push(d);
        };
        for (const b of t.boxes) if (!b.hidden) add(b.z, { img: SPR.box, offset: b.offset, lift: 250 + Math.sin(tick * 0.1 + b.offset * 5) * 80 });
        for (const c of t.coins) if (!c.taken) add(c.z, { img: SPR.coin, offset: c.offset, lift: 120 });
        for (const b of bananas) add(b.z, { img: SPR.banana, offset: b.offset });
        for (const s of shells) add(s.z, { img: SPR.shell, offset: s.offset });
        for (const r of racers) add(r.z, { racer: r, offset: r.offset });
        return map;
    }

    function drawThing(seg, d, pct) {
        const scale = lerp(seg.p1.screen.scale, seg.p2.screen.scale, pct);
        const x = lerp(seg.p1.screen.x, seg.p2.screen.x, pct) + scale * d.offset * ROAD_WIDTH * W / 2;
        const y = lerp(seg.p1.screen.y, seg.p2.screen.y, pct) - (d.lift || 0) * scale * H / 2;
        if (d.racer) drawRacer(d.racer, scale, x, y, seg.clip);
        else drawSprite(d.img, scale, x, y, seg.clip);
    }

    function renderTrack(t, camZ, camX, live) {
        ctx.imageSmoothingEnabled = false;
        const segs = t.segments, n = segs.length;
        const baseSeg = findSegment(t, camZ);
        const basePercent = (wrapZ(camZ, t.length) % SEGMENT_LENGTH) / SEGMENT_LENGTH;
        const playerSeg = findSegment(t, camZ + PLAYER_Z);
        const playerPercent = (wrapZ(camZ + PLAYER_Z, t.length) % SEGMENT_LENGTH) / SEGMENT_LENGTH;
        const playerY = lerp(playerSeg.p1.world.y, playerSeg.p2.world.y, playerPercent);
        camZ = wrapZ(camZ, t.length);

        drawSky(t.def.theme);

        // road: near to far, each segment only drawn where it peeks over the ones in front
        let maxY = H, x = 0, dx = -(baseSeg.curve * basePercent);
        for (let i = 0; i < DRAW_DISTANCE; i++) {
            const seg = segs[(baseSeg.index + i) % n];
            const cz = camZ - (seg.index < baseSeg.index ? t.length : 0);
            project(seg.p1, camX * ROAD_WIDTH - x, playerY + CAMERA_HEIGHT, cz);
            project(seg.p2, camX * ROAD_WIDTH - x - dx, playerY + CAMERA_HEIGHT, cz);
            x += dx;
            dx += seg.curve;
            seg.clip = maxY;
            if (seg.p1.camera.z <= CAMERA_DEPTH || seg.p2.screen.y >= seg.p1.screen.y || seg.p2.screen.y >= maxY) continue;
            drawSegment(t, seg);
            maxY = seg.p1.screen.y;
        }

        // scenery, items and karts: far to near so closer things cover farther ones
        const dynamic = live ? collectDynamic(t) : new Map();
        for (let i = DRAW_DISTANCE - 1; i > 0; i--) {
            const seg = segs[(baseSeg.index + i) % n];
            if (seg.p1.camera.z <= CAMERA_DEPTH) continue;
            for (const d of seg.decor) drawThing(seg, d, 0);
            const list = dynamic.get(seg.index);
            if (list) {
                list.sort((a, b) => b.pct - a.pct);
                for (const d of list) drawThing(seg, d, d.pct);
            }
        }
    }

    const PLACE_COLORS = ["#ffd23f", "#d8dde3", "#e0954a"];

    function drawHud() {
        ctx.textAlign = "left";
        ctx.lineWidth = 4;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.fillStyle = "#fff";
        ctx.font = "bold 22px monospace";
        outlinedText(`LAP ${clamp(me.lap + 1, 1, LAPS)}/${LAPS}`, 16, 32);
        ctx.font = "bold 15px monospace";
        outlinedText(formatTime(raceTime), 16, 54);

        // who's where
        ctx.font = "bold 13px monospace";
        ctx.lineWidth = 3;
        standings.forEach((r, i) => {
            const y = 84 + i * 20;
            ctx.fillStyle = r.kartColor;
            ctx.fillRect(16, y - 10, 11, 11);
            ctx.fillStyle = r.isPlayer ? "#ffd23f" : "#fff";
            outlinedText(`${i + 1} ${r.name}`, 33, y);
        });

        // item slot (with a spinning roulette while you wait)
        const sx = W / 2 - 32, sy = 10;
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(sx, sy, 64, 64);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 3;
        ctx.strokeRect(sx, sy, 64, 64);
        const icon = me.roll > 0 ? ITEMS[Math.floor(tick / 4) % ITEMS.length] : me.item;
        if (icon) ctx.drawImage(SPR[icon], sx + 10, sy + 10, 44, 44);
        if (me.item && phase === "racing") {
            ctx.font = "bold 11px monospace";
            ctx.textAlign = "center";
            ctx.fillStyle = "#fff";
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(0,0,0,0.7)";
            outlinedText("SPACE", W / 2, sy + 78);
        }

        // race position
        ctx.textAlign = "right";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(0,0,0,0.7)";
        ctx.font = "bold 46px monospace";
        ctx.fillStyle = PLACE_COLORS[me.place - 1] || "#fff";
        outlinedText(ordinal(me.place), W - 18, 54);

        // coins and speed
        ctx.lineWidth = 4;
        ctx.font = "bold 18px monospace";
        ctx.fillStyle = "#fff";
        outlinedText(`${Math.round(me.speed / MAX_SPEED * 120)} km/h`, W - 18, H - 20);
        ctx.textAlign = "left";
        ctx.drawImage(SPR.coin, 16, H - 44, 18, 24);
        outlinedText(`× ${me.coins}`, 40, H - 24);

        ctx.textAlign = "center";
        if (phase === "countdown") {
            ctx.font = "bold 20px monospace";
            outlinedText(`RACE ${cup.race + 1}/${cup.tracks.length}  ·  ${T.def.name.toUpperCase()}`, W / 2, 120);
            if (timer <= 180) {
                ctx.font = "bold 80px monospace";
                ctx.lineWidth = 8;
                ctx.fillStyle = "#ffd23f";
                outlinedText(String(Math.ceil(timer / 60)), W / 2, 220);
            }
            ctx.font = "13px monospace";
            ctx.lineWidth = 3;
            ctx.fillStyle = "#fff";
            outlinedText(touchMode
                ? "Steer with ◀ ▶  ·  gas is automatic  ·  BRAKE and ITEM on the right"
                : "↑ gas   ↓ brake   ←/→ steer   Space use item   Esc menu", W / 2, H - 60);
        }
        if (banner) {
            ctx.font = "bold 48px monospace";
            ctx.lineWidth = 7;
            ctx.fillStyle = banner.text === "OOPS!" ? "#ff6b6b" : "#ffd23f";
            outlinedText(banner.text, W / 2, 200);
        }
        ctx.textAlign = "left";
    }

    function drawResults() {
        ctx.fillStyle = "rgba(0,0,0,0.7)";
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffd23f";
        ctx.font = "bold 26px monospace";
        ctx.fillText(`RACE ${cup.race + 1}/${cup.tracks.length} RESULTS`, W / 2, 50);
        ctx.fillStyle = "#ccc";
        ctx.font = "14px monospace";
        ctx.fillText(T.def.name, W / 2, 74);

        ctx.font = "bold 14px monospace";
        ctx.fillStyle = "#aaa";
        ctx.textAlign = "left";
        ctx.fillText("PLACE", 190, 110);
        ctx.fillText("RACER", 290, 110);
        ctx.textAlign = "right";
        ctx.fillText("POINTS", 520, 110);
        ctx.fillText("TOTAL", 610, 110);

        results.forEach(({ r, pts }, i) => {
            const y = 145 + i * 38;
            if (r.isPlayer) {
                ctx.fillStyle = "rgba(255,210,63,0.2)";
                ctx.fillRect(170, y - 26, 460, 36);
            }
            ctx.font = "bold 20px monospace";
            ctx.textAlign = "left";
            ctx.fillStyle = PLACE_COLORS[i] || "#fff";
            ctx.fillText(ordinal(i + 1), 190, y);
            ctx.fillStyle = r.kartColor;
            ctx.fillRect(290, y - 15, 14, 14);
            ctx.fillStyle = r.isPlayer ? "#ffd23f" : "#fff";
            ctx.fillText(r.name, 312, y);
            ctx.textAlign = "right";
            ctx.fillStyle = "#7CFC9A";
            ctx.fillText("+" + pts, 520, y);
            ctx.fillStyle = "#fff";
            ctx.fillText(String(cup.points[r.name]), 610, y);
        });

        ctx.textAlign = "center";
        ctx.font = "15px monospace";
        ctx.fillStyle = "#fff";
        const last = cup.race + 1 >= cup.tracks.length;
        const press = touchMode ? "Tap" : "Press Enter";
        ctx.fillText(last ? `${press} for the trophy ceremony` : `${press} for the next race`, W / 2, H - 22);
        ctx.textAlign = "left";
    }

    function drawTrophyCup(cx, cy, color) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(cx - 50, cy - 60);
        ctx.lineTo(cx + 50, cy - 60);
        ctx.quadraticCurveTo(cx + 48, cy + 10, cx, cy + 20);
        ctx.quadraticCurveTo(cx - 48, cy + 10, cx - 50, cy - 60);
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(cx - 50, cy - 35, 18, Math.PI * 0.5, Math.PI * 1.5);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx + 50, cy - 35, 18, -Math.PI * 0.5, Math.PI * 0.5);
        ctx.stroke();
        ctx.fillRect(cx - 8, cy + 18, 16, 28);
        ctx.fillRect(cx - 36, cy + 44, 72, 14);
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillRect(cx - 32, cy - 52, 8, 40);
        ctx.fillStyle = "#fff";
        starPath(ctx, cx, cy - 25, 14, 6);
        ctx.fill();
    }

    function drawTrophy() {
        ctx.fillStyle = "rgba(0,0,0,0.75)";
        ctx.fillRect(0, 0, W, H);
        const order = finalStandings();
        const place = order.indexOf(me.ch) + 1;

        ctx.textAlign = "center";
        ctx.fillStyle = "#ffd23f";
        ctx.font = "bold 30px monospace";
        ctx.fillText(cup.tracks.length > 1 ? "CUP COMPLETE!" : "RACE COMPLETE!", W / 2, 50);

        if (place <= 3) {
            const color = ["#ffd23f", "#d8dde3", "#e0954a"][place - 1];
            drawTrophyCup(250, 220, color);
            ctx.fillStyle = color;
            ctx.font = "bold 22px monospace";
            ctx.fillText(`${["GOLD", "SILVER", "BRONZE"][place - 1]} TROPHY!`, 250, 320);
        } else {
            ctx.fillStyle = "#fff";
            ctx.font = "bold 22px monospace";
            ctx.fillText(`You came ${ordinal(place)}`, 250, 200);
            ctx.font = "16px monospace";
            ctx.fillText("Grab more items and try again!", 250, 230);
        }

        // final points table
        ctx.textAlign = "left";
        ctx.font = "bold 16px monospace";
        order.forEach((c, i) => {
            const y = 110 + i * 34;
            const isMe = c === me.ch;
            if (isMe) {
                ctx.fillStyle = "rgba(255,210,63,0.2)";
                ctx.fillRect(450, y - 22, 280, 32);
            }
            ctx.fillStyle = PLACE_COLORS[i] || "#fff";
            ctx.fillText(ordinal(i + 1), 465, y);
            ctx.fillStyle = KART_COLORS[c.name];
            ctx.fillRect(520, y - 13, 12, 12);
            ctx.fillStyle = isMe ? "#ffd23f" : "#fff";
            ctx.fillText(c.name, 540, y);
            ctx.textAlign = "right";
            ctx.fillText(cup.points[c.name] + " pts", 715, y);
            ctx.textAlign = "left";
        });

        ctx.textAlign = "center";
        ctx.fillStyle = "#fff";
        ctx.font = "15px monospace";
        ctx.fillText(`${touchMode ? "Tap" : "Press Enter"} to return to the menu`, W / 2, H - 22);
        ctx.textAlign = "left";
    }

    function draw() {
        renderTrack(T, me.z - PLAYER_Z, me.offset, true);
        drawHud();
        if (phase === "results") drawResults();
        if (phase === "trophy") drawTrophy();
    }

    // menu background: fly down the selected track
    function drawPreview(entryIndex) {
        const t = getTrack(entryIndex === 0 ? 0 : entryIndex - 1);
        renderTrack(t, tick * 100, 0, false);
    }

    return {
        entries: [
            { title: "FULL CUP", subtitle: "All 3 tracks" },
            ...TRACK_DEFS.map(d => ({ title: d.short, subtitle: d.name })),
        ],
        start, update, draw, keydown, stop, drawPreview,
    };
})();
