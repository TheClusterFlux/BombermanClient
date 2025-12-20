// Main WebSocket client and game state management

// Session storage keys
const STORAGE_KEYS = {
  USERNAME: 'bomberman_username',
  LOBBY_ID: 'bomberman_lobby_id'
};

class BombermanClient {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.username = this.loadUsername() || 'Player';
    this.currentLobby = null;
    this.gameState = null;
    this.availableMaps = [];
    this.connected = false;
    this.pendingRejoin = this.loadLobbyId(); // Lobby to rejoin after connecting
    this.pendingUsername = null; // Username to set after connection opens
    this.predictionLoopRunning = false; // Track prediction render loop
  }
  
  // LocalStorage helpers
  loadUsername() {
    try {
      return localStorage.getItem(STORAGE_KEYS.USERNAME);
    } catch (e) {
      return null;
    }
  }
  
  saveUsername(username) {
    try {
      localStorage.setItem(STORAGE_KEYS.USERNAME, username);
    } catch (e) {
      console.warn('Could not save username to localStorage');
    }
  }
  
  loadLobbyId() {
    try {
      return localStorage.getItem(STORAGE_KEYS.LOBBY_ID);
    } catch (e) {
      return null;
    }
  }
  
  saveLobbyId(lobbyId) {
    try {
      if (lobbyId) {
        localStorage.setItem(STORAGE_KEYS.LOBBY_ID, lobbyId);
      } else {
        localStorage.removeItem(STORAGE_KEYS.LOBBY_ID);
      }
    } catch (e) {
      console.warn('Could not save lobby ID to localStorage');
    }
  }
  
  clearSession() {
    try {
      localStorage.removeItem(STORAGE_KEYS.LOBBY_ID);
    } catch (e) {
      // Ignore
    }
    this.pendingRejoin = null;
  }
  
  connect(usernameToSet) {
    // Prevent double-connect
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      console.log('Already connected or connecting');
      return;
    }
    
    // Store username to set after connection opens
    if (usernameToSet) {
      this.pendingUsername = usernameToSet;
    }
    
    // Determine WebSocket URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    
    // Use /ws path for both local dev and production
    let wsUrl;
    if (host === 'localhost' || host === '127.0.0.1') {
      wsUrl = `${protocol}//${host}:8080/ws`; // Local dev
    } else {
      wsUrl = `${protocol}//${host}/ws`; // Production - same domain with /ws path
    }
    
    console.log('Connecting to:', wsUrl);
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('Connected to server');
      this.connected = true;
      UI.showConnectionStatus('Connected!', 'success');
      
      // Set username now that connection is open
      if (this.pendingUsername) {
        this.setUsername(this.pendingUsername);
        this.pendingUsername = null;
      }
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      UI.showConnectionStatus('Connection error!', 'error');
    };
    
    this.ws.onclose = () => {
      console.log('Disconnected from server');
      this.connected = false;
      UI.showConnectionStatus('Disconnected. Refresh to reconnect.', 'error');
    };
  }
  
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
  
  handleMessage(message) {
    console.log('Received:', message.type);
    
    switch (message.type) {
      case 'CONNECTED':
        this.playerId = message.playerId;
        console.log('Player ID:', this.playerId);
        break;
        
      case 'USERNAME_SET':
        this.username = message.username;
        this.saveUsername(this.username);
        UI.setUsername(this.username);
        this.requestMaps();
        
        // Check if we should rejoin a lobby
        if (this.pendingRejoin) {
          console.log('Attempting to rejoin lobby:', this.pendingRejoin);
          this.joinLobby(this.pendingRejoin);
          this.pendingRejoin = null;
        } else {
          UI.showScreen('lobby-browser');
          this.refreshLobbies();
        }
        break;
        
      case 'MAP_LIST':
        this.availableMaps = message.maps;
        UI.populateMapSelect(this.availableMaps);
        break;
        
      case 'LOBBY_LIST':
        UI.displayLobbies(message.lobbies);
        break;
        
      case 'LOBBY_JOINED':
      case 'PLAYER_JOINED':
      case 'PLAYER_LEFT':
      case 'LOBBY_UPDATED':
        this.currentLobby = message.lobbyInfo || message.lobby;
        UI.updateLobbyRoom(this.currentLobby, this.playerId);
        if (message.type === 'LOBBY_JOINED') {
          // Save lobby ID for session persistence
          this.saveLobbyId(this.currentLobby.id);
          UI.showScreen('lobby-room');
        }
        break;
        
      case 'LEFT_LOBBY':
        this.currentLobby = null;
        this.clearSession(); // Clear saved lobby ID
        // Reset prediction state when leaving lobby
        if (typeof Prediction !== 'undefined') {
          Prediction.reset();
        }
        this.predictionLoopRunning = false;
        UI.showScreen('lobby-browser');
        this.refreshLobbies();
        break;
        
      case 'GAME_STARTED':
        console.log('Game starting...');
        break;
        
      case 'GAME_STATE':
        this.gameState = message.state;
        
        // Fix explosion timestamps for clock synchronization
        // Replace server timestamp with client timestamp when we first see an explosion
        const now = Date.now();
        if (this.gameState.explosions) {
          for (const explosion of this.gameState.explosions) {
            // Generate a unique ID for tracking
            const expId = `${explosion.originX}_${explosion.originY}_${explosion.timestamp}`;
            if (!this.knownExplosions) this.knownExplosions = new Map();
            
            if (!this.knownExplosions.has(expId)) {
              // First time seeing this explosion - use current client time
              explosion.clientTimestamp = now;
              this.knownExplosions.set(expId, now);
            } else {
              // Already seen - use the stored client timestamp
              explosion.clientTimestamp = this.knownExplosions.get(expId);
            }
          }
          
          // Clean up old explosion tracking (keep last 20)
          if (this.knownExplosions.size > 20) {
            const entries = Array.from(this.knownExplosions.entries());
            entries.sort((a, b) => a[1] - b[1]);
            for (let i = 0; i < entries.length - 20; i++) {
              this.knownExplosions.delete(entries[i][0]);
            }
          }
        }
        
        // Initialize or reinitialize renderer if needed
        const needsInit = !Renderer.initialized || 
                          Renderer.canvas.width !== this.gameState.map.width * Renderer.tileSize ||
                          Renderer.canvas.height !== this.gameState.map.height * Renderer.tileSize;
        
        if (needsInit) {
          Renderer.init(this.gameState.map.width, this.gameState.map.height);
        }
        
        // Reconcile client-side prediction with server state
        if (typeof Prediction !== 'undefined') {
          const serverPlayer = this.gameState.players.find(p => p.id === this.playerId);
          if (serverPlayer) {
            Prediction.reconcile(serverPlayer, this.gameState);
          }
        }
        
        // Always start prediction loop when receiving game state (if not already running)
        this.startPredictionLoop();
        
        // Always show game screen when receiving game state
        const currentScreen = document.querySelector('.screen.active');
        if (!currentScreen || currentScreen.id !== 'game-screen') {
          UI.showScreen('game');
        }
        
        // Render is now handled by the prediction loop for smoother updates
        // But we still render here as a fallback and for initial state
        Renderer.render(this.gameState, this.playerId);
        UI.updatePlayerStats(this.gameState, this.playerId);
        break;
        
      case 'GAME_EVENTS':
        this.handleGameEvents(message.events);
        break;
        
      case 'BOMB_PLACED':
        // Bomb placement is handled in game state updates
        break;
        
      case 'RETURN_TO_LOBBY':
        // Game ended - return to lobby room (not browser)
        console.log('Returning to lobby after game');
        this.currentLobby = message.lobbyInfo;
        // Reset prediction state
        if (typeof Prediction !== 'undefined') {
          Prediction.reset();
        }
        this.predictionLoopRunning = false;
        this.gameState = null;
        Renderer.reset();
        UI.updateLobbyRoom(this.currentLobby, this.playerId);
        UI.showScreen('lobby-room');
        break;
        
      case 'KICKED_FROM_LOBBY':
        // We were kicked from the lobby
        console.log('Kicked from lobby:', message.message);
        this.currentLobby = null;
        this.clearSession();
        UI.showConnectionStatus('You were kicked from the lobby', 'error');
        UI.showScreen('lobby-browser');
        this.refreshLobbies();
        break;
        
      case 'ERROR':
        console.error('Server error:', message.message);
        // If join failed (possibly stale lobby), clear session and show browser
        if (message.message && message.message.toLowerCase().includes('join')) {
          this.clearSession();
          UI.showScreen('lobby-browser');
          this.refreshLobbies();
          // Don't show alert for stale lobby - just show status message
          UI.showConnectionStatus('Lobby no longer available', 'error');
        } else {
          // Show alert for other errors
          alert(message.message);
        }
        break;
    }
  }
  
  handleGameEvents(events) {
    for (const event of events) {
      switch (event.type) {
        case 'EXPLOSION':
          console.log('Explosion at tiles:', event.tiles);
          break;
          
        case 'UPGRADE_COLLECTED':
          console.log('Player', event.playerId, 'collected upgrade:', event.upgrade.type);
          break;
          
        case 'PLAYER_FELL':
          console.log('Player', event.playerId, 'fell into a hole!');
          break;
          
        case 'GAME_OVER':
          console.log('Game over!', event.winner);
          // Reset prediction state
          if (typeof Prediction !== 'undefined') {
            Prediction.reset();
          }
          this.predictionLoopRunning = false;
          UI.showGameOver(event.winner);
          break;
      }
    }
  }
  
  setUsername(username) {
    this.username = username;
    this.send({
      type: 'SET_USERNAME',
      username: username
    });
  }
  
  refreshLobbies() {
    this.send({ type: 'GET_LOBBIES' });
  }
  
  requestMaps() {
    this.send({ type: 'GET_MAPS' });
  }
  
  createLobby(lobbyName, mapName) {
    this.send({
      type: 'CREATE_LOBBY',
      lobbyName: lobbyName,
      mapName: mapName
    });
  }
  
  joinLobby(lobbyId) {
    this.send({
      type: 'JOIN_LOBBY',
      lobbyId: lobbyId
    });
  }
  
  changeMap(mapName) {
    this.send({
      type: 'CHANGE_MAP',
      mapName: mapName
    });
  }
  
  updateSettings(settings) {
    this.send({
      type: 'UPDATE_SETTINGS',
      settings: settings
    });
  }
  
  resetSettings() {
    this.send({
      type: 'RESET_SETTINGS'
    });
  }
  
  returnToLobby() {
    this.send({
      type: 'RETURN_TO_LOBBY_REQUEST'
    });
  }
  
  kickPlayer(playerId) {
    this.send({
      type: 'KICK_PLAYER',
      playerId: playerId
    });
  }
  
  leaveLobby() {
    this.clearSession(); // Clear saved lobby before leaving
    this.send({
      type: 'LEAVE_LOBBY'
    });
  }
  
  setReady(ready) {
    this.send({
      type: 'SET_READY',
      ready: ready
    });
  }
  
  startGame() {
    this.send({
      type: 'START_GAME'
    });
  }
  
  sendPlayerAction(action) {
    this.send({
      type: 'PLAYER_ACTION',
      action: action
    });
  }
  
  // Start the client-side prediction render loop for smooth movement
  startPredictionLoop() {
    if (this.predictionLoopRunning) return;
    this.predictionLoopRunning = true;
    
    const loop = () => {
      if (!this.gameState || this.gameState.gameOver) {
        this.predictionLoopRunning = false;
        return;
      }
      
      // Update prediction physics
      if (typeof Prediction !== 'undefined') {
        Prediction.update(this.gameState);
      }
      
      // Render with predicted positions
      Renderer.render(this.gameState, this.playerId);
      
      requestAnimationFrame(loop);
    };
    
    requestAnimationFrame(loop);
  }
}

// Global client instance
const client = new BombermanClient();


