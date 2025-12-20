// UI management

const UI = {
  // Initialize UI event listeners
  init() {
    // Connection screen
    document.getElementById('connect-btn').addEventListener('click', () => {
      const username = document.getElementById('username-input').value.trim() || 'Player';
      client.connect(username);
    });
    
    // Lobby browser
    document.getElementById('create-lobby-btn').addEventListener('click', () => {
      this.showModal('create-lobby-modal');
    });
    
    document.getElementById('refresh-lobbies-btn').addEventListener('click', () => {
      client.refreshLobbies();
    });
    
    // Create lobby modal
    document.getElementById('confirm-create-btn').addEventListener('click', () => {
      const lobbyName = document.getElementById('lobby-name-input').value.trim() || 'New Game';
      const mapName = document.getElementById('map-select').value;
      client.createLobby(lobbyName, mapName);
      this.hideModal('create-lobby-modal');
    });
    
    document.getElementById('cancel-create-btn').addEventListener('click', () => {
      this.hideModal('create-lobby-modal');
    });
    
    // Lobby room
    document.getElementById('leave-lobby-btn').addEventListener('click', () => {
      client.leaveLobby();
    });
    
    document.getElementById('ready-btn').addEventListener('click', (e) => {
      const btn = e.target;
      const isReady = btn.textContent === 'Ready';
      client.setReady(isReady);
      // Don't update button here - let server response handle it
    });
    
    document.getElementById('start-game-btn').addEventListener('click', () => {
      client.startGame();
    });
    
    // Lobby settings (host only)
    document.getElementById('lobby-map-select').addEventListener('change', (e) => {
      client.changeMap(e.target.value);
    });
    
    document.getElementById('reset-settings-btn').addEventListener('click', () => {
      client.resetSettings();
    });
    
    // Settings sliders
    this.initSettingsSliders();
    
    // Game over
    document.getElementById('return-lobby-btn').addEventListener('click', () => {
      Renderer.reset(); // Reset renderer for next game
      client.leaveLobby();
      this.showScreen('lobby-browser');
      client.refreshLobbies();
    });
    
    // Auto-refresh lobbies every 5 seconds when on lobby browser
    setInterval(() => {
      if (this.isScreenActive('lobby-browser')) {
        client.refreshLobbies();
      }
    }, 5000);
  },
  
  showScreen(screenId) {
    document.querySelectorAll('.screen').forEach(screen => {
      screen.classList.remove('active');
    });
    document.getElementById(`${screenId}-screen`).classList.add('active');
  },
  
  isScreenActive(screenId) {
    return document.getElementById(`${screenId}-screen`).classList.contains('active');
  },
  
  showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
  },
  
  hideModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
  },
  
  showConnectionStatus(message, type) {
    const status = document.getElementById('connection-status');
    status.textContent = message;
    status.style.color = type === 'success' ? 'green' : 'red';
  },
  
  setUsername(username) {
    document.getElementById('current-username').textContent = `👤 ${username}`;
  },
  
  populateMapSelect(maps) {
    // Populate both the create lobby and lobby room map selects
    const selects = [
      document.getElementById('map-select'),
      document.getElementById('lobby-map-select')
    ];
    
    selects.forEach(select => {
      if (!select) return;
      select.innerHTML = '';
      
      maps.forEach(mapName => {
        const option = document.createElement('option');
        option.value = mapName;
        option.textContent = mapName.charAt(0).toUpperCase() + mapName.slice(1);
        select.appendChild(option);
      });
    });
  },
  
  displayLobbies(lobbies) {
    const list = document.getElementById('lobby-list');
    list.innerHTML = '';
    
    if (lobbies.length === 0) {
      list.innerHTML = '<p class="empty-message">No lobbies available. Create one!</p>';
      return;
    }
    
    lobbies.forEach(lobby => {
      const item = document.createElement('div');
      item.className = 'lobby-item';
      item.innerHTML = `
        <div class="lobby-info">
          <h3>${lobby.name}</h3>
          <div class="lobby-meta">
            Players: ${lobby.playerCount}/${lobby.maxPlayers}
          </div>
        </div>
        <button class="btn btn-primary join-btn" data-lobby-id="${lobby.id}">Join</button>
      `;
      
      item.querySelector('.join-btn').addEventListener('click', () => {
        client.joinLobby(lobby.id);
      });
      
      list.appendChild(item);
    });
  },
  
  updateLobbyRoom(lobby, currentPlayerId) {
    document.getElementById('lobby-room-name').textContent = lobby.name;
    document.getElementById('player-count').textContent = lobby.playerCount;
    
    // Update ready count
    const readyCount = lobby.players.filter(p => p.ready).length;
    document.getElementById('ready-count').textContent = readyCount;
    document.getElementById('total-count').textContent = lobby.playerCount;
    
    // Update lobby hint
    const lobbyHint = document.getElementById('lobby-hint');
    if (readyCount === lobby.playerCount) {
      lobbyHint.textContent = 'All players ready! Host can start the game.';
      lobbyHint.style.color = '#10b981';
    } else {
      lobbyHint.textContent = `Waiting for ${lobby.playerCount - readyCount} more player(s) to ready up...`;
      lobbyHint.style.color = '#666';
    }
    
    const playersList = document.getElementById('players-list');
    playersList.innerHTML = '';
    
    lobby.players.forEach(player => {
      const item = document.createElement('div');
      item.className = 'player-item';
      
      let statusHTML = '';
      if (player.id === lobby.hostId) {
        statusHTML = '<span class="player-status host">Host (Ready)</span>';
      } else if (player.ready) {
        statusHTML = '<span class="player-status ready">Ready</span>';
      } else {
        statusHTML = '<span class="player-status not-ready">Not Ready</span>';
      }
      
      item.innerHTML = `
        <span class="player-name">${player.username}${player.id === currentPlayerId ? ' (You)' : ''}</span>
        ${statusHTML}
      `;
      
      playersList.appendChild(item);
    });
    
    // Show/hide start button for host
    const startBtn = document.getElementById('start-game-btn');
    const hostSettings = document.getElementById('host-settings');
    const settingsDisplay = document.getElementById('settings-display');
    const isHost = lobby.hostId === currentPlayerId;
    
    if (isHost) {
      startBtn.style.display = 'block';
      hostSettings.style.display = 'block';
      settingsDisplay.style.display = 'none';
      
      // Update map selector
      const mapSelect = document.getElementById('lobby-map-select');
      if (mapSelect.value !== lobby.mapName) {
        mapSelect.value = lobby.mapName;
      }
      
      // Update settings sliders (only if not focused to avoid disrupting user)
      if (lobby.settings) {
        this.updateSettingsSliders(lobby.settings);
      }
    } else {
      startBtn.style.display = 'none';
      hostSettings.style.display = 'none';
      settingsDisplay.style.display = 'block';
      
      // Show current settings for non-hosts
      if (lobby.settings) {
        this.displaySettings(lobby.settings, lobby.mapName);
      }
    }
    
    // Update ready button for non-hosts
    const readyBtn = document.getElementById('ready-btn');
    if (isHost) {
      readyBtn.style.display = 'none';
    } else {
      readyBtn.style.display = 'block';
      // Update button state based on player's ready status
      const currentPlayer = lobby.players.find(p => p.id === currentPlayerId);
      if (currentPlayer) {
        if (currentPlayer.ready) {
          readyBtn.textContent = 'Not Ready';
          readyBtn.className = 'btn btn-danger';
        } else {
          readyBtn.textContent = 'Ready';
          readyBtn.className = 'btn btn-primary';
        }
      }
    }
  },
  
  // Initialize settings sliders with change handlers
  initSettingsSliders() {
    const sliders = [
      { id: 'setting-speed', valueId: 'setting-speed-value', setting: 'playerSpeed', format: v => v },
      { id: 'setting-bombs', valueId: 'setting-bombs-value', setting: 'bombCount', format: v => v },
      { id: 'setting-range', valueId: 'setting-range-value', setting: 'explosionRange', format: v => v },
      { id: 'setting-timer', valueId: 'setting-timer-value', setting: 'bombTimer', format: v => v + 's', multiply: 1000 },
      { id: 'setting-upgrades', valueId: 'setting-upgrades-value', setting: 'upgradeSpawnChance', format: v => v + '%', divide: 100 }
    ];
    
    sliders.forEach(({ id, valueId, setting, format, multiply, divide }) => {
      const slider = document.getElementById(id);
      const valueDisplay = document.getElementById(valueId);
      
      slider.addEventListener('input', () => {
        valueDisplay.textContent = format(slider.value);
      });
      
      slider.addEventListener('change', () => {
        let value = parseFloat(slider.value);
        if (multiply) value *= multiply;
        if (divide) value /= divide;
        client.updateSettings({ [setting]: value });
      });
    });
  },
  
  // Update sliders to match current settings
  updateSettingsSliders(settings) {
    const setSlider = (id, valueId, value, format) => {
      const slider = document.getElementById(id);
      const display = document.getElementById(valueId);
      if (document.activeElement !== slider) {
        slider.value = value;
        display.textContent = format(value);
      }
    };
    
    setSlider('setting-speed', 'setting-speed-value', settings.playerSpeed, v => v);
    setSlider('setting-bombs', 'setting-bombs-value', settings.bombCount, v => v);
    setSlider('setting-range', 'setting-range-value', settings.explosionRange, v => v);
    setSlider('setting-timer', 'setting-timer-value', settings.bombTimer / 1000, v => v + 's');
    setSlider('setting-upgrades', 'setting-upgrades-value', settings.upgradeSpawnChance * 100, v => v + '%');
  },
  
  // Display settings for non-host players
  displaySettings(settings, mapName) {
    const container = document.getElementById('current-settings-info');
    container.innerHTML = `
      <p><strong>Map:</strong> ${mapName}</p>
      <p><strong>Speed:</strong> ${settings.playerSpeed}</p>
      <p><strong>Bombs:</strong> ${settings.bombCount}</p>
      <p><strong>Range:</strong> ${settings.explosionRange}</p>
      <p><strong>Timer:</strong> ${settings.bombTimer / 1000}s</p>
      <p><strong>Upgrades:</strong> ${Math.round(settings.upgradeSpawnChance * 100)}%</p>
    `;
  },
  
  
  updatePlayerStats(gameState, currentPlayerId) {
    const statsDiv = document.getElementById('player-stats');
    const currentPlayer = gameState.players.find(p => p.id === currentPlayerId);
    
    if (!currentPlayer) return;
    
    statsDiv.innerHTML = `
      <div class="stat-item">
        <div class="stat-label">💣 Bombs</div>
        <div class="stat-value">${currentPlayer.maxBombs - currentPlayer.activeBombs}/${currentPlayer.maxBombs}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">💥 Range</div>
        <div class="stat-value">${currentPlayer.explosionRange}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">⚡ Speed</div>
        <div class="stat-value">${currentPlayer.speed.toFixed(1)}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">❤️ Status</div>
        <div class="stat-value">${currentPlayer.alive ? 'Alive' : 'Dead'}</div>
      </div>
    `;
  },
  
  showGameOver(winner) {
    const resultDiv = document.getElementById('game-result');
    
    if (winner) {
      resultDiv.innerHTML = `
        <div class="winner">
          🏆<br>
          ${winner.username} Wins!
        </div>
      `;
    } else {
      resultDiv.innerHTML = `
        <div class="draw">
          💀<br>
          Draw! No survivors!
        </div>
      `;
    }
    
    setTimeout(() => {
      this.showScreen('game-over');
    }, 2000);
  },
  
  // Check if we should auto-connect (saved session)
  checkAutoConnect() {
    const savedUsername = client.loadUsername();
    const savedLobbyId = client.loadLobbyId();
    
    // Pre-fill username if saved
    if (savedUsername) {
      document.getElementById('username-input').value = savedUsername;
      
      // Auto-connect with saved username
      console.log('Found saved username, auto-connecting...');
      if (savedLobbyId) {
        this.showConnectionStatus('Reconnecting to lobby...', 'success');
      } else {
        this.showConnectionStatus('Reconnecting...', 'success');
      }
      client.connect(savedUsername);
    }
  }
};

// Initialize UI when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    UI.init();
    UI.checkAutoConnect();
  });
} else {
  UI.init();
  UI.checkAutoConnect();
}


