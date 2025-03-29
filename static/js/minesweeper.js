class Minesweeper {
    constructor() {
        this.size = 10;
        this.mines = 10;
        this.grid = [];
        this.revealed = new Set();
        this.flagged = new Set();
        this.gameOver = false;
        this.startTime = null;
        this.timerInterval = null;
        this.init();
    }

    init() {
        // 初始化网格
        this.grid = Array(this.size).fill().map(() => Array(this.size).fill(0));
        this.revealed.clear();
        this.flagged.clear();
        this.gameOver = false;
        this.startTime = null;
        
        // 随机放置地雷
        let minesPlaced = 0;
        while (minesPlaced < this.mines) {
            const x = Math.floor(Math.random() * this.size);
            const y = Math.floor(Math.random() * this.size);
            if (this.grid[y][x] !== -1) {
                this.grid[y][x] = -1;
                minesPlaced++;
            }
        }

        // 计算数字
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                if (this.grid[y][x] === -1) continue;
                let count = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const ny = y + dy;
                        const nx = x + dx;
                        if (ny >= 0 && ny < this.size && nx >= 0 && nx < this.size) {
                            if (this.grid[ny][nx] === -1) count++;
                        }
                    }
                }
                this.grid[y][x] = count;
            }
        }

        this.render();
        this.updateMineCount();
        this.startTimer();
    }

    startTimer() {
        if (this.timerInterval) clearInterval(this.timerInterval);
        this.startTime = Date.now();
        const timerElement = document.getElementById('timer');
        this.timerInterval = setInterval(() => {
            const seconds = Math.floor((Date.now() - this.startTime) / 1000);
            timerElement.textContent = `⏱️ ${seconds}`;
        }, 1000);
    }

    updateMineCount() {
        const remaining = this.mines - this.flagged.size;
        document.getElementById('mine-count').textContent = `💣 ${remaining}`;
    }

    reveal(x, y) {
        if (this.gameOver || this.flagged.has(`${x},${y}`)) return;
        if (!this.startTime) this.startTimer();

        const key = `${x},${y}`;
        if (this.revealed.has(key)) return;

        this.revealed.add(key);
        const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
        cell.classList.add('revealed');

        if (this.grid[y][x] === -1) {
            this.gameOver = true;
            this.revealAll();
            clearInterval(this.timerInterval);
            const time = Math.floor((Date.now() - this.startTime) / 1000);
            // 发送游戏失败消息
            sendGameResult(false, time);
            setTimeout(() => alert('游戏结束！'), 100);
            return;
        }

        if (this.grid[y][x] === 0) {
            // 展开空白区域
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const ny = y + dy;
                    const nx = x + dx;
                    if (ny >= 0 && ny < this.size && nx >= 0 && nx < this.size) {
                        this.reveal(nx, ny);
                    }
                }
            }
        } else {
            cell.textContent = this.grid[y][x];
            cell.dataset.number = this.grid[y][x];
        }

        // 检查胜利
        if (this.checkWin()) {
            this.gameOver = true;
            clearInterval(this.timerInterval);
            const time = Math.floor((Date.now() - this.startTime) / 1000);
            // 发送游戏胜利消息
            sendGameResult(true, time);
            setTimeout(() => alert('恭喜你赢了！'), 100);
        }
    }

    toggleFlag(x, y) {
        if (this.gameOver || this.revealed.has(`${x},${y}`)) return;

        const key = `${x},${y}`;
        const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);

        if (this.flagged.has(key)) {
            this.flagged.delete(key);
            cell.classList.remove('flagged');
            cell.textContent = '';
        } else {
            this.flagged.add(key);
            cell.classList.add('flagged');
            cell.textContent = '🚩';
        }

        this.updateMineCount();
    }

    revealAll() {
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const cell = document.querySelector(`[data-x="${x}"][data-y="${y}"]`);
                cell.classList.add('revealed');
                if (this.grid[y][x] === -1) {
                    cell.classList.add('mine');
                    cell.textContent = '💣';
                } else if (this.grid[y][x] > 0) {
                    cell.textContent = this.grid[y][x];
                    cell.dataset.number = this.grid[y][x];
                }
            }
        }
    }

    checkWin() {
        const totalCells = this.size * this.size;
        return this.revealed.size === totalCells - this.mines;
    }

    render() {
        const grid = document.getElementById('minesweeper-grid');
        grid.innerHTML = '';
        
        for (let y = 0; y < this.size; y++) {
            for (let x = 0; x < this.size; x++) {
                const cell = document.createElement('div');
                cell.className = 'cell';
                cell.dataset.x = x;
                cell.dataset.y = y;
                
                cell.addEventListener('click', () => this.reveal(x, y));
                cell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    this.toggleFlag(x, y);
                });
                
                grid.appendChild(cell);
            }
        }
    }
}

let game = null;

function toggleMinesweeper() {
    const container = document.getElementById('minesweeper-container');
    if (container.style.display === 'none') {
        container.style.display = 'block';
        game = new Minesweeper();
    } else {
        container.style.display = 'none';
        if (game && game.timerInterval) {
            clearInterval(game.timerInterval);
        }
    }
}

function sendGameResult(won, time) {
    const msg = {
        type: 'message',
        username: username,
        content: `${username} ${won ? '🎉 成功排除了所有地雷！用时' : '💥 踩到地雷了，坚持了'} ${time} 秒`,
        time: new Date().toLocaleTimeString()
    };
    ws.send(JSON.stringify(msg));
} 