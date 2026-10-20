import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// No browser, network, or rewritten production functions. The DOM/map shell is
// mocked; Canvas redraw/cancellation methods and app functions are loaded verbatim.
const parent = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.argv[2] || parent);
const read = path => readFileSync(resolve(root, path), 'utf8');
const vendor = read('vendor/leaflet/leaflet.js');
const canvasStart = vendor.indexOf('Fi=Wi.extend(') + 'Fi=Wi.extend('.length;
const canvasEnd = vendor.indexOf(');function Ui', canvasStart);
assert(canvasStart >= 'Fi=Wi.extend('.length && canvasEnd > canvasStart, 'Update fixture extraction when vendored Leaflet changes');
const canvasSource = '(' + vendor.slice(canvasStart, canvasEnd) + ')';
function section(source, first, next) {
  const start = source.indexOf(first), end = source.indexOf(next, start);
  assert(start >= 0 && end > start, `Missing actual application section: ${first}`);
  return source.slice(start, end);
}
const initSource = section(read('app-init.js'), 'function initMainMap(', '\nfunction highlightMapResult');
const destroySource = section(read('app-init.js'), 'function destroyMap()', '\nfunction toast');
const renderSource = section(read('app-discovery.js'), 'function renderMapPage()', '\nfunction mapResultRow');

function frames() {
  let sequence = 0;
  const pending = new Map();
  return {
    pending,
    request(fn, self) { const id = ++sequence; pending.set(id, () => fn.call(self)); return id; },
    cancel(id) { pending.delete(id); },
    flush() {
      const errors = [];
      // Browser RAF callbacks queued during a frame belong to the next frame.
      for (const [id, fn] of [...pending]) {
        if (!pending.delete(id)) continue;
        try { fn(); } catch (error) { errors.push(error); }
      }
      return errors;
    }
  };
}
function makeCanvas(queue) {
  const methods = vm.runInNewContext(canvasSource, {
    x: (fn, self) => queue.request(fn, self), r: id => queue.cancel(id),
    T() {}, k() {}
  }, { filename: 'actual-vendored-leaflet-canvas.js' });
  return Object.assign(methods, {
    _map: {}, _layers: {},
    _ctx: { save() {}, restore() {}, setTransform() {}, clearRect() {} },
    _container: { width: 100, height: 100 }
  });
}

// Negative control proves the precise vendored failure, rather than merely
// assuming a fake renderer exhibits it. The lost frame survives destruction.
{
  const queue = frames(), renderer = makeCanvas(queue);
  renderer._requestRedraw({});
  assert.equal(queue.pending.size, 1);
  renderer._updatePaths();
  assert.equal(renderer._redrawRequest, null);
  assert.equal(queue.pending.size, 1, 'Synchronous redraw loses the queued frame handle');
  renderer._destroyContainer();
  const errors = queue.flush();
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Cannot read properties of undefined \(reading 'save'\)/);
}

function harness() {
  const queue = frames(), order = [], maps = [];
  const records = [
    { id: 'a', name: 'A', neighborhood: 'A', coordinates: { lat: 44.6, lon: -63.5 } },
    { id: 'b', name: 'B', neighborhood: 'B', coordinates: { lat: 44.7, lon: -63.6 } },
    { id: 'unknown', name: 'Unknown', neighborhood: 'Unknown', coordinates: null }
  ];
  let element = { isConnected: true };
  const state = { neighbourhood: 'A' };
  const L = {
    map(node) {
      order.push('map'); node._leaflet_id = maps.length + 1;
      const map = {
        renderers: new Set(), setView() { return this; },
        fitBounds() {
          order.push('fitBounds');
          // Leaflet fitBounds causes synchronous renderer path updates.
          for (const renderer of this.renderers) renderer._updatePaths();
        },
        stop() {}, closeTooltip() {}, closePopup() {}, eachLayer() {}, off() {},
        remove() {
          for (const renderer of this.renderers) { renderer._destroyContainer(); renderer._map = null; }
          delete node._leaflet_id;
        }
      };
      maps.push(map); return map;
    },
    tileLayer: () => ({ addTo() {} }),
    canvas() { order.push('canvas'); return makeCanvas(queue); },
    layerGroup: () => ({ addTo(map) { this.map = map; return this; } }),
    circleMarker(coords, { renderer }) {
      order.push('marker');
      return {
        bindTooltip() {}, on() {}, getLatLng: () => coords,
        addTo(layer) { renderer._map = layer.map; layer.map.renderers.add(renderer); renderer._requestRedraw({}); }
      };
    },
    latLngBounds: values => values
  };
  const context = vm.createContext({
    console, Map, window: { L }, L, state, activeRestaurants: records,
    mapUiMode: 'map', MAP_DEFAULT: [44.6, -63.5],
    document: {
      querySelector: selector => selector === '#mainMap' ? element : { addEventListener() {} },
      querySelectorAll: () => []
    },
    appView: { set innerHTML(value) { element.isConnected = false; element = { isConnected: true }; } },
    requestAnimationFrame: fn => queue.request(fn),
    filteredRestaurants: ({ neighbourhood }) => records.filter(r => neighbourhood === 'all' || r.neighborhood === neighbourhood),
    discoveryNeighbourhoodOptions: () => ['A', 'B', 'Unknown'], escapeHtml: value => value,
    restaurantCard: () => '', mapResultRow: () => '', bindCommonActions() {},
    hardenLeafletAttributionLinks() {}, categoryColor: () => ''
  });
  vm.runInContext([initSource, destroySource, renderSource].join('\n'), context, { filename: 'actual-mainmap-application.js' });
  return { queue, order, maps, state, records, run: code => vm.runInContext(code, context) };
}

// Actual init must fit before Canvas/marker construction. Immediate route teardown
// must cancel the still-pending native renderer frame, not hide its exception.
{
  const h = harness();
  h.run("initMainMap(activeRestaurants.filter(r => r.neighborhood === 'A'))");
  assert(h.order.indexOf('fitBounds') < h.order.indexOf('canvas'), 'Fit bounds before Canvas construction');
  assert(h.order.indexOf('fitBounds') < h.order.indexOf('marker'), 'Fit bounds before marker redraws are queued');
  assert.equal(h.queue.pending.size, 1);
  h.run('destroyMap()');
  assert.equal(h.queue.pending.size, 0, 'Teardown cancels pending native Canvas frame');
  assert.deepEqual(h.queue.flush(), []);
}

// Actual render queue: the older callback must not initialize a replacement DOM
// element with stale community results, even before the first animation frame.
{
  const h = harness();
  h.run("renderMapPage(); destroyMap(); state.neighbourhood = 'B'; renderMapPage();");
  assert.deepEqual(h.queue.flush(), []);
  assert.equal(h.maps.length, 1, 'Disconnected old element must not create a map');
  assert.deepEqual([...h.state.mapMarkers.keys()], ['b'], 'Newest community owns the map markers');
  h.run('destroyMap()');
  assert.equal(h.queue.pending.size, 0);
  assert.deepEqual(h.queue.flush(), []);
}

// Repeat immediate teardown for located, unlocated, and unfiltered communities.
{
  const h = harness();
  for (const area of ['A', 'B', 'Unknown', 'all', 'A', 'B']) {
    h.state.neighbourhood = area;
    h.run('renderMapPage()');
    assert.deepEqual(h.queue.flush(), []);
    const expected = h.records.filter(r => r.coordinates && (area === 'all' || r.neighborhood === area)).map(r => r.id);
    assert.deepEqual([...h.state.mapMarkers.keys()], expected);
    h.run('destroyMap()');
    assert.deepEqual(h.queue.flush(), []);
    assert.equal(h.queue.pending.size, 0);
  }
}
console.log('Main-map lifecycle passed: actual vendored Canvas failure reproduced, fit-before-markers, canceled teardown frames, latest-element ownership, and repeated filters.');
