import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// No browser, network, or rewritten production functions. The DOM/map shell is
// mocked; native Map, Canvas, SVG and app methods are loaded verbatim.
const parent = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.argv[2] || parent);
const read = path => readFileSync(resolve(root, path), 'utf8');
const vendor = read('vendor/leaflet/leaflet.js');
const canvasStart = vendor.indexOf('Fi=Wi.extend(') + 'Fi=Wi.extend('.length;
const canvasEnd = vendor.indexOf(');function Ui', canvasStart);
assert(canvasStart >= 'Fi=Wi.extend('.length && canvasEnd > canvasStart, 'Update fixture extraction when vendored Leaflet changes');
const canvasSource = '(' + vendor.slice(canvasStart, canvasEnd) + ')';
const svgStart = vendor.indexOf('Gi=Wi.extend(') + 'Gi=Wi.extend('.length;
const svgEnd = vendor.indexOf(');function Ki', svgStart);
assert(svgStart >= 'Gi=Wi.extend('.length && svgEnd > svgStart, 'Update SVG fixture extraction when vendored Leaflet changes');
const svgSource = '(' + vendor.slice(svgStart, svgEnd) + ')';
const baseStart = vendor.indexOf('Wi=o.extend(') + 'Wi=o.extend('.length;
const baseEnd = vendor.indexOf('),Fi=Wi.extend', baseStart);
assert(baseStart >= 'Wi=o.extend('.length && baseEnd > baseStart, 'Missing native Renderer methods');
const baseSource = '(' + vendor.slice(baseStart, baseEnd) + ')';
function nativeMethod(startToken, endToken) {
  const start = vendor.indexOf(startToken), end = vendor.indexOf(endToken, start);
  assert(start >= 0 && end > start, 'Missing native Map method: ' + startToken);
  return vendor.slice(start + startToken.indexOf(':') + 1, end);
}
// Actual public stop -> setZoom -> setView -> panBy(0) fires moveend even
// with no zoom change. Modeling stop as a no-op misses the teardown redraw.
const nativeMap = vm.runInNewContext('({' + [
  ['stop', 'stop:function(){return this.setZoom', ',locate:function'],
  ['setZoom', 'setZoom:function', ',zoomIn:function'],
  ['setView', 'setView:function', ',setZoom:function'],
  ['_tryAnimatedPan', '_tryAnimatedPan:function', ',_createAnimProxy:function'],
  ['panBy', 'panBy:function', ',flyTo:function'],
  ['_stop', '_stop:function', ',_rawPanBy:function']
].map(([name, start, end]) => name + ':' + nativeMethod(start, end)).join(',') + '})', {
  w: value => value, m: value => value, l: Object.assign, clearTimeout() {}, r() {}
});
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

function makeSvg() {
  let next = 0;
  const node = tag => ({ tag, attributes: {}, children: [], parentNode: null,
    setAttribute(key, value) { this.attributes[key] = value; },
    removeAttribute(key) { delete this.attributes[key]; },
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
  });
  const bindings = { qi: node, T: value => value?.parentNode?.removeChild(value), k() {}, M() {}, h: value => value._leaflet_id ||= ++next };
  const methods = vm.runInNewContext(svgSource, bindings, { filename: 'actual-vendored-leaflet-svg.js' });
  const base = vm.runInNewContext(baseSource, {}, { filename: 'actual-vendored-leaflet-renderer.js' });
  Object.setPrototypeOf(methods, base);
  methods._layers = {};
  methods._initContainer();
  return methods;
}
function attachNativeMapMethods(map) {
  Object.assign(map, nativeMap, {
    _loaded: true, _zoom: 12, options: { zoomSnap: 1 },
    _limitZoom: value => value, _limitCenter: value => value,
    getCenter: () => [44.6, -63.5],
    _getCenterOffset: () => ({ x: 0, y: 0, _trunc() { return this; }, round() { return this; } }),
    getSize: () => ({ contains: () => true }),
    fire(event) {
      if (event === 'moveend') for (const renderer of this.renderers) renderer._updatePaths();
      return this;
    }
  });
  return map;
}

// Negative control proves the precise vendored failure, rather than merely
// assuming a fake renderer exhibits it. The lost frame survives destruction.
{
  const queue = frames(), renderer = makeCanvas(queue);
  renderer._requestRedraw({});
  assert.equal(queue.pending.size, 1);
  const map = attachNativeMapMethods({ renderers: new Set([renderer]) });
  map.stop();
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
    map(node, options) {
      assert.equal(options.preferCanvas, false, 'Use supported SVG, not the Canvas redraw queue');
      order.push('map'); node._leaflet_id = maps.length + 1;
      const map = {
        renderers: new Set(), setView() { return this; },
        fitBounds() {
          order.push('fitBounds');
          // Leaflet fitBounds causes synchronous renderer path updates.
          for (const renderer of this.renderers) renderer._updatePaths();
        },
        closeTooltip() {}, closePopup() {}, eachLayer() {}, off() {},
        remove() {
          for (const renderer of this.renderers) {
            // Exercise removal in both orders: paths before/after container.
            const paths = Object.values(renderer._layers);
            if (maps.length % 2) for (const path of paths) renderer._removePath(path);
            renderer._destroyContainer(); renderer._map = null;
            if (!(maps.length % 2)) for (const path of paths) renderer._removePath(path);
            assert.equal(Object.keys(renderer._layers).length, 0);
            assert.equal(renderer._container, undefined);
          }
          delete node._leaflet_id;
        }
      };
      attachNativeMapMethods(map);
      map.errors = [];
      for (const method of ['stop', 'remove']) {
        const native = map[method];
        map[method] = function (...args) {
          try { return native.apply(this, args); }
          catch (error) { this.errors.push(error); throw error; }
        };
      }
      maps.push(map); return map;
    },
    tileLayer: () => ({ addTo() {} }),
    canvas() { assert.fail('Main map must not use the vulnerable Canvas redraw queue'); },
    svg() { order.push('svg'); return makeSvg(); },
    layerGroup: () => ({ addTo(map) { this.map = map; return this; } }),
    circleMarker(coords, options) {
      const { renderer } = options;
      order.push('marker');
      return {
        options, _point: { x: 50, y: 50 }, _radius: 6, _empty: () => false,
        bindTooltip() {}, on() {}, getLatLng: () => coords,
        addInteractiveTarget() {}, removeInteractiveTarget() {}, _project() {},
        _update() { renderer._updateCircle(this); },
        addTo(layer) {
          renderer._map = layer.map; layer.map.renderers.add(renderer);
          renderer._initPath(this); renderer._addPath(this); renderer._updateCircle(this);
          assert.match(this._path.attributes.d, /^M/, 'Native SVG circle path is rendered');
        }
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

// Actual init must use SVG; fit occurs before marker construction. Public stop
// redraws actual SVG paths synchronously, with no orphan animation frame.
{
  const h = harness();
  h.run("initMainMap(activeRestaurants.filter(r => r.neighborhood === 'A'))");
  assert(h.order.indexOf('fitBounds') < h.order.indexOf('svg'), 'Fit bounds before SVG construction');
  assert(h.order.indexOf('fitBounds') < h.order.indexOf('marker'), 'Fit bounds before marker redraws are queued');
  assert.equal(h.queue.pending.size, 0, 'SVG markers do not queue Canvas redraw frames');
  h.run('destroyMap()');
  assert.deepEqual(h.maps.flatMap(map => map.errors), [], 'Teardown must not swallow renderer errors');
  assert.equal(h.queue.pending.size, 0, 'SVG teardown leaves no pending frame');
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
  assert.deepEqual(h.maps.flatMap(map => map.errors), [], 'Teardown must not swallow renderer errors');
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
  assert.deepEqual(h.maps.flatMap(map => map.errors), [], 'Teardown must not swallow renderer errors');
    assert.deepEqual(h.queue.flush(), []);
    assert.equal(h.queue.pending.size, 0);
  }
}
console.log('Main-map lifecycle passed: native Map.stop Canvas failure reproduced, actual SVG circle/update/removal, both teardown orders, latest-element ownership, and repeated filters.');
