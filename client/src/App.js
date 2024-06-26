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
      setGameState(prevState => ({
        ...prevState,
        players: [...prevState.players, newPlayer]
      }));
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
      const createResponse = await fetch('http://localhost:3001/create-game', { method: 'POST' });
      const createData = await createResponse.json();
      const newGameId = createData.gameId;
      
      setGameId(newGameId);
      window.history.pushState({}, '', `?gameId=${newGameId}`);
      
      const randomPlayerName = `Player ${Math.floor(Math.random() * 1000)}`;
      setPlayerName(randomPlayerName);
      
      const fetchResponse = await fetch(`http://localhost:3001/game/${newGameId}`);
      if (fetchResponse.ok) {
        const gameData = await fetchResponse.json();
        joinGame(newGameId, randomPlayerName);
        setGameState(gameData);
        setGameTime(gameData.gameTime);
        toast.success('Game created successfully!');
      } else {
        throw new Error('Failed to fetch the newly created game');
      }
    } catch (error) {
      console.error('Error in createGame function:', error);
      toast.error('Failed to create game. Please try again.');
    } finally {
      setIsCreatingGame(false);
    }
  }, []);

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

  const handleCellRightClick = (e, row, col) => {
    e.preventDefault();
    socket.emit('toggleFlag', { gameId, row, col });
  };

  if (!gameState) {
    return (
      <div className="flex flex-col items-center space-y-4 p-4">
        <h1 className="text-2xl font-bold">Minesweeper</h1>
        {!gameId ? (
          <Button 
            onClick={() => {
              console.log('Create Game button clicked');
              createGame();
            }} 
            disabled={isCreatingGame}
          >
            {isCreatingGame ? 'Creating Game...' : 'Create New Game'}
          </Button>
        ) : (
          <>
            <Input
              type="text"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Enter your name"
              className="w-64 mb-2"
            />
            <Button onClick={joinGame}>Join Game</Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center space-y-4 p-4">
      <h1 className="text-2xl font-bold">Multiplayer Minesweeper</h1>
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
        <Button onClick={createGame} className="mt-4">
          Create New Game
        </Button>
      )}
    </div>
  );
};

export default Minesweeper;