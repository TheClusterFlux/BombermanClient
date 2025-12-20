// Canvas renderer for the game

const Renderer = {
  canvas: null,
  ctx: null,
  tileSize: 40,
  initialized: false,
  
  // Colors
  colors: {
    EMPTY: '#e8e8e8',
    WALL: '#2c3e50',
    BOX: '#8b6f47',
    HOLE: '#000000',
    BOMB: '#e74c3c',
    EXPLOSION: '#ff9800',
    PLAYER: ['#3498db', '#2ecc71', '#9b59b6', '#f1c40f'],
    UPGRADE_SPEED: '#00FF00',
    UPGRADE_BOMB: '#FF00FF',
    UPGRADE_RANGE: '#FFFF00'
  },
  
  init(mapWidth, mapHeight) {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    
    // Always update canvas size (maps can be different sizes)
    this.canvas.width = mapWidth * this.tileSize;
    this.canvas.height = mapHeight * this.tileSize;
    
    this.initialized = true;
  },
  
  reset() {
    // Reset renderer for new game
    this.initialized = false;
  },
  
  render(gameState, currentPlayerId) {
    if (!this.initialized) return;
    
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    // Draw map tiles
    this.drawMap(gameState.map);
    
    // Draw upgrades
    this.drawUpgrades(gameState.map.upgrades);
    
    // Draw bombs (server authoritative)
    this.drawBombs(gameState.bombs);
    
    // Draw explosions
    this.drawExplosions(gameState.explosions);
    
    // Draw players (using predicted/interpolated positions)
    this.drawPlayers(gameState.players, currentPlayerId);
  },
  
  drawMap(map) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.tiles[y][x];
        let color;
        
        switch (tile) {
          case '#':
            color = this.colors.WALL;
            break;
          case 'X':
            color = this.colors.BOX;
            break;
          case 'O':
            color = this.colors.HOLE;
            break;
          default:
            color = this.colors.EMPTY;
        }
        
        this.drawTile(x, y, color);
        
        // Add grid lines
        this.ctx.strokeStyle = '#ddd';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(
          x * this.tileSize,
          y * this.tileSize,
          this.tileSize,
          this.tileSize
        );
      }
    }
  },
  
  drawTile(x, y, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(
      x * this.tileSize,
      y * this.tileSize,
      this.tileSize,
      this.tileSize
    );
  },
  
  drawUpgrades(upgrades) {
    for (const upgrade of upgrades) {
      const centerX = upgrade.x * this.tileSize + this.tileSize / 2;
      const centerY = upgrade.y * this.tileSize + this.tileSize / 2;
      const radius = this.tileSize / 3;
      
      // Draw circle
      this.ctx.fillStyle = this.colors[`UPGRADE_${upgrade.type}`] || '#FFF';
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      this.ctx.fill();
      
      // Draw border
      this.ctx.strokeStyle = '#333';
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
      
      // Draw letter
      this.ctx.fillStyle = '#333';
      this.ctx.font = 'bold 20px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(upgrade.type[0], centerX, centerY);
    }
  },
  
  drawBombs(bombs) {
    for (const bomb of bombs) {
      const centerX = bomb.x * this.tileSize + this.tileSize / 2;
      const centerY = bomb.y * this.tileSize + this.tileSize / 2;
      const radius = this.tileSize / 3;
      
      // Pulsing effect based on timer
      const pulseScale = 1 + Math.sin(Date.now() / 200) * 0.1;
      
      // Draw bomb
      this.ctx.fillStyle = this.colors.BOMB;
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius * pulseScale, 0, Math.PI * 2);
      this.ctx.fill();
      
      // Draw fuse
      this.ctx.strokeStyle = '#000';
      this.ctx.lineWidth = 3;
      this.ctx.beginPath();
      this.ctx.moveTo(centerX, centerY - radius * pulseScale);
      this.ctx.lineTo(centerX, centerY - radius * pulseScale - 10);
      this.ctx.stroke();
      
      // Draw timer
      this.ctx.fillStyle = '#fff';
      this.ctx.font = 'bold 16px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'middle';
      this.ctx.fillText(Math.ceil(bomb.timer / 1000), centerX, centerY);
    }
  },
  
  drawExplosions(explosions) {
    const now = Date.now();
    const defaultPropDelay = 20; // Fallback if not provided
    
    for (const explosion of explosions) {
      const age = now - explosion.timestamp;
      const propDelay = explosion.propagationDelay || defaultPropDelay;
      
      for (const tile of explosion.tiles) {
        const distance = tile.distance || 0;
        const tileActivationTime = distance * propDelay;
        
        // Skip tiles that haven't been reached yet
        if (age < tileActivationTime) continue;
        
        // Calculate tile-specific age (time since THIS tile was reached)
        const tileAge = age - tileActivationTime;
        const tileDuration = explosion.duration - tileActivationTime;
        
        // Alpha based on how long this tile has been active
        const alpha = Math.max(0, 1 - (tileAge / tileDuration));
        if (alpha <= 0) continue;
        
        // Expansion animation for newly activated tiles
        const expansionDuration = 50; // ms for tile to fully expand
        const expansion = Math.min(1, tileAge / expansionDuration);
        const size = this.tileSize * expansion;
        const offset = (this.tileSize - size) / 2;
        
        // Draw explosion tile with gradient
        const centerX = tile.x * this.tileSize + this.tileSize / 2;
        const centerY = tile.y * this.tileSize + this.tileSize / 2;
        
        // Outer glow
        const gradient = this.ctx.createRadialGradient(
          centerX, centerY, 0,
          centerX, centerY, size / 2
        );
        gradient.addColorStop(0, `rgba(255, 255, 200, ${alpha})`);
        gradient.addColorStop(0.3, `rgba(255, 200, 50, ${alpha})`);
        gradient.addColorStop(0.7, `rgba(255, 100, 0, ${alpha * 0.8})`);
        gradient.addColorStop(1, `rgba(200, 50, 0, ${alpha * 0.4})`);
        
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(
          tile.x * this.tileSize + offset,
          tile.y * this.tileSize + offset,
          size,
          size
        );
        
        // Center flash for recently activated tiles
        if (tileAge < 100) {
          const flashAlpha = (1 - tileAge / 100) * alpha;
          this.ctx.fillStyle = `rgba(255, 255, 255, ${flashAlpha})`;
          this.ctx.beginPath();
          this.ctx.arc(centerX, centerY, size / 4, 0, Math.PI * 2);
          this.ctx.fill();
        }
      }
    }
  },
  
  drawPlayers(players, currentPlayerId) {
    players.forEach((player, index) => {
      if (!player.alive) return;
      
      // Use predicted/interpolated position
      let pos = { x: player.x, y: player.y };
      if (typeof Prediction !== 'undefined') {
        pos = Prediction.getPlayerPosition(player, currentPlayerId);
      }
      
      // Players have fractional positions - multiply by tileSize directly
      const centerX = pos.x * this.tileSize;
      const centerY = pos.y * this.tileSize;
      const radius = this.tileSize / 3; // Smaller player size
      
      // Get player color
      const colorIndex = players.findIndex(p => p.id === player.id) % this.colors.PLAYER.length;
      const playerColor = this.colors.PLAYER[colorIndex];
      
      // Draw shadow
      this.ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      this.ctx.beginPath();
      this.ctx.ellipse(centerX, centerY + radius / 2, radius * 0.8, radius * 0.4, 0, 0, Math.PI * 2);
      this.ctx.fill();
      
      // Draw player body
      this.ctx.fillStyle = playerColor;
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      this.ctx.fill();
      
      // Draw border
      this.ctx.strokeStyle = player.id === currentPlayerId ? '#FFD700' : '#333';
      this.ctx.lineWidth = player.id === currentPlayerId ? 3 : 2;
      this.ctx.stroke();
      
      // Draw eyes
      this.ctx.fillStyle = '#fff';
      this.ctx.beginPath();
      this.ctx.arc(centerX - radius / 3, centerY - radius / 4, radius / 5, 0, Math.PI * 2);
      this.ctx.arc(centerX + radius / 3, centerY - radius / 4, radius / 5, 0, Math.PI * 2);
      this.ctx.fill();
      
      this.ctx.fillStyle = '#000';
      this.ctx.beginPath();
      this.ctx.arc(centerX - radius / 3, centerY - radius / 4, radius / 8, 0, Math.PI * 2);
      this.ctx.arc(centerX + radius / 3, centerY - radius / 4, radius / 8, 0, Math.PI * 2);
      this.ctx.fill();
      
      // Draw username below player
      this.ctx.fillStyle = '#333';
      this.ctx.font = 'bold 12px sans-serif';
      this.ctx.textAlign = 'center';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(player.username, centerX, centerY + radius + 5);
    });
  }
};


