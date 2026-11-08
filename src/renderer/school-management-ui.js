'use strict';

const ipc = require('electron').ipcRenderer;
const byId = (id) => document.getElementById(id);
let currentState = null;
let adminPassword = '';
let unlocked = false;
let pairingCode = '';
let pairingExpiresAt = 0;
let pairingNotice = '';
let inviteExpiresAt = 0;
let stateTimer = 0;

const labels = {
  'not-authorized': 'Bu işlem için izin verilmiyor.',
  'not-configured': 'Yönetici parolası henüz oluşturulmamış.',
  'already-configured': 'Yönetici parolası daha önce oluşturulmuş.',
  'weak-password': 'Parola en az 14 karakter olmalı; büyük/küçük harf, sayı ve simge içermeli.',
  'invalid-password': 'Yönetici parolası doğru değil.',
  'locked': 'Çok sayıda hatalı deneme yapıldı. Bir dakika sonra tekrar deneyin.',
  'server-start-failed': 'Sunucu başlatılamadı. Bağlantı noktası veya güvenlik duvarını kontrol edin.',
  'server-not-running': 'Önce yönetici sunucusunu başlatın.',
  'invalid-policy': 'Okul politikası geçersiz.',
  'invalid-policy-targets': 'Seçilen bilgisayarlardan biri artık eşleştirilmiş değil.',
  'secure-storage-unavailable': 'Bu bilgisayarda güvenli parola saklama kullanılamıyor.',
  'fingerprint-mismatch': 'Güvenlik parmak izi eşleşmedi. Bağlantı kesildi.',
  'connection-failed': 'Yönetici bilgisayarına bağlanılamadı. IP, port ve yerel ağı kontrol edin.',
  'request-denied': 'Yönetici bağlantı isteğini reddetti.',
  'request-expired': 'Bağlantı isteğinin süresi doldu.',
  'approval-timeout': 'Yönetici onayı beklenirken zaman aşımına uğradı.',
  'device-revoked': 'Bu bilgisayar yöneticiden kaldırılmış.',
  'not-paired': 'Bu bilgisayar bir yöneticiyle eşleştirilmemiş.',
  'save-failed': 'Değişiklikler güvenli biçimde kaydedilemedi.',
  'weak-transfer-password': 'Davet parolası en az 14 karakter ve büyük/küçük harf, sayı ve simge içermeli.',
  'invalid-invite-host': 'Diğer bilgisayarın kullanacağı IP adresi geçerli değil.',
  'invite-save-failed': 'Şifreli davet dosyası kaydedilemedi.',
  'invite-read-failed': 'Davet dosyası okunamadı.',
  'invite-password-or-file-invalid': 'Davet dosyası parolası yanlış veya dosya geçersiz.',
  'invalid-invite-file': 'Seçilen dosya geçerli bir Anka Web daveti değil veya kodun süresi dolmuş.',
  'file-dialog-unavailable': 'Dosya seçme penceresi bu ortamda kullanılamıyor.'
};

const policyGroups = [
  {
    label: 'Temel ve sekmeler',
    settings: [
      { id: 'notifications', label: 'Uygulama içi bildirimler', help: 'Anka Web bildirimlerini göster.', type: 'toggle', value: true },
      { id: 'auto-save', label: 'Otomatik kayıt', help: 'Çalışma alanını ve tercihleri otomatik kaydet.', type: 'toggle', value: true },
      { id: 'show-welcome-on-start', label: 'Açılış tanıtımı', help: 'Başlangıç tanıtımını göster.', type: 'toggle', value: true },
      { id: 'tab-memory', label: 'Sekme bellek göstergesi', help: 'Sekmeler için yaklaşık bellek göstergesini aç.', type: 'toggle', value: false },
      { id: 'vertical-tabs', label: 'Dikey sekmeler', help: 'Sekme listesini dikey göster.', type: 'toggle', value: false },
      { id: 'confirm-close-tabs', label: 'Sekme kapatma onayı', help: 'Birden fazla sekme açıkken onay iste.', type: 'toggle', value: false },
      { id: 'auto-suspend-tabs', label: 'Kullanılmayan sekmeleri askıya al', help: 'Uzun süre kullanılmayan sekmelerin belleğini boşalt.', type: 'toggle', value: false }
    ]
  },
  {
    label: 'Görünüm ve erişilebilirlik',
    settings: [
      { id: 'theme-preset', label: 'Tema', help: 'Arayüzün renk temasını seç.', type: 'select', value: 'system', choices: [['system', 'Sistem'], ['dark', 'Koyu'], ['light', 'Açık'], ['catppuccin', 'Catppuccin'], ['cyberpunk', 'Cyberpunk'], ['dracula', 'Dracula'], ['nord', 'Nord'], ['oled', 'OLED'], ['emerald', 'Emerald'], ['sunset', 'Gün Batımı'], ['forest', 'Orman'], ['rose', 'Gül'], ['slate', 'Arduvaz']] },
      { id: 'bookmarks-bar', label: 'Yer imleri çubuğu', help: 'Çubuğun görünme biçimini seç.', type: 'select', value: 'auto', choices: [['auto', 'Otomatik'], ['always', 'Her zaman'], ['never', 'Gizli']] },
      { id: 'sidebar-side', label: 'Sol menü konumu', help: 'Ana araç menüsünü yerleştir.', type: 'select', value: 'left', choices: [['left', 'Sol'], ['right', 'Sağ']] },
      { id: 'side-panel-side', label: 'Yan panel konumu', help: 'Yer imleri ve geçmiş panellerini yerleştir.', type: 'select', value: 'right', choices: [['left', 'Sol'], ['right', 'Sağ']] },
      { id: 'page-zoom', label: 'Varsayılan sayfa yakınlaştırma', help: 'Siteye özel yakınlaştırma olmadığında kullanılır.', type: 'select', value: '100', choices: [['75', '%75'], ['90', '%90'], ['100', '%100'], ['110', '%110'], ['125', '%125'], ['150', '%150']] },
      { id: 'font-scale', label: 'Arayüz yazı boyutu', help: 'Yalnızca arayüz yazı boyutunu değiştirir.', type: 'number', value: 100, min: 80, max: 150, step: 5, suffix: '%' },
      { id: 'ui-scale', label: 'Arayüz ölçeği', help: 'Düğme ve araç çubuklarının boyutunu değiştirir.', type: 'number', value: 100, min: 85, max: 125, step: 5, suffix: '%' },
      { id: 'ui-animations', label: 'Arayüz animasyonları', help: 'Geçiş ve menü animasyonlarını kullan.', type: 'toggle', value: true },
      { id: 'smooth-scrolling', label: 'Akıcı kaydırma', help: 'Sayfa kaydırmalarını yumuşat.', type: 'toggle', value: true },
      { id: 'touch-mode', label: 'Dokunmatik tahta modu', help: 'Düğme ve dokunma hedeflerini büyüt.', type: 'toggle', value: false },
      { id: 'reduce-transparency', label: 'Saydamlığı azalt', help: 'Bulanık arka planları kapatıp performansı artır.', type: 'toggle', value: false }
    ]
  },
  {
    label: 'Arama ve güvenlik',
    settings: [
      { id: 'search-engine', label: 'Varsayılan arama motoru', help: 'Adres çubuğu aramalarında kullanılacak motor.', type: 'select', value: 'google', choices: [['google', 'Google'], ['yandex', 'Yandex'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo'], ['ecosia', 'Ecosia'], ['brave', 'Brave Search']] },
      { id: 'search-suggestions', label: 'Arama önerileri', help: 'Yazarken otomatik arama önerileri göster.', type: 'toggle', value: true },
      { id: 'ad-block', label: 'Reklam engelleyici', help: 'Bilinen reklam alan adlarını engelle.', type: 'toggle', value: true },
      { id: 'track-protect', label: 'İzleyici koruması', help: 'Bilinen izleyici alan adlarını engelle.', type: 'toggle', value: true },
      { id: 'https-only', label: 'Yalnızca HTTPS', help: 'HTTP adreslerini güvenli HTTPS sürümüne yükseltmeyi dene.', type: 'toggle', value: true },
      { id: 'do-not-track', label: 'Takip etme isteği', help: 'Sitelerden takip etmeme tercihini iste.', type: 'toggle', value: true },
      { id: 'block-third-party-cookies', label: 'Üçüncü taraf çerezlerini engelle', help: 'Siteler arası çerez erişimini sınırla.', type: 'toggle', value: true }
    ]
  },
  {
    label: 'Performans ve bellek',
    settings: [
      { id: 'low-end-mode', label: 'Düşük donanım modu', help: 'Efektleri azaltarak kaynak kullanımını sınırla.', type: 'toggle', value: false },
      { id: 'background-tab-throttling', label: 'Arka plan sekmelerini yavaşlat', help: 'Arka plandaki Chromium sekmelerinin kaynak kullanımını azalt.', type: 'toggle', value: true },
      { id: 'memory-saver', label: 'Bellek tasarrufu', help: 'Boştaki sekmeleri bellek baskısında uyut.', type: 'toggle', value: false },
      { id: 'smart-tab-manager', label: 'Akıllı sekme yöneticisi', help: 'Bellek kullanımına göre arka plan sekmelerini yönet.', type: 'toggle', value: false },
      { id: 'disk-backed-tab-saver', label: 'Disk destekli sekme kaydetme', help: 'Uyutulmuş sekme oturumlarını yerel diskte tut.', type: 'toggle', value: false },
      { id: 'max-live-tabs', label: 'Aynı anda çalışan sekme sayısı', help: 'Canlı tutulan sekme sayısı; 1–30.', type: 'number', value: 10, min: 1, max: 30, step: 1 },
      { id: 'tab-sleep-minutes', label: 'Sekmeyi uyutma süresi', help: 'Dakika cinsinden; 0 ile devre dışı bırakılır.', type: 'number', value: 20, min: 0, max: 1440, step: 1, suffix: ' dk' }
    ]
  }
];

function messageFor(error) {
  return labels[error] || error || 'İşlem tamamlanamadı.';
}

function setMessage(element, message, kind) {
  element.textContent = message || '';
  element.classList.toggle('is-error', kind === 'error');
  element.classList.toggle('is-success', kind === 'success');
}

function requireSuccess(result) {
  if (!result || !result.ok) throw new Error(messageFor(result && result.error));
  return result;
}

async function call(name, ...args) {
  return requireSuccess(await ipc.invoke('school-management:' + name, ...args));
}

function selectedDeviceIds() {
  return Array.from(document.querySelectorAll('#device-list input[type="checkbox"]:checked'))
    .map((input) => input.dataset.deviceId);
}

function renderPolicySettings(values = {}) {
  const root = byId('policy-settings');
  const fragment = document.createDocumentFragment();
  for (const group of policyGroups) {
    const details = document.createElement('details');
    details.className = 'policy-category';
    const summary = document.createElement('summary');
    summary.textContent = group.label;
    const grid = document.createElement('div');
    grid.className = 'policy-category-grid';
    for (const setting of group.settings) {
      const field = document.createElement('label');
      field.className = 'field policy-control';
      field.dataset.settingId = setting.id;
      const title = document.createElement('span');
      title.textContent = setting.label;
      const help = document.createElement('small');
      help.textContent = setting.help;
      field.append(title);
      let input;
      if (setting.type === 'toggle') {
        const row = document.createElement('span');
        row.className = 'policy-toggle-row';
        input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = values[setting.id] === undefined ? setting.value : values[setting.id] === true;
        input.dataset.settingId = setting.id;
        row.append(input, document.createTextNode(' Etkin'));
        field.append(row, help);
      } else if (setting.type === 'select') {
        input = document.createElement('select');
        input.className = 'panel-select';
        input.dataset.settingId = setting.id;
        for (const [value, label] of setting.choices) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          input.append(option);
        }
        input.value = typeof values[setting.id] === 'string' ? values[setting.id] : setting.value;
        field.append(input, help);
      } else {
        const wrapper = document.createElement('span');
        wrapper.className = 'policy-number-row';
        input = document.createElement('input');
        input.className = 'policy-number';
        input.type = 'number';
        input.min = String(setting.min);
        input.max = String(setting.max);
        input.step = String(setting.step);
        input.value = values[setting.id] === undefined ? String(setting.value) : String(values[setting.id]);
        input.dataset.settingId = setting.id;
        const suffix = document.createElement('small');
        suffix.textContent = setting.suffix || '';
        wrapper.append(input, suffix);
        field.append(wrapper, help);
      }
      grid.append(field);
    }
    details.append(summary, grid);
    fragment.append(details);
  }
  root.replaceChildren(fragment);
}

function readPolicySettings() {
  const settings = {};
  for (const input of document.querySelectorAll('#policy-settings [data-setting-id]')) {
    settings[input.dataset.settingId] = input.type === 'checkbox' ? input.checked : input.value;
  }
  return settings;
}

function renderDevices(devices, selected = new Set()) {
  const list = byId('device-list');
  list.replaceChildren();
  byId('device-empty').hidden = devices.length > 0;
  for (const device of devices) {
    const row = document.createElement('div');
    row.className = 'device-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.deviceId = device.id;
    checkbox.checked = selected.has(device.id);
    const info = document.createElement('div');
    info.className = 'device-info';
    const name = document.createElement('strong');
    name.textContent = device.name;
    const details = document.createElement('small');
    const seen = Number(device.lastSeen);
    details.textContent = 'Eşleştirildi: ' + new Date(device.pairedAt).toLocaleDateString() +
      ' · Son bağlantı: ' + (seen ? new Date(seen).toLocaleString() : 'bilinmiyor');
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'button button-danger';
    remove.textContent = 'Kaldır';
    remove.addEventListener('click', () => revokeDevice(device));
    info.append(name, details);
    row.append(checkbox, info, remove);
    list.append(row);
  }
  byId('revoke-selected').disabled = selected.size === 0;
}

function renderPending(pending) {
  const list = byId('pending-list');
  list.replaceChildren();
  byId('pending-count').textContent = String(pending.length);
  byId('pending-empty').hidden = pending.length > 0;
  for (const request of pending) {
    const row = document.createElement('div');
    row.className = 'request-row';
    const info = document.createElement('div');
    info.className = 'request-info';
    const name = document.createElement('strong');
    name.textContent = request.name;
    const time = document.createElement('small');
    time.textContent = 'İstek zamanı: ' + new Date(request.createdAt).toLocaleString();
    const actions = document.createElement('div');
    actions.className = 'request-actions';
    const approve = document.createElement('button');
    approve.type = 'button';
    approve.className = 'button button-primary';
    approve.textContent = 'Onayla';
    approve.addEventListener('click', () => handlePairingRequest('approve', request));
    const deny = document.createElement('button');
    deny.type = 'button';
    deny.className = 'button button-danger';
    deny.textContent = 'Reddet';
    deny.addEventListener('click', () => handlePairingRequest('deny', request));
    info.append(name, time);
    actions.append(approve, deny);
    row.append(info, actions);
    list.append(row);
  }
}

function renderState(state) {
  currentState = state;
  byId('connection-state').textContent = state.running ? 'Yerel ağda çalışıyor' : 'Sunucu kapalı';
  byId('connection-state').classList.toggle('is-online', state.running);
  byId('connection-state').classList.remove('is-error');
  byId('server-pill').textContent = state.running ? 'Çalışıyor' : 'Kapalı';
  byId('server-pill').classList.toggle('is-online', state.running);
  byId('server-toggle').textContent = state.running ? 'Sunucuyu durdur' : 'Sunucuyu başlat';
  byId('server-toggle').classList.toggle('button-primary', !state.running);
  byId('server-toggle').classList.toggle('button-danger', state.running);
  byId('new-code').disabled = !state.running;
  if (!state.running && pairingCode) {
    pairingCode = '';
    pairingExpiresAt = 0;
    pairingNotice = 'Sunucu durduruldu; kod geçersiz.';
  } else if (state.running && pairingCode && !state.pairingExpiresAt) {
    pairingCode = '';
    pairingExpiresAt = 0;
    pairingNotice = 'Kod kullanıldı veya iptal edildi.';
  }
  if (inviteExpiresAt && (!state.running || !state.pairingExpiresAt)) {
    inviteExpiresAt = 0;
    pairingNotice = state.running ? 'Davet kodu kullanıldı veya süresi doldu.' : 'Sunucu durduruldu; davet kodu geçersiz.';
  }
  byId('server-port').textContent = state.running ? String(state.port) : '—';
  byId('copy-port').disabled = !state.running;
  const addresses = byId('server-addresses');
  addresses.replaceChildren();
  const usableAddresses = state.addresses || [];
  if (!usableAddresses.length) {
    addresses.textContent = 'Özel IPv4 adresi bulunamadı';
  } else {
    for (const address of usableAddresses) {
      const chip = document.createElement('span');
      chip.className = 'address-chip';
      const value = document.createElement('span');
      value.textContent = address;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Kopyala';
      copy.addEventListener('click', () => copyValue(address, copy).catch((error) =>
        setMessage(byId('access-message'), messageFor(error.message), 'error')
      ));
      chip.append(value, copy);
      addresses.append(chip);
    }
  }
  const inviteHost = byId('invite-host');
  const previousHost = inviteHost.value;
  inviteHost.replaceChildren();
  for (const address of usableAddresses) {
    const option = document.createElement('option');
    option.value = address;
    option.textContent = address;
    inviteHost.append(option);
  }
  if (usableAddresses.includes(previousHost)) inviteHost.value = previousHost;
  byId('export-invite').disabled = !state.running || usableAddresses.length === 0;
  if (!state.running) setMessage(byId('invite-export-message'), 'Dışa aktarma için önce yönetici sunucusunu başlatın.', '');
  else if (!usableAddresses.length) setMessage(byId('invite-export-message'), 'Bu bilgisayarda davet için kullanılabilir yerel ağ IP adresi bulunamadı.', 'error');
  renderPending(state.pending || []);
  const selectedAll = byId('select-all');
  let selected = new Set(selectedDeviceIds());
  if (!selectedAll.dataset.initialized && state.policy) {
    selectedAll.checked = !Array.isArray(state.policy.targetDeviceIds);
    selected = new Set(Array.isArray(state.policy.targetDeviceIds) ? state.policy.targetDeviceIds : []);
    selectedAll.dataset.initialized = 'true';
  }
  const knownIds = new Set((state.devices || []).map((device) => device.id));
  renderDevices(state.devices || [], new Set([...selected].filter((id) => knownIds.has(id))));
  if (!byId('policy-form').dataset.edited && state.policy) {
    byId('policy-school').checked = !!state.policy.schoolModeEnabled;
    byId('policy-safe-search').value = state.policy.settings && state.policy.settings['safe-search'] ||
      (state.policy.strictMode ? 'strict' : 'moderate');
    byId('policy-url').value = state.policy.startUrl;
    byId('policy-tabs').value = String(state.policy.maxTabs);
    renderPolicySettings(state.policy.settings || {});
  } else if (!byId('policy-form').dataset.edited) {
    renderPolicySettings({ 'safe-search': 'strict' });
  }
  if (state.deviceName && !byId('join-name').value) byId('join-name').value = state.deviceName;
  if (state.client) {
    byId('client-message').textContent = 'Bu bilgisayar ' + state.client.host + ':' + state.client.port + ' adresindeki yöneticiyle eşleştirilmiş.';
    byId('client-message').classList.add('is-success');
  } else {
    byId('client-message').classList.remove('is-success');
  }
  renderExpiry();
}

async function refreshState() {
  const result = unlocked
    ? await ipc.invoke('school-management:state', adminPassword)
    : await ipc.invoke('school-management:state');
  requireSuccess(result);
  const state = result.state;
  renderState(state);
  byId('management-content').hidden = !unlocked;
  byId('lock-panel').hidden = !unlocked;
  byId('access-title').textContent = unlocked ? 'Yönetici erişimi açık' :
    state.configured ? 'Yönetici parolası' : 'Yönetici parolası oluştur';
  byId('access-description').textContent = state.configured
    ? 'Eşleştirilmiş bilgisayarları ve okul politikalarını yönetmek için parolanızı doğrulayın.'
    : 'Paneli yalnızca bu bilgisayarın yöneticisi açabilsin diye güçlü bir parola belirleyin.';
  byId('password-label').textContent = state.configured ? 'Yönetici parolası' : 'Yeni güçlü parola';
  byId('access-submit').textContent = state.configured ? 'Kilidi aç' : 'Parola oluştur';
  byId('admin-password').autocomplete = state.configured ? 'current-password' : 'new-password';
  byId('admin-password-confirm').required = !state.configured;
  byId('password-confirm-field').hidden = state.configured;
  byId('access-form').hidden = unlocked;
}

async function copyValue(value, button) {
  try {
    await navigator.clipboard.writeText(String(value));
  } catch (error) {
    const input = document.createElement('textarea');
    input.value = String(value);
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.append(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw error;
  }
  const original = button.textContent;
  button.textContent = 'Kopyalandı';
  setTimeout(() => { if (button.isConnected) button.textContent = original; }, 1400);
}

function renderExpiry() {
  const valid = pairingCode && Date.now() < pairingExpiresAt;
  const expired = !!pairingCode && !valid;
  const inviteValid = !pairingCode && inviteExpiresAt > Date.now();
  byId('pairing-code').textContent = valid ? pairingCode : expired ? 'Kodun süresi doldu' :
    inviteValid ? pairingNotice : inviteExpiresAt ? 'Davet kodunun süresi doldu' : pairingNotice || 'Henüz kod oluşturulmadı';
  byId('code-expiry').textContent = valid ? new Date(pairingExpiresAt).toLocaleTimeString() :
    inviteValid ? new Date(inviteExpiresAt).toLocaleTimeString() : '—';
  byId('copy-code').disabled = !valid;
  if (expired) pairingCode = '';
  if (inviteExpiresAt && !inviteValid) inviteExpiresAt = 0;
}

function useAdminPassword() {
  if (!unlocked) throw new Error('Önce yönetici parolasıyla panel kilidini açın.');
  return adminPassword;
}

async function handlePairingRequest(action, request) {
  try {
    const result = await call(action, useAdminPassword(), request.id);
    renderState(result.state);
  } catch (error) {
    window.alert(messageFor(error.message));
  }
}

async function revokeDevice(device) {
  if (!window.confirm(device.name + ' bilgisayarı eşleştirilmiş cihazlardan kaldırılsın mı?')) return;
  try {
    const result = await call('revoke', useAdminPassword(), device.id);
    renderState(result.state);
  } catch (error) {
    window.alert(messageFor(error.message));
  }
}

byId('refresh').addEventListener('click', async () => {
  try {
    await refreshState();
    setMessage(byId('access-message'), '', '');
  } catch (error) {
    byId('connection-state').textContent = messageFor(error.message);
    byId('connection-state').classList.add('is-error');
  }
});

byId('access-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = byId('access-message');
  const password = byId('admin-password').value;
  const state = currentState;
  try {
    if (!state) throw new Error('Panel durumu alınamadı. Yenileyip tekrar deneyin.');
    if (!state.configured) {
      if (password !== byId('admin-password-confirm').value) throw new Error('Girdiğiniz parolalar eşleşmiyor.');
      await call('setup', password);
    } else {
      await call('authenticate', password);
    }
    adminPassword = password;
    unlocked = true;
    byId('admin-password').value = '';
    byId('admin-password-confirm').value = '';
    setMessage(message, 'Erişim doğrulandı.', 'success');
    await refreshState();
  } catch (error) {
    if (error.message !== 'cancelled') setMessage(message, messageFor(error.message), 'error');
  }
});

byId('lock-panel').addEventListener('click', () => {
  adminPassword = '';
  unlocked = false;
  pairingCode = '';
  pairingExpiresAt = 0;
  inviteExpiresAt = 0;
  renderExpiry();
  refreshState().catch((error) => setMessage(byId('access-message'), messageFor(error.message), 'error'));
});

byId('server-toggle').addEventListener('click', async () => {
  const button = byId('server-toggle');
  button.disabled = true;
  try {
    const action = currentState.running ? 'stop' : 'start';
    const result = await call(action, useAdminPassword());
    renderState(result.state);
  } catch (error) {
    window.alert(messageFor(error.message));
  } finally {
    button.disabled = false;
  }
});

byId('new-code').addEventListener('click', async () => {
  try {
    const result = await call('new-code', useAdminPassword());
    pairingCode = result.code;
    pairingExpiresAt = result.expiresAt;
    inviteExpiresAt = 0;
    pairingNotice = '';
    byId('fingerprint').textContent = result.fingerprint;
    byId('copy-fingerprint').disabled = false;
    renderExpiry();
  } catch (error) {
    window.alert(messageFor(error.message));
  }
});

byId('export-invite').addEventListener('click', async () => {
  const password = byId('invite-export-password').value;
  const confirm = byId('invite-export-confirm').value;
  const message = byId('invite-export-message');
  if (password !== confirm) {
    setMessage(message, 'Davet dosyası parolaları eşleşmiyor.', 'error');
    return;
  }
  try {
    const result = await call('export-invite', useAdminPassword(), password, byId('invite-host').value);
    byId('invite-export-password').value = '';
    byId('invite-export-confirm').value = '';
    setMessage(message, 'Davet dosyası dışa aktarıldı: ' + result.filePath + '. ' + new Date(result.expiresAt).toLocaleTimeString() + ' saatine kadar kullanılabilir. Dosya parolasını alıcıya farklı ve güvenli bir kanaldan iletin.', 'success');
    pairingNotice = 'Davet dosyası üretildi; 5 dakika içinde kullanılmalı.';
    pairingExpiresAt = 0;
    inviteExpiresAt = result.expiresAt;
    pairingCode = '';
    renderExpiry();
  } catch (error) {
    if (error.message !== 'cancelled') setMessage(message, messageFor(error.message), 'error');
  }
});

function updateInvitePasswordActions() {
  const password = byId('invite-export-password').value;
  byId('copy-invite-password').disabled = password.length < 14;
}

byId('generate-invite-password').addEventListener('click', () => {
  const pools = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '!@#$%_-+='];
  const all = pools.join('');
  const random = new Uint8Array(32);
  if (!window.crypto || typeof window.crypto.getRandomValues !== 'function') {
    setMessage(byId('invite-export-message'), 'Güvenli parola üretimi bu ortamda kullanılamıyor.', 'error');
    return;
  }
  window.crypto.getRandomValues(random);
  const chars = pools.map((pool, index) => pool[random[index] % pool.length]);
  for (let index = pools.length; index < random.length; index += 1) {
    chars.push(all[random[index] % all.length]);
  }
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = random[index % random.length] % (index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }
  const password = chars.join('');
  byId('invite-export-password').value = password;
  byId('invite-export-confirm').value = password;
  updateInvitePasswordActions();
  setMessage(byId('invite-export-message'), '32 karakterli rastgele parola üretildi. Parolayı alıcıya dosyadan ayrı bir kanaldan verin.', 'success');
});

byId('invite-export-password').addEventListener('input', updateInvitePasswordActions);
byId('toggle-invite-password').addEventListener('click', () => {
  const visible = byId('invite-export-password').type === 'text';
  byId('invite-export-password').type = visible ? 'password' : 'text';
  byId('invite-export-confirm').type = visible ? 'password' : 'text';
  byId('toggle-invite-password').textContent = visible ? 'Parolayı göster' : 'Parolayı gizle';
});
byId('copy-invite-password').addEventListener('click', () => {
  copyValue(byId('invite-export-password').value, byId('copy-invite-password'))
    .catch((error) => setMessage(byId('invite-export-message'), messageFor(error.message), 'error'));
});

byId('copy-code').addEventListener('click', () => copyValue(pairingCode, byId('copy-code')).catch((error) => setMessage(byId('access-message'), error.message, 'error')));
byId('copy-port').addEventListener('click', () => copyValue(byId('server-port').textContent, byId('copy-port')).catch((error) => setMessage(byId('access-message'), error.message, 'error')));
byId('copy-fingerprint').addEventListener('click', () => copyValue(byId('fingerprint').textContent, byId('copy-fingerprint')).catch((error) => setMessage(byId('access-message'), error.message, 'error')));

byId('select-all').addEventListener('change', () => {
  byId('select-all').dataset.initialized = 'true';
});

byId('select-visible').addEventListener('click', () => {
  for (const checkbox of document.querySelectorAll('#device-list input[type="checkbox"]')) checkbox.checked = true;
  byId('revoke-selected').disabled = selectedDeviceIds().length === 0;
});

byId('clear-selection').addEventListener('click', () => {
  for (const checkbox of document.querySelectorAll('#device-list input[type="checkbox"]')) checkbox.checked = false;
  byId('revoke-selected').disabled = true;
});

byId('device-list').addEventListener('change', (event) => {
  if (event.target && event.target.matches('input[type="checkbox"]')) {
    byId('revoke-selected').disabled = selectedDeviceIds().length === 0;
  }
});

byId('revoke-selected').addEventListener('click', async () => {
  const ids = selectedDeviceIds();
  if (!ids.length || !window.confirm(ids.length + ' seçili bilgisayar eşleştirmeden kaldırılsın mı?')) return;
  const button = byId('revoke-selected');
  button.disabled = true;
  const failures = [];
  for (const id of ids) {
    try {
      await call('revoke', useAdminPassword(), id);
    } catch (error) {
      failures.push(error.message);
    }
  }
  try {
    await refreshState();
    if (failures.length) window.alert('Bazı bilgisayarlar kaldırılamadı: ' + failures.map(messageFor).join(', '));
    else setMessage(byId('policy-message'), 'Seçilen bilgisayarlar kaldırıldı.', 'success');
  } catch (error) {
    window.alert(messageFor(error.message));
  } finally {
    button.disabled = selectedDeviceIds().length === 0;
  }
});

byId('policy-form').addEventListener('input', () => { byId('policy-form').dataset.edited = 'true'; });
byId('policy-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = byId('policy-message');
  try {
    const allDevices = byId('select-all').checked;
    const targetDeviceIds = allDevices ? null : selectedDeviceIds();
    if (!allDevices && !targetDeviceIds.length) throw new Error('Önce hedef bilgisayarları seçin veya tüm bilgisayarları işaretleyin.');
    const payload = {
      schoolModeEnabled: byId('policy-school').checked,
      strictMode: byId('policy-safe-search').value === 'strict',
      startUrl: byId('policy-url').value.trim(),
      maxTabs: Number(byId('policy-tabs').value),
      targetDeviceIds,
      settings: { ...readPolicySettings(), 'safe-search': byId('policy-safe-search').value }
    };
    const result = await call('set-policy', useAdminPassword(), payload);
    renderState(result.state);
    setMessage(message, 'Politika kaydedildi. Seçilen bilgisayarlarda kullanıcı onayı beklenir.', 'success');
  } catch (error) {
    setMessage(message, messageFor(error.message), 'error');
  }
});

byId('join-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = byId('client-message');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  button.disabled = true;
  setMessage(message, 'Yönetici bağlantısı aranıyor; onay bekleniyor…', '');
  try {
    const result = await call('join', {
      host: byId('join-host').value.trim(),
      port: Number(byId('join-port').value),
      code: byId('join-code').value.trim(),
      fingerprint: byId('join-fingerprint').value.trim(),
      name: byId('join-name').value.trim()
    });
    setMessage(message, 'Bilgisayar yöneticiyle güvenli biçimde eşleştirildi.', 'success');
    byId('join-code').value = '';
    await refreshState();
    if (!result.state.client) throw new Error('Eşleştirme tamamlandı ancak bağlantı bilgisi doğrulanamadı.');
  } catch (error) {
    setMessage(message, messageFor(error.message), 'error');
  } finally {
    button.disabled = false;
  }
});

byId('import-invite').addEventListener('click', async () => {
  const password = byId('invite-import-password').value;
  const message = byId('client-message');
  if (password.length < 14) {
    setMessage(message, 'Davet dosyasının güçlü parolasını girin.', 'error');
    return;
  }
  try {
    const result = await call('import-invite', password);
    byId('invite-import-password').value = '';
    byId('join-host').value = result.invite.host;
    byId('join-port').value = String(result.invite.port);
    byId('join-code').value = result.invite.code;
    byId('join-fingerprint').value = result.invite.fingerprint;
    if (result.invite.deviceName && !byId('join-name').value) byId('join-name').value = byId('join-name').value || result.invite.deviceName;
    byId('join-form').closest('details').open = true;
    setMessage(message, 'Davet dosyası açıldı. Bilgiler dolduruldu; bağlantı isteği için düğmeye basın. Son kullanma: ' + new Date(result.invite.expiresAt).toLocaleTimeString(), 'success');
  } catch (error) {
    if (error.message !== 'cancelled') setMessage(message, messageFor(error.message), 'error');
  }
});

byId('check-policy').addEventListener('click', async () => {
  const message = byId('client-message');
  try {
    const result = await call('check-policy');
    if (!result.policy) {
      setMessage(message, 'Bu bilgisayara atanmış yeni bir okul politikası yok.', '');
      return;
    }
    const summary = [
      'Okul modu: ' + (result.policy.schoolModeEnabled ? 'Açık' : 'Kapalı'),
      'Güvenli arama: ' + (result.policy.settings && result.policy.settings['safe-search'] || (result.policy.strictMode ? 'Sıkı' : 'Orta')),
      'Başlangıç adresi: ' + result.policy.startUrl,
      'En fazla sekme: ' + result.policy.maxTabs,
      ...Object.entries(result.policy.settings || {}).map(([id, value]) => {
        const item = policyGroups.flatMap((group) => group.settings).find((setting) => setting.id === id);
        return (item ? item.label : id) + ': ' + (typeof value === 'boolean' ? value ? 'Açık' : 'Kapalı' : value);
      })
    ].join('\n');
    if (!window.confirm('Yönetici tarafından gönderilen ayarları bu bilgisayarda uygulamak istiyor musunuz?\n\n' + summary)) {
      setMessage(message, 'Politika alınmadı; ayarlar değiştirilmedi.', '');
      return;
    }
    await call('apply-policy', result.policy);
    setMessage(message, 'Onayladığınız okul politikası uygulandı.', 'success');
  } catch (error) {
    setMessage(message, messageFor(error.message), 'error');
  }
});

byId('disconnect').addEventListener('click', async () => {
  if (!window.confirm('Bu bilgisayarın okul yöneticisiyle eşleştirmesi kaldırılsın mı?')) return;
  try {
    await call('disconnect');
    setMessage(byId('client-message'), 'Yönetici bağlantısı kaldırıldı.', 'success');
    await refreshState();
  } catch (error) {
    setMessage(byId('client-message'), messageFor(error.message), 'error');
  }
});

function updatePairingExpiry() {
  renderExpiry();
}

async function initialize() {
  renderPolicySettings({});
  try {
    await refreshState();
  } catch (error) {
    byId('connection-state').textContent = messageFor(error.message);
    byId('connection-state').classList.add('is-error');
    setMessage(byId('access-message'), messageFor(error.message), 'error');
  }
  stateTimer = setInterval(() => {
    refreshState().catch((error) => {
      byId('connection-state').textContent = messageFor(error.message);
      byId('connection-state').classList.add('is-error');
    });
    updatePairingExpiry();
  }, 4000);
}

window.addEventListener('beforeunload', () => {
  if (stateTimer) clearInterval(stateTimer);
  adminPassword = '';
  pairingCode = '';
});

initialize();
