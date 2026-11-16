// Bloomie - Blocked page script

const QUOTES = [
  "Le succes, c'est d'aller d'echec en echec sans perdre son enthousiasme.",
  "La discipline est le pont entre les objectifs et les resultats.",
  "Chaque fleur doit passer par la terre avant de s'epanouir.",
  "Un petit progres chaque jour mene a de grands resultats.",
  "La concentration est la cle de la reussite.",
  "Les grandes choses ne sont jamais faites par impulsion, mais par une serie de petites choses.",
  "Plante tes graines de productivite, recolte tes fleurs de succes.",
  "Le meilleur moment pour commencer, c'est maintenant.",
  "Ta future version te remerciera pour cet effort.",
  "Chaque tache terminee est un petale de plus dans ton jardin."
];

const PETAL_COLORS = ['#ff8fab', '#ffc0cb', '#ffb3c6', '#c88fd8', '#ffd700'];
const FLOATING_PETAL_COUNT = 15;
const REDIRECT_DELAY_MS = 1500;

let currentSite = '';

document.addEventListener('DOMContentLoaded', async () => {
  await BloomieUI.initPage();

  const params = new URLSearchParams(window.location.search);
  currentSite = params.get('site') || 'ce site';

  document.getElementById('blockedSite').innerHTML =
    `L'acces a <strong>${BloomieUI.escapeHtml(currentSite)}</strong> est temporairement bloque`;

  // Nothing left to do: this page should not be shown, go straight to the site.
  const initialStatus = await FlowerStorage.getTodayStatus();
  if (initialStatus.tier === 'free') {
    window.location.href = `https://${currentSite}`;
    return;
  }

  await renderStatus();
  renderFloatingPetals();
  renderQuote();

  BloomieUI.bindAddTaskForm({
    getType: () => 'light',
    maxMessage: `Maximum ${FlowerStorage.MAX_TASKS} taches par jour`,
    placeholder: 'Ajouter une tache rapide...',
    onAdded: renderStatus
  });

  document.getElementById('openTasks').addEventListener('click', () => {
    chrome.tabs.update({ url: chrome.runtime.getURL('newtab/newtab.html') });
  });

  document.getElementById('goBack').addEventListener('click', () => {
    history.back();
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== 'local' || !changes.tasks) return;

    const status = await FlowerStorage.getTodayStatus();
    if (status.tier === 'free') {
      redirectToSite();
      return;
    }
    await renderStatus();
  });
});

function redirectToSite() {
  document.querySelector('.blocked-title').textContent = 'Bravo ! 🌺';
  document.querySelector('.blocked-message').innerHTML = 'Toutes les taches terminees ! Redirection...';
  setTimeout(() => {
    window.location.href = `https://${currentSite}`;
  }, REDIRECT_DELAY_MS);
}

// === STATUS ===

async function renderStatus() {
  const { total, completed, remaining, allComplete, progress } = await FlowerStorage.getTodayStatus();

  document.getElementById('blockedMessage').innerHTML = total === 0
    ? `
      <p>Tu n'as pas encore de taches aujourd'hui.</p>
      <p>Ajoute des taches pour debloquer tes sites !</p>
    `
    : `
      <p>Encore <span class="highlight">${remaining}</span> tache${BloomieUI.plural(remaining)} pour debloquer ce site</p>
      <p>Termine toutes tes taches pour acceder a tes sites !</p>
    `;

  const pct = total > 0 ? progress * 100 : 0;
  document.getElementById('progressBar').style.width = `${pct}%`;
  document.getElementById('progressText').textContent = total > 0
    ? `${completed} sur ${total} taches terminees (${Math.round(pct)}%)`
    : 'Aucune tache pour le moment';

  await renderMiniGarden(allComplete, progress);
}

/** Renders the week (Monday → Sunday) as a row of small flowers. */
async function renderMiniGarden(todayComplete, todayProgress) {
  const garden = document.getElementById('blockedGarden');
  const weekData = await FlowerStorage.getWeekGarden();

  garden.innerHTML = weekData.map(day => {
    const labelClass = day.isToday ? 'blocked-day-label today' : 'blocked-day-label';
    const labelText = day.isToday ? 'Auj.' : day.dayName;
    return `
      <div class="blocked-day">
        ${renderDayFlower(day, todayComplete, todayProgress)}
        <div class="${labelClass}">${labelText}</div>
      </div>
    `;
  }).join('');
}

function renderDayFlower(day, todayComplete, todayProgress) {
  if (day.isFuture) {
    return '<div class="blocked-day-spot future"></div>';
  }

  if (day.completed || (day.isToday && todayComplete)) {
    const type = day.flowerType || (new Date(`${day.date}T12:00:00`).getDate() % 7);
    return createSmallFlower(type, 5);
  }

  const progress = day.isToday ? todayProgress : day.progress;
  if (day.progress > 0 || (day.isToday && todayProgress > 0)) {
    const petals = Math.max(1, Math.round(progress * 5));
    return createSmallFlower(day.flowerType || 0, petals, { partial: true });
  }

  return '<div class="blocked-day-spot"></div>';
}

/** Small flower used in the mini garden; partial flowers are faded and have no center. */
function createSmallFlower(type, petalCount, { partial = false } = {}) {
  const colors = BloomieUI.getFlowerColors(type);
  const angleStep = 360 / Math.max(petalCount, 1);
  const partialClass = partial ? ' partial' : '';

  const petals = Array.from({ length: petalCount }, (_, i) => `
    <div class="small-flower-petal" style="background:${colors.petals};transform:rotate(${i * angleStep}deg) translateY(-8px);"></div>
  `).join('');

  const center = partial ? '' : `<div class="small-flower-center" style="background:${colors.center};"></div>`;

  return `
    <div class="small-flower${partialClass}">
      <div class="small-flower-head">
        ${petals}
        ${center}
      </div>
    </div>
    <div class="small-flower-stem${partialClass}"></div>
  `;
}

// === DECORATION ===

function renderFloatingPetals() {
  const container = document.getElementById('floatingPetals');

  for (let i = 0; i < FLOATING_PETAL_COUNT; i++) {
    const petal = document.createElement('div');
    petal.className = 'floating-petal';
    const size = 8 + Math.random() * 16;
    petal.style.cssText = `
      left: ${Math.random() * 100}%;
      width: ${size}px;
      height: ${size}px;
      background: ${BloomieUI.randomItem(PETAL_COLORS)};
      border-radius: 50% 0 50% 50%;
      animation-duration: ${8 + Math.random() * 12}s;
      animation-delay: ${Math.random() * 10}s;
    `;
    container.appendChild(petal);
  }
}

function renderQuote() {
  document.getElementById('quote').textContent = `"${BloomieUI.randomItem(QUOTES)}"`;
}
