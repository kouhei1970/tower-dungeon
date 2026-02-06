#!/usr/bin/env node

/**
 * Auto Player - Main Test Runner
 *
 * Launches Puppeteer, injects the game API + debug HUD,
 * disables human input during auto-test, and runs the Bot AI
 * loop with bug detection and progress reporting.
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const BotAI = require('./bot-ai');
const Reporter = require('./reporter');

/* ================================================================== */
/*  CLI argument parsing                                              */
/* ================================================================== */

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {
        maxFloors: 3,
        maxTime: 5 * 60 * 1000,
        headless: true,
        screenshotInterval: 5000,
        verbose: false,
        record: false,
        recordPath: null
    };
    args.forEach(arg => {
        if (arg === '--gui')                options.headless = false;
        else if (arg === '--headless')      options.headless = true;
        else if (arg === '--verbose' || arg === '-v') options.verbose = true;
        else if (arg === '--record')        options.record = true;
        else if (arg.startsWith('--floors='))  options.maxFloors = parseInt(arg.split('=')[1]) || 3;
        else if (arg.startsWith('--time='))    options.maxTime = (parseInt(arg.split('=')[1]) || 300) * 1000;
        else if (arg.startsWith('--screenshot=')) options.screenshotInterval = parseInt(arg.split('=')[1]) * 1000 || 5000;
        else if (arg.startsWith('--record='))  { options.record = true; options.recordPath = arg.split('=')[1]; }
    });
    return options;
}

/* ================================================================== */
/*  Bug detection                                                     */
/* ================================================================== */

class BugDetector {
    constructor() {
        this.lastState = null;
        this.positionHistory = [];
        this.bugs = [];
    }

    detect(state, time, floor) {
        const newBugs = [];

        // 1. Wall clipping
        const gx = Math.floor(state.playerPos.x / state.cellSize);
        const gz = Math.floor(state.playerPos.z / state.cellSize);
        if (state.map[gz] && state.map[gz][gx] === 1) {
            newBugs.push({
                type: 'Wall Clipping',
                severity: 'high',
                description: `Player at (${state.playerPos.x.toFixed(2)}, ${state.playerPos.z.toFixed(2)}) inside wall cell [${gx},${gz}]`,
                time, floor
            });
        }

        // 2. HP / MP overflow
        if (state.game.hp > state.game.maxHp) {
            newBugs.push({ type: 'HP Overflow', severity: 'medium',
                description: `HP ${state.game.hp} > maxHP ${state.game.maxHp}`, time, floor });
        }
        if (state.game.mp > state.game.maxMp + 0.1) {   // +0.1 tolerance for regen rounding
            newBugs.push({ type: 'MP Overflow', severity: 'medium',
                description: `MP ${state.game.mp.toFixed(1)} > maxMP ${state.game.maxMp}`, time, floor });
        }

        // 3. Item count anomaly (items disappearing in bulk)
        if (this.lastState) {
            const prev = this.lastState.items.length;
            const curr = state.items.length;
            if (curr < prev - 1) {
                newBugs.push({ type: 'Item Anomaly', severity: 'medium',
                    description: `Map items dropped from ${prev} to ${curr} in one tick`, time, floor });
            }
        }

        // 4. Position stall (>20 s with < 1 unit movement and NOT in boss fight)
        this.positionHistory.push({ x: state.playerPos.x, z: state.playerPos.z, time });
        if (this.positionHistory.length > 200) this.positionHistory.shift();
        if (this.positionHistory.length >= 200) {
            const first = this.positionHistory[0];
            const last  = this.positionHistory[this.positionHistory.length - 1];
            const dt = last.time - first.time;
            const dd = Math.sqrt(Math.pow(last.x - first.x, 2) + Math.pow(last.z - first.z, 2));
            if (dt > 20000 && dd < 1 && !state.game.bossActive) {
                newBugs.push({ type: 'Potential Infinite Loop', severity: 'high',
                    description: `Player stationary for ${(dt/1000).toFixed(1)}s (moved ${dd.toFixed(2)} units)`,
                    time, floor });
                this.positionHistory = [];
            }
        }

        this.lastState = JSON.parse(JSON.stringify(state));
        this.bugs.push(...newBugs);
        return newBugs;
    }

    getBugs() {
        const unique = [];
        const seen = new Set();
        for (const b of this.bugs) {
            const k = `${b.type}-${b.floor}-${Math.floor(b.time / 10000)}`;
            if (!seen.has(k)) { seen.add(k); unique.push(b); }
        }
        return unique;
    }
}

/* ================================================================== */
/*  Action executor                                                   */
/* ================================================================== */

async function executeAction(page, action) {
    if (!action || action.action === 'none') return;

    switch (action.action) {
        case 'move':
            if (action.keys) {
                await page.evaluate((keys) => {
                    keys.forEach(k => window.gameAPI.pressKey(k));
                }, action.keys);
            }
            break;

        case 'turn':
            await page.evaluate((a) => window.gameAPI.setAngle(a), action.angle);
            break;

        case 'turn_and_move':
            await page.evaluate(({ angle, keys }) => {
                window.gameAPI.setAngle(angle);
                if (keys) keys.forEach(k => window.gameAPI.pressKey(k));
            }, { angle: action.angle, keys: action.keys });
            break;

        case 'attack':
            await page.evaluate(() => window.gameAPI.doAttack());
            break;

        case 'interact':
            await page.evaluate(() => window.gameAPI.doInteract());
            break;

        case 'use_item':
            await page.evaluate((i) => window.gameAPI.useItem(i), action.itemIndex);
            break;
    }
}

/* ================================================================== */
/*  Debug HUD injection  (shown in-game during auto-test)             */
/* ================================================================== */

const DEBUG_HUD_INJECT = `
(function() {
    /* ---------- block all human input ---------- */
    const blocker = (e) => { e.stopPropagation(); e.preventDefault(); };
    document.addEventListener('keydown',  blocker, true);
    document.addEventListener('keyup',    blocker, true);
    document.addEventListener('mousedown', blocker, true);
    document.addEventListener('mouseup',   blocker, true);
    document.addEventListener('mousemove', blocker, true);
    document.addEventListener('click',     blocker, true);
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement) document.exitPointerLock();
    }, true);

    /* ---------- debug overlay ---------- */
    const hud = document.createElement('div');
    hud.id = 'debug-hud';
    hud.style.cssText =
        'position:fixed;top:0;right:0;width:320px;padding:12px;' +
        'background:rgba(0,0,0,0.85);color:#0f0;font:12px monospace;' +
        'z-index:99999;pointer-events:none;border-left:2px solid #0f0;' +
        'border-bottom:2px solid #0f0;white-space:pre-wrap;';
    hud.textContent = 'AUTO-TEST INITIALISING...';
    document.body.appendChild(hud);

    const banner = document.createElement('div');
    banner.style.cssText =
        'position:fixed;top:8px;left:50%;transform:translateX(-50%);' +
        'padding:6px 24px;background:rgba(255,0,0,0.8);color:#fff;' +
        'font:bold 14px monospace;z-index:99999;pointer-events:none;' +
        'border-radius:4px;';
    banner.textContent = 'AUTO-TEST MODE — HUMAN INPUT DISABLED';
    document.body.appendChild(banner);

    window._debugHUD = hud;
})();
`;

/* ================================================================== */
/*  Main test runner                                                  */
/* ================================================================== */

async function runTest(options) {
    const { maxFloors, maxTime, headless, screenshotInterval, verbose, record, recordPath } = options;

    const sep = '='.repeat(60);
    console.log(sep);
    console.log('  Dungeon Tower — Automated Test Run');
    console.log(sep);
    console.log(`  Mode        : ${headless ? 'Headless' : 'GUI (human input blocked)'}`);
    console.log(`  Max Floors  : ${maxFloors}`);
    console.log(`  Max Time    : ${maxTime / 1000}s`);
    console.log(sep);

    /* ---- launch browser ---- */
    const browser = await puppeteer.launch({
        headless: headless ? 'new' : false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,800']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    const gamePath = path.resolve(__dirname, '..', 'index.html');
    await page.goto(`file://${gamePath}`);
    await page.waitForSelector('#start-btn');

    /* ---- inject auto-test infrastructure ---- */
    // 1. Block human input & add debug HUD
    await page.evaluate(DEBUG_HUD_INJECT);

    // 2. Disable pointer lock to prevent focus stealing
    await page.evaluate(() => { window._autoTestMode = true; });

    // 3. Override the game API (the one in index.html may have been set before
    //    the input blocker — re-inject to be safe)
    await page.evaluate(() => {
        window.gameAPI = {
            getState: () => ({
                game: {
                    floor: game.floor, hp: game.hp, maxHp: game.maxHp,
                    mp: game.mp, maxMp: game.maxMp, atk: game.atk,
                    items: [...game.items], hasBossKey: game.hasBossKey,
                    totalKills: game.totalKills, isPlaying: game.isPlaying,
                    bossActive: game.bossActive,
                    comboCount: game.comboCount,
                    shrineUsed: game.shrineUsed,
                    shrineBuff: game.shrineBuff,
                    shieldBuff: game.shieldBuff,
                    torchActive
                },
                playerPos: { x: playerPos.x, z: playerPos.z },
                playerAngle,
                enemies: enemies.filter(e => {
                    const gx = Math.floor(e.mesh.position.x / cellSize);
                    const gz = Math.floor(e.mesh.position.z / cellSize);
                    return mapRevealed[gz] && mapRevealed[gz][gx];
                }).map(e => ({
                    x: e.mesh.position.x, z: e.mesh.position.z,
                    hp: e.hp, maxHp: e.maxHp,
                    type: e.type || 'skeleton'
                })),
                boss: (boss && (() => {
                    const gx = Math.floor(boss.mesh.position.x / cellSize);
                    const gz = Math.floor(boss.mesh.position.z / cellSize);
                    if (!mapRevealed[gz] || !mapRevealed[gz][gx]) return null;
                    return {
                        x: boss.mesh.position.x, z: boss.mesh.position.z,
                        hp: boss.hp, maxHp: boss.maxHp, active: boss.active,
                        type: boss.type || 'guardian',
                        telegraphing: boss.telegraphing || false,
                        telegraphProgress: boss.telegraphing
                            ? Math.min(1, (Date.now() - boss.telegraphStart) / boss.telegraphTime)
                            : 0,
                        stunned: boss.stunned || false,
                        enraged: boss.enraged || false,
                        rotationY: boss.mesh.rotation.y
                    };
                })()) || null,
                items: items.filter(i => {
                    const gx = Math.floor(i.x / cellSize);
                    const gz = Math.floor(i.z / cellSize);
                    return mapRevealed[gz] && mapRevealed[gz][gx];
                }).map(i => ({ x: i.x, z: i.z, type: i.type })),
                doors: doors.map(d => ({ x: d.x, z: d.z, isOpen: d.isOpen })),
                stairs: (stairs && (() => {
                    const gx = Math.floor(stairs.position.x / cellSize);
                    const gz = Math.floor(stairs.position.z / cellSize);
                    if (!mapRevealed[gz] || !mapRevealed[gz][gx]) return null;
                    return { x: stairs.position.x, z: stairs.position.z };
                })()) || null,
                shrine: (shrine && !game.shrineUsed && (() => {
                    const gx = Math.floor(shrine.position.x / cellSize);
                    const gz = Math.floor(shrine.position.z / cellSize);
                    if (!mapRevealed[gz] || !mapRevealed[gz][gx]) return null;
                    return { x: shrine.position.x, z: shrine.position.z };
                })()) || null,
                map, mapSize, cellSize
            }),
            pressKey: (k)   => { keys[k] = true; setTimeout(() => keys[k] = false, 100); },
            doAttack:  ()   => { if (typeof attack   === 'function') attack(); },
            doInteract:()   => { if (typeof interact === 'function') interact(); },
            setAngle:  (a)  => { playerAngle = a; },
            start:     ()   => { if (typeof startGame === 'function') startGame(); },
            useItem:   (s)  => { if (typeof useItem  === 'function') useItem(s - 1); }
        };
    });

    console.log('[init] Game loaded.  Input blocked.  Starting game...');

    /* ---- start page recording if requested ---- */
    let screencastRecorder = null;
    if (record) {
        const videoFile = recordPath ||
            path.resolve(__dirname, '..', `gameplay_${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}.webm`);
        screencastRecorder = await page.screencast({ path: videoFile });
        console.log(`[rec] Recording to: ${videoFile}`);
    }

    // Start
    await page.evaluate(() => window.gameAPI.start());
    await sleep(500);

    /* ---- prepare ---- */
    const bot        = new BotAI();
    const bugDetector = new BugDetector();
    const reporter   = new Reporter(path.resolve(__dirname, '..', 'test-results'));

    const results = {
        startTime: Date.now(), endTime: null,
        floors: [], bugs: [], deaths: 0,
        screenshots: [], actions: 0, stats: {}
    };

    let lastScreenshot = 0;
    let lastFloor      = 1;
    let floorStartTime = Date.now();
    let floorKills     = 0;
    let floorItemsUsed = 0;
    const t0 = Date.now();

    console.log('[loop] Auto-play started');

    /* ==== MAIN LOOP ==== */
    while (Date.now() - t0 < maxTime) {
        try {
            const state = await page.evaluate(() => window.gameAPI.getState());
            const elapsed = Date.now() - t0;

            /* -- game over -- */
            if (state.game.hp <= 0) {
                results.deaths++;
                console.log(`[${sec(elapsed)}] DEATH #${results.deaths}  floor=${state.game.floor}`);
                const ss = await page.screenshot({ encoding: 'base64' });
                results.screenshots.push({ time: elapsed, floor: state.game.floor, image: ss, event: 'death' });
                await page.evaluate(() => window.gameAPI.start());
                await sleep(500);
                bot.resetNavigation();
                bot.lastFloor = 1;
                floorStartTime = Date.now();
                lastFloor = 1;
                continue;
            }

            /* -- floor change -- */
            if (state.game.floor !== lastFloor) {
                const clearTime = Date.now() - floorStartTime;
                const hpPct = Math.round((state.game.hp / state.game.maxHp) * 100);
                results.floors.push({
                    floor: lastFloor, clearTime,
                    enemiesKilled: floorKills, itemsUsed: floorItemsUsed,
                    hpRemaining: hpPct
                });
                console.log(`[${sec(elapsed)}] FLOOR ${lastFloor} CLEARED  time=${(clearTime/1000).toFixed(1)}s  hp=${hpPct}%`);
                const ss = await page.screenshot({ encoding: 'base64' });
                results.screenshots.push({ time: elapsed, floor: lastFloor, image: ss, event: 'floor_clear' });
                lastFloor = state.game.floor;
                floorStartTime = Date.now();
                floorKills = 0;
                floorItemsUsed = 0;
            }

            /* -- victory check -- */
            if (state.game.floor > maxFloors) {
                console.log(`[${sec(elapsed)}] TARGET REACHED — cleared floor ${maxFloors}`);
                break;
            }

            /* -- periodic screenshot -- */
            if (Date.now() - lastScreenshot > screenshotInterval) {
                const ss = await page.screenshot({ encoding: 'base64' });
                results.screenshots.push({ time: elapsed, floor: state.game.floor, image: ss, event: 'periodic' });
                lastScreenshot = Date.now();
            }

            /* -- bug detection -- */
            const newBugs = bugDetector.detect(state, elapsed, state.game.floor);
            for (const b of newBugs) {
                console.log(`[${sec(elapsed)}] BUG  ${b.severity.toUpperCase()}  ${b.type}: ${b.description}`);
            }

            /* -- bot decision + execute + HUD update in single evaluate -- */
            const action = bot.update(state);
            results.actions++;
            const progress = bot.getExplorationProgress();
            const debug = bot.getDebugInfo();

            await page.evaluate(({ action, hud }) => {
                // Execute action
                if (action && action.action !== 'none') {
                    switch (action.action) {
                        case 'move':
                            if (action.keys) action.keys.forEach(k => window.gameAPI.pressKey(k));
                            break;
                        case 'turn':
                            window.gameAPI.setAngle(action.angle);
                            break;
                        case 'turn_and_move':
                            window.gameAPI.setAngle(action.angle);
                            if (action.keys) action.keys.forEach(k => window.gameAPI.pressKey(k));
                            break;
                        case 'attack':
                            window.gameAPI.doAttack();
                            break;
                        case 'interact':
                            window.gameAPI.doInteract();
                            break;
                        case 'use_item':
                            window.gameAPI.useItem(action.itemIndex);
                            break;
                    }
                }
                // Update HUD
                const h = window._debugHUD;
                if (h) {
                    h.textContent =
                        `AUTO-TEST  actions: ${hud.actions}\n` +
                        `──────────────────────────\n` +
                        `Floor   : ${hud.floor}\n` +
                        `Phase   : ${hud.phase}\n` +
                        `Reason  : ${hud.reason}\n` +
                        `HP      : ${hud.hp}/${hud.maxHp}\n` +
                        `MP      : ${hud.mp}/${hud.maxMp}\n` +
                        `Explored: ${hud.explored}%\n` +
                        `BossKey : ${hud.hasBossKey ? 'YES' : 'no'}\n` +
                        `Boss    : ${hud.bossType} HP=${hud.bossHp}\n` +
                        `Telegr  : ${hud.telegraph}\n` +
                        `Enemies : ${hud.enemies}\n` +
                        `Combo   : ${hud.combo}\n` +
                        `Shrine  : ${hud.shrine}\n`;
                }
            }, {
                action,
                hud: {
                    phase: bot.getPhase(),
                    reason: debug.reason || '-',
                    hp: Math.round(state.game.hp), maxHp: state.game.maxHp,
                    mp: Math.round(state.game.mp), maxMp: state.game.maxMp,
                    floor: state.game.floor,
                    explored: progress.percentage,
                    bossHp: state.boss ? `${Math.round(state.boss.hp)}/${state.boss.maxHp}` : 'n/a',
                    hasBossKey: state.game.hasBossKey,
                    enemies: state.enemies.length,
                    actions: results.actions,
                    combo: state.game.comboCount || 0,
                    shrine: state.shrine ? 'available' : (state.game.shrineUsed ? 'used' : 'n/a'),
                    telegraph: state.boss && state.boss.telegraphing
                        ? `${Math.round(state.boss.telegraphProgress * 100)}%`
                        : 'no',
                    bossType: state.boss ? state.boss.type : 'n/a'
                }
            });

            /* -- console progress -- */
            if (verbose && results.actions % 20 === 0) {
                console.log(
                    `[${sec(elapsed)}] ` +
                    `floor=${state.game.floor}  phase=${bot.getPhase()}  ` +
                    `hp=${Math.round(state.game.hp)}/${state.game.maxHp}  ` +
                    `explored=${progress.percentage}%  ` +
                    `stuck=${bot.stuckCounter}  none=${bot.noneCounter}  bl=${bot.blacklistedTargets.size}  ` +
                    `reason="${debug.reason || '-'}"`
                );
                // Dump bot log if there are entries
                while (bot.logLines.length > 0) {
                    console.log(`       [bot] ${bot.logLines.shift()}`);
                }
            }

            await sleep(50);
        } catch (err) {
            console.error(`[error] ${err.message}`);
            await sleep(200);
        }
    }

    /* ---- wrap up ---- */
    results.endTime = Date.now();
    results.bugs = bugDetector.getBugs();
    const totalTime = results.endTime - results.startTime;

    results.stats = {
        difficultyScore: Math.min(100,
            results.deaths * 20 +
            (100 - (results.floors.length > 0
                ? results.floors.reduce((s, f) => s + f.hpRemaining, 0) / results.floors.length
                : 50))),
        itemScore: results.floors.length > 0
            ? Math.min(100, results.floors.reduce((s, f) => s + (f.itemsUsed||0), 0) * 10 + 50)
            : 50,
        pacingScore: results.floors.length > 0
            ? Math.max(0, 100 - results.floors.reduce((s, f) => s + f.clearTime, 0) / results.floors.length / 600)
            : 50
    };

    /* ---- stop recording ---- */
    if (screencastRecorder) {
        await screencastRecorder.stop();
        console.log('[rec] Recording saved.');
    }

    const reportPath = reporter.generateReport(results);

    console.log(sep);
    console.log('  Test Complete');
    console.log(sep);
    console.log(`  Duration     : ${(totalTime/1000).toFixed(1)}s`);
    console.log(`  Floors       : ${lastFloor}`);
    console.log(`  Deaths       : ${results.deaths}`);
    console.log(`  Bugs         : ${results.bugs.length}`);
    console.log(`  Actions      : ${results.actions}`);
    console.log(`  Report       : ${reportPath}`);
    console.log(sep);

    if (results.bugs.length > 0) {
        console.log('\n  Detected bugs:');
        results.bugs.forEach((b, i) =>
            console.log(`    ${i+1}. [${b.severity}] ${b.type} — ${b.description}`));
        console.log('');
    }

    await browser.close();
    return results;
}

/* ================================================================== */
/*  Helpers                                                           */
/* ================================================================== */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function sec(ms)   { return (ms / 1000).toFixed(0).padStart(4) + 's'; }

/* ================================================================== */
/*  Entry point                                                       */
/* ================================================================== */

if (require.main === module) {
    const opts = parseArgs();
    runTest(opts).catch(err => {
        console.error('Test failed:', err);
        process.exit(1);
    });
}

module.exports = { runTest };
