// Bloomie - Background service worker
// Handles site blocking rules and the daily reset.

import './js/storage.js';

const FlowerStorage = self.FlowerStorage;

const ALARM_MIDNIGHT = 'midnight-reset';
const GARDEN_RETENTION_DAYS = 14;
const BLOCKED_PAGE = '/blocked/blocked.html';

// === LIFECYCLE ===

chrome.runtime.onInstalled.addListener(async () => {
  const { tasks } = await chrome.storage.local.get('tasks');

  if (!tasks) {
    await chrome.storage.local.set({
      tasks: [],
      blockedSites: [],
      garden: {},
      settings: { ...FlowerStorage.DEFAULT_SETTINGS },
      lastResetDate: await FlowerStorage.getTodayString()
    });
  }

  await FlowerStorage.initWeekTracking();
  scheduleMidnightAlarm();
  await updateBlockingRules();
});

chrome.runtime.onStartup.addListener(async () => {
  await checkDailyReset();
  scheduleMidnightAlarm();
  await updateBlockingRules();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;

  if (changes.tasks || changes.blockedSites) {
    await updateBlockingRules();
  }

  if (changes.tasks) {
    await FlowerStorage.saveTodayToGarden();
  }

  // A simulated date change may require a daily reset.
  if (changes.debugDate) {
    await checkDailyReset();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_MIDNIGHT) return;
  await performDailyReset();
  scheduleMidnightAlarm();
});

// === DAILY RESET ===

/** Schedules the next reset at real midnight (ignores the simulated date). */
function scheduleMidnightAlarm() {
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  chrome.alarms.create(ALARM_MIDNIGHT, { when: midnight.getTime() });
}

async function checkDailyReset() {
  const { lastResetDate } = await chrome.storage.local.get('lastResetDate');
  if (lastResetDate !== await FlowerStorage.getTodayString()) {
    await performDailyReset();
  }
}

/** Archives the finished day in the garden, updates the streak and carries over essential tasks. */
async function performDailyReset() {
  const data = await chrome.storage.local.get(['tasks', 'garden', 'settings', 'lastResetDate']);
  const now = await FlowerStorage.getCurrentDate();
  const tasks = data.tasks || [];
  const garden = data.garden || {};
  const settings = data.settings || { ...FlowerStorage.DEFAULT_SETTINGS };

  // Tasks belong to the last reset date, which handles skipped days and debug date jumps.
  const taskDate = data.lastResetDate || FlowerStorage.formatDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  );

  if (tasks.length > 0) {
    const entry = FlowerStorage.buildGardenEntry(tasks, new Date(`${taskDate}T12:00:00`));
    garden[taskDate] = entry;
    settings.streak = entry.completed ? (settings.streak || 0) + 1 : 0;
  }

  // Unfinished essential tasks are carried over; everything else is dropped.
  const carriedOver = tasks
    .filter(task => !task.completed && task.type === 'essential')
    .map(task => ({
      ...task,
      carriedOver: true,
      originalDate: task.originalDate || task.createdAt
    }));

  pruneGarden(garden, now);

  await chrome.storage.local.set({
    tasks: carriedOver,
    garden,
    settings,
    lastResetDate: FlowerStorage.formatDate(now)
  });
}

/** Removes garden entries older than the retention window (kept for the weekly bouquet). */
function pruneGarden(garden, now) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - GARDEN_RETENTION_DAYS);
  for (const dateStr of Object.keys(garden)) {
    if (new Date(dateStr) < cutoff) delete garden[dateStr];
  }
}

// === SITE BLOCKING ===

/** Rebuilds the dynamic redirect rules: sites are blocked until every task is done. */
async function updateBlockingRules() {
  const data = await chrome.storage.local.get(['tasks', 'blockedSites']);
  const tasks = data.tasks || [];
  const blockedSites = data.blockedSites || [];

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  if (existingRules.length > 0) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existingRules.map(rule => rule.id)
    });
  }

  const { tier } = FlowerStorage.summarizeTasks(tasks);
  if (blockedSites.length === 0 || tier === 'free') return;

  const addRules = blockedSites.map((site, index) => {
    const domain = FlowerStorage.normalizeDomain(site);
    return {
      id: index + 1,
      priority: 1,
      action: {
        type: 'redirect',
        redirect: { extensionPath: `${BLOCKED_PAGE}?site=${encodeURIComponent(domain)}` }
      },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: ['main_frame']
      }
    };
  });

  await chrome.declarativeNetRequest.updateDynamicRules({ addRules });
}

// === MESSAGES ===

async function getStatus() {
  const data = await chrome.storage.local.get(['tasks', 'blockedSites', 'settings']);
  const { total, completed, allComplete, tier, progress } = FlowerStorage.summarizeTasks(data.tasks || []);

  return {
    taskCount: total,
    completedCount: completed,
    allComplete,
    tier,
    progress,
    sitesBlocked: total > 0 && !allComplete && (data.blockedSites || []).length > 0,
    streak: data.settings?.streak || 0
  };
}

const MESSAGE_HANDLERS = {
  GET_STATUS: getStatus,
  FORCE_UPDATE_RULES: () => updateBlockingRules().then(() => ({ success: true })),
  FORCE_DAILY_RESET: () => performDailyReset().then(() => ({ success: true })),
  CHECK_DAILY_RESET: () => checkDailyReset().then(() => ({ success: true }))
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const handler = MESSAGE_HANDLERS[message.type];
  if (!handler) return false;

  handler().then(sendResponse);
  return true; // Keep the channel open for the async response.
});
