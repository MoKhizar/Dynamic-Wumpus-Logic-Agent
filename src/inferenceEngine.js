// ============================================================
// Propositional Logic Inference Engine
// Supports: CNF Conversion + Resolution Refutation
// ============================================================

// A clause is a Set of literals (strings like "P_1_1", "~P_1_1")
export function neg(lit) {
  return lit.startsWith('~') ? lit.slice(1) : '~' + lit;
}

// Resolve two clauses on a complementary literal
// Returns null if no resolution possible, else the new clause (Set)
export function resolveClauses(c1, c2) {
  let resolvent = null;
  for (const lit of c1) {
    if (c2.has(neg(lit))) {
      if (resolvent !== null) return null; // multiple complementary = not useful
      resolvent = new Set([...c1, ...c2].filter(l => l !== lit && l !== neg(lit)));
    }
  }
  return resolvent;
}

// Convert clause set to string key for dedup
function clauseKey(clause) {
  return [...clause].sort().join('|');
}

// Resolution Refutation: prove that KB |= query
// KB is array of clause-Sets, query is a literal string (what we want to prove)
// We add ~query to KB and try to derive empty clause
// Returns { proved: bool, steps: array, inferenceCount: number }
export function resolutionRefutation(kbClauses, queryLiteral) {
  const negQuery = neg(queryLiteral);
  const allClauses = [...kbClauses.map(c => new Set(c)), new Set([negQuery])];
  const seen = new Set(allClauses.map(clauseKey));
  const steps = [];
  let inferenceCount = 0;
  let changed = true;

  while (changed) {
    changed = false;
    const current = [...allClauses];
    for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        const resolvent = resolveClauses(current[i], current[j]);
        if (resolvent === null) continue;
        inferenceCount++;
        const key = clauseKey(resolvent);
        if (resolvent.size === 0) {
          steps.push({
            from: [[...current[i]], [...current[j]]],
            result: '⊥ (Empty Clause — Contradiction!)',
          });
          return { proved: true, steps, inferenceCount };
        }
        if (!seen.has(key)) {
          seen.add(key);
          allClauses.push(resolvent);
          steps.push({
            from: [[...current[i]], [...current[j]]],
            result: [...resolvent],
          });
          changed = true;
        }
      }
    }
  }
  return { proved: false, steps, inferenceCount };
}

// Build KB clauses from Wumpus World percepts
// visited: Set of "r_c" strings
// breezy: Set of "r_c" strings (cells where breeze was felt)
// stenchy: Set of "r_c" strings (cells where stench was felt)
// safe: Set of "r_c" strings (cells proven safe)
// rows, cols: grid dimensions
export function buildKBClauses(visited, breezy, stenchy, rows, cols) {
  const clauses = [];
  const adj = (r, c) => {
    const neighbors = [];
    if (r > 0) neighbors.push([r - 1, c]);
    if (r < rows - 1) neighbors.push([r + 1, c]);
    if (c > 0) neighbors.push([r, c - 1]);
    if (c < cols - 1) neighbors.push([r, c + 1]);
    return neighbors;
  };

  for (const cell of visited) {
    const [r, c] = cell.split('_').map(Number);

    // No pit at visited cells
    clauses.push(new Set([`~P_${r}_${c}`]));
    // No wumpus at visited cells (agent survived)
    clauses.push(new Set([`~W_${r}_${c}`]));

    const neighbors = adj(r, c);

    if (breezy.has(cell)) {
      // Breeze => at least one adjacent pit
      // B_r_c <=> (P_n1 v P_n2 v ...)
      // Forward: ~B or P_n1 or P_n2 ... (i.e., since B is true: P_n1 v P_n2 ...)
      clauses.push(new Set(neighbors.map(([nr, nc]) => `P_${nr}_${nc}`)));
      // Backward: for each neighbor, ~P_ni or B (since B is true, ~P_ni or True = trivial)
    } else {
      // No breeze => no adjacent pits
      for (const [nr, nc] of neighbors) {
        clauses.push(new Set([`~P_${nr}_${nc}`]));
      }
    }

    if (stenchy.has(cell)) {
      // Stench => at least one adjacent wumpus
      clauses.push(new Set(neighbors.map(([nr, nc]) => `W_${nr}_${nc}`)));
    } else {
      // No stench => no adjacent wumpus
      for (const [nr, nc] of neighbors) {
        clauses.push(new Set([`~W_${nr}_${nc}`]));
      }
    }
  }

  return clauses;
}

// Ask KB if a cell is safe (no pit AND no wumpus)
export function isCellSafe(kbClauses, r, c) {
  const noPit = resolutionRefutation(kbClauses, `~P_${r}_${c}`);
  const noWumpus = resolutionRefutation(kbClauses, `~W_${r}_${c}`);
  return {
    safe: noPit.proved && noWumpus.proved,
    noPit: noPit.proved,
    noWumpus: noWumpus.proved,
    inferenceCount: noPit.inferenceCount + noWumpus.inferenceCount,
    steps: [...noPit.steps, ...noWumpus.steps],
  };
}
