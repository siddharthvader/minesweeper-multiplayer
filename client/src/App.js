import React, { useState, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { toast } from 'react-hot-toast';

const socket = io('http://localhost:3001');

const Cell = ({ value, revealed, flagged, onClick, onContextMenu, revealedBy, flaggedBy, playerColors }) => {
  const borderStyle = revealedBy ? { borderColor: playerColors[revealedBy], borderWidth: '2px' } 
                    : flaggedBy ? { borderColor: playerColors[flaggedBy], borderWidth: '2px' }
                    : {};

  return (
    <button
      className={`w-8 h-8 border border-gray-400 flex items-center justify-center font-bold ${
        revealed ? 'bg-gray-200' : 'bg-gray-100 hover:bg-gray-300'
      }`}
      style={borderStyle}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {revealed
        ? value === -1
          ? '💣'
          : value > 0
          ? value
          : ''
        : flagged
        ? '🚩'
        : ''}
    </button>
  );
};

const PlayerScore = ({ player }) => (
  <Card className="w-48">
    <CardHeader>
      <CardTitle style={{ color: player.color }}>{player.name}</CardTitle>
    </CardHeader>
    <CardContent>
      <p>Score: {player.score}</p>
    </CardContent>
  </Card>
);

const Minesweeper = () => {
  const [gameState, setGameState] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [gameId, setGameId] = useState('');
  const [gameTime, setGameTime] = useState(0);
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [playerColors, setPlayerColors] = useState({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Check for gameId in URL
    const urlParams = new URLSearchParams(window.location.search);
    const urlGameId = urlParams.get('gameId');
    if (urlGameId) {
      setGameId(urlGameId);
    }

    socket.on('gameState', (newGameState) => {
      setGameState(newGameState);
      setGameTime(newGameState.gameTime);
      // Update player colors mapping
      const colorMap = {};
      newGameState.players.forEach(player => {
        colorMap[player.id] = player.color;
      });
      setPlayerColors(colorMap);
    });


    socket.on('playerJoined', (newPlayer) => {
      setGameState(prevState => {
        // Check if the player already exists
        if (prevState.players.some(player => player.id === newPlayer.id)) {
          return prevState; // Don't add if the player already exists
        }
        return {
          ...prevState,
          players: [...prevState.players, newPlayer]
        };
      });
    });

    socket.on('playerLeft', (playerId) => {
      setGameState(prevState => ({
        ...prevState,
        players: prevState.players.filter(p => p.id !== playerId)
      }));
    });

    socket.on('updateTime', (time) => {
      setGameTime(time);
    });

    return () => {
      socket.off('gameState');
      socket.off('playerJoined');
      socket.off('playerLeft');
      socket.off('updateTime');
    };
  }, []);

  const createGame = useCallback(async () => {
    try {
      setIsCreatingGame(true);
      let newGameId;
      let endpoint;
      let method;
      let newGame;

      if (gameId) {
        // Use update-game endpoint if gameId exists
        endpoint = `http://localhost:3001/update-game/${gameId}`;
        method = 'POST';
        newGameId = gameId;
        newGame = false;
      } else {
        // Use create-game endpoint if no gameId
        endpoint = 'http://localhost:3001/create-game';
        method = 'POST';
        newGame = true;
      }

      const response = await fetch(endpoint, { method });
      const data = await response.json();
      newGameId = newGameId || data.gameId;
      
      setGameId(newGameId);
      window.history.pushState({}, '', `?gameId=${newGameId}`);

      const randomPlayerName = playerName || `Player ${Math.floor(Math.random() * 1000)}`;
      setPlayerName(randomPlayerName);
      
      const fetchResponse = await fetch(`http://localhost:3001/game/${newGameId}`);
      if (fetchResponse.ok) {
        const gameData = await fetchResponse.json();
        if (newGame) {
          joinGame(newGameId, randomPlayerName);
        } else {
          // Emit a socket event to update the board for all players
          socket.emit('updateBoard', { gameId: newGameId, gameData });
        }
        setGameState(gameData);
        setGameTime(gameData.gameTime);
        toast.success(newGame ? 'Game created successfully!' : 'Game updated successfully!');
      } else {
        throw new Error('Failed to fetch the game data');
      }
    } catch (error) {
      console.error('Error in createGame function:', error);
      toast.error('Failed to create game. Please try again.');
    } finally {
      setIsCreatingGame(false);
    }
  }, [gameId, playerName]);

  const joinGame = useCallback((gameIdToJoin, playerNameToJoin) => {
    const idToUse = gameId || gameIdToJoin;
    const nameToUse = playerNameToJoin || playerName;

    if (nameToUse.trim() && idToUse) {
      socket.emit('joinGame', { gameId: idToUse, playerName: nameToUse });
      toast.success('Joining game...');
    } else {
      toast.error('Please enter your name and game ID');
    }
  }, [gameId, playerName]);

  const handleCellClick = (row, col) => {
    socket.emit('revealCell', { gameId, row, col });
  };

  const handleChord = useCallback((row, col) => {
    const cell = gameState.grid[row][col];
    if (!cell.revealed || cell.value === 0) return;

    const adjacentFlags = countAdjacentFlags(row, col);
    if (adjacentFlags === cell.value) {
      const adjacentCells = getAdjacentCells(row, col);
      adjacentCells.forEach(([r, c]) => {
        if (!gameState.grid[r][c].flagged && !gameState.grid[r][c].revealed) {
          socket.emit('revealCell', { gameId, row: r, col: c });
        }
      });
    }
  }, [gameState, gameId]);

  const countAdjacentFlags = (row, col) => {
    let count = 0;
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = col - 1; c <= col + 1; c++) {
        if (r >= 0 && r < gameState.grid.length && c >= 0 && c < gameState.grid[0].length) {
          if (gameState.grid[r][c].flagged) count++;
        }
      }
    }
    return count;
  };

  const getAdjacentCells = (row, col) => {
    const adjacent = [];
    for (let r = row - 1; r <= row + 1; r++) {
      for (let c = col - 1; c <= col + 1; c++) {
        if (r >= 0 && r < gameState.grid.length && c >= 0 && c < gameState.grid[0].length) {
          if (r !== row || c !== col) {
            adjacent.push([r, c]);
          }
        }
      }
    }
    return adjacent;
  };

  const handleCellRightClick = (e, row, col) => {
    e.preventDefault();
    if (gameState.grid[row][col].revealed) {
      handleChord(row, col);
    } else {
      socket.emit('toggleFlag', { gameId, row, col });
    }
  };

  const copyLinkToClipboard = useCallback(() => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  if (!gameState) {
    return (
      <div className="flex flex-col items-center space-y-4 p-4">
        <h1 className="text-2xl font-bold">Minesweeper</h1>
        {!gameId ? (
          <>
            <Input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              className="w-64 mb-2"
            />
            <Button 
              onClick={() => {
                console.log('Create Game button clicked');
                createGame();
              }} 
              disabled={isCreatingGame}
              className="mt-4 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded shadow-md transition duration-300 ease-in-out transform hover:scale-105"
            >
              {isCreatingGame ? 'Creating Game...' : 'Create New Game'}            
            </Button>
          </>
        ) : (
          <>
            <Input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              className="w-64 mb-2"
            />
            <Button onClick={joinGame} className="mt-4 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded shadow-md transition duration-300 ease-in-out transform hover:scale-105">Join Game</Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center space-y-4 p-4">
      <h1 className="text-2xl font-bold">Bomb Squad 💣</h1>
      <h2 className="text-lg text-gray-600">Sweep mines with your friends!</h2>
      <div className="flex space-x-4">
        {gameState.players.map((player) => (
          <PlayerScore key={player.id} player={player} />
        ))}
      </div>
      <div className="text-xl">Time: {gameTime} seconds</div>
      <div className="grid gap-0.5 p-2 bg-gray-300">
        {gameState.grid.map((row, rowIndex) => (
          <div key={rowIndex} className="flex">
            {row.map((cell, colIndex) => (
              <Cell
                key={`${rowIndex}-${colIndex}`}
                value={cell.value}
                revealed={cell.revealed}
                flagged={cell.flagged}
                revealedBy={cell.revealedBy}
                flaggedBy={cell.flaggedBy}
                playerColors={playerColors}
                onClick={() => handleCellClick(rowIndex, colIndex)}
                onContextMenu={(e) => handleCellRightClick(e, rowIndex, colIndex)}
              />
            ))}
          </div>
        ))}
      </div>
      {gameState.gameOver && <div className="text-xl font-bold text-red-500">Game Over!</div>}
      {gameState.win && <div className="text-xl font-bold text-green-500">You Win!</div>}
      {(gameState.gameOver || gameState.win) && (
        <Button onClick={() => createGame(gameId)} className="mt-4 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded shadow-md transition duration-300 ease-in-out transform hover:scale-105">
          Create New Game
        </Button>        
      )}
      <Button 
        onClick={copyLinkToClipboard}
        className="mt-2 bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded shadow-md transition duration-300 ease-in-out transform hover:scale-105 flex items-center"
      >
        {copied ? (
          <>
            <span>Link Copied</span>
            <svg className="w-5 h-5 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </>
        ) : (
          'Copy Link'
        )}
      </Button>
    </div>
  );
};

export default Minesweeper;