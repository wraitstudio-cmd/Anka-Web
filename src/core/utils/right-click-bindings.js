(function (global) {
    'use strict';

    const menus = global.AnkaRightClick;
    if (!menus) throw new Error('Sağ tık menü yardımcısı yüklenemedi.');

    function bindToggle(name, id, panel, trigger, isOpen, close) {
        menus.register(id, {
            panel,
            trigger,
            group: 'app-menus',
            isOpen,
            close,
            dismissOnOutside: true,
            dismissOnEscape: true
        });
        const original = global[name];
        if (typeof original !== 'function') return;
        global[name] = function () {
            const result = original.apply(this, arguments);
            if (isOpen()) menus.activate(id);
            else menus.deactivate(id);
            return result;
        };
    }

    function settingEnabled(id) {
        try {
            return global.localStorage.getItem('set_' + id) !== 'false';
        } catch (error) {
            console.error('Hızlı menü ayarı okunamadı:', error);
            return true;
        }
    }

    function createAction(label, action, marker) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'quick-action-item';
        button.setAttribute('role', 'menuitem');
        button.dataset.ankaExtraAction = marker;
        button.textContent = label;
        button.addEventListener('click', action);
        return button;
    }

    function showGroups(menu, trigger) {
        const groups = typeof global.__ankaGetTabGroups === 'function' ? global.__ankaGetTabGroups() : [];
        const header = document.createElement('div');
        header.className = 'quick-action-heading';
        const back = document.createElement('button');
        back.type = 'button';
        back.textContent = '‹';
        back.setAttribute('aria-label', 'Hızlı menüye dön');
        back.addEventListener('click', () => {
            global.closeQuickActions();
            global.openQuickActions({
                preventDefault() {},
                stopPropagation() {},
                currentTarget: trigger
            });
        });
        const title = document.createElement('span');
        title.textContent = 'Sekme Grupları';
        header.append(back, title);
        menu.replaceChildren(header);

        if (!groups.length) {
            const empty = document.createElement('div');
            empty.className = 'quick-action-empty';
            empty.textContent = 'Henüz sekme grubu yok. Sekme menüsünden bir grup oluşturabilirsiniz.';
            menu.appendChild(empty);
        }

        groups.forEach((group) => {
            const heading = document.createElement('div');
            heading.className = 'quick-action-group';
            heading.textContent = group.name;
            menu.appendChild(heading);
            group.tabs.forEach((tab) => {
                menu.appendChild(createAction(tab.title, () => {
                    global.closeQuickActions();
                    if (typeof global.__ankaActivateTab === 'function') global.__ankaActivateTab(tab.id);
                }, 'group-tab'));
            });
        });
        const manage = createAction('Sekme Grubu Yöneticisi', () => {
            global.closeQuickActions();
            if (typeof global.__ankaManageTabGroups === 'function') global.__ankaManageTabGroups();
        }, 'group-manager');
        menu.appendChild(manage);
        if (global.AnkaI18n) global.AnkaI18n.applyPageLanguage(menu);
    }

    function renameWindow() {
        if (typeof global.ankaPrompt !== 'function') throw new Error('Pencere adı penceresi açılamadı.');
        return Promise.resolve(global.ankaPrompt('Bu pencere için bir ad girin:', {
            title: 'Pencereye Ad Ver',
            value: global.localStorage.getItem('anka_window_title') || '',
            inputLabel: 'Pencere adı',
            maxLength: 64
        })).then((value) => {
            if (value === null) return;
            const name = String(value).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
            try {
                if (name) global.localStorage.setItem('anka_window_title', name);
                else global.localStorage.removeItem('anka_window_title');
            } catch (error) {
                console.error('Pencere adı kaydedilemedi:', error);
                if (typeof global.showToast === 'function') global.showToast('Pencere adı kaydedilemedi.', 'error');
                return;
            }
            if (typeof global.safeIpcSend === 'function') global.safeIpcSend('set-window-title', name);
        });
    }

    function refreshQuickActionsMenu() {
        const menu = document.getElementById('quick-actions-menu');
        const trigger = document.getElementById('quick-actions-btn');
        if (!menu || menu.hidden) return;
        menu.querySelectorAll('[data-anka-extra-action]').forEach((item) => item.remove());

        if (settingEnabled('quick-menu-groups')) {
            menu.appendChild(createAction('Sekme Grupları', () => showGroups(menu, trigger), 'groups'));
        }
        if (settingEnabled('quick-menu-help')) {
            menu.appendChild(createAction('Yardım', () => {
                global.closeQuickActions();
                if (typeof global.openAnkaPage === 'function') global.openAnkaPage('help');
            }, 'help'));
        }
        if (settingEnabled('quick-menu-window-name')) {
            menu.appendChild(createAction('Pencereye Ad Ver', () => {
                global.closeQuickActions();
                Promise.resolve().then(renameWindow).catch((error) => {
                    console.error('Pencere adı değiştirilemedi:', error);
                    if (typeof global.showToast === 'function') global.showToast('Pencere adı değiştirilemedi.', 'error');
                });
            }, 'window-name'));
        }
    }

    const quickMenu = document.getElementById('quick-actions-menu');
    const quickButton = document.getElementById('quick-actions-btn');
    bindToggle('closeQuickActions', 'quick-actions', quickMenu, quickButton,
        () => !!quickMenu && !quickMenu.hidden,
        () => global.closeQuickActions());
    const originalOpenQuickActions = global.openQuickActions;
    if (typeof originalOpenQuickActions === 'function') {
        global.openQuickActions = function () {
            const result = originalOpenQuickActions.apply(this, arguments);
            refreshQuickActionsMenu();
            if (quickMenu && !quickMenu.hidden) menus.activate('quick-actions');
            else menus.deactivate('quick-actions');
            return result;
        };
    }
    global.refreshQuickActionsMenu = refreshQuickActionsMenu;

    const contextMenu = document.getElementById('ctx-menu');
    bindToggle('hideContextMenu', 'renderer-context-menu', contextMenu, null,
        () => !!contextMenu && !contextMenu.hidden,
        () => global.hideContextMenu());

    const tabMenu = document.getElementById('tab-dropdown-menu');
    const tabButton = document.getElementById('tab-dropdown-btn');
    bindToggle('closeTabDropdown', 'tab-dropdown', tabMenu, tabButton,
        () => !!tabMenu && tabMenu.classList.contains('open'),
        () => global.closeTabDropdown());

    global.AnkaRightClickBindings = true;
})(window);
