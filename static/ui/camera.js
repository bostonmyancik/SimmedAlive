// The camera: which part of the world is on screen, and at what zoom.
// The world wraps east-west, so panning sideways never hits an edge.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mod = (v, m) => ((v % m) + m) % m;

export function createCamera(worldW, worldH) {
  const cam = {
    x: worldW / 2, // world point at the centre of the view
    y: worldH / 2,
    zoom: 1,       // screen pixels per world pixel
    viewW: 1,
    viewH: 1,
    minZoom: 0.1,
    maxZoom: 6,

    // Call when the map area changes size.
    resize(viewW, viewH) {
      const wasFitted = cam.zoom <= cam.minZoom;
      cam.viewW = Math.max(1, viewW);
      cam.viewH = Math.max(1, viewH);
      // Never zoom out past one full world width, so nothing appears twice.
      cam.minZoom = cam.viewW / worldW;
      if (wasFitted) cam.zoom = cam.minZoom;
      constrain();
    },

    // Zoom all the way out and centre the world.
    fit() {
      cam.zoom = cam.minZoom;
      cam.x = worldW / 2;
      cam.y = worldH / 2;
      constrain();
    },

    // Zoom so the world fills the view from top to bottom (pan sideways to see the rest).
    fill() {
      cam.zoom = Math.max(cam.minZoom, cam.viewH / worldH);
      cam.y = worldH / 2;
      constrain();
    },

    // World x of the left edge of the view (may be negative or past worldW).
    left() {
      return cam.x - cam.viewW / cam.zoom / 2;
    },

    top() {
      return cam.y - cam.viewH / cam.zoom / 2;
    },

    // Converts a point in the view to world coordinates (x wrapped into the world).
    toWorld(sx, sy) {
      return { x: mod(cam.left() + sx / cam.zoom, worldW), y: cam.top() + sy / cam.zoom };
    },

    panBy(dxScreen, dyScreen) {
      cam.x -= dxScreen / cam.zoom;
      cam.y -= dyScreen / cam.zoom;
      constrain();
    },

    // Zooms by `factor`, keeping the world point under (sx, sy) where it is.
    zoomAt(sx, sy, factor) {
      const wx = cam.left() + sx / cam.zoom;
      const wy = cam.top() + sy / cam.zoom;
      cam.zoom = clamp(cam.zoom * factor, cam.minZoom, cam.maxZoom);
      cam.x = wx - (sx - cam.viewW / 2) / cam.zoom;
      cam.y = wy - (sy - cam.viewH / 2) / cam.zoom;
      constrain();
    },
  };

  function constrain() {
    cam.zoom = clamp(cam.zoom, cam.minZoom, cam.maxZoom);
    cam.x = mod(cam.x, worldW);
    const halfH = cam.viewH / cam.zoom / 2;
    // If the whole height fits, centre it; otherwise stop at the north and south edges.
    cam.y = halfH * 2 >= worldH ? worldH / 2 : clamp(cam.y, halfH, worldH - halfH);
  }

  return cam;
}
