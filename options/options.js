// Bloomie - Options page script

const TOAST_DURATION_MS = 2500;
const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];
const WEEK_DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

document.addEventListener('DOMContentLoaded', async () => {
  const settings = await BloomieUI.initPage();

  initThemes(settings.theme || 'rose');
  await renderBlockedSites();
  await initDebugSection();

  document.getElementById('addSiteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('siteInput');
    const site = input.value.trim();
    if (!site) return;

    input.value = '';
    await blockSite(site, 'Site ajouté aux blocages');
  });

  document.querySelectorAll('.quick-site-btn').forEach(btn => {
    btn.addEventListener('click', () => blockSite(btn.dataset.site, `${btn.dataset.site} ajouté`));
  });

  document.getElementById('openNewTab').addEventListener('click', () => {
    window.location.href = chrome.runtime.getURL('newtab/newtab.html');
  });

  document.getElementById('exportData').addEventListener('click', exportData);
  document.getElementById('resetData').addEventListener('click', resetData);
});

function refreshBlockingRules() {
  chrome.runtime.sendMessage({ type: 'FORCE_UPDATE_RULES' });
}

// === DATA ===

async function exportData() {
  const data = await chrome.storage.local.get(null);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const now = await FlowerStorage.getCurrentDate();

  const link = document.createElement('a');
  link.href = url;
  link.download = `bloomie-backup-${FlowerStorage.formatDate(now)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast('Données exportées');
}

async function resetData() {
  const confirmed = confirm('Es-tu sûr(e) de vouloir réinitialiser toutes les données ? Cette action est irréversible.');
  if (!confirmed) return;

  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    tasks: [],
    blockedSites: [],
    garden: {},
    settings: { ...FlowerStorage.DEFAULT_SETTINGS },
    lastResetDate: await FlowerStorage.getTodayString(),
    lastBouquetWeek: null,
    weekBouquet: null
  });
  refreshBlockingRules();

  document.body.setAttribute('data-theme', 'rose');
  initThemes('rose');
  await renderBlockedSites();
  await initDebugSection();
  showToast('Données réinitialisées');
}

// === THEMES ===

function initThemes(currentTheme) {
  const themeButtons = document.querySelectorAll('#themeGrid .theme-option');

  themeButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === currentTheme);

    btn.addEventListener('click', async () => {
      const theme = btn.dataset.theme;
      document.body.setAttribute('data-theme', theme);
      await FlowerStorage.updateSettings({ theme });

      themeButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showToast(`Thème "${btn.querySelector('span').textContent}" appliqué`);
    });
  });
}

// === BLOCKED SITES ===

async function blockSite(site, message) {
  await FlowerStorage.addBlockedSite(site);
  await renderBlockedSites();
  showToast(message);
  refreshBlockingRules();
}

async function unblockSite(site) {
  await FlowerStorage.removeBlockedSite(site);
  await renderBlockedSites();
  showToast(`${site} débloqué`);
  refreshBlockingRules();
}

async function renderBlockedSites() {
  const sites = await FlowerStorage.getBlockedSites();
  const siteList = document.getElementById('siteList');
  const emptySites = document.getElementById('emptySites');

  document.querySelectorAll('.quick-site-btn').forEach(btn => {
    btn.classList.toggle('added', sites.includes(btn.dataset.site));
  });

  emptySites.classList.toggle('visible', sites.length === 0);
  if (sites.length === 0) {
    siteList.innerHTML = '';
    return;
  }

  siteList.innerHTML = sites.map(site => `
    <div class="site-item" data-site="${BloomieUI.escapeHtml(site)}">
      <span class="site-name">${BloomieUI.escapeHtml(site)}</span>
      <button class="site-remove-btn" title="Supprimer">×</button>
    </div>
  `).join('');

  siteList.querySelectorAll('.site-remove-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = e.target.closest('.site-item');
      item.style.animation = 'fadeOut 0.3s ease-out forwards';
      setTimeout(() => unblockSite(item.dataset.site), 250);
    });
  });
}

// === DEBUG / TEST MODE ===

async function initDebugSection() {
  const isDebug = await FlowerStorage.isDebugMode();
  const toggle = document.getElementById('debugToggle');
  const controls = document.getElementById('debugControls');
  const datePicker = document.getElementById('debugDatePicker');

  toggle.checked = isDebug;
  controls.classList.toggle('visible', isDebug);
  if (isDebug) await updateDebugDateDisplay();

  toggle.addEventListener('change', async () => {
    await FlowerStorage.setDebugMode(toggle.checked);
    controls.classList.toggle('visible', toggle.checked);
    if (toggle.checked) {
      await updateDebugDateDisplay();
      showToast('Mode test activé');
    } else {
      showToast('Mode test désactivé');
      document.getElementById('debugBadge')?.remove();
    }
  });

  document.getElementById('debugPlusDay').addEventListener('click', () => advanceDebugDate(1));
  document.getElementById('debugPlusWeek').addEventListener('click', () => advanceDebugDate(7));

  document.getElementById('debugResetDate').addEventListener('click', async () => {
    await FlowerStorage.setDebugDate(FlowerStorage.formatDate(new Date()));
    await updateDebugDateDisplay();
    showToast('Date réinitialisée à aujourd\'hui');
  });

  datePicker.addEventListener('change', async () => {
    if (!datePicker.value) return;
    await FlowerStorage.setDebugDate(datePicker.value);
    await updateDebugDateDisplay();
    showToast(`Date changée: ${formatReadableDate(datePicker.value)}`);
  });

  document.getElementById('debugMidnightReset').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'FORCE_DAILY_RESET' }, () => {
      showToast('Reset de minuit simulé');
    });
  });
}

async function advanceDebugDate(days) {
  const newDate = await FlowerStorage.advanceDebugDate(days);
  await updateDebugDateDisplay();
  showToast(`Date avancée: ${formatReadableDate(newDate)}`);
}

async function updateDebugDateDisplay() {
  const dateStr = await FlowerStorage.getDebugDate();
  document.getElementById('debugDateDisplay').textContent = formatReadableDate(dateStr);
  document.getElementById('debugDatePicker').value = dateStr;
}

/** Formats "2025-02-14" as "Vendredi 14 Fév 2025". */
function formatReadableDate(dateStr) {
  const d = new Date(`${dateStr}T12:00:00`);
  return `${WEEK_DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// === TOAST ===

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), TOAST_DURATION_MS);
}
