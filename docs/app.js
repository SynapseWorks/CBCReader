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

  let items = [], feedStatus=[], snapshotTime=0;
  const controls = document.getElementById('filters');
  const makeSelect = (label, values) => { const s = document.createElement('select'); s.setAttribute('aria-label', label); for (const [v,t] of values) s.add(new Option(t,v)); controls.appendChild(s); s.addEventListener('change',renderList); return s; };
  const mode = makeSelect('Group by', [['concept','By concept'],['story','Possible shared stories'],['source','By publication'],['country','By publisher location'],['latest','Latest articles']]);
  const sourceFilter = makeSelect('Publication', [['all','All publications']]);
  const countryFilter = makeSelect('Publisher location', [['all','All publisher locations']]);
  const dateFilter = makeSelect('Publication period', [['24','Past 24 hours'],['72','Past 3 days'],['168','Past 7 days'],['336','Past 14 days']]);
  const topicFilter = makeSelect('Concept', [['all','All concepts']]);
  const concepts = [ ['Gender & LGBTQ+ rights', /transgender|gender.affirm|lgbtq|same.sex|queer|conversion therapy/i], ['Climate & energy', /climate|emissions|renewable|solar|wind power|coal|fossil fuel|battery|energy|cop\d+/i], ['Human rights & freedoms', /human rights|civil rights|censorship|freedom|discrimination|refugee|asylum|indigenous/i], ['Governance & democracy', /election|democra|parliament|government|legislation|politic|minister|president|court/i], ['Conflict & diplomacy', /war|military|ceasefire|diplomac|sanction|nato|invasion|peace talks/i], ['Economy & society', /econom|trade|tariff|housing|inflation|poverty|business|jobs/i], ['Health & science', /health|hospital|nurs|medicine|research|science|technology|space|vaccine/i] ];
  concepts.push(['Education & culture', /school|universit|education|museum|culture|language|student/i], ['Technology & privacy', /artificial intelligence|cyber|privacy|surveillance|digital|internet|software/i], ['Migration & communities', /migration|immigrant|border|diaspora|community|communities/i], ['Food & environment', /agricultur|food security|biodiversity|forest|wildlife|water quality|pollution/i]);
  const aliases = [['Gender & LGBTQ+ rights', /\btrans\b|gender identity|marriage equality|sexual orientation/i], ['Climate & energy', /global warming|decarbon|electric vehicle|net zero|carbon tax/i], ['Human rights & freedoms', /free speech|civil liberties|press freedom|bodily autonomy/i]];
  function tags(item) { const t=item.title+' '+(item.summary_auto||''); return [...new Set([...concepts,...aliases].filter(([n,re])=>re.test(t)).map(([n])=>n))]; }
  function concept(item) { return item.tags[0] || 'Other developments'; }
  const stop = new Set('the a an and or in on at for of to from with by as is are was were be been has have had it its this that these those will would could can may says said say after before over about into new more than not their they them his her our your who what when where how why news report reports latest update world people year years day days amid against during'.split(' '));
  function tokens(s) {return [...new Set((s.toLowerCase().match(/[\p{L}\p{N}]+/gu)||[]).filter(w=>w.length>=3&&!stop.has(w)).map(w=>w.length>5?w.replace(/(?:ing|ed|s)$/,''):w))];}
  let weights=new Map(), links=new Map(), groups=new Map();
  function indexNews(){
    const df=new Map();
    for(const item of items){item.tags=tags(item);item.words=tokens(item.title+' '+(item.summary_auto||''));item.head=new Set(tokens(item.title));for(const w of item.words)df.set(w,(df.get(w)||0)+1);}
    weights=new Map([...df].map(([w,n])=>[w,1+Math.log((items.length+1)/(n+1))]));
    for(const item of items){item.vector=new Map(item.words.map(w=>[w,weights.get(w)*(item.head.has(w)?2:1)]));item.norm=Math.hypot(...item.vector.values());links.set(item.id,[]);}
    items.sort((a,b)=>Date.parse(b.published_at)-Date.parse(a.published_at));
    for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
      const a=items[i],b=items[j];const hours=Math.abs(Date.parse(a.published_at)-Date.parse(b.published_at))/3600000;if(hours>72)break;if(!Number.isFinite(hours))continue;
      const common=a.words.filter(w=>b.vector.has(w));const headOverlap=common.filter(w=>a.head.has(w)&&b.head.has(w)).length;
      const score=common.reduce((n,w)=>n+a.vector.get(w)*b.vector.get(w),0)/(a.norm*b.norm||1);
      const story=hours<=48&&score>=0.38&&common.length>=3&&headOverlap>=2;
      const related=score>=0.19&&common.length>=2;
      if(story||related){links.get(a.id).push({item:b,score,story});links.get(b.id).push({item:a,score,story});}
    }
    for(const item of items)links.get(item.id).sort((a,b)=>Number(b.story)-Number(a.story)||b.score-a.score);
    // Conservative anchor groups: every member must match the anchor; no transitive chaining.
    for(const item of items){if(groups.has(item.id))continue;const matches=links.get(item.id).filter(x=>x.story&&!groups.has(x.item.id));if(!matches.some(x=>x.item.source!==item.source))continue;groups.set(item.id,item.title);for(const x of matches)groups.set(x.item.id,item.title);}
  }
  function matchesQuery(item,q){if(!q)return true;const raw=[item.title,item.summary_auto,item.source,item.country,...item.tags].join(' ').toLowerCase();if(raw.includes(q))return true;const words=tokens(q);const pool=new Set(tokens(raw));return words.length>0&&words.every(w=>pool.has(w));}
  const cross=document.createElement('input');cross.type='checkbox';cross.checked=true;const crossLabel=document.createElement('label');crossLabel.append(cross,' Include related coverage beyond selected sources');controls.append(crossLabel);cross.addEventListener('change',renderList);
  const relatedPanel=document.createElement('section');relatedPanel.className='related-panel';modalLink.parentElement.after(relatedPanel);
  function originalLink(item,label){const a=document.createElement('a');a.textContent=label;try{const url=new URL(item.url);if(!['http:','https:'].includes(url.protocol))throw Error();a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';}catch{a.textContent='Original link unavailable';}return a;}
  function addText(parent,tag,text){const e=document.createElement(tag);e.textContent=text;parent.append(e);return e;}
  function originHint(item){const text=(item.byline||'')+' '+(item.summary_auto||'').slice(0,160);const known=[[/\bReuters\b/i,'Reuters'],[/\bAssociated Press\b|\(AP\)/i,'Associated Press'],[/\bAgence France.Presse\b|\bAFP\b/i,'AFP'],[/\bCanadian Press\b/i,'The Canadian Press'],[/\bXinhua\b/i,'Xinhua']];return known.filter(([re])=>re.test(text)).map(([,name])=>name);}
  function comparisonDetails(item){
    const matches=(links.get(item.id)||[]).filter(x=>x.story).slice(0,30);
    const peers=[item,...matches.map(x=>x.item)].sort((a,b)=>Date.parse(a.published_at)-Date.parse(b.published_at));
    addText(relatedPanel,'h3','Coverage timeline');
    addText(relatedPanel,'p','Publication times supplied by feeds, not necessarily first reporting. '+new Set(peers.map(x=>x.source)).size+' publications • '+new Set(peers.map(x=>x.country)).size+' publisher locations');
    for(const a of peers){const row=document.createElement('div');row.className='timeline-entry';addText(row,'small',new Date(a.published_at).toLocaleString()+' • '+a.source+' · '+a.country);row.append(originalLink(a,a.title));const hints=originHint(a);if(hints.length)addText(row,'small','Possible attribution mention: '+hints.join(', '));if(a.byline)addText(row,'small','RSS byline: '+a.byline);relatedPanel.append(row);}
    addText(relatedPanel,'h3','Language & emphasis');
    for(const a of peers.slice(0,8)){const row=document.createElement('div');row.className='comparison-excerpt';addText(row,'strong',a.source+' · '+a.country);row.append(originalLink(a,a.title));addText(row,'p',a.summary_auto||'No RSS excerpt available.');relatedPanel.append(row);}
    addText(relatedPanel,'small','Compare the original wording; this is not an automated judgment of framing or truth.');
    const seen=new Set(peers.map(a=>a.source));const healthy=[...new Set(feedStatus.filter(f=>f.status==='ok').map(f=>f.source))];const missing=healthy.filter(s=>!seen.has(s));const unavailable=[...new Set(feedStatus.filter(f=>f.status!=='ok').map(f=>f.source))].filter(s=>!healthy.includes(s));
    addText(relatedPanel,'h3','Coverage visibility');
    addText(relatedPanel,'p',feedStatus.length?'No strong match in this collection: '+(missing.join(', ')||'None among successfully checked sources'):'Feed status not yet available.');
    if(unavailable.length)addText(relatedPanel,'p','Unavailable at last collection: '+unavailable.join(', '));
    addText(relatedPanel,'small','Absence from monitored feeds is not evidence of non-coverage. Caps, date windows, vocabulary and feed outages affect matching. Shared attribution mentions are not proof of syndication.');
    const exportBtn=addText(relatedPanel,'button','Copy investigation brief');exportBtn.type='button';exportBtn.addEventListener('click',async()=>{const brief=['World Reader investigation candidate',item.title,'Unverified possible same-event coverage:',...peers.map(a=>a.source+' ('+a.country+') | '+a.published_at+' | '+a.title+' | '+a.url),'Research questions: What is independently confirmed? What is missing? Are these independent sources?'].join('\n');try{await navigator.clipboard.writeText(brief);exportBtn.textContent='Copied investigation brief';}catch{const t=document.createElement('textarea');t.value=brief;relatedPanel.append(t);t.select();exportBtn.textContent='Select and copy the brief below';}});
  }
  function relatedList(item){relatedPanel.replaceChildren();comparisonDetails(item);const all=links.get(item.id)||[];const foreign=all.filter(x=>x.item.country!==item.country);const rest=all.filter(x=>x.item.country===item.country);const selected=[...foreign,...rest].sort((a,b)=>Number(b.story)-Number(a.story)||Number(b.item.country!==item.country)-Number(a.item.country!==item.country)||b.score-a.score).slice(0,12);for(const story of [true,false]){const h=document.createElement('h3');h.textContent=story?'Possible same-event coverage':'Related context';relatedPanel.append(h);const rows=selected.filter(x=>x.story===story);if(!rows.length){const p=document.createElement('p');p.textContent='No matching articles in the current snapshot.';relatedPanel.append(p);}for(const x of rows){const p=document.createElement('p');p.append(originalLink(x.item,x.item.title),document.createElement('br'),document.createTextNode(x.item.source+' • '+x.item.country+' • '+new Date(x.item.published_at).toLocaleString()));relatedPanel.append(p);}}const n=document.createElement('small');n.textContent='Automated headline and RSS excerpt similarity; not verified event identity or independent corroboration.';relatedPanel.append(n);}

  const health=document.createElement('details');health.className='feed-health';controls.after(health);
  function renderFeedHealth(){health.replaceChildren();const ok=feedStatus.filter(f=>f.status==='ok');addText(health,'summary',feedStatus.length?'Feed health: '+ok.length+' / '+feedStatus.length+' feeds checked successfully':'Feed health: awaiting next collection');for(const f of feedStatus)addText(health,'div',f.source+' · '+f.country+' · '+f.key+' — '+(f.status==='ok'?f.count+' recent articles returned':'unavailable'));}
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
      feedStatus=data.feed_status||[];snapshotTime=Date.parse(data.generated_at)||Date.now();
      indexNews();
      fill(topicFilter,items.flatMap(i=>i.tags));
      renderFeedHealth();
      fill(sourceFilter,items.map(i=>i.source)); fill(countryFilter,items.map(i=>i.country));
      notice.textContent='Snapshot: '+(data.generated_at ? new Date(data.generated_at).toLocaleString() : 'unknown')+' • Publisher location is not a national viewpoint. Concepts and possible story matches use headlines and RSS excerpts; connections are suggestions, not verification.';
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
    const cutoff=snapshotTime-Number(dateFilter.value)*3600000;
    let filtered = items.filter(item => {
      if(Date.parse(item.published_at)<cutoff)return false;
      if(topicFilter.value!=='all'&&!item.tags.includes(topicFilter.value))return false;
      if(sourceFilter.value !== 'all' && item.source !== sourceFilter.value) return false;
      if(countryFilter.value !== 'all' && item.country !== countryFilter.value) return false;
      // Section filter
      if (selectedSection !== 'all' && item.section !== selectedSection) {
        return false;
      }
      // Opinion toggle
      if (opinionOnly && item.bias_heuristic?.article_type !== 'Opinion') {
        return false;
      }
      // Search filter
      if (!matchesQuery(item,searchQuery)) {
        return false;
      }
      return true;
    });
    const direct=new Set(filtered.map(i=>i.id));
    if(cross.checked&&(searchQuery||sourceFilter.value!=='all'||countryFilter.value!=='all')){const extra=new Map();for(const item of filtered)for(const x of (links.get(item.id)||[]).slice(0,5)){if(Date.parse(x.item.published_at)>=cutoff&&!direct.has(x.item.id)&&(!opinionOnly||x.item.bias_heuristic?.article_type==='Opinion'))extra.set(x.item.id,x.item);}filtered=[...filtered,...extra.values()];}
    // Clear list
    newsList.innerHTML = '';
    const key = item => mode.value==='story' ? (groups.get(item.id)||'No strong cross-publication match') : mode.value==='concept' ? concept(item) : mode.value==='source' ? item.source : mode.value==='country' ? item.country : '';
    if(mode.value!=='latest') filtered.sort((a,b)=>key(a).localeCompare(key(b)) || a.source.localeCompare(b.source) || new Date(b.published_at)-new Date(a.published_at));
    let group=null;
    const total=filtered.length;let visible=Number(newsList.dataset.limit||120);const shown=filtered.slice(0,visible);
    shown.forEach(item => {
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
      typeChip.textContent = item.bias_heuristic?.article_type || 'Unclassified';
      chips.appendChild(typeChip);
      for(const tag of item.tags){const chip=document.createElement('span');chip.className='chip';chip.textContent=tag;chips.append(chip);}
      if(!direct.has(item.id)){const chip=document.createElement('span');chip.className='chip';chip.textContent='Related result';chips.append(chip);}
      const peers=(links.get(item.id)||[]).filter(x=>x.story&&x.item.country!==item.country);
      if(peers.length){const chip=document.createElement('span');chip.className='chip';chip.textContent='Possible same story: '+new Set(peers.map(x=>x.item.country)).size+' other publisher locations';chips.append(chip);}
      card.appendChild(titleEl);
      card.appendChild(metaEl);
      card.appendChild(chips);
      const actions=document.createElement('div');actions.className='article-actions';const compare=document.createElement('button');compare.type='button';compare.textContent='Compare coverage ('+(links.get(item.id)||[]).length+')';compare.addEventListener('click',e=>{e.stopPropagation();openModal(item);});const original=originalLink(item,'Read original ↗');original.addEventListener('click',e=>e.stopPropagation());actions.append(compare,original);card.append(actions);
      card.addEventListener('click', () => openModal(item));
      newsList.appendChild(card);
    });
    if(total>visible){const more=document.createElement('button');more.type='button';more.textContent='Show more ('+shown.length+' of '+total+')';more.addEventListener('click',()=>{newsList.dataset.limit=String(visible+120);renderList();});newsList.append(more);}
    if (filtered.length === 0) {
      newsList.innerHTML = '<p>No articles match your criteria.</p>';
    }
  }

  function openModal(item) {
    modalTitle.textContent = item.title;
    modalLink.textContent = 'Read original at '+item.source+' ('+item.country+')';
    modalSummary.textContent = item.summary_auto || 'No summary available.';
    const safe=originalLink(item,'');modalLink.removeAttribute('href');if(safe.hasAttribute('href'))modalLink.href=safe.href;
    relatedList(item);
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
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal();});
  fetchNews();
})();
