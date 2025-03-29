let ws;
let username = '';
// 添加一个变量来保存上传提示消息的引用
let uploadingMessageElement = null;

// 检查是否已登录
function checkLogin() {
    const savedUsername = localStorage.getItem('chatUsername');
    if (savedUsername) {
        username = savedUsername;
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('chat-container').style.display = 'flex';
        document.getElementById('user-info').textContent = `当前用户: ${username}`;
        connectWebSocket();
        return true;
    }
    return false;
}

// 连接WebSocket服务器
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log('Connected to WebSocket server');
        ws.send(JSON.stringify({
            type: 'message',
            username: username,
            content: '',
            time: new Date().toLocaleTimeString()
        }));
        
        displayMessage({
            type: 'system',
            username: 'System',
            content: '已连接到聊天室',
            time: new Date().toLocaleTimeString()
        });
    };

    ws.onmessage = (event) => {
        console.log('Received message:', event.data);
        const message = JSON.parse(event.data);
        
        if (message.type === 'users') {
            // 处理在线用户列表更新
            updateOnlineUsers(message.users);
        } else {
            // 处理其他消息类型
            if (message.type === 'image' && message.username === username && uploadingMessageElement) {
                if (uploadingMessageElement.parentNode) {
                    uploadingMessageElement.parentNode.removeChild(uploadingMessageElement);
                }
                uploadingMessageElement = null;
            }
            displayMessage(message);
        }
    };

    ws.onclose = () => {
        console.log('Disconnected from WebSocket server');
        displayMessage({
            type: 'system',
            username: 'System',
            content: '与服务器断开连接，正在尝试重新连接...',
            time: new Date().toLocaleTimeString()
        });
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
}

// 登录处理
function login() {
    const usernameInput = document.getElementById('username');
    username = usernameInput.value.trim();
    
    if (username) {
        localStorage.setItem('chatUsername', username);
        document.getElementById('login-container').style.display = 'none';
        document.getElementById('chat-container').style.display = 'flex';
        document.getElementById('user-info').textContent = `当前用户: ${username}`;
        connectWebSocket();
    }
}

// 退出处理
function logout() {
    localStorage.removeItem('chatUsername');
    username = '';
    if (ws) {
        ws.close();
    }
    document.getElementById('chat-container').style.display = 'none';
    document.getElementById('login-container').style.display = 'flex';
    document.getElementById('username').value = '';
    document.getElementById('chat-messages').innerHTML = '';
}

// 发送消息
function sendMessage() {
    const messageInput = document.getElementById('message');
    const content = messageInput.value.trim();
    
    if (content && ws && ws.readyState === WebSocket.OPEN) {
        const message = {
            type: 'message',
            username: username,
            content: content,
            time: new Date().toLocaleTimeString()
        };
        
        ws.send(JSON.stringify(message));
        messageInput.value = '';
        
        // 立即显示自己的消息
        displayMessage(message);
    }
}

// 处理图片上传
function handleImageUpload(file) {
    if (file && file.type.startsWith('image/')) {
        console.log('Processing image:', file.name);
        
        // 保存上传提示消息的引用到全局变量
        uploadingMessageElement = displayMessage({
            type: 'system',
            username: 'System',
            content: '正在上传图片...',
            time: new Date().toLocaleTimeString()
        });
        
        const reader = new FileReader();
        reader.onload = function(e) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                const message = {
                    type: 'image',
                    username: username,
                    content: e.target.result,
                    time: new Date().toLocaleTimeString()
                };
                
                console.log('Sending image message');
                ws.send(JSON.stringify(message));
            }
        };
        reader.readAsDataURL(file);
    }
}

// 修改显示消息函数，返回消息元素
function displayMessage(msg) {
    // 只处理普通消息、系统消息（用户进入/退出）、图片消息和游戏结果消息
    if (msg.type !== 'message' && msg.type !== 'system' && msg.type !== 'image') {
        return;
    }

    // 如果是系统消息，检查是否包含"加入"或"离开"关键词
    if (msg.type === 'system') {
        if (!msg.content.includes('加入') && !msg.content.includes('离开')) {
            return; // 不显示其他类型的系统消息
        }
    }

    const messagesDiv = document.getElementById('chat-messages');
    const messageDiv = document.createElement('div');

    if (msg.type === 'system') {
        messageDiv.className = 'system-message';
        messageDiv.textContent = msg.content;
    } else {
        messageDiv.className = `message ${msg.username === username ? 'self' : ''}`;
        
        const contentElement = document.createElement('div');
        contentElement.className = 'message-content';
        
        if (msg.type === 'image') {
            const img = document.createElement('img');
            img.src = msg.content;
            img.alt = 'Shared image';
            img.onerror = () => {
                console.error('Image load failed:', msg.content);
                contentElement.textContent = '图片加载失败';
            };
            img.onload = () => {
                console.log('Image loaded successfully:', msg.content);
                messagesDiv.scrollTop = messagesDiv.scrollHeight;
            };
            contentElement.appendChild(img);
        } else {
            // 检查是否是游戏结果消息
            if (msg.content.includes('赢得了扫雷游戏') || msg.content.includes('输掉了扫雷游戏')) {
                contentElement.style.color = msg.content.includes('赢得了') ? '#4CAF50' : '#ff4444';
                contentElement.style.fontWeight = 'bold';
            }
            contentElement.textContent = msg.content;
        }
        
        const infoElement = document.createElement('div');
        infoElement.className = 'message-info';
        infoElement.textContent = `${msg.username} · ${msg.time}`;
        
        messageDiv.appendChild(contentElement);
        messageDiv.appendChild(infoElement);
    }

    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 修改更新在线用户列表的函数
function updateOnlineUsers(users) {
    const usersList = document.getElementById('users-list');
    const onlineCount = document.getElementById('online-count');
    
    usersList.innerHTML = '';
    onlineCount.textContent = users.length;
    
    users.forEach(user => {
        const userItem = document.createElement('div');
        userItem.className = `user-item ${user.username === username ? 'self' : ''}`;
        
        const status = document.createElement('span');
        status.className = 'user-status';
        
        const name = document.createElement('span');
        // 显示用户名和 IP 地址
        name.textContent = `${user.username} (${user.ip})`;
        
        userItem.appendChild(status);
        userItem.appendChild(name);
        usersList.appendChild(userItem);
    });
}

// 事件监听器设置
document.addEventListener('DOMContentLoaded', () => {
    // 检查是否已登录
    if (!checkLogin()) {
        document.getElementById('login-container').style.display = 'flex';
        document.getElementById('chat-container').style.display = 'none';
    }

    const imageUpload = document.getElementById('image-upload');
    if (imageUpload) {
        imageUpload.addEventListener('change', function(event) {
            const file = event.target.files[0];
            handleImageUpload(file);
            this.value = '';
        });
    }

    const messageInput = document.getElementById('message');
    if (messageInput) {
        messageInput.addEventListener('keypress', function(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });
    }
});