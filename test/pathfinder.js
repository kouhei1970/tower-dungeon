/**
 * A* Pathfinding Algorithm for Dungeon Navigation
 */

class PriorityQueue {
    constructor() {
        this.elements = [];
    }

    enqueue(element, priority) {
        this.elements.push({ element, priority });
        this.elements.sort((a, b) => a.priority - b.priority);
    }

    dequeue() {
        return this.elements.shift()?.element;
    }

    isEmpty() {
        return this.elements.length === 0;
    }
}

class Pathfinder {
    constructor(map, cellSize) {
        this.map = map;
        this.cellSize = cellSize;
        this.mapSize = map.length;
    }

    /**
     * Convert world coordinates to grid coordinates
     */
    worldToGrid(x, z) {
        return {
            x: Math.floor(x / this.cellSize),
            z: Math.floor(z / this.cellSize)
        };
    }

    /**
     * Convert grid coordinates to world coordinates (center of cell)
     */
    gridToWorld(gx, gz) {
        return {
            x: gx * this.cellSize + this.cellSize / 2,
            z: gz * this.cellSize + this.cellSize / 2
        };
    }

    /**
     * Check if a grid cell is walkable
     * 0 = floor (walkable), 1 = wall (blocked), 2 = door (walkable)
     */
    isWalkable(gx, gz) {
        if (gx < 0 || gx >= this.mapSize || gz < 0 || gz >= this.mapSize) {
            return false;
        }
        const cell = this.map[gz][gx];
        return cell === 0 || cell === 2; // floor or door
    }

    /**
     * Check if a cell is a door
     */
    isDoor(gx, gz) {
        if (gx < 0 || gx >= this.mapSize || gz < 0 || gz >= this.mapSize) {
            return false;
        }
        return this.map[gz][gx] === 2;
    }

    /**
     * Get neighbors of a cell (4-directional)
     */
    getNeighbors(gx, gz) {
        const neighbors = [];
        const directions = [
            { dx: 0, dz: -1 }, // up
            { dx: 0, dz: 1 },  // down
            { dx: -1, dz: 0 }, // left
            { dx: 1, dz: 0 }   // right
        ];

        for (const { dx, dz } of directions) {
            const nx = gx + dx;
            const nz = gz + dz;
            if (this.isWalkable(nx, nz)) {
                neighbors.push({ x: nx, z: nz });
            }
        }

        return neighbors;
    }

    /**
     * Count adjacent walls for a given cell (4-directional)
     */
    countAdjacentWalls(gx, gz) {
        let count = 0;
        const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (const [dx, dz] of dirs) {
            const nx = gx + dx;
            const nz = gz + dz;
            if (nx < 0 || nx >= this.mapSize || nz < 0 || nz >= this.mapSize || this.map[nz][nx] === 1) {
                count++;
            }
        }
        return count;
    }

    /**
     * Heuristic function (Manhattan distance)
     */
    heuristic(ax, az, bx, bz) {
        return Math.abs(ax - bx) + Math.abs(az - bz);
    }

    /**
     * Find path from start to goal using A*
     * Returns array of world coordinates or null if no path found
     */
    findPath(startX, startZ, goalX, goalZ) {
        const start = this.worldToGrid(startX, startZ);
        const goal = this.worldToGrid(goalX, goalZ);

        // If goal is not walkable, find nearest walkable cell
        if (!this.isWalkable(goal.x, goal.z)) {
            const nearestWalkable = this.findNearestWalkable(goal.x, goal.z);
            if (nearestWalkable) {
                goal.x = nearestWalkable.x;
                goal.z = nearestWalkable.z;
            } else {
                return null;
            }
        }

        const frontier = new PriorityQueue();
        frontier.enqueue(start, 0);

        const cameFrom = new Map();
        const costSoFar = new Map();

        const key = (x, z) => `${x},${z}`;
        cameFrom.set(key(start.x, start.z), null);
        costSoFar.set(key(start.x, start.z), 0);

        while (!frontier.isEmpty()) {
            const current = frontier.dequeue();

            if (current.x === goal.x && current.z === goal.z) {
                // Reconstruct path
                const path = [];
                let curr = current;
                while (curr !== null) {
                    const world = this.gridToWorld(curr.x, curr.z);
                    path.unshift(world);
                    curr = cameFrom.get(key(curr.x, curr.z));
                }
                return path;
            }

            for (const next of this.getNeighbors(current.x, current.z)) {
                const wallPenalty = this.countAdjacentWalls(next.x, next.z) * 0.3;
                const newCost = costSoFar.get(key(current.x, current.z)) + 1 + wallPenalty;
                const nextKey = key(next.x, next.z);

                if (!costSoFar.has(nextKey) || newCost < costSoFar.get(nextKey)) {
                    costSoFar.set(nextKey, newCost);
                    const priority = newCost + this.heuristic(next.x, next.z, goal.x, goal.z);
                    frontier.enqueue(next, priority);
                    cameFrom.set(nextKey, current);
                }
            }
        }

        return null; // No path found
    }

    /**
     * Find the nearest walkable cell to a given position
     */
    findNearestWalkable(gx, gz) {
        const maxRadius = 5;
        for (let r = 1; r <= maxRadius; r++) {
            for (let dx = -r; dx <= r; dx++) {
                for (let dz = -r; dz <= r; dz++) {
                    if (Math.abs(dx) === r || Math.abs(dz) === r) {
                        const nx = gx + dx;
                        const nz = gz + dz;
                        if (this.isWalkable(nx, nz)) {
                            return { x: nx, z: nz };
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * Get the next waypoint to move towards.
     * Follows the path sequentially: finds the first waypoint we haven't yet reached.
     * Returns { waypoint, index } so the caller can trim passed waypoints.
     */
    getNextWaypoint(path, currentX, currentZ, waypointRadius = 1.5) {
        if (!path || path.length === 0) return null;

        // Walk along the path and find the first waypoint we haven't reached
        for (let i = 0; i < path.length; i++) {
            const waypoint = path[i];
            const dist = this.distance(currentX, currentZ, waypoint.x, waypoint.z);
            if (dist > waypointRadius) {
                return { waypoint, index: i };
            }
        }

        // All waypoints reached - return the final one
        return { waypoint: path[path.length - 1], index: path.length - 1 };
    }

    /**
     * Calculate distance between two points
     */
    distance(x1, z1, x2, z2) {
        const dx = x2 - x1;
        const dz = z2 - z1;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /**
     * Find unexplored areas (for exploration phase)
     */
    findUnexploredAreas(visitedCells) {
        const unexplored = [];

        for (let z = 0; z < this.mapSize; z++) {
            for (let x = 0; x < this.mapSize; x++) {
                if (this.isWalkable(x, z) && !visitedCells.has(`${x},${z}`)) {
                    unexplored.push(this.gridToWorld(x, z));
                }
            }
        }

        return unexplored;
    }
}

module.exports = Pathfinder;
