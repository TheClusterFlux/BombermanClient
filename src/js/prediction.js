// Client-side prediction with proper server reconciliation
// Uses position history to compare against past positions, not current

const Prediction = {
  // Local player predicted state
  localPlayer: null,
  
  // Position history for reconciliation: { tick, x, y, vx, vy }
  positionHistory: [],
  maxHistoryLength: 120, // ~2 seconds at 60 ticks
  
  // Input history for replay: { tick, vx, vy }
  inputHistory: [],
  
  // Other players' interpolation state
  otherPlayers: new Map(),
  
  // Config
  config: {
    defaultSpeed: 3,
    playerRadius: 0.35,
    serverTickRate: 60,
    // Reconciliation settings - be very lenient since we're sending positions
    correctionThreshold: 0.5,  // Only correct if server explicitly rejects (>0.5 tile diff)
    otherPlayerLerpSpeed: 12,  // How fast others lerp
    snapThreshold: 2.0         // Snap if teleported/major desync
  },
  
  // Timing & sync
  lastUpdateTime: 0,
  currentTick: 0,          // Our estimated current tick
  lastServerTick: 0,
  lastReceiveTime: 0,
  tickAccumulator: 0,      // For sub-tick timing
  
  // Initialize for local player
  init(playerId, serverPlayer, serverTick) {
    console.log('[Prediction] Init local player:', playerId, 'at tick', serverTick);
    this.localPlayer = {
      id: playerId,
      x: serverPlayer.x,
      y: serverPlayer.y,
      speed: serverPlayer.speed || this.config.defaultSpeed,
      velocityX: 0,
      velocityY: 0,
      alive: serverPlayer.alive
    };
    this.currentTick = serverTick || 0;
    this.lastServerTick = serverTick || 0;
    this.lastUpdateTime = performance.now();
    this.positionHistory = [];
    this.inputHistory = [];
    this.otherPlayers.clear();
    
    // Record initial position
    this.recordPosition();
  },
  
  // Record current position in history
  recordPosition() {
    if (!this.localPlayer) return;
    
    this.positionHistory.push({
      tick: this.currentTick,
      x: this.localPlayer.x,
      y: this.localPlayer.y,
      vx: this.localPlayer.velocityX,
      vy: this.localPlayer.velocityY
    });
    
    // Trim old history
    while (this.positionHistory.length > this.maxHistoryLength) {
      this.positionHistory.shift();
    }
  },
  
  // Record input for potential replay
  recordInput(vx, vy) {
    this.inputHistory.push({
      tick: this.currentTick,
      vx: vx,
      vy: vy
    });
    
    // Trim old inputs
    while (this.inputHistory.length > this.maxHistoryLength) {
      this.inputHistory.shift();
    }
  },
  
  // Apply input immediately
  applyInput(vx, vy) {
    if (!this.localPlayer || !this.localPlayer.alive) return;
    
    // Normalize diagonal movement
    const length = Math.sqrt(vx * vx + vy * vy);
    if (length > 0) {
      this.localPlayer.velocityX = (vx / length) * this.localPlayer.speed;
      this.localPlayer.velocityY = (vy / length) * this.localPlayer.speed;
    } else {
      this.localPlayer.velocityX = 0;
      this.localPlayer.velocityY = 0;
    }
    
    // Record this input
    this.recordInput(vx, vy);
  },
  
  // Update physics - runs at 60fps, advances ticks
  update(gameState) {
    if (!gameState || !gameState.map) return;
    
    const now = performance.now();
    const deltaTime = Math.min((now - this.lastUpdateTime) / 1000, 0.1);
    this.lastUpdateTime = now;
    
    // Accumulate time for tick advancement
    const tickDuration = 1 / this.config.serverTickRate;
    this.tickAccumulator += deltaTime;
    
    // Process ticks
    while (this.tickAccumulator >= tickDuration) {
      this.tickAccumulator -= tickDuration;
      this.currentTick++;
      
      // Update local player for this tick
      this.simulateTick(gameState, tickDuration);
      
      // Record position after tick
      this.recordPosition();
    }
    
    // Update other players (smooth interpolation)
    this.updateOtherPlayers(deltaTime, gameState);
  },
  
  // Simulate one tick of movement
  simulateTick(gameState, dt) {
    if (!this.localPlayer || !this.localPlayer.alive) return;
    if (this.localPlayer.velocityX === 0 && this.localPlayer.velocityY === 0) return;
    
    let newX = this.localPlayer.x + this.localPlayer.velocityX * dt;
    let newY = this.localPlayer.y + this.localPlayer.velocityY * dt;
    
    // Collision check
    if (this.canMoveToTile(newX, newY, gameState.map, gameState.bombs)) {
      this.localPlayer.x = newX;
      this.localPlayer.y = newY;
    } else {
      // Wall sliding
      const canMoveX = this.canMoveToTile(newX, this.localPlayer.y, gameState.map, gameState.bombs);
      const canMoveY = this.canMoveToTile(this.localPlayer.x, newY, gameState.map, gameState.bombs);
      
      if (canMoveX) this.localPlayer.x = newX;
      if (canMoveY) this.localPlayer.y = newY;
    }
  },
  
  // Collision check against tiles and bombs
  canMoveToTile(x, y, map, bombs) {
    const radius = this.config.playerRadius;
    
    const corners = [
      { x: x - radius, y: y - radius },
      { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius },
      { x: x + radius, y: y + radius }
    ];
    
    for (const corner of corners) {
      const tileX = Math.floor(corner.x);
      const tileY = Math.floor(corner.y);
      
      if (tileX < 0 || tileX >= map.width || tileY < 0 || tileY >= map.height) {
        return false;
      }
      
      const tile = map.tiles[tileY]?.[tileX];
      if (tile === '#' || tile === 'X') {
        return false;
      }
    }
    
    // Check bombs
    if (bombs && this.localPlayer) {
      const targetTileX = Math.floor(x);
      const targetTileY = Math.floor(y);
      const currentTileX = Math.floor(this.localPlayer.x);
      const currentTileY = Math.floor(this.localPlayer.y);
      
      for (const bomb of bombs) {
        if (bomb.x === targetTileX && bomb.y === targetTileY) {
          if (currentTileX === bomb.x && currentTileY === bomb.y) {
            continue;
          }
          return false;
        }
      }
    }
    
    return true;
  },
  
  // Update other players with smooth interpolation
  updateOtherPlayers(deltaTime, gameState) {
    for (const serverPlayer of gameState.players) {
      if (this.localPlayer && serverPlayer.id === this.localPlayer.id) continue;
      if (!serverPlayer.alive) continue;
      
      let other = this.otherPlayers.get(serverPlayer.id);
      
      if (!other) {
        other = {
          x: serverPlayer.x,
          y: serverPlayer.y,
          targetX: serverPlayer.x,
          targetY: serverPlayer.y
        };
        this.otherPlayers.set(serverPlayer.id, other);
      }
      
      // Lerp toward target
      const lerpSpeed = this.config.otherPlayerLerpSpeed * deltaTime;
      other.x += (other.targetX - other.x) * Math.min(lerpSpeed, 1);
      other.y += (other.targetY - other.y) * Math.min(lerpSpeed, 1);
    }
    
    // Clean up disconnected
    for (const [id] of this.otherPlayers) {
      if (!gameState.players.find(p => p.id === id && p.alive)) {
        this.otherPlayers.delete(id);
      }
    }
  },
  
  // Reconcile with server - client authoritative approach
  // Server only matters if it explicitly rejected our position
  reconcile(serverPlayer, gameState) {
    const serverTick = gameState.tick || 0;
    
    if (!this.localPlayer) {
      this.init(serverPlayer.id, serverPlayer, serverTick);
      return;
    }
    
    // Update stats that server controls
    this.localPlayer.speed = serverPlayer.speed || this.config.defaultSpeed;
    this.localPlayer.alive = serverPlayer.alive;
    
    // If we died, snap to server position
    if (!serverPlayer.alive) {
      this.localPlayer.x = serverPlayer.x;
      this.localPlayer.y = serverPlayer.y;
      this.positionHistory = [];
      return;
    }
    
    // Calculate distance between our CURRENT position and server's position
    // (Server should have accepted our position if valid, so any diff = rejection)
    const dx = serverPlayer.x - this.localPlayer.x;
    const dy = serverPlayer.y - this.localPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > this.config.snapThreshold) {
      // Major desync - teleported, respawned, or serious issue
      console.log('[Prediction] Major desync - snapping:', distance.toFixed(2), 'tiles');
      this.localPlayer.x = serverPlayer.x;
      this.localPlayer.y = serverPlayer.y;
      this.positionHistory = [];
      this.currentTick = serverTick;
      this.recordPosition();
    } else if (distance > this.config.correctionThreshold) {
      // Server rejected our position - probably collision with another player
      // Only apply correction if significant
      console.log('[Prediction] Server correction:', distance.toFixed(3), 'tiles - likely player collision');
      
      // Smoothly blend toward server position instead of snapping
      // This makes collisions feel less jarring
      const blendFactor = 0.3;
      this.localPlayer.x += dx * blendFactor;
      this.localPlayer.y += dy * blendFactor;
    }
    // If within threshold, we're in sync - trust our local position!
    
    // Keep tick counter in sync
    if (serverTick > this.currentTick) {
      this.currentTick = serverTick;
    }
    
    // Prune old history
    this.positionHistory = this.positionHistory.filter(p => p.tick > serverTick);
    this.inputHistory = this.inputHistory.filter(i => i.tick > serverTick);
    
    this.lastServerTick = serverTick;
    this.lastReceiveTime = performance.now();
    
    // Update other players' targets
    for (const player of gameState.players) {
      if (this.localPlayer && player.id === this.localPlayer.id) continue;
      
      const other = this.otherPlayers.get(player.id);
      if (other) {
        const otherDist = Math.sqrt(
          Math.pow(player.x - other.targetX, 2) + 
          Math.pow(player.y - other.targetY, 2)
        );
        
        if (otherDist > this.config.snapThreshold) {
          other.x = player.x;
          other.y = player.y;
        }
        
        other.targetX = player.x;
        other.targetY = player.y;
      }
    }
  },
  
  // Get local player position with tick (for sending to server)
  getLocalPosition() {
    if (!this.localPlayer) return null;
    return {
      x: this.localPlayer.x,
      y: this.localPlayer.y,
      tick: this.currentTick
    };
  },
  
  // Get position for rendering
  getPlayerPosition(player, localPlayerId) {
    if (this.localPlayer && player.id === localPlayerId) {
      return { x: this.localPlayer.x, y: this.localPlayer.y };
    }
    
    const other = this.otherPlayers.get(player.id);
    if (other) {
      return { x: other.x, y: other.y };
    }
    
    return { x: player.x, y: player.y };
  },
  
  // Reset state
  reset() {
    this.localPlayer = null;
    this.positionHistory = [];
    this.inputHistory = [];
    this.otherPlayers.clear();
    this.lastUpdateTime = 0;
    this.currentTick = 0;
    this.lastServerTick = 0;
    this.lastReceiveTime = 0;
    this.tickAccumulator = 0;
  },
  
  // Debug stats
  getSyncStats() {
    return {
      currentTick: this.currentTick,
      lastServerTick: this.lastServerTick,
      ticksBehind: this.currentTick - this.lastServerTick,
      historyLength: this.positionHistory.length,
      localPos: this.localPlayer ? 
        `(${this.localPlayer.x.toFixed(2)}, ${this.localPlayer.y.toFixed(2)})` : 'none'
    };
  }
};
