// Content Script for Online Meet Copilot Helper
console.log("[Online Meet Copilot Helper] Extension Content Script Injected.");

let socket = null;
let roomId = "";
let serverUrl = "http://localhost:5000";
let syncInterval = null;
let lastCaptions = {}; // speaker -> last text sent
let processedSpeechHashes = new Set();
let captionsCheckInterval = null;
let allSeenParticipants = new Set();

// Helper to extract Room ID from URL
function getRoomIdFromUrl() {
  const url = window.location.href;
  if (url.includes('meet.google.com')) {
    // google meet format: meet.google.com/abc-defg-hij
    const path = window.location.pathname.replace(/^\//, '');
    const code = path.split('?')[0].split('/')[0];
    if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code) || /^[a-z]{10}$/.test(code)) {
      return code;
    }
  } else if (url.includes('zoom.us')) {
    // zoom format: zoom.us/wc/123456789/join or zoom.us/j/123456789
    const match = url.match(/\/wc\/(\d+)\//) || url.match(/\/j\/(\d+)/) || url.match(/room=(\w+)/);
    if (match && match[1]) {
      return match[1];
    }
  }
  return "";
}

// Helper to check device type based on video stream aspect ratio (portrait vs landscape)
function detectDeviceByVideo(videoElement, tileElement) {
  if (tileElement) {
    const tileWidth = tileElement.offsetWidth || tileElement.clientWidth || 0;
    const tileHeight = tileElement.offsetHeight || tileElement.clientHeight || 0;
    if (tileWidth > 0 && tileHeight > 0) {
      const ratio = tileHeight / tileWidth;
      if (ratio > 0.8) {
        return "Mobile/Phone";
      }
    }
  }
  
  if (!videoElement) return "Desktop/Laptop";
  
  // 1. Try to check raw video dimensions
  let width = videoElement.videoWidth || 0;
  let height = videoElement.videoHeight || 0;
  
  // 2. Try to check MediaStream track settings (extremely accurate for mobile streams)
  if ((width === 0 || height === 0) && videoElement.srcObject && typeof videoElement.srcObject.getVideoTracks === 'function') {
    const videoTracks = videoElement.srcObject.getVideoTracks();
    if (videoTracks && videoTracks.length > 0) {
      const settings = videoTracks[0].getSettings();
      if (settings && settings.width && settings.height) {
        width = settings.width;
        height = settings.height;
      }
    }
  }
  
  // 3. Fallback to client bounds
  if (width === 0 || height === 0) {
    width = videoElement.clientWidth || 0;
    height = videoElement.clientHeight || 0;
  }
  
  if (width > 0 && height > 0) {
    return (height > width || width < 500) ? "Mobile/Phone" : "Desktop/Laptop";
  }
  return "Desktop/Laptop";
}

// -------------------------------------------------------------
// GOOGLE MEET DOM SCRAPER
// -------------------------------------------------------------

// Helper to check the local user's mic/cam from the bottom control bar
function getSelfMediaStatus() {
  const micButton = document.querySelector('[aria-label*="microphone"], [aria-label*="Microphone"], [data-tooltip*="microphone"]');
  const camButton = document.querySelector('[aria-label*="camera"], [aria-label*="Camera"], [data-tooltip*="camera"]');
  
  let micEnabled = true;
  let camEnabled = true;
  
  if (micButton) {
    const label = micButton.getAttribute('aria-label') || '';
    if (label.includes('Turn on') || label.includes('turn on') || label.includes('Unmute') || micButton.getAttribute('data-is-muted') === 'true') {
      micEnabled = false;
    }
  }
  
  if (camButton) {
    const label = camButton.getAttribute('aria-label') || '';
    if (label.includes('Turn on') || label.includes('turn on') || camButton.getAttribute('data-is-muted') === 'true') {
      camEnabled = false;
    }
  }
  
  return { micEnabled, camEnabled };
}

// Walk up parent chain to find the tile container representing the participant card
function findTileContainer(nameEl) {
  if (!nameEl) return null;
  let parent = nameEl.parentElement;
  for (let i = 0; i < 8; i++) {
    if (parent) {
      // Exclude interactive buttons or sub-components (like .U26fgb)
      if (parent.tagName.toLowerCase() === 'button' || parent.getAttribute('role') === 'button' || parent.classList.contains('U26fgb')) {
        parent = parent.parentElement;
        continue;
      }
      if (
        parent.hasAttribute('data-participant-id') || 
        parent.hasAttribute('data-self-name') ||
        parent.classList.contains('ZyF6gd') || 
        parent.getAttribute('jsname') === 'W22Opb'
      ) {
        return parent;
      }
      parent = parent.parentElement;
    }
  }
  return nameEl.closest('[jsname="W22Opb"], [data-participant-id], .ZyF6gd') || nameEl.parentElement?.parentElement?.parentElement || nameEl.parentElement;
}

function isElementVisible(el) {
  if (!el) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      return false;
    }
  }
  try {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  } catch (e) {}
  return true;
}

function isGoogleMeetMicEnabled(name, tileElement) {
  if (!tileElement) return true;
  
  try {
    // 1. Look for the classic red mute container class
    const classicMute = tileElement.querySelector('.FT30Cc');
    if (classicMute && isElementVisible(classicMute)) {
      return false; // Muted!
    }
    
    // 2. Scan all SVGs inside the tile (excluding buttons)
    const svgs = tileElement.querySelectorAll('svg');
    for (const svg of svgs) {
      // Exclude interactive hover buttons/controls
      if (svg.closest('button') || svg.closest('[role="button"]')) continue;
      
      const label = (svg.getAttribute('aria-label') || '').toLowerCase();
      const title = (svg.querySelector('title')?.textContent || '').toLowerCase();
      const classStr = svg.className && typeof svg.className === 'string' ? svg.className.toLowerCase() : '';
      
      // A microphone icon is present in the tile only when they are muted
      const isMicIcon = label.includes('mic') || label.includes('mute') || label.includes('audio') ||
                        title.includes('mic') || title.includes('mute') || title.includes('audio') ||
                        classStr.includes('mic') || classStr.includes('mute') || classStr.includes('audio') ||
                        svg.closest('[class*="mic" i]') || svg.closest('[class*="mute" i]') ||
                        Array.from(svg.querySelectorAll('path')).some(p => {
                          const d = p.getAttribute('d') || '';
                          return d.includes('18.29') || d.includes('1.27-1.27') || d.includes('12 2c') || d.includes('12 14c');
                        });
      
      const isCamIcon = label.includes('camera') || label.includes('video') || 
                        title.includes('camera') || title.includes('video');
      
      if (isMicIcon && !isCamIcon) {
        return false; // Found the microphone icon, meaning they are MUTED!
      }
    }
    
    // 3. Scan all elements inside the tile to check if they have a red background color or red SVG fill (fallback)
    const els = tileElement.querySelectorAll('*');
    for (const el of els) {
      if (el.closest('button') || el.closest('[role="button"]')) continue;
      
      const width = el.offsetWidth || el.clientWidth || 0;
      const height = el.offsetHeight || el.clientHeight || 0;
      
      if (width > 4 && width < 50 && height > 4 && height < 50) {
        const style = window.getComputedStyle(el);
        
        // Clean spaces from background color to avoid browser representation differences
        const bg = (style.backgroundColor || '').replace(/\s+/g, '');
        const isRedBg = bg && (bg.includes('234,67,53') || bg.includes('219,68,85') || bg.includes('ea4335') || bg.includes('db4437') || bg.includes('rgb(234,'));
        if (isRedBg && (el.querySelector('svg') || el.classList.contains('FT30Cc'))) {
          return false; // Found red background container with SVG!
        }
        
        // Clean spaces from fill color
        const fill = (el.getAttribute('fill') || style.fill || '').replace(/\s+/g, '');
        const isRedFill = fill && (fill.includes('234,67,53') || fill.includes('ea4335') || fill.includes('db4437') || fill.includes('rgb(234,'));
        if (isRedFill) {
          const tagName = el.tagName.toLowerCase();
          if (tagName === 'svg' || tagName === 'path' || tagName === 'circle') {
            return false; // Found red SVG fill!
          }
        }
      }
    }
  } catch (err) {
    console.error("Error in isGoogleMeetMicEnabled:", err);
  }
  
  return true; // Default to unmuted (mic enabled)
}

function isGoogleMeetCamEnabled(name, tileElement) {
  if (!tileElement) return false;
  
  const video = tileElement.querySelector('video');
  if (video) {
    // If video has layout dimensions, the camera is ON
    if (video.offsetWidth > 0 && video.offsetHeight > 0) {
      return true;
    }
  }
  return false;
}

function cleanParticipantName(name) {
  if (!name) return "";
  let clean = name.trim();
  
  // Remove "Pin [Name] to your main screen"
  if (clean.startsWith("Pin ") && clean.includes(" to your main screen")) {
    clean = clean.replace("Pin ", "").replace(" to your main screen", "").trim();
  }
  // Remove "Unpin [Name] from your main screen"
  if (clean.startsWith("Unpin ") && clean.includes(" from your main screen")) {
    clean = clean.replace("Unpin ", "").replace(" from your main screen", "").trim();
  }
  
  // Remove common tooltip prefixes if they exist at the start of a multi-word string
  if (clean.startsWith("Pin ") && clean.length > 5) {
    clean = clean.substring(4).trim();
  }
  if (clean.startsWith("Unpin ") && clean.length > 7) {
    clean = clean.substring(6).trim();
  }
  if (clean.startsWith("Mute ") && clean.length > 6) {
    clean = clean.substring(5).trim();
  }

  // Remove " (Presentation)" or other brackets
  clean = clean.replace(/\s*\(Presentation.*\)/gi, "");
  
  return clean.trim();
}

function getGoogleMeetParticipants() {
  const participantsList = [];
  const foundNames = new Set();

  // 1. Get Self Status (Host)
  const selfStatus = getSelfMediaStatus();
  let selfName = "Host User";
  const selfEl = document.querySelector('div[data-self-name], [data-name]');
  if (selfEl) {
    selfName = selfEl.getAttribute('data-self-name')?.trim() || selfEl.getAttribute('data-name')?.trim() || selfName;
  }
  selfName = cleanParticipantName(selfName);

  // 2. Scrape all participant tile containers from the screen (camera ON or OFF)
  const tiles = document.querySelectorAll('[data-participant-id], [jsname="W22Opb"], [data-self-name], .ZyF6gd');
  
  tiles.forEach(tile => {
    let name = "";
    const textEls = tile.querySelectorAll('span, div');
    for (const el of textEls) {
      if (el.children.length === 0) {
        const text = el.textContent?.trim();
        if (text && text.length > 2 && text.length < 50 && !text.includes(':') && !text.includes('\n')) {
          const lower = text.toLowerCase();
          const isSystemTag = ['pin', 'unpin', 'mute', 'unmute', 'presentation', 'audio', 'video', 'reframe', 'more options', 'minimize', 'maximize', 'activities', 'people', 'chat', 'settings', 'backgrounds', 'effects', 'visual effects'].some(tag => lower.includes(tag));
          if (!isSystemTag) {
            name = text;
            break;
          }
        }
      }
    }

    if (tile.hasAttribute('data-self-name') || name === "You" || Array.from(tile.querySelectorAll('*')).some(el => el.textContent?.trim() === "You")) {
      name = selfName;
    }

    name = cleanParticipantName(name);

    if (name && !foundNames.has(name.toLowerCase())) {
      foundNames.add(name.toLowerCase());
      allSeenParticipants.add(name.toLowerCase());
      
      const micEnabled = isGoogleMeetMicEnabled(name, tile);
      const camEnabled = isGoogleMeetCamEnabled(name, tile);
      
      const video = tile.querySelector('video');
      const device = detectDeviceByVideo(video, tile);
      
      participantsList.push({
        name: name,
        micEnabled: micEnabled,
        camEnabled: camEnabled,
        device: device
      });
    }
  });

  // 3. Fallback: query classic selectors
  const nameElements = document.querySelectorAll('.GQ8Pgc, span.jVwcfb, div.jVwcfb, [data-participant-name], [jsname="W22Opb"]');
  nameElements.forEach(el => {
    let name = el.textContent?.trim() || el.getAttribute('data-participant-name')?.trim();
    if (!name) return;
    
    if (name === "You") name = selfName;
    name = cleanParticipantName(name);
    
    if (name && !foundNames.has(name.toLowerCase())) {
      foundNames.add(name.toLowerCase());
      allSeenParticipants.add(name.toLowerCase());
      const tile = findTileContainer(el);
      const micEnabled = isGoogleMeetMicEnabled(name, tile);
      const camEnabled = isGoogleMeetCamEnabled(name, tile);
      
      let device = "Desktop/Laptop";
      if (tile) {
        const video = tile.querySelector('video');
        device = detectDeviceByVideo(video, tile);
      }
      
      participantsList.push({
        name: name,
        micEnabled: micEnabled,
        camEnabled: camEnabled,
        device: device
      });
    }
  });

  // 4. Fallback: Check participant list panel if open
  const listNames = document.querySelectorAll('span.zW2Y1b, .scSharedFlow span, [jsname="kv44Ib"]');
  listNames.forEach(el => {
    let name = el.textContent?.trim();
    if (!name) return;
    name = cleanParticipantName(name);
    
    if (name && name !== "You" && !foundNames.has(name.toLowerCase()) && name.length < 40) {
      foundNames.add(name.toLowerCase());
      const row = el.closest('div[role="listitem"]') || el.parentElement?.parentElement;
      const isMuted = row ? !!row.querySelector('[aria-label*="muted"], [aria-label*="Muted"], .FT30Cc') : false;
      
      participantsList.push({
        name: name,
        micEnabled: !isMuted,
        camEnabled: false,
        device: "Desktop/Laptop"
      });
    }
  });

  // Ensure self/host user is in the list
  const hostLower = selfName.toLowerCase();
  const hostInList = Array.from(foundNames).some(n => n === hostLower || n === "host user" || n === "you");
  if (!hostInList) {
    participantsList.push({
      name: selfName,
      micEnabled: selfStatus.micEnabled,
      camEnabled: selfStatus.camEnabled,
      device: "Desktop/Laptop"
    });
  }

  return participantsList;
}

// -------------------------------------------------------------
// ZOOM DOM SCRAPER
// -------------------------------------------------------------
// Helper to check the Zoom host's media status from the bottom control bar
function getZoomSelfStatus() {
  const micButton = document.querySelector('[aria-label*="mute" i], [aria-label*="unmute" i]');
  const camButton = document.querySelector('[aria-label*="video" i]');
  
  let micEnabled = true;
  let camEnabled = true;
  
  if (micButton) {
    const label = micButton.getAttribute('aria-label') || '';
    if (label.toLowerCase().includes('unmute') || micButton.classList.contains('muted') || micButton.querySelector('.audio-icon__microphone--muted')) {
      micEnabled = false;
    }
  }
  
  if (camButton) {
    const label = camButton.getAttribute('aria-label') || '';
    if (label.toLowerCase().includes('start') || label.toLowerCase().includes('enable') || camButton.classList.contains('off')) {
      camEnabled = false;
    }
  }
  
  return { micEnabled, camEnabled };
}

function getZoomParticipants() {
  const participantsList = [];
  const foundNames = new Set();

  // 1. Get Zoom Self Status (Host)
  const selfStatus = getZoomSelfStatus();
  participantsList.push({
    name: "Host User", // Will be mapped to 'happy' or the host name in the backend
    micEnabled: selfStatus.micEnabled,
    camEnabled: selfStatus.camEnabled,
    device: "Desktop/Laptop"
  });
  foundNames.add("host user");

  // 2. Scrape Zoom Web client grid items
  const tiles = document.querySelectorAll('.video-avatar, .foot-bar-name, .meeting-control-bar__btn, div[id^="participant-"], .speaker-active');
  
  tiles.forEach(tile => {
    const nameEl = tile.querySelector('.avatar-name, .video-avatar__name, .foot-bar-name, span');
    const name = nameEl?.textContent?.trim();
    
    if (name && name !== "Me" && name !== "You" && !foundNames.has(name.toLowerCase()) && name.length < 40) {
      foundNames.add(name.toLowerCase());
      
      const isMuted = !!tile.querySelector('.audio-icon__microphone--muted, svg[data-icon*="muted"], [aria-label*="muted"], [aria-label*="Muted"]');
      const video = tile.querySelector('video');
      const hasVideo = !!video;
      
      let device = "Desktop/Laptop";
      if (video) {
        device = detectDeviceByVideo(video);
      }

      participantsList.push({
        name: name,
        micEnabled: !isMuted,
        camEnabled: hasVideo,
        device: device
      });
    }
  });

  return participantsList;
}

// -------------------------------------------------------------
// CAPTIONS CAPTURER & SENDER
// -------------------------------------------------------------
function sendSpeech(speaker, text) {
  const cleanText = text.trim();
  if (!cleanText || cleanText.length < 2) return;
  
  // Create a unique hash to prevent duplicate sends of the exact same sentence segment
  const hash = `${speaker}:${cleanText.toLowerCase()}`;
  if (processedSpeechHashes.has(hash)) return;
  
  processedSpeechHashes.add(hash);
  // Keep memory bounded
  if (processedSpeechHashes.size > 1000) {
    const firstVal = processedSpeechHashes.values().next().value;
    processedSpeechHashes.delete(firstVal);
  }
  
  console.log(`[Online Meet helper] Speech Detected -> ${speaker}: "${cleanText}"`);
  if (socket && socket.connected) {
    socket.emit('extension-speech-transcribed', {
      roomId: roomId,
      sender: speaker,
      text: cleanText
    });
  }
}

// Helper to automatically turn on captions in Google Meet if disabled
function ensureGoogleMeetCaptionsOn() {
  const capButton = document.querySelector(
    'button[aria-label*="captions" i], ' +
    'button[data-tooltip*="captions" i], ' +
    'button[aria-label*="subtitles" i], ' +
    'button[aria-label*="closed captions" i]'
  );
  if (capButton) {
    const isPressed = capButton.getAttribute('aria-pressed') === 'true' || 
                      capButton.getAttribute('data-is-on') === 'true' || 
                      capButton.classList.contains('google-meet-active-cc');
    if (!isPressed && (
      capButton.getAttribute('aria-label')?.toLowerCase().includes('turn on') ||
      capButton.getAttribute('data-tooltip')?.toLowerCase().includes('turn on') ||
      capButton.getAttribute('aria-pressed') === 'false'
    )) {
      console.log("[Online Meet helper] Attempting to auto-enable Google Meet captions...");
      capButton.click();
    }
  }
}

// Helper to find the speaker name for a given caption text element
function findSpeakerForTextElement(textEl) {
  // 1. Check preceding siblings of the text element or its parent
  let sibling = textEl.previousElementSibling;
  while (sibling) {
    const speakerEl = sibling.querySelector('.MupYid, .zs7s8d, .Jnname, [jsname="W22Opb"]') || 
                      (sibling.classList.contains('MupYid') ? sibling : null);
    if (speakerEl && speakerEl.textContent?.trim()) {
      return speakerEl.textContent.trim();
    }
    sibling = sibling.previousElementSibling;
  }
  
  // 2. Check parent chain
  let parent = textEl.parentElement;
  while (parent && parent.tagName !== 'BODY') {
    const speakerEl = parent.querySelector('.MupYid, .zs7s8d, .Jnname, [jsname="W22Opb"]');
    if (speakerEl && speakerEl.textContent?.trim()) {
      return speakerEl.textContent.trim();
    }
    parent = parent.parentElement;
  }
  
  // 3. Fallback: look at preceding elements in the DOM
  const speakers = Array.from(document.querySelectorAll('.MupYid, .zs7s8d, .Jnname'));
  if (speakers.length > 0) {
    let closestSpeaker = null;
    speakers.forEach(sp => {
      const position = sp.compareDocumentPosition(textEl);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        closestSpeaker = sp;
      }
    });
    if (closestSpeaker && closestSpeaker.textContent?.trim()) {
      return closestSpeaker.textContent.trim();
    }
  }
  
  return "";
}

function getLongestCommonPrefix(s1, s2) {
  let i = 0;
  while (i < s1.length && i < s2.length && s1[i] === s2[i]) {
    i++;
  }
  return s1.substring(0, i);
}

function checkGoogleMeetCaptions() {
  // Auto-enable captions if possible
  ensureGoogleMeetCaptionsOn();

  const container = document.querySelector('[role="region"][aria-label="Captions"], div[jsname="dshYob"], div[aria-label="Captions"]');
  if (!container) return;

  // Find the actual wrapper of the caption blocks
  let blocksContainer = container;
  if (container.querySelector('[jsname="dshYob"]')) {
    blocksContainer = container.querySelector('[jsname="dshYob"]');
  } else if (container.children.length === 1 && container.children[0].tagName === 'DIV') {
    blocksContainer = container.children[0];
  }

  const blocks = Array.from(blocksContainer.children);
  if (blocks.length === 0) return;

  // 1. Compile a Set of known lowercased participant names dynamically
  const knownNames = new Set();
  knownNames.add("you");
  knownNames.add("host user");
  
  // Add historically seen names so we can recognize them even when their video tiles are off-screen/hidden
  allSeenParticipants.forEach(name => knownNames.add(name));
  
  // Scrape names currently visible in video grids
  const nameEls = document.querySelectorAll('.GQ8Pgc, span.jVwcfb, div.jVwcfb, [data-participant-name], [jsname="W22Opb"], .MupYid, .zs7s8d, .Jnname');
  nameEls.forEach(el => {
    const name = el.textContent?.trim().toLowerCase();
    if (name) knownNames.add(name);
  });

  // Also query video tiles structurally to find participant names
  const videos = document.querySelectorAll('video');
  videos.forEach(video => {
    let tile = video.parentElement;
    for (let i = 0; i < 6; i++) {
      if (tile && (
        tile.hasAttribute('data-participant-id') || 
        tile.hasAttribute('data-self-name') ||
        tile.classList.contains('ZyF6gd') || 
        tile.classList.contains('U26fgb') ||
        tile.getAttribute('role') === 'listitem'
      )) break;
      if (tile) tile = tile.parentElement;
    }
    if (tile) {
      tile.querySelectorAll('span, div').forEach(el => {
        if (el.children.length === 0) {
          const text = el.textContent?.trim().toLowerCase();
          const isSystemTag = ['pin', 'unpin', 'mute', 'unmute', 'presentation', 'audio', 'video', 'reframe', 'more options', 'minimize', 'maximize', 'activities', 'people', 'chat', 'settings', 'backgrounds', 'effects', 'visual effects'].some(tag => text.includes(tag));
          if (text && text.length > 2 && text.length < 40 && !isSystemTag) {
            knownNames.add(text);
          }
        }
      });
    }
  });

  // 2. Parse each block child in the captions container
  blocks.forEach(block => {
    let speaker = "";
    let textParts = [];

    // Find all leaf text nodes inside the block
    const descendants = Array.from(block.querySelectorAll('*'));
    if (descendants.length === 0) descendants.push(block);

    descendants.forEach(el => {
      if (el.children.length === 0) { // leaf node
        const val = el.textContent?.trim();
        if (!val) return;

        const valLower = val.toLowerCase();
        // If matches a known name or matches speaker classes/attributes
        if (knownNames.has(valLower) || el.classList.contains('MupYid') || el.classList.contains('zs7s8d')) {
          speaker = val;
        } else {
          // It's spoken text!
          const isSystemTag = ['pin', 'unpin', 'mute', 'unmute', 'presentation', 'reframe', 'backgrounds', 'effects', 'visual effects'].some(tag => valLower.includes(tag));
          if (!isSystemTag) {
            textParts.push(val);
          }
        }
      }
    });

    const text = textParts.join(" ").trim();
    if (speaker && text) {
      const lastText = lastCaptions[speaker] || '';
      if (text !== lastText) {
        let prefix = getLongestCommonPrefix(text, lastText);
        // Align prefix to word boundary to avoid sending partial words
        const lastSpace = prefix.lastIndexOf(' ');
        if (lastSpace > 0) {
          prefix = prefix.substring(0, lastSpace);
        } else if (prefix.length < text.length && prefix.length < lastText.length) {
          prefix = "";
        }
        
        const newSegment = text.substring(prefix.length).trim();
        if (newSegment.length > 0) {
          sendSpeech(speaker, newSegment);
          lastCaptions[speaker] = text;
        }
      }
    }
  });
}

function checkZoomCaptions() {
  // Zoom closed captions boxes
  const captionEl = document.querySelector('.closed-caption-text, .cc-caption-box');
  if (captionEl) {
    const fullText = captionEl.textContent?.trim();
    if (!fullText) return;
    
    const colonIdx = fullText.indexOf(':');
    if (colonIdx > 0) {
      const speaker = fullText.substring(0, colonIdx).trim();
      const text = fullText.substring(colonIdx + 1).trim();
      
      const lastText = lastCaptions[speaker] || '';
      if (text !== lastText) {
        sendSpeech(speaker, text);
        lastCaptions[speaker] = text;
      }
    }
  }
}

// -------------------------------------------------------------
// STATE SHARING TICKER
// -------------------------------------------------------------
function isGoogleMeetPresentationActive() {
  try {
    // 1. Check if the local host is presenting (Stop presenting button is visible in the bottom control bar)
    const stopBtn = document.querySelector('[aria-label*="Stop presenting" i], [data-tooltip*="Stop presenting" i]');
    if (stopBtn && stopBtn.offsetWidth > 0 && stopBtn.offsetHeight > 0) {
      return true;
    }
    
    // 2. Check if there is an active presentation tile in the grid
    const presTile = document.querySelector('[data-presentation-id], [aria-label*="presentation" i], [aria-label*="presenting" i]');
    if (presTile && presTile.offsetWidth > 0 && presTile.offsetHeight > 0) {
      return true;
    }
    
    // 3. Check for any presentation icon (screen sharing icon) visible in the layout
    const presIcons = document.querySelectorAll('svg');
    for (const icon of presIcons) {
      const label = (icon.getAttribute('aria-label') || '').toLowerCase();
      if ((label.includes('present') || label.includes('screen')) && isElementVisible(icon)) {
        return true;
      }
    }
  } catch (e) {
    console.error("Error in isGoogleMeetPresentationActive:", e);
  }
  return false;
}

function syncMeetingData() {
  if (!socket || !socket.connected || !roomId) return;

  let participants = [];
  let isPresentationActive = false;
  const hostname = window.location.hostname;
  
  if (hostname.includes('meet.google.com')) {
    participants = getGoogleMeetParticipants();
    isPresentationActive = isGoogleMeetPresentationActive();
  } else if (hostname.includes('zoom.us')) {
    participants = getZoomParticipants();
  }

  // Emit updated participant statuses
  socket.emit('extension-update-participants', {
    roomId: roomId,
    participants: participants,
    isPresentationActive: isPresentationActive
  });
}

// -------------------------------------------------------------
// INITIALIZER
// -------------------------------------------------------------
function initializeSync() {
  roomId = getRoomIdFromUrl();
  if (!roomId) {
    console.log("[Online Meet helper] No valid Room ID detected in URL yet. Retrying in 3s...");
    setTimeout(initializeSync, 3000);
    return;
  }

  console.log(`[Online Meet helper] Active Room ID detected: ${roomId}`);

  // Fetch configured server URL from storage
  chrome.storage.local.get(['serverUrl'], (result) => {
    if (result.serverUrl) {
      serverUrl = result.serverUrl;
    }
    
    console.log(`[Online Meet helper] Connecting to backend socket: ${serverUrl}`);
    
    // Connect to backend socket
    socket = io(serverUrl);

    socket.on('connect', () => {
      console.log(`[Online Meet helper] Successfully connected to Socket.io for Room: ${roomId}`);
      
      // Let extension join the socket room as a helper connection (invisible from participants list)
      socket.emit('join-extension', {
        roomId: roomId
      });

      // Start syncing participant list every 500ms (0.5 seconds)
      if (syncInterval) clearInterval(syncInterval);
      syncInterval = setInterval(syncMeetingData, 500);

      // Start checking captions every 1 second
      if (captionsCheckInterval) clearInterval(captionsCheckInterval);
      
      const hostname = window.location.hostname;
      if (hostname.includes('meet.google.com')) {
        captionsCheckInterval = setInterval(checkGoogleMeetCaptions, 1000);
      } else if (hostname.includes('zoom.us')) {
        captionsCheckInterval = setInterval(checkZoomCaptions, 1000);
      }
    });

    socket.on('disconnect', () => {
      console.warn("[Online Meet helper] Socket disconnected.");
    });
    
    socket.on('connect_error', (err) => {
      console.error("[Online Meet helper] Socket connection error:", err.message);
    });
  });
}

// Initialize on script load
initializeSync();

// Listen to message calls from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getStatus") {
    sendResponse({
      connected: socket ? socket.connected : false,
      roomId: roomId,
      serverUrl: serverUrl,
      captionListeners: !!captionsCheckInterval
    });
  } else if (request.action === "reconnect") {
    if (socket) socket.disconnect();
    initializeSync();
    sendResponse({ status: "Reconnecting..." });
  }
  return true;
});
