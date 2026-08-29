(() => {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const KEY_DIRECTIONS = new Map([
    ['ArrowLeft', [-1, 0]], ['a', [-1, 0]],
    ['ArrowRight', [1, 0]], ['d', [1, 0]],
    ['ArrowUp', [0, -1]], ['w', [0, -1]],
    ['ArrowDown', [0, 1]], ['s', [0, 1]],
  ]);
  const state = {
    active: false,
    scene: null,
    graph: [],
    current: -1,
    previous: -1,
    revision: null,
    dimensions: 2,
    overlay: null,
    player: null,
    animation: 0,
    resetPending: false,
  };

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }

  function installInterface() {
    const actions = document.querySelector('.drawer .actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'game-mode';
    button.textContent = 'Game';
    button.setAttribute('aria-pressed', 'false');
    button.title = 'Guide a bead along the writing with WASD or the arrow keys';
    actions.insertBefore(button, document.querySelector('#fit'));

    const hint = document.createElement('div');
    hint.className = 'ete-game-hint';
    hint.hidden = true;
    hint.textContent = 'WASD / arrows · R reset · Esc exit';
    document.querySelector('.drawer')?.appendChild(hint);

    const style = document.createElement('style');
    style.textContent = `
      .ete-game-hint {
        position: absolute; z-index: 4; left: 18px; bottom: 16px;
        padding: 6px 9px; border: 1px solid var(--line); border-radius: 4px;
        color: var(--ink); background: rgba(248, 239, 207, .94);
        pointer-events: none; font-size: 10px;
      }
      .ete-game-player { fill: #66a9dc; stroke: #fff8df; stroke-width: 1.4; }
      .ete-game-player[data-dimensions="3"] { fill: url(#ete-game-sphere); stroke-width: 1; }
    `;
    document.head.appendChild(style);

    button.addEventListener('click', () => setActive(!state.active));
    state.button = button;
    state.hint = hint;
  }

  function pointInRoot(element, point, svg) {
    const elementMatrix = element.getScreenCTM();
    const rootMatrix = svg.getScreenCTM();
    if (!elementMatrix || !rootMatrix) return point;
    return new DOMPoint(point.x, point.y)
      .matrixTransform(elementMatrix)
      .matrixTransform(rootMatrix.inverse());
  }

  function tracksFrom2D(scene) {
    return [...scene.root.querySelectorAll('path, circle, line, polyline')]
      .filter((element) =>
        (element.matches('.node-dot') || typeof element.getTotalLength === 'function') &&
        (!element.classList.contains('gate') || element.hasAttribute('stroke-dasharray')))
      .map((element) => {
        if (element.matches('.node-dot')) {
          return {
            jump: false,
            points: [pointInRoot(element, {
              x: Number(element.getAttribute('cx')),
              y: Number(element.getAttribute('cy')),
            }, scene.svg)],
          };
        }
        const length = element.getTotalLength();
        const count = Math.max(1, Math.ceil(length / 4));
        return {
          jump: element.classList.contains('gate'),
          points: Array.from({ length: count + 1 }, (_, index) => {
            const point = element.getPointAtLength((length * index) / count);
            return pointInRoot(element, point, scene.svg);
          }),
        };
      })
      .filter((track) => track.points.length);
  }

  function sampleTrack(points, spacing) {
    const lengths = [0];
    for (let index = 1; index < points.length; index++) {
      lengths.push(lengths.at(-1) + Math.hypot(
        points[index].x - points[index - 1].x,
        points[index].y - points[index - 1].y,
      ));
    }
    const total = lengths.at(-1);
    if (!total) return [{ x: points[0].x, y: points[0].y, t: 0 }];
    const count = Math.max(1, Math.ceil(total / spacing));
    return Array.from({ length: count + 1 }, (_, sampleIndex) => {
      const distance = (total * sampleIndex) / count;
      let segment = 1;
      while (segment < lengths.length - 1 && lengths[segment] < distance) segment++;
      const start = points[segment - 1];
      const end = points[segment];
      const span = lengths[segment] - lengths[segment - 1] || 1;
      const ratio = (distance - lengths[segment - 1]) / span;
      return {
        x: start.x + (end.x - start.x) * ratio,
        y: start.y + (end.y - start.y) * ratio,
        t: distance / total,
      };
    });
  }

  function buildGraph(tracks, dimensions) {
    const nodes = [];
    const buckets = new Map();
    const endpoints = [];
    const trackNodes = [];
    const joinRadius = dimensions === 3 ? 3.5 : 2.5;
    // h-style pen lifts span about half a glyph diagonally (roughly 35 units).
    const gapRadius = dimensions === 3 ? 42 : 40;
    const spacing = dimensions === 3 ? 6 : 4;
    const cellKey = (x, y) => `${x},${y}`;

    function nodeAt(point, reference, previous) {
      const cellX = Math.floor(point.x / joinRadius);
      const cellY = Math.floor(point.y / joinRadius);
      let match = -1;
      for (let x = cellX - 1; x <= cellX + 1 && match < 0; x++) {
        for (let y = cellY - 1; y <= cellY + 1 && match < 0; y++) {
          for (const index of buckets.get(cellKey(x, y)) || []) {
            if (index === previous) continue;
            const node = nodes[index];
            if (Math.hypot(node.x - point.x, node.y - point.y) <= joinRadius) match = index;
          }
        }
      }
      if (match < 0) {
        match = nodes.length;
        nodes.push({ x: point.x, y: point.y, neighbors: new Map(), refs: [] });
        const key = cellKey(cellX, cellY);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(match);
      }
      nodes[match].refs.push(reference);
      return match;
    }

    const connect = (left, right, jump = false) => {
      if (left === right) return;
      const kind = jump || nodes[left].neighbors.get(right) || false;
      nodes[left].neighbors.set(right, kind);
      nodes[right].neighbors.set(left, kind);
    };

    tracks.forEach((track, trackIndex) => {
      const { points, jump = false } = Array.isArray(track) ? { points: track } : track;
      let previous = -1;
      const members = [];
      const samples = jump
        ? [
          { x: points[0].x, y: points[0].y, t: 0 },
          { x: points.at(-1).x, y: points.at(-1).y, t: 1 },
        ]
        : sampleTrack(points, spacing);
      samples.forEach((point, index) => {
        const current = nodeAt(point, { track: trackIndex, t: point.t }, previous);
        if (members.at(-1) !== current) members.push(current);
        if (previous >= 0) connect(previous, current, jump);
        if (index === 0 || index === samples.length - 1) {
          endpoints.push({ node: current, track: trackIndex, jump });
        }
        previous = current;
      });
      trackNodes.push({ jump, members });
    });

    const normalTracks = trackNodes.filter((track) => !track.jump);
    const nearest = (sourceNode, target) => {
      let best = -1;
      let distance = gapRadius;
      target.members.forEach((targetNode) => {
        const span = Math.hypot(
          nodes[targetNode].x - nodes[sourceNode].x,
          nodes[targetNode].y - nodes[sourceNode].y,
        );
        if (span < distance) [best, distance] = [targetNode, span];
      });
      return { node: best, distance };
    };
    normalTracks.forEach((left, leftIndex) => {
      normalTracks.slice(leftIndex + 1).forEach((right) => {
        const rightToLeft = new Map(
          right.members.map((node) => [node, nearest(node, left)]),
        );
        left.members.forEach((leftNode) => {
          const match = nearest(leftNode, right);
          const reverse = rightToLeft.get(match.node);
          if (
            match.node >= 0 &&
            match.distance > joinRadius &&
            reverse?.node === leftNode
          ) connect(leftNode, match.node, true);
        });
      });
    });

    endpoints.filter((endpoint) => endpoint.jump).forEach((endpoint) => {
      if (nodes[endpoint.node].refs.some((reference) => reference.track !== endpoint.track)) {
        return;
      }
      let best = -1;
      let distance = gapRadius * 1.5;
      nodes.forEach((candidate, index) => {
        if (
          index === endpoint.node ||
          candidate.refs.some((reference) => reference.track === endpoint.track)
        ) return;
        const span = Math.hypot(
          candidate.x - nodes[endpoint.node].x,
          candidate.y - nodes[endpoint.node].y,
        );
        if (span < distance) [best, distance] = [index, span];
      });
      if (best >= 0) connect(endpoint.node, best, true);
    });
    return nodes;
  }

  function closestNode(point, predicate = () => true) {
    let best = -1;
    let distance = Infinity;
    state.graph.forEach((node, index) => {
      if (!predicate(node)) return;
      const candidate = Math.hypot(node.x - point.x, node.y - point.y);
      if (candidate < distance) [best, distance] = [index, candidate];
    });
    return best;
  }

  function mountPlayer(svg, dimensions) {
    state.overlay?.remove();
    const overlay = svgElement('g', { 'aria-label': 'Game player' });
    if (dimensions === 3) {
      const defs = svgElement('defs');
      const gradient = svgElement('radialGradient', {
        id: 'ete-game-sphere', cx: '30%', cy: '25%', r: '72%',
      });
      [['0%', '#eefaff'], ['25%', '#7fc6ec'], ['68%', '#347aa9'], ['100%', '#153b59']]
        .forEach(([offset, color]) => gradient.appendChild(svgElement('stop', {
          offset, 'stop-color': color,
        })));
      defs.appendChild(gradient);
      overlay.appendChild(defs);
    }
    const player = svgElement('circle', {
      class: 'ete-game-player',
      'data-dimensions': dimensions,
      r: dimensions === 3 ? 8 : 4.5,
    });
    overlay.appendChild(player);
    svg.appendChild(overlay);
    state.overlay = overlay;
    state.player = player;
  }

  function placePlayer() {
    const node = state.graph[state.current];
    if (!node || !state.player) return;
    state.player.setAttribute('cx', node.x);
    state.player.setAttribute('cy', node.y);
  }

  function jumpPlayer(from, to) {
    const token = ++state.animation;
    const distance = Math.hypot(to.x - from.x, to.y - from.y);
    const duration = Math.max(180, Math.min(520, distance * 7));
    const started = performance.now();
    const height = Math.min(24, Math.max(8, distance * 0.22));
    const frame = (now) => {
      if (token !== state.animation || !state.player) return;
      const progress = Math.min(1, (now - started) / duration);
      state.player.setAttribute('cx', from.x + (to.x - from.x) * progress);
      state.player.setAttribute(
        'cy',
        from.y + (to.y - from.y) * progress - Math.sin(Math.PI * progress) * height,
      );
      if (progress < 1) requestAnimationFrame(frame);
      else placePlayer();
    };
    requestAnimationFrame(frame);
  }

  function resetPlayer() {
    if (!state.scene || !state.graph.length) return;
    state.current = closestNode(state.scene.start);
    state.previous = -1;
    placePlayer();
  }

  function rebuild(scene, preserve = true) {
    const oldNode = state.graph[state.current];
    const oldRef = preserve ? oldNode?.refs[0] : null;
    const tracks = scene.dimensions === 2 ? tracksFrom2D(scene) : scene.tracks;
    state.graph = buildGraph(tracks, scene.dimensions);
    state.animation++;
    mountPlayer(scene.svg, scene.dimensions);
    state.current = -1;
    state.previous = -1;
    if (oldRef) {
      let difference = Infinity;
      state.graph.forEach((node, index) => node.refs.forEach((ref) => {
        const candidate = ref.track === oldRef.track ? Math.abs(ref.t - oldRef.t) : Infinity;
        if (candidate < difference) [state.current, difference] = [index, candidate];
      }));
    }
    if (state.current < 0) resetPlayer();
    else placePlayer();
  }

  function move(dx, dy) {
    const node = state.graph[state.current];
    if (!node) return;
    let best = -1;
    let bestScore = 0.2;
    let jump = false;
    node.neighbors.forEach((isJump, index) => {
      const candidate = state.graph[index];
      const length = Math.hypot(candidate.x - node.x, candidate.y - node.y) || 1;
      let score = ((candidate.x - node.x) * dx + (candidate.y - node.y) * dy) / length;
      if (index === state.previous) score -= 0.08;
      if (score > bestScore) [best, bestScore, jump] = [index, score, isJump];
    });
    if (best < 0) return;
    state.previous = state.current;
    state.current = best;
    if (jump) jumpPlayer(node, state.graph[best]);
    else placePlayer();
  }

  function setActive(active) {
    state.active = active;
    state.button?.setAttribute('aria-pressed', String(active));
    if (state.hint) state.hint.hidden = !active;
    if (!active) {
      state.animation++;
      state.overlay?.remove();
      state.overlay = state.player = null;
      return;
    }
    if (state.scene) rebuild(state.scene, false);
  }

  window.addEventListener('ete:game-scene', (event) => {
    const preserve = !state.resetPending &&
      state.revision === event.detail.revision &&
      state.dimensions === event.detail.dimensions;
    state.scene = event.detail;
    state.revision = event.detail.revision;
    state.dimensions = event.detail.dimensions;
    if (state.active) rebuild(event.detail, preserve);
    state.resetPending = false;
  });

  window.addEventListener('ete:game-reset', () => {
    if (!state.active) return;
    state.resetPending = true;
    state.button?.focus({ preventScroll: true });
  });

  window.addEventListener('keydown', (event) => {
    if (!state.active) return;
    if (event.key === 'Escape') return setActive(false);
    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      resetPlayer();
      return;
    }
    const direction = KEY_DIRECTIONS.get(event.key) || KEY_DIRECTIONS.get(event.key.toLowerCase());
    if (!direction || event.target.matches('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    move(...direction);
  });

  installInterface();
  window.EteGame = Object.freeze({ setActive, reset: resetPlayer });
})();
