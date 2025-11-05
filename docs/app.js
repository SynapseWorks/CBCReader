// Client‑side script for the CBC news reader.

(() => {
  const sectionSelect = document.getElementById('sectionFilter');
  const searchInput = document.getElementById('searchInput');
  const opinionOnlyCheckbox = document.getElementById('opinionOnly');
  const newsList = document.getElementById('newsList');
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modalTitle');
  const modalSummary = document.getElementById('modalSummary');
  const modalLink = document.getElementById('modalLink');
  const closeBtn = document.querySelector('.close');

  let items = [];

  // Fetch the latest news JSON.
  async function fetchNews() {
    try {
      const resp = await fetch('../data/latest.json'); // served from /docs/data/latest.json
      if (!resp.ok) {
        throw new Error('Failed to fetch news');
      }
      const data = await resp.json();
      items = data.items || [];
      populateSections();
      renderList();
    } catch (err) {
      console.error(err);
      newsList.innerHTML = '<p>Unable to load news.</p>';
    }
  }

  // Populate the section select with distinct sections.
  function populateSections() {
    const sections = Array.from(new Set(items.map(item => item.section)));
    sections.sort();
    sections.forEach(sec => {
      const opt = document.createElement('option');
      opt.value = sec;
      opt.textContent = sec;
      sectionSelect.appendChild(opt);
    });
  }

  // Render the news list based on filters.
  function renderList() {
    const selectedSection = sectionSelect.value;
    const searchQuery = searchInput.value.trim().toLowerCase();
    const opinionOnly = opinionOnlyCheckbox.checked;
    const filtered = items.filter(item => {
      // Section filter
      if (selectedSection !== 'all' && item.section !== selectedSection) {
        return false;
      }
      // Opinion toggle
      if (opinionOnly && item.bias_heuristic.article_type !== 'Opinion') {
        return false;
      }
      // Search filter
      if (searchQuery && !item.title.toLowerCase().includes(searchQuery)) {
        return false;
      }
      return true;
    });
    // Clear list
    newsList.innerHTML = '';
    filtered.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      const titleEl = document.createElement('h3');
      titleEl.textContent = item.title;
      const metaEl = document.createElement('div');
      metaEl.className = 'meta';
      const date = new Date(item.published_at);
      metaEl.textContent = `${item.section} • ${date.toLocaleString()}`;
      const chips = document.createElement('div');
      chips.className = 'chips';
      // Article type chip
      const typeChip = document.createElement('span');
      typeChip.className = 'chip';
      typeChip.textContent = item.bias_heuristic.article_type;
      chips.appendChild(typeChip);
      // Sentiment chip
      const sentChip = document.createElement('span');
      sentChip.className = 'chip';
      sentChip.textContent = `Sent: ${item.bias_heuristic.sentiment.toFixed(2)}`;
      chips.appendChild(sentChip);
      // Subjectivity chip
      const subjChip = document.createElement('span');
      subjChip.className = 'chip';
      subjChip.textContent = `Subj: ${item.bias_heuristic.subjectivity_hint}`;
      chips.appendChild(subjChip);
      card.appendChild(titleEl);
      card.appendChild(metaEl);
      card.appendChild(chips);
      card.addEventListener('click', () => openModal(item));
      newsList.appendChild(card);
    });
    if (filtered.length === 0) {
      newsList.innerHTML = '<p>No articles match your criteria.</p>';
    }
  }

  function openModal(item) {
    modalTitle.textContent = item.title;
    modalSummary.textContent = item.summary_auto || 'No summary available.';
    modalLink.href = item.url;
    modal.classList.add('show');
  }

  function closeModal() {
    modal.classList.remove('show');
  }

  // Event listeners
  sectionSelect.addEventListener('change', renderList);
  searchInput.addEventListener('input', () => {
    // Debounce search by 200ms
    clearTimeout(searchInput._debounceTimer);
    searchInput._debounceTimer = setTimeout(renderList, 200);
  });
  opinionOnlyCheckbox.addEventListener('change', renderList);
  closeBtn.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Initialise
  fetchNews();
})();
