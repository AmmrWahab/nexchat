// src/pages/DashboardPage.jsx

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import './dashboard.css';
import { io } from 'socket.io-client';
import { Search, X, CornerUpRight } from "lucide-react";   // (latest)


export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('chats');
  const [view, setView] = useState('chats'); // ← Controls what screen to show: 'chats' or 'status'
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false); // ← New state
  const [selectedChat, setSelectedChat] = useState(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [showNewChatDropdown, setShowNewChatDropdown] = useState(false);
  const [showNewContactModal, setShowNewContactModal] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [user, setUser] = useState({ name: 'You' }); // Update this to include id
  const messagesEndRef = useRef(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(-1);
  const currentMatchRef = useRef(null);
  const [showAttachmentMenu, setShowAttachmentMenu] = useState(false);
  const messageInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const [showCameraModal, setShowCameraModal] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState(null);
  const [caption, setCaption] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [showCropper, setShowCropper] = useState(false);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [previewImage, setPreviewImage] = useState(null);
  const dropdownRef = useRef(null);
  // For message actions
  const [replyTo, setReplyTo] = useState(null); // { id, text, sender }
  const [deleting, setDeleting] = useState(null); // { id, timestamp }
  const actionsMenuRef = useRef(null);
  const [openActionMenu, setOpenActionMenu] = useState(null); // ID of currently open menu
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, right: 0, placement: 'bottom' });
  const messageButtonRefs = useRef({});
  const [socket, setSocket] = useState(null);
  const selectedChatRef = useRef(selectedChat);
  const socketRef = useRef(null);
  const userRef = useRef(user);
  const lastStatusUpdate = useRef({});
  const [showClearChatConfirm, setShowClearChatConfirm] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState(new Set());
  const [showContactInfo, setShowContactInfo] = useState(false);





  const [contacts, setContacts] = useState(() => {
    try {
    const saved = localStorage.getItem('userContacts');
    const loaded = saved ? JSON.parse(saved) : [];

    // ✅ Ensure every contact has `online: false` on load
    const initialized = loaded.map(contact => ({
      ...contact,
      online: false,           // 👈 Force offline by default
      lastSeen: contact.lastSeen || Date.now()
    }));

    return initialized;
    } catch (err) {
    console.error('Failed to load contacts', err);
    return [];
    }
    });



  function formatLastSeen(date) {
  if (!date) return 'Unknown time';

  const now = new Date();
  const then = new Date(date);
  const diffInHours = (now - then) / (1000 * 60 * 60);

  if (diffInHours < 1) return 'Last seen just now';
  if (diffInHours < 24) return `Last seen ${Math.floor(diffInHours)}h ago`;
  if (diffInHours < 48) return 'Last seen yesterday';
  return `Last seen ${Math.floor(diffInHours / 24)} days ago`;
}

useEffect(() => {
  socketRef.current = socket;
}, [socket]);


function formatTime(value) {
  if (!value) return "";
  
  const date = new Date(value);
  if (isNaN(date)) return "";

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}




  const markAsRead = useCallback(() => {
  const currentSocket = socketRef.current;
  const currentUser = userRef.current;
  const chat = selectedChatRef.current;

 if (!chat?.id || !currentUser?.id || !currentSocket) {
  console.warn("❌ markAsRead skipped", { chat, currentUser, currentSocket });
  return;
}


  setMessages(prev => {
    const chatMessages = prev[chat.id] || [];
    const receivedMessages = chatMessages.filter(msg => msg.sender !== 'You');
    const hasUnread = receivedMessages.some(msg => !msg.read);

    if (!hasUnread) return prev; // ✅ Already read

    // ✅ Emit only once
    currentSocket.emit('markAsRead', {
      chatId: chat.id,
      readerId: currentUser.id
    });

    const updatedChat = chatMessages.map(msg =>
      msg.sender !== 'You' ? { ...msg, read: true } : msg
    );

    const updated = { ...prev, [chat.id]: updatedChat };
    localStorage.setItem('chatMessages', JSON.stringify(updated));
    return updated;
  });
}, []);



  const [messages, setMessages] = useState(() => {
  try {
    const saved = localStorage.getItem('chatMessages');
    return saved ? JSON.parse(saved) : {};
  } catch (err) {
    console.error('Failed to load messages', err);
    return {};
  }
});





const useIsTabFocused = () => {
  const [isFocused, setIsFocused] = useState(true);

  useEffect(() => {
    const handleFocus = () => setIsFocused(true);
    const handleBlur = () => setIsFocused(false);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return isFocused;
};

// Use it
const isTabFocused = useIsTabFocused();
















  
  const markAsReadRef = useRef(markAsRead);
  const isTabFocusedRef = useRef(isTabFocused);
  
  useEffect(() => {
  isTabFocusedRef.current = isTabFocused;
}, [isTabFocused]);

useEffect(() => {
  markAsReadRef.current = markAsRead;
}, [markAsRead]);

  useEffect(() => {
  selectedChatRef.current = selectedChat;
  userRef.current = user;
}, [selectedChat, user]);

useEffect(() => {
  if (socket) socketRef.current = socket;
}, [socket]);

useEffect(() => {
  if (!selectedChat?.id || !messages[selectedChat.id]) return;
  const chatMessages = messages[selectedChat.id];
  const hasUnread = chatMessages.some(m => m.sender !== 'You' && !m.read);
  if (hasUnread && isTabFocused) {
    markAsRead();
  }
}, [selectedChat?.id, messages, isTabFocused, markAsRead]);


const positionDropdown = (buttonEl, isYou) => {
  if (!buttonEl) return;

  const rect = buttonEl.getBoundingClientRect();
  const parentRect = buttonEl.offsetParent.getBoundingClientRect();

  const dropdownHeight = 200;
  const gap = 4;

  let top, placement;

  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  if (spaceBelow >= dropdownHeight + gap) {
    top = rect.bottom - parentRect.top + gap;
    placement = 'bottom';
  } else if (spaceAbove >= dropdownHeight + gap) {
    top = rect.top - parentRect.top - dropdownHeight - gap;
    placement = 'top';
  } else {
    top = rect.bottom - parentRect.top + gap;
    placement = 'bottom';
  }

  let left = null;
  let right = null;

  if (isYou) {
    // Sent message → dropdown opens LEFT of button
    right = parentRect.right - rect.right;
  } else {
    // Received message → dropdown opens RIGHT of button
    left = rect.left - parentRect.left;
  }

  setDropdownPosition({ top, left, right, placement });
};



// Add this near other refs or styles
const dropdownItemStyle = {
  display: 'block',
  width: '100%',
  padding: '10px 16px',
  border: 'none',
  background: 'none',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: '0.95rem',
  color: '#333',
  transition: 'background 0.2s',
};
  
 



useEffect(() => {
  const handleClickOutside = (e) => {
    if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) {
      setOpenActionMenu(null);
      setDeleting(null);
    }
  };
  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, []);

  

const saveFile = async (fileUrl, fileName = "download", forceOpen = false) => {
  try {
    let blob;

    if (fileUrl.startsWith("data:")) {
      // Base64 → Blob
      const arr = fileUrl.split(",");
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      let n = bstr.length;
      const u8arr = new Uint8Array(n);
      while (n--) u8arr[n] = bstr.charCodeAt(n);
      blob = new Blob([u8arr], { type: mime });
    } else {
      // Normal URL → fetch as Blob
      const res = await fetch(fileUrl);
      blob = await res.blob();
    }

    const url = URL.createObjectURL(blob);

    if (forceOpen) {
      // Just open in new tab, no download attribute
      window.open(url, "_blank");
    } else {
      // Trigger download
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    // Cleanup
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.error("❌ Save failed:", err);
    alert("Save failed, check console for details.");
  }
};


 



  


 const getFileIcon = (fileType, fileName) => {
  // ✅ Handle undefined fileType
  if (!fileType) {
    if (fileName?.endsWith('.jpg') || fileName?.endsWith('.jpeg') || 
        fileName?.endsWith('.png') || fileName?.endsWith('.gif')) {
      return '🖼️';
    }
    return '📎';
  }

  if (fileType.startsWith('image/')) return '🖼️';
  if (fileType === 'application/pdf') return '📕';
  if (fileType.includes('word') || fileName?.endsWith('.doc') || fileName?.endsWith('.docx')) return '📘';
  if (fileType.includes('excel') || fileName?.endsWith('.xls') || fileName?.endsWith('.xlsx')) return '📊';
  if (fileType.includes('powerpoint') || fileName?.endsWith('.ppt') || fileName?.endsWith('.pptx')) return '📈';
  if (fileType === 'text/plain') return '📄';
  return '📎';
};

  // Start camera
const handleOpenCamera = () => {
  setShowCameraModal(true);
  setCapturedPhoto(null);
  setCaption('');
  setIsEditing(false);
  setShowCropper(false);

  // Wait for modal to render
  setTimeout(() => {
    if (videoRef.current) {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(stream => {
          videoRef.current.srcObject = stream;
          
          // ✅ Wait for video to load metadata
          videoRef.current.onloadedmetadata = () => {
            console.log('🎥 Camera stream loaded');
          };
        })
        .catch(err => {
          console.error("❌ Camera error:", err);
          alert("Unable to access camera");
          setShowCameraModal(false);
        });
    }
  }, 100);
};

// Capture photo
const handleCapturePhoto = () => {
  const video = videoRef.current;
  const canvas = canvasRef.current;
  
  if (!video || !canvas) {
    console.error('❌ Video or canvas not available');
    return;
  }

  // ✅ Ensure video is playing and has dimensions
  if (video.readyState === 0) {
    alert('Camera not ready yet. Please wait.');
    return;
  }

  const context = canvas.getContext('2d');
  
  // Set canvas to match video dimensions
  const width = video.videoWidth;
  const height = video.videoHeight;
  canvas.width = width;
  canvas.height = height;

  // Draw video frame to canvas
  context.drawImage(video, 0, 0, width, height);

  // Convert to JPEG
  const photoDataUrl = canvas.toDataURL('image/jpeg', 0.9);

  // Stop camera stream
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }

  // Set captured photo
  setCapturedPhoto(photoDataUrl);
  setShowCameraModal(false);
  console.log('✅ Photo captured');
};

// Send photo
const handleSendPhoto = () => {
  if (!user.id) {
    alert('Not logged in');
    return;
  }
  if (!capturedPhoto || !selectedChat || !socket) return;

  const messageText = caption;

  socket.emit('sendMessage', {
    to: selectedChat.id,
    message: messageText,
    file: capturedPhoto,
    fileName: 'photo.jpg',
    fileType: 'image/jpeg', // ✅ Send fileType
    from: user.id,
    fromName: user.name,
    fromPhoto: selectedChat.photo
  });

  // In handleSendPhoto
setMessages(prev => {
  const updated = {
    ...prev,
    [selectedChat.id]: [
      ...(prev[selectedChat.id] || []),
      {
        id: Date.now(),
        text: messageText,
        sender: 'You',
        timestamp: Date.now(),

        file: capturedPhoto,
        fileName: 'photo.jpg',
        fileType: 'image/jpeg'
      }
    ]
  };
  // ✅ Persist to localStorage
  localStorage.setItem('chatMessages', JSON.stringify(updated));
  return updated;
});


  // Reset
  setCapturedPhoto(null);
  setCaption('');
  setIsEditing(false);
};



  // Handle file selection
const handleFileChange = (e) => {
  const file = e.target.files[0];
  if (!file || !selectedChat || !socket) return;

  // ✅ 1. Generate tempId FIRST
  const tempId = `temp-${Date.now()}-${Math.random()}`;

  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;

    // ✅ 2. Now use tempId
    socket.emit('sendMessage', {
      to: selectedChat.id,
      message: '',
      file: base64,
      fileName: file.name,
      fileType: file.type,
      from: user.id,
      fromName: user.name,
      fromPhoto: selectedChat.photo,
      messageId: tempId  // ✅ Now valid
    });

    // ✅ 3. Save to local messages with same tempId
    setMessages(prev => {
      const updated = {
        ...prev,
        [selectedChat.id]: [
          ...(prev[selectedChat.id] || []),
          {
            id: tempId,
            text: '',
            sender: 'You',
            timestamp: Date.now(),
            file: base64,
            fileName: file.name,
            fileType: file.type,
            delivered: false,
            read: false
          }
        ]
      };
      localStorage.setItem('chatMessages', JSON.stringify(updated));
      return updated;
    });

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  reader.readAsDataURL(file);
};





useEffect(() => {
  const handleClickOutside = (e) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
      setShowDropdown(false);
    }
  };

  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, []);



useEffect(() => {
  if (currentResultIndex === -1 || !currentMatchRef.current) return;
  currentMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
}, [currentResultIndex]);

 

  
  
  
  


useEffect(() => {
  const saved = localStorage.getItem('chatMessages');
  console.log('📁 Messages on load:', saved ? Object.keys(JSON.parse(saved)) : 'none');
}, []);

  // Auto-scroll to bottom when messages or selectedChat changes
useEffect(() => {
  if (messagesEndRef.current) {
    messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
  }
}, [selectedChat, messages]);

useEffect(() => {
  if (!selectedChat || !searchQuery) {
    setSearchResults([]);
    setCurrentResultIndex(-1);
    return;
  }
  const chatMessages = messages[selectedChat.id] || [];

  const results = chatMessages
    .filter(msg => msg.text.toLowerCase().includes(searchQuery.toLowerCase()))
    .map(msg => msg.id)
    .reverse();

  setSearchResults(results);
  setCurrentResultIndex(results.length > 0 ? 0 : -1);
}, [selectedChat, selectedChat?.id, searchQuery, messages]);

useEffect(() => {
  if (!user.id) return;

  const token = localStorage.getItem('token');
  if (!token) {
    navigate('/signin');
    return;
  }

 const newSocket = io('http://192.168.1.190:5000', {
  auth: { token },
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 5000,
  transports: ['websocket', 'polling']
});

   // ✅ Add: Listen for user status updates

// Inside useEffect where you set up socket
newSocket.on('messageDelivered', ({ chatId, messageId }) => {
  console.log('📩 Message delivered to recipient', { chatId, messageId });
  setMessages(prev => {
    const chat = prev[chatId] || [];
    const updatedChat = chat.map(msg =>
      msg.id === messageId ? { ...msg, delivered: true } : msg
    );
    const updated = { ...prev, [chatId]: updatedChat };
    localStorage.setItem('chatMessages', JSON.stringify(updated));
    return updated;
  });
});

newSocket.on('userStatus', (data) => {
  const now = Date.now();
  const last = lastStatusUpdate.current[data.userId] || 0;
  const MIN_INTERVAL = 1000; // 1 second

  if (now - last < MIN_INTERVAL) return; // Ignore rapid updates

  lastStatusUpdate.current[data.userId] = now;

  setContacts(prev => prev.map(c =>
    c.id === data.userId
      ? {
          ...c,
          online: data.isOnline,
          lastSeen: data.isOnline ? c.lastSeen : data.lastSeen
        }
      : c
  ));

  if (selectedChat?.id === data.userId) {
    setSelectedChat(prev => ({
      ...prev,
      online: data.isOnline,
      lastSeen: data.isOnline ? prev.lastSeen : data.lastSeen
    }));
  }
});

  // ✅ GLOBAL listener: runs once per socket
newSocket.on("receiveMessage", (data) => {
  const senderId = String(data.from);
  const displayName = senderId === user.id ? "You" : data.fromName || "Unknown";

  

  setMessages((prev) => {
    const chat = prev[senderId] || [];

    // ✅ 1. If this is my own message and I sent it with messageId
    if (senderId === user.id && data.messageId) {
      const existingIndex = chat.findIndex(m => m.id === data.messageId);

      if (existingIndex > -1) {
        const updatedChat = [...chat];
        updatedChat[existingIndex] = {
          ...updatedChat[existingIndex],
          id: data._id?.toString() || updatedChat[existingIndex].id,
          delivered: true,
        };

        const updated = { ...prev, [senderId]: updatedChat };
        localStorage.setItem('chatMessages', JSON.stringify(updated));
        return updated;
      }
    }

    // ✅ 2. Otherwise, it's a new message from someone else
    const newMessage = {
      id: data._id?.toString() || `fallback-${Date.now()}`,
      text: data.message,
      sender: displayName,
      timestamp: data.timestamp || Date.now(),
      file: data.file,
      fileName: data.fileName,
      fileType: data.fileType,
      replyTo: data.replyTo ? {
        ...data.replyTo,
        
      } : null,
      photo: data.fromPhoto || 'https://placehold.co/50x50',
      delivered: true,
      read: false,
    };

    const updatedChat = [...chat, newMessage];
    const updated = { ...prev, [senderId]: updatedChat };
    localStorage.setItem('chatMessages', JSON.stringify(updated));
    return updated;
  });


  

    

    // 3. Upsert contact
    setContacts(prev => {
      const exists = prev.some(c => String(c.id) === senderId);
      if (exists) {
        return prev.map(c =>
          String(c.id) === senderId
            ? { ...c, lastMsg: data.message, time: data.time, online: true }
            : c
        );
      }
      const newContact = {
        id: senderId,
        name: data.fromName || senderId,
        photo: data.fromPhoto || 'https://placehold.co/50x50',

        lastMsg: data.message,
        time: data.time,
        online: true
      };
      const updated = [newContact, ...prev];
      localStorage.setItem('userContacts', JSON.stringify(updated));
      return updated;
    });



    // 5. ✅ Mark as read only if active chat AND tab is focused
    // 5. ✅ Mark as read only if active chat AND tab is focused
            if (selectedChatRef.current?.id === senderId && isTabFocusedRef.current) {
            setTimeout(() => {
              console.log('📤 Auto-marking as read (message received)', { chatId: senderId });
              markAsReadRef.current();
            }, 0); // let React apply setMessages first
          }

      });
      

    // ✅ Listen for read receipts (when someone reads your messages)
    newSocket.on('messageRead', ({ chatId }) => {
    console.log('📩 Received messageRead', { chatId });
    setMessages(prev => {
      const chat = prev[chatId] || [];
      const updatedChat = chat.map(msg =>
        msg.sender === 'You' ? { ...msg, delivered: true, read: true } : msg
      );
      const updated = { ...prev, [chatId]: updatedChat };
      localStorage.setItem('chatMessages', JSON.stringify(updated));
      return updated;
    });
    });

     setSocket(newSocket);
      socketRef.current = newSocket; // ✅ Set ref here

    return () => {
    newSocket.disconnect();
   };
    }, [user.id, navigate]);   
  
  
  
    


        // Save whenever chat changes
        useEffect(() => {
          if (selectedChat?.id) {
            localStorage.setItem('selectedChat', JSON.stringify(selectedChat));
          }
        }, [selectedChat]);

        // Restore on load
        useEffect(() => {
          const saved = localStorage.getItem('selectedChat');
          if (saved) {
            const parsed = JSON.parse(saved);
            setSelectedChat(parsed);

            // 👇 Force check immediately after reload
            setTimeout(() => {
              selectedChatRef.current = parsed;
              markAsReadRef.current();
            }, 0);
          }
        }, []);

        // After user + selectedChat restore
        useEffect(() => {
          if (!user?.id || !selectedChat?.id) return; // wait until both exist

          const chatMessages = messages[selectedChat.id] || [];
          const hasUnread = chatMessages.some(m => m.sender !== 'You' && !m.read);

          if (hasUnread) {
            console.log("🔥 Marking as read after reload (user + chat ready)", selectedChat.id);
            markAsReadRef.current();
          }
        }, [user?.id, selectedChat?.id, messages]);



          // Check if user exists in DB
        const findUserByEmail = async (email) => {
          try {
            const res = await fetch(`http://192.168.1.190:5000/api/auth/check-email?email=${encodeURIComponent(email)}`);
            if (res.ok) {
              const data = await res.json();
              return data.user; // { id, name, email, photo }
            }
            return null;
          } catch (err) {
            console.error('Error checking email:', err);
            return null;
          }
        };
  
  


  
  
  
  
        const drawerRef = useRef(null);
        useEffect(() => {
        const drawer = drawerRef.current;
        if (!drawer || !showAddContact) return;

        let isDragging = false;
        let startY = 0;
        let currentY = 0;

        const handleTouchStart = (e) => {
          startY = e.touches[0].clientY;
          isDragging = true;
        };

        const handleTouchMove = (e) => {
          if (!isDragging) return;
          currentY = e.touches[0].clientY;
          const deltaY = currentY - startY;

          if (deltaY > 0) {
            // ✅ Live drag
            drawer.style.transform = `translateY(${deltaY}px)`;
            drawer.style.transition = 'none'; // No animation during drag
          }
        };

        const handleTouchEnd = () => {
          if (!isDragging) return;
          isDragging = false;

          const deltaY = currentY - startY;
          const viewportHeight = window.innerHeight;
          const closeThreshold = viewportHeight * 0.5;

          if (deltaY > closeThreshold) {
            // Close
            drawer.style.transition = 'transform 0.3s ease';
            drawer.style.transform = `translateY(${viewportHeight}px)`;
            setTimeout(() => {
              setShowAddContact(false);
            }, 300);
          } else {
            // Snap back
            drawer.style.transition = 'transform 0.4s cubic-bezier(0.25, 0.8, 0.75, 1)';
            drawer.style.transform = 'translateY(0)';
          }

          // Reset
          setTimeout(() => {
            if (drawer) drawer.style.transition = '';
          }, 400);
        };

        drawer.addEventListener('touchstart', handleTouchStart, { passive: true });
        drawer.addEventListener('touchmove', handleTouchMove, { passive: false });
        drawer.addEventListener('touchend', handleTouchEnd);

        return () => {
          drawer.removeEventListener('touchstart', handleTouchStart);
          drawer.removeEventListener('touchmove', handleTouchMove);
          drawer.removeEventListener('touchend', handleTouchEnd);
        };
      }, [showAddContact]);



        // Close dropdown when clicking outside
      useEffect(() => {
        const handleClickOutside = (e) => {
          if (!e.target.closest('.menu-container')) {
            setShowDropdown(false);
          }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }, []);
  
          useEffect(() => {
            const token = localStorage.getItem('token');
            if (token) {
              try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                const userId = payload.userId;
                setUser({ id: userId, name: 'You' });

                // ✅ Migrate messages from "undefined" to real userId
                const saved = localStorage.getItem('chatMessages');
                if (saved) {
                  const messages = JSON.parse(saved);
                  if (messages.undefined && !messages[userId]) {
                    messages[userId] = messages.undefined;
                    delete messages.undefined;
                    localStorage.setItem('chatMessages', JSON.stringify(messages));
                    setMessages(messages);
                  } else {
                    setMessages(messages);
                  }
                }
              } catch (err) {
                console.error('Failed to decode token', err);
                navigate('/signin');
              }
            } else {
              navigate('/signin');
            }
          }, [navigate]);

        // Handle token from URL after Google login
        useEffect(() => {
          const params = new URLSearchParams(location.search);
          const token = params.get('token');

          if (token) {
            localStorage.setItem('token', token);
            // Remove token from URL
            window.history.replaceState({}, document.title, '/dashboard');
          }

          const storedToken = localStorage.getItem('token');
          if (!storedToken) {
            navigate('/signin');
          }
        }, [navigate, location]);

        const handleLogout = () => {
          localStorage.removeItem('token');
          navigate('/signin');
        };





  
      // Close new chat dropdown on outside click
    useEffect(() => {
      const handleClickOutside = (e) => {
        if (!e.target.closest('.new-chat-dropdown') && !e.target.classList.contains('new-chat-trigger')) {
          setShowNewChatDropdown(false);
        }
      };

      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

      // Mock chats data
      const chats = []; // ✅ start empty, load real contacts instead


      // Mock groups, calls, etc.
      const groups = [{ id: 1, name: 'Family Group', lastMsg: 'Mom: Dinner at 8?' }];
      const calls = [{ id: 1, name: 'Alice', type: 'video', time: 'Today, 9:00 AM' }];
      const statuses = [{ id: 1, name: 'Alice', time: '2 min ago' }];

    

      const renderCenterContent = () => {
        if (activeTab === 'profile') {
          return (
            <div className="profile-view">
              <h2>👤 Profile</h2>
              <p>Name: {user.name}</p>
              <p>Status: Online</p>
              <button onClick={handleLogout} className="btn-logout">Logout</button>
            </div>
          );
        }

   


    return (
      <>
        <div className="search-bar">
          <input type="text" placeholder="Search" />
        </div>
        <div className="items-list">
          {activeTab === 'chats' && [...contacts, ...chats].map(chat => (
      <div
        key={chat.id}
        className={`chat-item ${selectedChat?.id === chat.id ? 'active' : ''}`}
        onClick={() => {
          setSelectedChat(chat);
        
        }}
        style={{ cursor: 'pointer' }}
      >
          <img src={chat.photo || 'https://via.placeholder.com/50'} alt={chat.name} />
          <div className="chat-info">
            <h4>{chat.name}</h4>
            <p>{chat.lastMsg}</p>
          </div>
          <span className="timestamp">{chat.timestamp}</span>
        </div>
      ))}
                {activeTab === 'groups' && groups.map(group => (
                  <div key={group.id} className="chat-item">
                    <img src="https://via.placeholder.com/50/4a00e0/fff?text=G" alt={group.name} />
                    <div className="chat-info">
                      <h4>{group.name}</h4>
                      <p>{group.lastMsg}</p>
                    </div>
                  </div>
                ))}
                {activeTab === 'calls' && calls.map(call => (
                  <div key={call.id} className="chat-item">
                    <img src="https://via.placeholder.com/50" alt={call.name} />
                    <div className="chat-info">
                      <h4>{call.name}</h4>
                      <p>{call.type} call • {call.time}</p>
                    </div>
                  </div>
                ))}
                {activeTab === 'statuses' && statuses.map(status => (
                  <div key={status.id} className="chat-item">
                    <img src="https://via.placeholder.com/50/25D366/fff?text=S" alt={status.name} />
                    <div className="chat-info">
                      <h4>{status.name}</h4>
                      <p>• {status.time}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          );
        };

      const renderRightPanel = () => {
      if (!selectedChat) {
        return <div className="right-placeholder">Select a chat to start messaging</div>;
      }

      const chatMessages = messages[selectedChat.id] || [];

    const handleSendMessage = (e) => {
      
  e.preventDefault();
  const input = messageInputRef.current;
  if (!input?.value.trim()) return;

  const text = input.value.trim();
  console.log("📝 Message being sent:", text);
  const now = new Date();

  // ✅ Generate tempId first
  const tempId = `temp-${now.getTime()}-${Math.random()}`;

  const replyToForPayload = replyTo ? {
    id: replyTo.id,
    text: replyTo.text,
    senderId: replyTo.senderId || (replyTo.sender === 'You' ? user.id : selectedChat.id),
  } : null;

  // ✅ Emit with messageId
  socket.emit('sendMessage', {
    to: selectedChat.id,
    message: text,
    from: user.id,
    fromName: user.name,
    fromPhoto: selectedChat.photo,
    replyTo: replyToForPayload,
    timestamp: now.getTime(),
    messageId: tempId  // ✅
  });

  // ✅ Save with same tempId
  setMessages(prev => ({
    ...prev,
    [selectedChat.id]: [
      ...(prev[selectedChat.id] || []),
      {
        id: tempId,
        text,
        sender: 'You',
        timestamp: now.getTime(),
        replyTo: replyToForPayload,
        delivered: false,
        read: false
      }
    ]
  }));

  input.value = '';
  setReplyTo(null);
};

  return (
     <>
    
   <div className="chat-container">
  {/* Main Chat Window */}
  <div className="chat-window">
    <div className="chat-header">
      {isSelectionMode ? (
        /* Selection Mode Header */
        <div
          className="selection-header"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            width: '100%',
            padding: '16px',
            background: 'white',
            borderBottom: '1px solid #ddd',
          }}
        >
          {/* Left: Exit & Count */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontWeight: 'bold',
            }}
          >
            <button
              onClick={() => {
                setIsSelectionMode(false);
                setSelectedMessages(new Set());
              }}
              style={{
                background: 'none',
                border: 'none',
                color: '#075e54',
                font: 'inherit',
                cursor: 'pointer',
                fontSize: '20px',
                padding: '4px',
                lineHeight: '1',
              }}
              aria-label="Exit selection mode"
            >
              ✕
            </button>
            <span>{selectedMessages.size} selected</span>
          </div>

          {/* Right: Delete & Forward (only if selected) */}
          {selectedMessages.size > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
              }}
            >
              <button
                onClick={() => {
                  setMessages((prev) => ({
                    ...prev,
                    [selectedChat.id]: prev[selectedChat.id].filter(
                      (m) => !selectedMessages.has(m.id)
                    ),
                  }));
                  setIsSelectionMode(false);
                  setSelectedMessages(new Set());
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'red',
                  cursor: 'pointer',
                  fontSize: '1.6rem',
                }}
                aria-label="Delete selected messages"
              >
                🗑️
              </button>
              <button
                onClick={() => {
                  alert('Forward selected messages');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#075e54',
                  cursor: 'pointer',
                  fontSize: '1.6rem',
                }}
                aria-label="Forward selected messages"
              >
                ↪
              </button>
            </div>
          )}
        </div>
      ) : (
        /* Regular Header */
        <div className="header-left">
          <img
            src={selectedChat?.photo || 'https://via.placeholder.com/40'}
            alt={selectedChat?.name}
          />
          <div className="user-info">
            <h4>{selectedChat?.name}</h4>
            <p>
              {selectedChat?.online
                ? 'Online'
                : formatLastSeen(selectedChat?.lastSeen)}
            </p>
          </div>
        </div>
      )}

      {/* Header Right: Search & 3-dot */}
      <div
        className="header-right"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 23,
          marginLeft: 'auto',
          marginRight: '15px',
        }}
      >
        {!isSelectionMode && (
          <>
            {/* Search */}
            {isSearching ? (
              <div
                className="search-in-chat"
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <input
                  type="text"
                  placeholder="Search in chat"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && searchResults.length > 0) {
                      e.preventDefault();
                      const nextIndex = (currentResultIndex + 1) % searchResults.length;
                      setCurrentResultIndex(nextIndex);
                    }
                  }}
                  autoFocus
                />
                <span className="search-count">
                  {searchResults.length > 0
                    ? `${currentResultIndex + 1} of ${searchResults.length}`
                    : ''}
                </span>
                <button
                  onClick={() => {
                    setIsSearching(false);
                    setSearchQuery('');
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                >
                  <X size={18} />
                </button>
              </div>
            ) : (
              <button
                className="search-btn"
                onClick={() => setIsSearching(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <Search size={18} />
              </button>
            )}

            {/* Three-dot Menu */}
            <button
              className="menu-btn"
              onClick={(e) => {
                e.stopPropagation();
                setShowDropdown(!showDropdown);
                const button = e.currentTarget;
                const rect = button.getBoundingClientRect();
                setDropdownPosition({
                  top: rect.bottom,
                  right: window.innerWidth - rect.right,
                  placement: 'bottom',
                });
              }}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1.6rem',
                marginTop: '-5px',
              }}
            >
              ⋮
            </button>
          </>
        )}
      </div>

      {/* Three-dot Dropdown */}
      {!isSelectionMode && showDropdown && selectedChat && (
        <div className="menu-container">
          <div
            ref={dropdownRef}
            className="chat-menu-dropdown"
            style={{
              position: 'absolute',
              top: `${dropdownPosition.top}px`,
              right: `${dropdownPosition.right}px`,
              width: '240px',
              background: 'white',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              border: '1px solid #ddd',
              zIndex: 1000,
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <style jsx>{`
              .dropdown-item {
                padding: 12px 16px;
                display: flex;
                align-items: center;
                gap: 12px;
                cursor: pointer;
                border: none;
                background: white;
                width: 100%;
                text-align: left;
              }
              .dropdown-item:hover {
                background: #f0f2f5;
              }
              .divider {
                height: 1px;
                background: #eee;
                margin: 4px 0;
              }
            `}</style>

            <button
              className="dropdown-item"
              onClick={() => {
                setShowContactInfo(true);
                setShowDropdown(false);
              }}
            >
              <span>ℹ️</span>
              <span>Contact info</span>
            </button>
            <button
              className="dropdown-item"
              onClick={() => {
                setIsSelectionMode(true);
                setShowDropdown(false);
              }}
            >
              <span>📋</span>
              <span>Select messages</span>
            </button>
            <button
              className="dropdown-item"
              onClick={() => {
                setSelectedChat(null);
                setShowDropdown(false);
              }}
            >
              <span>✕</span>
              <span>Close chat</span>
            </button>
            <div className="divider"></div>
            <button
              className="dropdown-item"
              onClick={() => {
                setShowClearChatConfirm(true);
                setShowDropdown(false);
              }}
            >
              <span>🗑️</span>
              <span>Clear chat</span>
            </button>
            <button
              className="dropdown-item"
              style={{ color: 'red' }}
              onClick={() => {
                if (window.confirm('Delete this chat?')) {
                  setContacts((prev) => prev.filter((c) => c.id !== selectedChat.id));
                  setMessages((prev) => {
                    const newMsgs = { ...prev };
                    delete newMsgs[selectedChat.id];
                    localStorage.setItem('chatMessages', JSON.stringify(newMsgs));
                    return newMsgs;
                  });
                  setSelectedChat(null);
                }
                setShowDropdown(false);
              }}
            >
              <span>❌</span>
              <span>Delete chat</span>
            </button>
          </div>
        </div>
      )}
    </div>

    {/* Messages */}
    <div className="messages">
      {chatMessages.map((msg) => {
        const isMatch =
          searchQuery &&
          msg.text?.toLowerCase().includes(searchQuery.toLowerCase());
        const isCurrentMatch = isMatch && msg.id === searchResults[currentResultIndex];
        const isYou = msg.sender === 'You';

        return (
          <div
            key={msg.id}
            className={`message ${isYou ? 'sent' : 'received'} ${isMatch ? 'highlighted' : ''}`}
            ref={isCurrentMatch ? currentMatchRef : null}
            onClick={() => {
              if (isSelectionMode) {
                const newSelected = new Set(selectedMessages);
                if (newSelected.has(msg.id)) {
                  newSelected.delete(msg.id);
                } else {
                  newSelected.add(msg.id);
                }
                setSelectedMessages(newSelected);
              }
            }}
            style={{
              cursor: isSelectionMode ? 'pointer' : 'auto',
              position: 'relative',
            }}
          >
            {/* Selection Checkbox */}
            {isSelectionMode && (
              <div
                className="selection-checkbox"
                style={{
                  position: 'absolute',
                  left: '-35px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: '20px',
                  height: '20px',
                  borderRadius: '4px',
                  border: '2px solid #075e54',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: selectedMessages.has(msg.id) ? '#075e54' : 'white',
                  cursor: 'pointer',
                  zIndex: 5,
                }}
              >
                {selectedMessages.has(msg.id) && (
                  <span style={{ color: 'white', fontSize: '14px' }}>✓</span>
                )}
              </div>
            )}

            {/* Reply Indicator */}
            {msg.replyTo && (
              <div
                style={{
                  padding: '6px 12px',
                  backgroundColor: isYou ? '#06544c' : '#b9e8dc',
                  color: 'black',
                  borderRadius: '6px 6px 0 0',
                  fontSize: '0.8rem',
                  cursor: 'pointer',
                }}
              >
                ↪{' '}
                {String(msg.replyTo.senderId) === String(user.id)
                  ? 'You'
                  : contacts.find((c) => String(c.id) === String(msg.replyTo.senderId))
                    ?.name || 'Unknown'}
                : {msg.replyTo.text || '[Image]'}
              </div>
            )}

            {/* Message Actions Button */}
            <button
              ref={(el) => (messageButtonRefs.current[msg.id] = el)}
              onClick={(e) => {
                e.stopPropagation();
                if (openActionMenu === msg.id) {
                  setOpenActionMenu(null);
                } else {
                  setOpenActionMenu(msg.id);
                  positionDropdown(messageButtonRefs.current[msg.id], isYou);
                }
              }}
              className="message-actions"
              style={{ display: isSelectionMode ? 'none' : 'flex' }}
            >
              ⋮
            </button>

            {/* Action Dropdown */}
            {openActionMenu === msg.id && (
              <div
                ref={actionsMenuRef}
                style={{
                  position: 'absolute',
                  top: `${dropdownPosition.top}px`,
                  ...(dropdownPosition.left !== null
                    ? { left: `${dropdownPosition.left}px` }
                    : { right: `${dropdownPosition.right}px` }),
                  minWidth: '180px',
                  maxWidth: '220px',
                  background: 'white',
                  border: '1px solid #ddd',
                  borderRadius: '12px',
                  boxShadow: '0 6px 20px rgba(0,0,0,0.15)',
                  zIndex: 1000,
                  overflow: 'hidden',
                }}
              >
                <style jsx>{`
                  @keyframes fadeInScale {
                    0% { opacity: 0; transform: translateY(-6px) scale(0.95); }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                  }
                `}</style>

                <>
                  {!msg.file && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(msg.text);
                        setOpenActionMenu(null);
                      }}
                      style={dropdownItemStyle}
                    >
                      📋 Copy
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setReplyTo({
                        id: msg.id,
                        text: msg.text || '[Image]',
                        sender: msg.sender,
                      });
                      setOpenActionMenu(null);
                      messageInputRef.current?.focus();
                    }}
                    style={dropdownItemStyle}
                  >
                    ↪ Reply
                  </button>
                  <button
                    onClick={() => {
                      alert('Forwarding disabled');
                      setOpenActionMenu(null);
                    }}
                    style={dropdownItemStyle}
                  >
                    ➿ Forward
                  </button>
                  <button
                    onClick={() => {
                      const within15Min = Date.now() - (msg.timestamp || Date.now()) < 15 * 60 * 1000;
                      if (within15Min) {
                        setDeleting({ id: msg.id, timestamp: msg.timestamp });
                      } else {
                        setMessages((prev) => ({
                          ...prev,
                          [selectedChat.id]: prev[selectedChat.id].filter((m) => m.id !== msg.id),
                        }));
                      }
                      setOpenActionMenu(null);
                    }}
                    style={{ ...dropdownItemStyle, color: 'red' }}
                  >
                    🗑️ Delete
                  </button>
                </>
              </div>
            )}

            {/* Message Text */}
            {!msg.file && msg.text && <div style={{ wordBreak: 'break-word' }}>{msg.text}</div>}

            {/* Image */}
            {msg.file && msg.fileType?.startsWith('image/') && (
              <div
                style={{
                  position: 'relative',
                  display: 'inline-block',
                  maxWidth: '100%',
                  overflow: 'hidden',
                  borderRadius: '8px',
                }}
              >
                <img
                  src={msg.file}
                  alt={msg.fileName}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '300px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                  onClick={() =>
                    setPreviewImage({
                      src: msg.file,
                      caption: msg.text,
                      fileName: msg.fileName,
                      fileType: msg.fileType,
                    })
                  }
                />
                {msg.text && (
                  <div style={{ fontSize: '0.9rem', marginTop: '4px', color: '#333' }}>
                    {msg.text}
                  </div>
                )}
              </div>
            )}

            {/* Document */}
            {msg.file && !msg.fileType?.startsWith('image/') && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '12px',
                  background: '#f0f0f5',
                  borderRadius: '8px',
                  maxWidth: '280px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.5rem' }}>
                    {getFileIcon(msg.fileType, msg.fileName)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontWeight: '600',
                        fontSize: '0.9rem',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {msg.fileName}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{msg.fileType}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      saveFile(msg.file, msg.fileName, true);
                    }}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      background: '#075e54',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                    }}
                  >
                    Open
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      saveFile(msg.file, msg.fileName);
                    }}
                    style={{
                      flex: 1,
                      padding: '6px 12px',
                      background: '#f0f2f5',
                      color: '#333',
                      border: '1px solid #ddd',
                      borderRadius: '6px',
                      fontSize: '0.9rem',
                      cursor: 'pointer',
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            )}

            {/* Timestamp */}
            <div className="timestamp-container">
              <span className="timestamp">{formatTime(msg.timestamp)}</span>
              {isYou && (
                <div className={`message-status ${msg.read ? 'read' : ''}`}>
                  <span className="tick">{msg.read ? '✅' : msg.delivered ? '✓✓' : '✓'}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={messagesEndRef} />
    </div>

    {/* Message Input */}
    {!isSelectionMode && (
      <div className="message-input">
        <form onSubmit={handleSendMessage}>
          <div className="input-wrapper">
            {replyTo && (
              <div
                style={{
                  padding: '8px 12px',
                  backgroundColor: '#075e54',
                  color: 'white',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  marginBottom: '4px',
                }}
              >
                ↪ Replying to {replyTo.sender}: "{replyTo.text || '[Image]'}"
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '1.2rem',
                  }}
                >
                  ×
                </button>
              </div>
            )}

            <button
              type="button"
              className="attachment-btn"
              onClick={() => setShowAttachmentMenu((prev) => !prev)}
              aria-label="Attach file"
            >
              📎
            </button>

            <input
              ref={messageInputRef}
              type="text"
              placeholder={replyTo ? 'Reply to message...' : 'Type a message'}
              required
            />

            <button type="submit">Send</button>
          </div>
        </form>

        <input
          type="file"
          ref={fileInputRef}
          style={{
            position: 'absolute',
            top: -9999,
            left: -9999,
            width: 1,
            height: 1,
            opacity: 0,
          }}
          onChange={handleFileChange}
          onClick={(e) => (e.target.value = null)}
        />

        {showAttachmentMenu && (
          <div className="attachment-dropdown">
            <button
              onClick={() => {
                fileInputRef.current.accept = 'image/*,video/*';
                fileInputRef.current.click();
              }}
            >
              🖼️ Photos & Videos
            </button>
            <button onClick={handleOpenCamera}>📷 Camera</button>
            <button
              onClick={() => {
                fileInputRef.current.accept = '.pdf,.doc,.docx,.txt,.zip,.xls,.xlsx';
                fileInputRef.current.click();
              }}
            >
              📄 Document
            </button>
          </div>
        )}
      </div>
    )}
  </div>

  {/* Contact Info Drawer (only when open) */}
  {showContactInfo && (
    <>
      <div
        className="drawer-overlay"
        onClick={() => setShowContactInfo(false)}
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 998,
          opacity: 1,
          visibility: 'visible',
        }}
      />

      <div
        className="contact-drawer"
        style={{
          position: 'absolute',
          top: 0,
          left: '100%',
          width: '400px',
          height: '100%',
          background: 'white',
          boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
          zIndex: 999,
          transform: 'translateX(0)',
          transition: 'transform 0.3s ease-out',
          overflowY: 'auto',
        }}
      >
        <div
          className="drawer-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            padding: '12px 16px',
            borderBottom: '1px solid #eee',
            position: 'sticky',
            top: 0,
            background: 'white',
            zIndex: 10,
          }}
        >
          <button
  onClick={() => setShowContactInfo(false)}
  style={{
    background: 'none',
    border: 'none',
    fontSize: '20px',
    cursor: 'pointer',
    color: '#000000ff',
    padding: '4px',      // 👈 Adds internal spacing
    marginRight: '20px'   // 👈 Adds space between button and title
  }}
>
  ✖
</button>
          <div
            className="drawer-title"
            style={{
              fontSize: '16px',
              color: '#333',
              flex: 1,
              textAlign: 'left',
            }}
          >
            Contact Info
          </div>
          <button
            onClick={() => alert('Edit contact')}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '18px',
            }}
          >
            ✏️
          </button>
        </div>

        <div
          className="profile-section"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '24px 16px',
            gap: '12px',
          }}
        >
          <img
            src={selectedChat?.photo || 'https://via.placeholder.com/80'}
            alt="Profile"
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '3px solid #ddd',
            }}
          />
          <div
            className="saved-name"
            style={{
              fontSize: '18px',
              fontWeight: '500',
              color: '#111',
            }}
          >
            {selectedChat?.name}
          </div>
          <div
            className="email"
            style={{
              fontSize: '14px',
              color: '#666',
            }}
          >
            {selectedChat?.email || 'user@example.com'}
          </div>
        </div>

        <div
          className="section"
          style={{
            padding: '16px',
            borderTop: '1px solid #eee',
          }}
        >
          <div
            className="section-title"
            style={{
              fontSize: '14px',
              color: '#333',
              marginBottom: '12px',
            }}
          >
            About
          </div>
          <div>No about info yet.</div>
        </div>

        <div
          className="section"
          style={{
            padding: '16px',
            borderTop: '1px solid #eee',
          }}
        >
          <div
            className="section-title"
            style={{
              fontSize: '14px',
              color: '#333',
              marginBottom: '12px',
            }}
          >
            Media, Links and Docs
          </div>
          <div className="action-item">No media yet</div>
        </div>

        <div
          className="section"
          style={{
            padding: '16px',
            borderTop: '1px solid #eee',
          }}
        >
          <div
            className="section-title"
            style={{
              fontSize: '14px',
              color: '#333',
              marginBottom: '12px',
            }}
          >
            Groups in Common
          </div>
          <div className="action-item">No groups yet</div>
        </div>

        <div
  className="section"
  style={{
    padding: '16px',
    borderTop: '1px solid #eee',
  }}
>
  {/* Block */}
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 0',
      fontSize: '16px',
      color: 'red',
      cursor: 'pointer',
    }}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="red" strokeWidth="2" />
      <line x1="7" y1="7" x2="17" y2="17" stroke="red" strokeWidth="2" />
    </svg>
    <span>Block {selectedChat?.name}</span>
  </div>

  {/* Report */}
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 0',
      fontSize: '16px',
      color: 'red',
      cursor: 'pointer',
    }}
    onClick={() => alert(`Report ${selectedChat?.name}`)}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 8H14M10 12H14M10 16H14M8 21H16C17.1046 21 18 20.1046 18 19V5C18 3.89543 17.1046 3 16 3H8C6.89543 3 6 3.89543 6 5V19C6 20.1046 6.89543 21 8 21Z" stroke="red" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 9L4 9" stroke="red" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 13L4 13" stroke="red" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 17L4 17" stroke="red" strokeWidth="2" strokeLinecap="round" />
    </svg>
    <span>Report {selectedChat?.name}</span>
  </div>

  {/* Clear Chat */}
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 0',
      fontSize: '16px',
      color: 'red',
      cursor: 'pointer',
    }}
    onClick={() => {
      if (window.confirm(`Clear chat with ${selectedChat?.name}?`)) {
        setMessages((prev) => ({ ...prev, [selectedChat.id]: [] }));
      }
    }}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 6H5.586L17.586 6M19 6V19C19 20.1046 18.1046 21 17 21H7C5.89543 21 5 20.1046 5 19V6M19 6H17.586L13.586 6M13.586 6L11.586 6M11.586 6L9.586 6M9.586 6L7.586 6" stroke="red" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
    <span>Clear chat</span>
  </div>
</div>
<style jsx>{`
  .action-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0;
    cursor: pointer;
  }
  .action-row:hover {
    background: #f0f2f5;
    border-radius: 6px;
  }
`}</style>
      </div>
    </>
  )}
</div>
{/* Global Styles */}
<style jsx>{`
  .chat-container {
    display: flex;
    width: ${showContactInfo ? 'calc(100% - 400px)' : '100%'};
    transition: width 0.3s ease;
    position: relative;
    height: 100vh;
  }
`}</style>
 </>
  );
};


  


  return (
    <div className="dashboard-layout">
      {/* Left Sidebar (10%) - Desktop Only */}
      <aside className={`sidebar ${isSidebarExpanded ? 'expanded' : ''}`}>
  {/* ☰ Menu Toggle */}
  <button
    className="menu-toggle"
    onClick={() => setIsSidebarExpanded(prev => !prev)}
    aria-label="Toggle sidebar"
  >
    ☰
  </button>

  {/* Navigation Menu */}
  <nav className="nav-menu">
    {[
      { id: 'chats', label: 'Chats', icon: '💬' },
      { id: 'groups', label: 'Groups', icon: '👥' },
      { id: 'calls', label: 'Calls', icon: '📞' },
      { id: 'statuses', label: 'Status', icon: '📷' },
      { id: 'settings', label: 'Settings', icon: '⚙️' },
      { id: 'profile', label: 'Profile', icon: '👤' },
    ].map(item => (
      <button
        key={item.id}
        className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
        onClick={() => {
          setActiveTab(item.id);
          setSelectedChat(null);
         
          setIsSidebarExpanded(false); // ✅ Close sidebar on click
        }}
      >
        <span className="icon">{item.icon}</span>
        {/* Only show label when expanded */}
        <span className="label">{item.label}</span>
      </button>
    ))}
  </nav>
</aside>

      {/* Center Panel (30%) */}
<main className="center-panel">
  <h2 className="panel-title">
    {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
  </h2>

  {/* New Chat Trigger */}
  <button
    className="new-chat-trigger"
    onClick={() => setShowNewChatDropdown(prev => !prev)}
  >
    📝
  </button>

  {/* New Chat Dropdown */}
   {showNewChatDropdown && (
    <div className="new-chat-dropdown">
      <div className="new-chat-header">
        <h3>New Chat</h3>
      </div>
      <div className="new-chat-search">
        <input type="text" placeholder="Search" />
      </div>
     <div className="new-chat-actions">
  {/* New Group */}
  <button
    type="button"
    className="new-chat-action-item"
    onClick={() => alert('New Group')}
  >
    👥 New Group
  </button>

  {/* New Contact */}
  <button
    type="button"
    className="new-chat-action-item"
    onClick={() => {
      setShowNewChatDropdown(false);
      setShowNewContactModal(true);
      setEmail('');
      setFirstName('');
      setLastName('');
    }}
  >
    📞 New Contact
  </button>
</div>
      <div className="frequently-connected">
        <h4>Frequently Connected</h4>
        {chats.slice(0, 5).map(chat => (
          <div
            key={chat.id}
            className="frequent-item"
            onClick={() => {
              setSelectedChat(chat);
              setTimeout(markAsRead, 100); // small delay to ensure ref updates
              setShowNewChatDropdown(false);
            }}
          >
            <img src="https://via.placeholder.com/40" alt={chat.name} />
            <span>{chat.name}</span>
          </div>
        ))}
      </div>
    </div>
  )}

  {/* New Contact Modal */}
{showNewContactModal && (
  <div
    className="new-contact-modal-overlay"
    onClick={() => setShowNewContactModal(false)}
  >
    <div
      className="new-contact-modal"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="modal-header">
        <h3>New Contact</h3>
      </div>

      {/* Profile Picture Placeholder */}
      <div className="profile-placeholder">
        {email ? email[0].toUpperCase() : '?'}
      </div>

      {/* Form */}
      <div className="modal-body">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="modal-input"
        />
        <input
          type="text"
          placeholder="First name"
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          className="modal-input"
        />
        <input
          type="text"
          placeholder="Last name"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          className="modal-input"
        />
      </div>

      {/* Actions */}
      <div className="modal-actions">
        <button
          className="modal-btn cancel"
          onClick={() => setShowNewContactModal(false)}
        >
          Cancel
        </button>
        <button
  className="modal-btn save"
  disabled={!email}
  onClick={async () => {
  const foundUser = await findUserByEmail(email);
  if (!foundUser) {
    alert('User not found. Please enter a valid email.');
    return;
  }

  const newContact = {
    id: foundUser._id,
    name: `${firstName} ${lastName}`.trim() || foundUser.name,
    firstName,
    lastName,
    email: foundUser.email,
    photo: foundUser.photo || 'https://via.placeholder.com/50',
    lastMsg: '',
    time: '',
    online: false
  };

  // Inside onClick
setContacts(prev => {
  const exists = prev.some(c => c.id === newContact.id);
  if (exists) return prev;

  // ✅ Initialize empty messages for this contact
  setMessages(prevMsgs => ({
    ...prevMsgs,
    [newContact.id]: []
  }));

  const updated = [newContact, ...prev];
  localStorage.setItem('userContacts', JSON.stringify(updated));
  return updated;
});

  alert(`Contact added: ${newContact.name}`);
  setShowNewContactModal(false);
  setEmail('');
  setFirstName('');
  setLastName('');
}}
>
  Save
</button>
      </div>
    </div>
  </div>
)}

  {renderCenterContent()}
</main>

      {/* Right Panel (60%) - Chat View */}
      <section className="right-panel">
  {activeTab === 'chats' ? renderRightPanel() : (
    <div className="right-placeholder">
      <h3>Feature Coming Soon</h3>
      <p>The {activeTab} view is not available here.</p>
    </div>
  )}
</section>

     {/* Camera Capture Modal */}
{showCameraModal && !capturedPhoto && (
  <div className="camera-modal-overlay">
    <div className="camera-modal">
      {/* Header with Close Button */}
      <div className="camera-header">
        <button
          onClick={() => {
            // Stop camera stream
            if (videoRef.current && videoRef.current.srcObject) {
              const stream = videoRef.current.srcObject;
              stream.getTracks().forEach(track => track.stop());
            }
            // Close modal
            setShowCameraModal(false);
          }}
          aria-label="Close camera"
        >
          ❌
        </button>
        <h3>📸 Take a Photo</h3>
        <div style={{ width: 24 }}></div> {/* Spacer for alignment */}
      </div>

      {/* Camera View */}
      <div className="camera-container">
        <video
          ref={videoRef}
          autoPlay
          playsInline
        />
      </div>

      {/* Footer with Capture Button */}
      <div className="camera-footer">
        <button
          onClick={handleCapturePhoto}
          className="capture-btn"
          aria-label="Capture photo"
        >
          ●
        </button>
      </div>
    </div>
  </div>
)}

{/* Captured Photo Preview */}
{capturedPhoto && (
  <div className="photo-preview-overlay">
    <div className="photo-preview">
      <img src={capturedPhoto} alt="Captured" style={{ width: '100%', height: '70vh', objectFit: 'contain' }} />
      
      <div className="preview-actions">
        {!isEditing ? (
          <>
            <button onClick={() => setShowCropper(true)} className="edit-btn">✏️</button>
            <input
              type="text"
              placeholder="Add a caption..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="caption-input"
            />
            <button onClick={handleSendPhoto} className="send-btn">Send</button>
          </>
        ) : (
          <button onClick={() => setIsEditing(false)}>Done Editing</button>
        )}
      </div>
    </div>
  </div>
)}

{/* Image Cropper (Placeholder) */}
{showCropper && (
  <div className="cropper-overlay">
    <div className="cropper-modal">
      <h3>Crop Image</h3>
      <img src={capturedPhoto} alt="For cropping" style={{ width: '100%', maxHeight: '60vh', objectFit: 'contain' }} />
      <div className="cropper-actions">
        <button onClick={() => setShowCropper(false)}>Apply</button>
        <button onClick={() => setShowCropper(false)}>Cancel</button>
      </div>
    </div>
  </div>
)}

{/* Image Preview Modal */}
{previewImage && (
 <div
    className="image-preview-overlay"
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'white',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 30000,
      padding: '20px',
      boxSizing: 'border-box'
    }}
  >
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        overflow: 'hidden'
      }}
    >
      {/* Back Button */}
      <button
        onClick={() => setPreviewImage(null)}
        style={{
          position: 'absolute',
          top: 20,
          left: 20,
          background: 'rgba(0,0,0,0.5)',
          color: 'white',
          border: 'none',
          width: 40,
          height: 40,
          borderRadius: '50%',
          fontSize: '1.5rem',
          cursor: 'pointer',
          zIndex: 10
        }}
      >
        ←
      </button>

      {/* Three Dot Menu */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowDropdown((prev) => !prev);
        }}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          background: 'rgba(0,0,0,0.5)',
          color: 'white',
          border: 'none',
          width: 40,
          height: 40,
          borderRadius: '50%',
          fontSize: '1.5rem',
          cursor: 'pointer',
          zIndex: 11
        }}
        title="Options"
      >
        ⋯
      </button>

      {/* Dropdown */}
      {showDropdown && (
  <div
    className="menu-container" // ← Add this class
     ref={dropdownRef}
    style={{
      position: 'absolute',
      top: 70,
      right: 20,
      background: 'white',
      border: '1px solid #ccc',
      borderRadius: '6px',
      boxShadow: '0 4px 10px rgba(0,0,0,0.2)',
      zIndex: 12
    }}
    onClick={(e) => e.stopPropagation()}
  >
          <button
  onClick={(e) => {
    e.preventDefault(); // ← Prevent any default
    e.stopPropagation();
        setShowDropdown((prev) => !prev);

    if (!previewImage?.src) {
      alert('No image to save');
      return;
    }

    const fileName = previewImage.fileName || `image_${Date.now()}.jpg`;
    console.log('🎯 Save clicked', { src: previewImage.src, fileName: previewImage.fileName });
    // ✅ Direct base64 download
    const a = document.createElement('a');
    a.href = previewImage.src;
    a.download = fileName;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    

    console.log('✅ Download triggered:', fileName);
  }}
  style={{
    padding: '10px 16px',
    background: '#075e54',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.95rem',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left'
  }}
>
  💾 Save
</button>

        </div>
      )}

      {/* Image */}
      <img
        src={previewImage.src}
        alt="Full view"
        style={{
          maxHeight: '90vh',
          maxWidth: '90vw',
          objectFit: 'contain',
          borderRadius: '8px',
          boxShadow: '0 4px 20px rgba(0,0,0,0.2)'
        }}
      />

      {/* Caption */}
      {previewImage.caption && (
        <p
          style={{
            position: 'absolute',
            bottom: 20,
            left: 20,
            right: 20,
            color: 'black',
            fontSize: '1rem',
            textAlign: 'center',
            background: 'rgba(255,255,255,0.8)',
            padding: '8px',
            borderRadius: '6px'
          }}
        >
          {previewImage.caption}
        </p>
      )}
    </div>
  </div>
)}



{/* Delete Confirmation Modal */}
{deleting && (
  <div style={{
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20000
  }}>
    <div style={{
      background: 'white',
      padding: '20px',
      borderRadius: '12px',
      width: '90%',
      maxWidth: '400px'
    }}>
      <h4>🗑️ Delete Message</h4>
      <p>Do you want to delete this message?</p>
      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button
          onClick={() => {
            // Delete for everyone
            setMessages(prev => ({
              ...prev,
              [selectedChat.id]: prev[selectedChat.id].filter(m => m.id !== deleting.id)
            }));
            setDeleting(null);
          }}
          style={{ flex: 1, padding: '10px', background: '#075e54', color: 'white', border: 'none', borderRadius: '6px' }}
        >
          For Everyone
        </button>
        <button
          onClick={() => {
            // Delete for me
            setMessages(prev => ({
              ...prev,
              [selectedChat.id]: prev[selectedChat.id].filter(m => m.id !== deleting.id)
            }));
            setDeleting(null);
          }}
          style={{ flex: 1, padding: '10px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px' }}
        >
          For Me
        </button>
      </div>
    </div>
  </div>
)}

{/* Clear Chat Confirmation Modal */}
{showClearChatConfirm && (
  <div
    style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100vw',
      height: '100vh',
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 20000,
    }}
    onClick={() => setShowClearChatConfirm(false)} // Close on backdrop click
  >
    <div
      style={{
        background: 'white',
        padding: '24px',
        borderRadius: '12px',
        width: '90%',
        maxWidth: '400px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
      }}
      onClick={(e) => e.stopPropagation()} // Prevent closing when clicking inside
    >
      <h3 style={{ marginBottom: '12px', color: '#333' }}>🗑️ Clear Chat</h3>
      <p style={{ color: '#555', lineHeight: '1.5' }}>
        Are you sure you want to clear all messages with <strong>{selectedChat?.name}</strong>? This action cannot be undone.
      </p>
      <div
        style={{
          display: 'flex',
          gap: '12px',
          marginTop: '24px',
          justifyContent: 'flex-end',
        }}
      >
        <button
          onClick={() => setShowClearChatConfirm(false)}
          style={{
            padding: '10px 16px',
            background: '#f0f0f0',
            border: '1px solid #ddd',
            borderRadius: '6px',
            color: '#333',
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => {
            // ✅ Clear messages for this chat
            setMessages((prev) => {
              const updated = { ...prev, [selectedChat.id]: [] };
              localStorage.setItem('chatMessages', JSON.stringify(updated));
              return updated;
            });

            // ✅ Close the modal
            setShowClearChatConfirm(false);
          }}
          style={{
            padding: '10px 16px',
            background: '#075e54',
            color: 'white',
            border: 'none',
            borderRadius: '6px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Clear Chat
        </button>
      </div>
    </div>
  </div>
)}

     {/* ========== MOBILE-ONLY UI =========== */}
  <div className="mobile-ui">
    {/* Dynamic Mobile Content */}
    <main className="mobile-center-panel">
      {view === 'status' ? (
        <>
          {/* Status Header */}
          <div className="mobile-header">
            <h1>Status</h1>
            <button className="menu-btn">⋮</button>
          </div>
          {/* My Status */}
          <div className="status-section">
            <h2 className="section-title">My Status</h2>
            <div className="status-item my-status">
              <img src="https://via.placeholder.com/50/25D366/fff?text=+" alt="Add" />
              <div className="status-info">
                <h4>Tap to add status</h4>
                <p>Visible to everyone</p>
              </div>
            </div>
          </div>
          {/* Recent Updates */}
          <div className="status-section">
            <h2 className="section-title">Recent updates</h2>
            {statuses.map(status => (
              <div
                key={status.id}
                className="status-item"
                onClick={() => alert(`Viewing status from ${status.name}`)}
              >
                <img src="https://via.placeholder.com/50" alt={status.name} />
                <div className="status-info">
                  <h4>{status.name}</h4>
                  <p>{status.time}</p>
                </div>
              </div>
            ))}
          </div>
        </>
      
) : view === 'calls' ? (
  <>
    {/* Calls Header */}
    <div className="mobile-header">
      <h1>Calls</h1>
      <button className="menu-btn">⋮</button>
    </div>

    {/* Search Bar */}
    <div className="mobile-search">
      <input type="text" placeholder="Search" />
    </div>

   {/* Recent Calls Section */}
<div className="calls-section">
  <h2 className="section-title">Recent</h2>
  <div className="calls-list">
    {calls.map(call => (
      <div key={call.id} className="call-item">
        <img src="https://via.placeholder.com/50" alt={call.name} />
       <div className="call-info">
  <h4>{call.name}</h4>
  <p>
    {call.type === 'incoming' && 'Incoming'}
    {call.type === 'outgoing' && 'Outgoing'}
    {call.type === 'missed' && 'Missed'}
    {call.video && ' Video'}
  </p>
  <small style={{ color: '#888', fontSize: '0.9rem' }}>{call.time}</small>
</div>
<div className="call-icon">
  <span className={call.type === 'missed' ? 'missed' : ''} style={{ transform: call.type !== 'missed' ? 'scaleX(-1)' : 'none' }}>
    📞
  </span>
</div>
      </div>
    ))}
  </div>
</div>
  </>
) : (
  

        
        <>
          {/* Chats Header */}
          <div className="mobile-header">
            <h1>NexChat</h1>
            <div className="menu-container">
  <button
    className="menu-btn"
    onClick={() => setShowDropdown(prev => !prev)}
  >
    ⋮
  </button>

  

  {/* Dropdown Popup */}
  {showDropdown && (
    <div className="dropdown-menu">
      <button
  onClick={() => {
    setShowAddContact(true);
    setShowDropdown(false); // ✅ Close dropdown
  }}
>
  Add new contact
</button>
      <button onClick={() => setActiveTab('profile')}>
        Profile
      </button>
      <button onClick={() => alert('Settings')}>
        Settings
      </button>
      <button onClick={handleLogout}>
        Logout
      </button>
    </div>
  )}
</div>
          </div>
          {/* Search Bar */}
          <div className="mobile-search">
            <input type="text" placeholder="Search" />
          </div>
          {/* Tabs */}
          <div className="mobile-tabs">
            <button
              className={activeTab === 'chats' ? 'active' : ''}
              onClick={() => setActiveTab('chats')}
            >
              Chats
            </button>
            <button
              className={activeTab === 'groups' ? 'active' : ''}
              onClick={() => setActiveTab('groups')}
            >
              Groups
            </button>
            <button
              className={activeTab === 'unread' ? 'active' : ''}
              onClick={() => setActiveTab('unread')}
            >
              Unread
            </button>
          </div>
          {/* Chat List */}
          {renderCenterContent()}
        </>
      )}
    </main>

    {/* Bottom Nav */}
    <nav className="mobile-nav">
      <button onClick={() => {
  setView('chats');
  setActiveTab('chats'); // ✅ Ensure Chats is selected
}}>
  <span>💬</span>
  <small>Chats</small>
</button>
      <button onClick={() => setView('status')}>
        <span>📷</span>
        <small>Status</small>
      </button>
      <button onClick={() => {
  setView('calls');
  setActiveTab('calls');
}}>
  <span>📞</span>
  <small>Calls</small>
</button>
      <button onClick={() => {}}>
        <span>📷</span>
        <small>Camera</small>
      </button>
    </nav>
  </div>
{/* Add Contact Drawer */}
{showAddContact && (
  <div
    className="add-contact-drawer-overlay"
    onClick={() => setShowAddContact(false)}
  >
   <div
  className="add-contact-drawer"
  ref={drawerRef}
  onClick={(e) => e.stopPropagation()}
  style={{ transform: 'translateY(0)' }}
>
      {/* Header */}
      <div className="drawer-header">
        <button
          className="drawer-btn"
          onClick={() => setShowAddContact(false)}
        >
          Cancel
        </button>
        <h3>New Contact</h3>
        <button
          className="drawer-btn done"
          onClick={() => {
            alert('Contact saved!');
            setShowAddContact(false);
          }}
        >
          Done
        </button>
      </div>

      {/* Form */}
      <div className="drawer-body">
        <input
          type="text"
          placeholder="First name"
          className="drawer-input"
        />
        <input
          type="text"
          placeholder="Last name"
          className="drawer-input"
        />
        <input
          type="email"
          placeholder="Email (Gmail)"
          className="drawer-input"
        />
      </div>
    </div>
  </div>
)}
{/* ✅ Add this line here */}
<canvas ref={canvasRef} style={{ display: 'none' }} />

</div>
  );
}