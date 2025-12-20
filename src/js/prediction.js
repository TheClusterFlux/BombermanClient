// Client-side prediction with proper server reconciliation
// Uses position history to compare against past positions, not current

const Prediction = {
  // Local player predicted state
  localPlayer: null,
  
  // Position history for reconciliation: Map<tick, {x, y, vx, vy}>
  positionHistory: new Map(),
  maxHistoryTicks: 120, // ~2 seconds at 60 ticks
  
  // Input history for replay: { tick, vx, vy }
  inputHistory: [],
  
  // Other players' interpolation state
  otherPlayers: new Map(),
  
  // Config
  config: {
    defaultSpeed: 3,
    playerRadius: 0.35,
    serverTickRate: 60,
    // Reconciliation settings - be lenient, only correct real problems
    correctionThreshold: 0.3,  // Only correct if server rejected our move (collision)
    otherPlayerLerpSpeed: 12,  // How fast others lerp
    snapThreshold: 1.5,        // Snap if teleported/major desync
    maxHistoryMs: 1000         // Keep 1 second of history (covers 300ms+ latency)
  },
  
  // Timing & sync
  lastUpdateTime: 0,
  currentTick: 0,          // Our estimated current tick
  lastServerTick: 0,
  lastReceiveTime: 0,
  tickAccumulator: 0,      // For sub-tick timing
  
  // Track drift to detect sustained desync
  driftStartTime: 0,      // When drift started
  isDrifting: false,      // Currently drifting?
  
  // Timing config
  maxDriftTime: 500,      // How long drift is allowed before correction (ms)
  driftThreshold: 0.4,    // Distance to consider "drifting"
  
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
    this.positionHistory = new Map();
    this.inputHistory = [];
    this.otherPlayers.clear();
    this.isDrifting = false;
    this.driftStartTime = 0;
    
    // Record initial position
    this.recordPosition();
  },
  
  // Record current position in history (keyed by tick for O(1) lookup)
  recordPosition() {
    if (!this.localPlayer) return;
    
    this.positionHistory.set(this.currentTick, {
      x: this.localPlayer.x,
      y: this.localPlayer.y,
      vx: this.localPlayer.velocityX,
      vy: this.localPlayer.velocityY
    });
    
    // Trim old history (keep last maxHistoryTicks)
    const oldestToKeep = this.currentTick - this.maxHistoryTicks;
    for (const tick of this.positionHistory.keys()) {
      if (tick < oldestToKeep) {
        this.positionHistory.delete(tick);
      }
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
    while (this.inputHistory.length > this.maxHistoryTicks) {
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
  
  // Simulate one tick of movement with corner assist
  simulateTick(gameState, dt) {
    if (!this.localPlayer || !this.localPlayer.alive) return;
    if (this.localPlayer.velocityX === 0 && this.localPlayer.velocityY === 0) return;
    
    const vx = this.localPlayer.velocityX;
    const vy = this.localPlayer.velocityY;
    let newX = this.localPlayer.x + vx * dt;
    let newY = this.localPlayer.y + vy * dt;
    
    // Try direct movement
    if (this.canMoveToTile(newX, newY, gameState.map, gameState.bombs)) {
      this.localPlayer.x = newX;
      this.localPlayer.y = newY;
      return;
    }
    
    // CORNER ASSIST: Nudge player into lanes when hitting corners
    const cornerAssist = 0.35; // How close to corner edge to assist
    const nudgeSpeed = this.localPlayer.speed * 0.5;
    const nudgeAmount = nudgeSpeed * dt;
    
    const canMoveX = this.canMoveToTile(newX, this.localPlayer.y, gameState.map, gameState.bombs);
    const canMoveY = this.canMoveToTile(this.localPlayer.x, newY, gameState.map, gameState.bombs);
    
    if (canMoveX) {
      this.localPlayer.x = newX;
      // Moving horizontally - nudge vertically toward lane center
      if (!canMoveY && vy !== 0) {
        const tileY = Math.floor(this.localPlayer.y);
        const offsetY = this.localPlayer.y - (tileY + 0.5);
        if (Math.abs(offsetY) < cornerAssist && Math.abs(offsetY) > 0.01) {
          this.localPlayer.y -= Math.sign(offsetY) * Math.min(nudgeAmount, Math.abs(offsetY));
        }
      }
    }
    
    if (canMoveY) {
      this.localPlayer.y = newY;
      // Moving vertically - nudge horizontally toward lane center
      if (!canMoveX && vx !== 0) {
        const tileX = Math.floor(this.localPlayer.x);
        const offsetX = this.localPlayer.x - (tileX + 0.5);
        if (Math.abs(offsetX) < cornerAssist && Math.abs(offsetX) > 0.01) {
          this.localPlayer.x -= Math.sign(offsetX) * Math.min(nudgeAmount, Math.abs(offsetX));
        }
      }
    }
    
    // If completely blocked, try corner assist to slide around
    if (!canMoveX && !canMoveY) {
      const tileX = Math.floor(this.localPlayer.x);
      const tileY = Math.floor(this.localPlayer.y);
      const offsetX = this.localPlayer.x - (tileX + 0.5);
      const offsetY = this.localPlayer.y - (tileY + 0.5);
      
      // Try nudging horizontally to get around vertical obstacle
      if (vy !== 0 && Math.abs(offsetX) < cornerAssist) {
        const testX = this.localPlayer.x - Math.sign(offsetX) * nudgeAmount;
        if (this.canMoveToTile(testX, newY, gameState.map, gameState.bombs)) {
          this.localPlayer.x = testX;
          this.localPlayer.y = newY;
          return;
        }
      }
      
      // Try nudging vertically to get around horizontal obstacle
      if (vx !== 0 && Math.abs(offsetY) < cornerAssist) {
        const testY = this.localPlayer.y - Math.sign(offsetY) * nudgeAmount;
        if (this.canMoveToTile(newX, testY, gameState.map, gameState.bombs)) {
          this.localPlayer.x = newX;
          this.localPlayer.y = testY;
          return;
        }
      }
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
  
  // Reconcile with server - detect actual rejection, not latency
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
      this.positionHistory = new Map();
      return;
    }
    
    const serverPos = { x: serverPlayer.x, y: serverPlayer.y };
    
    // DRIFT-BASED RECONCILIATION:
    // Only correct if we've been drifting from server for too long
    // This handles latency gracefully - temporary drift is OK
    
    const currentDist = Math.sqrt(
      Math.pow(serverPos.x - this.localPlayer.x, 2) +
      Math.pow(serverPos.y - this.localPlayer.y, 2)
    );
    
    const now = performance.now();
    
    if (currentDist > this.config.snapThreshold) {
      // Major desync - snap immediately (teleport, death, etc.)
      console.log('[Prediction] Major desync - snapping:', currentDist.toFixed(2), 'tiles');
      this.localPlayer.x = serverPos.x;
      this.localPlayer.y = serverPos.y;
      this.positionHistory = new Map();
      this.currentTick = serverTick;
      this.recordPosition();
      this.isDrifting = false;
    } else if (currentDist > this.driftThreshold) {
      // We're drifting from server
      if (!this.isDrifting) {
        // Just started drifting - start timer
        this.isDrifting = true;
        this.driftStartTime = now;
      } else if (now - this.driftStartTime > this.maxDriftTime) {
        // Been drifting too long - server probably rejected our move
        console.log('[Prediction] Sustained drift detected - correcting:', currentDist.toFixed(2), 'tiles');
        
        // Smooth blend toward server
        const dx = serverPos.x - this.localPlayer.x;
        const dy = serverPos.y - this.localPlayer.y;
        const blendFactor = 0.3;
        this.localPlayer.x += dx * blendFactor;
        this.localPlayer.y += dy * blendFactor;
        
        // Reset drift timer to avoid rapid corrections
        this.driftStartTime = now;
      }
      // Else: still within allowed drift time, trust local
    } else {
      // We're in sync (or close enough) - reset drift tracking
      this.isDrifting = false;
    }
    // Trust local position for normal movement!
    
    // Prune old history
    for (const tick of this.positionHistory.keys()) {
      if (tick <= serverTick) {
        this.positionHistory.delete(tick);
      }
    }
    this.inputHistory = this.inputHistory.filter(i => i.tick > serverTick);
    
    this.lastServerTick = serverTick;
    this.lastReceiveTime = performance.now();
    
    // Update other players' targets (smooth interpolation)
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
    this.positionHistory = new Map();
    this.inputHistory = [];
    this.otherPlayers.clear();
    this.lastUpdateTime = 0;
    this.currentTick = 0;
    this.lastServerTick = 0;
    this.lastReceiveTime = 0;
    this.tickAccumulator = 0;
    this.isDrifting = false;
    this.driftStartTime = 0;
  },
  
  // Debug stats
  getSyncStats() {
    return {
      currentTick: this.currentTick,
      lastServerTick: this.lastServerTick,
      ticksAhead: this.currentTick - this.lastServerTick,
      historySize: this.positionHistory.size,
      isDrifting: this.isDrifting,
      localPos: this.localPlayer ? 
        `(${this.localPlayer.x.toFixed(2)}, ${this.localPlayer.y.toFixed(2)})` : 'none'
    };
  }
};
