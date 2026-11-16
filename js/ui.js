// Bloomie - Shared UI helpers for the extension pages

const BloomieUI = {
  FLOWER_COLORS: [
    { petals: '#ff8fab', center: '#ffdd57', name: 'Rose' },
    { petals: '#c88fd8', center: '#ffdd57', name: 'Tulipe' },
    { petals: '#ffd700', center: '#8B4513', name: 'Tournesol' },
    { petals: '#ffffff', center: '#ffd700', name: 'Marguerite' },
    { petals: '#b8a0d8', center: '#e8d8f0', name: 'Lavande' },
    { petals: '#ffc0cb', center: '#ff6b8a', name: 'Cerisier' },
    { petals: '#ffb070', center: '#ffdd57', name: 'Lys' }
  ],

  CONFETTI_COLORS: ['#ff8fab', '#ffdd57', '#7ecf9a', '#b08fd8', '#ffd700', '#ff6b8a', '#87ceeb'],

  getFlowerColors(type) {
    return this.FLOWER_COLORS[type] || this.FLOWER_COLORS[0];
  },

  /** Applies the saved colour theme and shows the debug badge if needed. Returns the settings. */
  async initPage() {
    const settings = await FlowerStorage.getSettings();
    document.body.setAttribute('data-theme', settings.theme || 'rose');
    await FlowerStorage.initDebugBadge();
    return settings;
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  /** Lightens (positive) or darkens (negative) a hex colour. */
  adjustColor(hex, amount) {
    const num = parseInt(hex.replace('#', ''), 16);
    const clamp = (value) => Math.min(255, Math.max(0, value));
    const r = clamp((num >> 16) + amount);
    const g = clamp(((num >> 8) & 0xFF) + amount);
    const b = clamp((num & 0xFF) + amount);
    return `#${(1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1)}`;
  },

  plural(count) {
    return count > 1 ? 's' : '';
  },

  randomItem(list) {
    return list[Math.floor(Math.random() * list.length)];
  },

  /** Wires the "Légère / Essentielle" toggle and calls `onChange` with the selected type. */
  bindTaskTypeToggle(onChange) {
    const buttons = document.querySelectorAll('#taskTypeToggle .type-btn');
    buttons.forEach(btn => {
      btn.addEventListener('click', () => {
        buttons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(btn.dataset.type);
      });
    });
  },

  /** Clears the input and temporarily shows the "max tasks" message as placeholder. */
  showTaskLimitReached(input, maxMessage, defaultPlaceholder) {
    input.value = '';
    input.placeholder = maxMessage;
    setTimeout(() => { input.placeholder = defaultPlaceholder; }, 2000);
  },

  /** Wires the add-task form: handles empty input, the task limit and calls `onAdded`. */
  bindAddTaskForm({ getType, maxMessage, placeholder, onAdded }) {
    document.getElementById('addTaskForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('taskInput');
      const text = input.value.trim();
      if (!text) return;

      const task = await FlowerStorage.addTask(text, getType());
      if (!task) {
        this.showTaskLimitReached(input, maxMessage, placeholder);
        return;
      }
      input.value = '';
      await onAdded();
    });
  },

  /** Fades a task row out before running `action`. */
  fadeOutItem(item, action, delay = 300) {
    item.style.opacity = '0';
    item.style.transform = 'scale(0.96)';
    setTimeout(action, delay);
  },

  /** Adds `count` falling confetti pieces into `container`. */
  spawnConfetti(container, count) {
    for (let i = 0; i < count; i++) {
      const confetti = document.createElement('div');
      confetti.className = 'confetti';
      confetti.style.cssText = `
        left: ${Math.random() * 100}%;
        background: ${this.randomItem(this.CONFETTI_COLORS)};
        width: ${6 + Math.random() * 8}px;
        height: ${6 + Math.random() * 8}px;
        animation-duration: ${2 + Math.random() * 2}s;
        animation-delay: ${Math.random() * 0.8}s;
        border-radius: ${Math.random() > 0.5 ? '50%' : '2px'};
      `;
      container.appendChild(confetti);
    }
  }
};
