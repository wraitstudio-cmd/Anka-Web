(function (global) {
    'use strict';

    if (global.AnkaWindowUtils) return;

    const windows = new Map();
    let activeId = '';

    function isOpen(entry) {
        return !!entry.isOpen();
    }

    function setExpanded(entry, expanded) {
        if (entry.trigger) entry.trigger.setAttribute('aria-expanded', String(expanded));
        if (entry.panel) entry.panel.setAttribute('aria-hidden', String(!expanded));
    }

    function register(id, options) {
        const config = options || {};
        const entry = Object.assign(windows.get(id) || {}, config, { id });
        windows.set(id, entry);
        if (entry.panel) {
            entry.panel.dataset.ankaWindow = id;
            if (entry.role && !entry.panel.hasAttribute('role')) entry.panel.setAttribute('role', entry.role);
            else if (entry.group === 'modal' && !entry.panel.hasAttribute('role')) entry.panel.setAttribute('role', 'dialog');
        }
        return entry;
    }

    function deactivate(id) {
        const entry = windows.get(id);
        if (!entry) return;
        if (activeId === id) activeId = '';
        setExpanded(entry, false);
    }

    function close(id, reason) {
        const entry = windows.get(id);
        if (!entry || !isOpen(entry) || typeof entry.close !== 'function') return false;
        entry.close(reason || 'programmatic');
        deactivate(id);
        return true;
    }

    function activate(id) {
        const entry = windows.get(id);
        if (!entry) return;
        if (entry.group) {
            windows.forEach((other, otherId) => {
                if (otherId !== id && other.group === entry.group && isOpen(other)) close(otherId, 'replaced');
            });
        }
        activeId = id;
        setExpanded(entry, true);
    }

    function contains(entry, target) {
        if (!target) return false;
        const surfaces = [entry.panel, entry.overlay, entry.trigger];
        if (Array.isArray(entry.extraSurfaces)) surfaces.push.apply(surfaces, entry.extraSurfaces);
        return surfaces.some((surface) => surface && (surface === target || surface.contains(target)));
    }

    global.addEventListener('pointerdown', (event) => {
        const entries = Array.from(windows.values()).reverse();
        for (const entry of entries) {
            if (!isOpen(entry) || entry.dismissOnOutside === false || contains(entry, event.target)) continue;
            close(entry.id, 'outside');
            return;
        }
    }, true);

    global.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const entry = windows.get(activeId);
        if (!entry || entry.dismissOnEscape === false || !isOpen(entry)) return;
        event.preventDefault();
        close(entry.id, 'escape');
    }, true);

    global.AnkaWindowUtils = Object.freeze({ register, activate, deactivate, close });
})(window);
