package main

import (
    "encoding/base64"
    "encoding/json"
    "fmt"
    "log"
    "net/http"
    "os"
    "path/filepath"
    "strings"
    "sync"
    "time"
    "context"
    "os/signal"

    "github.com/gorilla/websocket"
)

// 首先声明类型
type RecentDisconnect struct {
    Username  string
    IP        string
    Timestamp time.Time
}

var (
    upgrader = websocket.Upgrader{
        CheckOrigin: func(r *http.Request) bool {
            return true
        },
    }

    clients    = make(map[*websocket.Conn]*Client)
    clientsMux sync.RWMutex
    broadcast  = make(chan Message)
    
    // 聊天记录
    chatHistory []Message
    historyMux sync.RWMutex

    // 存储最近断开的连接
    recentDisconnects = make(map[string]RecentDisconnect)
    recentMux        sync.RWMutex
)

type Client struct {
    Username string
    IP       string
    Conn     *websocket.Conn
    writeMux sync.Mutex
}

type Message struct {
    Type     string `json:"type"`    // "message", "image", "system"
    Username string `json:"username"`
    Content  string `json:"content"`
    Time     string `json:"time"`
}

// 添加新的消息类型
type UsersMessage struct {
    Type  string      `json:"type"`
    Users []UserInfo  `json:"users"`
}

// 添加新的 UserInfo 结构体
type UserInfo struct {
    Username string `json:"username"`
    IP       string `json:"ip"`
}

func main() {
    // 创建必要的目录
    for _, dir := range []string{"uploads", "data"} {
        if err := os.MkdirAll(dir, 0755); err != nil {
            log.Fatal("Failed to create directory:", dir, err)
        }
    }

    loadChatHistory()

    mux := http.NewServeMux()
    mux.HandleFunc("/ws", handleConnections)
    mux.Handle("/uploads/", http.StripPrefix("/uploads/", http.FileServer(http.Dir("uploads"))))
    mux.Handle("/", http.FileServer(http.Dir("static")))

    go handleMessages()

    port := "0.0.0.0:3000"
    server := &http.Server{
        Addr:              port,
        Handler:           mux,
        ReadTimeout:       10 * time.Minute,
        WriteTimeout:      10 * time.Minute,
        IdleTimeout:       10 * time.Minute,
        ReadHeaderTimeout: 5 * time.Second,
    }

    // 定期保存聊天记录
    go func() {
        ticker := time.NewTicker(5 * time.Minute)
        defer ticker.Stop()
        for range ticker.C {
            saveChatHistory()
        }
    }()

    log.Printf("Server starting at http://%s\n", port)

    go func() {
        if err := server.ListenAndServe(); err != http.ErrServerClosed {
            log.Fatal("Error starting server:", err)
        }
    }()

    sigChan := make(chan os.Signal, 1)
    signal.Notify(sigChan, os.Interrupt)
    <-sigChan

    saveChatHistory()

    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()
    if err := server.Shutdown(ctx); err != nil {
        log.Printf("Server shutdown error: %v\n", err)
    }
}

func handleConnections(w http.ResponseWriter, r *http.Request) {
    ws, err := upgrader.Upgrade(w, r, nil)
    if err != nil {
        log.Printf("Error upgrading connection: %v", err)
        return
    }
    
    // 获取用户的真实 IP 地址
    ip := r.Header.Get("X-Real-IP")
    if ip == "" {
        ip = r.Header.Get("X-Forwarded-For")
    }
    if ip == "" {
        ip = strings.Split(r.RemoteAddr, ":")[0]
    }

    // 使用 defer 确保连接最终会被关闭
    defer func() {
        ws.Close()
        clientsMux.Lock()
        if client, ok := clients[ws]; ok {
            delete(clients, ws)
            
            // 记录断开连接的信息
            recentMux.Lock()
            recentDisconnects[ip] = RecentDisconnect{
                Username:  client.Username,
                IP:       ip,
                Timestamp: time.Now(),
            }
            recentMux.Unlock()

            // 延迟发送退出消息，给重连留出时间
            go func(username, ip string) {
                time.Sleep(2 * time.Second) // 等待2秒，给重连留出时间
                
                // 检查是否已经重连
                clientsMux.RLock()
                reconnected := false
                for _, c := range clients {
                    if c.IP == ip {
                        reconnected = true
                        break
                    }
                }
                clientsMux.RUnlock()

                // 如果没有重连，才发送退出消息
                if !reconnected {
                    systemMsg := Message{
                        Type:     "system",
                        Username: "System",
                        Content:  fmt.Sprintf("%s 离开了聊天室", username),
                        Time:     time.Now().Format("15:04:05"),
                    }
                    broadcast <- systemMsg
                    addToHistory(systemMsg)
                }
            }(client.Username, ip)
        }
        clientsMux.Unlock()
        broadcastUserList()
    }()

    client := &Client{
        Conn: ws,
        IP:   ip,
    }

    // 设置读取超时
    ws.SetReadDeadline(time.Now().Add(10 * time.Minute))

    var msg Message
    if err := ws.ReadJSON(&msg); err != nil {
        log.Printf("Error reading username: %v", err)
        return
    }
    client.Username = msg.Username

    // 检查是否是最近断开连接的用户重连
    recentMux.RLock()
    recent, isRecent := recentDisconnects[ip]
    recentMux.RUnlock()

    isReconnect := isRecent && recent.Username == msg.Username && 
                  time.Since(recent.Timestamp) < 5*time.Second

    // 检查是否存在相同 IP 的旧连接
    clientsMux.Lock()
    for oldWs, oldClient := range clients {
        if oldClient.IP == ip && oldWs != ws {
            oldWs.Close()
            delete(clients, oldWs)
            break
        }
    }
    clients[ws] = client
    clientsMux.Unlock()

    // 发送历史消息
    historyMux.RLock()
    for _, msg := range chatHistory {
        client.writeMux.Lock()
        err := ws.WriteJSON(msg)
        client.writeMux.Unlock()
        if err != nil {
            log.Printf("Error sending history: %v", err)
            break
        }
    }
    historyMux.RUnlock()

    // 只有在不是重连的情况下才发送加入消息
    if !isReconnect {
        systemMsg := Message{
            Type:     "system",
            Username: "System",
            Content:  fmt.Sprintf("%s 加入了聊天室", client.Username),
            Time:     time.Now().Format("15:04:05"),
        }
        broadcast <- systemMsg
        addToHistory(systemMsg)
    }

    // 清理旧的断开连接记录
    if isRecent {
        recentMux.Lock()
        delete(recentDisconnects, ip)
        recentMux.Unlock()
    }

    // 在用户加入后广播用户列表
    broadcastUserList()

    // 设置 ping handler
    ws.SetPingHandler(func(string) error {
        ws.SetReadDeadline(time.Now().Add(10 * time.Minute))
        return nil
    })

    for {
        // 重置读取超时为10分钟
        ws.SetReadDeadline(time.Now().Add(10 * time.Minute))
        
        var msg Message
        if err := ws.ReadJSON(&msg); err != nil {
            if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
                log.Printf("Error reading message: %v", err)
            }
            return
        }

        msg.Time = time.Now().Format("15:04:05")

        if msg.Type == "image" {
            imageData := msg.Content
            if idx := strings.Index(imageData, "base64,"); idx != -1 {
                imageData = imageData[idx+7:]
            }
            
            decoded, err := base64.StdEncoding.DecodeString(imageData)
            if err != nil {
                log.Printf("Error decoding image: %v", err)
                continue
            }

            filename := fmt.Sprintf("%d_%s.jpg", time.Now().UnixNano(), client.Username)
            filepath := filepath.Join("uploads", filename)

            if err := os.WriteFile(filepath, decoded, 0644); err != nil {
                log.Printf("Error saving image: %v", err)
                continue
            }

            msg.Content = "/uploads/" + filename
        }

        addToHistory(msg)
        broadcast <- msg
    }
}

func handleMessages() {
    for {
        msg := <-broadcast
        clientsMux.RLock()
        for client := range clients {
            // 对于系统消息和图片消息，发送给所有人
            // 对于普通消息，不发送给发送者自己
            if msg.Type != "message" || clients[client].Username != msg.Username {
                // 使用写锁保护写操作
                clients[client].writeMux.Lock()
                err := clients[client].Conn.WriteJSON(msg)
                clients[client].writeMux.Unlock()
                
                if err != nil {
                    log.Printf("Error broadcasting message: %v", err)
                    client.Close()
                    clientsMux.RUnlock()
                    clientsMux.Lock()
                    delete(clients, client)
                    clientsMux.Unlock()
                    clientsMux.RLock()
                }
            }
        }
        clientsMux.RUnlock()
    }
}

func addToHistory(msg Message) {
    historyMux.Lock()
    chatHistory = append(chatHistory, msg)
    historyMux.Unlock()
}

func saveChatHistory() {
    historyMux.RLock()
    data, err := json.Marshal(chatHistory)
    historyMux.RUnlock()
    
    if err != nil {
        log.Printf("Error marshaling chat history: %v", err)
        return
    }

    err = os.WriteFile("data/chat_history.json", data, 0644)
    if err != nil {
        log.Printf("Error saving chat history: %v", err)
    }
}

func loadChatHistory() {
    data, err := os.ReadFile("data/chat_history.json")
    if err != nil {
        if !os.IsNotExist(err) {
            log.Printf("Error reading chat history: %v", err)
        }
        return
    }

    historyMux.Lock()
    err = json.Unmarshal(data, &chatHistory)
    historyMux.Unlock()
    
    if err != nil {
        log.Printf("Error unmarshaling chat history: %v", err)
    }
}

// 修改 broadcastUserList 函数
func broadcastUserList() {
    // 使用 map 来保存每个 IP 的最新用户信息
    ipMap := make(map[string]UserInfo)
    
    clientsMux.RLock()
    for _, client := range clients {
        ipMap[client.IP] = UserInfo{
            Username: client.Username,
            IP:      client.IP,
        }
    }
    clientsMux.RUnlock()

    // 将 map 转换为切片
    var users []UserInfo
    for _, userInfo := range ipMap {
        users = append(users, userInfo)
    }

    userMsg := UsersMessage{
        Type:  "users",
        Users: users,
    }

    clientsMux.RLock()
    for client := range clients {
        clients[client].writeMux.Lock()
        err := clients[client].Conn.WriteJSON(userMsg)
        clients[client].writeMux.Unlock()
        
        if err != nil {
            log.Printf("Error broadcasting user list: %v", err)
        }
    }
    clientsMux.RUnlock()
}

// 添加一个清理过期断开连接记录的 goroutine
func init() {
    go func() {
        ticker := time.NewTicker(1 * time.Minute)
        defer ticker.Stop()
        for range ticker.C {
            now := time.Now()
            recentMux.Lock()
            for ip, disconnect := range recentDisconnects {
                if now.Sub(disconnect.Timestamp) > 5*time.Second {
                    delete(recentDisconnects, ip)
                }
            }
            recentMux.Unlock()
        }
    }()
}