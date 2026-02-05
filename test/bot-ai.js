/**
 * Bot AI - Rule-based intelligent agent for dungeon exploration
 *
 * Phases:
 *   get_key   - Locate and collect the boss key
 *   fight_boss - Navigate to boss, activate, and defeat
 *   ascend    - Find stairs and move to next floor
 *   explore   - Wander to discover map when target is unknown
 */

const Pathfinder = require('./pathfinder');

class BotAI {
    constructor() {
        this.state = null;
        this.pathfinder = null;
        this.currentPath = null;
        this.pathTargetX = null;
        this.pathTargetZ = null;
        this.visitedCells = new Set();
        this.lastPosition = null;
        this.stuckCounter = 0;
        this.phase = 'explore';
        this.actionCooldown = 0;
        this.explorationTargets = [];
        this.explorationIndex = 0;
        this.lastFloor = 0;
        this.debugInfo = {};        // exposed for HUD overlay
        this.shrineAttempts = 0;    // prevent shrine interact infinite loop
        this.maxShrineAttempts = 20;
    }

    /**
     * Main entry point: feed new game state, get back an action.
     */
    update(state) {
        this.state = state;

        // Floor changed → reset navigation state
        if (state.game.floor !== this.lastFloor) {
            this.lastFloor = state.game.floor;
            this.resetNavigation();
        }

        // Always use the current map (dungeon regenerates on death/floor change)
        this.pathfinder = new Pathfinder(state.map, state.cellSize);

        // Mark current cell visited
        const g = this.pathfinder.worldToGrid(state.playerPos.x, state.playerPos.z);
        this.visitedCells.add(`${g.x},${g.z}`);

        this.detectStuck(state);
        if (this.actionCooldown > 0) this.actionCooldown--;

        const action = this.decideAction();
        this.debugInfo.action = action;
        return action;
    }

    /* ------------------------------------------------------------------ */
    /*  Navigation helpers                                                */
    /* ------------------------------------------------------------------ */

    resetNavigation() {
        this.currentPath = null;
        this.pathTargetX = null;
        this.pathTargetZ = null;
        this.visitedCells.clear();
        this.explorationTargets = [];
        this.explorationIndex = 0;
        this.stuckCounter = 0;
        this.shrineAttempts = 0;
    }

    detectStuck(state) {
        if (this.lastPosition) {
            const d = this.pathfinder.distance(
                this.lastPosition.x, this.lastPosition.z,
                state.playerPos.x, state.playerPos.z
            );
            this.stuckCounter = d < 0.05 ? this.stuckCounter + 1 : 0;
        }
        this.lastPosition = { x: state.playerPos.x, z: state.playerPos.z };

        // Stuck > 30 ticks (~3 s) → throw away current path & skip exploration target
        if (this.stuckCounter > 30) {
            this.currentPath = null;
            this.pathTargetX = null;
            this.pathTargetZ = null;
            this.explorationIndex++;
            this.stuckCounter = 0;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Decision tree                                                     */
    /* ------------------------------------------------------------------ */

    decideAction() {
        const { game, playerPos, enemies, boss, items, stairs } = this.state;
        const shrine = this.state.shrine;

        // --- nearby enemies: always fight if close (collision blocks movement) ---
        const nearbyEnemy = enemies.find(e => this.distanceTo(e.x, e.z) < 3);

        // Emergency heal
        if (game.hp < game.maxHp * 0.3) {
            const pi = game.items.indexOf('potion');
            if (pi !== -1) {
                this.debugInfo.reason = 'emergency potion';
                return { action: 'use_item', itemIndex: pi + 1 };
            }
        }

        // Use charm (defense buff) when near enemies
        if (nearbyEnemy && game.items.includes('charm') && !game.shieldBuff) {
            const ci = game.items.indexOf('charm');
            this.debugInfo.reason = 'use charm for defense';
            return { action: 'use_item', itemIndex: ci + 1 };
        }

        // Fight nearby enemies (they block movement due to collision)
        if (nearbyEnemy && game.mp >= 5) {
            const targetAngle = this.angleTo(nearbyEnemy.x, nearbyEnemy.z);
            const diff = this.normalizeAngle(targetAngle - this.state.playerAngle);
            if (Math.abs(diff) > 0.2) {
                this.debugInfo.reason = `face ${nearbyEnemy.type || 'enemy'}`;
                return { action: 'turn', angle: targetAngle };
            }
            this.debugInfo.reason = `attack ${nearbyEnemy.type || 'enemy'}`;
            return { action: 'attack' };
        }

        const shrineAvailable = shrine && !game.shrineUsed && this.shrineAttempts < this.maxShrineAttempts;

        // --- Shrine interact if right next to it ---
        if (shrineAvailable) {
            const shrineDist = this.distanceTo(shrine.x, shrine.z);
            if (shrineDist < 1.5) {
                this.shrineAttempts++;
                this.debugInfo.reason = `interact shrine (try ${this.shrineAttempts})`;
                return { action: 'interact' };
            }
        }

        // --- Phase 1: acquire boss key ---
        if (!game.hasBossKey) {
            this.phase = 'get_key';

            const key = items.find(i => i.type === 'key');
            if (key) {
                this.debugInfo.reason = `move to key (${key.x.toFixed(1)},${key.z.toFixed(1)})`;
                return this.moveToward(key.x, key.z);
            }
            this.debugInfo.reason = 'explore for key';
            return this.explore();
        }

        // --- Visit shrine before boss if close enough (< 20 units) ---
        if (shrineAvailable && boss && !boss.active) {
            const shrineDist = this.distanceTo(shrine.x, shrine.z);
            if (shrineDist < 20) {
                this.phase = 'get_shrine';
                this.debugInfo.reason = `move to shrine (dist=${shrineDist.toFixed(1)})`;
                return this.moveToward(shrine.x, shrine.z);
            }
        }

        // --- Phase 2: activate boss ---
        if (boss && !boss.active) {
            this.phase = 'fight_boss';
            const dist = this.distanceTo(boss.x, boss.z);
            if (dist < 5) {
                this.debugInfo.reason = 'interact boss';
                this.actionCooldown = 5;
                return { action: 'interact' };
            }
            this.debugInfo.reason = `move to boss (${boss.x.toFixed(1)},${boss.z.toFixed(1)})`;
            return this.moveToward(boss.x, boss.z);
        }

        // --- Phase 3: fight boss ---
        if (boss && boss.active) {
            this.phase = 'fight_boss';
            return this.fightBoss();
        }

        // --- Phase 4: ascend ---
        if (stairs) {
            this.phase = 'ascend';
            const dist = this.distanceTo(stairs.x, stairs.z);
            if (dist < 1.5) {
                this.debugInfo.reason = `interact stairs (dist=${dist.toFixed(1)})`;
                return { action: 'interact' };
            }
            this.debugInfo.reason = `move to stairs (dist=${dist.toFixed(1)})`;
            return this.moveToward(stairs.x, stairs.z);
        }

        this.phase = 'explore';
        this.debugInfo.reason = 'explore (no objective)';
        return this.explore();
    }

    /* ------------------------------------------------------------------ */
    /*  Boss fight                                                        */
    /* ------------------------------------------------------------------ */

    fightBoss() {
        const { game, boss, playerPos } = this.state;

        // Heal
        if (game.hp < game.maxHp * 0.5) {
            const pi = game.items.indexOf('potion');
            if (pi !== -1) {
                this.debugInfo.reason = 'boss-fight heal';
                return { action: 'use_item', itemIndex: pi + 1 };
            }
        }

        // Use MP potion if low
        if (game.mp < 10 && game.items.includes('mpPotion')) {
            const mi = game.items.indexOf('mpPotion');
            this.debugInfo.reason = 'boss-fight mp potion';
            return { action: 'use_item', itemIndex: mi + 1 };
        }

        // Use charm for defense buff
        if (game.items.includes('charm') && !game.shieldBuff) {
            const ci = game.items.indexOf('charm');
            this.debugInfo.reason = 'boss-fight use charm';
            return { action: 'use_item', itemIndex: ci + 1 };
        }

        // Use shield if available (pre-fight ATK boost)
        if (game.items.includes('shield')) {
            const si = game.items.indexOf('shield');
            this.debugInfo.reason = 'boss-fight use shield';
            return { action: 'use_item', itemIndex: si + 1 };
        }

        const dist = this.distanceTo(boss.x, boss.z);
        const targetAngle = this.angleTo(boss.x, boss.z);

        // TELEGRAPH DODGE: if boss is telegraphing, retreat to distance > 6
        if (boss.telegraphing) {
            if (dist < 7) {
                const awayAngle = targetAngle + Math.PI;
                this.debugInfo.reason = `boss-fight DODGE telegraph (dist=${dist.toFixed(1)})`;
                return {
                    action: 'turn_and_move',
                    angle: awayAngle,
                    keys: ['w']
                };
            }
            // Safe distance — wait out the telegraph
            this.debugInfo.reason = 'boss-fight waiting out telegraph';
            return { action: 'none' };
        }

        // BACKSTAB: if boss is stunned, try to get behind
        if (boss.stunned) {
            // Move to boss's back (opposite of boss facing)
            const bossBackAngle = (boss.rotationY || 0) + Math.PI;
            const behindX = boss.x - Math.sin(bossBackAngle) * 3;
            const behindZ = boss.z - Math.cos(bossBackAngle) * 3;
            const behindDist = this.distanceTo(behindX, behindZ);

            if (behindDist < 1.5 && game.mp >= 5) {
                const faceAngle = this.angleTo(boss.x, boss.z);
                const diff = this.normalizeAngle(faceAngle - this.state.playerAngle);
                if (Math.abs(diff) > 0.2) {
                    this.debugInfo.reason = 'backstab face boss';
                    return { action: 'turn', angle: faceAngle };
                }
                this.debugInfo.reason = 'backstab attack!';
                return { action: 'attack' };
            }
            this.debugInfo.reason = 'move behind stunned boss';
            return this.moveToward(behindX, behindZ);
        }

        // Hit-and-run: attack then retreat to avoid boss damage
        if (game.mp >= 5 && dist < 4) {
            const diff = this.normalizeAngle(targetAngle - this.state.playerAngle);
            if (Math.abs(diff) > 0.2) {
                this.debugInfo.reason = 'boss-fight face boss';
                return { action: 'turn', angle: targetAngle };
            }
            this.debugInfo.reason = 'boss-fight attack';
            return { action: 'attack' };
        }

        // No MP or too far: kite away from boss to regen MP safely
        if (game.mp < 5 && dist < 5) {
            const awayAngle = targetAngle + Math.PI;
            this.debugInfo.reason = `boss-fight retreat (MP=${Math.round(game.mp)})`;
            return {
                action: 'turn_and_move',
                angle: awayAngle,
                keys: ['w']
            };
        }

        // Approach boss
        if (dist >= 4) {
            this.debugInfo.reason = `boss-fight approach (dist=${dist.toFixed(1)})`;
            return this.moveToward(boss.x, boss.z);
        }

        // Close range, waiting for MP — circle strafe
        this.debugInfo.reason = `boss-fight strafe (MP=${Math.round(game.mp)})`;
        return {
            action: 'turn_and_move',
            angle: targetAngle,
            keys: ['a']
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Movement with A* pathfinding                                      */
    /* ------------------------------------------------------------------ */

    moveToward(targetX, targetZ) {
        const { playerPos } = this.state;

        // Only recalculate path when target changed significantly
        const targetChanged =
            this.pathTargetX === null ||
            Math.abs(targetX - this.pathTargetX) > 2 ||
            Math.abs(targetZ - this.pathTargetZ) > 2;

        if (!this.currentPath || targetChanged) {
            this.currentPath = this.pathfinder.findPath(
                playerPos.x, playerPos.z,
                targetX, targetZ
            );
            this.pathTargetX = targetX;
            this.pathTargetZ = targetZ;
        }

        if (!this.currentPath || this.currentPath.length === 0) {
            // Fallback: walk directly (will bump into walls but at least tries)
            return this.walkDirectly(targetX, targetZ);
        }

        // Follow path sequentially
        const next = this.pathfinder.getNextWaypoint(
            this.currentPath, playerPos.x, playerPos.z
        );

        if (!next) {
            this.currentPath = null;
            return this.walkDirectly(targetX, targetZ);
        }

        // Trim already-passed waypoints so the path shrinks over time
        if (next.index > 0) {
            this.currentPath = this.currentPath.slice(next.index);
        }

        return this.walkDirectly(next.waypoint.x, next.waypoint.z);
    }

    /**
     * Turn toward (x,z) and press 'w' in one tick.
     */
    walkDirectly(x, z) {
        const dist = this.distanceTo(x, z);
        if (dist < 0.3) return { action: 'none' };

        return {
            action: 'turn_and_move',
            angle: this.angleTo(x, z),
            keys: ['w']
        };
    }

    /* ------------------------------------------------------------------ */
    /*  Exploration                                                       */
    /* ------------------------------------------------------------------ */

    explore() {
        const { playerPos } = this.state;

        // Rebuild list when exhausted
        if (this.explorationTargets.length === 0 ||
            this.explorationIndex >= this.explorationTargets.length) {

            const raw = this.pathfinder.findUnexploredAreas(this.visitedCells);
            if (raw.length === 0) return this.wander();

            // Sort by distance to player so we explore nearby cells first
            raw.sort((a, b) => {
                const da = Math.pow(a.x - playerPos.x, 2) + Math.pow(a.z - playerPos.z, 2);
                const db = Math.pow(b.x - playerPos.x, 2) + Math.pow(b.z - playerPos.z, 2);
                return da - db;
            });

            this.explorationTargets = raw;
            this.explorationIndex = 0;
        }

        const target = this.explorationTargets[this.explorationIndex];
        if (this.distanceTo(target.x, target.z) < 2) {
            this.explorationIndex++;
        }

        return this.moveToward(target.x, target.z);
    }

    wander() {
        const { mapSize, cellSize } = this.state;
        const rx = (Math.floor(Math.random() * (mapSize - 2)) + 1) * cellSize + cellSize / 2;
        const rz = (Math.floor(Math.random() * (mapSize - 2)) + 1) * cellSize + cellSize / 2;
        return this.moveToward(rx, rz);
    }

    /* ------------------------------------------------------------------ */
    /*  Utility                                                           */
    /* ------------------------------------------------------------------ */

    distanceTo(x, z) {
        const dx = x - this.state.playerPos.x;
        const dz = z - this.state.playerPos.z;
        return Math.sqrt(dx * dx + dz * dz);
    }

    angleTo(x, z) {
        return Math.atan2(
            x - this.state.playerPos.x,
            z - this.state.playerPos.z
        );
    }

    normalizeAngle(a) {
        while (a > Math.PI) a -= Math.PI * 2;
        while (a < -Math.PI) a += Math.PI * 2;
        return a;
    }

    getPhase() { return this.phase; }

    getDebugInfo() { return this.debugInfo; }

    getExplorationProgress() {
        if (!this.state) return { visited: 0, total: 0, percentage: 0 };
        // Count only walkable cells, not walls
        let walkable = 0;
        for (let z = 0; z < this.state.mapSize; z++)
            for (let x = 0; x < this.state.mapSize; x++)
                if (this.state.map[z][x] === 0) walkable++;
        return {
            visited: this.visitedCells.size,
            total: walkable,
            percentage: walkable > 0 ? Math.round((this.visitedCells.size / walkable) * 100) : 0
        };
    }
}

module.exports = BotAI;
