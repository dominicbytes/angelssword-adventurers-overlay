const test = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const { createEffectsOverlay, effectFrame } = require('../overlay');

function createElement(tagName) {
  return {
    tagName,
    children: [],
    style: {},
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
    },
    remove() {
      if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    }
  };
}

test('calculates bounded toss and particle motion through cleanup time', () => {
  const toss = { kind: 'tossable', startedAt: 1000, durationMs: 2000 };
  assert.deepEqual(effectFrame(toss, 1000), {
    x: 8, y: 72, rotate: 0, scale: 1, opacity: 1
  });
  const apex = effectFrame(toss, 2000);
  assert.equal(apex.x, 50);
  assert.equal(apex.y, 14);
  assert.equal(effectFrame(toss, 3000).opacity, 0);

  const particle = effectFrame({ kind: 'particle', seed: 5, startedAt: 0, durationMs: 1000 }, 500);
  assert.ok(particle.x >= 0 && particle.x <= 100);
  assert.ok(particle.y >= 0 && particle.y <= 100);
  assert.equal(particle.opacity, 0.5);
});

test('keeps held props stationary', () => {
  const item = { kind: 'prop', startedAt: 0, durationMs: 0 };
  assert.deepEqual(effectFrame(item, 0), effectFrame(item, 100000));
});

test('reconciles replayed snapshots without duplicates or expired effects', () => {
  const root = createElement('div');
  let onEvent;
  let frameRequests = 0;
  const overlay = createEffectsOverlay({
    on(_name, handler) {
      onEvent = handler;
      return () => {};
    }
  }, {
    document: {
      body: root,
      createElement,
      getElementById: () => root
    },
    now: () => 5000,
    requestFrame() {
      frameRequests += 1;
      return frameRequests;
    },
    cancelFrame() {}
  });
  const layer = root.children[0];
  const message = items => onEvent({
    pluginId: 'props-tossables-particles',
    event: 'snapshot',
    data: { items }
  });

  message([{ id: 'old', preset: 'confetti', kind: 'particle', startedAt: 0, durationMs: 100 }]);
  assert.equal(layer.children.length, 0);
  assert.equal(frameRequests, 0);

  const held = { id: 'held', preset: 'held-star', kind: 'prop', startedAt: 1000, durationMs: 0 };
  message([held]);
  message([held]);
  assert.equal(layer.children.length, 1);
  message([]);
  assert.equal(layer.children.length, 0);
  overlay.destroy();
});

test('ships transparent overlay styling and SVG placeholders', () => {
  const pluginDir = path.join(__dirname, '..');
  const css = fs.readFileSync(path.join(pluginDir, 'plugin.css'), 'utf8');
  const svg = fs.readFileSync(path.join(pluginDir, 'assets', 'confetti.svg'), 'utf8');

  assert.match(css, /pointer-events:\s*none/);
  assert.doesNotMatch(css, /background(?:-color)?:/);
  assert.match(svg, /^<svg/);
  assert.doesNotMatch(svg, /<rect[^>]+(?:fill|style)=/);
});
