// Main WebSocket client and game state management

class BombermanClient {
  constructor() {
    this.ws = null;
    this.playerId = null;
    this.username = 'Player';
    this.currentLobby = null;
    this.gameState = null;
    this.availableMaps = [];
    this.connected = false;
  }
  
  connect() {
    // Determine WebSocket URL based on current location
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    
    // For production, use /ws path on same domain, for local dev use direct connection
    let wsUrl;
    if (host === 'localhost' || host === '127.0.0.1') {
      wsUrl = `${protocol}//${host}:8080`; // Local dev
    } else {
      wsUrl = `${protocol}//${host}/ws`; // Production - same domain with /ws path
    }
    
    console.log('Connecting to:', wsUrl);
    
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('Connected to server');
      this.connected = true;
      UI.showConnectionStatus('Connected!', 'success');
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
        UI.setUsername(this.username);
        this.requestMaps();
        UI.showScreen('lobby-browser');
        this.refreshLobbies();
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
          UI.showScreen('lobby-room');
        }
        break;
        
      case 'LEFT_LOBBY':
        this.currentLobby = null;
        UI.showScreen('lobby-browser');
        this.refreshLobbies();
        break;
        
      case 'GAME_STARTED':
        console.log('Game starting...');
        break;
        
      case 'GAME_STATE':
        this.gameState = message.state;
        
        // Initialize or reinitialize renderer if needed
        const needsInit = !Renderer.initialized || 
                          Renderer.canvas.width !== this.gameState.map.width * Renderer.tileSize ||
                          Renderer.canvas.height !== this.gameState.map.height * Renderer.tileSize;
        
        if (needsInit) {
          Renderer.init(this.gameState.map.width, this.gameState.map.height);
        }
        
        // Always show game screen when receiving game state
        const currentScreen = document.querySelector('.screen.active');
        if (!currentScreen || currentScreen.id !== 'game-screen') {
          UI.showScreen('game');
        }
        
        Renderer.render(this.gameState, this.playerId);
        UI.updatePlayerStats(this.gameState, this.playerId);
        break;
        
      case 'GAME_EVENTS':
        this.handleGameEvents(message.events);
        break;
        
      case 'BOMB_PLACED':
        // Bomb placement is handled in game state updates
        break;
        
      case 'ERROR':
        console.error('Server error:', message.message);
        alert(message.message);
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
  
  leaveLobby() {
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
}

// Global client instance
const client = new BombermanClient();


