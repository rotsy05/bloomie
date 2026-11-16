// Bloomie - Popup script

let selectedType = 'light';

document.addEventListener('DOMContentLoaded', async () => {
  await BloomieUI.initPage();
  await renderTasks();

  BloomieUI.bindTaskTypeToggle((type) => { selectedType = type; });
  BloomieUI.bindAddTaskForm({
    getType: () => selectedType,
    maxMessage: `Maximum ${FlowerStorage.MAX_TASKS} tâches par jour`,
    placeholder: 'Ajouter une tâche...',
    onAdded: renderTasks
  });

  document.getElementById('openNewTab').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('newtab/newtab.html') });
    window.close();
  });

  document.getElementById('openOptions').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });
});

async function renderTasks() {
  const { tasks, total, completed, remaining, tier } = await FlowerStorage.getTodayStatus();

  document.getElementById('progress').textContent = `${completed}/${total}`;
  document.getElementById('progressBar').style.width = total > 0 ? `${(completed / total) * 100}%` : '0%';
  renderStatusMessage(total, remaining, tier);

  const taskList = document.getElementById('taskList');

  if (tasks.length === 0) {
    taskList.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🌱</span>
        <p>Pas encore de tâches aujourd'hui</p>
      </div>
    `;
    return;
  }

  taskList.innerHTML = tasks.map(renderTaskItem).join('');

  taskList.querySelectorAll('.task-checkbox input').forEach(checkbox => {
    checkbox.addEventListener('change', async (e) => {
      await FlowerStorage.toggleTask(e.target.closest('.task-item').dataset.id);
      await renderTasks();
    });
  });

  taskList.querySelectorAll('.task-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = e.target.closest('.task-item');
      BloomieUI.fadeOutItem(item, async () => {
        await FlowerStorage.deleteTask(item.dataset.id);
        await renderTasks();
      });
    });
  });
}

function renderStatusMessage(total, remaining, tier) {
  const statusMessage = document.getElementById('statusMessage');
  statusMessage.className = 'status-message';

  if (total === 0) {
    statusMessage.textContent = 'Ajoute des tâches pour commencer ta journee !';
  } else if (tier === 'free') {
    statusMessage.textContent = '🌸 Toutes les tâches terminees ! Sites debloques !';
    statusMessage.classList.add('all-done');
  } else {
    statusMessage.textContent = `Encore ${remaining} tache${BloomieUI.plural(remaining)} pour debloquer tes sites`;
  }
}

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
      <button class="task-delete" title="Supprimer">&times;</button>
    </div>
  `;
}
