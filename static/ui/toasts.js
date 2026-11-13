// Pop-up alerts for events as they happen, and which kinds of event to alert on.

// The groups of events the user can choose to be alerted about, in the order
// Settings lists them. `kinds` are the event kinds (see logEvent in sim.js).
export const TOAST_GROUPS = [
  { key: 'species', label: 'New species', kinds: ['species'], on: true },
  { key: 'extinct', label: 'Extinctions', kinds: ['extinct'], on: true },
  { key: 'trends', label: 'Booms and crashes', kinds: ['boom', 'crash'], on: true },
  { key: 'evolve', label: 'Evolution stages', kinds: ['evolve'], on: true },
  { key: 'ability', label: 'Abilities spreading or lost', kinds: ['ability'], on: true },
  { key: 'mutation', label: 'Newborns gaining an ability', kinds: ['mutation'], on: false },
  { key: 'weather', label: 'Heat, cold and droughts', kinds: ['heat', 'cold', 'drought'], on: true },
  { key: 'disaster', label: 'Plagues and meteors', kinds: ['plague', 'meteor'], on: true },
];

const SHOW_FOR = 6000;  // milliseconds a toast stays up
const MAX_SHOWN = 3;    // most toasts on screen at once

// The defaults: alerts on, every group on except the noisiest.
export function defaultToastSettings() {
  const groups = {};
  for (const group of TOAST_GROUPS) groups[group.key] = group.on;
  return { enabled: true, groups };
}

// Settings read back from storage, with anything missing or malformed set to its default.
export function tidyToastSettings(stored) {
  const settings = defaultToastSettings();
  if (!stored || typeof stored !== 'object') return settings;
  if (typeof stored.enabled === 'boolean') settings.enabled = stored.enabled;
  for (const group of TOAST_GROUPS) {
    if (typeof stored.groups?.[group.key] === 'boolean') settings.groups[group.key] = stored.groups[group.key];
  }
  return settings;
}

// Whether an event should pop up under these settings.
export function wantsToast(settings, event) {
  if (!settings.enabled) return false;
  const group = TOAST_GROUPS.find((g) => g.kinds.includes(event.kind));
  return !!group && settings.groups[group.key];
}

// Shows toasts in `container`. `onOpen` runs when one is clicked (to show the
// full event log). show(events) pops up a batch; if there are more than fit,
// the newest few appear with one more toast counting the rest.
export function createToasts(container, onOpen) {
  function dismiss(toast) {
    if (!toast.isConnected) return;
    clearTimeout(toast.timer);
    toast.remove();
  }

  function add(kind, text, when) {
    const toast = document.createElement('div');
    toast.className = 'toast ' + kind;
    toast.innerHTML = '<span class="pip"></span><button class="body" title="Show all events"></button><button class="close" aria-label="Dismiss">&times;</button>';
    const body = toast.querySelector('.body');
    body.textContent = text;
    if (when) {
      const tick = document.createElement('span');
      tick.className = 'when';
      tick.textContent = when;
      body.append(tick);
    }
    body.onclick = () => {
      onOpen();
      dismiss(toast);
    };
    toast.querySelector('.close').onclick = () => dismiss(toast);
    toast.timer = setTimeout(() => dismiss(toast), SHOW_FOR);
    container.prepend(toast); // newest on top
    while (container.children.length > MAX_SHOWN) dismiss(container.lastElementChild);
  }

  function show(events, describeTick) {
    if (!events.length) return;
    const fit = events.length > MAX_SHOWN ? MAX_SHOWN - 1 : MAX_SHOWN;
    const extra = events.length - fit;
    if (extra > 0) add('more', 'And ' + extra + ' more ' + (extra === 1 ? 'event' : 'events'), '');
    for (const e of events.slice(-fit)) add(e.kind, e.text, describeTick(e.tick));
  }

  function clear() {
    for (const toast of [...container.children]) dismiss(toast);
  }

  return { show, clear };
}
