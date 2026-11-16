// Bloomie - New tab page script

const FLOWER_COLORS = BloomieUI.FLOWER_COLORS;
const FLOWER_MILESTONES = 7;
const MAX_PETALS = 5;
const BOUQUET_AUTO_CLOSE_MS = 8000;
const CONFETTI_LIFETIME_MS = 5000;

let todayFlowerType = 0;
let wasAllComplete = false;
let previousPetalCount = 0;
let selectedType = 'light';
let todayGardenIndex = -1; // Index of today's slot inside #gardenView
let bouquetShowing = false; // Prevents showing the bouquet twice

document.addEventListener('DOMContentLoaded', async () => {
  await BloomieUI.initPage();

  // The flower of the day is deterministic per (simulated) date.
  const currentDate = await FlowerStorage.getCurrentDate();
  todayFlowerType = currentDate.getDate() % FLOWER_COLORS.length;

  await FlowerStorage.initWeekTracking();

  const initialStatus = await FlowerStorage.getTodayStatus();
  wasAllComplete = initialStatus.allComplete;
  previousPetalCount = getFlowerState(initialStatus.progress).petals;

  // Make sure the daily reset ran (missed midnight alarm, debug date jump...).
  try {
    await chrome.runtime.sendMessage({ type: 'CHECK_DAILY_RESET' });
  } catch {
    // The service worker may not be ready yet: continue without it.
  }

  await checkBouquet();
  await renderAll();

  BloomieUI.bindTaskTypeToggle((type) => { selectedType = type; });
  BloomieUI.bindAddTaskForm({
    getType: () => selectedType,
    maxMessage: `Maximum ${FlowerStorage.MAX_TASKS} taches par jour`,
    placeholder: 'Ajouter une nouvelle tache...',
    onAdded: renderTasksAndToday
  });

  document.getElementById('openOptions').addEventListener('click', () => {
    window.location.href = chrome.runtime.getURL('options/options.html');
  });

  document.getElementById('bouquetClose').addEventListener('click', closeBouquet);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local') return;

    // Rebuild the whole garden only on structural changes (new day, theme).
    if (changes.settings || changes.lastResetDate) {
      await renderGarden();
    }
    if (changes.garden || changes.lastResetDate) {
      await checkBouquet();
    }
    await renderTasksAndToday();
  });
});

async function renderAll() {
  await renderGarden();
  await renderTasks();
  await renderStatus();
}

/** Light update: tasks, status and today's garden slot only (no garden rebuild). */
async function renderTasksAndToday() {
  await renderTasks();
  await renderStatus();
  updateTodayGardenSlot();
}

// === FLOWER STATE ===

/** Maps a completion ratio (0..1) to the visible parts of the growing flower. */
function getFlowerState(progress) {
  if (!progress) {
    return { stemHeight: 0, petals: 0, showCenter: false, showLeaves: false };
  }

  const reached = Math.ceil(progress * FLOWER_MILESTONES);
  return {
    stemHeight: Math.min(1, progress * 2.5),
    showLeaves: reached >= 2,
    petals: Math.max(0, Math.min(MAX_PETALS, reached - 2)),
    showCenter: progress >= 1
  };
}

function petalGradient(color, amount) {
  return `linear-gradient(135deg, ${color}, ${BloomieUI.adjustColor(color, amount)})`;
}

// === PROGRESSIVE FLOWER ===

function createProgressiveFlowerHTML(progress, { mini = false, flowerType = todayFlowerType } = {}) {
  const state = getFlowerState(progress);
  const colors = FLOWER_COLORS[flowerType];
  const containerClass = mini ? 'mini-progressive-flower' : 'progressive-flower';
  const completeClass = state.showCenter ? ' complete' : '';

  const stemHeight = state.stemHeight * (mini ? 40 : 160);
  const headTop = mini ? (90 - stemHeight - 45) : (240 - stemHeight - 10 - 90);
  const leafBottomLeft = mini ? stemHeight * 0.5 : stemHeight * 0.45 + 10;
  const leafBottomRight = mini ? stemHeight * 0.7 : stemHeight * 0.65 + 10;
  const leavesClass = state.showLeaves ? ' visible' : '';

  let petalsHTML = '';
  for (let i = 1; i <= MAX_PETALS; i++) {
    const isVisible = i <= state.petals;
    const visible = isVisible ? ' visible' : '';
    const justAppeared = (isVisible && i > previousPetalCount && !mini) ? ' just-appeared' : '';
    petalsHTML += `<div class="pf-petal pf-petal-${i}${visible}${justAppeared}" style="background: ${petalGradient(colors.petals, -25)}"></div>`;
  }

  return `
    <div class="${containerClass}${completeClass}">
      <div class="pf-seed${state.stemHeight > 0 ? ' hidden' : ''}"></div>
      <div class="pf-stem" style="height: ${stemHeight}px"></div>
      <div class="pf-leaf pf-leaf-left${leavesClass}" style="bottom: ${leafBottomLeft}px"></div>
      <div class="pf-leaf pf-leaf-right${leavesClass}" style="bottom: ${leafBottomRight}px"></div>
      <div class="pf-head" style="top: ${Math.max(0, headTop)}px">
        ${petalsHTML}
        <div class="pf-center${state.showCenter ? ' visible' : ''}" style="background: ${colors.center}"></div>
      </div>
    </div>
  `;
}

/** Fully bloomed flower used for completed past days. */
function createMiniFlowerHTML(type) {
  const colors = BloomieUI.getFlowerColors(type);
  const petalCount = type === 2 ? 8 : (type === 4 ? 6 : 5);
  const petals = `<div class="petal" style="background: ${petalGradient(colors.petals, -20)}"></div>`.repeat(petalCount);

  return `
    <div class="mini-flower flower-type-${type}">
      <div class="flower-petals petals-${petalCount}">
        ${petals}
        <div class="flower-center" style="background: ${colors.center}"></div>
      </div>
    </div>
    <div class="mini-stem"></div>
  `;
}

// === GARDEN (built once, then only today's slot is updated) ===

function renderTodaySlot(status) {
  return status.total > 0
    ? createProgressiveFlowerHTML(status.progress, { mini: true })
    : '<div class="garden-spot-empty"></div>';
}

function renderPastDaySlot(day) {
  if (day.completed) return createMiniFlowerHTML(day.flowerType || 0);
  if (day.progress > 0) {
    return createProgressiveFlowerHTML(day.progress, { mini: true, flowerType: day.flowerType || 0 });
  }
  if (day.taskCount > 0) return '<div class="garden-seed"><div class="pf-seed"></div></div>';
  return '<div class="garden-spot-empty"></div>';
}

async function renderGarden() {
  const weekData = await FlowerStorage.getWeekGarden();
  const settings = await FlowerStorage.getSettings();
  const status = await FlowerStorage.getTodayStatus();
  const gardenView = document.getElementById('gardenView');
  const gardenDays = document.getElementById('gardenDays');

  gardenView.innerHTML = '';
  gardenDays.innerHTML = '';
  todayGardenIndex = -1;

  weekData.forEach((day, idx) => {
    const itemEl = document.createElement('div');
    itemEl.className = 'garden-flower-item';

    if (day.isToday) {
      todayGardenIndex = idx;
      itemEl.setAttribute('data-today', 'true');
      itemEl.innerHTML = renderTodaySlot(status);
    } else if (day.isFuture) {
      itemEl.innerHTML = '<div class="garden-spot-future"></div>';
    } else {
      itemEl.innerHTML = renderPastDaySlot(day);
    }
    gardenView.appendChild(itemEl);

    const label = document.createElement('div');
    label.className = `garden-day-label ${day.isToday ? 'today' : ''} ${day.isFuture ? 'future' : ''}`;
    label.textContent = day.isToday ? 'Auj.' : day.dayName;
    gardenDays.appendChild(label);
  });

  document.getElementById('streakCount').textContent = settings.streak || 0;
}

async function updateTodayGardenSlot() {
  if (todayGardenIndex < 0) return;
  const slot = document.getElementById('gardenView').children[todayGardenIndex];
  if (!slot) return;

  slot.innerHTML = renderTodaySlot(await FlowerStorage.getTodayStatus());
}

// === TASKS ===

function renderTaskItem(task) {
  const typeIcon = task.type === 'essential' ? '🌸' : '🌿';
  const carriedBadge = task.carriedOver ? '<span class="carried-badge">↩ Reportee</span>' : '';
  return `
    <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
      <label class="task-checkbox">
        <input type="checkbox" ${task.completed ? 'checked' : ''}>
        <span class="checkmark"></span>
      </label>
      <div class="task-content">
        <span class="task-text"><span class="task-type-icon">${typeIcon}</span>${BloomieUI.escapeHtml(task.text)}</span>
        ${carriedBadge}
      </div>
      <div class="task-actions">
        <button class="task-action-btn edit" title="Modifier">✏️</button>
        <button class="task-action-btn delete" title="Supprimer">🗑️</button>
      </div>
    </div>
  `;
}

async function renderTasks() {
  const { tasks, total, completed } = await FlowerStorage.getTodayStatus();
  const taskList = document.getElementById('taskList');

  document.getElementById('taskCounter').textContent = `${completed}/${total}`;
  document.getElementById('progressBar').style.width = total > 0 ? `${(completed / total) * 100}%` : '0%';

  if (tasks.length === 0) {
    taskList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🌱</span>
        <p>Commence ta journee productive !</p>
        <p class="hint">Ajoute des taches et regarde ton jardin fleurir</p>
      </div>
    `;
    return;
  }

  // Unfinished tasks first, original order preserved otherwise.
  const sorted = [...tasks].sort((a, b) => Number(a.completed) - Number(b.completed));
  taskList.innerHTML = sorted.map(renderTaskItem).join('');

  taskList.querySelectorAll('.task-checkbox input').forEach(cb => {
    cb.addEventListener('change', onTaskToggled);
  });

  taskList.querySelectorAll('.task-action-btn.delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = e.target.closest('.task-item');
      BloomieUI.fadeOutItem(item, () => FlowerStorage.deleteTask(item.dataset.id));
    });
  });

  taskList.querySelectorAll('.task-action-btn.edit').forEach(btn => {
    btn.addEventListener('click', (e) => startEditingTask(e.target.closest('.task-item')));
  });
}

async function onTaskToggled(e) {
  await FlowerStorage.toggleTask(e.target.closest('.task-item').dataset.id);

  const status = await FlowerStorage.getTodayStatus();
  const previousCompleted = status.completed - (e.target.checked ? 1 : -1);
  previousPetalCount = getFlowerState(status.total > 0 ? previousCompleted / status.total : 0).petals;

  if (status.allComplete && !wasAllComplete) {
    wasAllComplete = true;
    setTimeout(() => {
      showFlowerAnimation();
      showCelebration();
    }, 800);
  } else if (!status.allComplete) {
    wasAllComplete = false;
  }

  await renderTasksAndToday();
  previousPetalCount = getFlowerState(status.progress).petals;
}

/** Replaces a task label with an inline text input (Enter saves, Escape cancels). */
function startEditingTask(item) {
  const textEl = item.querySelector('.task-text');
  const currentText = textEl.textContent;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'task-edit-input';
  input.value = currentText;
  input.maxLength = 150;

  textEl.replaceWith(input);
  input.focus();
  input.select();

  const save = async () => {
    const newText = input.value.trim();
    if (newText && newText !== currentText) {
      await FlowerStorage.editTask(item.dataset.id, newText);
    }
    await renderTasksAndToday();
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') save();
    if (ev.key === 'Escape') renderTasksAndToday();
  });
}

// === STATUS ===

async function renderStatus() {
  const { total, completed, remaining, allComplete, progress, streak, tier } = await FlowerStorage.getTodayStatus();
  const statusContent = document.getElementById('statusContent');
  const preview = document.getElementById('todayFlowerPreview');
  const weekData = await FlowerStorage.getWeekGarden();
  const flowerName = FLOWER_COLORS[todayFlowerType].name;

  const weekFlowers = weekData.filter(d => d.completed && !d.isToday).length + (allComplete ? 1 : 0);

  if (total === 0) {
    statusContent.innerHTML = `
      <span class="status-emoji">🌱</span>
      <div class="status-title">Nouvelle journee</div>
      <div class="status-subtitle">Ajoute tes taches pour aujourd'hui et fais fleurir ton jardin !</div>
    `;
    preview.innerHTML = '';
  } else if (tier === 'free') {
    statusContent.innerHTML = `
      <div class="status-title">Magnifique !</div>
      <div class="status-subtitle">Toutes tes taches sont terminees !<br>Sites debloques jusqu'a minuit !</div>
    `;
    preview.innerHTML = createProgressiveFlowerHTML(progress) +
      `<div class="preview-label">Fleur du jour - ${flowerName}</div>`;
  } else {
    statusContent.innerHTML = `
      <div class="status-title">Encore ${remaining} tache${BloomieUI.plural(remaining)}</div>
      <div class="status-subtitle">Chaque tache fait pousser ta fleur !</div>
    `;
    preview.innerHTML = createProgressiveFlowerHTML(progress) +
      `<div class="preview-label">${completed}/${total} - ${flowerName}</div>`;
  }

  statusContent.innerHTML += `
    <div class="stats-row">
      ${renderStatItem(streak, 'Streak')}
      ${renderStatItem(weekFlowers, 'Fleurs')}
      ${renderStatItem(completed, 'Faites')}
    </div>
  `;
}

function renderStatItem(value, label) {
  return `
    <div class="stat-item">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${label}</div>
    </div>
  `;
}

// === WEEKLY BOUQUET ===

async function checkBouquet() {
  if (bouquetShowing) return;
  const { needsBouquet, weekBouquet } = await FlowerStorage.getBouquetData();
  if (!needsBouquet) return;

  // weekBouquet is already limited to the previous week.
  const garden = weekBouquet || {};
  if (Object.keys(garden).length === 0) {
    await FlowerStorage.markBouquetSeen();
    return;
  }

  bouquetShowing = true;
  showBouquet(garden);
}

function showBouquet(garden) {
  const overlay = document.getElementById('bouquetOverlay');
  const entries = Object.entries(garden).sort(([a], [b]) => a.localeCompare(b));

  const flowers = entries.map(([, data]) => ({
    progress: data.progress || (data.completed ? 1 : 0),
    flowerType: data.flowerType || 0
  }));
  const completeCount = entries.filter(([, data]) => data.completed).length;
  const totalProgress = flowers.reduce((sum, f) => sum + f.progress, 0);
  const avgProgress = entries.length > 0 ? Math.round((totalProgress / entries.length) * 100) : 0;
  const s = BloomieUI.plural(completeCount);

  document.getElementById('bouquetFlowers').innerHTML = buildBouquetHTML(flowers);
  document.getElementById('bouquetStats').innerHTML = `
    <div class="bouquet-stat">${completeCount} fleur${s} complete${s}</div>
    <div class="bouquet-stat">${avgProgress}% de moyenne</div>
  `;

  overlay.style.display = 'flex';
  showBouquetConfetti();

  setTimeout(() => {
    if (overlay.style.display !== 'none') closeBouquet();
  }, BOUQUET_AUTO_CLOSE_MS);
}

/** Arranges the week's flowers as a fan whose stems converge at the bottom. */
function buildBouquetHTML(flowers) {
  const count = flowers.length;
  if (count === 0) return '<div class="bouquet-empty">Pas de fleurs cette semaine</div>';

  const angleSpread = 50;
  const startAngle = -angleSpread / 2;
  const step = count > 1 ? angleSpread / (count - 1) : 0;

  const stems = flowers.map((flower, i) => {
    const angle = count === 1 ? 0 : startAngle + step * i;
    return `
      <div class="bouquet-stem-flower" style="--angle: ${angle}deg; animation-delay: ${i * 0.12}s;">
        ${buildBouquetFlower(flower)}
      </div>
    `;
  }).join('');

  return `<div class="bouquet-arrangement"><div class="bouquet-ribbon"></div>${stems}</div>`;
}

function buildBouquetFlower({ progress, flowerType }) {
  if (progress <= 0) {
    return '<div class="bq-seed"></div><div class="bq-stem-line bq-stem-short"></div>';
  }

  const state = getFlowerState(progress);
  const colors = BloomieUI.getFlowerColors(flowerType);
  const petalCount = state.petals;
  const angleStep = 360 / Math.max(petalCount, 1);

  const petals = Array.from({ length: petalCount }, (_, p) =>
    `<div class="bq-petal" style="background:${colors.petals}; transform: rotate(${p * angleStep}deg) translateY(-9px);"></div>`
  ).join('');
  const center = state.showCenter ? `<div class="bq-center" style="background:${colors.center};"></div>` : '';

  return `
    <div class="bq-head">
      ${petals}
      ${center}
    </div>
    <div class="bq-stem-line"></div>
  `;
}

async function closeBouquet() {
  document.getElementById('bouquetOverlay').style.display = 'none';
  bouquetShowing = false;

  await FlowerStorage.markBouquetSeen();

  // Start the new week with an empty garden.
  const garden = await FlowerStorage.getGarden();
  const today = await FlowerStorage.getCurrentDate();
  const mondayStr = FlowerStorage.formatDate(FlowerStorage.getMondayOf(today));
  for (const dateStr of Object.keys(garden)) {
    if (dateStr < mondayStr) delete garden[dateStr];
  }
  await chrome.storage.local.set({ garden });

  await renderAll();
}

function showBouquetConfetti() {
  const container = document.createElement('div');
  container.className = 'bouquet-confetti';
  BloomieUI.spawnConfetti(container, 40);
  document.getElementById('bouquetOverlay').appendChild(container);
  setTimeout(() => container.remove(), CONFETTI_LIFETIME_MS);
}

// === CELEBRATION (all tasks completed) ===

function showFlowerAnimation() {
  const overlay = document.getElementById('flowerOverlay');
  const colors = FLOWER_COLORS[todayFlowerType];
  const petalCount = 5;
  const petals = `<div class="petal" style="background: ${petalGradient(colors.petals, -20)}"></div>`.repeat(petalCount);

  overlay.innerHTML = `
    <div class="flower-grow-overlay">
      <div class="flower-grow-container flower-type-${todayFlowerType}">
        <div class="flower-head">
          <div class="flower-petals petals-${petalCount}">
            ${petals}
            <div class="flower-center" style="background: ${colors.center}"></div>
          </div>
        </div>
        <div class="flower-leaf flower-leaf-left"></div>
        <div class="flower-leaf flower-leaf-right"></div>
        <div class="flower-stem"></div>
      </div>
    </div>
  `;

  setTimeout(() => spawnBloomParticles(overlay, colors.petals), 1200);
  setTimeout(() => { overlay.innerHTML = ''; }, 3000);
}

function spawnBloomParticles(overlay, color) {
  const overlayEl = overlay.querySelector('.flower-grow-overlay');
  if (!overlayEl) return;

  for (let i = 0; i < 12; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.cssText = `
      left: calc(50% + ${(Math.random() - 0.5) * 60}px);
      top: calc(50% - 80px);
      background: ${color};
      --tx: ${(Math.random() - 0.5) * 120}px;
      --ty: ${(Math.random() - 0.5) * 120}px;
      animation-delay: ${Math.random() * 0.3}s;
    `;
    overlayEl.appendChild(particle);
  }
}

function showCelebration() {
  const container = document.createElement('div');
  container.className = 'celebration';
  document.body.appendChild(container);
  BloomieUI.spawnConfetti(container, 60);
  setTimeout(() => container.remove(), CONFETTI_LIFETIME_MS);
}
