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
  const controls = document.getElementById('filters');
  const makeSelect = (label, values) => { const s = document.createElement('select'); s.setAttribute('aria-label', label); for (const [v,t] of values) s.add(new Option(t,v)); controls.appendChild(s); s.addEventListener('change',renderList); return s; };
  const mode = makeSelect('Group by', [['concept','By concept'],['source','By publication'],['country','By publisher location'],['latest','Latest articles']]);
  const sourceFilter = makeSelect('Publication', [['all','All publications']]);
  const countryFilter = makeSelect('Publisher location', [['all','All publisher locations']]);
  const concepts = [ ['Gender & LGBTQ+ rights', /transgender|gender.affirm|lgbtq|same.sex|queer|conversion therapy/i], ['Climate & energy', /climate|emissions|renewable|solar|wind power|coal|fossil fuel|battery|energy|cop\d+/i], ['Human rights & freedoms', /human rights|civil rights|censorship|freedom|discrimination|refugee|asylum|indigenous/i], ['Governance & democracy', /election|democra|parliament|government|legislation|politic|minister|president|court/i], ['Conflict & diplomacy', /war|military|ceasefire|diplomac|sanction|nato|invasion|peace talks/i], ['Economy & society', /econom|trade|tariff|housing|inflation|poverty|business|jobs/i], ['Health & science', /health|hospital|nurs|medicine|research|science|technology|space|vaccine/i] ];
  function concept(item) { const t = item.title+' '+(item.summary_auto||''); return concepts.find(([n,re])=>re.test(t))?.[0] || 'Other developments'; }
  function fill(s, vals) { for(const v of [...new Set(vals)].sort()) s.add(new Option(v,v)); }
  const notice=document.createElement('p'); notice.className='meta'; controls.after(notice);


  // Fetch the latest news JSON.
  async function fetchNews() {
    try {
      const resp = await fetch('data/latest.json'); // served from /docs/data/latest.json
      if (!resp.ok) {
        throw new Error('Failed to fetch news');
      }
      const data = await resp.json();
      items = (data.items || []).map(item => ({...item, source:item.source || 'CBC News', country:item.country || 'Canada'}));
      fill(sourceFilter,items.map(i=>i.source)); fill(countryFilter,items.map(i=>i.country));
      notice.textContent='Snapshot: '+(data.generated_at ? new Date(data.generated_at).toLocaleString() : 'unknown')+' • Publisher location is not a national viewpoint. Concept groups are keyword-based, not verified matches of the same event.';
      if (items.length === 0) {
        const stamp = data.generated_at ? new Date(data.generated_at).toLocaleString() : 'unknown';
        newsList.textContent = `The news feed currently has no articles. Last generated: ${stamp}. Please check back after the next update.`;
        return;
      }
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
      if(sourceFilter.value !== 'all' && item.source !== sourceFilter.value) return false;
      if(countryFilter.value !== 'all' && item.country !== countryFilter.value) return false;
      // Section filter
      if (selectedSection !== 'all' && item.section !== selectedSection) {
        return false;
      }
      // Opinion toggle
      if (opinionOnly && item.bias_heuristic.article_type !== 'Opinion') {
        return false;
      }
      // Search filter
      if (searchQuery && ![item.title,item.summary_auto,item.source,item.country,concept(item)].join(' ').toLowerCase().includes(searchQuery)) {
        return false;
      }
      return true;
    });
    // Clear list
    newsList.innerHTML = '';
    const key = item => mode.value==='concept' ? concept(item) : mode.value==='source' ? item.source : mode.value==='country' ? item.country : '';
    if(mode.value!=='latest') filtered.sort((a,b)=>key(a).localeCompare(key(b)) || a.source.localeCompare(b.source) || new Date(b.published_at)-new Date(a.published_at));
    let group=null;
    filtered.forEach(item => {
      if(key(item)!==group && mode.value!=='latest'){group=key(item); const h=document.createElement('h2'); h.textContent=group; h.style.gridColumn='1 / -1'; newsList.appendChild(h); }
      const card = document.createElement('div');
      card.className = 'card';
      const titleEl = document.createElement('h3');
      titleEl.textContent = item.title;
      const metaEl = document.createElement('div');
      metaEl.className = 'meta';
      const date = new Date(item.published_at);
      metaEl.textContent = `${item.source} • ${item.country} • ${item.section} • ${date.toLocaleString()}`;
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
      // Sentiment is not a reliability score; omit from display.
      // Subjectivity chip
      const subjChip = document.createElement('span');
      subjChip.className = 'chip';
      subjChip.textContent = `Subj: ${item.bias_heuristic.subjectivity_hint}`;
      // Subjectivity heuristic is not an evidence assessment.
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
    modalLink.textContent = 'Read original at '+item.source+' ('+item.country+')';
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
