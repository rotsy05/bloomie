// Bloomie - Shared storage module
// Loaded as a classic script by the extension pages and imported by the service worker.

const DAY_NAMES = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const MS_PER_DAY = 86400000;
const FLOWER_TYPE_COUNT = 7;

const FlowerStorage = {
  MAX_TASKS: 15,
  DEFAULT_SETTINGS: Object.freeze({ theme: 'rose', streak: 0 }),

  // === GENERIC HELPERS ===

  async get(key) {
    const data = await chrome.storage.local.get(key);
    return data[key];
  },

  async set(values) {
    await chrome.storage.local.set(values);
  },

  /** Strips protocol, "www." and path from a URL and returns a lowercase domain. */
  normalizeDomain(url) {
    return url
      .replace(/^(https?:\/\/)?(www\.)?/, '')
      .replace(/\/.*$/, '')
      .toLowerCase();
  },

  /** Summarises a task list into counters shared by every view. */
  summarizeTasks(tasks) {
    const total = tasks.length;
    const completed = tasks.filter(t => t.completed).length;
    const remaining = total - completed;
    const allComplete = total > 0 && remaining === 0;
    const progress = total > 0 ? completed / total : 0;
    const tier = (total === 0 || allComplete) ? 'free' : 'blocked';
    return { total, completed, remaining, allComplete, progress, tier };
  },

  /** Builds the garden entry describing one day of tasks. */
  buildGardenEntry(tasks, date) {
    const { total, completed, allComplete, progress } = this.summarizeTasks(tasks);
    return {
      completed: allComplete,
      taskCount: total,
      completedCount: completed,
      flowerType: date.getDate() % FLOWER_TYPE_COUNT,
      progress
    };
  },

  // === DATES ===

  formatDate(d) {
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
  },

  /** Returns the current date, or the simulated one when debug mode is on. */
  async getCurrentDate() {
    const { debugMode, debugDate } = await chrome.storage.local.get(['debugMode', 'debugDate']);
    if (!debugMode || !debugDate) return new Date();

    const [year, month, day] = debugDate.split('-').map(Number);
    const simulated = new Date(year, month - 1, day);
    const now = new Date();
    simulated.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    return simulated;
  },

  async getTodayString() {
    return this.formatDate(await this.getCurrentDate());
  },

  /** Returns the ISO week of a date, e.g. "2025-W07". */
  getISOWeekString(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / MS_PER_DAY) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  },

  /** Returns the Monday of the week containing `date`. */
  getMondayOf(date) {
    const dayOfWeek = date.getDay(); // 0 = Sunday
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(date);
    monday.setDate(date.getDate() + mondayOffset);
    return monday;
  },

  /** Returns `count` consecutive dates starting at `start`. */
  getConsecutiveDates(start, count) {
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  },

  // === DEBUG MODE ===

  async isDebugMode() {
    return !!(await this.get('debugMode'));
  },

  async setDebugMode(enabled) {
    await this.set({
      debugMode: enabled,
      debugDate: enabled ? this.formatDate(new Date()) : null
    });
  },

  async getDebugDate() {
    return (await this.get('debugDate')) || this.formatDate(new Date());
  },

  async setDebugDate(dateStr) {
    await this.set({ debugDate: dateStr });
  },

  async advanceDebugDate(days) {
    const current = await this.getCurrentDate();
    current.setDate(current.getDate() + days);
    const dateStr = this.formatDate(current);
    await this.set({ debugDate: dateStr });
    return dateStr;
  },

  /** Shows the "MODE TEST" badge on extension pages (not available in the service worker). */
  async initDebugBadge() {
    if (typeof document === 'undefined') return;
    const { debugMode, debugDate } = await chrome.storage.local.get(['debugMode', 'debugDate']);
    if (!debugMode) return;

    const badge = document.createElement('div');
    badge.className = 'debug-badge';
    badge.id = 'debugBadge';
    const setLabel = (label) => {
      badge.innerHTML = `<span class="debug-badge-dot"></span> MODE TEST &mdash; ${label}`;
    };
    setLabel(debugDate || 'aujourd\'hui');
    document.body.appendChild(badge);

    chrome.storage.onChanged.addListener((changes) => {
      if (changes.debugMode && !changes.debugMode.newValue) {
        badge.remove();
        return;
      }
      if (changes.debugDate?.newValue) {
        setLabel(changes.debugDate.newValue);
      }
    });
  },

  // === TASKS ===

  async getTasks() {
    return (await this.get('tasks')) || [];
  },

  /** Adds a task, or returns null when the daily limit is reached. */
  async addTask(text, type = 'light') {
    const tasks = await this.getTasks();
    if (tasks.length >= this.MAX_TASKS) return null;

    const now = await this.getCurrentDate();
    const task = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      text: text.trim(),
      completed: false,
      createdAt: now.toISOString(),
      type,
      carriedOver: false,
      originalDate: null
    };
    tasks.push(task);
    await this.set({ tasks });
    return task;
  },

  async toggleTask(id) {
    const tasks = await this.getTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.completed = !task.completed;
      const now = await this.getCurrentDate();
      task.completedAt = task.completed ? now.toISOString() : null;
      await this.set({ tasks });
    }
    return task;
  },

  async deleteTask(id) {
    const tasks = await this.getTasks();
    await this.set({ tasks: tasks.filter(t => t.id !== id) });
  },

  async editTask(id, newText) {
    const tasks = await this.getTasks();
    const task = tasks.find(t => t.id === id);
    if (task) {
      task.text = newText.trim();
      await this.set({ tasks });
    }
    return task;
  },

  async areAllTasksComplete() {
    return this.summarizeTasks(await this.getTasks()).allComplete;
  },

  async getCompletionPercentage() {
    return this.summarizeTasks(await this.getTasks()).progress;
  },

  /** Returns 'free' when there is nothing left to do, 'blocked' otherwise. */
  async getUnlockTier() {
    return this.summarizeTasks(await this.getTasks()).tier;
  },

  // === BLOCKED SITES ===

  async getBlockedSites() {
    return (await this.get('blockedSites')) || [];
  },

  async addBlockedSite(url) {
    const sites = await this.getBlockedSites();
    const domain = this.normalizeDomain(url);
    if (domain && !sites.includes(domain)) {
      sites.push(domain);
      await this.set({ blockedSites: sites });
    }
    return sites;
  },

  async removeBlockedSite(url) {
    const domain = this.normalizeDomain(url);
    const sites = (await this.getBlockedSites()).filter(s => s !== domain);
    await this.set({ blockedSites: sites });
    return sites;
  },

  // === GARDEN ===

  async getGarden() {
    return (await this.get('garden')) || {};
  },

  /** Saves today's live progress into the garden (called whenever tasks change). */
  async saveTodayToGarden() {
    const tasks = await this.getTasks();
    const today = await this.getCurrentDate();
    const todayStr = this.formatDate(today);
    const garden = await this.getGarden();

    if (tasks.length === 0) {
      if (garden[todayStr]) {
        delete garden[todayStr];
        await this.set({ garden });
      }
      return;
    }

    garden[todayStr] = this.buildGardenEntry(tasks, today);
    await this.set({ garden });
  },

  /** Returns the current calendar week (Monday → Sunday) with each day's garden data. */
  async getWeekGarden() {
    const garden = await this.getGarden();
    const today = await this.getCurrentDate();
    const todayStr = this.formatDate(today);
    const emptyDay = { completed: false, taskCount: 0, completedCount: 0, flowerType: 0, progress: 0 };

    return this.getConsecutiveDates(this.getMondayOf(today), 7).map((d, i) => {
      const dateStr = this.formatDate(d);
      const isToday = dateStr === todayStr;
      return {
        date: dateStr,
        dayName: DAY_NAMES[i],
        isToday,
        isFuture: d > today && !isToday,
        ...(garden[dateStr] || emptyDay)
      };
    });
  },

  // === BOUQUET ===

  /** Returns the 7 date strings (Monday → Sunday) of the week before `today`. */
  getPreviousWeekDates(today) {
    const prevMonday = this.getMondayOf(today);
    prevMonday.setDate(prevMonday.getDate() - 7);
    return this.getConsecutiveDates(prevMonday, 7).map(d => this.formatDate(d));
  },

  /** Keeps only the previous week's entries of a garden. */
  getPreviousWeekGarden(garden, today) {
    const filtered = {};
    for (const date of this.getPreviousWeekDates(today)) {
      if (garden[date]) filtered[date] = garden[date];
    }
    return filtered;
  },

  async getBouquetData() {
    const { lastBouquetWeek, weekBouquet } = await chrome.storage.local.get(['lastBouquetWeek', 'weekBouquet']);
    const today = await this.getCurrentDate();
    const currentWeek = this.getISOWeekString(today);
    const needsBouquet = lastBouquetWeek && lastBouquetWeek < currentWeek;

    if (!needsBouquet) {
      return { lastBouquetWeek, weekBouquet, currentWeek, needsBouquet };
    }

    // Prefer the live garden (freshest data); fall back to the saved snapshot.
    const prevWeekGarden = this.getPreviousWeekGarden(await this.getGarden(), today);
    const hasData = Object.keys(prevWeekGarden).length > 0;
    return {
      lastBouquetWeek,
      weekBouquet: hasData ? prevWeekGarden : (weekBouquet || {}),
      currentWeek,
      needsBouquet
    };
  },

  async markBouquetSeen() {
    const today = await this.getCurrentDate();
    const garden = await this.getGarden();
    await this.set({
      lastBouquetWeek: this.getISOWeekString(today),
      weekBouquet: this.getPreviousWeekGarden(garden, today)
    });
  },

  async initWeekTracking() {
    if (await this.get('lastBouquetWeek')) return;
    const today = await this.getCurrentDate();
    await this.set({ lastBouquetWeek: this.getISOWeekString(today) });
  },

  // === SETTINGS ===

  async getSettings() {
    return (await this.get('settings')) || { ...this.DEFAULT_SETTINGS };
  },

  async updateSettings(newSettings) {
    const settings = { ...(await this.getSettings()), ...newSettings };
    await this.set({ settings });
    return settings;
  },

  // === TODAY STATUS ===

  async getTodayStatus() {
    const tasks = await this.getTasks();
    const settings = await this.getSettings();
    return { tasks, ...this.summarizeTasks(tasks), streak: settings.streak || 0 };
  }
};

// Expose on the global scope so the module service worker can access it.
self.FlowerStorage = FlowerStorage;
