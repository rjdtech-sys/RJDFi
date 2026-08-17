import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';

interface ChatMessage {
  id: number;
  sender: string;
  recipient: string;
  message: string;
  timestamp: string;
  is_read: number;
}

interface ChatUser {
  mac: string;
  last_message: string;
  name?: string;
}

const ChatManager: React.FC = () => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [users, setUsers] = useState<ChatUser[]>([]);
  const [selectedUser, setSelectedUser] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [showBroadcast, setShowBroadcast] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      newSocket.emit('join_chat', { id: 'admin' });
      newSocket.emit('fetch_chat_users');
    });

    newSocket.on('chat_users', (data: ChatUser[]) => {
      setUsers(data);
    });

    newSocket.on('chat_history', (data: ChatMessage[]) => {
      setMessages(data);
    });

    newSocket.on('receive_message', (data: ChatMessage) => {
      newSocket.emit('fetch_chat_users');
      setMessages(prev => prev);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const selectedUserRef = useRef<string | null>(null);
  useEffect(() => {
    selectedUserRef.current = selectedUser;
    if (selectedUser && socket) {
      socket.emit('fetch_messages', { user_id: selectedUser });
    }
  }, [selectedUser, socket]);

  useEffect(() => {
    if (!socket) return;
    const handleMsg = (data: ChatMessage) => {
      const current = selectedUserRef.current;
      if (current && (
        data.sender === current ||
        data.recipient === current ||
        data.recipient === 'broadcast'
      )) {
        setMessages(prev => [...prev, data]);
      }
    };
    socket.on('receive_message', handleMsg);
    return () => {
      socket.off('receive_message', handleMsg);
    };
  }, [socket]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !selectedUser || !newMessage.trim()) return;
    socket.emit('send_message', {
      sender: 'admin',
      recipient: selectedUser,
      message: newMessage
    });
    setNewMessage('');
  };

  const handleBroadcast = (e: React.FormEvent) => {
    e.preventDefault();
    if (!socket || !broadcastMsg.trim()) return;
    socket.emit('send_message', {
      sender: 'admin',
      recipient: 'broadcast',
      message: broadcastMsg
    });
    setBroadcastMsg('');
    setShowBroadcast(false);
  };

  const handleSelectUser = (mac: string) => {
    setSelectedUser(mac);
    setMessages([]);
  };

  const handleBackToList = () => {
    setSelectedUser(null);
    setMessages([]);
    setNewMessage('');
  };

  return (
    <div className="flex flex-col sm:flex-row h-[calc(100vh-120px)] sm:h-[calc(100vh-100px)] bg-gray-100 rounded-xl overflow-hidden shadow-lg border border-gray-200">

      {/* ── Sidebar: Users List ── */}
      <div className={`${
        selectedUser ? 'hidden sm:flex' : 'flex'
      } w-full sm:w-80 lg:w-96 bg-white border-r border-gray-200 flex-col min-w-0`}>
        <div className="p-3 sm:p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center gap-2 flex-shrink-0">
          <h2 className="font-bold text-gray-700 text-sm sm:text-base truncate">Conversations</h2>
          <button
            onClick={() => setShowBroadcast(true)}
            className="px-3 py-1.5 bg-indigo-600 text-white text-[11px] font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow-sm whitespace-nowrap flex-shrink-0"
          >
            Broadcast
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {users.length === 0 ? (
            <div className="p-8 text-center text-gray-400 flex flex-col items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 mb-2 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
              </svg>
              <span className="text-sm">No chats yet</span>
            </div>
          ) : (
            users.map(user => (
              <div
                key={user.mac}
                onClick={() => handleSelectUser(user.mac)}
                className={`p-3 sm:p-4 border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors group ${
                  selectedUser === user.mac ? 'bg-indigo-50 border-l-4 border-l-indigo-600' : 'border-l-4 border-l-transparent'
                }`}
              >
                <div className={`text-sm font-medium truncate ${
                  selectedUser === user.mac ? 'text-indigo-700' : 'text-gray-800'
                }`}>
                  {user.name || user.mac}
                </div>
                {user.name && user.mac && (
                  <div className="text-[10px] text-gray-400 font-mono truncate mt-0.5">{user.mac}</div>
                )}
                <div className="flex justify-between items-center mt-1">
                  <span className="text-[11px] text-gray-500 group-hover:text-gray-600">
                    {(() => {
                      try {
                        const d = new Date(user.last_message);
                        const now = new Date();
                        if (d.toDateString() === now.toDateString()) {
                          return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        }
                        return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
                      } catch { return ''; }
                    })()}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Chat Area ── */}
      <div className={`${
        selectedUser ? 'flex' : 'hidden sm:flex'
      } flex-1 flex-col bg-gray-50 min-w-0`}>
        {selectedUser ? (
          <>
            {/* Chat Header */}
            <div className="p-3 sm:p-4 bg-white border-b border-gray-200 shadow-sm flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {/* Back button (mobile only) */}
              <button
                onClick={handleBackToList}
                className="sm:hidden p-1.5 -ml-1 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <h3 className="font-bold text-gray-800 text-sm sm:text-base flex items-center gap-2 min-w-0 truncate">
                <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0"></div>
                <span className="truncate">
                  Chat with <span className="font-mono text-indigo-600">{selectedUser}</span>
                </span>
              </h3>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3 bg-slate-50">
              {messages.length === 0 && (
                <div className="text-center text-gray-400 text-sm py-8">No messages yet. Say hello!</div>
              )}
              {messages.map((msg, idx) => {
                const isAdmin = msg.sender === 'admin';
                const isBroadcast = msg.recipient === 'broadcast';
                return (
                  <div key={idx} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] sm:max-w-[75%] rounded-2xl px-3 sm:px-4 py-2 shadow-sm text-sm ${
                      isAdmin
                        ? 'bg-indigo-600 text-white rounded-br-none'
                        : isBroadcast
                          ? 'bg-amber-100 text-amber-900 border border-amber-200 rounded-2xl'
                          : 'bg-white text-gray-800 border border-gray-200 rounded-bl-none'
                    }`}>
                      {isBroadcast && (
                        <div className="text-[10px] font-bold mb-1 text-amber-700 uppercase tracking-wide flex items-center gap-1">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                          </svg>
                          Broadcast
                        </div>
                      )}
                      <div className="break-words leading-relaxed">{msg.message}</div>
                      <div className={`text-[10px] mt-1 text-right ${isAdmin ? 'text-indigo-200' : 'text-gray-400'}`}>
                        {(() => {
                          try {
                            const dateStr = msg.timestamp.includes('T') ? msg.timestamp : msg.timestamp.replace(' ', 'T');
                            return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                          } catch { return ''; }
                        })()}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="p-3 sm:p-4 bg-white border-t border-gray-200 flex-shrink-0">
              <form onSubmit={handleSendMessage} className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Type a message..."
                  className="flex-1 min-w-0 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="bg-indigo-600 text-white rounded-full p-2 hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-all w-10 h-10 flex items-center justify-center shadow-md flex-shrink-0"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 transform rotate-90" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
                  </svg>
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 flex-col bg-gray-50 p-4">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-gray-200 rounded-full flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 sm:h-10 sm:w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <p className="font-medium text-sm sm:text-base">Select a conversation</p>
            <p className="text-xs text-gray-400 mt-1 hidden sm:block">Choose a user from the list to start chatting</p>
          </div>
        )}
      </div>

      {/* ── Broadcast Modal ── */}
      {showBroadcast && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full p-4 sm:p-6 transform transition-all scale-100">
            <div className="flex items-center gap-3 mb-4 text-indigo-600">
              <div className="p-2 bg-indigo-100 rounded-lg flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 sm:h-6 sm:w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
              </div>
              <h3 className="text-lg sm:text-xl font-bold text-gray-800">Send Broadcast</h3>
            </div>
            <p className="text-gray-600 mb-4 text-xs sm:text-sm bg-yellow-50 p-3 rounded-lg border border-yellow-100">
              This message will be sent to <strong>ALL connected devices</strong> and will appear in their chat window.
            </p>
            <form onSubmit={handleBroadcast}>
              <textarea
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                placeholder="Type your announcement here..."
                className="w-full border border-gray-300 rounded-lg p-3 h-28 sm:h-32 mb-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none resize-none text-sm"
              />
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowBroadcast(false)}
                  className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!broadcastMsg.trim()}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium transition-colors shadow-md"
                >
                  Send Broadcast
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ChatManager;
