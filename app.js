'use strict';

// Existing Supabase project; no schema changes are required.
const SUPABASE_URL = 'https://trglbxiirkennfqhexdi.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyZ2xieGlpcmtlbm5mcWhleGRpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMzUxODMsImV4cCI6MjEwNjgxMTE4M30.b1L4IyP7nJ7j9bi0_KLYwfcyScAAjV30gb4D4vvpxnk';
const supabaseClient = window.supabase?.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const appWindow = $('app-window');
const messagesEl = $('messages');
const messageContent = $('message-content');
const cameraVideo = $('camera-video');
const cameraPreview = $('camera-preview');
const portraitCache = new Map();
const silhouetteCache = new Map();
const silhouetteSources = new Map();
const originalPhotoCache = new Map();
const seedPortraitCache = new Map();
const seedTileAssignments = new Map();
const DITHER_SETTINGS = { contrast: 2.2, threshold: 150, dotSpacing: 3, outputSize: 768 };
const portraitRenderers = new Map();
let seedSheetPromise = null;
const screens = ['landing-screen', 'profile-screen', 'created-screen', 'chat-screen'];
const state = {
  screen: 'landing-screen',
  transparent: false,
  active: null,
  archives: [],
  sending: false,
  creating: false,
  archiveRequest: 0,
  cameraRequest: 0,
  cameraStream: null,
  cameraPending: false,
  cameraFrame: 0,
  capturedBlob: null,
  capturedUrl: null,
  pendingProfileId: null,
  uploadedPhotoPath: null,
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function notice(text = '') {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}

let windowTransitionTimer = 0;

function stopWindowTransition() {
  clearTimeout(windowTransitionTimer);
  appWindow.classList.remove('stage-transition');
}

function showScreen(id) {
  const changesWindowSize = (state.screen === 'chat-screen') !== (id === 'chat-screen');
  stopWindowTransition();
  if (changesWindowSize) {
    appWindow.classList.add('stage-transition');
    // Establish the current dimensions before changing the stage's size rules.
    void appWindow.offsetWidth;
    windowTransitionTimer = setTimeout(stopWindowTransition, 350);
  }
  state.screen = id;
  screens.forEach(screen => { $(screen).hidden = screen !== id; });
  appWindow.classList.toggle('in-session', id === 'chat-screen');
  $('window-title').textContent = id === 'chat-screen' ? 'BOT-FRIEND.START' : '';
  notice();
}

function windowRatios(width, height) {
  const viewportRatio = Math.max(1, width) / Math.max(1, height);
  // Preserve the default ratios on ordinary screens. Ease away from them only
  // beyond portrait-like or ultrawide proportions, without breakpoint jumps.
  let distance = 0;
  if (viewportRatio < 1.1) distance = Math.log(viewportRatio / 1.1);
  else if (viewportRatio > 2.1) distance = Math.log(viewportRatio / 2.1);
  const magnitude = Math.abs(distance);
  const adjustment = Math.sign(distance) * .85 * magnitude * magnitude / (magnitude + .35);
  const scale = Math.exp(adjustment);
  return { start: 5 / 4 * scale, chat: 9 / 6 * scale };
}

function resizeAppWindow() {
  stopWindowTransition();
  const ratios = windowRatios(window.innerWidth, window.innerHeight);
  appWindow.style.setProperty('--start-ratio', ratios.start);
  appWindow.style.setProperty('--chat-ratio', ratios.chat);
}

resizeAppWindow();
window.addEventListener('resize', resizeAppWindow);

function displayDate(value) {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toLocaleDateString('en-US') : '—';
}

function shortId(value) {
  return value ? String(value).slice(0, 6).toUpperCase() : '—';
}

function filterKey(renderSize = DITHER_SETTINGS.outputSize / 2) {
  return JSON.stringify([DITHER_SETTINGS, Math.round(renderSize)]);
}

function portraitSize(node) {
  const bounds = node.getBoundingClientRect();
  return Math.max(1, Math.round(Math.min(bounds.width, bounds.height) || DITHER_SETTINGS.outputSize / 2));
}

// Keep dot spacing constant in displayed pixels: smaller pictures get fewer dots.
// This is a display effect; storage receives the unfiltered original capture.
function dither(source, target, mirror = false, fit = 'cover', renderSize = DITHER_SETTINGS.outputSize / 2) {
  const size = Math.max(1, Math.round(renderSize / DITHER_SETTINGS.dotSpacing));
  const outputSize = Math.max(1, Math.round(renderSize * 2));
  const spacing = outputSize / size;
  const radius = spacing * .275;
  const sample = document.createElement('canvas');
  sample.width = sample.height = size;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  const width = source.videoWidth || source.naturalWidth || source.width;
  const height = source.videoHeight || source.naturalHeight || source.height;
  if (!width || !height) return false;
  const crop = Math.min(width, height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, size, size);
  if (mirror) { ctx.translate(size, 0); ctx.scale(-1, 1); }
  if (fit === 'contain') {
    const scale = size / Math.max(width, height);
    ctx.drawImage(source, 0, 0, width, height, (size - width * scale) / 2, (size - height * scale) / 2, width * scale, height * scale);
  } else {
    ctx.drawImage(source, (width - crop) / 2, (height - crop) / 2, crop, crop, 0, 0, size, size);
  }
  const pixels = ctx.getImageData(0, 0, size, size).data;
  const out = target.getContext('2d');
  target.width = target.height = outputSize;
  out.fillStyle = '#fff';
  out.fillRect(0, 0, outputSize, outputSize);
  out.fillStyle = '#000';
  out.beginPath();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const gray = .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2];
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * DITHER_SETTINGS.contrast + 128));
      if (contrasted < DITHER_SETTINGS.threshold) {
        const centerX = (x + .5) * spacing;
        const centerY = (y + .5) * spacing;
        out.moveTo(centerX + radius, centerY);
        out.arc(centerX, centerY, radius, 0, Math.PI * 2);
      }
    }
  }
  out.fill();
  return true;
}

function silhouetteSource(key = 'bot') {
  if (silhouetteSources.has(key)) return silhouetteSources.get(key);
  const source = document.createElement('canvas');
  source.width = source.height = 384;
  const ctx = source.getContext('2d');
  let seed = 0;
  for (const char of String(key)) seed = (seed * 31 + char.charCodeAt(0)) >>> 0;
  const shift = (seed % 23) - 11;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 384, 384);
  ctx.fillStyle = '#292929';
  ctx.beginPath();
  ctx.ellipse(192 + shift, 161, 92 + seed % 12, 143, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#555';
  ctx.beginPath();
  ctx.ellipse(192, 384, 154, 98, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#eee';
  ctx.fillRect(170 + shift, 236, 45, 88);
  ctx.beginPath();
  ctx.ellipse(196 + shift, 165, 60, 98, -.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8b8b8b';
  ctx.beginPath();
  ctx.ellipse(174 + shift, 166, 33, 83, -.1, Math.PI / 2, Math.PI * 1.5);
  ctx.fill();
  ctx.fillStyle = '#282828';
  ctx.beginPath();
  ctx.ellipse(174 + shift, 75, 70, 50, -.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(164 + shift, 151, 15, 5);
  ctx.fillRect(211 + shift, 151, 17, 5);
  ctx.fillStyle = '#999';
  ctx.beginPath();
  ctx.moveTo(194 + shift, 157);
  ctx.lineTo(184 + shift, 190);
  ctx.lineTo(202 + shift, 191);
  ctx.fill();
  ctx.fillStyle = '#555';
  ctx.fillRect(180 + shift, 215, 30, 4);
  silhouetteSources.set(key, source);
  return source;
}

function silhouette(key = 'bot', renderSize = DITHER_SETTINGS.outputSize / 2) {
  const cacheKey = JSON.stringify([key, filterKey(renderSize)]);
  if (silhouetteCache.has(cacheKey)) return silhouetteCache.get(cacheKey);
  const output = document.createElement('canvas');
  dither(silhouetteSource(key), output, false, 'cover', renderSize);
  const url = output.toDataURL('image/png');
  silhouetteCache.set(cacheKey, url);
  return url;
}

function getPhotoUrl(path) {
  return path && supabaseClient ? supabaseClient.storage.from('conversation-photos').getPublicUrl(path).data.publicUrl : null;
}

function loadSeedSheet() {
  if (!seedSheetPromise) {
    seedSheetPromise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load the seed portrait sheet.'));
      image.src = './seed%20data%20profile%20pic.png';
    });
  }
  return seedSheetPromise;
}

function seedPortrait(profile, renderSize = DITHER_SETTINGS.outputSize / 2) {
  const key = profile.key || profile.id || profile.name || 'seed';
  const cacheKey = JSON.stringify([key, filterKey(renderSize)]);
  if (!seedTileAssignments.has(key)) seedTileAssignments.set(key, Math.floor(Math.random() * 9));
  if (!seedPortraitCache.has(cacheKey)) {
    // Pick once per seed, so its card, thumbnail and message share a face.
    const tile = seedTileAssignments.get(key);
    const portrait = loadSeedSheet().then(image => {
      const column = tile % 3;
      const row = Math.floor(tile / 3);
      const x = Math.round(column * image.naturalWidth / 3);
      const y = Math.round(row * image.naturalHeight / 3);
      const width = Math.round((column + 1) * image.naturalWidth / 3) - x;
      const height = Math.round((row + 1) * image.naturalHeight / 3) - y;
      const crop = document.createElement('canvas');
      crop.width = width;
      crop.height = height;
      crop.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height);
      const output = document.createElement('canvas');
      dither(crop, output, false, 'cover', renderSize);
      return output.toDataURL('image/png');
    }).catch(() => silhouette(key, renderSize));
    seedPortraitCache.set(cacheKey, portrait);
  }
  return seedPortraitCache.get(cacheKey);
}

function loadOriginalPhoto(url) {
  if (!originalPhotoCache.has(url)) {
    const photo = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not load the original photo.'));
      image.src = url;
    });
    originalPhotoCache.set(url, photo);
    // A later render can retry a temporary network failure.
    photo.catch(() => originalPhotoCache.delete(url));
  }
  return originalPhotoCache.get(url);
}

function processedPortrait(profile, renderSize = DITHER_SETTINGS.outputSize / 2) {
  if (profile.isSeed || String(profile.key).startsWith('seed:')) return seedPortrait(profile, renderSize);
  const isBot = profile.key === 'bot';
  const path = profile.photoPath;
  const url = isBot ? './bot.png' : profile.photoUrl || getPhotoUrl(path);
  if (!url) return Promise.resolve(silhouette(profile.key, renderSize));
  // Old PNG uploads contain only the baked effect; their originals cannot be recovered.
  if (!profile.photoUrl && /\.png$/i.test(path) && !/\.original\.png$/i.test(path)) return Promise.resolve(url);
  const mirror = profile.mirror ?? /\.original\.png$/i.test(path || '');
  const fit = isBot ? 'contain' : 'cover';
  const cacheKey = JSON.stringify([url, mirror, fit, filterKey(renderSize)]);
  if (!portraitCache.has(cacheKey)) {
    const portrait = loadOriginalPhoto(url).then(image => {
      const canvas = document.createElement('canvas');
      dither(image, canvas, mirror, fit, renderSize);
      return canvas.toDataURL('image/png');
    }).catch(() => {
      portraitCache.delete(cacheKey);
      return silhouette(profile.key, renderSize);
    });
    portraitCache.set(cacheKey, portrait);
  }
  return portraitCache.get(cacheKey);
}

function makePortrait(profile, className = '') {
  const img = el('img', 'portrait ' + className);
  img.alt = profile.name + ' — dotted portrait';
  img.width = img.height = DITHER_SETTINGS.outputSize;
  img.src = silhouette(profile.key, 48);
  let lastRenderKey = null;
  let request = 0;
  const render = () => {
    if (!img.isConnected || (viewSwitching && lastRenderKey != null)) return;
    const size = portraitSize(img);
    const key = filterKey(size);
    if (key === lastRenderKey) return;
    lastRenderKey = key;
    const currentRequest = ++request;
    return processedPortrait(profile, size).then(url => {
      if (currentRequest === request && img.isConnected) img.src = url;
    });
  };
  img.onerror = () => { img.onerror = null; img.src = silhouette(profile.key, portraitSize(img)); };
  portraitRenderers.set(img, render);
  portraitResizeObserver?.observe(img);
  requestAnimationFrame(() => { render(); prunePortraitRenderers(); });
  return img;
}

function prunePortraitRenderers() {
  for (const img of portraitRenderers.keys()) {
    if (!img.isConnected) {
      portraitResizeObserver?.unobserve(img);
      portraitRenderers.delete(img);
    }
  }
}

function resizeCameraPreview() {
  if (state.screen !== 'profile-screen') return;
  if (state.cameraPending) {
    clearCameraPreview();
    return;
  }
  const size = portraitSize(cameraPreview);
  if (state.cameraStream && cameraVideo.readyState >= 2) {
    dither(cameraVideo, cameraPreview, true, 'cover', size);
  } else if (state.capturedUrl) {
    const originalUrl = state.capturedUrl;
    loadOriginalPhoto(originalUrl).then(image => {
      if (state.capturedUrl === originalUrl && !state.cameraStream) dither(image, cameraPreview, true, 'cover', portraitSize(cameraPreview));
    }).catch(() => {});
  } else {
    dither(silhouetteSource('you'), cameraPreview, true, 'cover', size);
  }
}

const portraitResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(entries => {
  for (const entry of entries) {
    if (entry.target === cameraPreview) resizeCameraPreview();
    else portraitRenderers.get(entry.target)?.();
  }
  prunePortraitRenderers();
}) : null;
portraitResizeObserver?.observe(cameraPreview);
window.addEventListener('resize', () => {
  for (const render of portraitRenderers.values()) render();
  resizeCameraPreview();
  prunePortraitRenderers();
});

function renderProfile(target, profile, created = false) {
  target.classList.toggle('empty-profile', !profile);
  if (!profile) {
    target.replaceChildren(el('p', '', 'CONTRIBUTORS WILL APPEAR HERE'));
    return;
  }
  const name = el('p', 'profile-name', (created ? 'NAME: ' : '') + profile.name);
  const id = el('p', 'profile-id', 'ID: ' + shortId(profile.id));
  const meta = el('div', 'profile-meta');
  meta.append(el('span', '', created ? 'DATE CREATED ' + displayDate(profile.startedAt) : 'Date Recorded:'), el('span', '', created ? 'ID: ' + shortId(profile.id) : displayDate(profile.startedAt)));
  target.replaceChildren(name, ...(!created ? [id] : []), makePortrait(profile, 'profile-portrait'), meta);
}

async function beginProfile() {
  showScreen('profile-screen');
  await enableCamera();
}

function clearCameraPreview() {
  const context = cameraPreview.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, cameraPreview.width, cameraPreview.height);
}

async function enableCamera() {
  const request = ++state.cameraRequest;
  state.cameraPending = true;
  clearCameraPreview();
  $('camera-status').textContent = 'WAITING FOR CAMERA…';
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera unavailable');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
    if (request !== state.cameraRequest || state.screen !== 'profile-screen' || state.capturedBlob) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }
    state.cameraStream = stream;
    cameraVideo.srcObject = stream;
    await cameraVideo.play();
    if (request !== state.cameraRequest) return;
    state.cameraPending = false;
    $('camera-status').textContent = '';
    let lastFrame = 0;
    function frame(time) {
      if (!state.cameraStream || state.capturedBlob) return;
      if (time - lastFrame > 70 && cameraVideo.readyState >= 2) {
        dither(cameraVideo, cameraPreview, true, 'cover', portraitSize(cameraPreview));
        lastFrame = time;
      }
      state.cameraFrame = requestAnimationFrame(frame);
    }
    state.cameraFrame = requestAnimationFrame(frame);
  } catch {
    if (request !== state.cameraRequest) return;
    stopCamera();
    if (state.screen === 'profile-screen' && !state.capturedBlob) {
      $('camera-status').textContent = 'CAMERA UNAVAILABLE · CAPTURE YOUR GENERATED AVATAR';
      resizeCameraPreview();
    }
  }
}

function stopCamera() {
  ++state.cameraRequest;
  cancelAnimationFrame(state.cameraFrame);
  state.cameraStream?.getTracks().forEach(track => track.stop());
  state.cameraStream = null;
  state.cameraPending = false;
  cameraVideo.srcObject = null;
}

async function capturePhoto() {
  if (state.capturedBlob) return;
  if (state.cameraStream && cameraVideo.readyState < 2) {
    notice('The camera is warming up. Please try CAPTURE again in a moment.');
    return;
  }
  let original = silhouetteSource('you');
  if (state.cameraStream) {
    original = document.createElement('canvas');
    original.width = cameraVideo.videoWidth;
    original.height = cameraVideo.videoHeight;
    original.getContext('2d').drawImage(cameraVideo, 0, 0, original.width, original.height);
  }
  dither(original, cameraPreview, true, 'cover', portraitSize(cameraPreview));
  stopCamera();
  state.capturedBlob = await new Promise(resolve => original.toBlob(resolve, 'image/png'));
  if (!state.capturedBlob) { notice('Could not capture your photo. Please try again.'); return; }
  state.capturedUrl = original.toDataURL('image/png');
  $('capture-btn').textContent = 'CAPTURED';
  $('capture-btn').disabled = true;
  $('retake-btn').hidden = false;
  $('camera-status').textContent = '';
}

async function retakePhoto() {
  state.capturedBlob = null;
  state.capturedUrl = null;
  state.pendingProfileId = null;
  state.uploadedPhotoPath = null;
  $('capture-btn').disabled = false;
  $('capture-btn').textContent = 'CAPTURE';
  $('retake-btn').hidden = true;
  notice();
  await enableCamera();
}

async function finishSetup(event) {
  event.preventDefault();
  const name = $('name-input').value.trim();
  if (!name || state.creating) return;
  if (!supabaseClient) { notice('The connection could not load. Refresh the page to try again.'); return; }
  state.creating = true;
  $('create-profile-btn').disabled = true;
  $('capture-btn').disabled = true;
  $('retake-btn').disabled = true;
  notice();
  try {
    // Capture automatically if the user continues before pressing CAPTURE.
    if (!state.capturedBlob) await capturePhoto();
    if (!state.capturedBlob) throw new Error('Could not capture your photo.');
    const id = state.pendingProfileId ||= crypto.randomUUID();
    const photoPath = id + '.original.png';
    if (!state.uploadedPhotoPath) {
      const { error } = await supabaseClient.storage.from('conversation-photos').upload(photoPath, state.capturedBlob, { contentType: 'image/png', upsert: false });
      if (error) throw new Error('Could not upload your original photo. Please try again.');
      state.uploadedPhotoPath = photoPath;
    }
    const { error } = await supabaseClient.from('conversations').insert({ id, display_name: name, photo_path: photoPath });
    if (error) throw new Error('Could not create your profile. Please try again.');
    const owner = { key: id, id, name, photoPath, photoUrl: state.capturedUrl, mirror: true, startedAt: new Date().toISOString() };
    state.active = { owner, messages: [], selectedId: null, highlightId: null, loading: false };
    renderProfile($('created-card'), owner, true);
    showScreen('created-screen');
    $('continue-btn').focus();
  } catch (error) {
    notice(error.message || 'Could not create your profile. Please try again.');
  } finally {
    state.creating = false;
    $('create-profile-btn').disabled = false;
    $('capture-btn').disabled = !!state.capturedBlob;
    $('retake-btn').disabled = false;
  }
}

function contributor(row) {
  const name = row.source_display_name || (row.is_seed || row.source_is_seed ? 'SEED' : 'BOT');
  const id = row.source_conversation_id;
  const key = id || (name !== 'BOT' ? 'seed:' + (row.source_display_name || row.response_id || row.source_message_id || 'anonymous') : 'bot');
  return { key, id, name, photoPath: row.source_photo_path, startedAt: row.source_started_at, isSeed: !!(row.is_seed || row.source_is_seed) };
}

function currentView() { return state.archives.at(-1) || state.active; }
function isArchive() { return state.archives.length > 0; }
function isTransparent() { return isArchive() || state.transparent; }
function selectedMessage(view) { return view.messages.find(message => message.id === view.selectedId && message.sender === 'bot'); }

function selectMessage(id, scroll = false, toggleOpen = false) {
  settleViewModeTransition();
  const view = currentView();
  const message = view.messages.find(item => item.id === id && item.sender === 'bot');
  if (!message) return;
  const pendingCancelled = pendingBotSelection?.view === view;
  if (pendingCancelled) cancelPendingBotSelection();
  const collapse = toggleOpen && view.selectedId === id && view.collapsedSelectedId !== id;
  if (view.selectedId === id && !collapse && view.collapsedSelectedId !== id) {
    if (pendingCancelled) renderConversation({ preservePortraits: true });
    if (scroll) scrollToMessage(id);
    return;
  }
  const main = $('chat-screen').querySelector('.chat-main');
  if (isTransparent() && main.animate && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    animateMessageSelection(view, id, collapse ? false : scroll, collapse);
    return;
  }
  view.selectedId = id;
  view.collapsedSelectedId = collapse ? id : null;
  renderConversation();
  if (scroll && !collapse) scrollToMessage(id);
}

function selectContributor(key) {
  const view = currentView();
  const latest = view.messages.findLast(message => message.sender === 'bot' && message.source.key === key);
  if (latest) selectMessage(latest.id, true);
}

function scrollToMessage(id) {
  scheduleFeedFit({ messageId: id, align: true });
}

let feedFrame = 0;
let feedOptions = {};
let feedMaxHeight = 0;
let feedScrollTimer = 0;
let feedResizeTimer = 0;
let feedAnimationFrame = 0;
let feedAnimation = null;
let feedPointerDown = false;
let feedIgnoreScrollUntil = 0;
let feedRestOffset = 0;
let viewModeTransition = null;
let viewSwitching = false;
let viewSwitchNeedsFit = false;
let pendingBotSelection = null;
let botSpeakAnimation = null;
let userSpeakAnimation = null;
const FEED_SNAP_DELAY = 250;
const FEED_SNAP_DURATION = 1000;

function setFeedPosition(top) {
  messagesEl.scrollTop = top;
  // Native scrolling may round to physical pixels. Preserve the fractional
  // remainder visually so neither edge clips a supposedly complete message.
  feedRestOffset = messagesEl.scrollTop - top;
  if (Math.abs(feedRestOffset) > .001) {
    messageContent.style.transform = `translate3d(0, ${feedRestOffset}px, 0)`;
  } else {
    feedRestOffset = 0;
    messageContent.style.removeProperty('transform');
  }
}

function stopFeedAnimation() {
  cancelAnimationFrame(feedAnimationFrame);
  feedAnimationFrame = 0;
  if (feedAnimation) {
    // Commit the currently visible frame on interruption, or the final frame on
    // completion. Native scrolling then resumes from exactly that position.
    feedAnimation.main.style.setProperty('--feed-height', feedAnimation.height + 'px');
    setFeedPosition(feedAnimation.top);
    messagesEl.style.removeProperty('--feed-clip-offset');
    messagesEl.classList.remove('feed-animating');
  }
  feedAnimation = null;
}

function cancelFeedSnap() {
  clearTimeout(feedScrollTimer);
  stopFeedAnimation();
  feedIgnoreScrollUntil = 0;
  cancelAnimationFrame(feedFrame);
  feedFrame = 0;
  feedOptions = {};
}

function queueFeedSnap() {
  clearTimeout(feedScrollTimer);
  if (viewSwitching) { viewSwitchNeedsFit = true; return; }
  if (feedPointerDown || messagesEl.hidden) return;
  feedScrollTimer = setTimeout(() => scheduleFeedFit({ align: true }), FEED_SNAP_DELAY);
}

function animateFeedAdjustment(main, startHeight, endHeight, startTop, endTop) {
  stopFeedAnimation();
  clearTimeout(feedScrollTimer);
  const layoutHeight = Math.max(startHeight, endHeight);
  const animation = { main, height: startHeight, top: startTop, startedAt: 0 };
  feedAnimation = animation;
  // Lay out once. During easing, only the clipping edge and a single content
  // transform move; no per-frame height changes or native scroll corrections.
  main.style.setProperty('--feed-height', layoutHeight + 'px');
  messagesEl.scrollTop = endTop;
  const layoutTop = messagesEl.scrollTop;
  feedRestOffset = 0;
  messagesEl.classList.add('feed-animating');
  function paint() {
    const offset = layoutHeight - animation.height;
    messagesEl.style.setProperty('--feed-clip-offset', offset + 'px');
    messageContent.style.transform = `translate3d(0, ${offset + layoutTop - animation.top}px, 0)`;
  }
  paint();
  animation.startedAt = performance.now();
  function frame(time) {
    if (feedAnimation !== animation) return;
    const progress = Math.min(1, Math.max(0, (time - animation.startedAt) / FEED_SNAP_DURATION));
    const eased = (1 - Math.cos(Math.PI * progress)) / 2;
    animation.height = startHeight + (endHeight - startHeight) * eased;
    animation.top = startTop + (endTop - startTop) * eased;
    paint();
    if (progress < 1) {
      feedAnimationFrame = requestAnimationFrame(frame);
    } else {
      stopFeedAnimation();
      // Ignore the final scroll event produced by our own animation.
      feedIgnoreScrollUntil = performance.now() + 50;
    }
  }
  feedAnimationFrame = requestAnimationFrame(frame);
}

// Anchor the bottom message and add earlier complete blocks up to the fixed cap.
// The current viewport height never determines how many messages we attempt.
function fitMessageGroup(heights, anchor, maxHeight, gap, padding, bounds = null) {
  let height = padding;
  let start = anchor;
  let count = 0;
  for (let index = anchor; index >= 0; index--) {
    const nextHeight = bounds
      ? bounds[anchor].top + heights[anchor] - bounds[index].top + padding
      : height + heights[index] + (count ? gap : 0);
    if (nextHeight > maxHeight + .001) break;
    height = Math.min(nextHeight, maxHeight);
    start = index;
    count++;
  }
  // A block taller than the cap can still be read by ordinary scrolling.
  return { height: count ? height : maxHeight, start, end: anchor };
}

function scheduleFeedFit(options = {}) {
  feedOptions = { ...feedOptions, ...options };
  if (viewSwitching) { viewSwitchNeedsFit = true; return; }
  if (feedFrame) return;
  feedFrame = requestAnimationFrame(() => {
    feedFrame = 0;
    const options = feedOptions;
    feedOptions = {};
    fitMessageFeed(options);
  });
}

function measureFeedMaxHeight(main, composerHeight) {
  const mainStyle = getComputedStyle(main);
  const overview = main.querySelector('.chat-overview');
  const basis = getComputedStyle(overview).flexBasis;
  const contentHeight = main.getBoundingClientRect().height
    - (parseFloat(mainStyle.paddingTop) || 0) - (parseFloat(mainStyle.paddingBottom) || 0);
  const basisValue = parseFloat(basis);
  const overviewHeight = Number.isFinite(basisValue)
    ? basis.endsWith('%') ? contentHeight * basisValue / 100 : basisValue
    : overview.getBoundingClientRect().height;
  return Math.max(1, contentHeight - overviewHeight - composerHeight);
}

function fitMessageFeed({ recalculate = false, messageId = null, align = false, anchorId = null } = {}) {
  const main = $('chat-screen').querySelector('.chat-main');
  stopFeedAnimation();
  const rows = [...messageContent.children].filter(node => node.classList.contains('message'));
  if (messagesEl.hidden || !rows.length) {
    stopFeedAnimation();
    main.classList.remove('feed-fitted');
    return;
  }
  const feedBounds = messagesEl.getBoundingClientRect();
  const previousHeight = feedBounds.height;
  const previousTop = messagesEl.scrollTop - feedRestOffset;
  const atBottom = messagesEl.scrollHeight - messagesEl.clientHeight - previousTop <= 2;
  const containerTop = feedBounds.top;
  const style = getComputedStyle(messagesEl);
  const topPadding = parseFloat(style.paddingTop) || 12;
  const bottomPadding = parseFloat(style.paddingBottom) || 4;
  const gap = parseFloat(style.rowGap) || 0;
  const bounds = rows.map(row => row.getBoundingClientRect());
  const heights = bounds.map(rect => rect.height);
  if (heights.some(height => !(height > 0))) return;
  const targetId = anchorId ?? messageId;
  let anchor = targetId == null ? -1 : rows.findIndex(node => node.dataset.messageId === String(targetId));
  if (anchor < 0) {
    const viewportBottom = containerTop + previousHeight - bottomPadding;
    anchor = bounds.reduce((nearest, rect, index) => {
      const distance = Math.abs(rect.top + rect.height - viewportBottom);
      return distance < nearest.distance ? { index, distance } : nearest;
    }, { index: 0, distance: Infinity }).index;
  }
  const composer = main.querySelector('.composer');
  const composerHeight = isArchive() ? 0 : composer.getBoundingClientRect().height;
  if (recalculate || !feedMaxHeight) feedMaxHeight = measureFeedMaxHeight(main, composerHeight);
  if (!(feedMaxHeight > 0)) return;
  const followBottom = anchorId == null && messageId == null && atBottom;
  if (followBottom) anchor = rows.length - 1;
  let keepSelected = -1;
  if (isTransparent() && messageId == null && anchorId == null) {
    const selected = rows.findIndex(row => row.classList.contains('selected'));
    if (selected >= 0) {
      const rect = bounds[selected];
      const visibleHeight = Math.max(0, Math.min(rect.top + rect.height, containerTop + previousHeight - bottomPadding)
        - Math.max(rect.top, containerTop + topPadding));
      if (visibleHeight > rect.height / 2) keepSelected = selected;
    }
  }
  if (keepSelected >= 0) {
    // Keep the usual bottom anchor when it still fits the selected block. Move
    // it upward only as far as needed to include that block under the same cap.
    anchor = Math.max(anchor, keepSelected);
    while (anchor > keepSelected && bounds[anchor].top + heights[anchor] - bounds[keepSelected].top
      + topPadding + bottomPadding > feedMaxHeight + .001) anchor--;
  }
  let group = fitMessageGroup(heights, anchor, feedMaxHeight, gap, topPadding + bottomPadding, bounds);
  const includePrompt = anchorId == null && group.start > 0 && rows[group.start].classList.contains('selected');
  if (includePrompt) {
    const selected = group.start;
    const start = selected - 1;
    let end = group.end;
    const contextHeight = index => bounds[index].top + heights[index] - bounds[start].top + topPadding + bottomPadding;
    // Make room for the preceding prompt by dropping later messages first.
    // If the pair itself is oversized, keep the prompt at the top under the cap.
    while (end > selected && contextHeight(end) > feedMaxHeight + .001) end--;
    group = { start, end, height: Math.min(feedMaxHeight, contextHeight(end)) };
  }
  const bottom = bounds[group.end].top + bounds[group.end].height - containerTop + previousTop + bottomPadding;
  const lastRow = bounds.at(-1);
  const contentHeight = lastRow.top - containerTop + previousTop + lastRow.height + bottomPadding;
  const maximumTop = Math.max(0, contentHeight - group.height);
  const alignedTop = includePrompt
    ? bounds[group.start].top - containerTop + previousTop - topPadding
    : bottom - group.height;
  const desiredTop = Math.max(0, Math.min(maximumTop, alignedTop));
  // Do not pull the reader out of the middle of an oversized message.
  const insideTallMessage = anchorId == null && messageId == null && !includePrompt && keepSelected < 0 && !followBottom && bounds.some((rect, index) => {
    const rowTop = rect.top - containerTop;
    return heights[index] + topPadding + bottomPadding > group.height && rowTop <= topPadding && rowTop + heights[index] > topPadding;
  });
  const targetTop = insideTallMessage ? previousTop : desiredTop;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  // Apply the new height only once, after measurement. The previous implementation
  // changed the live viewport during measurement, clamping scrollTop before easing.
  main.style.setProperty('--feed-max-height', feedMaxHeight + 'px');
  main.style.setProperty('--feed-height', Math.min(previousHeight, feedMaxHeight) + 'px');
  main.classList.add('feed-fitted');
  if (align && !reducedMotion && (Math.abs(previousHeight - group.height) > .5 || Math.abs(previousTop - targetTop) > .5)) {
    animateFeedAdjustment(main, Math.min(previousHeight, feedMaxHeight), group.height, previousTop, targetTop);
  } else {
    feedIgnoreScrollUntil = performance.now() + 50;
    main.style.setProperty('--feed-height', group.height + 'px');
    setFeedPosition(targetTop);
  }
}

messagesEl.addEventListener('scroll', () => {
  if (!feedAnimation && performance.now() >= feedIgnoreScrollUntil) queueFeedSnap();
}, { passive: true });
for (const event of ['wheel', 'touchstart', 'touchmove']) {
  messagesEl.addEventListener(event, () => { cancelViewModeTransition(); cancelFeedSnap(); queueFeedSnap(); }, { passive: true });
}
messagesEl.addEventListener('pointerdown', event => {
  if (!event.target.closest('.bot-line')) cancelViewModeTransition();
  feedPointerDown = true;
  cancelFeedSnap();
});
function releaseFeedPointer() {
  if (!feedPointerDown) return;
  feedPointerDown = false;
  queueFeedSnap();
}
document.addEventListener('pointerup', releaseFeedPointer);
document.addEventListener('pointercancel', releaseFeedPointer);
messagesEl.addEventListener('keydown', event => {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
    cancelViewModeTransition();
    cancelFeedSnap();
    queueFeedSnap();
  }
});
function queueFeedResize() {
  if (viewSwitching) { viewSwitchNeedsFit = true; return; }
  clearTimeout(feedResizeTimer);
  cancelFeedSnap();
  feedResizeTimer = setTimeout(() => scheduleFeedFit({ recalculate: true, align: true }), 150);
}
const feedResizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(queueFeedResize) : null;
feedResizeObserver?.observe($('chat-screen').querySelector('.chat-main'));
window.addEventListener('resize', queueFeedResize);
document.fonts?.ready.then(() => scheduleFeedFit({ recalculate: true }));

const PROFILE_CARD_FADE = 420;
const PROFILE_THUMB_FADE = 320;
const PROFILE_THUMB_STAGGER = 90;

function startParticipantReveal(view, delay = 0) {
  if (view) view.participantReveal = { startedAt: null, delay };
}

function applyParticipantReveal(node, view, delay, duration) {
  const reveal = view.participantReveal;
  const elapsed = reveal ? performance.now() - reveal.startedAt : 0;
  const start = (reveal?.delay || 0) + delay;
  const active = reveal && elapsed < start + duration && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const key = reveal ? `${reveal.startedAt}:${start}:${duration}` : '';
  if (active && node.dataset.participantReveal === key) return;
  node.classList.remove('participant-reveal');
  node.style.removeProperty('animation-delay');
  node.style.removeProperty('animation-duration');
  delete node.dataset.participantReveal;
  if (!active) return;
  // A reused card needs a fresh CSS animation on conversation changes. Keep
  // its existing animation during ordinary rerenders of the same conversation.
  if (node.isConnected) void node.offsetWidth;
  node.classList.add('participant-reveal');
  node.dataset.participantReveal = key;
  node.style.animationDelay = start - elapsed + 'ms';
  node.style.animationDuration = duration + 'ms';
}

function renderParticipants(view) {
  $('participant-sidebar').classList.toggle('is-loading', !!view.loading);
  const selected = selectedMessage(view);
  renderProfile($('selected-profile'), selected?.source);
  const participants = new Map();
  view.messages.forEach(message => {
    if (message.sender === 'bot') participants.set(message.source.key, message.source);
  });
  const buttons = [...participants.values()].map((profile, index) => {
    const button = el('button', 'participant-thumb');
    button.type = 'button';
    button.dataset.contributor = profile.key;
    button.setAttribute('aria-label', 'Select ' + profile.name + '’s latest contribution');
    button.setAttribute('aria-pressed', String(selected?.source.key === profile.key));
    button.append(makePortrait(profile));
    const previewProfile = () => renderProfile($('selected-profile'), profile);
    const restoreProfile = () => renderProfile($('selected-profile'), selectedMessage(currentView())?.source);
    button.addEventListener('mouseenter', previewProfile);
    button.addEventListener('mouseleave', restoreProfile);
    button.addEventListener('focus', previewProfile);
    button.addEventListener('blur', restoreProfile);
    button.addEventListener('click', () => selectContributor(profile.key));
    return button;
  });
  $('participant-grid').replaceChildren(...buttons);
  if (view.participantReveal?.startedAt === null) view.participantReveal.startedAt = performance.now();
  applyParticipantReveal($('selected-profile'), view, 0, PROFILE_CARD_FADE);
  buttons.forEach((button, index) => {
    applyParticipantReveal(button, view, PROFILE_CARD_FADE + index * PROFILE_THUMB_STAGGER, PROFILE_THUMB_FADE);
  });
}

function eyeIcon(open) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 16');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', open
    ? 'M8 2h8v2h4v2h2v2h2v2h-2v2h-2v2h-4v2H8v-2H4v-2H2v-2H0V8h2V6h2V4h4V2zm0 2v2H4v2H2v2h2v2h4v2h8v-2h4v-2h2V8h-2V6h-4V4H8zm2 2h4v6h-4V6z'
    : 'M0 4h2v2h2v2h4v2h8V8h4V6h2V4h2v2h-2v2h-2v2h-4v2h2v2h-2v-2H8v2H6v-2h2v-2H4V8H2V6H0V4z');
  svg.append(path);
  return svg;
}

function renderTrail() {
  const trail = $('archive-trail');
  const home = el('button', '', 'YOU');
  home.type = 'button';
  home.addEventListener('click', exitArchive);
  const children = [home];
  state.archives.forEach((view, index) => {
    const button = el('button', '', view.owner.name.toUpperCase());
    button.type = 'button';
    if (index === state.archives.length - 1) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => {
      if (index === state.archives.length - 1) return;
      cancelViewModeTransition();
      ++state.archiveRequest;
      state.archives = state.archives.slice(0, index + 1);
      notice();
      startParticipantReveal(currentView());
      renderConversation();
      messagesEl.scrollTop = currentView().scrollTop || 0;
    });
    children.push(el('span', '', '>>>'), button);
  });
  trail.replaceChildren(...children);
  trail.scrollLeft = trail.scrollWidth;
}

function renderStats(view) {
  const times = view.messages.map(message => new Date(message.createdAt).getTime()).filter(Number.isFinite);
  const start = new Date(view.owner.startedAt).getTime();
  const first = Number.isFinite(start) ? start : Math.min(...times);
  const last = isArchive() ? Math.max(...times) : Date.now();
  const duration = Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, Math.floor((last - first) / 60000)) : 0;
  $('conversation-stats').replaceChildren(
    el('p', '', isArchive() ? view.owner.name.toUpperCase() + '’S CONVERSATION' : 'YOUR CONVERSATION'),
    el('p', '', 'DURATION: ' + duration + 'min'),
    el('p', '', 'MESSAGES: ' + view.messages.length),
  );
}

const MESSAGE_SLIDE_DURATION = 420;
const ARCHIVE_REVEAL_DELAY = 330;
const ARCHIVE_REVEAL_DURATION = 420;
const LETTER_FADE_DURATION = 180;
const LETTER_START_DELAY = 100;
const messageSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

function botTypingTiming(message) {
  const letters = messageSegmenter
    ? [...messageSegmenter.segment(message.content)].map(part => part.segment)
    : Array.from(message.content);
  const interval = Math.min(26, 4000 / Math.max(1, letters.length - 1));
  return { letters, interval, duration: LETTER_START_DELAY + Math.max(0, letters.length - 1) * interval + LETTER_FADE_DURATION };
}

function renderMessageText(message, elapsed) {
  const text = el('span', 'message-text');
  if (message.sender !== 'bot' || elapsed == null) {
    text.textContent = message.content;
    return text;
  }
  const { letters, interval, duration } = botTypingTiming(message);
  if (elapsed >= duration) {
    text.textContent = message.content;
    return text;
  }
  // Reserve the complete text's layout from the start, so typing never changes
  // wrapping or feed height. Assistive technology receives the full reply once.
  text.append(el('span', 'sr-only', message.content));
  const visual = el('span', 'typed-text');
  visual.setAttribute('aria-hidden', 'true');
  letters.forEach((letter, index) => {
    const glyph = el('span', 'message-letter', letter);
    glyph.style.animationDelay = (LETTER_START_DELAY + index * interval - elapsed) + 'ms';
    visual.append(glyph);
  });
  text.append(visual);
  return text;
}

function renderMessage(message, view) {
  const wrap = el('div', 'message');
  wrap.dataset.messageId = message.id;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const elapsed = !isArchive() && message.arrivedAt != null && !reducedMotion
    ? Math.max(0, performance.now() - message.arrivedAt) : null;
  const visual = el('div', 'message-visual');
  if (elapsed != null && elapsed < MESSAGE_SLIDE_DURATION) {
    visual.classList.add('message-arrival');
    visual.style.animationDelay = -elapsed + 'ms';
  }
  const selected = message.sender === 'bot' && message.id === view.selectedId;
  const pending = message.id === view.pendingBotId;
  if (pending) wrap.classList.add('pending-response');
  const collapsing = message.id === viewModeTransition?.collapsingMessageId;
  const transparent = isTransparent();
  if (message.id === view.highlightId) wrap.classList.add('highlighted');
  const open = selected && view.collapsedSelectedId !== message.id;
  if (collapsing || (open && !pending && ((transparent && !viewModeTransition?.suppressSelection) || viewModeTransition?.collapseSelection))) {
    wrap.classList.add(open ? 'selected' : 'selection-collapsing');
    const expansion = el('div', 'message-expansion');
    const portrait = makePortrait(message.source, 'source-portrait');
    if ((collapsing || viewModeTransition?.collapseSelection) && viewModeTransition.sourceUrl) portrait.src = viewModeTransition.sourceUrl;
    expansion.append(portrait);
    if (message.source.id) {
      const link = el('button', 'archive-link', 'archived conversation ↗');
      link.type = 'button';
      link.addEventListener('click', () => openArchive(message));
      const action = el('div', 'archive-action');
      const reveal = view.selectionReveal;
      if (selected && reveal?.id === message.id && !reducedMotion) {
        const revealElapsed = Math.max(0, performance.now() - reveal.startedAt);
        if (revealElapsed < ARCHIVE_REVEAL_DELAY + ARCHIVE_REVEAL_DURATION) {
          action.classList.add('archive-action-reveal');
          action.style.animationDelay = ARCHIVE_REVEAL_DELAY - revealElapsed + 'ms';
          action.style.animationDuration = ARCHIVE_REVEAL_DURATION + 'ms';
        }
      }
      action.append(link);
      expansion.append(action);
    }
    visual.append(expansion);
  }
  const isBot = message.sender === 'bot';
  const line = el(isBot && transparent ? 'button' : 'div', 'message-line ' + (isBot ? 'bot-line' : 'user-line'));
  const label = isBot ? transparent && !pending ? message.source.name.toUpperCase() : 'BOT' : isArchive() ? view.owner.name.toUpperCase() : 'YOU';
  line.append(el('span', 'who', label), renderMessageText(message, elapsed));
  if (isBot && transparent) {
    line.type = 'button';
    line.setAttribute('aria-pressed', String(open && !viewModeTransition?.suppressSelection));
    line.setAttribute('aria-label', label + ': ' + message.content + '. Select contributor.');
    line.addEventListener('click', () => selectMessage(message.id, true, true));
  }
  visual.append(line);
  wrap.append(visual);
  return wrap;
}

function renderConversation({ preservePortraits = false } = {}) {
  cancelFeedSnap();
  const view = currentView();
  if (!view) return;
  const archive = isArchive();
  const transparent = isTransparent();
  const hasMessages = view.messages.length > 0 || view.loading || archive;
  const previousScroll = messagesEl.scrollTop;
  const focused = document.activeElement;
  const focusMessage = focused?.closest('.message')?.dataset.messageId;
  const focusContributor = focused?.dataset.contributor;
  appWindow.classList.toggle('transparent', transparent);
  appWindow.classList.toggle('archive', archive);
  $('window-title').textContent = archive ? 'DATA_ARCHIVE.VISIBLE' : transparent ? 'BOT-FRIEND.VISIBLE' : 'BOT-FRIEND.START';
  $('archive-trail').hidden = !archive;
  $('exit-archive').hidden = !archive;
  $('participant-sidebar').hidden = !transparent || !hasMessages;
  $('conversation-intro').hidden = hasMessages;
  $('chat-overview').hidden = !hasMessages;
  $('messages').hidden = !hasMessages;
  $('conversation-stats').hidden = !transparent;
  $('chat-screen').classList.toggle('has-messages', hasMessages);
  $('mode-toggle').hidden = !hasMessages || archive;
  $('mode-toggle').setAttribute('aria-pressed', String(state.transparent));
  $('mode-toggle').setAttribute('aria-label', state.transparent ? 'Hide contributors' : 'Show contributors');
  $('mode-toggle').replaceChildren(eyeIcon(state.transparent));
  if (!preservePortraits) {
    $('owner-photo').replaceChildren(makePortrait(view.owner));
    $('bot-placeholder').replaceChildren(makePortrait({ key: 'bot', name: 'Bot' }));
  }
  if (transparent) { renderParticipants(view); renderStats(view); }
  if (archive) renderTrail();
  if (view.loading) {
    messageContent.replaceChildren(el('p', 'archive-loading', 'LOADING CONVERSATION…'));
  } else if (view.error) {
    const retry = el('button', 'archive-link', 'RETRY ↗');
    retry.type = 'button';
    retry.addEventListener('click', () => loadArchive(view));
    messageContent.replaceChildren(el('p', '', view.error), retry);
  } else {
    messageContent.replaceChildren(...view.messages.map(message => renderMessage(message, view)));
    if (archive && !view.messages.length) messageContent.append(el('p', '', 'NO MESSAGES IN THIS ARCHIVE'));
  }
  messagesEl.scrollTop = previousScroll;
  if (focusMessage) {
    [...messageContent.children].find(node => node.dataset.messageId === focusMessage)?.querySelector('.bot-line')?.focus({ preventScroll: true });
  } else if (focusContributor) {
    [...$('participant-grid').children].find(node => node.dataset.contributor === focusContributor)?.focus({ preventScroll: true });
  }
  scheduleFeedFit({ recalculate: true });
}

function animatePortraitHop(portrait, iterations = 1) {
  if (!portrait.animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return null;
  return portrait.animate([
    { transform: 'translateY(0)', offset: 0, easing: 'cubic-bezier(.2, .8, .35, 1)' },
    { transform: 'translateY(-4px)', offset: .4, easing: 'cubic-bezier(.55, 0, .8, .45)' },
    { transform: 'translateY(0)', offset: 1 },
  ], { duration: 240, iterations, composite: 'add' });
}

function animateBotSpeaking(message = state.active?.messages.findLast(message => message.sender === 'bot')) {
  botSpeakAnimation?.cancel();
  botSpeakAnimation = null;
  if (isTransparent() || !message) return;
  const hops = Math.max(1, Math.ceil(botTypingTiming(message).letters.length / 12));
  const animation = animatePortraitHop($('bot-placeholder'), hops);
  if (!animation) return;
  botSpeakAnimation = animation;
  animation.finished.catch(() => {}).finally(() => {
    if (botSpeakAnimation === animation) botSpeakAnimation = null;
  });
}

function animateUserSpeaking() {
  userSpeakAnimation?.cancel();
  const animation = animatePortraitHop($('owner-photo'));
  userSpeakAnimation = animation;
  animation?.finished.catch(() => {}).finally(() => {
    if (userSpeakAnimation === animation) userSpeakAnimation = null;
  });
}

async function sendMessage(event) {
  event.preventDefault();
  const text = $('message-input').value.trim();
  if (!text || !state.active || state.sending || isArchive()) return;
  settleViewModeTransition();
  state.sending = true;
  $('message-input').value = '';
  $('message-input').disabled = true;
  const view = state.active;
  const userMessage = { id: crypto.randomUUID(), sender: 'user', content: text, createdAt: new Date().toISOString(), arrivedAt: performance.now() };
  view.messages.push(userMessage);
  notice();
  renderConversation();
  messagesEl.scrollTop = messagesEl.scrollHeight;
  animateUserSpeaking();
  let userSaved = false;
  try {
    const { error: insertError } = await supabaseClient.from('messages').insert({ conversation_id: view.owner.id, sender: 'user', content: text });
    if (insertError) throw new Error('Your message could not be saved. Please send it again.');
    userSaved = true;
    const { data, error } = await supabaseClient.rpc('find_best_response', { input_text: text, current_conversation_id: view.owner.id });
    if (error) throw new Error('Your message was saved, but the bot could not respond. Please try another message.');
    const reply = data?.[0];
    const botMessage = {
      id: crypto.randomUUID(),
      sender: 'bot',
      content: reply?.response_text || 'Hm, I don’t know what to say to that.',
      source: contributor(reply || {}),
      sourceMessageId: reply?.response_id,
      createdAt: new Date().toISOString(),
      arrivedAt: performance.now(),
    };
    if (!isArchive()) settleViewModeTransition();
    cancelPendingBotSelection();
    view.messages.push(botMessage);
    if (!isArchive() && state.transparent && $('chat-screen').querySelector('.chat-main').animate
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      queueBotSelection(view, botMessage);
    } else {
      view.selectedId = botMessage.id;
    }
    if (!isArchive()) {
      renderConversation();
      messagesEl.scrollTop = messagesEl.scrollHeight;
      animateBotSpeaking(botMessage);
    }
    const { error: botError } = await supabaseClient.from('messages').insert({ conversation_id: view.owner.id, sender: 'bot', content: botMessage.content, source_message_id: botMessage.sourceMessageId || null });
    if (botError) notice('The bot replied, but its response could not be saved.');
  } catch (error) {
    if (!userSaved) {
      view.messages = view.messages.filter(message => message.id !== userMessage.id);
      $('message-input').value = text;
    }
    notice(error.message || 'The connection was interrupted. Please try again.');
    if (!isArchive()) renderConversation();
  } finally {
    state.sending = false;
    $('message-input').disabled = false;
    if (!isArchive()) $('message-input').focus();
  }
}

async function openArchive(message) {
  if (!message.source.id || !supabaseClient) return;
  botSpeakAnimation?.cancel();
  userSpeakAnimation?.cancel();
  cancelViewModeTransition();
  currentView().scrollTop = messagesEl.scrollTop;
  const view = { owner: message.source, messages: [], selectedId: null, highlightId: message.sourceMessageId, loading: true };
  state.archives.push(view);
  notice();
  renderConversation();
  $('exit-archive').focus();
  await loadArchive(view);
}

async function loadArchive(view) {
  const request = ++state.archiveRequest;
  view.loading = true;
  view.error = null;
  if (view === currentView()) renderConversation();
  try {
    const { data, error } = await supabaseClient.rpc('get_conversation_transcript', { target_conversation_id: view.owner.id });
    if (request !== state.archiveRequest) return;
    if (error || !data) throw new Error('Could not load this conversation.');
    view.messages = data.map((row, index) => ({
      id: row.id || 'archive-' + index,
      sender: row.sender,
      content: row.content,
      source: row.sender === 'bot' ? contributor(row) : null,
      sourceMessageId: row.source_message_id,
      createdAt: row.created_at,
    }));
    const highlighted = view.messages.findIndex(message => message.id === view.highlightId);
    // Show the contributor associated with the reused line's exchange.
    const related = highlighted >= 0 ? view.messages.slice(highlighted).find(message => message.sender === 'bot') : null;
    view.selectedId = (related || view.messages.findLast(message => message.sender === 'bot'))?.id || null;
    view.loading = false;
    if (view === currentView()) {
      startParticipantReveal(view);
      renderConversation();
      scrollToMessage(view.highlightId || view.selectedId);
    }
  } catch (error) {
    if (request !== state.archiveRequest) return;
    view.loading = false;
    view.error = error.message || 'Could not load this conversation.';
    if (view === currentView()) renderConversation();
  }
}

function exitArchive() {
  cancelViewModeTransition();
  ++state.archiveRequest;
  state.archives = [];
  notice();
  if (state.transparent) startParticipantReveal(state.active);
  renderConversation();
  messagesEl.scrollTop = state.active?.scrollTop || 0;
  $('mode-toggle').focus();
}

// Keep the visible bottom row, rather than jumping to the selected contributor.
function captureViewAnchor() {
  const rect = messagesEl.getBoundingClientRect();
  const style = getComputedStyle(messagesEl);
  const bottom = rect.bottom - (parseFloat(style.paddingBottom) || 4);
  const top = rect.top + (parseFloat(style.paddingTop) || 12);
  const rows = [...messageContent.children].filter(row => row.classList.contains('message'));
  const row = rows.findLast(row => {
    const bounds = row.getBoundingClientRect();
    return bounds.top < bottom - .5 && bounds.bottom > top;
  });
  return row ? { id: row.dataset.messageId, offset: row.getBoundingClientRect().bottom - bottom } : null;
}

function pinViewAnchor(anchor) {
  if (!anchor) return;
  const row = [...messageContent.children].find(row => row.dataset.messageId === anchor.id);
  if (!row) return;
  const bottom = messagesEl.getBoundingClientRect().bottom
    - (parseFloat(getComputedStyle(messagesEl).paddingBottom) || 4) + anchor.offset;
  const difference = row.getBoundingClientRect().bottom - bottom;
  setFeedPosition(messagesEl.scrollTop - feedRestOffset + difference);
}

function clearViewGeometry(transition) {
  for (const property of ['position', 'left', 'top', 'width', 'height', 'flex']) {
    transition.main.style.removeProperty(property);
  }
  transition.main.classList.remove('view-column-moving');
  $('message-form').style.removeProperty('flex-basis');
  transition.expansions?.forEach(expansion => expansion.removeAttribute('style'));
  transition.sidebar?.removeAttribute('style');
  transition.ownerPhoto?.removeAttribute('style');
  transition.botPhoto?.removeAttribute('style');
  transition.stats?.removeAttribute('style');
}

function finishViewModeTransition(transition) {
  if (viewModeTransition !== transition) return;
  cancelAnimationFrame(transition.frame);
  transition.animations.forEach(animation => animation.cancel());
  clearViewGeometry(transition);
  transition.suppressSelection = false;
  transition.collapseSelection = false;
  transition.collapsingMessageId = null;
  state.transparent = transition.transparent;
  // Settle once without the usual selected-message scroll or a competing snap.
  renderConversation({ preservePortraits: true });
  fitMessageFeed({ recalculate: true, anchorId: transition.anchor?.id });
  pinViewAnchor(transition.anchor);
  viewModeTransition = null;
  viewSwitching = false;
  viewSwitchNeedsFit = false;
  feedOptions = {};
  appWindow.classList.remove('view-switching', 'selection-switching');
  feedIgnoreScrollUntil = performance.now() + 100;
  for (const render of portraitRenderers.values()) render();
}

function cancelViewModeTransition() {
  if (viewModeTransition) finishViewModeTransition(viewModeTransition);
}

function settleViewModeTransition() { cancelViewModeTransition(); }

function animateViewElements(transition, selectors, incoming, duration, delay = 0) {
  for (const node of $('chat-screen').querySelectorAll(selectors)) {
    if (node.closest('[hidden]') || !node.animate) continue;
    const opacity = Number(getComputedStyle(node).opacity);
    const animation = node.animate(incoming ? [{ opacity: 0 }, { opacity }] : [{ opacity }, { opacity: 0 }],
      { duration, delay, easing: 'cubic-bezier(.65, 0, .25, 1)', fill: 'both' });
    transition.animations.push(animation);
    animation.finished.catch(() => {});
  }
}

function animateViewFrames(transition, duration, paint, done) {
  const startedAt = performance.now();
  function frame(now) {
    if (viewModeTransition !== transition) return;
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    paint(eased);
    if (progress < 1) transition.frame = requestAnimationFrame(frame);
    else done();
  }
  paint(0);
  transition.frame = requestAnimationFrame(frame);
}

function prepareViewExpansion(transition, expansion = messageContent.querySelector('.message.selected .message-expansion')) {
  if (!expansion) return null;
  (transition.expansions ||= []).push(expansion);
  const style = getComputedStyle(expansion);
  const dimensions = { node: expansion, height: expansion.getBoundingClientRect().height,
    top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 };
  expansion.style.overflow = 'hidden';
  return dimensions;
}

function sizeViewExpansion(transition, dimensions, amount) {
  if (!dimensions) return;
  dimensions.node.style.height = dimensions.height * amount + 'px';
  dimensions.node.style.paddingTop = dimensions.top * amount + 'px';
  dimensions.node.style.paddingBottom = dimensions.bottom * amount + 'px';
}

function cancelPendingBotSelection() {
  if (!pendingBotSelection) return;
  clearTimeout(pendingBotSelection.timer);
  delete pendingBotSelection.view.pendingBotId;
  pendingBotSelection = null;
}

function queueBotSelection(view, message) {
  view.pendingBotId = message.id;
  const request = { view, id: message.id, timer: 0 };
  pendingBotSelection = request;
  // Use the same timing as the actual glyphs, including the final letter fade.
  const duration = Math.max(MESSAGE_SLIDE_DURATION, botTypingTiming(message).duration);
  request.timer = setTimeout(() => {
    if (pendingBotSelection !== request) return;
    cancelPendingBotSelection();
    if (currentView() !== view) {
      view.selectedId = message.id;
      return;
    }
    settleViewModeTransition();
    if (isTransparent() && $('chat-screen').querySelector('.chat-main').animate
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      animateMessageSelection(view, message.id, true);
    } else {
      view.selectedId = message.id;
      renderConversation({ preservePortraits: true });
    }
  }, Math.max(0, duration - (performance.now() - message.arrivedAt)) + 32);
}

function animateMessageSelection(view, id, scroll, collapse = false) {
  clearTimeout(feedResizeTimer);
  cancelFeedSnap();
  const main = $('chat-screen').querySelector('.chat-main');
  const startHeight = messagesEl.getBoundingClientRect().height;
  const row = [...messageContent.children].find(row => row.dataset.messageId === String(id));
  const bottom = messagesEl.getBoundingClientRect().bottom
    - (parseFloat(getComputedStyle(messagesEl).paddingBottom) || 4);
  const anchor = scroll && row
    ? { id: String(id), offset: row.getBoundingClientRect().bottom - bottom }
    : captureViewAnchor();
  const startOffset = anchor?.offset || 0;
  const transition = { main, anchor, transparent: state.transparent, animations: [], frame: 0,
    collapsingMessageId: messageContent.querySelector('.message.selected .message-expansion') ? view.selectedId : null,
    sourceUrl: messageContent.querySelector('.message.selected .source-portrait')?.src };
  viewModeTransition = transition;
  viewSwitching = true;
  appWindow.classList.add('view-switching', 'selection-switching');
  view.selectedId = id;
  view.collapsedSelectedId = collapse ? id : null;
  if (!collapse) view.selectionReveal = { id, startedAt: performance.now() };
  renderConversation({ preservePortraits: true });
  const opening = prepareViewExpansion(transition);
  const closing = prepareViewExpansion(transition, messageContent.querySelector('.selection-collapsing .message-expansion'));
  sizeViewExpansion(transition, closing, 0);
  fitMessageFeed({ recalculate: true, messageId: scroll ? id : null, anchorId: scroll ? null : anchor?.id });
  const endHeight = messagesEl.getBoundingClientRect().height;
  main.style.setProperty('--feed-max-height', Math.max(feedMaxHeight, startHeight, endHeight) + 'px');
  main.classList.add('view-column-moving');
  animateViewFrames(transition, 420, amount => {
    sizeViewExpansion(transition, closing, 1 - amount);
    sizeViewExpansion(transition, opening, amount);
    main.style.setProperty('--feed-height', startHeight + (endHeight - startHeight) * amount + 'px');
    if (scroll && anchor) anchor.offset = startOffset * (1 - amount);
    pinViewAnchor(anchor);
  }, () => finishViewModeTransition(transition));
}

function expandViewSelection(transition) {
  // The column has arrived. Only now mark the message selected and open its photo.
  transition.suppressSelection = false;
  const startHeight = messagesEl.getBoundingClientRect().height;
  const view = currentView();
  view.collapsedSelectedId = null;
  view.selectionReveal = { id: view.selectedId, startedAt: performance.now() };
  renderConversation({ preservePortraits: true });
  fitMessageFeed({ recalculate: true, anchorId: transition.anchor?.id });
  const endHeight = messagesEl.getBoundingClientRect().height;
  const dimensions = prepareViewExpansion(transition);
  if (!dimensions) { finishViewModeTransition(transition); return; }
  animateViewFrames(transition, 420, amount => {
    sizeViewExpansion(transition, dimensions, amount);
    transition.main.style.setProperty('--feed-height', startHeight + (endHeight - startHeight) * amount + 'px');
    pinViewAnchor(transition.anchor);
  }, () => finishViewModeTransition(transition));
}

function toggleViewMode() {
  if (isArchive() || !state.active) return;
  botSpeakAnimation?.cancel();
  userSpeakAnimation?.cancel();
  const transparent = !(viewModeTransition?.transparent ?? state.transparent);
  cancelViewModeTransition();
  clearTimeout(feedResizeTimer);
  cancelFeedSnap();
  const main = $('chat-screen').querySelector('.chat-main');
  const anchor = captureViewAnchor();
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion || !main.animate) {
    state.transparent = transparent;
    renderConversation({ preservePortraits: true });
    cancelFeedSnap();
    fitMessageFeed({ recalculate: true, anchorId: anchor?.id });
    pinViewAnchor(anchor);
    return;
  }
  const screenRect = $('chat-screen').getBoundingClientRect();
  const ownerPhoto = $('owner-photo');
  const ownerBefore = ownerPhoto.getBoundingClientRect();
  const botPhoto = $('bot-placeholder');
  const botBefore = botPhoto.getBoundingClientRect();
  const stats = $('conversation-stats');
  const statsBefore = stats.getBoundingClientRect();
  const before = main.getBoundingClientRect();
  const sidebar = $('participant-sidebar');
  const sidebarBefore = sidebar.getBoundingClientRect();
  const sidebarDirection = getComputedStyle(sidebar).flexDirection;
  const composer = $('message-form');
  const startComposerHeight = composer.getBoundingClientRect().height;
  const startFeedHeight = messagesEl.getBoundingClientRect().height;
  const oldExpansionHeight = messageContent.querySelector('.message-expansion')?.getBoundingClientRect().height;
  const sourceUrl = messageContent.querySelector('.message-expansion .portrait')?.src;
  const transition = { transparent, main, anchor, sourceUrl, ownerPhoto, botPhoto, animations: [], frame: 0,
    suppressSelection: transparent, collapseSelection: !transparent && !!oldExpansionHeight };
  viewModeTransition = transition;
  viewSwitching = true;
  appWindow.classList.add('view-switching');
  state.transparent = transparent;
  if (transparent) startParticipantReveal(currentView(), 430);
  renderConversation({ preservePortraits: true });
  const dimensions = transition.collapseSelection ? prepareViewExpansion(transition) : null;
  if (dimensions) sizeViewExpansion(transition, dimensions, 0);
  fitMessageFeed({ recalculate: true, anchorId: anchor?.id });
  const endFeedHeight = messagesEl.getBoundingClientRect().height;
  const after = main.getBoundingClientRect();
  const endComposerHeight = composer.getBoundingClientRect().height;
  const ownerAfter = ownerPhoto.getBoundingClientRect();
  Object.assign(ownerPhoto.style, { position: 'absolute', transform: 'none' });
  main.classList.add('view-column-moving');
  main.style.setProperty('--feed-max-height', Math.max(feedMaxHeight, startFeedHeight, endFeedHeight) + 'px');
  // Animate the live column, not two cross-fading snapshots. Each frame anchors
  // the same bottom row after text rewraps, while the input stays in this column.
  main.style.position = 'absolute';
  main.style.flex = 'none';
  if (transparent) {
    Object.assign(botPhoto.style, { display: 'block', position: 'absolute',
      left: botBefore.left - before.left + 'px', top: botBefore.top - before.top + 'px',
      width: botBefore.width + 'px', height: botBefore.height + 'px' });
    animateViewElements(transition, '#bot-placeholder', false, 260);
    animateViewElements(transition, '#conversation-stats', true, 420, 430);
  } else {
    // Keep the departing sidebar in its original slot while it fades away.
    transition.sidebar = sidebar;
    transition.stats = stats;
    stats.hidden = false;
    Object.assign(stats.style, { position: 'absolute', left: statsBefore.left - before.left + 'px',
      top: statsBefore.top - before.top + 'px', width: statsBefore.width + 'px' });
    sidebar.hidden = false;
    Object.assign(sidebar.style, { position: 'absolute', left: sidebarBefore.left - screenRect.left + 'px',
      top: sidebarBefore.top - screenRect.top + 'px', width: sidebarBefore.width + 'px',
      height: sidebarBefore.height + 'px', flexDirection: sidebarDirection });
    animateViewElements(transition, '#selected-profile, #participant-grid, #conversation-stats', false, 260);
    animateViewElements(transition, '#bot-placeholder', true, 420, 260);
  }
  const interpolate = (from, to, amount) => from + (to - from) * amount;
  animateViewFrames(transition, 700, amount => {
    main.style.left = interpolate(before.left, after.left, amount) - screenRect.left + 'px';
    main.style.top = interpolate(before.top, after.top, amount) - screenRect.top + 'px';
    main.style.width = interpolate(before.width, after.width, amount) + 'px';
    main.style.height = interpolate(before.height, after.height, amount) + 'px';
    composer.style.flexBasis = interpolate(startComposerHeight, endComposerHeight, amount) + 'px';
    ownerPhoto.style.left = interpolate(ownerBefore.left, ownerAfter.left, amount) - interpolate(before.left, after.left, amount) + 'px';
    ownerPhoto.style.top = interpolate(ownerBefore.top, ownerAfter.top, amount) - interpolate(before.top, after.top, amount) + 'px';
    ownerPhoto.style.width = interpolate(ownerBefore.width, ownerAfter.width, amount) + 'px';
    ownerPhoto.style.height = interpolate(ownerBefore.height, ownerAfter.height, amount) + 'px';
    main.style.setProperty('--feed-height', interpolate(startFeedHeight, endFeedHeight, amount) + 'px');
    if (dimensions) sizeViewExpansion(transition, dimensions, 1 - amount);
    pinViewAnchor(anchor);
  }, () => {
    if (transparent) {
      clearViewGeometry(transition);
      // Let the card and every staggered thumbnail arrive before opening the photo.
      const view = currentView();
      const reveal = view.participantReveal;
      const count = $('participant-grid').children.length;
      const end = reveal.delay + PROFILE_CARD_FADE + (count ? (count - 1) * PROFILE_THUMB_STAGGER + PROFILE_THUMB_FADE : 0);
      const remaining = Math.max(0, end - (performance.now() - reveal.startedAt));
      if (remaining) animateViewFrames(transition, remaining, () => {}, () => expandViewSelection(transition));
      else expandViewSelection(transition);
    } else finishViewModeTransition(transition);
  });
}

$('begin-btn').addEventListener('click', beginProfile);
$('capture-btn').addEventListener('click', capturePhoto);
$('retake-btn').addEventListener('click', retakePhoto);
$('profile-form').addEventListener('submit', finishSetup);
$('continue-btn').addEventListener('click', () => {
  showScreen('chat-screen');
  renderConversation();
  $('message-input').focus();
});
$('message-form').addEventListener('submit', sendMessage);
$('mode-toggle').addEventListener('click', toggleViewMode);
window.addEventListener('resize', settleViewModeTransition);
$('exit-archive').addEventListener('click', exitArchive);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && isArchive()) exitArchive(); });
window.addEventListener('pagehide', stopCamera);
setInterval(() => { if (state.screen === 'chat-screen' && isTransparent() && currentView()) renderStats(currentView()); }, 30000);
