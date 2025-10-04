import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';

// Define the shape of a Tetris piece
type TetrominoShape = number[][];

// Tetromino shapes (I, O, T, S, Z, J, L)
const TETROMINOS: { [key: string]: TetrominoShape } = {
  I: [[1, 1, 1, 1]],
  O: [[1, 1], [1, 1]],
  T: [[0, 1, 0], [1, 1, 1]],
  S: [[0, 1, 1], [1, 1, 0]],
  Z: [[1, 1, 0], [0, 1, 1]],
  J: [[1, 0, 0], [1, 1, 1]],
  L: [[0, 0, 1], [1, 1, 1]]
};

// Game board dimensions
const BOARD_WIDTH = 10;
const BOARD_HEIGHT = 20;

function App() {
  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
  const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8000';
  // Game state
  const [board, setBoard] = useState<number[][]>(
    Array(BOARD_HEIGHT).fill(null).map(() => Array(BOARD_WIDTH).fill(0))
  );
  const [currentPiece, setCurrentPiece] = useState<TetrominoShape | null>(null);
  const [piecePosition, setPiecePosition] = useState({ x: 0, y: 0 });
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [gameStarted, setGameStarted] = useState(false);

  // Multiplayer state
  const [roomId, setRoomId] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [connected, setConnected] = useState(false);
  const [opponentBoard, setOpponentBoard] = useState<number[][]>(
    Array(BOARD_HEIGHT).fill(null).map(() => Array(BOARD_WIDTH).fill(0))
  );

  // WebSocket reference
  const ws = useRef<WebSocket | null>(null);

  // Get random tetromino piece
  const getRandomPiece = (): TetrominoShape => {
    const pieces = Object.values(TETROMINOS);
    return pieces[Math.floor(Math.random() * pieces.length)];
  };

  // Check if piece can move to a position
  const canMove = (piece: TetrominoShape, x: number, y: number): boolean => {
    for (let row = 0; row < piece.length; row++) {
      for (let col = 0; col < piece[row].length; col++) {
        if (piece[row][col]) {
          const newX = x + col;
          const newY = y + row;

          // Check boundaries
          if (newX < 0 || newX >= BOARD_WIDTH || newY >= BOARD_HEIGHT) {
            return false;
          }

          // Check collision with existing pieces
          if (newY >= 0 && board[newY][newX]) {
            return false;
          }
        }
      }
    }
    return true;
  };

  // Place piece on board
  const placePiece = useCallback(() => {
    if (!currentPiece) return;

    const newBoard = board.map(row => [...row]);

    // Add current piece to board
    for (let row = 0; row < currentPiece.length; row++) {
      for (let col = 0; col < currentPiece[row].length; col++) {
        if (currentPiece[row][col]) {
          const y = piecePosition.y + row;
          const x = piecePosition.x + col;
          if (y >= 0) {
            newBoard[y][x] = 1;
          }
        }
      }
    }

    // Check for completed lines
    let linesCleared = 0;
    for (let row = BOARD_HEIGHT - 1; row >= 0; row--) {
      if (newBoard[row].every(cell => cell === 1)) {
        newBoard.splice(row, 1); // Remove completed line
        newBoard.unshift(Array(BOARD_WIDTH).fill(0)); // Add empty line at top
        linesCleared++;
        row++; // Check same row again
      }
    }

    // Update score
    if (linesCleared > 0) {
      setScore(prev => prev + linesCleared * 100);
    }

    setBoard(newBoard);

    // Spawn new piece
    const newPiece = getRandomPiece();
    const startX = Math.floor(BOARD_WIDTH / 2) - Math.floor(newPiece[0].length / 2);

    // Check if new piece can spawn (game over check)
    if (!canMove(newPiece, startX, 0)) {
      setGameOver(true);
      // Send game over to opponent
      if (ws.current && connected) {
        ws.current.send(JSON.stringify({
          type: 'game_over',
          score: score
        }));
      }
      return;
    }

    setCurrentPiece(newPiece);
    setPiecePosition({ x: startX, y: 0 });

    // Send updated board to opponent
    if (ws.current && connected) {
      ws.current.send(JSON.stringify({
        type: 'game_state',
        state: { board: newBoard, score }
      }));
    }
  }, [currentPiece, piecePosition, board, score, connected]);

  // Move piece down
  const moveDown = useCallback(() => {
    if (!currentPiece || gameOver) return;

    const newY = piecePosition.y + 1;

    if (canMove(currentPiece, piecePosition.x, newY)) {
      setPiecePosition({ ...piecePosition, y: newY });
    } else {
      // Piece can't move down, place it
      placePiece();
    }
  }, [currentPiece, piecePosition, gameOver, canMove, placePiece]);

  // Handle keyboard controls
  const handleKeyPress = useCallback((e: KeyboardEvent) => {
    if (!currentPiece || gameOver) return;

    switch (e.key) {
      case 'ArrowLeft':
        // Move left
        if (canMove(currentPiece, piecePosition.x - 1, piecePosition.y)) {
          setPiecePosition({ ...piecePosition, x: piecePosition.x - 1 });
        }
        break;
      case 'ArrowRight':
        // Move right
        if (canMove(currentPiece, piecePosition.x + 1, piecePosition.y)) {
          setPiecePosition({ ...piecePosition, x: piecePosition.x + 1 });
        }
        break;
      case 'ArrowDown':
        // Move down faster
        moveDown();
        break;
      case 'ArrowUp':
        // Rotate piece (simplified - just for demo)
        const rotated = currentPiece[0].map((_, i) =>
          currentPiece.map(row => row[i]).reverse()
        );
        if (canMove(rotated, piecePosition.x, piecePosition.y)) {
          setCurrentPiece(rotated);
        }
        break;
    }
  }, [currentPiece, piecePosition, gameOver, canMove, moveDown]);

  // Set up keyboard listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  // Game loop - piece falls automatically
  useEffect(() => {
    if (!gameStarted || gameOver) return;

    const interval = setInterval(() => {
      moveDown();
    }, 500); // Piece moves down every 500ms

    return () => clearInterval(interval);
  }, [gameStarted, gameOver, moveDown]);

  // Create room and connect to WebSocket
  const createRoom = async () => {
    try {
      const response = await fetch(`${API_URL}/create-room`, {  // ← Use API_URL
        method: 'POST'
      });
      const data = await response.json();
      const newRoomId = data.room_id;
      setRoomId(newRoomId);
      connectWebSocket(newRoomId);
    } catch (error) {
      console.error('Failed to create room:', error);
    }
  };

  // Join existing room
  const joinRoom = (roomIdInput: string) => {
    setRoomId(roomIdInput);
    connectWebSocket(roomIdInput);
  };

  // Connect to WebSocket
  const connectWebSocket = (roomId: string) => {
    // Create WebSocket connection

    ws.current = new WebSocket(`${WS_URL}/ws/${roomId}`);

    // Connection opened
    ws.current.onopen = () => {
      console.log('Connected to room:', roomId);
      setConnected(true);
    };

    // Listen for messages
    ws.current.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'player_id') {
        // Received our player ID
        setPlayerId(message.player_id);
      } else if (message.type === 'player_joined') {
        console.log('Player joined:', message.player_id);
      } else if (message.type === 'opponent_state') {
        // Received opponent's game state
        setOpponentBoard(message.state.board);
      } else if (message.type === 'player_game_over') {
        console.log('Opponent game over. Score:', message.score);
      }
    };

    // Connection closed
    ws.current.onclose = () => {
      console.log('Disconnected from room');
      setConnected(false);
    };
  };

  // Start game
  const startGame = () => {
    // Reset game state
    setBoard(Array(BOARD_HEIGHT).fill(null).map(() => Array(BOARD_WIDTH).fill(0)));
    setScore(0);
    setGameOver(false);

    // Spawn first piece
    const firstPiece = getRandomPiece();
    setCurrentPiece(firstPiece);
    setPiecePosition({
      x: Math.floor(BOARD_WIDTH / 2) - Math.floor(firstPiece[0].length / 2),
      y: 0
    });

    setGameStarted(true);
  };

  // Render board with current piece
  const renderBoard = (boardData: number[][], isOpponent = false) => {
    const displayBoard = boardData.map(row => [...row]);

    // Add current piece to display (only for our board)
    if (!isOpponent && currentPiece) {
      for (let row = 0; row < currentPiece.length; row++) {
        for (let col = 0; col < currentPiece[row].length; col++) {
          if (currentPiece[row][col]) {
            const y = piecePosition.y + row;
            const x = piecePosition.x + col;
            if (y >= 0 && y < BOARD_HEIGHT && x >= 0 && x < BOARD_WIDTH) {
              displayBoard[y][x] = 2; // Different color for current piece
            }
          }
        }
      }
    }

    return (
      <div className="board">
        {displayBoard.map((row, rowIndex) => (
          <div key={rowIndex} className="row">
            {row.map((cell, colIndex) => (
              <div
                key={colIndex}
                className={`cell ${cell === 1 ? 'filled' : ''} ${cell === 2 ? 'current' : ''}`}
              />
            ))}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="App">
      <h1>Multiplayer Tetris</h1>

      {!connected ? (
        <div className="lobby">
          <button onClick={createRoom}>Create Room</button>
          <div>
            <input
              type="text"
              placeholder="Enter Room ID"
              onChange={(e) => setRoomId(e.target.value)}
            />
            <button onClick={() => joinRoom(roomId)}>Join Room</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="room-info">
            <p>Room ID: {roomId} | Player ID: {playerId}</p>
            <p>Status: {connected ? 'Connected' : 'Disconnected'}</p>
          </div>

          {!gameStarted ? (
            <div className="lobby">
              <button onClick={startGame}>Start Game</button>
            </div>
          ) : (
            <div className="game-container">
              <div className="player-board">
                <h3>Your Board</h3>
                <p>Score: {score}</p>
                {renderBoard(board)}
                {gameOver && <div className="game-over">Game Over!</div>}
              </div>

              <div className="opponent-board">
                <h3>Opponent's Board</h3>
                {renderBoard(opponentBoard, true)}
              </div>
            </div>
          )}

          <div className="controls">
            <p>Controls: Arrow Keys (Left/Right to move, Up to rotate, Down to drop faster)</p>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;