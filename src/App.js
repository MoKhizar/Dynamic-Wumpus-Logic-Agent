import React, { useState, useCallback, useEffect, useRef } from 'react';
import { buildKBClauses, isCellSafe } from './inferenceEngine';
import './App.css';

// ── Helpers ─────────────────────────────────────────────────
const key = (r, c) => `${r}_${c}`;
const adj = (r, c, rows, cols) => {
  const n = [];
  if (r > 0) n.push([r - 1, c]);
  if (r < rows - 1) n.push([r + 1, c]);
  if (c > 0) n.push([r, c - 1]);
  if (c < cols - 1) n.push([r, c + 1]);
  return n;
};

function initWorld(rows, cols) {
  const cells = {};
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      cells[key(r, c)] = { pit: false, wumpus: false, gold: false };

  const pits = Math.max(1, Math.floor((rows * cols) / 6));
  let placed = 0;
  while (placed < pits) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    if ((r === rows - 1 && c === 0) || cells[key(r, c)].pit) continue;
    cells[key(r, c)].pit = true;
    placed++;
  }

  // Place wumpus
  let wr, wc;
  do {
    wr = Math.floor(Math.random() * rows);
    wc = Math.floor(Math.random() * cols);
  } while ((wr === rows - 1 && wc === 0) || cells[key(wr, wc)].pit);
  cells[key(wr, wc)].wumpus = true;

  // Place gold
  let gr, gc;
  do {
    gr = Math.floor(Math.random() * rows);
    gc = Math.floor(Math.random() * cols);
  } while ((gr === rows - 1 && gc === 0) || cells[key(gr, gc)].pit || cells[key(gr, gc)].wumpus);
  cells[key(gr, gc)].gold = true;

  return cells;
}

function getPercepts(cells, r, c, rows, cols) {
  const breezy = adj(r, c, rows, cols).some(([nr, nc]) => cells[key(nr, nc)]?.pit);
  const stenchy = adj(r, c, rows, cols).some(([nr, nc]) => cells[key(nr, nc)]?.wumpus);
  const glitter = cells[key(r, c)]?.gold;
  const pit = cells[key(r, c)]?.pit;
  const wumpus = cells[key(r, c)]?.wumpus;
  return { breezy, stenchy, glitter, pit, wumpus };
}

const STATUS = { PLAYING: 'playing', WON: 'won', DEAD_PIT: 'dead_pit', DEAD_WUMPUS: 'dead_wumpus' };

// ── Main Component ────────────────────────────────────────────
export default function App() {
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(4);
  const [rowsInput, setRowsInput] = useState(4);
  const [colsInput, setColsInput] = useState(4);
  const [world, setWorld] = useState(null);
  const [agentPos, setAgentPos] = useState([3, 0]);
  const [visited, setVisited] = useState(new Set());
  const [breezy, setBreezy] = useState(new Set());
  const [stenchy, setStenchy] = useState(new Set());
  const [safeMap, setSafeMap] = useState({});
  const [status, setStatus] = useState(STATUS.PLAYING);
  const [inferenceCount, setInferenceCount] = useState(0);
  const [currentPercepts, setCurrentPercepts] = useState({});
  const [log, setLog] = useState([]);
  const [showHidden, setShowHidden] = useState(false);
  const [kbSteps, setKbSteps] = useState([]);
  const logRef = useRef(null);

  const addLog = useCallback((msg, type = 'info') => {
    setLog(prev => [...prev.slice(-60), { msg, type, id: Date.now() + Math.random() }]);
  }, []);

  const startGame = useCallback(() => {
    const r = Math.max(2, Math.min(8, rowsInput));
    const c = Math.max(2, Math.min(8, colsInput));
    setRows(r); setCols(c);
    const newWorld = initWorld(r, c);
    setWorld(newWorld);
    const startPos = [r - 1, 0];
    setAgentPos(startPos);
    const startKey = key(...startPos);
    const newVisited = new Set([startKey]);
    setVisited(newVisited);
    setBreezy(new Set());
    setStenchy(new Set());
    setSafeMap({});
    setStatus(STATUS.PLAYING);
    setInferenceCount(0);
    setLog([]);
    setKbSteps([]);

    const percepts = getPercepts(newWorld, startPos[0], startPos[1], r, c);
    setCurrentPercepts(percepts);
    const newBreezy = new Set(); const newStenchy = new Set();
    if (percepts.breezy) newBreezy.add(startKey);
    if (percepts.stenchy) newStenchy.add(startKey);
    setBreezy(newBreezy); setStenchy(newStenchy);
    addLog(`🚀 Game started! Agent at [${startPos[0]},${startPos[1]}]`, 'start');
    addLog(`Percepts: ${formatPercepts(percepts)}`, 'percept');
  }, [rowsInput, colsInput, addLog]);

  useEffect(() => { startGame(); }, []); // eslint-disable-line

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  const formatPercepts = (p) => {
    const arr = [];
    if (p.breezy) arr.push('💨 Breeze');
    if (p.stenchy) arr.push('💀 Stench');
    if (p.glitter) arr.push('✨ Glitter');
    if (!p.breezy && !p.stenchy && !p.glitter) arr.push('Nothing');
    return arr.join(', ');
  };

  const moveAgent = useCallback((nr, nc) => {
    if (status !== STATUS.PLAYING || !world) return;
    const cellKey = key(nr, nc);

    // Run inference BEFORE moving
    const currVisited = visited;
    const currBreezy = breezy;
    const currStenchy = stenchy;
    const kbClauses = buildKBClauses(currVisited, currBreezy, currStenchy, rows, cols);
    const safety = isCellSafe(kbClauses, nr, nc);
    const newInfCount = inferenceCount + safety.inferenceCount;
    setInferenceCount(newInfCount);
    setKbSteps(safety.steps.slice(-10));

    if (!safety.safe && !visited.has(cellKey)) {
      addLog(`⚠️ KB: Cell [${nr},${nc}] NOT proven safe (${safety.noPit ? '✓NoPit' : '✗Pit?'} ${safety.noWumpus ? '✓NoWumpus' : '✗Wumpus?'}) — moving anyway (manual override)`, 'warn');
    } else if (safety.safe) {
      addLog(`✅ KB proved cell [${nr},${nc}] SAFE after ${safety.inferenceCount} inferences`, 'safe');
    }

    // Move agent
    setAgentPos([nr, nc]);
    const newVisited = new Set([...visited, cellKey]);
    setVisited(newVisited);

    const percepts = getPercepts(world, nr, nc, rows, cols);
    setCurrentPercepts(percepts);

    const newBreezy = new Set(breezy);
    const newStenchy = new Set(stenchy);
    if (percepts.breezy) newBreezy.add(cellKey);
    if (percepts.stenchy) newStenchy.add(cellKey);
    setBreezy(newBreezy); setStenchy(newStenchy);

    addLog(`🧭 Moved to [${nr},${nc}]. Percepts: ${formatPercepts(percepts)}`, 'move');

    // Compute safe cells for all unvisited neighbors
    const newKbClauses = buildKBClauses(newVisited, newBreezy, newStenchy, rows, cols);
    const newSafeMap = { ...safeMap };
    let totalNew = inferenceCount;
    for (let r2 = 0; r2 < rows; r2++) {
      for (let c2 = 0; c2 < cols; c2++) {
        if (!newVisited.has(key(r2, c2))) {
          const s = isCellSafe(newKbClauses, r2, c2);
          totalNew += s.inferenceCount;
          newSafeMap[key(r2, c2)] = s.safe;
        }
      }
    }
    setSafeMap(newSafeMap);
    setInferenceCount(totalNew);

    if (percepts.pit) {
      setStatus(STATUS.DEAD_PIT);
      addLog('💀 Agent fell into a PIT! Game over.', 'dead');
    } else if (percepts.wumpus) {
      setStatus(STATUS.DEAD_WUMPUS);
      addLog('💀 Agent eaten by WUMPUS! Game over.', 'dead');
    } else if (percepts.glitter) {
      setStatus(STATUS.WON);
      addLog('🏆 Agent found the GOLD! You WIN!', 'win');
    }
  }, [status, world, visited, breezy, stenchy, rows, cols, inferenceCount, safeMap, addLog]);

  const getCellClass = (r, c) => {
    const k = key(r, c);
    const isAgent = agentPos[0] === r && agentPos[1] === c;
    const isVisited = visited.has(k);
    const isProvenSafe = safeMap[k] === true;
    const isDead = status === STATUS.DEAD_PIT || status === STATUS.DEAD_WUMPUS;

    if (isAgent) return isDead ? 'cell agent dead' : 'cell agent';
    if (isVisited) return 'cell visited';
    if (isProvenSafe) return 'cell safe';
    return 'cell unknown';
  };

  const getCellContent = (r, c) => {
    const k = key(r, c);
    const isAgent = agentPos[0] === r && agentPos[1] === c;
    const isVisited = visited.has(k);
    const icons = [];

    if (isAgent) icons.push(<span key="agent" className="icon-agent">🤖</span>);

    if (showHidden && world) {
      const cell = world[k];
      if (cell.pit) icons.push(<span key="pit" className="icon-pit">🕳</span>);
      if (cell.wumpus) icons.push(<span key="w" className="icon-wumpus">👹</span>);
      if (cell.gold) icons.push(<span key="g" className="icon-gold">💰</span>);
    }

    if (isVisited || isAgent) {
      if (breezy.has(k)) icons.push(<span key="b" className="icon-percept">💨</span>);
      if (stenchy.has(k)) icons.push(<span key="s" className="icon-percept">💀</span>);
    }

    if (!isVisited && !isAgent && safeMap[k] === true)
      icons.push(<span key="safe" className="icon-safe">✓</span>);

    return icons;
  };

  const canMove = (nr, nc) =>
    nr >= 0 && nr < rows && nc >= 0 && nc < cols &&
    Math.abs(nr - agentPos[0]) + Math.abs(nc - agentPos[1]) === 1 &&
    status === STATUS.PLAYING;

  const [ar, ac] = agentPos;

  return (
    <div className="app">
      <header className="header">
        <div className="header-title">
          <span className="title-prefix">AI-2002</span>
          <h1>WUMPUS LOGIC AGENT</h1>
          <span className="title-sub">Knowledge-Based Propositional Resolution Engine</span>
        </div>
      </header>

      <div className="main-layout">
        {/* ── LEFT: Controls + Metrics ── */}
        <aside className="sidebar">
          <section className="panel config-panel">
            <h2 className="panel-title">⚙ CONFIGURATION</h2>
            <div className="config-row">
              <label>Rows <span className="hint">(2–8)</span></label>
              <input type="number" min="2" max="8" value={rowsInput}
                onChange={e => setRowsInput(+e.target.value)} className="num-input" />
            </div>
            <div className="config-row">
              <label>Cols <span className="hint">(2–8)</span></label>
              <input type="number" min="2" max="8" value={colsInput}
                onChange={e => setColsInput(+e.target.value)} className="num-input" />
            </div>
            <button className="btn btn-primary" onClick={startGame}>↺ NEW GAME</button>
            <button className="btn btn-ghost" onClick={() => setShowHidden(h => !h)}>
              {showHidden ? '🙈 HIDE MAP' : '👁 REVEAL MAP'}
            </button>
          </section>

          <section className="panel metrics-panel">
            <h2 className="panel-title">📊 METRICS</h2>
            <div className="metric">
              <span className="metric-label">INFERENCE STEPS</span>
              <span className="metric-value accent">{inferenceCount}</span>
            </div>
            <div className="metric">
              <span className="metric-label">CELLS VISITED</span>
              <span className="metric-value">{visited.size}</span>
            </div>
            <div className="metric">
              <span className="metric-label">SAFE CELLS KNOWN</span>
              <span className="metric-value safe-color">{Object.values(safeMap).filter(Boolean).length}</span>
            </div>
            <div className="metric">
              <span className="metric-label">AGENT POSITION</span>
              <span className="metric-value mono">[{ar},{ac}]</span>
            </div>
          </section>

          <section className="panel percept-panel">
            <h2 className="panel-title">📡 CURRENT PERCEPTS</h2>
            <div className="percepts">
              <div className={`percept-badge ${currentPercepts.breezy ? 'active' : ''}`}>💨 Breeze</div>
              <div className={`percept-badge ${currentPercepts.stenchy ? 'active' : ''}`}>💀 Stench</div>
              <div className={`percept-badge ${currentPercepts.glitter ? 'active gold' : ''}`}>✨ Glitter</div>
            </div>
          </section>

          <section className="panel legend-panel">
            <h2 className="panel-title">🗺 LEGEND</h2>
            <div className="legend-item"><span className="legend-box agent-box"></span> Agent</div>
            <div className="legend-item"><span className="legend-box visited-box"></span> Visited</div>
            <div className="legend-item"><span className="legend-box safe-box"></span> KB-Proven Safe</div>
            <div className="legend-item"><span className="legend-box unknown-box"></span> Unknown</div>
          </section>
        </aside>

        {/* ── CENTER: Grid ── */}
        <main className="grid-area">
          {status !== STATUS.PLAYING && (
            <div className={`status-banner ${status}`}>
              {status === STATUS.WON && '🏆 VICTORY — Gold Retrieved!'}
              {status === STATUS.DEAD_PIT && '💀 FELL INTO A PIT'}
              {status === STATUS.DEAD_WUMPUS && '💀 EATEN BY THE WUMPUS'}
              <button className="btn btn-primary small" onClick={startGame} style={{ marginLeft: '1rem' }}>
                Restart
              </button>
            </div>
          )}

          <div className="grid-wrapper">
            <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
              {Array.from({ length: rows }, (_, r) =>
                Array.from({ length: cols }, (_, c) => (
                  <div
                    key={key(r, c)}
                    className={getCellClass(r, c) + (canMove(r, c) ? ' movable' : '')}
                    onClick={() => canMove(r, c) && moveAgent(r, c)}
                    title={`[${r},${c}] ${safeMap[key(r, c)] === true ? '✓ Safe' : safeMap[key(r, c)] === false ? '✗ Danger' : '? Unknown'}`}
                  >
                    <span className="cell-coord">{r},{c}</span>
                    <div className="cell-icons">{getCellContent(r, c)}</div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Move controls */}
          <div className="move-controls">
            <div className="dpad">
              <button className="dpad-btn up" onClick={() => moveAgent(ar - 1, ac)} disabled={!canMove(ar - 1, ac)}>▲</button>
              <button className="dpad-btn left" onClick={() => moveAgent(ar, ac - 1)} disabled={!canMove(ar, ac - 1)}>◀</button>
              <span className="dpad-center">🤖</span>
              <button className="dpad-btn right" onClick={() => moveAgent(ar, ac + 1)} disabled={!canMove(ar, ac + 1)}>▶</button>
              <button className="dpad-btn down" onClick={() => moveAgent(ar + 1, ac)} disabled={!canMove(ar + 1, ac)}>▼</button>
            </div>
            <p className="hint-text">Click adjacent cell or use D-pad to move</p>
          </div>
        </main>

        {/* ── RIGHT: Log + KB Steps ── */}
        <aside className="sidebar right-sidebar">
          <section className="panel log-panel">
            <h2 className="panel-title">📋 AGENT LOG</h2>
            <div className="log-scroll" ref={logRef}>
              {log.map(entry => (
                <div key={entry.id} className={`log-entry log-${entry.type}`}>{entry.msg}</div>
              ))}
            </div>
          </section>

          <section className="panel kb-panel">
            <h2 className="panel-title">🔍 LAST KB RESOLUTION STEPS</h2>
            <div className="kb-scroll">
              {kbSteps.length === 0 && <div className="kb-empty">Move to trigger inference…</div>}
              {kbSteps.map((s, i) => (
                <div key={i} className="kb-step">
                  <span className="kb-step-num">Step {i + 1}</span>
                  <div className="kb-from">
                    {`{${s.from[0].join(', ')}} ⊗ {${s.from[1].join(', ')}}`}
                  </div>
                  <div className="kb-result">→ {typeof s.result === 'string' ? s.result : `{${s.result.join(', ')}}`}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
