from flask import Flask, render_template, jsonify, request
import random


def negate(literal):
    if literal.startswith('-'):
        return literal[1:]
    return '-' + literal

def resolve(ci, cj):
    resolvents = set()
    for di in ci:
        for dj in cj:
            if di == negate(dj):
                res = list(ci) + list(cj)
                res.remove(di)
                res.remove(dj)
                res = set(res)
                if not any(negate(l) in res for l in res):
                    resolvents.add(tuple(sorted(res)))
    return resolvents

class KnowledgeBase:
    def __init__(self):
        self.clauses = set()
        self.total_steps = 0

    def tell(self, clause):
        self.clauses.add(tuple(sorted(clause)))

    def ask(self, query_clauses):
        clauses = set(self.clauses)
        for qc in query_clauses:
            clauses.add(tuple(sorted(qc)))
        
        new = set()
        steps = 0
        
        while True:
            clauses_list = list(clauses)
            n = len(clauses_list)
            
            for i in range(n):
                for j in range(i + 1, n):
                    steps += 1
                    resolvents = resolve(clauses_list[i], clauses_list[j])
                    
                    if tuple() in resolvents: 
                        self.total_steps += steps
                        return True, steps
                    
                    new = new.union(resolvents)
                    
                    if steps > 1500:
                        self.total_steps += steps
                        return False, steps

            if new.issubset(clauses):
                self.total_steps += steps
                return False, steps
            
            clauses = clauses.union(new)


app = Flask(__name__)

game_state = {}

def get_neighbors(x, y, rows, cols):
    neighbors = []
    if x > 0: neighbors.append((x-1, y))
    if x < rows - 1: neighbors.append((x+1, y))
    if y > 0: neighbors.append((x, y-1))
    if y < cols - 1: neighbors.append((x, y+1))
    return neighbors

def init_game(rows, cols):
    global game_state
    
    pits = set()
    for r in range(rows):
        for c in range(cols):
            if (r, c) != (0, 0) and random.random() < 0.15:
                pits.add((r, c))
                
    wumpus = None
    while wumpus == None or wumpus == (0, 0):
        wumpus = (random.randint(0, rows-1), random.randint(0, cols-1))
        
    pits.discard(wumpus)

    game_state = {
        'rows': rows,
        'cols': cols,
        'agent': (0, 0),
        'pits': list(pits),
        'wumpus': wumpus,
        'visited': [(0, 0)],
        'safe': [(0, 0)],
        'percepts': [],
        'kb': KnowledgeBase(),
        'game_over': False
    }
    
    game_state['kb'].tell((f'-P_{0}_{0}',))
    game_state['kb'].tell((f'-W_{0}_{0}',))
    
    process_cell(0, 0)

def process_cell(x, y):
    rows, cols, kb = game_state['rows'], game_state['cols'], game_state['kb']
    breeze, stench = False, False
    
    for nx, ny in get_neighbors(x, y, rows, cols):
        if (nx, ny) in [tuple(p) for p in game_state['pits']]: breeze = True
        if (nx, ny) == tuple(game_state['wumpus']): stench = True
            
    game_state['percepts'] = []
    if breeze: game_state['percepts'].append("Breeze")
    if stench: game_state['percepts'].append("Stench")
    if not breeze and not stench: game_state['percepts'].append("None")
    
    neighbors = get_neighbors(x, y, rows, cols)
    
    if breeze:
        kb.tell((f'B_{x}_{y}',))
        clause = [f'-B_{x}_{y}'] + [f'P_{nx}_{ny}' for nx, ny in neighbors]
        kb.tell(tuple(clause))
    else:
        kb.tell((f'-B_{x}_{y}',))
        for nx, ny in neighbors: kb.tell((f'-P_{nx}_{ny}',))
            
    if stench:
        kb.tell((f'S_{x}_{y}',))
        clause = [f'-S_{x}_{y}'] + [f'W_{nx}_{ny}' for nx, ny in neighbors]
        kb.tell(tuple(clause))
    else:
        kb.tell((f'-S_{x}_{y}',))
        for nx, ny in neighbors: kb.tell((f'-W_{nx}_{ny}',))

    for nx, ny in neighbors:
        if (nx, ny) not in [tuple(s) for s in game_state['safe']]:
            query_negation = [(f'P_{nx}_{ny}', f'W_{nx}_{ny}')]
            is_safe, steps = kb.ask(query_negation)
            if is_safe:
                game_state['safe'].append((nx, ny))

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/start', methods=['POST'])
def start():
    data = request.json
    init_game(int(data['rows']), int(data['cols']))
    return jsonify(get_state_payload())

@app.route('/api/step', methods=['POST'])
def step():
    if game_state.get('game_over', True):
        return jsonify(get_state_payload())
        
    visited_set = set(tuple(v) for v in game_state['visited'])
    safe_set = set(tuple(s) for s in game_state['safe'])
    
    unvisited_safe = safe_set - visited_set
    next_move = list(unvisited_safe)[0] if unvisited_safe else None
    
    if next_move:
        game_state['agent'] = next_move
        game_state['visited'].append(next_move)
        
        if next_move in [tuple(p) for p in game_state['pits']] or next_move == tuple(game_state['wumpus']):
            game_state['game_over'] = True
            game_state['percepts'] = ["DEAD"]
        else:
            process_cell(next_move[0], next_move[1])
    else:
        game_state['game_over'] = True

    return jsonify(get_state_payload())

def get_state_payload():
    if not game_state: return {}
    return {
        'rows': game_state['rows'],
        'cols': game_state['cols'],
        'agent': game_state['agent'],
        'pits': game_state['pits'],
        'wumpus': game_state['wumpus'],
        'visited': game_state['visited'],
        'safe': game_state['safe'],
        'percepts': game_state['percepts'],
        'inference_steps': game_state['kb'].total_steps,
        'game_over': game_state['game_over']
    }

if __name__ == '__main__':
    app.run(debug=True)
