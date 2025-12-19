// Client-side prediction for responsive movement
// Local player: full client authority, server reconciliation only when needed
// Other players: smooth interpolation toward server position

const Prediction = {
  // Local player predicted state
  localPlayer: null,
  
  // Other players' interpolation state
  otherPlayers: new Map(), // playerId -> { x, y, targetX, targetY, velocityX, velocityY }
  
  // Config
  config: {
    defaultSpeed: 3,
    playerRadius: 0.35,
    // Interpolation settings
    otherPlayerLerpSpeed: 10, // How fast others lerp to target (per second)
    correctionLerpSpeed: 5,   // How fast we correct local player
    correctionThreshold: 0.1, // Only correct if diff > this (tiles)
    snapThreshold: 3.0        // Snap instantly if diff > this (teleport/respawn)
  },
  
  // Timing
  lastUpdateTime: 0,
  
  // Initialize for local player
  init(playerId, serverPlayer) {
    console.log('[Prediction] Init local player:', playerId);
    this.localPlayer = {
      id: playerId,
      x: serverPlayer.x,
      y: serverPlayer.y,
      speed: serverPlayer.speed || this.config.defaultSpeed,
      velocityX: 0,
      velocityY: 0,
      alive: serverPlayer.alive
    };
    this.lastUpdateTime = performance.now();
    this.otherPlayers.clear();
  },
  
  // Apply input immediately (called every frame from Input)
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
  },
  
  // Update physics (called every frame)
  update(gameState) {
    if (!gameState || !gameState.map) return;
    
    const now = performance.now();
    const deltaTime = Math.min((now - this.lastUpdateTime) / 1000, 0.1);
    this.lastUpdateTime = now;
    
    // Update local player position
    this.updateLocalPlayer(deltaTime, gameState);
    
    // Update other players (smooth interpolation)
    this.updateOtherPlayers(deltaTime, gameState);
  },
  
  // Update local player movement
  updateLocalPlayer(deltaTime, gameState) {
    if (!this.localPlayer || !this.localPlayer.alive) return;
    if (this.localPlayer.velocityX === 0 && this.localPlayer.velocityY === 0) return;
    
    // Calculate new position
    let newX = this.localPlayer.x + this.localPlayer.velocityX * deltaTime;
    let newY = this.localPlayer.y + this.localPlayer.velocityY * deltaTime;
    
    // Check collision with map only (no other players - that's server's job)
    if (this.canMoveToTile(newX, newY, gameState.map, gameState.bombs)) {
      this.localPlayer.x = newX;
      this.localPlayer.y = newY;
    } else {
      // Try sliding along walls
      const canMoveX = this.canMoveToTile(newX, this.localPlayer.y, gameState.map, gameState.bombs);
      const canMoveY = this.canMoveToTile(this.localPlayer.x, newY, gameState.map, gameState.bombs);
      
      if (canMoveX) this.localPlayer.x = newX;
      if (canMoveY) this.localPlayer.y = newY;
    }
  },
  
  // Collision check against tiles and bombs only (no players)
  canMoveToTile(x, y, map, bombs) {
    const radius = this.config.playerRadius;
    
    // Check 4 corners
    const corners = [
      { x: x - radius, y: y - radius },
      { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius },
      { x: x + radius, y: y + radius }
    ];
    
    for (const corner of corners) {
      const tileX = Math.floor(corner.x);
      const tileY = Math.floor(corner.y);
      
      // Bounds check
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
          // Allow moving off a bomb we're on
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
        // New player - initialize at server position
        other = {
          x: serverPlayer.x,
          y: serverPlayer.y,
          targetX: serverPlayer.x,
          targetY: serverPlayer.y
        };
        this.otherPlayers.set(serverPlayer.id, other);
      }
      
      // Lerp toward target position
      const lerpSpeed = this.config.otherPlayerLerpSpeed * deltaTime;
      other.x += (other.targetX - other.x) * Math.min(lerpSpeed, 1);
      other.y += (other.targetY - other.y) * Math.min(lerpSpeed, 1);
    }
    
    // Clean up disconnected players
    for (const [id] of this.otherPlayers) {
      if (!gameState.players.find(p => p.id === id && p.alive)) {
        this.otherPlayers.delete(id);
      }
    }
  },
  
  // Reconcile with server state
  reconcile(serverPlayer, gameState) {
    if (!this.localPlayer) {
      this.init(serverPlayer.id, serverPlayer);
      return;
    }
    
    // Update stats from server
    this.localPlayer.speed = serverPlayer.speed || this.config.defaultSpeed;
    this.localPlayer.alive = serverPlayer.alive;
    
    if (!serverPlayer.alive) {
      this.localPlayer.x = serverPlayer.x;
      this.localPlayer.y = serverPlayer.y;
      return;
    }
    
    // Calculate position difference
    const dx = serverPlayer.x - this.localPlayer.x;
    const dy = serverPlayer.y - this.localPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > this.config.snapThreshold) {
      // Teleport/respawn - snap immediately
      console.log('[Prediction] Snap to server (distance:', distance.toFixed(2), ')');
      this.localPlayer.x = serverPlayer.x;
      this.localPlayer.y = serverPlayer.y;
    } else if (distance > this.config.correctionThreshold) {
      // Gentle correction - lerp toward server
      const correction = this.config.correctionLerpSpeed * 0.016; // ~60fps
      this.localPlayer.x += dx * Math.min(correction, 0.5);
      this.localPlayer.y += dy * Math.min(correction, 0.5);
    }
    // If within threshold, trust local position completely
    
    // Update other players' target positions
    for (const player of gameState.players) {
      if (this.localPlayer && player.id === this.localPlayer.id) continue;
      
      const other = this.otherPlayers.get(player.id);
      if (other) {
        // Check if it's a big jump (teleport/respawn)
        const otherDist = Math.sqrt(
          Math.pow(player.x - other.targetX, 2) + 
          Math.pow(player.y - other.targetY, 2)
        );
        
        if (otherDist > this.config.snapThreshold) {
          // Snap other player too
          other.x = player.x;
          other.y = player.y;
        }
        
        other.targetX = player.x;
        other.targetY = player.y;
      }
    }
  },
  
  // Get position for rendering
  getPlayerPosition(player, localPlayerId) {
    // Local player - use predicted position
    if (this.localPlayer && player.id === localPlayerId) {
      return {
        x: this.localPlayer.x,
        y: this.localPlayer.y
      };
    }
    
    // Other players - use interpolated position
    const other = this.otherPlayers.get(player.id);
    if (other) {
      return {
        x: other.x,
        y: other.y
      };
    }
    
    // Fallback to server position
    return {
      x: player.x,
      y: player.y
    };
  },
  
  // Reset state
  reset() {
    this.localPlayer = null;
    this.otherPlayers.clear();
    this.lastUpdateTime = 0;
  }
};
