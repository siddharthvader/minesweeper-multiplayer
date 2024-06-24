const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const cors = require('cors');
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});
app.use(cors({
    origin: 'http://localhost:3000' // Allow only your frontend origin
  }));

// In-memory storage for games
const games = new Map();

function createGrid(rows, cols, mines) {
  let grid = Array(rows).fill().map(() => Array(cols).fill().map(() => ({
    value: 0,
    revealed: false,
    flagged: false,
    revealedBy: null,
    flaggedBy: null
  })));
  let minesPlaced = 0;

  while (minesPlaced < mines) {
    const row = Math.floor(Math.random() * rows);
    const col = Math.floor(Math.random() * cols);
    if (grid[row][col].value !== -1) {
      grid[row][col].value = -1;
      minesPlaced++;
    }
  }

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (grid[i][j].value !== -1) {
        grid[i][j].value = countAdjacentMines(grid, i, j);
      }
    }
  }

  return grid;
}

function countAdjacentMines(grid, row, col) {
  let count = 0;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;
      const newRow = row + i;
      const newCol = col + j;
      if (newRow >= 0 && newRow < grid.length && newCol >= 0 && newCol < grid[0].length) {
        if (grid[newRow][newCol].value === -1) count++;
      }
    }
  }
  return count;
}

function revealCell(game, row, col, playerId) {
  if (game.gameOver || game.win) return false;

  const cell = game.grid[row][col];
  if (cell.revealed || cell.flagged) return false;

  cell.revealed = true;
  cell.revealedBy = playerId;

  // Update player score
  const player = game.players.find(p => p.id === playerId);
  if (player) {
    player.score += 1;
  }

  if (cell.value === -1) {
    game.gameOver = true;
  } else if (cell.value === 0) {
    revealAdjacentCells(game, row, col, playerId);
  }

  game.win = checkWinCondition(game.grid);

  return true;
}

function revealAdjacentCells(game, row, col, playerId) {
  const grid = game.grid;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      const newRow = row + i;
      const newCol = col + j;
      if (newRow >= 0 && newRow < grid.length && newCol >= 0 && newCol < grid[0].length) {
        const cell = grid[newRow][newCol];
        if (!cell.revealed && !cell.flagged) {
          cell.revealed = true;
          cell.revealedBy = playerId;
          // Update player score for each revealed cell
          const player = game.players.find(p => p.id === playerId);
          if (player) {
            player.score += 1;
          }
          if (cell.value === 0) {
            revealAdjacentCells(game, newRow, newCol, playerId);
          }
        }
      }
    }
  }
}

function toggleFlag(game, row, col, playerId) {
  if (game.gameOver || game.win) return false;

  const cell = game.grid[row][col];
  if (!cell.revealed) {
    cell.flagged = !cell.flagged;
    cell.flaggedBy = cell.flagged ? playerId : null;
    return true;
  }
  return false;
}

function checkWinCondition(grid) {
  return grid.every(row =>
    row.every(cell => cell.revealed || cell.value === -1)
  );
}

function sanitizeGameState(game) {
    return {
      id: game.id,
      grid: game.grid.map(row => 
        row.map(cell => ({
          value: cell.value,
          revealed: cell.revealed,
          flagged: cell.flagged,
          revealedBy: cell.revealedBy,
          flaggedBy: cell.flaggedBy
        }))
      ),
      players: game.players.map(player => ({
        id: player.id,
        name: player.name,
        score: player.score,
        color: player.color
      })),
      gameTime: game.gameTime,
      gameOver: game.gameOver,
      win: game.win
    };
  }

// New route to create a game
app.post('/create-game', (req, res) => {
    const gameId = uuidv4();
    const game = {
      id: gameId,
      grid: createGrid(10, 10, 10),
      players: [],
      gameTime: 0,
      gameOver: false,
      win: false
    };
    games.set(gameId, game);
    res.json({ gameId });
  });

  app.get('/games', (req, res) => {
    const gamesList = Array.from(games.values()).map(game => ({
      id: game.id,
      status: game.gameOver || game.win ? 'completed' : 'ongoing',
      players: game.players.length
    }));
    
    res.json(gamesList);
  });

  app.get('/game/:id', (req, res) => {
    const gameId = req.params.id;
    const game = games.get(gameId);
    if (game) {
      res.json(game);
    } else {
      res.status(404).json({ error: 'Game not found' });
    }
  });

io.on('connection', (socket) => {
  console.log('New client connected');

  socket.on('joinGame', ({ gameId, playerName }) => {
    let game = games.get(gameId);

    if (!game) {
      game = {
        id: gameId,
        grid: createGrid(10, 10, 10),
        players: [],
        gameTime: 0,
        gameOver: false,
        win: false
      };
      games.set(gameId, game);
    }

    const newPlayer = {
      id: socket.id,
      name: playerName,
      score: 0,
      color: `hsl(${Math.random() * 360}, 100%, 50%)`
    };

    game.players.push(newPlayer);
    console.log(game.players)

    socket.join(gameId);
    io.to(gameId).emit('gameState', sanitizeGameState(game));
    io.to(gameId).emit('playerJoined', newPlayer);

    // Start or resume game timer
    if (!game.timerInterval) {
      game.timerInterval = setInterval(() => {
        game.gameTime++;
        io.to(gameId).emit('updateTime', game.gameTime);
      }, 1000);
    }
  });

  socket.on('revealCell', ({ gameId, row, col }) => {
    const game = games.get(gameId);
    if (game && revealCell(game, row, col, socket.id)) {
      io.to(gameId).emit('gameState', sanitizeGameState(game));
  
      if (game.gameOver || game.win) {
        clearInterval(game.timerInterval);
        game.timerInterval = null;
      }
    }
  });

  socket.on('toggleFlag', ({ gameId, row, col }) => {
    const game = games.get(gameId);
    const playerId = socket.id;
    if (game && toggleFlag(game, row, col, playerId)) {
      io.to(gameId).emit('gameState', sanitizeGameState(game));
      // Emit a separate event for the flag toggle
      io.to(gameId).emit('flagToggled', { row, col, playerId });
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    // Find and remove the player from their game
    for (let [gameId, game] of games) {
      const playerIndex = game.players.findIndex(p => p.id === socket.id);
      if (playerIndex !== -1) {
        game.players.splice(playerIndex, 1);
        io.to(gameId).emit('playerLeft', socket.id);
        
        // If no players left, clear the game timer and mark the game as complete
        // if (game.players.length === 0) {
        //   clearInterval(game.timerInterval);
        //   game.timerInterval = null;
        //   game.gameOver = true; // Mark the game as complete
        // }
        io.to(gameId).emit('gameState', sanitizeGameState(game));
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));