# Bomberman Client

Web-based client interface for the Bomberman multiplayer game.

## Features

- **Clean UI**: Modern, responsive design with gradient backgrounds
- **Lobby browser**: View and join available games
- **Real-time gameplay**: Canvas-based rendering with smooth animations
- **Keyboard controls**: WASD/Arrow keys for movement, Space for bombs
- **Visual feedback**: Player stats, explosion effects, upgrade indicators

## Technology Stack

- **HTML5 Canvas**: Hardware-accelerated game rendering
- **Vanilla JavaScript**: No framework dependencies, lightweight
- **WebSocket**: Real-time communication with game server
- **CSS3**: Modern styling with gradients and animations
- **Nginx**: Efficient static file serving

## Project Structure

```
src/
├── index.html          # Main HTML with all screens
├── css/
│   └── style.css       # All styles
└── js/
    ├── main.js         # WebSocket client and state management
    ├── renderer.js     # Canvas rendering logic
    ├── input.js        # Keyboard input handling
    └── ui.js           # UI screen management
```

## Screens

1. **Connection Screen**: Enter username and connect to server
2. **Lobby Browser**: View available lobbies, create new games
3. **Lobby Room**: Wait for players, ready up, start game
4. **Game Screen**: Main gameplay with canvas and HUD
5. **Game Over**: Display winner and return to lobby

## Controls

- **Movement**: Arrow Keys or WASD
- **Place Bomb**: Spacebar

## Visual Design

### Color Scheme
- Primary: Purple gradient (`#667eea` → `#764ba2`)
- Players: Blue, Green, Purple, Yellow
- Walls: Dark grey (`#2c3e50`)
- Boxes: Brown (`#8b6f47`)
- Bombs: Red (`#e74c3c`)
- Explosions: Orange (`#ff9800`)

### Upgrades
- **Speed**: Green circle with 'S'
- **Bomb**: Magenta circle with 'B'
- **Range**: Yellow circle with 'R'

### Players
- Colored circles with eyes
- Current player has gold border
- Username displayed below
- Shadow for depth

## Configuration

The client automatically detects the WebSocket server:

- **Local development**: Connects to `ws://localhost:8080`
- **Production**: Connects to `wss://your-domain/ws` (via Ingress)

Edit `src/js/main.js` to change connection logic if needed.

## Development

Serve the files with any static file server:

```bash
# Python
python -m http.server 8080

# Node
npx serve src

# PHP
php -S localhost:8080 -t src
```

Then open `http://localhost:8080` in your browser.

## Building

```bash
# Build Docker image
docker build -t your-registry/bomberman-client:latest .

# Push to registry
docker push your-registry/bomberman-client:latest

# Deploy to Kubernetes
kubectl apply -f deployment.yaml
```

## Nginx Configuration

The included `nginx.conf`:

- Serves static files from `/usr/share/nginx/html`
- Listens on port 8080
- Proper MIME types for JS/CSS/HTML
- Cache control for assets

## Customization

### Change Colors

Edit `src/js/renderer.js`:

```javascript
colors: {
  PLAYER: ['#3498db', '#2ecc71', '#9b59b6', '#f1c40f'],
  BOMB: '#e74c3c',
  // ... etc
}
```

### Adjust Tile Size

Edit `src/js/renderer.js`:

```javascript
tileSize: 40, // pixels per tile
```

### Modify UI Styles

Edit `src/css/style.css` to change:
- Button styles
- Card layouts
- Colors and gradients
- Fonts and spacing

## Browser Support

- Chrome/Edge: ✅ Full support
- Firefox: ✅ Full support
- Safari: ✅ Full support
- Mobile browsers: ⚠️ Playable but keyboard needed

## Performance

- Canvas size adjusts to map dimensions
- Efficient rendering (60 FPS target)
- Minimal DOM manipulation
- No external dependencies to load

## License

ISC


