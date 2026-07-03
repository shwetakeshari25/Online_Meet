// Popup script for Online Meet Copilot Helper

document.addEventListener('DOMContentLoaded', () => {
  const connectionStatusEl = document.getElementById('connectionStatus');
  const activeRoomIdEl = document.getElementById('activeRoomId');
  const captionListenerEl = document.getElementById('captionListener');
  const serverUrlInput = document.getElementById('serverUrlInput');
  const saveBtn = document.getElementById('saveBtn');

  // Load configured server URL from storage
  chrome.storage.local.get(['serverUrl'], (result) => {
    serverUrlInput.value = result.serverUrl || 'http://localhost:5000';
  });

  // Query content script for status
  function updateStatus() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      if (!activeTab || !activeTab.url) {
        setNotOnMeetingStatus();
        return;
      }

      const url = activeTab.url;
      const onMeetOrZoom = url.includes('meet.google.com') || url.includes('zoom.us');
      if (!onMeetOrZoom) {
        setNotOnMeetingStatus();
        return;
      }

      // Send message to content script
      chrome.tabs.sendMessage(activeTab.id, { action: "getStatus" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Content script not loaded or ready yet
          connectionStatusEl.textContent = "Loading Helper...";
          connectionStatusEl.className = "status-badge badge-disconnected";
          activeRoomIdEl.textContent = "Refresh page to initialize";
          captionListenerEl.textContent = "Checking...";
          return;
        }

        if (response.connected) {
          connectionStatusEl.textContent = "CONNECTED";
          connectionStatusEl.className = "status-badge badge-connected";
        } else {
          connectionStatusEl.textContent = "DISCONNECTED";
          connectionStatusEl.className = "status-badge badge-disconnected";
        }

        activeRoomIdEl.textContent = response.roomId || "Not detected";
        captionListenerEl.textContent = response.captionListeners ? "ACTIVE (CC ON)" : "CC OFF";
        captionListenerEl.style.color = response.captionListeners ? "var(--primary-mint)" : "red";
      });
    });
  }

  function setNotOnMeetingStatus() {
    connectionStatusEl.textContent = "NOT ON MEET TAB";
    connectionStatusEl.className = "status-badge badge-disconnected";
    activeRoomIdEl.textContent = "Open Meet or Zoom page";
    captionListenerEl.textContent = "Inactive";
    captionListenerEl.style.color = "var(--text-muted)";
  }

  // Initial update
  updateStatus();
  // Poll status updates every 1.5 seconds
  const statusPoll = setInterval(updateStatus, 1500);

  // Save server configuration
  saveBtn.addEventListener('click', () => {
    let url = serverUrlInput.value.trim();
    if (!url) {
      url = 'http://localhost:5000';
    }
    
    // Normalize URL
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
    }

    chrome.storage.local.set({ serverUrl: url }, () => {
      saveBtn.textContent = "Saved!";
      saveBtn.style.backgroundColor = "var(--primary-gold)";
      
      // Send message to reconnect content script
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const activeTab = tabs[0];
        if (activeTab && activeTab.id) {
          chrome.tabs.sendMessage(activeTab.id, { action: "reconnect" }, () => {
            setTimeout(updateStatus, 500);
          });
        }
      });

      setTimeout(() => {
        saveBtn.textContent = "Save & Sync";
        saveBtn.style.backgroundColor = "var(--primary-mint)";
      }, 1500);
    });
  });

  // Cleanup interval on unload
  window.addEventListener('unload', () => {
    clearInterval(statusPoll);
  });
});
