// Keyboard input handler

const Input = {
  keys: {},
  lastMoveTime: 0,
  moveDelay: 100, // ms between move updates
  lastBombTime: 0,
  bombDelay: 200, // ms between bomb placements
  lastDirection: null, // Track last sent direction
  
  init() {
    document.addEventListener('keydown', (e) => {
      // Prevent default for game controls
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'].includes(e.key)) {
        e.preventDefault();
      }
      this.keys[e.key] = true;
    });
    
    document.addEventListener('keyup', (e) => {
      this.keys[e.key] = false;
    });
    
    // Start continuous input polling
    this.startPolling();
  },
  
  startPolling() {
    setInterval(() => {
      this.pollInput();
    }, 16); // ~60 FPS polling
  },
  
  pollInput() {
    // Only process input if game is active
    if (!client.gameState || client.gameState.gameOver) return;
    
    const now = Date.now();
    
    // Handle movement continuously - support diagonal movement
    const up = this.keys['ArrowUp'] || this.keys['w'] || this.keys['W'];
    const down = this.keys['ArrowDown'] || this.keys['s'] || this.keys['S'];
    const left = this.keys['ArrowLeft'] || this.keys['a'] || this.keys['A'];
    const right = this.keys['ArrowRight'] || this.keys['d'] || this.keys['D'];
    
    // Calculate direction vector
    let vx = 0;
    let vy = 0;
    
    if (up) vy -= 1;
    if (down) vy += 1;
    if (left) vx -= 1;
    if (right) vx += 1;
    
    // Determine direction string for tracking
    let direction = `${vx},${vy}`; // e.g., "0,-1" for up, "-1,-1" for up-left, "0,0" for stop
    
    // Send movement update if direction changed or periodically
    if (direction !== this.lastDirection || now - this.lastMoveTime > this.moveDelay) {
      // Send the raw velocity vector - server will handle diagonal movement
      client.sendPlayerAction({
        type: 'MOVE',
        vx: vx,
        vy: vy
      });
      this.lastDirection = direction;
      this.lastMoveTime = now;
    }
    
    // Handle bomb placement (space bar)
    if (this.keys[' '] && now - this.lastBombTime > this.bombDelay) {
      client.sendPlayerAction({
        type: 'PLACE_BOMB'
      });
      this.lastBombTime = now;
    }
  }
};

// Initialize input handling when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => Input.init());
} else {
  Input.init();
}


