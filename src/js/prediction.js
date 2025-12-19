// Client-side prediction for responsive movement
// Mirrors server-side physics, server remains source of truth

const Prediction = {
  // Local player state (predicted)
  localPlayer: null,
  
  // Config (synced with server)
  config: {
    defaultSpeed: 3, // tiles per second
    playerRadius: 0.35
  },
  
  // Timing
  lastUpdateTime: 0,
  
  // Pending bombs (placed locally, awaiting server confirmation)
  pendingBombs: [],
  
  // Initialize prediction for local player
  init(playerId, serverPlayer, gameState) {
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
    this.pendingBombs = [];
  },
  
  // Update local player with input (called from Input.pollInput)
  applyInput(vx, vy, gameState) {
    if (!this.localPlayer || !this.localPlayer.alive) return;
    
    // Normalize diagonal movement (same as server)
    const length = Math.sqrt(vx * vx + vy * vy);
    if (length > 0) {
      this.localPlayer.velocityX = (vx / length) * this.localPlayer.speed;
      this.localPlayer.velocityY = (vy / length) * this.localPlayer.speed;
    } else {
      this.localPlayer.velocityX = 0;
      this.localPlayer.velocityY = 0;
    }
  },
  
  // Update position based on velocity (called every frame)
  update(gameState) {
    if (!this.localPlayer || !this.localPlayer.alive) return;
    if (!gameState || !gameState.map) return;
    
    const now = performance.now();
    const deltaTime = (now - this.lastUpdateTime) / 1000; // Convert to seconds
    this.lastUpdateTime = now;
    
    // Cap deltaTime to prevent huge jumps
    const cappedDelta = Math.min(deltaTime, 0.1);
    
    if (this.localPlayer.velocityX === 0 && this.localPlayer.velocityY === 0) return;
    
    // Calculate new position
    const newX = this.localPlayer.x + this.localPlayer.velocityX * cappedDelta;
    const newY = this.localPlayer.y + this.localPlayer.velocityY * cappedDelta;
    
    // Try diagonal movement first
    if (this.canMoveTo(newX, newY, gameState)) {
      this.localPlayer.x = newX;
      this.localPlayer.y = newY;
      return;
    }
    
    // If diagonal blocked, try each axis independently (wall sliding)
    const canMoveX = this.canMoveTo(newX, this.localPlayer.y, gameState);
    const canMoveY = this.canMoveTo(this.localPlayer.x, newY, gameState);
    
    if (canMoveX) {
      this.localPlayer.x = newX;
    }
    if (canMoveY) {
      this.localPlayer.y = newY;
    }
  },
  
  // Collision detection (mirrors server logic)
  canMoveTo(x, y, gameState) {
    const map = gameState.map;
    const radius = this.config.playerRadius;
    
    // Check 4 corners of player hitbox
    const checkPoints = [
      { dx: -radius, dy: -radius }, // Top-left
      { dx: radius, dy: -radius },  // Top-right
      { dx: -radius, dy: radius },  // Bottom-left
      { dx: radius, dy: radius }    // Bottom-right
    ];
    
    for (const point of checkPoints) {
      const checkX = Math.floor(x + point.dx);
      const checkY = Math.floor(y + point.dy);
      
      // Bounds check
      if (checkX < 0 || checkX >= map.width || checkY < 0 || checkY >= map.height) {
        return false;
      }
      
      const tile = map.tiles[checkY]?.[checkX];
      
      // Walls and boxes block movement
      if (tile === '#' || tile === 'X') {
        return false;
      }
    }
    
    // Check collision with bombs
    const targetTileX = Math.floor(x);
    const targetTileY = Math.floor(y);
    const currentTileX = Math.floor(this.localPlayer.x);
    const currentTileY = Math.floor(this.localPlayer.y);
    
    for (const bomb of gameState.bombs) {
      if (bomb.x === targetTileX && bomb.y === targetTileY) {
        // Allow moving off a bomb we're standing on
        if (currentTileX === bomb.x && currentTileY === bomb.y) {
          continue;
        }
        return false;
      }
    }
    
    // Check pending bombs too
    for (const bomb of this.pendingBombs) {
      if (bomb.x === targetTileX && bomb.y === targetTileY) {
        if (currentTileX === bomb.x && currentTileY === bomb.y) {
          continue;
        }
        return false;
      }
    }
    
    // Check collision with other players
    for (const other of gameState.players) {
      if (other.id === this.localPlayer.id || !other.alive) continue;
      
      const dx = x - other.x;
      const dy = y - other.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < radius + this.config.playerRadius) {
        return false;
      }
    }
    
    return true;
  },
  
  // Place bomb locally (immediate feedback)
  placeBomb(gameState) {
    if (!this.localPlayer || !this.localPlayer.alive) return null;
    
    const bombX = Math.floor(this.localPlayer.x);
    const bombY = Math.floor(this.localPlayer.y);
    
    // Check if bomb already exists at this position
    for (const bomb of gameState.bombs) {
      if (bomb.x === bombX && bomb.y === bombY) {
        return null;
      }
    }
    for (const bomb of this.pendingBombs) {
      if (bomb.x === bombX && bomb.y === bombY) {
        return null;
      }
    }
    
    // Create pending bomb
    const pendingBomb = {
      id: `pending_${Date.now()}`,
      x: bombX,
      y: bombY,
      timer: 3000, // Same as server
      pending: true
    };
    
    this.pendingBombs.push(pendingBomb);
    
    // Remove pending bomb after a timeout if server doesn't confirm
    setTimeout(() => {
      const index = this.pendingBombs.findIndex(b => b.id === pendingBomb.id);
      if (index !== -1) {
        this.pendingBombs.splice(index, 1);
      }
    }, 500);
    
    return pendingBomb;
  },
  
  // Reconcile local state with server state
  reconcile(serverPlayer, gameState) {
    if (!this.localPlayer) {
      // First time - just initialize
      this.init(serverPlayer.id, serverPlayer, gameState);
      return;
    }
    
    // Update stats from server (speed, alive status, etc.)
    this.localPlayer.speed = serverPlayer.speed;
    this.localPlayer.alive = serverPlayer.alive;
    
    if (!serverPlayer.alive) {
      this.localPlayer.x = serverPlayer.x;
      this.localPlayer.y = serverPlayer.y;
      return;
    }
    
    // Calculate difference between predicted and server position
    const dx = serverPlayer.x - this.localPlayer.x;
    const dy = serverPlayer.y - this.localPlayer.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Threshold for correction
    const correctionThreshold = 0.5; // Half a tile
    const snapThreshold = 2.0; // Full snap if too far off
    
    if (distance > snapThreshold) {
      // Too far off - snap to server position
      console.log('Prediction: Snapping to server (distance:', distance.toFixed(2), ')');
      this.localPlayer.x = serverPlayer.x;
      this.localPlayer.y = serverPlayer.y;
    } else if (distance > correctionThreshold) {
      // Smoothly correct towards server position
      const correctionStrength = 0.3; // How fast to correct
      this.localPlayer.x += dx * correctionStrength;
      this.localPlayer.y += dy * correctionStrength;
    }
    // If within threshold, trust local prediction
    
    // Clean up pending bombs that are now confirmed by server
    this.pendingBombs = this.pendingBombs.filter(pending => {
      // Remove if server has a bomb at the same position
      return !gameState.bombs.some(b => b.x === pending.x && b.y === pending.y);
    });
  },
  
  // Get position for rendering (uses prediction for local player)
  getPlayerPosition(player, currentPlayerId) {
    if (this.localPlayer && player.id === currentPlayerId && this.localPlayer.alive) {
      return {
        x: this.localPlayer.x,
        y: this.localPlayer.y
      };
    }
    return {
      x: player.x,
      y: player.y
    };
  },
  
  // Get all bombs for rendering (includes pending)
  getAllBombs(serverBombs) {
    return [...serverBombs, ...this.pendingBombs];
  },
  
  // Reset prediction state
  reset() {
    this.localPlayer = null;
    this.pendingBombs = [];
    this.lastUpdateTime = 0;
  }
};

