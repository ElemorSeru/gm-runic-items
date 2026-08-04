// how far off the push line a shove is allowed to bend around an obstacle
const PUSH_ARC = Math.PI / 4;

const SQUARE_NEIGHBOR_OFFSETS = [
  [-1, 0], [1, 0], [0, -1], [0, 1],
  [-1, -1], [1, -1], [-1, 1], [1, 1]
];

// canvas.grid.measureDistance was removed after v12; measurePath is the v12+ API
export function measureDist(a, b) {
  const A = a?.center ?? a;
  const B = b?.center ?? b;
  if (typeof canvas.grid.measurePath === "function") {
    return canvas.grid.measurePath([A, B]).distance;
  }
  return canvas.grid.measureDistance(A, B);
}

export function angleBetween(from, to) {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

// canvas.grid.getSnappedPosition was removed after v12
function snapTopLeft(x, y) {
  const gs = canvas.grid.size;
  return { x: Math.round(x / gs) * gs, y: Math.round(y / gs) * gs };
}

function cellCenter(x, y, gridSize) {
  return { x: x + gridSize / 2, y: y + gridSize / 2 };
}

function isOutOfBounds(x, y, gridSize) {
  const rect = canvas?.dimensions?.rect;
  if (!rect) return false;
  return x < rect.x || y < rect.y ||
    x + gridSize > rect.x + rect.width ||
    y + gridSize > rect.y + rect.height;
}

function isCellOccupied(token, toX, toY, gridSize) {
  return canvas.tokens.placeables.some(t =>
    t.id !== token.id &&
    Math.abs(t.x - toX) < gridSize &&
    Math.abs(t.y - toY) < gridSize
  );
}

function isCellBlocked(token, fromCenter, toCenter, toX, toY, gridSize) {
  if (isOutOfBounds(toX, toY, gridSize)) return true;
  const backend = CONFIG.Canvas?.polygonBackends?.move;
  if (backend?.testCollision?.(fromCenter, toCenter, { type: "move", mode: "any" })) return true;
  return isCellOccupied(token, toX, toY, gridSize);
}

function angleDelta(a, b) {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? (Math.PI * 2) - d : d;
}

export function findReachableCells(token, maxFeet) {
  const gridSize = canvas.grid.size;
  const start = snapTopLeft(token.x, token.y);
  const startKey = `${start.x},${start.y}`;

  const best = new Map([[startKey, 0]]);
  const frontier = [{ x: start.x, y: start.y, cost: 0 }];

  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost);
    const current = frontier.shift();
    const currentKey = `${current.x},${current.y}`;
    if (current.cost > best.get(currentKey)) continue;

    const fromCenter = cellCenter(current.x, current.y, gridSize);
    for (const [dx, dy] of SQUARE_NEIGHBOR_OFFSETS) {
      const nx = current.x + dx * gridSize;
      const ny = current.y + dy * gridSize;
      const nKey = `${nx},${ny}`;
      const toCenter = cellCenter(nx, ny, gridSize);
      const cost = current.cost + measureDist(fromCenter, toCenter);
      if (cost > maxFeet) continue;
      if ((best.get(nKey) ?? Infinity) <= cost) continue;
      if (isCellBlocked(token, fromCenter, toCenter, nx, ny, gridSize)) continue;

      best.set(nKey, cost);
      frontier.push({ x: nx, y: ny, cost });
    }
  }

  return Array.from(best.entries()).map(([key, cost]) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y, cost };
  });
}

export function findBestCellTowardTarget(reachableCells, targetCenter) {
  const gridSize = canvas.grid.size;
  let best = reachableCells[0];
  let bestDist = Infinity;

  for (const cell of reachableCells) {
    const dist = measureDist(cellCenter(cell.x, cell.y, gridSize), targetCenter);
    if (dist < bestDist) {
      bestDist = dist;
      best = cell;
    }
  }

  return best;
}

export function findBestCellAwayFrom(reachableCells, referenceCenter, originCenter) {
  const gridSize = canvas.grid.size;
  const pushAngle = angleBetween(referenceCenter, originCenter);
  const startDist = measureDist(originCenter, referenceCenter);
  let best = null;
  let bestDist = 0;
  let bestOff = Infinity;

  for (const cell of reachableCells) {
    if (cell.cost === 0) continue;
    const center = cellCenter(cell.x, cell.y, gridSize);
    const off = angleDelta(angleBetween(originCenter, center), pushAngle);
    if (off > PUSH_ARC) continue;
    const dist = measureDist(center, referenceCenter);
    if (dist <= startDist) continue;
    if (best && (dist < bestDist || (dist === bestDist && off >= bestOff))) continue;
    best = cell;
    bestDist = dist;
    bestOff = off;
  }

  return best;
}

export function findBestAdjacentCell(reachableCells, anchorToken, secondaryToken = null) {
  const gridSize = canvas.grid.size;
  const unit = canvas.grid.distance ?? 5;
  const anchorCenter = anchorToken.center;

  const adjacent = reachableCells.filter(cell =>
    measureDist(cellCenter(cell.x, cell.y, gridSize), anchorCenter) <= unit
  );

  if (adjacent.length) {
    if (secondaryToken) {
      adjacent.sort((a, b) => {
        const da = measureDist(cellCenter(a.x, a.y, gridSize), secondaryToken.center);
        const db = measureDist(cellCenter(b.x, b.y, gridSize), secondaryToken.center);
        return da - db;
      });
    }
    return { cell: adjacent[0], isAdjacent: true };
  }

  return { cell: findBestCellTowardTarget(reachableCells, anchorCenter), isAdjacent: false };
}

export function computeRayDestination(token, angleRad, maxSquares) {
  const gridSize = canvas.grid.size;
  let current = { x: token.x, y: token.y };
  let movedSquares = 0;

  for (let i = 1; i <= maxSquares; i++) {
    const dist = i * gridSize;
    const dx = Math.round(Math.cos(angleRad) * dist);
    const dy = Math.round(Math.sin(angleRad) * dist);
    const candidate = snapTopLeft(token.x + dx, token.y + dy);
    if (candidate.x === current.x && candidate.y === current.y) continue;

    const fromCenter = cellCenter(current.x, current.y, gridSize);
    const toCenter = cellCenter(candidate.x, candidate.y, gridSize);
    if (isCellBlocked(token, fromCenter, toCenter, candidate.x, candidate.y, gridSize)) break;

    current = candidate;
    movedSquares = i;
  }

  return { x: current.x, y: current.y, squares: movedSquares };
}

export function computeBlinkDestination(token, angleRad, maxSquares) {
  const gridSize = canvas.grid.size;
  const origin = { x: token.x, y: token.y };
  const fromCenter = cellCenter(origin.x, origin.y, gridSize);
  const sight = CONFIG.Canvas?.polygonBackends?.sight;

  for (let i = maxSquares; i >= 1; i--) {
    const dist = i * gridSize;
    const dx = Math.round(Math.cos(angleRad) * dist);
    const dy = Math.round(Math.sin(angleRad) * dist);
    const candidate = snapTopLeft(origin.x + dx, origin.y + dy);
    if (candidate.x === origin.x && candidate.y === origin.y) continue;
    if (isOutOfBounds(candidate.x, candidate.y, gridSize)) continue;
    if (isCellOccupied(token, candidate.x, candidate.y, gridSize)) continue;
    const toCenter = cellCenter(candidate.x, candidate.y, gridSize);
    if (sight?.testCollision?.(fromCenter, toCenter, { type: "sight", mode: "any" })) continue;
    return { x: candidate.x, y: candidate.y, squares: i };
  }

  return { x: origin.x, y: origin.y, squares: 0 };
}
