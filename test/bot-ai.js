/**
 * Bot AI - Rule-based intelligent agent for dungeon exploration
 *
 * Phases:
 *   get_key    - Locate and collect the boss key
 *   fight_boss - Navigate to boss, activate, and defeat
 *   ascend     - Find stairs and move to next floor
 *   explore    - DFS exploration to discover map when target is unknown
 *   pickup_item - Collect a visible item
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
        this.blacklistedTargets = new Set();
        this.lastPosition = null;
        this.stuckCounter = 0;
        this.noneCounter = 0;
        this.phase = 'explore';
        this.actionCooldown = 0;
        this.committedTarget = null;   // DFS: committed exploration target
        this.lastFloor = 0;
        this.debugInfo = {};
        this.shrineAttempts = 0;
        this.maxShrineAttempts = 20;
        this.logLines = [];
    }

    log(msg) {
        this.logLines.push(msg);
        if (this.logLines.length > 50) this.logLines.shift();
    }

    update(state) {
        this.state = state;

        if (state.game.floor !== this.lastFloor) {
            this.lastFloor = state.game.floor;
            this.resetNavigation();
        }

        this.pathfinder = new Pathfinder(state.map, state.cellSize);

        const g = this.pathfinder.worldToGrid(state.playerPos.x, state.playerPos.z);
        this.visitedCells.add(`${g.x},${g.z}`);

        this.detectStuck(state);
        if (this.actionCooldown > 0) this.actionCooldown--;

        const action = this.decideAction();

        // Emergency recovery: too many consecutive 'none' actions
        if (!action || action.action === 'none') {
            this.noneCounter++;
            if (this.noneCounter > 40) {
                this.log(`EMERGENCY: ${this.noneCounter} nones, force wander`);
                this.noneCounter = 0;
                this.clearPath();
                this.committedTarget = null;
                return this.wander();
            }
        } else {
            this.noneCounter = 0;
        }

        this.debugInfo.action = action;
        this.debugInfo.blacklisted = this.blacklistedTargets.size;
        return action;
    }

    /* ------------------------------------------------------------------ */
    /*  Navigation helpers                                                */
    /* ------------------------------------------------------------------ */

    resetNavigation() {
        this.clearPath();
        this.visitedCells.clear();
        this.blacklistedTargets.clear();
        this.committedTarget = null;
        this.stuckCounter = 0;
        this.noneCounter = 0;
        this.shrineAttempts = 0;
    }

    clearPath() {
        this.currentPath = null;
        this.pathTargetX = null;
        this.pathTargetZ = null;
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

        if (this.stuckCounter > 20) {
            if (this.pathTargetX !== null && this.pathTargetZ !== null) {
                const bg = this.pathfinder.worldToGrid(this.pathTargetX, this.pathTargetZ);
                this.log(`STUCK: blacklist (${bg.x},${bg.z})`);
                this.blacklistedTargets.add(`${bg.x},${bg.z}`);
            }
            this.clearPath();
            this.committedTarget = null;
            this.stuckCounter = 0;
        }
    }

    /* ------------------------------------------------------------------ */
    /*  Decision tree                                                     */
    /* ------------------------------------------------------------------ */

    decideAction() {
        const { game, playerPos, enemies, boss, items, stairs } = this.state;
        const shrine = this.state.shrine;
        const nearbyEnemy = enemies.find(e => this.distanceTo(e.x, e.z) < 3);

        // === ITEM USAGE (highest priority) ===

        if (!game.torchActive && game.items.includes('torch')) {
            const ti = game.items.indexOf('torch');
            this.debugInfo.reason = 'USE TORCH NOW';
            return { action: 'use_item', itemIndex: ti + 1 };
        }

        if (game.hp < game.maxHp * 0.3) {
            const pi = game.items.indexOf('potion');
            if (pi !== -1) {
                this.debugInfo.reason = 'emergency HP potion';
                return { action: 'use_item', itemIndex: pi + 1 };
            }
        }

        if (game.mp < 15 && game.items.includes('mpPotion')) {
            const mi = game.items.indexOf('mpPotion');
            this.debugInfo.reason = 'use MP potion';
            return { action: 'use_item', itemIndex: mi + 1 };
        }

        if ((nearbyEnemy || (boss && boss.active)) && game.items.includes('charm') && !game.shieldBuff) {
            const ci = game.items.indexOf('charm');
            this.debugInfo.reason = 'use charm for defense';
            return { action: 'use_item', itemIndex: ci + 1 };
        }

        if (game.items.includes('shield')) {
            const si = game.items.indexOf('shield');
            this.debugInfo.reason = 'use shield for ATK boost';
            return { action: 'use_item', itemIndex: si + 1 };
        }

        if (game.hp < game.maxHp * 0.6 && !nearbyEnemy && !(boss && boss.active)) {
            const pi = game.items.indexOf('potion');
            if (pi !== -1) {
                this.debugInfo.reason = 'proactive HP potion';
                return { action: 'use_item', itemIndex: pi + 1 };
            }
        }

        // === COMBAT ===
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

        // === SHRINE (if adjacent) ===
        const shrineAvailable = shrine && !game.shrineUsed && this.shrineAttempts < this.maxShrineAttempts;
        if (shrineAvailable && this.distanceTo(shrine.x, shrine.z) < 1.5) {
            this.shrineAttempts++;
            this.debugInfo.reason = `interact shrine (try ${this.shrineAttempts})`;
            return { action: 'interact' };
        }

        // === PICK UP ITEMS (reduce range when urgent objectives exist) ===
        const pickupItems = items.filter(i => {
            if (i.type === 'key') return false;
            const g = this.pathfinder.worldToGrid(i.x, i.z);
            return !this.blacklistedTargets.has(`${g.x},${g.z}`);
        });
        if (pickupItems.length > 0) {
            pickupItems.sort((a, b) => this.distanceTo(a.x, a.z) - this.distanceTo(b.x, b.z));
            const closest = pickupItems[0];
            const dist = this.distanceTo(closest.x, closest.z);
            // When stairs or active boss visible, only detour for very close items
            const hasUrgentObj = stairs || (boss && boss.active);
            const pickupRange = hasUrgentObj ? 2 : 5;
            if (dist < pickupRange) {
                const result = this.tryMoveToward(closest.x, closest.z);
                if (result) {
                    this.phase = 'pickup_item';
                    this.debugInfo.reason = `pickup ${closest.type} (dist=${dist.toFixed(1)})`;
                    return result;
                }
            }
        }

        // === PHASE: GET KEY ===
        if (!game.hasBossKey) {
            this.phase = 'get_key';
            const key = items.find(i => i.type === 'key');
            if (key) {
                this.debugInfo.reason = `move to key (${key.x.toFixed(1)},${key.z.toFixed(1)})`;
                return this.moveToward(key.x, key.z);
            }
            return this.explore();
        }

        // === SHRINE (if close and before boss) ===
        if (shrineAvailable && boss && !boss.active && this.distanceTo(shrine.x, shrine.z) < 20) {
            const result = this.tryMoveToward(shrine.x, shrine.z);
            if (result) {
                this.phase = 'get_shrine';
                this.debugInfo.reason = `move to shrine`;
                return result;
            }
        }

        // === PHASE: BOSS ===
        if (boss && !boss.active) {
            this.phase = 'fight_boss';
            if (this.distanceTo(boss.x, boss.z) < 5) {
                this.debugInfo.reason = 'interact boss';
                this.actionCooldown = 5;
                return { action: 'interact' };
            }
            this.debugInfo.reason = 'move to boss';
            return this.moveToward(boss.x, boss.z);
        }

        if (boss && boss.active) {
            this.phase = 'fight_boss';
            return this.fightBoss();
        }

        // === PHASE: ASCEND ===
        if (stairs) {
            this.phase = 'ascend';
            if (this.distanceTo(stairs.x, stairs.z) < 1.5) {
                this.debugInfo.reason = 'interact stairs';
                return { action: 'interact' };
            }
            this.debugInfo.reason = 'move to stairs';
            return this.moveToward(stairs.x, stairs.z);
        }

        // === PHASE: EXPLORE ===
        this.phase = 'explore';
        return this.explore();
    }

    /* ------------------------------------------------------------------ */
    /*  Boss fight                                                        */
    /* ------------------------------------------------------------------ */

    fightBoss() {
        const { game, boss } = this.state;

        if (game.hp < game.maxHp * 0.5) {
            const pi = game.items.indexOf('potion');
            if (pi !== -1) {
                this.debugInfo.reason = 'boss-fight heal';
                return { action: 'use_item', itemIndex: pi + 1 };
            }
        }
        if (game.mp < 10 && game.items.includes('mpPotion')) {
            const mi = game.items.indexOf('mpPotion');
            this.debugInfo.reason = 'boss-fight mp potion';
            return { action: 'use_item', itemIndex: mi + 1 };
        }
        if (game.items.includes('charm') && !game.shieldBuff) {
            const ci = game.items.indexOf('charm');
            this.debugInfo.reason = 'boss-fight use charm';
            return { action: 'use_item', itemIndex: ci + 1 };
        }
        if (game.items.includes('shield')) {
            const si = game.items.indexOf('shield');
            this.debugInfo.reason = 'boss-fight use shield';
            return { action: 'use_item', itemIndex: si + 1 };
        }

        const dist = this.distanceTo(boss.x, boss.z);
        const targetAngle = this.angleTo(boss.x, boss.z);

        if (boss.telegraphing) {
            if (dist < 7) {
                this.debugInfo.reason = 'DODGE telegraph';
                return { action: 'turn_and_move', angle: targetAngle + Math.PI, keys: ['w'] };
            }
            this.debugInfo.reason = 'wait out telegraph';
            return { action: 'none' };
        }

        if (boss.stunned) {
            const bossBackAngle = (boss.rotationY || 0) + Math.PI;
            const behindX = boss.x - Math.sin(bossBackAngle) * 3;
            const behindZ = boss.z - Math.cos(bossBackAngle) * 3;
            if (this.distanceTo(behindX, behindZ) < 1.5 && game.mp >= 5) {
                const faceAngle = this.angleTo(boss.x, boss.z);
                if (Math.abs(this.normalizeAngle(faceAngle - this.state.playerAngle)) > 0.2) {
                    this.debugInfo.reason = 'backstab face';
                    return { action: 'turn', angle: faceAngle };
                }
                this.debugInfo.reason = 'backstab!';
                return { action: 'attack' };
            }
            this.debugInfo.reason = 'move behind boss';
            return this.moveToward(behindX, behindZ);
        }

        if (game.mp >= 5 && dist < 4) {
            const diff = this.normalizeAngle(targetAngle - this.state.playerAngle);
            if (Math.abs(diff) > 0.2) {
                this.debugInfo.reason = 'face boss';
                return { action: 'turn', angle: targetAngle };
            }
            this.debugInfo.reason = 'attack boss';
            return { action: 'attack' };
        }

        if (game.mp < 5 && dist < 5) {
            this.debugInfo.reason = 'retreat (low MP)';
            return { action: 'turn_and_move', angle: targetAngle + Math.PI, keys: ['w'] };
        }

        if (dist >= 4) {
            this.debugInfo.reason = 'approach boss';
            return this.moveToward(boss.x, boss.z);
        }

        this.debugInfo.reason = 'strafe boss';
        return { action: 'turn_and_move', angle: targetAngle, keys: ['a'] };
    }

    /* ------------------------------------------------------------------ */
    /*  Movement (with path caching)                                      */
    /* ------------------------------------------------------------------ */

    /** Try to path to target. Returns action or null if no path. Caches path. */
    tryMoveToward(targetX, targetZ) {
        const targetChanged =
            this.pathTargetX === null ||
            Math.abs(targetX - this.pathTargetX) > 2 ||
            Math.abs(targetZ - this.pathTargetZ) > 2;

        if (!this.currentPath || targetChanged) {
            const path = this.pathfinder.findPath(
                this.state.playerPos.x, this.state.playerPos.z, targetX, targetZ
            );
            if (!path || path.length === 0) {
                const bg = this.pathfinder.worldToGrid(targetX, targetZ);
                this.blacklistedTargets.add(`${bg.x},${bg.z}`);
                this.log(`tryMove FAIL → blacklist (${bg.x},${bg.z})`);
                return null;
            }
            this.currentPath = path;
            this.pathTargetX = targetX;
            this.pathTargetZ = targetZ;
        }
        return this._followPath(targetX, targetZ);
    }

    /** Move toward target (always returns action). Caches path. */
    moveToward(targetX, targetZ) {
        const targetChanged =
            this.pathTargetX === null ||
            Math.abs(targetX - this.pathTargetX) > 2 ||
            Math.abs(targetZ - this.pathTargetZ) > 2;

        if (!this.currentPath || targetChanged) {
            this.currentPath = this.pathfinder.findPath(
                this.state.playerPos.x, this.state.playerPos.z, targetX, targetZ
            );
            this.pathTargetX = targetX;
            this.pathTargetZ = targetZ;
        }

        if (!this.currentPath || this.currentPath.length === 0) {
            const bg = this.pathfinder.worldToGrid(targetX, targetZ);
            this.blacklistedTargets.add(`${bg.x},${bg.z}`);
            return this.walkDirectly(targetX, targetZ);
        }

        return this._followPath(targetX, targetZ);
    }

    _followPath(targetX, targetZ) {
        const next = this.pathfinder.getNextWaypoint(
            this.currentPath, this.state.playerPos.x, this.state.playerPos.z
        );
        if (!next) {
            this.currentPath = null;
            return this.walkDirectly(targetX, targetZ);
        }
        if (next.index > 0) this.currentPath = this.currentPath.slice(next.index);
        return this.walkDirectly(next.waypoint.x, next.waypoint.z);
    }

    walkDirectly(x, z) {
        if (this.distanceTo(x, z) < 0.3) return { action: 'none' };
        return { action: 'turn_and_move', angle: this.angleTo(x, z), keys: ['w'] };
    }

    /* ------------------------------------------------------------------ */
    /*  DFS Exploration with committed target                             */
    /* ------------------------------------------------------------------ */

    explore() {
        // If we have a committed target, keep going toward it
        if (this.committedTarget) {
            const ct = this.committedTarget;
            const ctg = this.pathfinder.worldToGrid(ct.x, ct.z);
            const ctKey = `${ctg.x},${ctg.z}`;

            // Check if reached or blacklisted
            if (this.distanceTo(ct.x, ct.z) < 2 || this.visitedCells.has(ctKey)
                || this.blacklistedTargets.has(ctKey)) {
                this.committedTarget = null;
                this.clearPath();
            } else {
                const result = this.tryMoveToward(ct.x, ct.z);
                if (result) {
                    this.debugInfo.reason = `explore → (${ctg.x},${ctg.z}) dist=${this.distanceTo(ct.x, ct.z).toFixed(0)}`;
                    return result;
                }
                // Can't reach, abandon
                this.committedTarget = null;
                this.clearPath();
            }
        }

        // Find frontier cells (unvisited walkable cells adjacent to visited)
        const frontiers = this._findFrontiers();

        if (frontiers.length === 0) {
            this.debugInfo.reason = 'explore wander (no frontier)';
            return this.wander();
        }

        // BFS: sort nearest from player first to chain along corridors
        const { playerPos } = this.state;
        frontiers.sort((a, b) => {
            const da = (a.x - playerPos.x) ** 2 + (a.z - playerPos.z) ** 2;
            const db = (b.x - playerPos.x) ** 2 + (b.z - playerPos.z) ** 2;
            return da - db; // nearest first
        });

        this.log(`explore: ${frontiers.length} frontier cells (BFS)`);

        // Try top candidates until one is reachable, commit to it
        for (let i = 0; i < Math.min(10, frontiers.length); i++) {
            const target = frontiers[i];
            const result = this.tryMoveToward(target.x, target.z);
            if (result) {
                this.committedTarget = target;
                const tg = this.pathfinder.worldToGrid(target.x, target.z);
                this.debugInfo.reason = `explore → (${tg.x},${tg.z}) dist=${this.distanceTo(target.x, target.z).toFixed(0)}`;
                return result;
            }
        }

        this.debugInfo.reason = 'explore wander (no reachable)';
        return this.wander();
    }

    /** Find frontier: unvisited walkable cells adjacent to visited cells */
    _findFrontiers() {
        const frontiers = [];
        const seen = new Set();
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

        for (const key of this.visitedCells) {
            const [vx, vz] = key.split(',').map(Number);
            for (const [dx, dz] of dirs) {
                const nx = vx + dx, nz = vz + dz;
                const nkey = `${nx},${nz}`;
                if (!seen.has(nkey) && !this.visitedCells.has(nkey)
                    && !this.blacklistedTargets.has(nkey)
                    && this.pathfinder.isWalkable(nx, nz)) {
                    seen.add(nkey);
                    frontiers.push(this.pathfinder.gridToWorld(nx, nz));
                }
            }
        }

        return frontiers;
    }

    wander() {
        const { mapSize } = this.state;
        for (let i = 0; i < 20; i++) {
            const rx = Math.floor(Math.random() * (mapSize - 2)) + 1;
            const rz = Math.floor(Math.random() * (mapSize - 2)) + 1;
            if (this.pathfinder.isWalkable(rx, rz) && !this.blacklistedTargets.has(`${rx},${rz}`)) {
                const w = this.pathfinder.gridToWorld(rx, rz);
                this.debugInfo.reason = `wander → (${rx},${rz})`;
                return this.moveToward(w.x, w.z);
            }
        }
        this.debugInfo.reason = 'wander forward';
        return { action: 'turn_and_move', angle: this.state.playerAngle, keys: ['w'] };
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
        return Math.atan2(x - this.state.playerPos.x, z - this.state.playerPos.z);
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
