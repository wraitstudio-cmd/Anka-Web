(function (global) {
    'use strict';

    if (global.AnkaRightClick) return;

    const menus = new Map();
    const active = [];
    const listeners = new Set();

    function notify(type, detail) {
        const signal = Object.freeze(Object.assign({ type }, detail || {}));
        listeners.forEach((listener) => listener(signal));
        global.dispatchEvent(new CustomEvent('anka-right-click', { detail: signal }));
    }

    function register(id, options) {
        const entry = Object.assign(menus.get(id) || {}, options || {}, { id });
        menus.set(id, entry);
        return entry;
    }

    function deactivate(id, reason) {
        const entry = menus.get(id);
        if (!entry) return;
        const index = active.indexOf(id);
        if (index < 0) {
            if (entry.trigger) entry.trigger.setAttribute('aria-expanded', 'false');
            return;
        }
        active.splice(index, 1);
        if (entry.trigger) entry.trigger.setAttribute('aria-expanded', 'false');
        notify('close', { id, reason: reason || 'programmatic' });
    }

    function close(id, reason) {
        const entry = menus.get(id);
        if (!entry || active.indexOf(id) < 0) return false;
        if (typeof entry.close === 'function') entry.close(reason || 'programmatic');
        if (active.indexOf(id) >= 0) deactivate(id, reason);
        return true;
    }

    function activate(id) {
        const entry = menus.get(id);
        if (!entry) return false;
        if (entry.group) {
            active.slice().reverse().forEach((otherId) => {
                const other = menus.get(otherId);
                if (other && otherId !== id && other.group === entry.group) close(otherId, 'replaced');
            });
        }
        const index = active.indexOf(id);
        if (index >= 0) {
            active.splice(index, 1);
            active.push(id);
            return true;
        }
        active.push(id);
        if (entry.trigger) entry.trigger.setAttribute('aria-expanded', 'true');
        notify('open', { id });
        return true;
    }

    function contains(entry, target) {
        if (!target) return false;
        const surfaces = [entry.panel, entry.trigger];
        const extraSurfaces = typeof entry.extraSurfaces === 'function' ? entry.extraSurfaces() : entry.extraSurfaces;
        if (Array.isArray(extraSurfaces)) surfaces.push.apply(surfaces, extraSurfaces);
        return surfaces.some((surface) => surface && (surface === target || surface.contains(target)));
    }

    global.addEventListener('pointerdown', (event) => {
        active.slice().reverse().forEach((id) => {
            const entry = menus.get(id);
            if (entry && entry.dismissOnOutside !== false && !contains(entry, event.target)) close(id, 'outside');
        });
    }, true);

    global.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const id = active[active.length - 1];
        const entry = id && menus.get(id);
        if (!entry || entry.dismissOnEscape === false) return;
        event.preventDefault();
        close(id, 'escape');
    }, true);

    global.addEventListener('blur', () => {
        active.slice().reverse().forEach((id) => close(id, 'blur'));
    });

    global.addEventListener('contextmenu', (event) => {
        notify('contextmenu', { event, target: event.target });
    }, true);

    global.AnkaRightClick = Object.freeze({
        register,
        activate,
        deactivate,
        close,
        signal: notify,
        subscribe(listener) {
            if (typeof listener !== 'function') throw new TypeError('Sağ tık dinleyicisi işlev olmalıdır.');
            listeners.add(listener);
            return () => listeners.delete(listener);
        }
    });
})(window);
