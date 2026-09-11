// src/pages/DashboardPage.jsx

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import './dashboard.css';
import { io } from 'socket.io-client';
import { Search, X, CornerUpRight, CornerUpLeft, Phone, Video, Paperclip, Camera, Mic, User, FileText, Trash2, Copy, Forward, Reply, ArrowLeft, ChevronUp, ChevronDown, Info, MessageCircle, Users, Settings, Menu, SquarePen, Images, Image, PencilLine, Check, MicOff, VideoOff, Volume2 } from "lucide-react";
import { API_URL } from '../config.js';

const BLUE_TICK = '#53bdeb';

// WhatsApp-style delivery ticks: single grey = sent, double tick = delivered, blue = read.
function WhatsAppTicks({ read, delivered }) {
  return (
    <span className="wa-ticks" aria-label={read ? 'Read' : delivered ? 'Delivered' : 'Sent'}>
      <span className={`wa-tick ${read ? 'read' : ''}`}>✓</span>
      {delivered && <span className={`wa-tick ${read ? 'read' : ''}`}>✓</span>}
    </span>
  );
}

// Convert URLs in message text into clickable blue links.
function linkify(text) {
  if (!text) return text;
  const re = /(https?:\/\/[^\s]+)/g;
  const parts = String(text).split(re);
  return parts.map((p, i) =>
    i % 2 === 1
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="msg-link">{p}</a>
      : p
  );
}

// localStorage write that never crashes the UI on QuotaExceededError.
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn(`localStorage write failed for "${key}"`, err);
  }
}

// WhatsApp-style call-history row date ("today at 3:45 PM" / "yesterday at …" / "12 Mar at …")
function formatCallDate(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  let datePart;
  if (day === today) datePart = 'today';
  else if (day === today - 86400000) datePart = 'yesterday';
  else datePart = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  return `${datePart} at ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// Video status player with play/pause + progress (WhatsApp-style).
// Defined at module scope so it is not re-created (and re-mounted) on every
// parent render — a re-created inner component would restart the video.
const StatusVideoView = ({ src, onEnded }) => {
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = 0;
    const onTime = () => setProgress(v.duration ? v.currentTime / v.duration : 0);
    const onEnd = () => { setPlaying(false); setProgress(1); onEnded(); };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('ended', onEnd);
    v.play().catch(() => {});
    return () => {
      v.pause();
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('ended', onEnd);
    };
  }, [src]);
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.pause(); setPlaying(false); }
    else { v.play().catch(() => {}); setPlaying(true); }
  };
  return (
    <div
      className="status-video-wrap"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const cx = e.clientX - r.left;
        if (cx < r.width * 0.3 || cx > r.width * 0.7) return;
        e.stopPropagation();
        toggle();
      }}
    >
      <video ref={videoRef} src={src} className="status-viewer-video" muted playsInline preload="metadata" />
      <button className={`status-video-pause ${playing ? '' : 'paused'}`} aria-label={playing ? 'Pause' : 'Play'} onClick={(e) => { e.stopPropagation(); toggle(); }}>
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="status-video-progress">
        <span style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
      </div>
    </div>
  );
};

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('chats');
  const [view, setView] = useState('chats'); // ← Controls what screen to show: 'chats' or 'status'
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false); // ← New state
  const [selectedChat, setSelectedChat] = useState(null);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches
  );
  const [isTouchDevice, setIsTouchDevice] = useState(() =>
    typeof window !== 'undefined' &&
    (('ontouchstart' in window) || navigator.maxTouchPoints > 0)
  );
  const [mobileRecording, setMobileRecording] = useState(false);
  const [showMobileAttach, setShowMobileAttach] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showCallsMenu, setShowCallsMenu] = useState(false);
  const [showAddContact, setShowAddContact] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  const [showNewChatDropdown, setShowNewChatDropdown] = useState(false);
  const [showNewContactModal, setShowNewContactModal] = useState(false);
  // ✅ Group creation flow state
  const [showGroupFlow, setShowGroupFlow] = useState(false);
  const [groupStep, setGroupStep] = useState(1);
  const [groupSelectedContacts, setGroupSelectedContacts] = useState([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupDp, setGroupDp] = useState(null);
  const [slideClass, setSlideClass] = useState('');
  const [groupsList, setGroupsList] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [groupMessages, setGroupMessages] = useState({});
  const selectedGroupRef = useRef(null);
  const prefetchedGroupHistoryRef = useRef(new Set());
  const prefetchedHistoryRef = useRef(new Set());
  const contactsRef = useRef([]);
  const groupOpenAtRef = useRef(0);
  const groupsListRef = useRef([]);
  const groupMessageElsRef = useRef({});
  const groupUnreadScrollRef = useRef(null);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [chatSearchResults, setChatSearchResults] = useState([]);
  const [chatCurrentResultIndex, setChatCurrentResultIndex] = useState(-1);
  const chatCurrentMatchRef = useRef(null);
  const groupDropdownRef = useRef(null);
  const [groupDropdownPos, setGroupDropdownPos] = useState({ top: 0, right: 0, placement: 'bottom' });
  const [groupShowDropdown, setGroupShowDropdown] = useState(false);
  const [groupShowAttach, setGroupShowAttach] = useState(false);
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
  const mobileCurrentMatchRef = useRef(null);
  const mobileSearchInputRef = useRef(null);
  const groupMobileCurrentMatchRef = useRef(null);
  const longPressRef = useRef({ timer: null, active: false });
  const suppressClickRef = useRef(false);
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
  const [groupReplyTo, setGroupReplyTo] = useState(null); // { id, text, sender, from }
  const [deleting, setDeleting] = useState(null); // { id, timestamp }
  // delete flow: two-step confirmation for removing a single message
  // { chatType:'dm'|'group', chatId, msg, isMine } -> then phase 'options'|'confirm'
  const [deleteCmd, setDeleteCmd] = useState(null);
  const [deletePhase, setDeletePhase] = useState(''); // '' | 'options' | 'confirm'
  const [deleteForEveryone, setDeleteForEveryone] = useState(false);
  const [deleteFromSelection, setDeleteFromSelection] = useState(false); // deleting multiple selected messages (for me only)
  // clear chat: which chat to clear
  const [clearTarget, setClearTarget] = useState(null); // { chatType:'dm'|'group', chatId, name }
  const actionsMenuRef = useRef(null);
  const [openActionMenu, setOpenActionMenu] = useState(null); // ID of currently open menu
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, right: 0, placement: 'bottom' });
  const messageButtonRefs = useRef({});
  const [socket, setSocket] = useState(null);
  const selectedChatRef = useRef(selectedChat);
  const mobileChatOpenRef = useRef(mobileChatOpen);
  const isMobileRef = useRef(isMobile);
  const socketRef = useRef(null);
  const userRef = useRef(user);
  const lastStatusUpdate = useRef({});
  const [showClearChatConfirm, setShowClearChatConfirm] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState(new Set());
  const [mobileSearch, setMobileSearch] = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [mobileSearchResults, setMobileSearchResults] = useState([]);
  const [mobileSearchIndex, setMobileSearchIndex] = useState(-1);
  const [groupMobileSearch, setGroupMobileSearch] = useState(false);
  const [groupMobileSearchQuery, setGroupMobileSearchQuery] = useState('');
  const [groupMobileSearchResults, setGroupMobileSearchResults] = useState([]);
  const [groupMobileSearchIndex, setGroupMobileSearchIndex] = useState(-1);
  const [showSelDropdown, setShowSelDropdown] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');
  const [selectedForwardChats, setSelectedForwardChats] = useState(new Set());
  const [newMsgCount, setNewMsgCount] = useState(0);
  const messagesScrollRef = useRef(null);
  const lastDmChatRef = useRef(null);
  // ✅ Status feature (WhatsApp-style, mobile)
  const [statusFeed, setStatusFeed] = useState([]);
  const [statusAddSheet, setStatusAddSheet] = useState(false);
  const [statusComposerOpen, setStatusComposerOpen] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [statusCameraOpen, setStatusCameraOpen] = useState(false);
  const [statusCapture, setStatusCapture] = useState(null); // { dataUrl, caption } pending send
  const [statusCaptureCaption, setStatusCaptureCaption] = useState('');
  const [statusViewer, setStatusViewer] = useState(null); // { userId, index }
  const [statusReplyText, setStatusReplyText] = useState('');
  const [statusRecording, setStatusRecording] = useState(false);
  const [statusRecordSec, setStatusRecordSec] = useState(0);
  const [videoStatusEnded, setVideoStatusEnded] = useState(false);
  const statusVideoRef = useRef(null);
  const statusFileInputRef = useRef(null);
  const statusHoldTimerRef = useRef(null);
  const statusMediaRecorderRef = useRef(null);
  const statusMediaChunksRef = useRef([]);
  const statusRecordTimerRef = useRef(null);

  // -------- Calls (voice/video) state --------
  const [calls, setCalls] = useState([]);
  const [activeCall, setActiveCall] = useState(null); // { mode, type, callId, peerId, peerName, peerPhoto }
  const activeCallRef = useRef(null);
  const [callSpeakerMenuOpen, setCallSpeakerMenuOpen] = useState(false);
  const [callSpeakerOutput, setCallSpeakerOutput] = useState('speaker');
  const [callMicOn, setCallMicOn] = useState(true);
  const [callCamOn, setCallCamOn] = useState(true);
  const [callMinimized, setCallMinimized] = useState(false);
  const [mediaViewer, setMediaViewer] = useState(null); // { type:'dm'|'group', chatId, chatName, tab }
  const callStartAtRef = useRef(0);
  const pcRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const signalingRoleRef = useRef(''); // 'offerer' | 'answerer'
  const callPeerIdRef = useRef(null);
  const callIdRef = useRef(null);
  const ownVideoRef = useRef(null);
  const peerVideoRef = useRef(null);
  const callTimerRef = useRef(null);
  const peekReminderRef = useRef(null);
  // ---------- Group-call mesh ----------
  const groupPeersRef = useRef({});
  const groupStreamsRef = useRef({});
  const [groupTiles, setGroupTiles] = useState({});
  const [groupCallPage, setGroupCallPage] = useState(0);

  // Whether the messages list is scrolled to the latest message (within 60px).
  const isAtChatBottom = (el) => !!el && el.scrollHeight - el.scrollTop - el.clientHeight < 60;

  // Downscale a camera frame before encoding so captured photos stay small
  // enough to send reliably (>1MB base64 payloads used to get dropped).
  const MAX_PHOTO_EDGE = 1600;
  const captureScaledPhoto = (video, canvas) => {
    let w = video.videoWidth;
    let h = video.videoHeight;
    const max = Math.max(w, h);
    if (max > MAX_PHOTO_EDGE) {
      const scale = MAX_PHOTO_EDGE / max;
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    return canvas.toDataURL('image/jpeg', 0.85);
  };

  // New-message indicator helpers: a green pill shown just above the composer
  // while the user is scrolled up; clicking it jumps to the latest message.
  const handleChatScroll = () => {
    if (newMsgCount > 0 && isAtChatBottom(messagesScrollRef.current)) {
      setNewMsgCount(0);
    }
  };
  const jumpToLatest = () => {
    setNewMsgCount(0);
    requestAnimationFrame(() => {
      if (messagesEndRef.current) {
        messagesEndRef.current.scrollIntoView({ behavior: 'instant', block: 'end' });
      }
    });
  };

  // Never stay minimized after a call has ended
  useEffect(() => {
    if (!activeCall) setCallMinimized(false);
  }, [activeCall]);

  const clearLongPress = () => {
    if (longPressRef.current.timer) {
      clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
    longPressRef.current.active = false;
  };

  // ---------- Status (WhatsApp-style) ----------
  const timeAgo = (ts) => {
    if (!ts) return '';
    const d = Date.now() - Number(ts);
    if (d < 60 * 1000) return 'now';
    if (d < 60 * 60 * 1000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 24 * 60 * 60 * 1000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  // WhatsApp-style segmented ring behind a status avatar. The ring is split into
  // as many pieces as the user has statuses so the count is visible at a glance.
  const statusRingStyle = (count, seen) => {
    const color = seen ? '#cfd4da' : '#25D366';
    if (!count || count <= 1) return `conic-gradient(${color} 0deg 360deg)`;
    const gap = 5;
    const each = (360 - gap * count) / count;
    const stops = [];
    for (let i = 0; i < count; i++) {
      const start = i * (each + gap);
      stops.push(`${color} ${start}deg ${(start + each).toFixed(2)}deg`);
    }
    return `conic-gradient(${stops.join(', ')})`;
  };

  // Reusable circular (never oval) status avatar with a segmented ring.
  const StatusAvatar = ({ src, count, seen, size, style }) => (
    <div
      className="status-ring-avatar"
      style={{
        width: size || 50,
        height: size || 50,
        flexShrink: 0,
        borderRadius: '50%',
        background: statusRingStyle(count, seen),
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 3,
        boxSizing: 'border-box',
        ...(style || {}),
      }}
    >
      <img
        src={src}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </div>
  );

  const loadStatusFeed = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const res = await fetch(`${API_URL}/api/status/feed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data && Array.isArray(data.statuses)) {
        setStatusFeed(data.statuses);
      }
    } catch (err) {
      console.error('Failed to load status feed', err);
    }
  }, []);
  const loadStatusFeedRef = useRef(loadStatusFeed);
  useEffect(() => { loadStatusFeedRef.current = loadStatusFeed; });

  // Keep the feed fresh: on first load and every time the Status view opens.
  useEffect(() => {
    if (!user.id) return;
    loadStatusFeed();
  }, [user.id]);
  useEffect(() => {
    if (view === 'status') loadStatusFeed();
  }, [view]);

  // Derived, grouped status lists (flat feed -> groups by user)
  const myStatuses = (statusFeed || []).filter(
    s => s.user && String(s.user.id) === String(user.id)
  );
  const feedGroups = useMemo(() => {
    const map = new Map();
    (statusFeed || [])
      .filter(s => s.user && String(s.user.id) !== String(user.id))
      .forEach(s => {
        const key = String(s.user.id);
        const g = map.get(key);
        if (g) g.statuses.push(s);
        else map.set(key, { user: s.user, statuses: [s] });
      });
    return [...map.values()].sort(
      (a, b) => (b.statuses[0]?.createdAt || 0) - (a.statuses[0]?.createdAt || 0)
    );
  }, [statusFeed]);

  // Photo shown inside the "My status" ring: real profile photo before posting,
  // then the first (newest) posted status image once the user has statuses.
  const myStatusPhoto = myStatuses[0]?.file ||
    user.photo ||
    `https://via.placeholder.com/50/25D366/fff?text=${encodeURIComponent((user.name || '?')[0])}`;

  const postStatus = (type, text, bg, file) => {
    if (!socket || !socket.connected) {
      alert('Not connected yet. Please wait a moment.');
      return;
    }
    socket.emit('postStatus', { type, text: text || '', bg: bg || 'default', file: file || '' });
  };

  // Voice message bubble with play/pause, animated bars and live progress.
  const VoiceBubble = ({ msg }) => {
    const [playing, setPlaying] = useState(false);
    const [progress, setProgress] = useState(0);
    const [cur, setCur] = useState(0);
    const audioRef = useRef(null);
    useEffect(() => {
      const a = audioRef.current;
      if (!a) return;
      const onTime = () => { setCur(a.currentTime); setProgress(a.duration ? a.currentTime / a.duration : 0); };
      const onEnd = () => { setPlaying(false); setProgress(0); setCur(0); };
      a.addEventListener('timeupdate', onTime);
      a.addEventListener('ended', onEnd);
      return () => {
        a.removeEventListener('timeupdate', onTime);
        a.removeEventListener('ended', onEnd);
      };
    }, []);
    const toggle = () => {
      const a = audioRef.current;
      if (!a) return;
      if (playing) { a.pause(); setPlaying(false); }
      else { a.play().catch(() => {}); setPlaying(true); }
    };
    const total = Number(msg.duration) || 0;
    const secLabel = (s) => {
      const v = Math.max(0, Math.round(Number(s) || 0));
      return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
    };
    const bars = Array.from({ length: 22 }, (_, i) => 0.35 + (Math.abs(Math.sin(i * 1.15)) * 0.5) + ((i * 7919) % 37) / 90);
    return (
      <div className="voice-bubble" onClick={toggle} role="button" aria-label={playing ? 'Pause voice message' : 'Play voice message'}>
        <audio ref={audioRef} src={msg.file} preload="metadata" />
        <span className={`voice-play ${playing ? 'playing' : ''}`}>{playing ? '❚❚' : '▶'}</span>
        <span className="voice-bars">
          {bars.map((h, i) => (
            <span
              key={i}
              className={`bar ${playing ? 'active' : ''}`}
              style={{ height: `${Math.round(6 + h * 14)}px` }}
            />
          ))}
        </span>
        <span className="voice-dur">{secLabel(playing || progress > 0 ? cur : total)}</span>
      </div>
    );
  };

  const openStatusCamera = () => {
    setStatusCameraOpen(true);
    setTimeout(() => {
      if (statusVideoRef.current) {
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
          .then(stream => { statusVideoRef.current.srcObject = stream; })
          .catch(err => {
            console.error('❌ Status camera error:', err);
            alert('Unable to access camera');
            setStatusCameraOpen(false);
          });
      }
    }, 100);
  };

  const closeStatusCamera = () => {
    const stream = statusVideoRef.current?.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());
    setStatusRecording(false);
    setStatusRecordSec(0);
    clearInterval(statusRecordTimerRef.current);
    setStatusCameraOpen(false);
  };

  const startStatusRecording = () => {
    const video = statusVideoRef.current;
    const stream = video?.srcObject;
    if (!stream || !stream.getVideoTracks().length) return;
    let mime = '';
    if (typeof MediaRecorder !== 'undefined') {
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8')) mime = 'video/webm;codecs=vp8';
      else if (MediaRecorder.isTypeSupported('video/webm')) mime = 'video/webm';
    }
    try {
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 1500000 } : { videoBitsPerSecond: 1500000 });
      statusMediaRecorderRef.current = mr;
      statusMediaChunksRef.current = [];
      mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) statusMediaChunksRef.current.push(ev.data); };
      mr.onstop = () => {
        try {
          const blob = new Blob(statusMediaChunksRef.current, { type: mime || 'video/webm' });
          const reader = new FileReader();
          reader.onload = () => {
            const s = statusVideoRef.current?.srcObject;
            if (s) s.getTracks().forEach(t => t.stop());
            setStatusRecording(false);
            setStatusRecordSec(0);
            clearInterval(statusRecordTimerRef.current);
            setStatusCameraOpen(false);
            setStatusCapture({ dataUrl: reader.result, type: 'video' });
            setStatusCaptureCaption('');
          };
          reader.readAsDataURL(blob);
        } catch (err) {
          console.error('❌ Status video finalize error:', err);
        }
      };
      mr.start();
      statusMediaRecorderRef.current = mr;
      setStatusRecording(true);
      setStatusRecordSec(0);
      clearInterval(statusRecordTimerRef.current);
      statusRecordTimerRef.current = setInterval(() => {
        setStatusRecordSec((s) => {
          const n = s + 1;
          if (n >= 15) stopStatusRecording();
          return n;
        });
      }, 1000);
    } catch (err) {
      console.error('❌ MediaRecorder error:', err);
      alert('Video recording not supported on this device');
    }
  };

  const stopStatusRecording = () => {
    setStatusRecording(false);
    setStatusRecordSec(0);
    clearInterval(statusRecordTimerRef.current);
    const mr = statusMediaRecorderRef.current;
    if (mr && mr.state !== 'inactive') mr.stop();
  };

  // Tap = photo, press-and-hold = video recording.
  const statusCapturePointerDown = () => {
    statusHoldTimerRef.current = setTimeout(() => {
      if (typeof MediaRecorder !== 'undefined' && statusVideoRef.current?.srcObject) startStatusRecording();
    }, 350);
  };
  const statusCapturePointerUp = () => {
    clearTimeout(statusHoldTimerRef.current);
    if (statusRecording) stopStatusRecording();
    else captureStatusPhoto();
  };

  const captureStatusPhoto = () => {
    const video = statusVideoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (!video.videoWidth) {
      alert('Camera not ready yet. Please wait.');
      return;
    }
    const photoDataUrl = captureScaledPhoto(video, canvas);
    const stream = video.srcObject;
    if (stream) stream.getTracks().forEach(t => t.stop());
    setStatusCameraOpen(false);
    setStatusCapture({ dataUrl: photoDataUrl, type: 'image' });
    setStatusCaptureCaption('');
  };

  const onStatusFileChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setStatusCapture({ dataUrl: reader.result });
      setStatusCaptureCaption('');
      setStatusAddSheet(false);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const sendStatusImage = () => {
    if (!statusCapture || !statusCapture.dataUrl) return;
    postStatus(statusCapture.type === 'video' ? 'video' : 'image', statusCaptureCaption, 'default', statusCapture.dataUrl);
    setStatusCapture(null);
    setStatusCaptureCaption('');
    setStatusAddSheet(false);
  };

  const sendStatusText = () => {
    const txt = statusText.trim();
    if (!txt) return;
    postStatus('text', txt, 'default', '');
    setStatusText('');
    setStatusComposerOpen(false);
    setStatusAddSheet(false);
  };

  const sendStatusReply = (replyText) => {
    const txt = (replyText || statusReplyText).trim();
    if (!txt || !viewerUser || String(viewerUser.user.id) === String(user.id)) return;
    const targetId = viewerUser.user.id;
    const contact = contacts.find((c) => String(c.id) === String(targetId));
    const cur = currentStatusForViewer;
    const quoteText = (cur && (cur.text || (cur.type === 'video' ? '[Video]' : cur.type === 'image' ? '[Photo]' : '[Text]'))) || 'Status';
    setStatusReplyText('');
    setStatusViewer(null);
    if (!contact) {
      if (socket && socket.connected) {
        socket.emit('sendMessage', {
          to: targetId,
          message: txt || `Replied to their status: ${quoteText}`,
          file: '',
          fileName: '',
          fileType: '',
          from: user.id,
          fromName: user.name,
          fromPhoto: user.photo || '',
        });
      }
      return;
    }
    setSelectedChat(contact);
    setSelectedGroup(null);
    setMobileChatOpen(true);
    setActiveTab('chats');
    setReplyTo({ sender: viewerUser.user.name, text: `Status: ${quoteText}`, isStatus: true });
    setDesktopDraft(txt || '');
    setTimeout(() => {
      const el = isMobile ? document.querySelector('.mobile-compose textarea') : document.querySelector('.message-input input[type=text]');
      if (el) el.focus();
    }, 180);
  };

  const deleteCurrentStatus = () => {
    if (!statusViewer || !currentStatusForViewer) return;
    if (socket && socket.connected) {
      socket.emit('deleteStatus', { statusId: currentStatusForViewer._id });
    }
    setStatusViewer(null);
  };

  // The status currently shown in the full-screen viewer
  const viewerUser = useMemo(() => {
    if (!statusViewer) return null;
    if (String(statusViewer.userId) === String(user.id)) {
      return { user: { id: user.id, name: 'My status', photo: '' }, statuses: myStatuses };
    }
    return feedGroups.find(g => String(g.user.id) === String(statusViewer.userId)) || null;
  }, [statusViewer, feedGroups, myStatuses, user.id]);
  const currentStatusForViewer = viewerUser && viewerUser.statuses[statusViewer.index];

  // Mark a viewed status as read so the green ring turns grey.
  useEffect(() => {
    if (!statusViewer || !currentStatusForViewer || !currentStatusForViewer._id) return;
    if (currentStatusForViewer.user && String(currentStatusForViewer.user.id) === String(user.id)) return;
    fetch(`${API_URL}/api/status/${currentStatusForViewer._id}/view`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    }).catch(() => {});
    setStatusFeed(prev => {
      const i = prev.findIndex(s => s._id === currentStatusForViewer._id);
      if (i === -1 || prev[i].viewed) return prev;
      const next = [...prev];
      next[i] = { ...next[i], viewed: true };
      return next;
    });
  }, [currentStatusForViewer && currentStatusForViewer._id]);

  // Auto-advance the viewer every 5s (WhatsApp-style); close after the last one.
  // Video statuses only advance once playback has ended.
  useEffect(() => {
    if (!statusViewer || !viewerUser || !viewerUser.statuses.length) return;
    if (currentStatusForViewer?.type === 'video' && !videoStatusEnded) return;
    const timer = setTimeout(() => {
      setStatusViewer(prev => {
        if (!prev) return prev;
        const list = String(prev.userId) === String(user.id) ? myStatuses : feedGroups.find(g => String(g.user.id) === String(prev.userId))?.statuses || [];
        if (prev.index < list.length - 1) return { userId: prev.userId, index: prev.index + 1 };
        return null;
      });
    }, 5000);
    return () => clearTimeout(timer);
  }, [statusViewer && String(statusViewer.userId), statusViewer && statusViewer.index, currentStatusForViewer && currentStatusForViewer.type, videoStatusEnded]);

  useEffect(() => {
    setVideoStatusEnded(false);
  }, [statusViewer && String(statusViewer.userId), statusViewer && statusViewer.index]);

  const handleViewerTap = (e) => {
    if (!viewerUser || !statusViewer) return;
    const x = e.clientX;
    const w = window.innerWidth || document.documentElement.clientWidth;
    if (x < w * 0.5) {
      if (statusViewer.index > 0) setStatusViewer({ userId: statusViewer.userId, index: statusViewer.index - 1 });
    } else {
      if (statusViewer.index < viewerUser.statuses.length - 1) {
        setStatusViewer({ userId: statusViewer.userId, index: statusViewer.index + 1 });
      } else {
        setStatusViewer(null);
      }
    }
  };

  // Video status player with play/pause + progress (WhatsApp-style).

  const startLongPress = (onFire) => {
    clearLongPress();
    longPressRef.current.active = true;
    longPressRef.current.timer = setTimeout(() => {
      if (longPressRef.current.active) {
        suppressClickRef.current = true;
        onFire();
      }
    }, 400);
  };

  // ---------- Delete message (two-step) ----------
  // deleteCmd = { chatType:'dm'|'group', chatId, msg, isMine }
  const openDeleteFlow = (chatType, chatId, msg) => {
    const isMine = chatType === 'group'
      ? (String(msg.senderId) === String(user.id) || msg.sender === 'You')
      : (msg.sender === 'You' || String(msg.senderId) === String(user.id));
    setDeleteCmd({ chatType, chatId, msg, isMine });
    // sender's own message -> let them choose for-everyone vs for-me (two popups)
    // other party's message -> straight to confirm (delete for me only)
    setDeleteForEveryone(false);
    setDeletePhase(isMine ? 'options' : 'confirm');
    setShowSelDropdown(false);
  };

  const doDeleteForMe = (cmd) => {
    setMessages(prev => {
      const chatId = String(cmd.chatId);
      if (cmd.chatType === 'group') return prev;
      if (!prev[chatId]) return prev;
      const next = { ...prev, [chatId]: prev[chatId].filter(m => String(m.id) !== String(cmd.msg.id)) };
      safeSetItem('chatMessages', next);
      return next;
    });
    if (cmd.chatType === 'group') {
      setGroupMessages(prev => {
        const gid = String(cmd.chatId);
        return { ...prev, [gid]: (prev[gid] || []).filter(m => String(m.id) !== String(cmd.msg.id)) };
      });
    }
  };

  const openDeleteSelection = (chatType, chatId) => {
    setDeleteCmd({ chatType, chatId, msg: null, isMine: true });
    setDeleteFromSelection(true);
    setDeleteForEveryone(false);
    setDeletePhase('options');
  };

  const confirmDelete = () => {
    const cmd = deleteCmd;
    if (!cmd) return;
    if (deleteFromSelection && cmd.chatType === 'dm') {
      const ids = [...selectedMessages];
      if (deleteForEveryone) {
        const allDm = messages[String(cmd.chatId)] || [];
        allDm
          .filter((m) => ids.includes(m.id))
          .filter((m) => m.sender === 'You' || String(m.senderId) === String(user.id))
          .forEach((m) => socketRef.current?.emit('deleteMessage', { to: cmd.chatId, messageId: m.id, _id: m._id, forEveryone: true }));
      }
      setMessages((prev) => {
        const chatId = String(cmd.chatId);
        if (!prev[chatId]) return prev;
        const next = { ...prev, [chatId]: prev[chatId].filter((m) => !ids.includes(m.id)) };
        safeSetItem('chatMessages', next);
        return next;
      });
      setIsSelectionMode(false);
      setSelectedMessages(new Set());
      setDeleteCmd(null);
      setDeletePhase('');
      setDeleteFromSelection(false);
      return;
    }
    if (deleteFromSelection && cmd.chatType === 'group') {
      const ids = [...selectedMessages];
      if (deleteForEveryone) {
        const allGrp = groupMessages[String(cmd.chatId)] || [];
        allGrp
          .filter((m) => ids.includes(m.id))
          .filter((m) => m.sender === 'You' || String(m.senderId) === String(user.id))
          .forEach((m) => socketRef.current?.emit('deleteGroupMessage', { groupId: cmd.chatId, messageId: m.id, _id: m._id, forEveryone: true }));
      }
      setGroupMessages((prev) => {
        const gid = String(cmd.chatId);
        return { ...prev, [gid]: (prev[gid] || []).filter((m) => !ids.includes(m.id)) };
      });
      setIsSelectionMode(false);
      setSelectedMessages(new Set());
      setDeleteCmd(null);
      setDeletePhase('');
      setDeleteFromSelection(false);
      return;
    }
    if (deleteForEveryone) {
      // delete for everyone -> also tell the other side + server
      const payload = { messageId: cmd.msg.id, _id: cmd.msg._id };
      if (cmd.chatType === 'group') {
        socketRef.current?.emit('deleteGroupMessage', { groupId: cmd.chatId, messageId: cmd.msg.id, _id: cmd.msg._id, forEveryone: true });
      } else {
        socketRef.current?.emit('deleteMessage', { to: cmd.chatId, messageId: cmd.msg.id, _id: cmd.msg._id, forEveryone: true });
      }
      // remove from my own UI immediately (we optimistically removed mine already; re-run)
      if (cmd.chatType === 'group') {
        setGroupMessages(prev => {
          const gid = String(cmd.chatId);
          return { ...prev, [gid]: (prev[gid] || []).filter(m => String(m.id) !== String(cmd.msg.id)) };
        });
      } else {
        setMessages(prev => {
          const chatId = String(cmd.chatId);
          if (!prev[chatId]) return prev;
          const next = { ...prev, [chatId]: prev[chatId].filter(m => String(m.id) !== String(cmd.msg.id)) };
          safeSetItem('chatMessages', next);
          return next;
        });
      }
    } else {
      doDeleteForMe(cmd);
    }
    setDeleteCmd(null);
    setDeletePhase('');
  };

  // ---------- Clear chat ----------
  // clearTarget = { chatType:'dm'|'group', chatId, name }
  const confirmClearChat = () => {
    const t = clearTarget;
    if (!t) return;
    if (t.chatType === 'group') {
      socketRef.current?.emit('clearGroupChat', { groupId: t.chatId, forEveryone: false });
      setGroupMessages(prev => ({ ...prev, [String(t.chatId)]: [] }));
    } else {
      socketRef.current?.emit('clearChat', { to: t.chatId, forEveryone: false });
      setMessages(prev => {
        const next = { ...prev, [String(t.chatId)]: [] };
        safeSetItem('chatMessages', next);
        return next;
      });
    }
    setClearTarget(null);
    setShowClearChatConfirm(false);
  };




  const [contacts, setContacts] = useState([]);



  function formatLastSeen(date) {
  if (!date) return 'Unknown time';

  const now = new Date();
  const then = new Date(date);
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = diffMin / 60;
  const diffDays = diffHours / 24;

  if (diffSec < 60) return 'Last seen just now';
  if (diffMin < 60) return `Last seen ${diffMin} min ago`;
  if (diffHours < 24) return `Last seen ${Math.floor(diffHours)}h ago`;
  if (diffDays < 2) return 'Last seen yesterday';
  return `Last seen ${Math.floor(diffDays)} days ago`;
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

 const chatVisible = isMobileRef.current ? mobileChatOpenRef.current : true;
 if (!chatVisible) { console.warn("❌ markAsRead skipped (chat not visible)"); return; }


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
    safeSetItem('chatMessages', updated);
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
  mobileChatOpenRef.current = mobileChatOpen;
}, [mobileChatOpen]);

// Never leave the mobile chat overlay open without a selected chat,
// otherwise the panel leaks into the "Select a chat" empty state.
useEffect(() => {
  if (isMobileRef.current && !selectedChat?.id && !selectedGroup?.id) {
    setMobileChatOpen(false);
  }
}, [selectedChat?.id, selectedGroup?.id, isMobile]);

useEffect(() => {
  isMobileRef.current = isMobile;
}, [isMobile]);

useEffect(() => {
  if (socket) socketRef.current = socket;
}, [socket]);


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
      return <Image size={20} strokeWidth={1.8} />;
    }
    return <Paperclip size={20} strokeWidth={1.8} />;
  }

  if (fileType.startsWith('image/')) return <Image size={20} strokeWidth={1.8} />;
  if (fileType === 'application/pdf') return <FileText size={20} strokeWidth={1.8} />;
  if (fileType.includes('word') || fileName?.endsWith('.doc') || fileName?.endsWith('.docx')) return <FileText size={20} strokeWidth={1.8} />;
  if (fileType.includes('excel') || fileName?.endsWith('.xls') || fileName?.endsWith('.xlsx')) return <FileText size={20} strokeWidth={1.8} />;
  if (fileType.includes('powerpoint') || fileName?.endsWith('.ppt') || fileName?.endsWith('.pptx')) return <FileText size={20} strokeWidth={1.8} />;
  if (fileType === 'text/plain') return <FileText size={20} strokeWidth={1.8} />;
  return <Paperclip size={20} strokeWidth={1.8} />;
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

  // Convert to JPEG (downscaled so the payload stays under send limits)
  const photoDataUrl = captureScaledPhoto(video, canvas);

  // Stop camera stream
  const stream = video.srcObject;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
  }

  // Set captured photo
  setCapturedPhoto(photoDataUrl);
  setCaption('');
  console.log('✅ Photo captured');
};

// Close the camera modal and release the stream
const handleCloseCamera = () => {
  const stream = videoRef.current?.srcObject;
  if (stream) stream.getTracks().forEach(track => track.stop());
  videoRef.current = null;
  setShowCameraModal(false);
  setCapturedPhoto(null);
  setCaption('');
};

// Send photo
const handleSendPhoto = () => {
  if (!user.id) {
    alert('Not logged in');
    return;
  }
  if (!capturedPhoto || !socket) return;
  const isGroup = !!selectedGroup;
  if (!isGroup && !selectedChat) return;

  const messageText = caption;
  const tempId = `photo-${Date.now()}-${Math.random()}`;

  if (isGroup) {
    socket.emit('sendGroupMessage', {
      groupId: selectedGroup.id,
      message: messageText,
      file: capturedPhoto,
      fileName: 'photo.jpg',
      fileType: 'image/jpeg',
      from: user.id,
      fromName: user.name,
      timestamp: Date.now(),
      messageId: tempId,
    });

    setGroupMessages(prev => ({
      ...prev,
      [selectedGroup.id]: [
        ...(prev[selectedGroup.id] || []),
        {
          id: tempId,
          text: messageText,
          sender: 'You',
          senderId: user.id,
          timestamp: Date.now(),
          file: capturedPhoto,
          fileName: 'photo.jpg',
          fileType: 'image/jpeg',
          delivered: false,
          read: false,
        },
      ],
    }));

    setGroupsList(prev => {
      const exists = prev.some(g => String(g.id) === String(selectedGroup.id));
      return exists ? prev.map(g =>
        String(g.id) === String(selectedGroup.id)
          ? { ...g, lastMsg: 'You: 📷 Photo', lastTime: Date.now() }
          : g
      ) : prev;
    });
  } else {
    socket.emit('sendMessage', {
      to: selectedChat.id,
      message: messageText,
      file: capturedPhoto,
      fileName: 'photo.jpg',
      fileType: 'image/jpeg', // ✅ Send fileType
      from: user.id,
      fromName: user.name,
      fromPhoto: selectedChat.photo,
      messageId: tempId  // ✅ Now valid
    });

    setMessages(prev => {
      const updated = {
        ...prev,
        [selectedChat.id]: [
          ...(prev[selectedChat.id] || []),
          {
            id: tempId,
            text: messageText,
            sender: 'You',
            timestamp: Date.now(),
            file: capturedPhoto,
            fileName: 'photo.jpg',
            fileType: 'image/jpeg',
            delivered: false,
            read: false
          }
        ]
      };
      try {
        safeSetItem('chatMessages', updated);
      } catch (err) {
        console.warn('chatMessages quota exceeded', err);
      }
      return updated;
    });
  }

  // Reset
  setCapturedPhoto(null);
  setCaption('');
  setIsEditing(false);
};



  // Handle file selection
const handleFileChange = (e) => {
  const file = e.target.files[0];
  if (!file || !selectedChat || !socket) return;

  // Guard: base64 inflates size ~33%. Cap binary at 9 MB so the encoded
  // payload stays under the server's ~12 MB limit and Mongo's 16 MB doc cap.
  if (file.size > 9 * 1024 * 1024) {
    alert('This file is too large to send (max 9 MB).');
    if (fileInputRef.current) fileInputRef.current.value = '';
    return;
  }

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
      safeSetItem('chatMessages', updated);
      return updated;
    });

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  reader.readAsDataURL(file);
};

// ---------- Voice messages (hold-to-record) ----------
const [recDuration, setRecDuration] = useState(0);
const [desktopDraft, setDesktopDraft] = useState('');
const recTimerRef = useRef(null);
const recorderRef = useRef(null);
const recStreamRef = useRef(null);
const recChunksRef = useRef([]);
const recCancelRef = useRef(false);
const voiceTargetRef = useRef(null);
const recSecondsRef = useRef(0);
const recStartYRef = useRef(0);

const startVoiceRecord = (e) => {
  e?.preventDefault();
  if (recorderRef.current || !navigator.mediaDevices?.getUserMedia) return;
  const target = selectedGroup
    ? { kind: 'group', id: selectedGroup?.id }
    : selectedChat
      ? { kind: 'dm', id: selectedChat?.id }
      : null;
  if (!target) return;
  voiceTargetRef.current = target;
  recStartYRef.current = e?.clientY ?? 0;
  (async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : (MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : '');
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorderRef.current = rec;
      recChunksRef.current = [];
      recCancelRef.current = false;
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) recChunksRef.current.push(ev.data); };
      rec.onstop = () => {
        const audioBlob = new Blob(recChunksRef.current, { type: mimeType || 'audio/webm' });
        const durSec = Math.max(1, recSecondsRef.current || 1);
        recStreamRef.current?.getTracks().forEach(t => t.stop());
        recStreamRef.current = null;
        recorderRef.current = null;
        if (recCancelRef.current || audioBlob.size === 0) return;
        sendVoiceBlob(audioBlob, durSec);
      };
      rec.start();
      setMobileRecording(true);
      setRecDuration(0);
      recSecondsRef.current = 0;
      recTimerRef.current = setInterval(() => { recSecondsRef.current += 1; setRecDuration(d => d + 1); }, 1000);
    } catch (err) {
      console.error('Mic error', err);
      alert('Microphone not available. Recording requires permission.');
    }
  })();
};

const cancelVoiceRecord = () => {
  recCancelRef.current = true;
  stopVoiceRecord();
};

const stopVoiceRecord = (e) => {
  e?.preventDefault();
  // Swipe up to cancel (mobile): pointer moved more than 70px above start point.
  if (e && typeof e.clientY === 'number' && recStartYRef.current && (recStartYRef.current - e.clientY) > 70) {
    recCancelRef.current = true;
  }
  if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
  setMobileRecording(false);
  if (recorderRef.current && recorderRef.current.state !== 'inactive') {
    try { recorderRef.current.stop(); } catch (err) { console.error(err); }
  }
};

const sendVoiceBlob = (blob, durSec) => {
  if (!blob) return;
  const target = voiceTargetRef.current;
  if (!target) return;
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result;
    const tempId = `temp-${Date.now()}-${Math.random()}`;
    const fileName = `voice-${Date.now()}.webm`;
    const fileType = blob.type || 'audio/webm';
    if (target.kind === 'group') {
      socket.emit('sendGroupMessage', {
        groupId: target.id,
        message: '',
        file: base64,
        fileName,
        fileType,
        duration: durSec,
        messageId: tempId,
      });
      setGroupMessages(prev => ({
        ...prev,
        [target.id]: [
          ...(prev[target.id] || []),
          {
            id: tempId,
            text: '',
            sender: 'You',
            senderId: user.id,
            timestamp: Date.now(),
            file: base64,
            fileName,
            fileType,
            duration: durSec,
            delivered: true,
            read: false,
            allRead: false,
          },
        ],
      }));
      setDesktopDraft('');
      return;
    }
    socket.emit('sendMessage', {
      to: target.id,
      message: '',
      file: base64,
      fileName,
      fileType,
      duration: durSec,
      from: user.id,
      fromName: user.name,
      fromPhoto: selectedChat?.photo,
      messageId: tempId,
    });
    setMessages(prev => {
      const updated = {
        ...prev,
        [target.id]: [
          ...(prev[target.id] || []),
          {
            id: tempId,
            text: '',
            sender: 'You',
            timestamp: Date.now(),
            file: base64,
            fileName,
            fileType,
            duration: durSec,
            delivered: false,
            read: false,
          },
        ],
      };
      safeSetItem('chatMessages', updated);
      return updated;
    });
    setDesktopDraft('');
  };
  reader.readAsDataURL(blob);
};

// ==================== CALLS (voice/video) ====================
const loadCalls = useCallback(async () => {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    const res = await fetch(`${API_URL}/api/calls`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data && Array.isArray(data.calls)) setCalls(data.calls);
  } catch (err) {
    console.error('Failed to load calls', err);
  }
}, []);
useEffect(() => { loadCalls(); }, [loadCalls]);

// New-message indicator count resets whenever the open chat changes.
useEffect(() => {
  setNewMsgCount(0);
}, [selectedChat?.id, selectedGroup?.id]);

// Keep a group anchored to the latest message while the user is already at the
// bottom (outside the post-open history window). When scrolled up the
// new-message indicator is used instead of yanking the scroll position.
useEffect(() => {
  if (!selectedGroup) return;
  if (Date.now() - groupOpenAtRef.current < 5000) return;
  const end = messagesEndRef.current;
  if (end && isAtChatBottom(messagesScrollRef.current)) {
    end.scrollIntoView({ behavior: 'instant' });
  }
}, [selectedGroup, groupMessages]);

const callElapsed = () => (Date.now() - callStartAtRef.current) / 1000;

const fmtCallTime = (secs) => {
  const v = Math.max(0, Math.floor(Number(secs) || 0));
  const m = Math.floor(v / 60);
  return `${String(m).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
};

// Classify the shared media/links/docs for a chat (newest first). Used by the
// full-screen media viewer AND the contact/group info summaries so the counts
// always match the actual conversation data.
const classifyChatMessages = (src) => {
  const list = [...(src || [])].reverse();
  const hasFile = (m) => !!(m.file || m.dataUrl);
  const hasUrl = (m) => (m.text || m.message || '').match(/https?:\/\/|www\./);
  return {
    media: list.filter((m) => hasFile(m) && (m.type === 'image' || (m.fileType || '').startsWith('image') || (m.fileType || '').startsWith('video'))),
    links: list.filter((m) => hasUrl(m)),
    docs: list.filter((m) => hasFile(m) && (m.fileType || '') && !(m.fileType.startsWith('image')) && !(m.fileType.startsWith('video')) && !(m.fileType.startsWith('audio'))),
  };
};

const summarizeChatMedia = (src) => {
  const { media, links, docs } = classifyChatMessages(src);
  const total = media.length + links.length + docs.length;
  return total > 0
    ? `${media.length} media, ${links.length} links, ${docs.length} docs`
    : 'No media yet';
};

const cleanupCall = (soft) => {
  if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
  if (peekReminderRef.current) { clearTimeout(peekReminderRef.current); peekReminderRef.current = null; }
  try { pcRef.current?.close(); } catch (err) {}
  pcRef.current = null;
  if (localStreamRef.current) {
    localStreamRef.current.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }
  if (remoteStreamRef.current) {
    remoteStreamRef.current.getTracks().forEach((t) => t.stop());
    remoteStreamRef.current = null;
  }
  signalingRoleRef.current = '';
  callIdRef.current = null;
  callPeerIdRef.current = null;
  clearGroupCallState();
  if (!soft) setActiveCall(null);
};
useEffect(() => () => cleanupCall(true), []);

const createPeer = () => {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ],
  });
  pc.onicecandidate = (e) => {
    if (e.candidate && callPeerIdRef.current && callIdRef.current) {
      socket.emit('rtc:ice', {
        to: callPeerIdRef.current,
        callId: callIdRef.current,
        candidate: e.candidate.toJSON(),
      });
    }
  };
  pc.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    remoteStreamRef.current = stream;
    setTimeout(() => {
      const v = peerVideoRef.current;
      if (v && remoteStreamRef.current) {
        v.srcObject = remoteStreamRef.current;
        v.play().catch(() => {});
      }
    }, 100);
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected'].includes(pc.connectionState)) {
      // Fire a clean hangup so a drop never leaves the UI stuck.
      socket.emit('call:end', {
        to: callPeerIdRef.current,
        callId: callIdRef.current,
        type: activeCall?.type,
        durationSec: callElapsed(),
      });
      cleanupCall(false);
    }
  };
  return pc;
};

// ------------------ Group call mesh ------------------
const createGroupPeer = (peerId) => {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
    ],
  });
  pc.onicecandidate = (e) => {
    if (e.candidate && peerId && callIdRef.current) {
      socket.emit('rtc:ice', {
        to: peerId,
        callId: callIdRef.current,
        candidate: e.candidate.toJSON(),
      });
    }
  };
  pc.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    groupStreamsRef.current[peerId] = stream;
    setGroupTiles({ ...groupStreamsRef.current });
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected'].includes(pc.connectionState)) {
      delete groupStreamsRef.current[peerId];
      setGroupTiles({ ...groupStreamsRef.current });
    }
  };
  return pc;
};

// Join a group peer. Offerers connect/renegotiate to the newcomer; the
// newcomer (joiner) only answers so two sides never glare on the same pair.
const connectToGroupPeer = async (peerId, asOfferer = true) => {
  if (!localStreamRef.current || String(peerId) === String(user.id)) return;
  if (groupPeersRef.current[peerId]) return;
  const pc = createGroupPeer(peerId);
  groupPeersRef.current[peerId] = pc;
  try {
    addLocalTracks(pc, localStreamRef.current);
    if (asOfferer) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (callIdRef.current) {
        socket.emit('rtc:offer', { to: peerId, callId: callIdRef.current, sdp: pc.localDescription });
      }
    }
  } catch (err) {
    console.error('group connect error', err);
  }
};

const clearGroupCallState = () => {
  Object.values(groupPeersRef.current).forEach((pc) => { try { pc.close(); } catch (err) {} });
  groupPeersRef.current = {};
  Object.values(groupStreamsRef.current).forEach((s) => { try { s.getTracks().forEach((t) => t.stop()); } catch (err) {} });
  groupStreamsRef.current = {};
  setGroupTiles({});
  setGroupCallPage(0);
};

const getMediaStream = async (video) => {
  const constraints = video ? { video: { facingMode: 'user' }, audio: true } : { audio: true };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  return stream;
};

const initLocalVideo = () => {
  setTimeout(() => {
    const v = ownVideoRef.current;
    if (v && localStreamRef.current) {
      v.srcObject = localStreamRef.current;
      v.play().catch(() => {});
    }
  }, 50);
};

const addLocalTracks = (pc, stream) => {
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
};

const handleRemoteOffer = async (sdp) => {
  try {
    const pc = pcRef.current;
    if (!pc) createPeer();
    await pcRef.current.setRemoteDescription(sdp);
    const answer = await pcRef.current.createAnswer();
    await pcRef.current.setLocalDescription(answer);
    if (callPeerIdRef.current && callIdRef.current) {
      socket.emit('rtc:answer', {
        to: callPeerIdRef.current,
        callId: callIdRef.current,
        sdp: pcRef.current.localDescription,
      });
    }
  } catch (err) {
    console.error('answer error', err);
  }
};

const handleRemoteAnswer = async (sdp) => {
  try {
    const pc = pcRef.current;
    if (!pc) return;
    await pc.setRemoteDescription(sdp);
  } catch (err) {
    console.error('setRemote answer error', err);
  }
};

const sendOffer = async () => {
  try {
    const offer = await pcRef.current.createOffer();
    await pcRef.current.setLocalDescription(offer);
    if (callPeerIdRef.current && callIdRef.current) {
      socket.emit('rtc:offer', {
        to: callPeerIdRef.current,
        callId: callIdRef.current,
        sdp: pcRef.current.localDescription,
      });
    }
  } catch (err) {
    console.error('offer error', err);
  }
};

const startCall = async (type, chat) => {
  if (!socket || !chat) return;
  // Group chat (has a members roster) -> mesh group call.
  if (Array.isArray(chat.members) && chat.members.length > 0) {
    await startGroupCall(type, chat);
    return;
  }
  const callId = `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const peer = chat.photo && !chat.photo.includes('placeholder') ? chat.photo : 'https://via.placeholder.com/50';
  callPeerIdRef.current = String(chat.id);
  callIdRef.current = callId;
  callStartAtRef.current = Date.now();
  // Start media + peer connection immediately (like WhatsApp).
  try {
    const stream = await getMediaStream(type === 'video');
    localStreamRef.current = stream;
    pcRef.current = createPeer();
    addLocalTracks(pcRef.current, stream);
    if (type === 'video') initLocalVideo();
  } catch (err) {
    alert('Microphone/camera not available to start the call.');
    return;
  }
  socket.emit('call:invite', {
    to: chat.id,
    type,
    callId,
    name: user.name,
    photo: user.photo || '',
  });
  setActiveCall({
    mode: 'outgoing',
    type,
    callId,
    peerId: String(chat.id),
    peerName: chat.name,
    peerPhoto: peer,
    callerId: user.id,
  });
  // If nobody answers within 30s, auto-cancel (missed call).
  peekReminderRef.current = setTimeout(() => {
    if (activeCallRef.current?.mode === 'outgoing' && String(activeCallRef.current.callId) === String(callId)) {
      socket.emit('call:timeout', { to: callPeerIdRef.current, callId, type });
      cleanupCall(false);
      loadCalls();
    }
  }, 30000);
};

// Rings every member. Roster peers wire up over rtc:offer/answer on the fly.
const startGroupCall = async (type, group) => {
  if (!socket) return;
  const callId = `gcall-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const memberIds = (group.members || [])
    .map((m) => String(((m && (m._id || m.id)) || m) || ''))
    .filter((x) => x && String(x) !== String(user.id));
  callIdRef.current = callId;
  callPeerIdRef.current = null;
  callStartAtRef.current = Date.now();
  try {
    const stream = await getMediaStream(type === 'video');
    localStreamRef.current = stream;
    if (type === 'video') initLocalVideo();
  } catch (err) {
    alert('Microphone/camera not available to start the call.');
    return;
  }
  socket.emit('call:inviteGroup', {
    groupId: group.id,
    type,
    callId,
    name: group.name,
    photo: user.photo || '',
    memberIds,
  });
  setActiveCall({
    mode: 'outgoing',
    type,
    callId,
    group: true,
    groupId: group.id,
    peerId: null,
    peerName: group.name,
    peerPhoto: group.dp || 'https://via.placeholder.com/50',
    callerId: user.id,
  });
  // Nobody joined within 30s -> cancel the ring (logs a missed group call).
  peekReminderRef.current = setTimeout(() => {
    if (
      activeCallRef.current?.mode === 'outgoing' &&
      activeCallRef.current?.group &&
      String(activeCallRef.current.callId) === String(callId) &&
      Object.keys(groupPeersRef.current).length === 0
    ) {
      socket.emit('call:groupTimeout', { groupId: group.id, callId, type, callerName: user.name });
      cleanupCall(false);
      loadCalls();
    }
  }, 30000);
};

const acceptCall = async () => {
  if (!activeCall) return;
  const call = activeCall;
  if (call.group) {
    callIdRef.current = call.callId;
    callStartAtRef.current = Date.now();
    try {
      const stream = localStreamRef.current || (await getMediaStream(call.type === 'video'));
      localStreamRef.current = stream;
      if (call.type === 'video') initLocalVideo();
    } catch (err) {
      alert('Media could not be started (allow camera/microphone).');
      cleanupCall(false);
      return;
    }
    socket.emit('call:acceptGroup', { to: String(call.callerId), callId: call.callId, type: call.type });
    setActiveCall({ ...call, mode: 'active' });
    return;
  }
  const peerId = String(call.peerId);
  callPeerIdRef.current = peerId;
  callIdRef.current = call.callId;
  callStartAtRef.current = Date.now();
  signalingRoleRef.current = 'answerer';
  socket.emit('call:accept', { to: peerId, callId: call.callId, type: call.type });
  try {
    const stream = localStreamRef.current || (await getMediaStream(call.type === 'video'));
    localStreamRef.current = stream;
    pcRef.current = createPeer();
    addLocalTracks(pcRef.current, stream);
    if (call.type === 'video') initLocalVideo();
    setActiveCall({ ...call, mode: 'active' });
  } catch (err) {
    alert('Media could not be started (allow camera/microphone).');
    cleanupCall(false);
  }
};

const rejectCall = () => {
  if (activeCall) {
    if (!activeCall.group) {
      socket.emit('call:reject', {
        to: String(activeCall.peerId),
        callId: activeCall.callId,
        type: activeCall.type,
      });
    }
  }
  cleanupCall(false);
};

const hangupCall = () => {
  if (activeCall) {
    if (activeCall.group) {
      socket.emit('call:groupEnd', {
        groupId: activeCall.groupId,
        callId: activeCall.callId,
        type: activeCall.type,
        durationSec: callElapsed(),
        callerName: user.name,
      });
    } else {
      socket.emit('call:end', {
        to: String(activeCall.peerId),
        callId: activeCall.callId,
        type: activeCall.type,
        durationSec: callElapsed(),
      });
    }
  }
  cleanupCall(false);
  loadCalls();
};

const toggleMuteCall = () => {
  const stream = localStreamRef.current;
  if (!stream) return;
  const en = !stream.getAudioTracks().some((t) => !t.enabled);
  stream.getAudioTracks().forEach((t) => { t.enabled = !en; });
  if (callPeerIdRef.current && callIdRef.current) {
    socket.emit('call:state', {
      to: callPeerIdRef.current,
      callId: callIdRef.current,
      cameraOn: stream.getVideoTracks().some((t) => t.enabled),
      micOn: !en,
    });
  }
  return !en;
};

const toggleCameraCall = () => {
  const stream = localStreamRef.current;
  if (!stream) return false;
  const vTracks = stream.getVideoTracks();
  if (vTracks.length === 0) return false;
  const on = vTracks.every((t) => t.enabled);
  vTracks.forEach((t) => { t.enabled = !on; });
  if (callPeerIdRef.current && callIdRef.current) {
    socket.emit('call:state', {
      to: callPeerIdRef.current,
      callId: callIdRef.current,
      cameraOn: !on,
      micOn: stream.getAudioTracks().some((t) => t.enabled),
    });
  }
  return !on;
};

const switchCameraCall = async () => {
  const stream = localStreamRef.current;
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  try {
    const next = track.getSettings?.().facingMode === 'user' ? 'environment' : 'user';
    await track.applyConstraints({ facingMode: next });
  } catch (err) {
    console.error('switch camera error', err);
  }
};

const upgradeToVideo = async () => {
  try {
    const vStream = await getMediaStream(true);
    const pc = pcRef.current;
    if (!pc) return;
    const old = localStreamRef.current;
    old?.getTracks().forEach((t) => { if (t.kind === 'video') t.stop(); });
    const vTrack = vStream.getVideoTracks()[0];
    const aTrack = vStream.getAudioTracks()[0];
    if (aTrack) aTrack.stop();
    pc.addTrack(vTrack, old || vStream);
    localStreamRef.current = old || vStream;
    setActiveCall((prev) => (prev ? { ...prev, type: 'video' } : prev));
    initLocalVideo();
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (callPeerIdRef.current && callIdRef.current) {
      socket.emit('rtc:offer', {
        to: callPeerIdRef.current,
        callId: callIdRef.current,
        sdp: pc.localDescription,
      });
    }
  } catch (err) {
    alert('Camera unavailable to switch to video.');
  }
};

useEffect(() => {
  const s = socketRef.current;
  if (!s) return;

  const onIncoming = (data) => {
    // Already in a call -> politely refuse new incoming calls.
    if (activeCallRef.current) {
      s.emit('call:reject', { to: data.from, callId: data.callId, type: data.type });
      return;
    }
    callPeerIdRef.current = String(data.from);
    callIdRef.current = data.callId;
    callStartAtRef.current = Date.now();
    // Pre-block microphone so the accepted call starts cleanly.
    getMediaStream(data.type === 'video').then((stream) => {
      localStreamRef.current = stream;
      if (data.type === 'video') initLocalVideo();
    }).catch(() => {});
    signalingRoleRef.current = 'answerer';
    setActiveCall({
      mode: 'incoming',
      type: data.type,
      callId: data.callId,
      peerId: String(data.from),
      peerName: data.fromName,
      peerPhoto: data.fromPhoto || 'https://via.placeholder.com/50',
    });
  };

  const onAccepted = (data) => {
    if (!activeCallRef.current || String(activeCallRef.current.callId) !== String(data.callId)) return;
    // Group call: the caller just needs to flip to active; peer wiring happens
    // via call:memberJoined / call:groupJoined as members come in.
    if (activeCallRef.current.group) {
      setActiveCall((prev) => (prev ? { ...prev, mode: 'active' } : prev));
      if (activeCallRef.current?.type === 'video') initLocalVideo();
      return;
    }
    if (!pcRef.current) {
      // Wire the 3GPP-local stream into the peer connection.
      if (localStreamRef.current) {
        pcRef.current = createPeer();
        addLocalTracks(pcRef.current, localStreamRef.current);
      } else {
        return;
      }
    }
    signalingRoleRef.current = 'offerer';
    setActiveCall((prev) => (prev ? { ...prev, mode: 'active' } : prev));
    if (activeCallRef.current?.type === 'video') initLocalVideo();
    setTimeout(sendOffer, 250);
  };

  const onOffer = async (data) => {
    if (callIdRef.current && String(data.callId) !== String(callIdRef.current)) return;
    if (activeCallRef.current?.group) {
      let pc = groupPeersRef.current[data.from];
      if (!pc) {
        if (!localStreamRef.current) {
          localStreamRef.current = await getMediaStream(activeCallRef.current?.type === 'video').catch(() => null);
        }
        if (!localStreamRef.current) return;
        pc = createGroupPeer(data.from);
        groupPeersRef.current[data.from] = pc;
        addLocalTracks(pc, localStreamRef.current);
        if (activeCallRef.current?.type === 'video') initLocalVideo();
      }
      try {
        await pc.setRemoteDescription(data.sdp);
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        socket.emit('rtc:answer', { to: data.from, callId: data.callId, sdp: pc.localDescription });
      } catch (err) {
        console.error('group answer error', err);
      }
      return;
    }
    if (!pcRef.current) {
      if (!localStreamRef.current) {
        localStreamRef.current = await getMediaStream(activeCallRef.current?.type === 'video').catch(() => null);
      }
      if (!localStreamRef.current) return;
      pcRef.current = createPeer();
      addLocalTracks(pcRef.current, localStreamRef.current);
      if (activeCallRef.current?.type === 'video') initLocalVideo();
    }
    await handleRemoteOffer(data.sdp);
  };

  const onAnswer = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    if (activeCallRef.current?.group) {
      try { groupPeersRef.current[data.from]?.setRemoteDescription(data.sdp); } catch (err) { console.error('group answer set error', err); }
      return;
    }
    handleRemoteAnswer(data.sdp);
  };

  const onIce = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    if (activeCallRef.current?.group) {
      try { groupPeersRef.current[data.from]?.addIceCandidate(data.candidate); } catch (err) {}
      return;
    }
    try {
      pcRef.current?.addIceCandidate(data.candidate);
    } catch (err) {
      console.error('ice error', err);
    }
  };

  // ---- Group-call events ----
  const onGroupIncoming = (data) => {
    if (activeCallRef.current) {
      s.emit('call:reject', { to: data.from, callId: data.callId, type: data.type });
      return;
    }
    callIdRef.current = data.callId;
    callStartAtRef.current = Date.now();
    getMediaStream(data.type === 'video').then((stream) => {
      if (String(callIdRef.current) === String(data.callId)) {
        localStreamRef.current = stream;
        if (data.type === 'video') initLocalVideo();
      }
    }).catch(() => {});
    setActiveCall({
      mode: 'incoming',
      type: data.type,
      callId: data.callId,
      group: true,
      groupId: data.groupId,
      callerId: String(data.from),
      peerId: null,
      peerName: data.groupName || 'Group call',
      peerPhoto: data.fromPhoto || 'https://via.placeholder.com/50',
    });
  };

  const onGroupJoined = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    // This member just joined: answer offers from existing participants.
    (data.members || []).forEach((m) => connectToGroupPeer(String(m.id), false));
  };

  const onMemberJoined = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    if (String(data.userId) === String(user.id)) return;
    // Someone joined mid-call: we (an existing participant) offer to them.
    connectToGroupPeer(String(data.userId), true);
  };

  const onMemberLeft = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    try { groupPeersRef.current[data.userId]?.close(); } catch (err) {}
    delete groupPeersRef.current[data.userId];
    delete groupStreamsRef.current[data.userId];
    setGroupTiles({ ...groupStreamsRef.current });
  };

  const onRejected = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    cleanupCall(false);
  };

  const onEnded = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    cleanupCall(false);
    loadCalls();
  };

  const onTimedOut = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    cleanupCall(false);
    loadCalls();
  };

  const onState = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    setActiveCall((prev) => (prev ? { ...prev, peerCameraOn: data.cameraOn, peerMicOn: data.micOn } : prev));
  };

  s.on('call:incoming', onIncoming);
  s.on('call:accepted', onAccepted);
  s.on('rtc:offer', onOffer);
  s.on('rtc:answer', onAnswer);
  s.on('rtc:ice', onIce);
  s.on('call:rejected', onRejected);
  s.on('call:ended', onEnded);
  s.on('call:endedLocal', (data) => { if (String(data.callId) === String(callIdRef.current)) { cleanupCall(false); loadCalls(); } });
  s.on('call:timedOut', onTimedOut);
  s.on('call:state', onState);
  s.on('call:historyUpdated', loadCalls);
  s.on('call:groupIncoming', onGroupIncoming);
  s.on('call:groupJoined', onGroupJoined);
  s.on('call:memberJoined', onMemberJoined);
  s.on('call:memberLeft', onMemberLeft);

  // Elapsed-time counter for ongoing calls.
  callTimerRef.current = setInterval(() => {
    if (activeCallRef.current?.mode === 'active' && callStartAtRef.current) {
      setActiveCall((prev) => (prev ? { ...prev, elapsed: callElapsed() } : prev));
    } else if (activeCallRef.current?.mode === 'incoming') {
      setActiveCall((prev) => (prev ? { ...prev, elapsed: callElapsed() } : prev));
    }
  }, 1000);

  return () => {
    s.off('call:incoming', onIncoming);
    s.off('call:accepted', onAccepted);
    s.off('rtc:offer', onOffer);
    s.off('rtc:answer', onAnswer);
    s.off('rtc:ice', onIce);
    s.off('call:rejected', onRejected);
    s.off('call:ended', onEnded);
    s.off('call:endedLocal');
    s.off('call:timedOut', onTimedOut);
    s.off('call:state', onState);
    s.off('call:historyUpdated', loadCalls);
    s.off('call:groupIncoming', onGroupIncoming);
    s.off('call:groupJoined', onGroupJoined);
    s.off('call:memberJoined', onMemberJoined);
    s.off('call:memberLeft', onMemberLeft);
    if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
  };
}, [socket]);

useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);





useEffect(() => {
  const handleClickOutside = (e) => {
    if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
      setShowDropdown(false);
    }
  };

  document.addEventListener('mousedown', handleClickOutside);
  return () => document.removeEventListener('mousedown', handleClickOutside);
}, []);

// Every three-dot / popup menu closes on an outside click.
useEffect(() => {
  const closeMenus = (e) => {
    if (e.target.closest('.group-menu-btn') || e.target.closest('.chat-menu-dropdown') || e.target.closest('.menu-container') || e.target.closest('.new-chat-dropdown')) {
      return;
    }
    setShowMobileMenu(false);
    setShowCallsMenu(false);
    setShowNewChatDropdown(false);
    setGroupShowDropdown(false);
  };
  document.addEventListener('mousedown', closeMenus);
  return () => document.removeEventListener('mousedown', closeMenus);
}, []);



useEffect(() => {
  if (currentResultIndex === -1 || !currentMatchRef.current) return;
  currentMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
}, [currentResultIndex]);

useEffect(() => {
  if (mobileSearchIndex === -1 || !mobileCurrentMatchRef.current) return;
  mobileCurrentMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
}, [mobileSearchIndex, mobileSearchQuery]);

useEffect(() => {
  if (groupMobileSearchIndex === -1 || !groupMobileCurrentMatchRef.current) return;
  groupMobileCurrentMatchRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
}, [groupMobileSearchIndex, groupMobileSearchQuery]);

 

  
  
  
  


useEffect(() => {
  const saved = localStorage.getItem('chatMessages');
  console.log('📁 Messages on load:', saved ? Object.keys(JSON.parse(saved)) : 'none');
}, []);

  // Auto-scroll to the latest message for the open DM — always when the chat
  // was just opened; otherwise only when the user is already at the bottom so
  // an incoming message never yanks them away from older messages (the
  // new-message indicator covers the scrolled-up case).
useEffect(() => {
  const id = selectedChat ? String(selectedChat.id) : null;
  const switched = lastDmChatRef.current !== id;
  lastDmChatRef.current = id;
  if (!id) return;
  const end = messagesEndRef.current;
  if (!end) return;
  if (switched || isAtChatBottom(messagesScrollRef.current)) {
    end.scrollIntoView({ behavior: 'instant' });
  }
}, [selectedChat, messages]);

  // Scroll a just-opened group to the oldest unread message if there are
  // unread messages (WhatsApp-style); otherwise to the latest (bottom).
  const scrollGroupOpen = () => {
    const targetId = groupUnreadScrollRef.current;
    let el = targetId ? groupMessageElsRef.current[targetId] : null;
    if (!el && targetId && typeof document !== 'undefined') {
      el = document.querySelector(`.messages [data-msgid="${CSS.escape(targetId)}"]`);
    }
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'start' });
    } else if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
    }
  };

useEffect(() => {
  if (selectedGroup) {
    groupOpenAtRef.current = Date.now();
    requestAnimationFrame(() => scrollGroupOpen());
  }
}, [selectedGroup]);

  // Re-position when the user tabs back into the Groups view. The messages
  // panel remounts on tab switches (resetting scrollTop to the top), so restore
  // the unread/latest position instead of leaving the conversation at the top.
useEffect(() => {
  if (activeTab === 'groups' && selectedGroup) {
    requestAnimationFrame(() => scrollGroupOpen());
  }
}, [activeTab, selectedGroup]);

  // History is loaded asynchronously (via socket) after a group opens,
  // so re-scroll shortly after open while history is still arriving so the
  // oldest unread / latest message becomes visible. This window also keeps
  // later incoming messages from yanking the user away.
useEffect(() => {
  if (!selectedGroup) return;
  const gid = selectedGroup.id;
  const msgs = groupMessages[gid] || [];
  if (msgs.length && Date.now() - groupOpenAtRef.current < 5000) {
    requestAnimationFrame(() => scrollGroupOpen());
  }
}, [groupMessages, selectedGroup]);

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

 const newSocket = io(API_URL, {
  auth: { token },
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
  timeout: 5000,
  transports: ['websocket', 'polling']
});

   // ✅ Add: Listen for user status updates

// Inside useEffect where you set up socket
newSocket.on('messageDelivered', ({ chatId, messageId, _id }) => {
  console.log('📩 Message delivered to recipient', { chatId, messageId });
  setMessages(prev => {
    const chat = prev[chatId] || [];
    const updatedChat = chat.map(msg =>
      (msg.id === messageId || msg.localId === messageId || msg.id === _id)
        ? { ...msg, delivered: true, id: _id || msg.id, localId: messageId || msg.localId }
        : msg
    );
    const updated = { ...prev, [chatId]: updatedChat };
    safeSetItem('chatMessages', updated);
    return updated;
  });
});

// If the server rejects a message (e.g. an oversized attachment), surface it
// instead of silently dropping the send.
newSocket.on('messageSendError', (err) => {
  console.error('❌ Message send failed:', err);
  if (err && err.message) alert(err.message);
});

// ✅ 1:1 conversation history (server-authoritative) — lets every device of
//    the same account rebuild identical conversation state on connect/open.
newSocket.on('messagesHistory', ({ chatId, messages }) => {
  const cid = String(chatId);
  if (!Array.isArray(messages)) return;
  setMessages(prev => {
    const existing = prev[cid] || [];
    const fresh = messages.map(m => ({
      id: m._id?.toString() || m.messageId || `dm-${m.timestamp}`,
      localId: m.messageId || null,
      text: m.message,
      sender: String(m.from) === user.id ? 'You' : (m.fromName || 'Unknown'),
      senderId: String(m.from),
      timestamp: m.timestamp || Date.now(),
      file: m.file,
      fileName: m.fileName,
      fileType: m.fileType,
      duration: m.duration,
      replyTo: m.replyTo ? { sender: m.replyTo.sender, text: m.replyTo.text, messageId: m.replyTo.messageId } : null,
      photo: m.fromPhoto || 'https://placehold.co/50x50',
      delivered: m.delivered,
      read: !!m.read,
    }));
    // Merge: server copies (fresh) win over local copies with the same id/localId.
    const seen = new Map();
    existing.forEach(m => seen.set(m.localId || m.id, m));
    fresh.forEach(m => seen.set(m.localId || m.id, m));
    const ordered = [...seen.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const idsCmp = (arr) => arr.map(m => m.localId || m.id).join('|');
    if (existing.length === ordered.length && idsCmp(existing) === idsCmp(ordered)) return prev;
    return { ...prev, [cid]: ordered };
  });
});

// ✅ Cross-device read-state sync: another device of THIS account read this
//    conversation, so clear the unread badge / mark received messages read.
newSocket.on('conversationRead', ({ chatId }) => {
  const cid = String(chatId);
  setMessages(prev => {
    const chat = prev[cid];
    if (!chat || !chat.some(m => m.sender !== 'You' && !m.read)) return prev;
    const updated = { ...prev, [cid]: chat.map(m => m.sender !== 'You' ? { ...m, read: true } : m) };
    safeSetItem('chatMessages', updated);
    return updated;
  });
});

newSocket.on('userStatus', (data) => {
  const now = Date.now();
  const last = lastStatusUpdate.current[data.userId] || 0;
  const MIN_INTERVAL = 1000; // 1 second

  if (now - last < MIN_INTERVAL) return; // Ignore rapid updates

  lastStatusUpdate.current[data.userId] = now;

  const targetId = String(data.userId);

  setContacts(prev => prev.map(c =>
    c && String(c.id) === targetId
      ? {
          ...c,
          online: data.isOnline,
          lastSeen: data.isOnline ? c.lastSeen : data.lastSeen
        }
      : c
  ).filter(Boolean));

  if (String(selectedChat?.id) === targetId) {
    setSelectedChat(prev =>
      prev
        ? {
            ...prev,
            online: data.isOnline,
            lastSeen: data.isOnline ? prev.lastSeen : data.lastSeen
          }
        : prev
    );
  }
});

// ✅ Initial snapshot of already-online users (sent once on connect)
newSocket.on('userStatusSnapshot', (snapshot) => {
  if (!Array.isArray(snapshot)) return;
  setContacts(prev => {
    let changed = false;
    const next = prev.map(c => {
      if (!c) return c;
      const match = snapshot.find(s => String(s.userId) === String(c.id));
      if (match && c.online !== true) {
        changed = true;
        return { ...c, online: true, lastSeen: c.lastSeen };
      }
      return c;
    }).filter(Boolean);
    return changed ? next : prev;
  });
  snapshot.forEach(s => {
    if (String(s.userId) === String(selectedChat?.id) && !selectedChat?.online) {
      setSelectedChat(prev => (prev ? { ...prev, online: true } : prev));
    }
  });
});

  // ✅ GLOBAL listener: runs once per socket
newSocket.on("receiveMessage", (data) => {
  const senderId = String(data.from);
  const isOwn = senderId === user.id;
  const chatKey = isOwn ? String(data.to) : senderId;
  const displayName = isOwn ? "You" : data.fromName || "Unknown";
  if (!chatKey) return;

  // If this DM chat is currently open and the user is at the bottom of it,
  // treat the incoming message as read right away (WhatsApp behavior) —
  // otherwise it would sit as an unread badge even though they're looking.
  // When the user is scrolled up instead, count it for the new-message pill.
  const isOpenChat = !isOwn && selectedChatRef.current &&
    String(selectedChatRef.current.id) === String(senderId) &&
    (isMobileRef.current ? mobileChatOpenRef.current : true);
  const atBottom = isAtChatBottom(messagesScrollRef.current);
  const autoRead = Boolean(isOpenChat && atBottom);
  const shouldCountNew = isOpenChat && !autoRead;

  setMessages((prev) => {
    const chat = prev[chatKey] || [];

    // ✅ 1. Self-echo: this is my own message pushed to my OTHER device.
    //    Adopt the server _id if this device already has the optimistic bubble
    //    (same client messageId); otherwise append it to the conversation.
    if (isOwn) {
      if (data.messageId) {
        const existingIndex = chat.findIndex(m => m.id === data.messageId || m.localId === data.messageId);

        if (existingIndex > -1) {
          const updatedChat = [...chat];
          updatedChat[existingIndex] = {
            ...updatedChat[existingIndex],
            id: data._id?.toString() || updatedChat[existingIndex].id,
            localId: data.messageId,
            delivered: true,
          };

          const updated = { ...prev, [chatKey]: updatedChat };
          safeSetItem('chatMessages', updated);
          return updated;
        }
      }
      const newOwn = {
        id: data._id?.toString() || `own-${Date.now()}`,
        localId: data.messageId,
        text: data.message,
        sender: 'You',
        timestamp: data.timestamp || Date.now(),
        file: data.file,
        fileName: data.fileName,
        fileType: data.fileType,
        duration: data.duration,
        replyTo: data.replyTo ? { ...data.replyTo } : null,
        photo: data.fromPhoto || 'https://placehold.co/50x50',
        delivered: true,
        read: false,
      };
      if (chat.some(m => m.id === newOwn.id || (newOwn.localId && m.localId === newOwn.localId))) return prev;
      const updated = { ...prev, [chatKey]: [...chat, newOwn] };
      safeSetItem('chatMessages', updated);
      return updated;
    }

    // ✅ 2. Incoming message from someone else. Dedupe: it may already be
    //    present locally because a history fetch returned the same message.
    if (data._id && chat.some(m => m.id === String(data._id))) return prev;

    // ✅ 2. Otherwise, it's a new message from someone else
    const newMessage = {
      id: data._id?.toString() || `fallback-${Date.now()}`,
      localId: data.messageId,
      text: data.message,
      sender: displayName,
      timestamp: data.timestamp || Date.now(),
      file: data.file,
      fileName: data.fileName,
      fileType: data.fileType,
      duration: data.duration,
      replyTo: data.replyTo ? {
        ...data.replyTo,
        
      } : null,
      photo: data.fromPhoto || 'https://placehold.co/50x50',
      delivered: true,
      read: autoRead,
    };

    const updatedChat = [...chat, newMessage];
    const updated = { ...prev, [chatKey]: updatedChat };
    safeSetItem('chatMessages', updated);
    if (autoRead) {
      newSocket.emit('markAsRead', { chatId: senderId, readerId: user.id });
    }
    return updated;
  });

  // New-message pill: only when the user is scrolled up in the open chat.
  if (shouldCountNew) {
    setNewMsgCount((c) => c + 1);
  }


  

    

    // 3. Upsert contact (self-echoes must never upsert the sender as a contact)
    if (!isOwn) setContacts(prev => {
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
      // Persist to this user's server-side address book so the chat
      // stays visible on any device/account.
      fetch(`${API_URL}/api/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ userId: senderId }),
      }).catch(err => console.error('Failed to save received-sender contact', err));
      return updated;
    });



    // 5. ✅ Mark as read only if active chat AND tab is focused
    // 5. ✅ Mark as read only if active chat AND tab is focused
            if (!isOwn && selectedChatRef.current?.id === senderId && isTabFocusedRef.current) {
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
      safeSetItem('chatMessages', updated);
      return updated;
    });
    });

     setSocket(newSocket);
      socketRef.current = newSocket; // ✅ Set ref here

      // ✅ Upsert a group into the groups list
      const upsertGroup = (group) => {
        if (!group || !group._id) return;
        setGroupsList(prev => {
          const exists = prev.some(g => String(g.id) === String(group._id));
          const existing = exists ? prev.map(g => String(g.id) === String(group._id) ? {
            id: group._id,
            name: group.name,
            dp: group.dp,
            memberCount: (group.members?.length || 0),
            lastMsg: `${group.members?.length || 0} members`,
            members: group.members || [],
            admin: group.admin?._id || group.admin,
          } : g) : [{
            id: group._id,
            name: group.name,
            dp: group.dp,
            memberCount: (group.members?.length || 0),
            lastMsg: `${group.members?.length || 0} members`,
            members: group.members || [],
            admin: group.admin?._id || group.admin,
          }, ...prev];
          // remove temp placeholder
          const cleaned = existing.filter(g => !String(g.id).startsWith('group-temp-'));
          return cleaned;
        });
      };

      // Creator receives the persisted group back
      newSocket.on('groupCreated', ({ group }) => {
        upsertGroup(group);
      });

      // Other members are notified they were added
      newSocket.on('groupAdded', ({ group }) => {
        upsertGroup(group);
      });

      // ✅ Receive a group message
      newSocket.on('receiveGroupMessage', (data) => {
        const gid = String(data.groupId);
        const senderId = String(data.from);
        const displayName = senderId === user.id ? 'You' : data.fromName || 'Unknown';
        const isOpenGroup = selectedGroupRef.current && String(selectedGroupRef.current.id) === gid;
        const isOwnMessage = senderId === user.id;
        // If the user is scrolled up in this group, count the incoming message
        // so the new-message pill can notify them.
        if (isOpenGroup && !isOwnMessage) {
          const gEl = messagesScrollRef.current;
          if (gEl && !isAtChatBottom(gEl)) setNewMsgCount((c) => c + 1);
        }
        setGroupMessages(prev => {
          const list = prev[gid] || [];
          // dedupe by messageId
          if (data.messageId && list.some(m => m.id === data.messageId)) return prev;
          return {
            ...prev,
            [gid]: [...list, {
              id: data._id?.toString() || data.messageId || `g-${Date.now()}`,
              text: data.message,
              sender: displayName,
              senderId,
              timestamp: data.timestamp || Date.now(),
              file: data.file,
              fileName: data.fileName,
              fileType: data.fileType,
              duration: data.duration,
              photo: data.fromPhoto || 'https://placehold.co/50x50',
              // My own message echoed to my other devices is NEVER "read" just
              // because a device has the group open (read ticks come from the
              // server once ALL members have seen the message).
              read: isOpenGroup && !isOwnMessage,
              delivered: !isOwnMessage,
            }],
          };
        });
        // Tell the server this member has seen the group's messages so senders
        // can advance their read ticks (only for messages from OTHERS).
        if (isOpenGroup && !isOwnMessage) {
          newSocket.emit('markGroupRead', { groupId: gid, readerId: user.id });
        }
        // Delivery ack: tell the server this device received the live message so
        // the sender's per-member double-tick advances.
        if (!isOwnMessage && data._id) {
          newSocket.emit('groupMessageReceived', { groupId: gid, messageId: data._id });
        }
        // update group preview
        const previewName = senderId === user.id
          ? 'You'
          : (contacts.find(c => String(c.id) === senderId)?.name || displayName);
        const previewText = data.file
          ? (data.fileType?.startsWith('image/') ? '[Photo]' : '[File]')
          : (data.message || '');
        setGroupsList(prev => prev.map(g => String(g.id) === gid ? { ...g, lastMsg: previewName + (previewText ? ': ' + previewText : ''), lastTime: data.timestamp || Date.now() } : g));
      });

// ✅ Group message delivery confirmation: adopt the persisted _id always (so a
//    re-open never duplicates), but flip the tick to ✓✓ only once the server
//    reports every OTHER member's device has received the message.
newSocket.on('groupMessageDelivered', ({ groupId, messageId, _id, allDelivered }) => {
  const gid = String(groupId);
  setGroupMessages(prev => {
    const list = prev[gid] || [];
    let changed = false;
    const next = list.map(m => {
      if (m.id === messageId || m.id === _id) {
        changed = true;
        return { ...m, delivered: !!allDelivered, id: _id || m.id };
      }
      return m;
    });
    return changed ? { ...prev, [gid]: next } : prev;
  });
});

      // ✅ Group read receipt: ALL other members have read a message → green tick
      newSocket.on('groupMessageReadAll', ({ groupId, messageId }) => {
        const gid = String(groupId);
        setGroupMessages(prev => {
          const list = prev[gid] || [];
          let changed = false;
          const next = list.map(m => {
            if (m.id === messageId && !m.allRead) {
              changed = true;
              return { ...m, allRead: true, read: true };
            }
            return m;
          });
          return changed ? { ...prev, [gid]: next } : prev;
        });
      });

      // ✅ Cross-device group read-state sync: another device of THIS account
      //    opened this group, so clear the unread badge / mark messages read.
      newSocket.on('groupRead', ({ groupId }) => {
        const gid = String(groupId);
        setGroupMessages(prev => {
          const list = prev[gid];
          if (!list) return prev;
          let changed = false;
          const next = list.map(m => {
            if (m.sender !== 'You' && !m.read) { changed = true; return { ...m, read: true }; }
            return m;
          });
          return changed ? { ...prev, [gid]: next } : prev;
        });
      });

      // ✅ Load group message history when opening a group
      newSocket.on('groupMessagesHistory', ({ groupId, messages }) => {
        const gid = String(groupId);
        if (!Array.isArray(messages)) return;
        setGroupMessages(prev => {
          const existing = prev[gid] || [];
          const merged = [...existing, ...messages.map(m => ({
            id: m._id?.toString() || m.messageId || `g-${Date.now()}-${Math.random()}`,
            text: m.message,
            sender: String(m.from) === user.id ? 'You' : m.fromName || 'Unknown',
            senderId: String(m.from),
            timestamp: m.timestamp || Date.now(),
            file: m.file,
            fileName: m.fileName,
            fileType: m.fileType,
            duration: m.duration,
            photo: m.fromPhoto || 'https://placehold.co/50x50',
            delivered: !!m.allDelivered,
            // On load, MY OWN messages show ✓ or ✓✓ per the server's per-member
            // delivery receipts — a message stays single-tick until every OTHER
            // member's device has received it (WhatsApp-style). Received messages
            // don't show ticks anyway.
            read: String(m.from) !== user.id,
            allRead: !!m.allRead,
            readBy: m.readBy || [],
          }))];
          // Dedupe by id/messageId so reopening a group replaces rather than
          // duplicates the ticking message. Last occurrence wins so the server's
          // history (which carries the authoritative read state) overrides an
          // earlier live copy — otherwise a message received while the group was
          // closed stays "unread" forever and the badge never clears.
          const seen = new Map();
          merged.forEach(m => {
            const key = m.id;
            seen.set(key, m);
          });
          // Sort oldest→newest so live-received messages (which were
          // appended before history arrived) don't end up before older ones.
          const ordered = [...seen.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          return { ...prev, [gid]: ordered };
        });
        // If the user is viewing this group, mark all messages from others as
        // read (server propagates read ticks to senders).
        if (selectedGroupRef.current && String(selectedGroupRef.current.id) === gid) {
          newSocket.emit('markGroupRead', { groupId: gid, readerId: user.id });
        }
      });

      // ✅ 1:1 message deleted-for-everyone by the other party
      newSocket.on('messageDeleted', ({ _id, messageId }) => {
        setMessages(prev => {
          const next = {};
          let changed = false;
          Object.entries(prev).forEach(([cid, list]) => {
            const filtered = (list || []).filter(m => {
              const idm = m.id === _id || m.id === messageId;
              if (idm) changed = true;
              return !idm;
            });
            next[cid] = filtered;
          });
          if (changed) safeSetItem('chatMessages', next);
          return changed ? next : prev;
        });
      });

      // ✅ 1:1 chat cleared
      newSocket.on('chatCleared', ({ to, forMe }) => {
        setMessages(prev => {
          const key = to !== undefined && to !== null ? String(to) : null;
          if (key !== null && prev[key]) {
            const next = { ...prev, [key]: [] };
            safeSetItem('chatMessages', next);
            return next;
          }
          return prev;
        });
      });

      // ✅ group message deleted-for-everyone
      newSocket.on('groupMessageDeleted', ({ groupId, _id, messageId }) => {
        const gid = String(groupId);
        setGroupMessages(prev => {
          const list = prev[gid] || [];
          const filtered = list.filter(m => m.id !== _id && m.id !== messageId);
          return filtered.length === list.length ? prev : { ...prev, [gid]: filtered };
        });
      });

      // ✅ group chat cleared
      newSocket.on('groupChatCleared', ({ groupId, forMe }) => {
        const gid = String(groupId);
        setGroupMessages(prev => ({ ...prev, [gid]: [] }));
      });

      // ✅ Status posted by anyone I am in contact with (including my own
      //    other devices) — refresh the status feed.
      newSocket.on('statusPosted', () => loadStatusFeedRef.current());
      newSocket.on('statusDeleted', () => loadStatusFeedRef.current());

    return () => {
    newSocket.disconnect();
   };
    }, [user.id, navigate]);   
  
  
  

        // ✅ Fetch my groups from the backend on load
        useEffect(() => {
          const token = localStorage.getItem('token');
          if (!token || !user.id) return;
          (async () => {
            try {
              const res = await fetch(`${API_URL}/api/groups`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const data = await res.json();
              if (data && Array.isArray(data.groups)) {
                setGroupsList(prev => {
                  const map = new Map();
                  prev.forEach(g => map.set(String(g.id), g));
                  data.groups.forEach(g => map.set(String(g._id), {
                    id: g._id,
                    name: g.name,
                    dp: g.dp,
                    memberCount: (g.members?.length || 0),
                    lastMsg: g.lastMessage
                      ? (String(g.lastMessage.from) === String(user.id)
                          ? 'You: '
                          : ((contacts.find(c => String(c.id) === String(g.lastMessage.from))?.name || g.lastMessage.fromName) + ': ')) +
                          (g.lastMessage.file
                            ? (g.lastMessage.fileType?.startsWith('image/') ? '[Photo]' : g.lastMessage.fileType?.startsWith('audio/') ? '🎤 Voice message' : '[File]')
                            : (g.lastMessage.text || ''))
                      : `${g.members?.length || 0} members`,
                    lastTime: g.lastMessage?.timestamp || null,
                    lastMessage: g.lastMessage || null,
                    members: g.members || [],
                    admin: g.admin?._id || g.admin,
                  }));
                  return [...map.values()];
                });
              }
            } catch (err) {
              console.error('Failed to fetch groups', err);
            }
          })();
        }, [user.id]);

        // ✅ Load this user's private address book from the server (per-account)
        useEffect(() => {
          const token = localStorage.getItem('token');
          if (!token || !user.id) return;
          (async () => {
            try {
              const res = await fetch(`${API_URL}/api/contacts`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const data = await res.json();
              if (data && Array.isArray(data.contacts)) {
                // Merge server contacts into state WITHOUT wiping contacts that were
                // added at runtime (e.g. a sender who just messaged you), so the
                // fresh chat stays visible.
                setContacts(prev => {
                  const map = new Map(prev.map(c => [String(c.id), c]));
                  data.contacts.forEach(c => {
                    map.set(String(c._id), {
                      id: c._id,
                      name: c.name,
                      firstName: c.firstName || '',
                      lastName: c.lastName || '',
                      email: c.email,
                      photo: c.photo || 'https://via.placeholder.com/50',
                      lastMsg: '',
                      time: '',
                      online: false,
                      lastSeen: c.lastSeen || Date.now(),
                    });
                  });
                  return [...map.values()];
                });
                setDataReady(true);
              }
            } catch (err) {
              console.error('Failed to fetch contacts', err);
            }
          })();
        }, [user.id]);

        // Prefetch each group's message history so the list shows
        // previews/times without needing to open the group first.
        // Fetch reliably once the socket is connected and the group list
        // is loaded, then again whenever groups are added/change.
        useEffect(() => { groupsListRef.current = groupsList; }, [groupsList]);
        useEffect(() => { contactsRef.current = contacts; }, [contacts]);
        useEffect(() => {
          if (!socket || !socket.connected) return;
          if (!groupsList.length) return;
          const fetchHistory = () => {
            if (!socket.connected) return;
            [...new Set(groupsList.map(g => g._id || g.id))].forEach(gid => {
              if (!prefetchedGroupHistoryRef.current.has(gid)) {
                prefetchedGroupHistoryRef.current.add(gid);
                socket.emit('fetchGroupMessages', { groupId: gid });
              }
            });
          };
          fetchHistory();
        }, [socket, groupsList]);
        // Also prefetch once the socket connects, using the latest groups.
        useEffect(() => {
          if (!socket) return;
          const onConnect = () => {
            if (!socket.connected) return;
            [...new Set((groupsListRef.current || []).map(g => g._id || g.id))].forEach(gid => {
              if (!prefetchedGroupHistoryRef.current.has(gid)) {
                prefetchedGroupHistoryRef.current.add(gid);
                socket.emit('fetchGroupMessages', { groupId: gid });
              }
            });
          };
          socket.on('connect', onConnect);
          if (socket.connected) onConnect();
          return () => socket.off('connect', onConnect);
        }, [socket]);

        // ✅ 1:1 DM cross-device sync: prefetch each DM's conversation history
        //    once the socket + contacts are ready (mirrors the group prefetch),
        //    so a brand-new device sees the same conversations immediately.
        useEffect(() => {
          if (!socket || !socket.connected) return;
          const ids = [...new Set((contacts || []).map(c => c && String(c.id)).filter(Boolean))];
          if (!ids.length) return;
          ids.forEach(id => {
            if (!prefetchedHistoryRef.current.has(id)) {
              prefetchedHistoryRef.current.add(id);
              socket.emit('fetchMessages', { chatId: id });
            }
          });
        }, [socket, contacts]);
        // Also prefetch DM history once the socket connects, using the latest contacts.
        useEffect(() => {
          if (!socket) return;
          const onConnect = () => {
            if (!socket.connected) return;
            [...new Set((contactsRef.current || []).map(c => c && String(c.id)).filter(Boolean))].forEach(id => {
              if (!prefetchedHistoryRef.current.has(id)) {
                prefetchedHistoryRef.current.add(id);
                socket.emit('fetchMessages', { chatId: id });
              }
            });
          };
          socket.on('connect', onConnect);
          if (socket.connected) onConnect();
          return () => socket.off('connect', onConnect);
        }, [socket]);

        // ✅ Re-fetch the active DM's history whenever its chat is opened so a
        //    stale device refreshes to the latest server state.
        useEffect(() => {
          if (!socket || !socket.connected || !selectedChat?.id) return;
          socket.emit('fetchMessages', { chatId: selectedChat.id });
        }, [socket, selectedChat?.id]);
    


        // Detect whether we are on a real mobile device / touch viewport
        useEffect(() => {
          const mq = window.matchMedia('(max-width: 768px)');
          const update = () => {
            setIsMobile(mq.matches);
            setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
          };
          mq.addEventListener('change', update);
          window.addEventListener('resize', update);
          return () => {
            mq.removeEventListener('change', update);
            window.removeEventListener('resize', update);
          };
        }, []);

        // Keep the mobile chat panel pinned to the *visual* viewport. iOS
        // Safari does not shrink the layout viewport when it auto-pans the
        // page up to keep a focused input above the keyboard, so a fixed
        // 100vh/100dvh panel (and its chat header) gets carried off the top
        // of the screen. Mirror visualViewport offset/size onto the panel so
        // the header always stays visible while the conversation scrolls.
        useEffect(() => {
          if (!isMobile) return undefined;
          if (typeof window === 'undefined' || !window.visualViewport) return undefined;
          const vv = window.visualViewport;
          const update = () => {
            const panel = document.querySelector('.right-panel');
            if (!panel) return;
            panel.style.top = vv.offsetTop + 'px';
            panel.style.height = vv.height + 'px';
            panel.style.bottom = 'auto';
          };
          const clear = () => {
            const panel = document.querySelector('.right-panel');
            if (!panel) return;
            panel.style.top = '';
            panel.style.height = '';
            panel.style.bottom = '';
          };
          update();
          vv.addEventListener('resize', update);
          vv.addEventListener('scroll', update);
          window.addEventListener('resize', update);
          return () => {
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
            window.removeEventListener('resize', update);
            clear();
          };
        }, [isMobile]);

        // Save whenever chat changes
        useEffect(() => {
          if (selectedChat?.id) {
            localStorage.setItem('selectedChat', JSON.stringify(selectedChat));
          }
        }, [selectedChat]);

        // Restore the previous chat ONLY if that person/group still exists in this
        // account's contact list or groups (prevents ghost chats after a refresh).
        useEffect(() => {
          if (!dataReady) return;
          const saved = localStorage.getItem('selectedChat');
          const parsed = saved ? JSON.parse(saved) : null;
          if (!parsed?.id) return;
          const stillExists =
            contacts.some(c => String(c.id) === String(parsed.id)) ||
            groupsList.some(g => String(g.id) === String(parsed.id));
          if (stillExists) {
            setSelectedChat(parsed);
            selectedChatRef.current = parsed;
          } else {
            localStorage.removeItem('selectedChat');
            setSelectedChat(prev => (prev && String(prev.id) === String(parsed.id) ? null : prev));
          }
        }, [dataReady, groupsList]);

        // NOTE: no auto "mark as read" on mount for a restored chat — a direct
        // message must only become a read (green) tick when the receiving user
        // has ACTUALLY had that chat open and focused. Restoring a saved chat on
        // load must NOT send read receipts for messages they never saw.

        // Check if user exists in DB
        const findUserByEmail = async (email) => {
          try {
            const res = await fetch(`${API_URL}/api/auth/check-email?email=${encodeURIComponent(email)}`);
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
                    safeSetItem('chatMessages', messages);
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

        // ===== Mobile system back button: in-app page navigation =====
        // Every "page" the user opens (bottom-nav view/tab, a chat,
        // contact/group info, create-group flow, camera, add-contact, forward)
        // pushes a browser-history entry, so the device back button pops that
        // entry and returns to the PREVIOUS in-app page instead of leaving the
        // whole app. This is generic: any page that calls pushPage() gets
        // back-navigation, and close-screen buttons call goBackPage() so the
        // history stack stays perfectly balanced.
        const navStackRef = useRef([]);            // [{ screen, saved? }]
        const prevNavRef = useRef({ view, activeTab });
        const chatOnRef = useRef(false);
        const contactInfoOnRef = useRef(false);
        const groupInfoOnRef = useRef(false);
        const addContactOnRef = useRef(false);
        const forwardOnRef = useRef(false);
        const groupFlowOnRef = useRef(false);
        const cameraOnRef = useRef(false);

        const pushPage = (screen, saved) => {
          window.history.pushState({ appNav: true }, '');
          navStackRef.current.push(saved ? { screen, saved } : { screen });
        };

        const stopCameraStream = () => {
          if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach((t) => t.stop());
          }
        };

        // Close whichever page is topmost, based on LIVE state (used as a
        // fallback for desktop or when no pushed history entry exists).
        const closeTopLive = () => {
          if (showCameraModal) {
            stopCameraStream();
            setShowCameraModal(false);
            cameraOnRef.current = false;
          } else if (showGroupFlow) {
            setShowGroupFlow(false);
            setSlideClass('');
            groupFlowOnRef.current = false;
          } else if (showContactInfo) {
            setShowContactInfo(false);
            contactInfoOnRef.current = false;
          } else if (showGroupInfo) {
            setShowGroupInfo(false);
            groupInfoOnRef.current = false;
          } else if (showAddContact) {
            setShowAddContact(false);
            addContactOnRef.current = false;
          } else if (showForwardModal) {
            setShowForwardModal(false);
            forwardOnRef.current = false;
          } else if (selectedChat?.id || selectedGroup?.id) {
            setSelectedChat(null);
            setSelectedGroup(null);
            selectedGroupRef.current = null;
            setMobileChatOpen(false);
            setShowDropdown(false);
            setGroupShowDropdown(false);
            chatOnRef.current = false;
          } else if (view !== prevNavRef.current.view || activeTab !== prevNavRef.current.activeTab) {
            const prev = prevNavRef.current;
            prevNavRef.current = prev;
            setView(prev.view);
            setActiveTab(prev.activeTab);
          }
        };

        const closeScreen = (entry) => {
          switch (entry.screen) {
            case 'tab':
              setView(entry.saved.view);
              setActiveTab(entry.saved.activeTab);
              prevNavRef.current = entry.saved;
              break;
            case 'chat':
              setSelectedChat(null);
              setSelectedGroup(null);
              selectedGroupRef.current = null;
              setMobileChatOpen(false);
              setShowDropdown(false);
              setGroupShowDropdown(false);
              chatOnRef.current = false;
              break;
            case 'contactinfo':
              setShowContactInfo(false);
              contactInfoOnRef.current = false;
              break;
            case 'groupinfo':
              setShowGroupInfo(false);
              groupInfoOnRef.current = false;
              break;
            case 'addcontact':
              setShowAddContact(false);
              addContactOnRef.current = false;
              break;
            case 'forward':
              setShowForwardModal(false);
              forwardOnRef.current = false;
              break;
            case 'groupflow':
              setShowGroupFlow(false);
              setSlideClass('');
              groupFlowOnRef.current = false;
              break;
            case 'camera':
              stopCameraStream();
              setShowCameraModal(false);
              cameraOnRef.current = false;
              break;
            default:
              break;
          }
        };

        // Shared handler for ANY on-screen back/close button: goes through the
        // browser history so the pushed entry is consumed (stack stays balanced).
        const goBackPage = () => {
          if (window.history.state && window.history.state.appNav) {
            window.history.back();
          } else {
            closeTopLive();
          }
        };

        // Bottom-nav page / tab changes
        useEffect(() => {
          if (!isMobile) return;
          if (view !== prevNavRef.current.view || activeTab !== prevNavRef.current.activeTab) {
            pushPage('tab', prevNavRef.current);
            prevNavRef.current = { view, activeTab };
          }
        }, [view, activeTab, isMobile]);

        // Watch every tracked page opening (false -> true) and push history
        useEffect(() => {
          if (!isMobile) return;
          const pages = [
            { on: !!(selectedChat?.id || selectedGroup?.id), ref: chatOnRef, key: 'chat' },
            { on: showContactInfo, ref: contactInfoOnRef, key: 'contactinfo' },
            { on: showGroupInfo, ref: groupInfoOnRef, key: 'groupinfo' },
            { on: showAddContact, ref: addContactOnRef, key: 'addcontact' },
            { on: showForwardModal, ref: forwardOnRef, key: 'forward' },
            { on: showGroupFlow, ref: groupFlowOnRef, key: 'groupflow' },
            { on: showCameraModal, ref: cameraOnRef, key: 'camera' },
          ];
          pages.forEach((p) => {
            if (p.on && !p.ref.current) {
              pushPage(p.key);
            }
            p.ref.current = !!p.on;
          });
        }, [isMobile, selectedChat?.id, selectedGroup?.id, showContactInfo, showGroupInfo, showAddContact, showForwardModal, showGroupFlow, showCameraModal]);

        // Handle the system/hardware back button
        useEffect(() => {
          if (!isMobile) return;
          const handlePopState = () => {
            const entry = navStackRef.current.pop();
            if (!entry) return; // nothing open in-app → let the browser go back
            closeScreen(entry);
          };
          window.addEventListener('popstate', handlePopState);
          return () => window.removeEventListener('popstate', handlePopState);
        }, [isMobile]);

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

    

      const openGroupFlow = () => {
        setShowGroupFlow(true);
        setGroupStep(1);
        setGroupSelectedContacts([]);
        setGroupSearchQuery('');
        setGroupName('');
        setGroupDp(null);
        setSlideClass('slide-in-forward');
      };

      const closeGroupFlow = () => {
        goBackPage();
      };

      const advanceGroupStep = () => {
        setSlideClass('slide-in-forward');
        setGroupStep(2);
      };

      const backGroupStep = () => {
        setSlideClass('slide-in-backward');
        setGroupStep(1);
      };

      const toggleGroupContact = (contact) => {
        setGroupSelectedContacts(prev =>
          prev.some(c => String(c.id) === String(contact.id))
            ? prev.filter(c => String(c.id) !== String(contact.id))
            : [...prev, contact]
        );
      };

      const handleGroupDpChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setGroupDp(reader.result);
        reader.readAsDataURL(file);
      };

      const createGroup = () => {
        const name = groupName.trim();
        if (!name || groupSelectedContacts.length === 0) return;

        const memberIds = groupSelectedContacts.map(c => c.id);
        const tempId = `group-temp-${Date.now()}`;

        const tempGroup = {
          id: tempId,
          name,
          dp: groupDp,
          memberCount: groupSelectedContacts.length,
          lastMsg: `${groupSelectedContacts.length} members`,
          members: groupSelectedContacts,
          admin: user.id,
          temp: true,
        };

        // Optimistically show for the creator
        setGroupsList(prev => [tempGroup, ...prev].filter(g => g.id !== tempId));
        setGroupsList(prev => [tempGroup, ...prev]);

        // Persist + notify members via backend
        if (socket) {
          socket.emit('createGroup', {
            name,
            dp: groupDp,
            members: memberIds,
          });
        }

        closeGroupFlow();
      };

      const renderGroupFlow = () => {
        const filteredContacts = contacts.filter(c =>
          !groupSearchQuery ||
          (c.name && c.name.toLowerCase().includes(groupSearchQuery.toLowerCase()))
        );
        const selCount = groupSelectedContacts.length;
        const groupInitial = (groupName.trim() || 'G').charAt(0).toUpperCase();

        return (
          <div
            className="group-flow-overlay"
            style={{
              position: 'relative',
              flex: 1,
              minHeight: 0,
              width: '100%',
              height: '100%',
              background: '#f7f8fa',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
          <div key={groupStep} className={`group-flow ${slideClass}`}>
            {groupStep === 1 ? (
              <div className="group-screen">
                <div className="group-header">
                  <button
                    type="button"
                    className="group-back-btn"
                    onClick={closeGroupFlow}
                    aria-label="Back"
                  >
                    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                      <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                    </svg>
                  </button>
                  <div className="group-header-text">
                    <span className="group-header-title">New Group</span>
                    {selCount > 0 && (
                      <span className="group-header-count">{selCount} selected</span>
                    )}
                  </div>
                </div>

                <div className="group-search">
                  <svg className="group-search-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/>
                  </svg>
                  <input
                    type="text"
                    placeholder="Search contacts"
                    value={groupSearchQuery}
                    onChange={(e) => setGroupSearchQuery(e.target.value)}
                  />
                </div>

                <div className="group-contacts-list">
                  {filteredContacts.length === 0 ? (
                    <div className="group-empty">No contacts found</div>
                  ) : (
                    filteredContacts.map(contact => {
                      const isTicked = groupSelectedContacts.some(
                        c => String(c.id) === String(contact.id)
                      );
                      return (
                        <div
                          key={contact.id}
                          className={`group-contact-item ${isTicked ? 'ticked' : ''}`}
                          onClick={() => toggleGroupContact(contact)}
                        >
                          <span className={`group-contact-check ${isTicked ? 'checked' : ''}`}>
                            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                              <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                            </svg>
                          </span>
                          <span className="group-contact-avatar">
                            {contact.photo ? (
                              <img src={contact.photo} alt={contact.name} />
                            ) : (
                              <span>{(contact.name || '?').charAt(0).toUpperCase()}</span>
                            )}
                          </span>
                          <span className="group-contact-name">{contact.name}</span>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="group-bottom-bar">
                  <button
                    type="button"
                    className="group-forward-btn"
                    disabled={selCount === 0}
                    onClick={advanceGroupStep}
                    aria-label="Next"
                  >
                    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                      <path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z"/>
                    </svg>
                  </button>
                </div>
              </div>
            ) : (
              <div className="group-screen">
                <div className="group-header">
                  <button
                    type="button"
                    className="group-back-btn"
                    onClick={backGroupStep}
                    aria-label="Back"
                  >
                    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                      <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                    </svg>
                  </button>
                  <div className="group-header-text">
                    <span className="group-header-title">New Group</span>
                  </div>
                </div>

                <div className="group-details">
                  <label className="group-dp-picker">
                    {groupDp ? (
                      <img className="group-dp-preview" src={groupDp} alt="Group DP" />
                    ) : (
                      <span className="group-dp-placeholder">{groupInitial}</span>
                    )}
                    <span className="group-dp-edit">
                      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                        <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                      </svg>
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleGroupDpChange}
                      hidden
                    />
                  </label>

                  <div className="group-name-wrap">
                    <svg className="group-name-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                      <path fill="currentColor" d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-3.33 0-7 1.67-7 5v3h14v-3c0-3.33-3.67-5-7-5z"/>
                    </svg>
                    <input
                      type="text"
                      className="group-name-input"
                      placeholder="Type a group name"
                      value={groupName}
                      onChange={(e) => setGroupName(e.target.value)}
                      maxLength="25"
                    />
                  </div>

                  <p className="group-member-count">
                    {selCount} member{selCount === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="group-bottom-bar">
                  <button
                    type="button"
                    className="group-create-btn"
                    disabled={!groupName.trim() || selCount === 0}
                    onClick={createGroup}
                    aria-label="Create group"
                  >
                    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
                      <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                  </button>
                </div>
              </div>
            )}
          </div>
          </div>
        );
      };

      const renderCenterContent = () => {
        if (showGroupFlow) {
          return renderGroupFlow();
        }
        if (activeTab === 'profile') {
          return (
            <div className="profile-view">
              <h2><User size={22} strokeWidth={1.8} style={{ marginRight: 8, verticalAlign: 'middle' }} /> Profile</h2>
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
          {activeTab === 'chats' && [...contacts, ...chats].map(chat => {
            const chatMsgs = messages[chat.id] || [];
            const last = chatMsgs[chatMsgs.length - 1];
            const unreadMsgs = chatMsgs.filter(m => m.sender !== 'You' && !m.read);
            const unreadCount = unreadMsgs.length;
            const hasUnread = unreadCount > 0;
            const previewMsg = hasUnread ? unreadMsgs[0] : last; // oldest unread, else latest
            const truncate = (t) => {
              if (!t) return '';
              return t.length > 35 ? `${t.slice(0, 35)}…` : t;
            };
            let preview = '';
            if (previewMsg) {
              if (previewMsg.file) {
                preview = previewMsg.fileType?.startsWith('image/') ? '[Photo]' : previewMsg.fileType?.startsWith('audio/') ? '🎤 Voice message' : '[File]';
              } else if (previewMsg.text) {
                preview = truncate(previewMsg.text);
              }
              if (previewMsg.sender === 'You' && preview) {
                preview = `You: ${preview}`;
              }
            } else {
              preview = truncate(chat.lastMsg || '');
            }
            const timeToShow = previewMsg
              ? (formatTime(previewMsg.timestamp) || chat.timestamp)
              : chat.timestamp;
            return (
      <div
        key={chat.id}
        className={`chat-item ${selectedChat?.id === chat.id ? 'active' : ''}`}
        onClick={() => {
          setSelectedChat(chat);
          selectedChatRef.current = chat;
          setSelectedGroup(null);
          selectedGroupRef.current = null;
          setMobileChatOpen(true);
          // Mark read only on an explicit user open (WhatsApp behavior):
          // never auto-send read receipts for chats restored on page load.
          if ((messages[chat.id] || []).some(m => m.sender !== 'You' && !m.read)) {
            setTimeout(() => markAsReadRef.current(), 60);
          }
        }}
        style={{ cursor: 'pointer' }}
      >
          <img src={chat.photo || 'https://via.placeholder.com/50'} alt={chat.name} />
          <div className="chat-info">
            <h4>{chat.name}</h4>
            <p className={hasUnread ? 'unread-preview' : ''}>{preview}</p>
          </div>
          <div className="chat-item-right">
            <span className={`timestamp ${hasUnread ? 'unread' : ''}`}>{timeToShow}</span>
            {hasUnread && <span className="unread-badge">{unreadCount}</span>}
          </div>
        </div>
            );
          })}
                {activeTab === 'groups' && groupsList.map(group => {
                  const groupMsgs = groupMessages[group._id || group.id] || [];
                  const last = groupMsgs[groupMsgs.length - 1];
                  const unreadMsgs = groupMsgs.filter(m => m.sender !== 'You' && !m.read);
                  const unreadCount = unreadMsgs.length;
                  const hasUnread = unreadCount > 0;
                  const previewMsg = hasUnread ? unreadMsgs[0] : last;
                  const truncate = (t) => {
                    if (!t) return '';
                    return t.length > 35 ? `${t.slice(0, 35)}…` : t;
                  };
                  let preview = '';
                  if (previewMsg) {
                    const senderName = String(previewMsg.senderId) === String(user.id)
                      ? 'You'
                      : contacts.find(c => String(c.id) === String(previewMsg.senderId))?.name || previewMsg.sender || 'Member';
                    if (previewMsg.file) {
                      preview = previewMsg.fileType?.startsWith('image/') ? '[Photo]' : previewMsg.fileType?.startsWith('audio/') ? '🎤 Voice message' : '[File]';
                    } else if (previewMsg.text) {
                      preview = truncate(previewMsg.text);
                    }
                    if (preview) {
                      preview = `${senderName}: ${preview}`;
                    }
                  } else {
                    preview = truncate(group.lastMsg || 'No messages yet');
                  }
                  const timeToShow = previewMsg
                    ? (formatTime(previewMsg.timestamp) || group.lastTime)
                    : group.lastTime;
                  return (
                  <div
                    key={group._id || group.id}
                    className={`chat-item ${selectedGroup && String(selectedGroup.id) === String(group._id || group.id) ? 'active' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => {
                      setSelectedChat(null);
                      selectedChatRef.current = null;
                      const normalized = {
                        id: group._id || group.id,
                        name: group.name,
                        dp: group.dp,
                        memberCount: group.memberCount || (group.members?.length || 0),
                        members: group.members || [],
                        admin: group.admin,
                      };
                      selectedGroupRef.current = normalized;
                      setSelectedGroup(normalized);
                      setMobileChatOpen(true);
                      // Remember the oldest unread message so we can scroll to it
                      // when the group opens (WhatsApp-style), instead of the bottom.
                      const openList = groupMessages[normalized.id] || [];
                      const firstUnread = openList.find(m => m.sender !== 'You' && !m.read);
                      groupUnreadScrollRef.current = firstUnread ? firstUnread.id : null;
                      groupOpenAtRef.current = Date.now();
                      if (socket) {
                        socket.emit('fetchGroupMessages', { groupId: normalized.id });
                      }
                    }}
                  >
                    <img
                      src={group.dp || 'https://via.placeholder.com/50/4a00e0/fff?text=G'}
                      alt={group.name}
                    />
                    <div className="chat-info">
                      <h4>{group.name}</h4>
                      <p className={hasUnread ? 'unread-preview' : ''}>{preview}</p>
                    </div>
                    <div className="chat-item-right">
                      <span className={`timestamp ${hasUnread ? 'unread' : ''}`}>{timeToShow}</span>
                      {hasUnread && <span className="unread-badge">{unreadCount}</span>}
                    </div>
                  </div>
                  );
                })}
                                {activeTab === 'unread' && (() => {
                  const unreadDms = [...contacts, ...chats]
                    .filter(chat => (messages[chat.id] || []).some(m => m.sender !== 'You' && !m.read))
                    .map(chat => {
                      const chatMsgs = messages[chat.id] || [];
                      const un = chatMsgs.filter(m => m.sender !== 'You' && !m.read);
                      const last = chatMsgs[chatMsgs.length - 1];
                      const p = un[0] || last;
                      let text = '';
                      if (p) text = p.file ? '[Photo]' : (p.text ? (p.text.length > 35 ? p.text.slice(0, 35) + '…' : p.text) : '');
                      return {
                        key: chat.id,
                        name: chat.name,
                        photo: chat.photo || 'https://via.placeholder.com/50',
                        count: un.length,
                        text,
                        open: () => {
                          setSelectedChat(chat);
                          setSelectedGroup(null);
                          selectedGroupRef.current = null;
                          setMobileChatOpen(true);
                          setActiveTab('chats');
                        },
                      };
                    });
                  const unreadGrps = groupsList
                    .filter(g => (groupMessages[g._id || g.id] || []).some(m => m.sender !== 'You' && !m.read))
                    .map(g => {
                      const gid = g._id || g.id;
                      const gm = groupMessages[gid] || [];
                      const un = gm.filter(m => m.sender !== 'You' && !m.read);
                      return {
                        key: gid,
                        name: g.name,
                        photo: g.photo || 'https://via.placeholder.com/50',
                        count: un.length,
                        text: 'Group',
                        open: () => {
                          setSelectedGroup(g);
                          setSelectedChat(null);
                          setMobileChatOpen(true);
                          setActiveTab('groups');
                        },
                      };
                    });
                  const all = [...unreadDms, ...unreadGrps];
                  if (all.length === 0) {
                    return <div style={{ padding: '30px 16px', textAlign: 'center', color: '#8a8f99' }}>No unread messages</div>;
                  }
                  return all.map(c => (
                    <div key={c.key} className="chat-item" onClick={c.open} style={{ cursor: 'pointer' }}>
                      <img src={c.photo} alt={c.name} />
                      <div className="chat-info">
                        <h4>{c.name}</h4>
                        <p className="unread-preview">{c.count} unread{!c.text ? '' : ' • ' + c.text}</p>
                      </div>
                      <div className="chat-item-right"><span className="unread-badge">{c.count}</span></div>
                    </div>
                  ));
                })()}
{activeTab === 'calls' && calls.map(call => (
                  <div key={call.id} className="chat-item" style={{ cursor: 'pointer' }}>
                    <img src={call.groupId ? 'https://via.placeholder.com/50/4a00e0/fff?text=G' : (call.photo || 'https://via.placeholder.com/50')} alt={call.name} />
                    <div className="chat-info">
                      <h4>{call.groupId ? (groupsList.find(g => String(g.id) === String(call.groupId))?.name || 'Group call') : call.name}</h4>
                      <p><span className={`call-dir ${call.direction === 'missed' ? 'missed' : ''}`}>{call.direction === 'outgoing' ? '↗' : call.direction === 'missed' ? '↘' : '↙'}</span> {call.direction === 'outgoing' ? 'Outgoing' : call.direction === 'missed' ? 'Missed' : 'Incoming'} {call.video ? 'video' : 'voice'} {call.groupId ? 'group ' : ''}call{call.durationSec ? ` • ${fmtCallTime(call.durationSec)}` : ''}</p>
                      {call.time && <small style={{ color: '#888', fontSize: '0.75rem' }}>{new Date(call.time).toLocaleString()}</small>}
                    </div>
                  </div>
                ))}
                {activeTab === 'calls' && calls.length === 0 && (
                  <div style={{ padding: '30px 16px', textAlign: 'center', color: '#8a8f99' }}>No calls yet</div>
                )}
                {activeTab === 'statuses' && (
                  <>
                    <div
                      className="chat-item my-status"
                      onClick={() => {
                        if (myStatuses.length) setStatusViewer({ userId: user.id, index: 0 });
                        else setStatusAddSheet(true);
                      }}
                    >
                      <div className="my-status-avatar">
                        <StatusAvatar src={myStatusPhoto} count={myStatuses.length} seen={false} />
                        <button className="my-status-add" onClick={(e) => { e.stopPropagation(); setStatusAddSheet(true); }} aria-label="Add status">+</button>
                      </div>
                      <div className="chat-info">
                        <h4>{myStatuses.length ? 'My Status' : 'Tap to add status'}</h4>
                        <p>{myStatuses.length ? `• ${timeAgo(myStatuses[0].createdAt)}` : 'Visible to everyone'}</p>
                      </div>
                    </div>
                    {feedGroups.map(status => {
                      const hasUnseen = status.statuses.some(s => !s.viewed);
                      return (
                        <div key={String(status.user.id)} className={`chat-item ${hasUnseen ? 'unseen' : 'seen'}`} onClick={() => setStatusViewer({ userId: String(status.user.id), index: 0 })}>
                          <StatusAvatar
                            src={status.statuses[0]?.file || status.user.photo || 'https://via.placeholder.com/50'}
                            count={status.statuses.length}
                            seen={!hasUnseen}
                          />
                          <div className="chat-info">
                            <h4>{status.user.name}</h4>
                            <p>• {status.statuses.length > 1 ? `${status.statuses.length} updates • ` : ''}{timeAgo(status.statuses[0]?.createdAt)}</p>
                          </div>
                          {hasUnseen && <span className="status-dot" />}
                        </div>
                      );
                    })}
                    {feedGroups.length === 0 && <div style={{ padding: '14px 16px', color: '#8a8f99', fontSize: '0.9rem' }}>No recent updates</div>}
                  </>
                )}
              </div>
            </>
          );
        };

      const handleSendGroupMessage = (e) => {
        e.preventDefault();
        const input = messageInputRef.current;
        if (!input?.value.trim()) return;
        const text = input.value.trim();
        const now = new Date();
        const tempId = `group-temp-${now.getTime()}-${Math.random()}`;
        const gid = selectedGroup.id;

        const replyToForPayload = groupReplyTo ? {
          id: groupReplyTo.id,
          text: groupReplyTo.text,
          senderId: groupReplyTo.senderId || (groupReplyTo.sender === 'You' ? user.id : groupReplyTo.from),
        } : null;

        socket.emit('sendGroupMessage', {
          groupId: selectedGroup.id,
          message: text,
          from: user.id,
          fromName: user.name,
          replyTo: replyToForPayload,
          timestamp: now.getTime(),
          messageId: tempId,
        });

        setGroupMessages(prev => ({
          ...prev,
          [gid]: [
            ...(prev[gid] || []),
            {
              id: tempId,
              text,
              sender: 'You',
              senderId: user.id,
              replyTo: replyToForPayload,
              timestamp: now.getTime(),
              // A brand-new message shows a SINGLE tick (sent but not yet
              // received) until the server confirms every OTHER member's device
              // has the message (see groupMessageDelivered). allRead stays grey →
              // green (✓✓ blue) only once all members have read — same as WhatsApp.
              delivered: false,
              read: false,
              allRead: false,
            },
          ],
        }));

        setGroupsList(prev => {
          const exists = prev.some(g => String(g.id) === String(gid));
          return exists ? prev.map(g =>
            String(g.id) === String(gid)
              ? { ...g, lastMsg: `You: ${text || '[Image]'}`, lastTime: now.getTime() }
              : g
          ) : prev;
        });

        input.value = '';

        // Auto-scroll to bottom only when I send my own group message
        requestAnimationFrame(() => {
          if (messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
          }
        });

        setDesktopDraft('');
        setGroupReplyTo(null);
      };

      const handleGroupFileChange = (e) => {
        const file = e.target.files[0];
        if (!file || !selectedGroup || !socket) return;

        // Guard large uploads (see handleFileChange). Skip with a clear message
        // instead of letting the socket/DB silently drop them.
        if (file.size > 9 * 1024 * 1024) {
          alert('This file is too large to send (max 9 MB).');
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }

        const tempId = `group-temp-${Date.now()}-${Math.random()}`;
        const gid = selectedGroup.id;

        const reader = new FileReader();
        reader.onload = () => {
          const base64 = reader.result;

          const replyToForPayload = groupReplyTo ? {
            id: groupReplyTo.id,
            text: groupReplyTo.text,
            senderId: groupReplyTo.senderId || (groupReplyTo.sender === 'You' ? user.id : groupReplyTo.from),
          } : null;

          socket.emit('sendGroupMessage', {
            groupId: gid,
            message: '',
            file: base64,
            fileName: file.name,
            fileType: file.type,
            from: user.id,
            fromName: user.name,
            replyTo: replyToForPayload,
            timestamp: Date.now(),
            messageId: tempId,
          });

          setGroupMessages(prev => ({
            ...prev,
            [gid]: [
              ...(prev[gid] || []),
              {
                id: tempId,
                text: '',
                sender: 'You',
                senderId: user.id,
                file: base64,
                fileName: file.name,
                fileType: file.type,
                replyTo: replyToForPayload,
                timestamp: Date.now(),
                delivered: false,
                read: false,
              },
            ],
          }));

          setGroupsList(prev => {
            const exists = prev.some(g => String(g.id) === String(gid));
            return exists ? prev.map(g =>
              String(g.id) === String(gid)
                ? { ...g, lastMsg: `You: ${file.type?.startsWith('image/') ? '📷 Photo' : '📄 ' + file.name}`, lastTime: Date.now() }
                : g
            ) : prev;
          });

          requestAnimationFrame(() => {
            if (messagesEndRef.current) {
              messagesEndRef.current.scrollIntoView({ behavior: 'instant' });
            }
          });

          setGroupReplyTo(null);
        };
        reader.readAsDataURL(file);
      };

      const emptyState = (title, desc, icon) => (
        <div className="empty-state">
          <div className="empty-state-icon">{icon}</div>
          <h3>{title}</h3>
          <p>{desc}</p>
        </div>
      );

      const chatEmptyIcon = (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 3C7 3 3 6.6 3 11c0 1.9.8 3.7 2 5v5l4.5-2.2c.8.2 1.6.2 2.5.2 5 0 9-3.6 9-8S17 3 12 3Z" fill="currentColor" opacity="0.9" />
          <circle cx="8.5" cy="11" r="1.3" fill="#025144" />
          <circle cx="12" cy="11" r="1.3" fill="#025144" />
          <circle cx="15.5" cy="11" r="1.3" fill="#025144" />
        </svg>
      );

      const groupEmptyIcon = (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="9" cy="8" r="3.2" fill="currentColor" />
          <path d="M3.5 19c.6-3 2.8-4.5 5.5-4.5s4.9 1.5 5.5 4.5H3.5Z" fill="currentColor" opacity="0.9" />
          <circle cx="17" cy="9" r="2.4" fill="currentColor" opacity="0.85" />
          <path d="M15.5 14.6c2.2.3 3.9 1.6 4.5 3.9h2c-.6-3-2.4-5.2-5-5.7" fill="currentColor" opacity="0.85" />
        </svg>
      );

      const renderGroupChat = () => {
        if (!selectedGroup) {
          return emptyState(
            'Select a group',
            'Choose a group from the list to start chatting.',
            groupEmptyIcon
          );
        }
        const gid = selectedGroup.id;
        const groupMsgs = groupMessages[gid] || [];
        const groupMemberCount = Array.isArray(selectedGroup.members)
          ? selectedGroup.members.length
          : (selectedGroup.memberCount || 0);

        const groupSearchMatches = chatSearchQuery
          ? groupMsgs.filter((m) => m.text?.toLowerCase().includes(chatSearchQuery.toLowerCase()))
          : [];

        return (
          <div className="chat-container">
            <div className="chat-window">
              <div className="chat-header">
                {isSelectionMode && isMobile ? (
                  <>
                  {/* Group Mobile Selection Header */}
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
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <button
                        onClick={() => {
                          setIsSelectionMode(false);
                          setSelectedMessages(new Set());
                          setShowSelDropdown(false);
                        }}
                        className="mobile-selection-action"
                        aria-label="Back"
                      >
                        <ArrowLeft size={22} strokeWidth={2.2} />
                      </button>
                      <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>
                        {selectedMessages.size} selected
                      </span>
                    </div>
                    {selectedMessages.size > 0 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                        <button
                          className="mobile-selection-action"
                          onClick={() => {
                            const firstMsg = groupMsgs.find((m) => selectedMessages.has(m.id));
                            if (firstMsg) {
                              setGroupReplyTo({
                                id: firstMsg.id,
                                text: firstMsg.text || '[Image]',
                                sender: contacts.find(c => String(c.id) === String(firstMsg.senderId))?.name || firstMsg.sender || firstMsg.fromName || firstMsg.from || 'Member',
                                from: firstMsg.senderId || firstMsg.from,
                              });
                            }
                            setIsSelectionMode(false);
                            setSelectedMessages(new Set());
                          }}
                          aria-label="Reply to selected"
                        >
                          <CornerUpLeft size={21} strokeWidth={2.2} />
                        </button>
                        <button
                          className="mobile-selection-action"
                          onClick={() => { openDeleteSelection('group', gid); }}
                          aria-label="Delete selected messages"
                        >
                          <Trash2 size={21} strokeWidth={2.2} style={{ color: '#e02f5b' }} />
                        </button>
                        <button
                          className="mobile-selection-action"
                          onClick={() => {
                            setShowForwardModal(true);
                            setForwardSearchQuery('');
                            setSelectedForwardChats(new Set());
                          }}
                          aria-label="Forward selected messages"
                        >
                          <Forward size={21} strokeWidth={2.2} />
                        </button>
                        <button
                          className="mobile-selection-action"
                          onClick={() => setShowSelDropdown((v) => !v)}
                          aria-label="More options"><span style={{ display:'inline-block', fontSize:'1.6rem', fontWeight:700, lineHeight:1 }}>⋮</span></button>
                        {showSelDropdown && (
                          <div
                            className="mobile-sel-dropdown"
                            style={{
                              position: 'absolute',
                              top: '64px',
                              right: '10px',
                              background: 'white',
                              borderRadius: '12px',
                              boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                              border: '1px solid #eee',
                              zIndex: 40000,
                              overflow: 'hidden',
                              minWidth: '150px',
                              animation: 'mobileMenuDown 0.2s ease-out',
                            }}
                          >
                            <button
                              className="mobile-sel-dropdown-item"
                              onClick={() => {
                                const texts = groupMsgs
                                  .filter((m) => selectedMessages.has(m.id) && m.text)
                                  .map((m) => {
                                    const sender = contacts.find(c => String(c.id) === String(m.senderId))?.name || m.sender || m.fromName || m.from || 'You';
                                    return `(${sender}) ${m.text}`;
                                  })
                                  .join('\n');
                                if (texts) {
                                  navigator.clipboard?.writeText(texts).catch(() => {});
                                }
                                setShowSelDropdown(false);
                              }}
                            >
                              <Copy size={16} strokeWidth={2.2} style={{ color: '#00a884' }} />
                              <span>Copy</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  </>
                ) : (
                <>
                <div className="header-left">
                  {isMobile && (
                    <button
                      className="mobile-header-back"
                      onClick={goBackPage}
                      aria-label="Back"
                    >
                      ‹
                    </button>
                  )}
                  <img
                    src={selectedGroup.dp || 'https://placehold.co/40x40'}
                    alt={selectedGroup.name}
                  />
                  <div className="user-info">
                    <h4>{selectedGroup.name}</h4>
                    <p>{groupMemberCount} members</p>
                  </div>
                </div>

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
                  <button
                        className="mobile-header-call"
                        onClick={() => startCall('voice', selectedGroup)}
                        aria-label="Call"
                      >
                        <Phone size={20} strokeWidth={2.2} />
                      </button>
                      <button
                        className="mobile-header-video"
                        onClick={() => startCall('video', selectedGroup)}
                        aria-label="Video call"
                      >
                        <Video size={21} strokeWidth={2.2} />
                      </button>

                  {chatSearchOpen ? (
                    <div
                      className="search-in-chat"
                      style={{ display: 'flex', alignItems: 'center', gap: 4 }}
                    >
                      <input
                        type="text"
                        placeholder="Search in group"
                        value={chatSearchQuery}
                        onChange={(e) => setChatSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && groupSearchMatches.length > 0) {
                            e.preventDefault();
                            const nextIndex = (chatCurrentResultIndex + 1) % groupSearchMatches.length;
                            setChatCurrentResultIndex(nextIndex);
                          }
                        }}
                        autoFocus
                      />
                      <span className="search-count">
                        {groupSearchMatches.length > 0
                          ? `${chatCurrentResultIndex + 1} of ${groupSearchMatches.length}`
                          : ''}
                      </span>
                      <button
                        onClick={() => {
                          setChatSearchOpen(false);
                          setChatSearchQuery('');
                          setChatSearchResults([]);
                          setChatCurrentResultIndex(-1);
                        }}
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ) : (
                    <button
                      className="search-btn"
                      onClick={() => {
                        setChatSearchOpen(true);
                      }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <Search size={18} />
                    </button>
                  )}

                  <button
                    className="menu-btn group-menu-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setGroupShowDropdown(!groupShowDropdown);
                      const button = e.currentTarget;
                      const rect = button.getBoundingClientRect();
                      if (isMobile) {
                        const headerEl = document.querySelector('.chat-header');
                        const hr = headerEl?.getBoundingClientRect();
                        setGroupDropdownPos({
                          top: hr ? hr.bottom : rect.bottom,
                          right: 0,
                          placement: 'top',
                        });
                      } else {
                        setGroupDropdownPos({
                          top: rect.bottom,
                          right: window.innerWidth - rect.right,
                          placement: 'bottom',
                        });
                      }
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
                 </div>
                </>
                )}

                {groupShowDropdown && (
                  <div className="menu-container">
                    <div
                      ref={groupDropdownRef}
                      className="chat-menu-dropdown"
                      style={{
                        position: isMobile ? 'fixed' : 'absolute',
                        top: `${groupDropdownPos.top}px`,
                        right: `${groupDropdownPos.right}px`,
                        width: isMobile ? '200px' : '240px',
                        background: 'white',
                        borderRadius: '12px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                        border: '1px solid #ddd',
                        zIndex: isMobile ? 40000 : 1000,
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
                          setGroupShowDropdown(false);
                          setShowGroupInfo(true);
                        }}
                      >
                        <Info size={18} strokeWidth={1.8} />
                        <span>Group info</span>
                      </button>

                      {isMobile && (
                        <button
                          className="dropdown-item"
                          onClick={() => {
                            setGroupMobileSearch(true);
                            setGroupMobileSearchQuery('');
                            setGroupMobileSearchIndex(-1);
                            setGroupMobileSearchResults([]);
                            setGroupShowDropdown(false);
                          }}
                        >
                          <Search size={18} strokeWidth={2.2} style={{ color: '#00a884' }} />
                          <span>Search</span>
                        </button>
                      )}

                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setSelectedGroup(null);
                          selectedGroupRef.current = null;
                          setGroupShowDropdown(false);
                        }}
                      >
                        <span>✕</span>
                        <span>Close chat</span>
                      </button>
                      <div className="divider"></div>
                      <button
                        className="dropdown-item"
                        style={{ color: 'red' }}
                        onClick={() => {
                          setClearTarget({ chatType: 'group', chatId: gid, name: selectedGroup?.name });
                          setShowClearChatConfirm(true);
                          setGroupShowDropdown(false);
                        }}
                      >
                        <Trash2 size={18} strokeWidth={1.8} />
                        <span>Clear chat</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Group Mobile Search Overlay (replaces header while searching) */}
                {isMobile && groupMobileSearch && (
                  <div className="mobile-search-bar">
                    <button
                      className="mobile-search-back"
                      onClick={() => {
                        setGroupMobileSearch(false);
                        setGroupMobileSearchQuery('');
                        setGroupMobileSearchIndex(-1);
                        setGroupMobileSearchResults([]);
                      }}
                      aria-label="Back"
                    >
                      <ArrowLeft size={22} strokeWidth={2.2} />
                    </button>
                    <input
                      autoFocus
                      placeholder="Search messages"
                      value={groupMobileSearchQuery}
                      onChange={(e) => {
                        const q = e.target.value;
                        setGroupMobileSearchQuery(q);
                        const matches = groupMsgs
                          .filter((m) => q && m.text?.toLowerCase().includes(q.toLowerCase()))
                          .map((m) => m.id);
                        setGroupMobileSearchResults(matches);
                        setGroupMobileSearchIndex(matches.length ? 0 : -1);
                      }}
                    />
                    {groupMobileSearchResults.length > 0 && (
                      <>
                        <span className="mobile-search-count">
                          {groupMobileSearchIndex + 1} / {groupMobileSearchResults.length}
                        </span>
                        <button
                          className="mobile-search-nav"
                          onClick={() =>
                            setGroupMobileSearchIndex(
                              (i) => (i - 1 + groupMobileSearchResults.length) % groupMobileSearchResults.length
                            )
                          }
                          aria-label="Previous match"
                        >
                          <ChevronUp size={20} strokeWidth={2.2} />
                        </button>
                        <button
                          className="mobile-search-nav"
                          onClick={() =>
                            setGroupMobileSearchIndex((i) => (i + 1) % groupMobileSearchResults.length)
                          }
                          aria-label="Next match"
                        >
                          <ChevronDown size={20} strokeWidth={2.2} />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

<div className="messages" ref={messagesScrollRef} onScroll={handleChatScroll}>
                {groupMsgs.length === 0 && (
                  <div
                    style={{
                      textAlign: 'center',
                      color: '#8696a0',
                      padding: '20px',
                      fontSize: '0.9rem',
                    }}
                  >
                    No group messages yet. Say hello!
                  </div>
                )}
                {(() => {
                  const grpCalls = (calls || []).filter(c => String(c.groupId) === String(selectedGroup.id));
                  const grpEntries = [
                    ...groupMsgs.map(m => ({ kind: 'msg', msg: m, t: Number(m.timestamp) || 0 })),
                    ...grpCalls.map(c => ({ kind: 'call', call: c, t: Number(c.time) || Number(c.timestamp) || 0 })),
                  ].sort((a, b) => a.t - b.t);
                  return grpEntries.map((entry) => {
                    if (entry.kind === 'call') {
                      const c = entry.call;
                      return (
                        <div key={`gcall-${c.id || c._id || entry.t}`} className={`call-history-row ${c.direction === 'missed' ? 'missed' : ''}`}>
                          <span className="call-history-icon">{c.video ? '📹' : '📞'}</span>
                          <span className="call-history-text">
                            {c.video ? 'Video call' : 'Voice call'}
                          </span>
                          <span className="call-history-time">{formatCallDate(c.time || c.timestamp)}</span>
                        </div>
                      );
                    }
                    const msg = entry.msg;
                    const isMatch =
                    chatSearchQuery &&
                    msg.text?.toLowerCase().includes(chatSearchQuery.toLowerCase());
                  const isCurrentMatch =
                    isMatch && msg.id === groupSearchMatches[chatCurrentResultIndex]?.id;
                  const isYou = String(msg.senderId) === String(user.id) || msg.sender === 'You';
                  const groupIsMobileHit =
                    isMobile && groupMobileSearch && groupMobileSearchQuery &&
                    msg.text?.toLowerCase().includes(groupMobileSearchQuery.toLowerCase());
                  const groupIsMobileCurrent =
                    groupIsMobileHit && msg.id === groupMobileSearchResults[groupMobileSearchIndex];
                  const groupIsMsgSelected = isSelectionMode && selectedMessages.has(msg.id);

                  return (
                    <div
                      key={msg.id}
                      data-msgid={msg.id}
                      className={`message ${isYou ? 'sent' : 'received'} ${isMatch ? 'highlighted' : ''} ${groupIsMobileHit ? 'mobile-search-hit' : ''} ${groupIsMobileCurrent ? 'mobile-search-current' : ''} ${groupIsMsgSelected ? 'selected-msg' : ''}`}
                      ref={(el) => {
                        groupMessageElsRef.current[msg.id] = el;
                        if (isCurrentMatch) chatCurrentMatchRef.current = el;
                        if (groupIsMobileCurrent) groupMobileCurrentMatchRef.current = el;
                      }}
                      onClick={() => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
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
                      onPointerDown={() => {
                        if (isMobile && !isSelectionMode) {
                          startLongPress(() => {
                            setIsSelectionMode(true);
                            const ns = new Set(selectedMessages);
                            ns.add(msg.id);
                            setSelectedMessages(ns);
                          });
                        }
                      }}
                      onPointerUp={clearLongPress}
                      onPointerLeave={clearLongPress}
                      onPointerCancel={clearLongPress}
                      onContextMenu={(e) => {
                        if (isMobile) {
                          e.preventDefault();
                          suppressClickRef.current = true;
                          setIsSelectionMode(true);
                          const newSelected = new Set(selectedMessages);
                          newSelected.add(msg.id);
                          setSelectedMessages(newSelected);
                        }
                      }}
                      style={{ position: 'relative', cursor: isSelectionMode ? 'pointer' : 'auto' }}
                    >
                      {!isYou && (
                        <div
                          className="group-sender"
                          style={{
                            fontSize: '0.75rem',
                            fontWeight: 600,
                            color: '#075e54',
                            marginBottom: '2px',
                          }}
                        >
                          {contacts.find(c => String(c.id) === String(msg.senderId))?.name || msg.sender || msg.fromName || msg.from || 'Member'}
                        </div>
                      )}

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
                            : contacts.find(c => String(c.id) === String(msg.replyTo.senderId))?.name || msg.replyTo.sender || 'Member'}
                          : {msg.replyTo.text || '[Image]'}
                        </div>
                      )}

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
                                <Copy size={16} strokeWidth={1.8} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Copy
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setGroupReplyTo({
                                  id: msg.id,
                                  text: msg.text || '[Image]',
                                  sender: contacts.find(c => String(c.id) === String(msg.senderId))?.name || msg.sender || msg.fromName,
                                  from: msg.senderId || msg.from,
                                });
                                setOpenActionMenu(null);
                                messageInputRef.current?.focus();
                              }}
                              style={dropdownItemStyle}
                            >
                              <CornerUpRight size={16} strokeWidth={1.8} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Reply
                            </button>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(
                                  msg.file ? msg.fileName : msg.text || ''
                                );
                                setOpenActionMenu(null);
                              }}
                              style={dropdownItemStyle}
                            >
                              <Forward size={16} strokeWidth={1.8} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Forward
                            </button>
                            {isYou && (
                              <button
                                onClick={() => {
                                  openDeleteFlow('group', gid, msg);
                                  setOpenActionMenu(null);
                                }}
                                style={{ ...dropdownItemStyle, color: 'red' }}
                              >
                                <Trash2 size={16} strokeWidth={1.8} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Delete
                              </button>
                            )}
                          </>
                        </div>
                      )}

{!msg.file && msg.text && (
            <div style={{ wordBreak: 'break-word' }}>{linkify(msg.text)}</div>
          )}

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

                      {msg.file && msg.fileType?.startsWith('audio/') && (
                        <VoiceBubble msg={msg} />
                      )}

                      {/* Video: render inline instead of a file card */}
                      {msg.file && msg.fileType?.startsWith('video/') && (
                        <video
                          src={msg.file}
                          controls
                          className="chat-inline-video"
                          preload="metadata"
                        />
                      )}

                      {msg.file && !msg.fileType?.startsWith('image/') && !msg.fileType?.startsWith('audio/') && !msg.fileType?.startsWith('video/') && (
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
                              <div style={{ fontSize: '0.8rem', color: '#666' }}>
                                {msg.fileType}
                              </div>
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

                      <div className="timestamp-container">
                        <span className="timestamp">{formatTime(msg.timestamp)}</span>
                        {isYou && (
                          <div className={`message-status ${msg.allRead ? 'read' : ''}`}>
                            <WhatsAppTicks read={msg.allRead} delivered={msg.delivered} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                  });
                  })()}
                <div ref={messagesEndRef} />
              </div>

              <div className="message-input" style={{ display: isMobile ? 'none' : 'flex' }}>
                <form onSubmit={handleSendGroupMessage}>
                  <div className="input-wrapper">
                    {groupReplyTo && (
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
                        ↪ Replying to {groupReplyTo.sender}: "{groupReplyTo.text || '[Image]'}"
                        <button
                          type="button"
                          onClick={() => setGroupReplyTo(null)}
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
                      onClick={() => setGroupShowAttach((prev) => !prev)}
                      aria-label="Attach file"
                    >
                      <Paperclip size={22} strokeWidth={1.8} />
                    </button>

                    <input
                      ref={messageInputRef}
                      type="text"
                      value={desktopDraft}
                      onChange={(e) => setDesktopDraft(e.target.value)}
                      placeholder={groupReplyTo ? 'Reply to message...' : 'Type a group message'}
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
                  onChange={handleGroupFileChange}
                  onClick={(e) => (e.target.value = null)}
                />

                {groupShowAttach && (
                  <div className="attachment-dropdown">
                    <button
                      onClick={() => {
                        fileInputRef.current.accept = 'image/*,video/*';
                        fileInputRef.current.click();
                      }}
                    >
                      <Images size={16} strokeWidth={1.8} style={{ marginRight: 8, verticalAlign: 'middle' }} /> Photos & Videos
                    </button>
                    <button
                      onClick={() => {
                        setGroupShowAttach(false);
                        handleOpenCamera();
                      }}
                    >
                      <Camera size={16} strokeWidth={1.8} style={{ marginRight: 8, verticalAlign: 'middle' }} /> Camera
                    </button>
                    <button
                      onClick={() => {
                        fileInputRef.current.accept = '.pdf,.doc,.docx,.txt,.zip,.xls,.xlsx';
                        fileInputRef.current.click();
                      }}
                    >
                      <FileText size={16} strokeWidth={1.8} style={{ marginRight: 8, verticalAlign: 'middle' }} /> Document
                    </button>
                  </div>
                )}
              </div>

              {isMobile && (
                <div className="mobile-compose">
                  {!showMobileAttach && (
                  <>
                  <div className="mobile-input-row">
                    <form className="mobile-input-form" onSubmit={handleSendGroupMessage}>
                      <textarea
                        ref={messageInputRef}
                        rows={1}
                        enterKeyHint="enter"
                        value={desktopDraft}
                        onChange={(e) => {
                          setDesktopDraft(e.target.value);
                          e.target.style.height = 'auto';
                          e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                        }}
                        placeholder={groupReplyTo ? 'Reply to message...' : 'Message'}
                        aria-label="Message"
                      />
                      <button
                        type="button"
                        className="mobile-attach-btn"
                        onClick={() => setShowMobileAttach((prev) => !prev)}
                        aria-label="Attach file"
                      >
                        <Paperclip size={22} strokeWidth={2.2} />
                      </button>
                      <button
                        type="button"
                        className="mobile-camera-btn"
                        onClick={handleOpenCamera}
                        aria-label="Camera"
                      >
                        <Camera size={22} strokeWidth={2.2} />
                      </button>
                      {desktopDraft.trim() ? (
                        <button type="submit" className="mobile-send-btn" aria-label="Send">
                          ➤
                        </button>
                      ) : (
                        <button
                          type="button"
                          className={`mobile-voice-btn ${mobileRecording ? 'recording' : ''}`}
                          onPointerDown={(e) => { e.preventDefault(); setShowMobileAttach(false); startVoiceRecord(e); }}
                          onPointerUp={(e) => { e.preventDefault(); stopVoiceRecord(e); }}
                          onPointerCancel={(e) => { e.preventDefault(); stopVoiceRecord(e); }}
                          onPointerLeave={(e) => { e.preventDefault(); stopVoiceRecord(e); }}
                          aria-label="Hold to record"
                        >
                          {mobileRecording ? <span className="mobile-voice-btn-dot" /> : <Mic size={22} strokeWidth={2.2} />}
                        </button>
                      )}
                    </form>
                  </div>

                  {groupReplyTo && (
                    <div className="mobile-reply-banner">
                      ↪ Replying to {groupReplyTo.sender}: "{groupReplyTo.text || '[Image]'}"
                      <button type="button" onClick={() => setGroupReplyTo(null)}>×</button>
                    </div>
                  )}

                  {mobileRecording && (
                    <div className="mobile-recording-bar">🔴 Recording… {recDuration}s <small>(release to send · swipe up to cancel)</small><button type="button" className="rec-cancel-btn" onClick={cancelVoiceRecord}>Cancel</button></div>
                  )}
                  </>
                  )}

                  {showMobileAttach && (
                    <>
                    <div className="mobile-attach-backdrop" onClick={() => setShowMobileAttach(false)} />
                    <div className="mobile-attach-drawer">
                      <div className="mobile-attach-drawer-handle" />
                      <button
                        onClick={() => {
                          fileInputRef.current.accept = 'image/*,video/*';
                          fileInputRef.current.click();
                          setShowMobileAttach(false);
                        }}
                      >
                        <span className="att-icon" style={{ background: '#dcf8c6', color: '#075e54' }}><Image size={20} strokeWidth={1.8} /></span>
                        Photos &amp; Videos
                      </button>
                      <button onClick={() => { handleOpenCamera(); setShowMobileAttach(false); }}>
                        <span className="att-icon" style={{ background: '#fdeaca', color: '#e8a700' }}><Camera size={20} strokeWidth={1.8} /></span>
                        Camera
                      </button>
                      <button
                        onClick={() => {
                          fileInputRef.current.accept = '.pdf,.doc,.docx,.txt,.zip,.xls,.xlsx';
                          fileInputRef.current.click();
                          setShowMobileAttach(false);
                        }}
                      >
                        <span className="att-icon" style={{ background: '#d7e7fb', color: '#1a73e8' }}><FileText size={20} strokeWidth={1.8} /></span>
                        Document
                      </button>
                      <button className="att-close" onClick={() => setShowMobileAttach(false)}>✕ Close</button>
                    </div>
                    </>
                  )}

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
                    onChange={handleGroupFileChange}
                    onClick={(e) => (e.target.value = null)}
                  />
                </div>
              )}
            </div>
          </div>
        );
      };

      const renderRightPanel = () => {
      if (!selectedChat) {
        return emptyState(
          'Select a chat',
          'Choose a conversation from the list to start messaging.',
          chatEmptyIcon
        );
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
  setDesktopDraft('');
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
            position: 'relative',
          }}
        >
          {isMobile ? (
            <>
            {/* Mobile: Left = Back arrow + Count */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <button
                onClick={() => {
                  setIsSelectionMode(false);
                  setSelectedMessages(new Set());
                  setShowSelDropdown(false);
                }}
                className="mobile-selection-action"
                aria-label="Back"
              >
                <ArrowLeft size={22} strokeWidth={2.2} />
              </button>
              <span style={{ fontWeight: 'bold', fontSize: '1rem' }}>
                {selectedMessages.size} selected
              </span>
            </div>
            {/* Mobile: Right = Reply, Delete, Forward, Three-dot(Copy) */}
            {selectedMessages.size > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                <button
                  className="mobile-selection-action"
                  onClick={() => {
                    const firstMsg = chatMessages.find((m) => selectedMessages.has(m.id));
                    if (firstMsg) setReplyTo({ id: firstMsg.id, sender: firstMsg.sender, text: firstMsg.text });
                    setIsSelectionMode(false);
                    setSelectedMessages(new Set());
                  }}
                  aria-label="Reply to selected"
                >
                  <CornerUpLeft size={21} strokeWidth={2.2} />
                </button>
                <button
                  className="mobile-selection-action"
                  onClick={() => {
                    openDeleteSelection('dm', selectedChat.id);
                  }}
                  aria-label="Delete selected messages"
                >
                  <Trash2 size={21} strokeWidth={2.2} style={{ color: '#e02f5b' }} />
                </button>
                <button
                  className="mobile-selection-action"
                  onClick={() => {
                    setShowForwardModal(true);
                    setForwardSearchQuery('');
                    setSelectedForwardChats(new Set());
                  }}
                  aria-label="Forward selected messages"
                >
                  <Forward size={21} strokeWidth={2.2} />
                </button>
                <button
                  className="mobile-selection-action"
                  onClick={() => setShowSelDropdown((v) => !v)}
                  aria-label="More options"><span style={{ display:'inline-block', fontSize:'1.6rem', fontWeight:700, lineHeight:1 }}>⋮</span></button>
                {showSelDropdown && (
                  <div
                    className="mobile-sel-dropdown"
                    style={{
                      position: 'absolute',
                      top: '64px',
                      right: '10px',
                      background: 'white',
                      borderRadius: '12px',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                      border: '1px solid #eee',
                      zIndex: 40000,
                      overflow: 'hidden',
                      minWidth: '150px',
                      animation: 'mobileMenuDown 0.2s ease-out',
                    }}
                  >
                    <button
                      className="mobile-sel-dropdown-item"
                      onClick={() => {
                        const texts = chatMessages
                          .filter((m) => selectedMessages.has(m.id) && m.text)
                          .map((m) => `(${m.sender === 'You' ? 'You' : m.sender}) ${m.text}`)
                          .join('\n');
                        if (texts) {
                          navigator.clipboard?.writeText(texts).catch(() => {});
                        }
                        setShowSelDropdown(false);
                      }}
                    >
                      <Copy size={16} strokeWidth={2.2} style={{ color: '#00a884' }} />
                      <span>Copy</span>
                    </button>
                  </div>
                )}
              </div>
            )}
            </>
          ) : (
            <>
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
                onClick={() => { openDeleteSelection('dm', selectedChat.id); }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'red',
                  cursor: 'pointer',
                  fontSize: '1.6rem',
                }}
                aria-label="Delete selected messages"
              >
                <Trash2 size={22} strokeWidth={1.8} />
              </button>
              <button
                onClick={() => {
                  setShowForwardModal(true);
                  setForwardSearchQuery('');
                  setSelectedForwardChats(new Set());
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
            </>
          )}
        </div>
      ) : (
        /* Regular Header */
        <div className="header-left">
          {isMobile && (
            <button
              className="mobile-header-back"
              onClick={goBackPage}
              aria-label="Back"
            >
              ‹
            </button>
          )}
          <img
            src={selectedChat?.photo || 'https://via.placeholder.com/40'}
            alt={selectedChat?.name}
          />
          <div
            className="user-info"
            style={isMobile ? { cursor: 'pointer' } : undefined}
            onClick={() => isMobile && setShowContactInfo(true)}
          >
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
            <button
              className="mobile-header-call"
              onClick={() => selectedChat && startCall('voice', selectedChat)}
              aria-label="Call"
            >
              <Phone size={20} strokeWidth={2.2} />
            </button>
            <button
              className="mobile-header-video"
              onClick={() => selectedChat && startCall('video', selectedChat)}
              aria-label="Video call"
            >
              <Video size={21} strokeWidth={2.2} />
            </button>
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
                if (isMobile) {
                  const headerEl = document.querySelector('.chat-header');
                  const hr = headerEl?.getBoundingClientRect();
                  setDropdownPosition({
                    top: hr ? hr.bottom : rect.bottom,
                    right: 0,
                    placement: 'top',
                  });
                } else {
                  setDropdownPosition({
                    top: rect.bottom,
                    right: window.innerWidth - rect.right,
                    placement: 'bottom',
                  });
                }
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
      {!isSelectionMode && showDropdown && selectedChat && createPortal(
        <div className="menu-container">
          <div
            ref={dropdownRef}
            className="chat-menu-dropdown"
            style={{
              position: 'fixed',
              top: `${dropdownPosition.top}px`,
              right: `${dropdownPosition.right}px`,
              width: isMobile ? '200px' : '240px',
              background: 'white',
              borderRadius: '12px',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              border: '1px solid #ddd',
              zIndex: 40000,
              overflow: 'hidden',
              opacity: 1,
              visibility: 'visible',
              animation: isMobile ? 'mobileMenuDown 0.24s ease-out' : 'none',
              transform: 'none',
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

            {isMobile ? (
              <>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setShowContactInfo(true);
                    setShowDropdown(false);
                  }}
                >
                  <Info size={18} strokeWidth={2.2} style={{ color: '#00a884' }} />
                  <span>Contact info</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setMobileSearch(true);
                    setMobileSearchQuery('');
                    setMobileSearchIndex(-1);
                    setMobileSearchResults([]);
                    setShowDropdown(false);
                  }}
                >
                  <Search size={18} strokeWidth={2.2} style={{ color: '#00a884' }} />
                  <span>Search</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setShowDropdown(false);
                    if (selectedChat) setMediaViewer({ type: 'dm', chatId: selectedChat.id, chatName: selectedChat.name, tab: 'media' });
                  }}
                >
                  <FileText size={18} strokeWidth={2.2} style={{ color: '#00a884' }} />
                  <span>Media, links and docs</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setShowClearChatConfirm(true);
                    setShowDropdown(false);
                  }}
                >
                  <Trash2 size={18} strokeWidth={2.2} style={{ color: '#e02f5b' }} />
                  <span>Clear chat</span>
                </button>
              </>
            ) : (
              <>
            <button
              className="dropdown-item"
              onClick={() => {
                setShowContactInfo(true);
                setShowDropdown(false);
              }}
            >
              <Info size={18} strokeWidth={1.8} />
              <span>Contact info</span>
            </button>
            <button
              className="dropdown-item"
              onClick={() => {
                setShowDropdown(false);
                if (selectedChat) setMediaViewer({ type: 'dm', chatId: selectedChat.id, chatName: selectedChat.name, tab: 'media' });
              }}
            >
              <FileText size={18} strokeWidth={1.8} />
              <span>Media, links and docs</span>
            </button>
            <button
              className="dropdown-item"
              onClick={() => {
                setIsSelectionMode(true);
                setShowDropdown(false);
              }}
            >
              <Check size={18} strokeWidth={1.8} />
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
              <Trash2 size={18} strokeWidth={1.8} />
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
                    safeSetItem('chatMessages', newMsgs);
                    return newMsgs;
                  });
                  setSelectedChat(null);
                }
                setShowDropdown(false);
              }}
            >
              <X size={18} strokeWidth={1.8} />
              <span>Delete chat</span>
            </button>
              </>
            )}
          </div>
        </div>
      , document.body)}

      {/* Mobile Search Overlay (replaces header while searching) */}
      {isMobile && mobileSearch && (
        <div className="mobile-search-bar">
          <button
            className="mobile-search-back"
            onClick={() => {
              setMobileSearch(false);
              setMobileSearchQuery('');
              setMobileSearchIndex(-1);
              setMobileSearchResults([]);
            }}
            aria-label="Back"
          >
            <ArrowLeft size={22} strokeWidth={2.2} />
          </button>
          <input
            ref={mobileSearchInputRef}
            autoFocus
            placeholder="Search messages"
            value={mobileSearchQuery}
            onChange={(e) => {
              const q = e.target.value;
              setMobileSearchQuery(q);
              const matches = chatMessages
                .filter((m) => q && m.text?.toLowerCase().includes(q.toLowerCase()))
                .map((m) => m.id);
              setMobileSearchResults(matches);
              setMobileSearchIndex(matches.length ? 0 : -1);
            }}
          />
          {mobileSearchResults.length > 0 && (
            <>
              <span className="mobile-search-count">
                {mobileSearchIndex + 1} / {mobileSearchResults.length}
              </span>
              <button
                className="mobile-search-nav"
                onClick={() =>
                  setMobileSearchIndex(
                    (i) => (i - 1 + mobileSearchResults.length) % mobileSearchResults.length
                  )
                }
                aria-label="Previous match"
              >
                <ChevronUp size={20} strokeWidth={2.2} />
              </button>
              <button
                className="mobile-search-nav"
                onClick={() =>
                  setMobileSearchIndex((i) => (i + 1) % mobileSearchResults.length)
                }
                aria-label="Next match"
              >
                <ChevronDown size={20} strokeWidth={2.2} />
              </button>
            </>
          )}
        </div>
      )}
    </div>

    {/* Messages */}
    <div className="messages" ref={messagesScrollRef} onScroll={handleChatScroll}>
      {(() => {
        const dmCalls = (calls || []).filter(c => String(c.userId) === String(selectedChat.id));
        const dmEntries = [
          ...chatMessages.map(m => ({ kind: 'msg', msg: m, t: Number(m.timestamp) || 0 })),
          ...dmCalls.map(c => ({ kind: 'call', call: c, t: Number(c.time) || Number(c.timestamp) || 0 })),
        ].sort((a, b) => a.t - b.t);
        return dmEntries.map((entry) => {
          if (entry.kind === 'call') {
            const c = entry.call;
            return (
              <div key={`call-${c.id || c._id || entry.t}`} className={`call-history-row ${c.direction === 'missed' ? 'missed' : ''}`}>
                <span className="call-history-icon">{c.video ? '📹' : '📞'}</span>
                <span className="call-history-text">
                  {c.video ? 'Video call' : 'Voice call'}
                  {c.direction === 'missed' ? ' (missed)' : ''}
                </span>
                <span className="call-history-time">{formatCallDate(c.time || c.timestamp)}</span>
              </div>
            );
          }
          const msg = entry.msg;
        const isMatch =
          searchQuery &&
          msg.text?.toLowerCase().includes(searchQuery.toLowerCase());
        const isCurrentMatch = isMatch && msg.id === searchResults[currentResultIndex];
        const isMobileHit =
          isMobile && mobileSearch && mobileSearchQuery &&
          msg.text?.toLowerCase().includes(mobileSearchQuery.toLowerCase());
        const isMobileCurrent =
          isMobileHit && msg.id === mobileSearchResults[mobileSearchIndex];
        const isMsgSelected = isSelectionMode && selectedMessages.has(msg.id);
        const isYou = msg.sender === 'You';

        return (
          <div
            key={msg.id}
            className={`message ${isYou ? 'sent' : 'received'} ${isMatch ? 'highlighted' : ''} ${isMobileHit ? 'mobile-search-hit' : ''} ${isMobileCurrent ? 'mobile-search-current' : ''} ${isMsgSelected ? 'selected-msg' : ''}`}
            ref={isMobileCurrent ? mobileCurrentMatchRef : isCurrentMatch ? currentMatchRef : null}
            onClick={() => {
              if (suppressClickRef.current) {
                suppressClickRef.current = false;
                return;
              }
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
            onPointerDown={() => {
              if (isMobile && !isSelectionMode) {
                startLongPress(() => {
                  setIsSelectionMode(true);
                  const ns = new Set(selectedMessages);
                  ns.add(msg.id);
                  setSelectedMessages(ns);
                });
              }
            }}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            onContextMenu={(e) => {
              if (isMobile) {
                e.preventDefault();
                suppressClickRef.current = true;
                setIsSelectionMode(true);
                const newSelected = new Set(selectedMessages);
                newSelected.add(msg.id);
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
                      <Copy size={16} strokeWidth={1.8} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Copy
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
                    <CornerUpRight size={16} strokeWidth={1.8} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Reply
                  </button>
                  <button
                    onClick={() => {
                      setOpenActionMenu(null);
                      setIsSelectionMode(true);
                      setSelectedMessages(new Set([msg.id]));
                    }}
                    style={dropdownItemStyle}
                  >
                    <Forward size={16} strokeWidth={1.8} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Forward
                  </button>
                  <button
                    onClick={() => {
                      openDeleteFlow('dm', selectedChat.id, msg);
                      setOpenActionMenu(null);
                    }}
                    style={{ ...dropdownItemStyle, color: 'red' }}
                  >
                    <Trash2 size={16} strokeWidth={1.8} style={{ marginRight: 6, verticalAlign: 'middle' }} /> Delete
                  </button>
                </>
              </div>
            )}

            {/* Message Text */}
            {!msg.file && msg.text && <div style={{ wordBreak: 'break-word' }}>{linkify(msg.text)}</div>}

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

            {/* Voice */}
            {msg.file && msg.fileType?.startsWith('audio/') && (
              <VoiceBubble msg={msg} />
            )}

            {/* Video: render inline instead of a file card */}
            {msg.file && msg.fileType?.startsWith('video/') && (
              <video
                src={msg.file}
                controls
                className="chat-inline-video"
                preload="metadata"
              />
            )}

            {/* Document */}
            {msg.file && !msg.fileType?.startsWith('image/') && !msg.fileType?.startsWith('audio/') && !msg.fileType?.startsWith('video/') && (
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
                  <WhatsAppTicks read={msg.read} delivered={msg.delivered} />
                </div>
              )}
            </div>
          </div>
        );
        });
        })()}
      <div ref={messagesEndRef} />
    </div>

    {/* Message Input */}
    {!isSelectionMode && (
      isMobile ? (
        <div className="mobile-compose">
          {!showMobileAttach && (
          <>
          <div className="mobile-input-row">
            <form className="mobile-input-form" onSubmit={handleSendMessage}>
              <textarea
                ref={messageInputRef}
                rows={1}
                enterKeyHint="enter"
                value={desktopDraft}
                onChange={(e) => {
                  setDesktopDraft(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                }}
                placeholder={replyTo ? 'Reply to message...' : 'Message'}
                aria-label="Message"
              />
              <button
                type="button"
                className="mobile-attach-btn"
                onClick={() => setShowMobileAttach((prev) => !prev)}
                aria-label="Attach file"
              >
                <Paperclip size={22} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                className="mobile-camera-btn"
                onClick={handleOpenCamera}
                aria-label="Camera"
              >
                <Camera size={22} strokeWidth={2.2} />
              </button>
              {desktopDraft.trim() ? (
                <button type="submit" className="mobile-send-btn" aria-label="Send">
                  ➤
                </button>
              ) : (
                <button
                  type="button"
                  className={`mobile-voice-btn ${mobileRecording ? 'recording' : ''}`}
                  onPointerDown={(e) => { e.preventDefault(); setShowMobileAttach(false); startVoiceRecord(e); }}
                  onPointerUp={(e) => { e.preventDefault(); stopVoiceRecord(e); }}
                  onPointerCancel={(e) => { e.preventDefault(); stopVoiceRecord(e); }}
                  onPointerLeave={(e) => { e.preventDefault(); stopVoiceRecord(e); }}
                  aria-label="Hold to record"
                >
                  {mobileRecording ? <span className="mobile-voice-btn-dot" /> : <Mic size={22} strokeWidth={2.2} />}
                </button>
              )}
            </form>
          </div>

          {replyTo && (
            <div className="mobile-reply-banner">
              ↪ Replying to {replyTo.sender}: "{replyTo.text || '[Image]'}"
              <button type="button" onClick={() => setReplyTo(null)}>×</button>
            </div>
          )}

          {mobileRecording && (
            <div className="mobile-recording-bar">🔴 Recording… {recDuration}s <small>(release to send · swipe up to cancel)</small><button type="button" className="rec-cancel-btn" onClick={cancelVoiceRecord}>Cancel</button></div>
          )}
          </>
          )}

          {showMobileAttach && (
            <>
            <div className="mobile-attach-backdrop" onClick={() => setShowMobileAttach(false)} />
            <div className="mobile-attach-drawer">
              <div className="mobile-attach-drawer-handle" />
              <button
                onClick={() => {
                  fileInputRef.current.accept = 'image/*,video/*';
                  fileInputRef.current.click();
                  setShowMobileAttach(false);
                }}
              >
                <span className="att-icon" style={{ background: '#dcf8c6', color: '#075e54' }}><Image size={20} strokeWidth={1.8} /></span>
                Photos &amp; Videos
              </button>
              <button onClick={() => { handleOpenCamera(); setShowMobileAttach(false); }}>
                <span className="att-icon" style={{ background: '#fdeaca', color: '#e8a700' }}><Camera size={20} strokeWidth={1.8} /></span>
                Camera
              </button>
              <button
                onClick={() => {
                  fileInputRef.current.accept = '.pdf,.doc,.docx,.txt,.zip,.xls,.xlsx';
                  fileInputRef.current.click();
                  setShowMobileAttach(false);
                }}
              >
                <span className="att-icon" style={{ background: '#d7e7fb', color: '#1a73e8' }}><FileText size={20} strokeWidth={1.8} /></span>
                Document
              </button>
              <button className="att-close" onClick={() => setShowMobileAttach(false)}>✕ Close</button>
            </div>
            </>
          )}

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
        </div>
      ) : (
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
              <Paperclip size={22} strokeWidth={1.8} />
            </button>

            <input
              ref={messageInputRef}
              type="text"
              value={desktopDraft}
              onChange={(e) => setDesktopDraft(e.target.value)}
              placeholder={replyTo ? 'Reply to message...' : 'Type a message'}
              required
            />

            {desktopDraft.trim() ? (
              <button type="submit">Send</button>
            ) : (
              <button
                type="button"
                className={`desktop-voice-btn ${mobileRecording ? 'recording' : ''}`}
                onPointerDown={(e) => { e.preventDefault(); startVoiceRecord(e); }}
                onPointerUp={(e) => { e.preventDefault(); stopVoiceRecord(e); }}
                onPointerLeave={(e) => { e.preventDefault(); stopVoiceRecord(e); }}
                aria-label="Hold to record voice message"
              >
                {mobileRecording ? <span className="mobile-voice-btn-dot" /> : <Mic size={20} strokeWidth={1.8} />}
              </button>
            )}
          </div>
        </form>

        {mobileRecording && (
          <div className="mobile-recording-bar desktop">🔴 Recording… {recDuration}s <small>(release to send)</small><button type="button" className="rec-cancel-btn" onClick={cancelVoiceRecord}>Cancel</button></div>
        )}

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
              <Images size={16} strokeWidth={1.8} style={{ marginRight: 8, verticalAlign: 'middle' }} /> Photos & Videos
            </button>
            <button onClick={handleOpenCamera}><Camera size={16} strokeWidth={1.8} style={{ marginRight: 8, verticalAlign: 'middle' }} /> Camera</button>
            <button
              onClick={() => {
                fileInputRef.current.accept = '.pdf,.doc,.docx,.txt,.zip,.xls,.xlsx';
                fileInputRef.current.click();
              }}
            >
              <FileText size={16} strokeWidth={1.8} style={{ marginRight: 8, verticalAlign: 'middle' }} /> Document
            </button>
          </div>
        )}
      </div>
      )
    )}
  </div>

  {/* Contact Info Drawer (only when open) */}
  {showContactInfo && (
    <>
      <div
        className="drawer-overlay"
        onClick={goBackPage}
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
          position: 'fixed',
          top: 0,
          right: 0,
          width: isMobile ? '100%' : '400px',
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
  onClick={goBackPage}
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
            <PencilLine size={20} strokeWidth={1.8} />
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
          <div
            className="action-item"
            style={{ cursor: 'pointer' }}
            onClick={() => selectedChat && setMediaViewer({ type: 'dm', chatId: selectedChat.id, chatName: selectedChat.name, tab: 'media' })}
          >
            {summarizeChatMedia(messages[selectedChat?.id] || [])}
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

  const forwardSelectedMessages = (target) => {
    const currentSocket = socketRef.current;
    const currentUser = userRef.current;
    if (!currentSocket || !currentUser?.id || !target?.id) return;

    const chatMessages = messages[selectedChat?.id] || [];
    const toForward = chatMessages.filter((m) => selectedMessages.has(m.id));
    if (toForward.length === 0) {
      setShowForwardModal(false);
      setIsSelectionMode(false);
      setSelectedMessages(new Set());
      return;
    }

    const now = Date.now();

    toForward.forEach((msg, idx) => {
      const tempId = `fwd-${now}-${idx}-${Math.random()}`;
      const payload = {
        to: target.id,
        from: currentUser.id,
        fromName: currentUser.name,
        fromPhoto: target.photo,
        timestamp: now,
        messageId: tempId,
      };
      if (msg.file) {
        payload.file = msg.file;
        payload.fileName = msg.fileName;
        payload.fileType = msg.fileType;
        payload.message = msg.text || '';
      } else {
        payload.message = msg.text || '';
      }

      currentSocket.emit('sendMessage', payload);

      setMessages((prev) => ({
        ...prev,
        [target.id]: [
          ...(prev[target.id] || []),
          {
            id: tempId,
            text: payload.message,
            file: payload.file || undefined,
            fileName: payload.fileName,
            fileType: payload.fileType,
            sender: 'You',
            timestamp: now,
            delivered: false,
            read: false,
          },
        ],
      }));
    });

    setShowForwardModal(false);
    setIsSelectionMode(false);
    setSelectedMessages(new Set());
  };


  return (
    <div className={`dashboard-layout ${isMobile && (mobileChatOpen || !!selectedChat?.id || !!selectedGroup?.id) ? 'chat-open' : ''}`}>
      <style
        dangerouslySetInnerHTML={{
          __html: `
/* ===== Group Creation Flow (injected inline to bypass CSS pipeline) ===== */
.group-flow-overlay {
  position: relative !important; flex: 1 1 0 !important; min-height: 0 !important;
  width: 100% !important; height: 100% !important;
  background: #f7f8fa !important; display: flex !important; flex-direction: column !important; overflow: hidden !important;
}
.group-flow {
  display: flex !important; flex-direction: column !important; flex: 1 1 auto !important; align-self: stretch !important;
  width: 100% !important; height: auto !important; min-height: 100% !important; overflow: visible !important; background: #f7f8fa !important;
}
.group-flow.slide-in-forward { animation: groupSlideForward 0.32s cubic-bezier(0.22,1,0.36,1) forwards !important; }
.group-flow.slide-in-backward { animation: groupSlideBackward 0.32s cubic-bezier(0.22,1,0.36,1) forwards !important; }
@keyframes groupSlideForward { from { transform: translateX(100%); opacity: 0.4; } to { transform: translateX(0); opacity: 1; } }
@keyframes groupSlideBackward { from { transform: translateX(-100%); opacity: 0.4; } to { transform: translateX(0); opacity: 1; } }
.group-screen { display: flex !important; flex-direction: column !important; flex: 1 1 0 !important; width: 100% !important; height: auto !important; min-height: 0 !important; background: #fff !important; overflow: hidden !important; }
.group-header { display: flex !important; align-items: center !important; gap: 10px !important; padding: 14px 12px !important; background: #075e54 !important; color: #fff !important; flex-shrink: 0 !important; }
.group-back-btn { background: rgba(255,255,255,0.15) !important; border: none !important; color: #fff !important; width: 38px !important; height: 38px !important; min-width: 38px !important; min-height: 38px !important; border-radius: 50% !important; cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important; flex-shrink: 0 !important; }
.group-back-btn:hover { background: rgba(255,255,255,0.28) !important; }
.group-header-text { display: flex !important; flex-direction: column !important; gap: 1px !important; }
.group-header-title { font-size: 1.1rem !important; font-weight: 600 !important; color: #fff !important; }
.group-header-count { font-size: 0.78rem !important; color: rgba(255,255,255,0.85) !important; font-weight: 400 !important; }
.group-search { position: relative !important; padding: 12px !important; background: #fff !important; flex-shrink: 0 !important; }
.group-search-icon { position: absolute !important; left: 26px !important; top: 50% !important; transform: translateY(-50%) !important; color: #8a8f99 !important; pointer-events: none !important; z-index: 2 !important; }
.group-search input { width: 100% !important; padding: 11px 14px 11px 42px !important; border: 1px solid #e8eaed !important; border-radius: 24px !important; background: #f2f3f5 !important; font-size: 0.95rem !important; outline: none !important; box-sizing: border-box !important; }
.group-search input:focus { border-color: #25d366 !important; background: #fff !important; box-shadow: 0 0 0 3px rgba(37,211,102,0.12) !important; }
.group-contacts-list { flex: 1 1 auto !important; overflow-y: auto !important; padding: 4px 0 8px !important; min-height: 0 !important; }
.group-empty { padding: 40px 16px !important; text-align: center !important; color: #8a8f99 !important; font-size: 0.95rem !important; }
.group-contact-item { display: flex !important; align-items: center !important; gap: 12px !important; padding: 9px 14px !important; cursor: pointer !important; background: #fff !important; }
.group-contact-item:hover { background: #f5f5f5 !important; }
.group-contact-item.ticked { background: #eafaf1 !important; }
.group-contact-check { width: 26px !important; height: 26px !important; min-width: 26px !important; min-height: 26px !important; border-radius: 50% !important; border: 2px solid #cfd4da !important; display: flex !important; align-items: center !important; justify-content: center !important; color: transparent !important; flex-shrink: 0 !important; box-sizing: border-box !important; background: #fff !important; }
.group-contact-check svg { opacity: 0 !important; transform: scale(0) !important; display: block; }
.group-contact-item.ticked .group-contact-check { background: #25d366 !important; border-color: #25d366 !important; color: #fff !important; box-shadow: 0 0 0 3px rgba(37,211,102,0.18) !important; }
.group-contact-item.ticked .group-contact-check svg { opacity: 1 !important; transform: scale(1) !important; }
.group-contact-avatar { width: 46px !important; height: 46px !important; min-width: 46px !important; min-height: 46px !important; border-radius: 50% !important; overflow: hidden !important; background: #25d366 !important; color: #fff !important; display: flex !important; align-items: center !important; justify-content: center !important; font-size: 1.2rem !important; font-weight: 600 !important; flex-shrink: 0 !important; }
.group-contact-avatar img { width: 100% !important; height: 100% !important; object-fit: cover !important; }
.group-contact-name { font-size: 1rem !important; color: #1f2933 !important; font-weight: 500 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
.group-bottom-bar { display: flex !important; justify-content: flex-end !important; align-items: center !important; padding: 14px 18px !important; background: #fff !important; border-top: 1px solid #f0f1f3 !important; flex-shrink: 0 !important; }
.group-forward-btn, .group-create-btn { width: 58px !important; height: 58px !important; min-width: 58px !important; min-height: 58px !important; border-radius: 50% !important; border: none !important; background: #25d366 !important; color: #fff !important; cursor: pointer !important; display: flex !important; align-items: center !important; justify-content: center !important; box-shadow: 0 3px 10px rgba(37,211,102,0.35) !important; }
.group-forward-btn:hover:not(:disabled), .group-create-btn:hover:not(:disabled) { transform: translateY(-2px) !important; }
.group-forward-btn:disabled, .group-create-btn:disabled { background: #ccd0d6 !important; box-shadow: none !important; cursor: not-allowed !important; transform: none !important; }
.group-details { display: flex !important; flex-direction: column !important; align-items: center !important; gap: 20px !important; padding: 44px 24px !important; flex-shrink: 0 !important; }
.group-dp-picker { position: relative !important; cursor: pointer !important; border-radius: 50% !important; }
.group-dp-preview { width: 96px !important; height: 96px !important; max-width: 96px !important; max-height: 96px !important; border-radius: 50% !important; object-fit: cover !important; border: 3px solid #fff !important; box-shadow: 0 2px 12px rgba(0,0,0,0.18) !important; }
.group-dp-placeholder { width: 96px !important; height: 96px !important; max-width: 96px !important; max-height: 96px !important; border-radius: 50% !important; background: linear-gradient(135deg, #25d366, #128c7e) !important; color: #fff !important; font-size: 2.4rem !important; font-weight: 600 !important; display: flex !important; align-items: center !important; justify-content: center !important; box-shadow: 0 2px 12px rgba(0,0,0,0.18) !important; }
.group-dp-edit { position: absolute !important; bottom: 2px !important; right: 2px !important; width: 32px !important; height: 32px !important; min-width: 32px !important; min-height: 32px !important; border-radius: 50% !important; background: #fff !important; color: #075e54 !important; display: flex !important; align-items: center !important; justify-content: center !important; box-shadow: 0 2px 6px rgba(0,0,0,0.25) !important; border: 2px solid #eee !important; }
.group-name-wrap { position: relative !important; width: 100% !important; max-width: 320px !important; }
.group-name-icon { position: absolute !important; left: 14px !important; top: 50% !important; transform: translateY(-50%) !important; color: #8a8f99 !important; pointer-events: none !important; }
.group-name-input { width: 100% !important; padding: 13px 16px 13px 42px !important; border: 1px solid #e8eaed !important; border-radius: 12px !important; background: #f2f3f5 !important; font-size: 1rem !important; outline: none !important; box-sizing: border-box !important; }
.group-name-input:focus { border-color: #25d366 !important; background: #fff !important; box-shadow: 0 0 0 3px rgba(37,211,102,0.12) !important; }
.group-member-count { color: #8a8f99 !important; font-size: 0.9rem !important; margin-top: -8px !important; }
`
        }}
      />
      {/* Left Sidebar (10%) - Desktop Only */}
      <aside className={`sidebar ${isSidebarExpanded ? 'expanded' : ''}`}>
  {/* ☰ Menu Toggle */}
  <button
    className="menu-toggle"
    onClick={() => setIsSidebarExpanded(prev => !prev)}
    aria-label="Toggle sidebar"
  >
    <Menu size={22} strokeWidth={1.8} />
  </button>

  {/* Navigation Menu */}
  <nav className="nav-menu">
    {[
      { id: 'chats', label: 'Chats', icon: <MessageCircle size={22} strokeWidth={1.8} /> },
      { id: 'groups', label: 'Groups', icon: <Users size={22} strokeWidth={1.8} /> },
      { id: 'calls', label: 'Calls', icon: <Phone size={22} strokeWidth={1.8} /> },
      { id: 'statuses', label: 'Status', icon: <Camera size={22} strokeWidth={1.8} /> },
      { id: 'settings', label: 'Settings', icon: <Settings size={22} strokeWidth={1.8} /> },
      { id: 'profile', label: 'Profile', icon: <User size={22} strokeWidth={1.8} /> },
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
{!showGroupFlow && (
  <>
  <h2 className="panel-title">
    {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
  </h2>

  {/* New Chat Trigger */}
  <button
    className="new-chat-trigger"
    onClick={() => setShowNewChatDropdown(prev => !prev)}
  >
    <SquarePen size={20} strokeWidth={1.8} />
  </button>
  </>
)}

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
    onClick={() => {
      setShowNewChatDropdown(false);
      openGroupFlow();
    }}
  >
    <Users size={18} strokeWidth={1.8} style={{ marginRight: 8, verticalAlign: 'middle' }} /> New Group
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
    <Phone size={18} strokeWidth={1.8} style={{ marginRight: 8, verticalAlign: 'middle' }} /> New Contact
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
  // Persist to this user's server-side address book (per-account)
  fetch(`${API_URL}/api/contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`,
    },
    body: JSON.stringify({ userId: foundUser._id }),
  }).catch(err => console.error('Failed to save contact to server', err));
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
    activeTab === 'groups' ? (
      selectedGroup ? renderGroupChat() : (
        groupsList.length
          ? emptyState('Select a group', 'Choose a group from the list to start chatting.', groupEmptyIcon)
          : emptyState('No groups yet', 'Create a group from the 📝 menu to start chatting.', groupEmptyIcon)
      )
    ) : activeTab === 'statuses' ? (
      <div className="status-desktop-panel">
        <h2>Share statuses</h2>
      </div>
    ) : activeTab === 'calls' ? (
      <div className="calls-desktop-panel">
        <div className="calls-desktop-list">
          {calls.length === 0 ? (
            <p className="calls-desktop-empty">No calls yet</p>
          ) : (
            calls.map((call) => (
              <div key={call.id} className="calls-desktop-item" style={{ cursor: 'pointer' }}>
                <img src={call.groupId ? 'https://via.placeholder.com/50/4a00e0/fff?text=G' : (call.photo || 'https://via.placeholder.com/50')} alt={call.name} />
                <div className="calls-desktop-info">
                  <h4>{call.groupId ? (groupsList.find((g) => String(g.id) === String(call.groupId))?.name || 'Group call') : call.name}</h4>
                  <p>
                    <span className={`call-dir ${call.direction === 'missed' ? 'missed' : ''}`}>
                      {call.direction === 'outgoing' ? '↗' : call.direction === 'missed' ? '↘' : '↙'}
                    </span>{' '}
                    {call.direction === 'outgoing' ? 'Outgoing' : call.direction === 'missed' ? 'Missed' : 'Incoming'} {call.video ? 'video' : 'voice'} {call.groupId ? 'group ' : ''}call
                    {call.durationSec ? ` • ${fmtCallTime(call.durationSec)}` : ''}
                  </p>
                  <small>{call.time ? new Date(call.time).toLocaleString() : ''}</small>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    ) : (
      emptyState('Feature Coming Soon', `The ${activeTab} view is not available here.`, chatEmptyIcon)
    )
  )}
{newMsgCount > 0 && (selectedChat || selectedGroup) && !mediaViewer && !showContactInfo && !showGroupInfo && (
  <button type="button" className="new-msg-fab" onClick={jumpToLatest} aria-label="Scroll to latest messages">
    <ChevronDown size={16} strokeWidth={2.5} />
    {newMsgCount} new {newMsgCount === 1 ? 'message' : 'messages'}
  </button>
)}
</section>

     {/* Group Info Drawer (only when open) */}
{showGroupInfo && selectedGroup && (
  <>
    <div
      className="drawer-overlay"
      onClick={goBackPage}
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
        position: 'fixed',
        top: 0,
        right: 0,
        width: isMobile ? '100%' : '400px',
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
          onClick={goBackPage}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: '#000000ff',
            padding: '4px',
            marginRight: '20px',
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
          Group Info
        </div>
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
          src={selectedGroup.dp || 'https://via.placeholder.com/80?text=G'}
          alt="Group"
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
          style={{ fontSize: '18px', fontWeight: '500', color: '#111' }}
        >
          {selectedGroup.name}
        </div>
        <div
          className="email"
          style={{ fontSize: '14px', color: '#666' }}
        >
          {Array.isArray(selectedGroup.members) ? selectedGroup.members.length : selectedGroup.memberCount || 0} total members
        </div>
      </div>

      <div
        className="section"
        style={{ padding: '16px', borderTop: '1px solid #eee' }}
      >
        <div
          className="section-title"
          style={{ fontSize: '14px', color: '#333', marginBottom: '12px' }}
        >
          Media, Links and Docs
        </div>
        <div
          className="action-item"
          style={{ cursor: 'pointer' }}
          onClick={() => selectedGroup && setMediaViewer({ type: 'group', chatId: selectedGroup.id, chatName: selectedGroup.name, tab: 'media' })}
        >
          {summarizeChatMedia(groupMessages[selectedGroup?.id] || [])}
        </div>
      </div>

      <div
        className="section"
        style={{ padding: '16px', borderTop: '1px solid #eee' }}
      >
        <div
          className="section-title"
          style={{ fontSize: '14px', color: '#333', marginBottom: '12px' }}
        >
          Members
        </div>
        {(Array.isArray(selectedGroup.members) ? selectedGroup.members : []).map((m, idx) => {
          const memberId = String(m?._id || m?.id || m || '');
          const memberName =
            m?.name ||
            (contacts.find((c) => String(c.id) === memberId)?.name) ||
            'Member';
          const memberPhoto = m?.photo || 'https://via.placeholder.com/40';
          return (
            <div
              key={memberId || idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '8px 0',
              }}
            >
              <img
                src={memberPhoto}
                alt={memberName}
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '50%',
                  objectFit: 'cover',
                  border: '2px solid #ddd',
                }}
              />
              <div style={{ fontSize: '15px', color: '#111' }}>{memberName}</div>
            </div>
          );
        })}
      </div>

      <div className="section" style={{ padding: '16px', borderTop: '1px solid #eee' }}>
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
            if (selectedGroup) {
              const gid = String(selectedGroup.id || selectedGroup._id);
              setClearTarget({ chatType: 'group', chatId: gid, name: selectedGroup.name });
              setShowClearChatConfirm(true);
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M3 6H5.586L17.586 6M19 6V19C19 20.1046 18.1046 21 17 21H7C5.89543 21 5 20.1046 5 19V6M19 6H17.586L13.586 6M13.586 6L11.586 6M11.586 6L9.586 6M9.586 6L7.586 6" stroke="red" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Clear chat</span>
        </div>

        {/* Exit Group */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 0',
            fontSize: '16px',
            color: 'red',
            cursor: 'pointer',
            borderTop: '1px solid #eee',
          }}
          onClick={() => {
            if (selectedGroup && window.confirm('Exit this group?')) {
              const gid = String(selectedGroup.id || selectedGroup._id);
              setGroupsList((prev) => prev.filter((g) => String(g.id) !== gid));
              setGroupMessages((prev) => {
                const next = { ...prev };
                delete next[gid];
                return next;
              });
              setShowGroupInfo(false);
              setSelectedGroup(null);
              selectedGroupRef.current = null;
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H9M16 17L21 12L16 7M21 12H9" stroke="red" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Exit group</span>
        </div>
      </div>
    </div>
  </>
)}

     {/* ===== Delete message (Options + Confirm) & Clear chat modals ===== */}
{deleteCmd && deletePhase === 'options' && (
  <div
    style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 20000,
    }}
    onClick={() => { setDeletePhase(''); setDeleteCmd(null); setDeleteFromSelection(false); }}
  >
    <div
      style={{ background: 'white', padding: '20px', borderRadius: '12px', width: '90%', maxWidth: '400px' }}
      onClick={(e) => e.stopPropagation()}
    >
      <h4 style={{ color: '#333', marginBottom: '8px' }}>Delete message?</h4>
      <p style={{ color: '#555', marginBottom: '16px' }}>{deleteFromSelection ? 'Would you like to delete the selected messages for everyone or just for you?' : 'Would you like to delete this message for everyone or just for you?'}</p>
      <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
        <button
          onClick={() => { setDeleteForEveryone(true); setDeletePhase('confirm'); }}
          style={{ flex: 1, padding: '10px', background: '#075e54', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
        >
          Delete for everyone
        </button>
        <button
          onClick={() => { setDeleteForEveryone(false); setDeletePhase('confirm'); }}
          style={{ flex: 1, padding: '10px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer' }}
        >
          Delete for me
        </button>
      </div>
    </div>
  </div>
)}

{/* Delete Confirmation Modal (step 2) */}
{deleteCmd && deletePhase === 'confirm' && (
  <div
    style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0,0,0,0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 20001,
    }}
    onClick={() => { setDeletePhase(''); setDeleteCmd(null); setDeleteFromSelection(false); }}
  >
    <div
      style={{ background: 'white', padding: '20px', borderRadius: '12px', width: '90%', maxWidth: '400px' }}
      onClick={(e) => e.stopPropagation()}
    >
      <h4 style={{ color: '#333', marginBottom: '8px' }}>
        {deleteFromSelection ? 'Delete selected messages' : (deleteForEveryone ? 'Delete message for everyone?' : 'Delete message?')}
      </h4>
      <p style={{ color: '#555', marginBottom: '16px', lineHeight: '1.5' }}>
        {deleteFromSelection
          ? 'Are you sure you want to delete the selected messages? This will remove them from your device.'
          : deleteForEveryone
            ? 'This message will be deleted for everyone in this chat on all devices. This action cannot be undone.'
            : 'This message will be deleted only for you. This action cannot be undone.'}
      </p>
      <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
        <button
          onClick={() => { setDeletePhase(''); setDeleteCmd(null); setDeleteFromSelection(false); }}
          style={{ padding: '10px 16px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px', cursor: 'pointer', color: '#333' }}
        >
          Cancel
        </button>
        <button
          onClick={confirmDelete}
          style={{ padding: '10px 16px', background: '#e02f5b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
        >
          Delete
        </button>
      </div>
    </div>
  </div>
)}

{/* Clear Chat Confirmation Modal */}
{showClearChatConfirm && (
  <div
    style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 20000,
    }}
    onClick={() => setShowClearChatConfirm(false)}
  >
    <div
      style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 style={{ marginBottom: '12px', color: '#333' }}>Clear Chat</h3>
      <p style={{ color: '#555', lineHeight: '1.5' }}>
        Are you sure you want to clear all messages with <strong>{clearTarget?.name}</strong>? This action cannot be undone.
      </p>
      <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setShowClearChatConfirm(false)}
          style={{ padding: '10px 16px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px', color: '#333', cursor: 'pointer', fontWeight: 500 }}
        >
          Cancel
        </button>
        <button
          onClick={confirmClearChat}
          style={{ padding: '10px 16px', background: '#075e54', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
        >
          Clear
        </button>
      </div>
    </div>
  </div>
)}

{/* Camera Capture Modal */}
{showCameraModal && (
  <div className="camera-modal-overlay">
    <div className="camera-modal">
      {!capturedPhoto ? (
        <>
          <div className="camera-header">
            <button
              onClick={handleCloseCamera}
              aria-label="Close camera"
              className="camera-header-x"
            >
              ✕
            </button>
            <h3 style={{ fontSize: '18px', color: '#075e54' }}>Take a Photo</h3>
            <div style={{ width: 24 }} />
          </div>
          <div className="camera-container">
            <video ref={videoRef} autoPlay playsInline />
          </div>
          <div className="camera-footer">
            <button onClick={handleCapturePhoto} className="capture-btn" aria-label="Capture photo">Capture</button>
          </div>
        </>
      ) : (
        <div className="camera-preview-container">
          <img src={capturedPhoto} alt="Captured photo" />
          <div className="camera-preview-footer">
            <button onClick={handleOpenCamera} className="camera-back-btn" aria-label="Retake photo">Back</button>
            <input
              type="text"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Add a caption..."
              className="camera-caption-input"
            />
            <button onClick={handleSendPhoto} className="camera-send-btn" aria-label="Send photo">➤</button>
          </div>
        </div>
      )}
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
            <div className="menu-container">
              <button
                className="menu-btn"
                onClick={() => setShowMobileMenu(prev => !prev)}
              >
                ⋮
              </button>
              {/* Same dropdown options as the Chats menu */}
              {showMobileMenu && (
                <div className="dropdown-menu">
                  <button onClick={() => { setShowAddContact(true); setShowMobileMenu(false); }}>Add new contact</button>
                  <button onClick={() => { setShowMobileMenu(false); openGroupFlow(); }}>New Group</button>
                  <button onClick={() => setActiveTab('profile')}>Profile</button>
                  <button onClick={() => alert('Settings')}>Settings</button>
                  <button onClick={() => { setShowMobileMenu(false); handleLogout(); }}>Logout</button>
                </div>
              )}
            </div>
          </div>
          {/* My Status */}
          <div className="status-section">
            <h2 className="section-title">My Status</h2>
            <div
              className="status-item my-status"
              onClick={() => {
                if (myStatuses.length) setStatusViewer({ userId: user.id, index: 0 });
                else setStatusAddSheet(true);
              }}
            >
              <div className="my-status-avatar">
                <StatusAvatar
                  src={myStatusPhoto}
                  count={myStatuses.length}
                  seen={false}
                />
                <button
                  className="my-status-add"
                  onClick={(e) => { e.stopPropagation(); setStatusAddSheet(true); }}
                  aria-label="Add status"
                >
                  +
                </button>
              </div>
              <div className="status-info">
                <h4>{myStatuses.length ? 'My Status' : 'Tap to add status'}</h4>
                <p>{myStatuses.length ? `Updated ${timeAgo(myStatuses[0].createdAt)}` : 'Visible to everyone'}</p>
              </div>
            </div>
          </div>
          {/* Recent Updates */}
          <div className="status-section">
            <h2 className="section-title">Recent updates</h2>
            {feedGroups.map(g => {
              const first = g.statuses[0];
              const hasUnseen = g.statuses.some(s => !s.viewed);
              return (
                <div
                  key={String(g.user.id)}
                  className={`status-item ${hasUnseen ? 'unseen' : 'seen'}`}
                  onClick={() => setStatusViewer({ userId: String(g.user.id), index: 0 })}
                >
                  <StatusAvatar
                    src={first.file || g.user.photo || 'https://via.placeholder.com/50'}
                    count={g.statuses.length}
                    seen={!hasUnseen}
                  />
                  <div className="status-info">
                    <h4>{g.user.name}</h4>
                    <p>
                      {g.statuses.length > 1 ? `${g.statuses.length} updates • ` : ''}
                      {timeAgo(first.createdAt)}
                    </p>
                  </div>
                  {hasUnseen && <span className="status-dot" />}
                </div>
              );
            })}
            {feedGroups.length === 0 && <p className="status-empty">No recent updates</p>}
          </div>
        </>
      
) : view === 'calls' ? (
  <>
    {/* Calls Header */}
    <div className="mobile-header">
      <h1>Calls</h1>
      <div className="menu-container">
        <button className="menu-btn" onClick={() => setShowCallsMenu(prev => !prev)}>⋮</button>
        {showCallsMenu && (
          <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { setCalls([]); setShowCallsMenu(false); }}>Clear call log</button>
            <button onClick={() => { loadCalls(); setShowCallsMenu(false); }}>Refresh</button>
            <button onClick={() => { setShowCallsMenu(false); alert('Settings'); }}>Settings</button>
          </div>
        )}
      </div>
    </div>

    {/* Search Bar */}
    <div className="mobile-search">
      <input type="text" placeholder="Search" />
    </div>

   {/* Recent Calls Section */}
<div className="calls-section">
  <h2 className="section-title">Recent</h2>
  <div className="calls-list">
    {calls.length === 0 && <p style={{ padding: '12px 16px', color: '#8a8f99', fontSize: '0.9rem' }}>No calls yet</p>}
    {calls.map(call => (
      <div key={call.id} className="call-item" style={{ cursor: 'pointer' }}>
        <img src={call.groupId ? 'https://via.placeholder.com/50/4a00e0/fff?text=G' : (call.photo || 'https://via.placeholder.com/50')} alt={call.name} />
       <div className="call-info">
  <h4>{call.groupId ? (groupsList.find(g => String(g.id) === String(call.groupId))?.name || 'Group call') : call.name}</h4>
  <p>
    {call.direction === 'incoming' && 'Incoming'}
    {call.direction === 'outgoing' && 'Outgoing'}
    {call.direction === 'missed' && 'Missed'}
    {call.groupId ? ' group' : ''}
    {call.video && ' Video'}
  </p>
  <small style={{ color: '#888', fontSize: '0.9rem' }}>{call.time ? new Date(call.time).toLocaleString() : ''}{call.durationSec ? ` • ${fmtCallTime(call.durationSec)}` : ''}</small>
</div>
<div className="call-icon">
  <span className={call.direction === 'missed' ? 'missed' : ''} style={{ transform: call.direction !== 'missed' ? 'scaleX(-1)' : 'none' }}>
    <Phone size={20} strokeWidth={1.8} />
  </span>
</div>
      </div>
    ))}
  </div>
</div>
  </>
) : (
  
  <>
      {!showGroupFlow && (
        <>
          {/* Chats Header */}
          <div className="mobile-header">
            <h1>NexChat</h1>
            <div className="menu-container">
  <button
    className="menu-btn"
    onClick={() => setShowMobileMenu(prev => !prev)}
  >
    ⋮
  </button>

  

  {/* Dropdown Popup */}
  {showMobileMenu && (
    <div className="dropdown-menu">
      <button
  onClick={() => {
    setShowAddContact(true);
    setShowMobileMenu(false);
  }}
>
  Add new contact
</button>
      <button
  onClick={() => {
    setShowMobileMenu(false);
    openGroupFlow();
  }}
>
  New Group
</button>
      <button onClick={() => setActiveTab('profile')}>
        Profile
      </button>
      <button onClick={() => alert('Settings')}>
        Settings
      </button>
      <button
  onClick={() => {
    setShowMobileMenu(false);
    handleLogout();
  }}
>
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
        </>
      )}
          {/* Chat List */}
          {renderCenterContent()}
  </>
      )
    }
    </main>

    {/* Bottom Nav */}
    {!showGroupFlow && (
    <nav className="mobile-nav">
      <button onClick={() => {
  setView('chats');
  setActiveTab('chats'); // ✅ Ensure Chats is selected
}}>
  <MessageCircle size={24} strokeWidth={1.8} />
  <small>Chats</small>
</button>
      <button onClick={() => setView('status')}>
        <Camera size={24} strokeWidth={1.8} />
        <small>Status</small>
      </button>
      <button onClick={() => {
  setView('calls');
  setActiveTab('calls');
}}>
  <Phone size={24} strokeWidth={1.8} />
  <small>Calls</small>
</button>
      <button onClick={handleOpenCamera}>
        <Video size={24} strokeWidth={1.8} />
        <small>Camera</small>
      </button>
    </nav>
    )}
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
          onClick={async () => {
            if (!email.trim()) {
              alert('Please enter an email address.');
              return;
            }
            const foundUser = await findUserByEmail(email);
            if (!foundUser) {
              alert('User not found. Please enter a valid email.');
              return;
            }

            const newContact = {
              id: foundUser._id,
              name: `${firstName} ${lastName}`.trim() || foundUser.name,
              firstName: firstName.trim(),
              lastName: lastName.trim(),
              email: foundUser.email,
              photo: foundUser.photo || 'https://via.placeholder.com/50',
              lastMsg: '',
              time: '',
              online: false,
            };

            setContacts(prev => {
              const exists = prev.some(c => String(c.id) === String(newContact.id));
              if (exists) return prev;
              setMessages(prevMsgs => ({
                ...prevMsgs,
                [newContact.id]: [],
              }));
              // Persist to this user's server-side address book (per-account)
              fetch(`${API_URL}/api/contacts`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${localStorage.getItem('token')}`,
                },
                body: JSON.stringify({ userId: foundUser._id }),
              }).catch(err => console.error('Failed to save contact to server', err));
              return [newContact, ...prev];
            });

            alert('Contact saved!');
            setShowAddContact(false);
            setEmail('');
            setFirstName('');
            setLastName('');
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
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
        />
        <input
          type="text"
          placeholder="Last name"
          className="drawer-input"
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
        />
        <input
          type="email"
          placeholder="Email (Gmail)"
          className="drawer-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
    </div>
  </div>
)}
{/* ✅ Add this line here */}
<canvas ref={canvasRef} style={{ display: 'none' }} />

{/* Forward Modal */}
{showForwardModal && (
  <div
    className="new-contact-modal-overlay"
    style={{ zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={() => setShowForwardModal(false)}
  >
    <div
      className="new-contact-modal"
      style={{ maxWidth: '420px', width: '90%' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <h3>Forward {selectedMessages.size} message{selectedMessages.size > 1 ? 's' : ''}</h3>
        <button
          onClick={() => setShowForwardModal(false)}
          style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }}
          aria-label="Close forward"
        >
          ✕
        </button>
      </div>

      <div className="modal-body">
        <input
          type="text"
          placeholder="Search name"
          value={forwardSearchQuery}
          onChange={(e) => setForwardSearchQuery(e.target.value)}
          className="modal-input"
          style={{ marginBottom: '12px' }}
          autoFocus
        />

        <div style={{ fontSize: '0.85rem', color: '#999', marginBottom: '6px' }}>
          Recent chats — tap to select
        </div>

        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {contacts
            .filter((c) => String(c.id) !== String(selectedChat?.id))
            .filter((c) =>
              c.name?.toLowerCase().includes(forwardSearchQuery.toLowerCase())
            )
            .map((contact) => {
              const isChecked = selectedForwardChats.has(String(contact.id));
              return (
                <div
                  key={contact.id}
                  onClick={() =>
                    setSelectedForwardChats((prev) => {
                      const next = new Set(prev);
                      const key = String(contact.id);
                      if (next.has(key)) next.delete(key);
                      else next.add(key);
                      return next;
                    })
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '10px 8px',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    background: isChecked ? '#e8f5f0' : 'transparent',
                  }}
                  onMouseEnter={(e) => {
                    if (!isChecked) e.currentTarget.style.background = '#f0f2f5';
                  }}
                  onMouseLeave={(e) => {
                    if (!isChecked) e.currentTarget.style.background = 'transparent';
                  }}
                >
                  <span
                    style={{
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      border: `2px solid ${isChecked ? '#075e54' : '#ccc'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: isChecked ? '#075e54' : 'white',
                      flexShrink: 0,
                    }}
                  >
                    {isChecked && <span style={{ color: 'white', fontSize: '13px' }}>✓</span>}
                  </span>
                  <img
                    src={contact.photo || 'https://via.placeholder.com/50'}
                    alt={contact.name}
                    style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                  <div>
                    <div style={{ fontWeight: '600' }}>{contact.name}</div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>{contact.email}</div>
                  </div>
                </div>
              );
            })}
          {contacts.filter(
            (c) =>
              String(c.id) !== String(selectedChat?.id) &&
              c.name?.toLowerCase().includes(forwardSearchQuery.toLowerCase())
          ).length === 0 && (
            <div style={{ color: '#999', textAlign: 'center', padding: '16px' }}>
              No chats found
            </div>
          )}
        </div>
      </div>

      <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '14px 16px',
            borderTop: '1px solid #eee',
          }}
        >
          <span style={{ fontSize: '0.9rem', color: '#555' }}>
            {selectedForwardChats.size > 0
              ? `${selectedForwardChats.size} chat${selectedForwardChats.size > 1 ? 's' : ''} selected`
              : 'No chat selected'}
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setShowForwardModal(false)}
              style={{
                padding: '8px 18px',
                background: 'white',
                color: '#075e54',
                border: '1px solid #075e54',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              disabled={selectedForwardChats.size === 0}
              onClick={() => {
                const targets = contacts.filter((c) =>
                  selectedForwardChats.has(String(c.id))
                );
                targets.forEach((t) => forwardSelectedMessages(t));
                setSelectedForwardChats(new Set());
                setForwardSearchQuery('');
              }}
              style={{
                padding: '8px 18px',
                background: '#075e54',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: selectedForwardChats.size === 0 ? 'not-allowed' : 'pointer',
                opacity: selectedForwardChats.size === 0 ? 0.5 : 1,
              }}
            >
              Forward
            </button>
          </div>
        </div>
    </div>
  </div>
)}

{/* ===== STATUS ADD SHEET (Camera / Gallery / Text) ===== */}
{statusAddSheet && (
  <div className="status-action-overlay" onClick={() => setStatusAddSheet(false)}>
    <div className="status-action-sheet" onClick={(e) => e.stopPropagation()}>
      <div className="status-action-title">Add status</div>
      <button
        className="status-action-item"
        onClick={() => { setStatusAddSheet(false); openStatusCamera(); }}
      >
        <Camera size={22} strokeWidth={1.8} /> Camera
      </button>
      <button
        className="status-action-item"
        onClick={() => { setStatusAddSheet(false); statusFileInputRef.current?.click(); }}
      >
        <Image size={22} strokeWidth={1.8} /> Gallery
      </button>
      <button
        className="status-action-item"
        onClick={() => { setStatusAddSheet(false); setStatusText(''); setStatusComposerOpen(true); }}
      >
        <PencilLine size={22} strokeWidth={1.8} /> Text
      </button>
      <button className="status-action-cancel" onClick={() => setStatusAddSheet(false)}>Cancel</button>
    </div>
  </div>
)}
<input
  ref={statusFileInputRef}
  type="file"
  accept="image/*"
  style={{ display: 'none' }}
  onChange={onStatusFileChange}
/>

{/* ===== FULL-SCREEN STATUS CAMERA (covers everything) ===== */}
{statusCameraOpen && (
  <div className="status-camera-overlay">
    <div className="status-camera-top">
      <button className="status-camera-close" onClick={closeStatusCamera} aria-label="Close camera">✕</button>
    </div>
    <video ref={statusVideoRef} autoPlay playsInline className="status-camera-video" />
    <div className="status-camera-bottom">
      <div className={`status-capture-btn ${statusRecording ? 'recording' : ''}`} onPointerDown={statusCapturePointerDown} onPointerUp={statusCapturePointerUp} onPointerLeave={statusCapturePointerUp} aria-label="Tap photo, hold to record video" />
      <div className="status-camera-hint">
        {statusRecording ? (
          <span className="status-rec-live"><span className="status-rec-dot" /> Recording {statusRecordSec}s</span>
        ) : (
          'Tap for photo · hold for video'
        )}
      </div>
    </div>
  </div>
)}

{/* ===== STATUS TEXT COMPOSER (colored background) ===== */}
{statusComposerOpen && (
  <div className="status-composer">
    <div className="status-composer-header">
      <button onClick={() => setStatusComposerOpen(false)}>Cancel</button>
      <button className="status-composer-send" onClick={sendStatusText} disabled={!statusText.trim()}>Send</button>
    </div>
    <textarea
      className="status-text-input"
      value={statusText}
      onChange={(e) => setStatusText(e.target.value)}
      placeholder="Type a status"
      maxLength={120}
      autoFocus
    />
    <p className="status-composer-hint">{statusText.length}/120</p>
  </div>
)}

{/* ===== STATUS PHOTO PREVIEW + CAPTION ===== */}
{statusCapture && statusCapture.dataUrl && (
  <div className="status-capture-preview">
    <div className="status-composer-header">
      <button onClick={() => setStatusCapture(null)}>Cancel</button>
      <button className="status-composer-send" onClick={sendStatusImage}>Send</button>
    </div>
    {statusCapture.type === 'video' ? (
      <video src={statusCapture.dataUrl} className="status-capture-video" controls />
    ) : (
      <img src={statusCapture.dataUrl} alt="status" />
    )}
    <input
      className="status-caption-input"
      value={statusCaptureCaption}
      onChange={(e) => setStatusCaptureCaption(e.target.value)}
      placeholder="Add a caption"
      maxLength={120}
    />
  </div>
)}

{/* ===== FULL-SCREEN STATUS VIEWER ===== */}
{statusViewer && viewerUser && viewerUser.statuses.length > 0 && currentStatusForViewer && (
  <div className="status-viewer-overlay">
    <div className="status-viewer-head">
      <button className="status-viewer-close" onClick={() => setStatusViewer(null)} aria-label="Close">✕</button>
      {String(viewerUser.user.id) === String(user.id) && (
        <button className="status-viewer-delete" onClick={deleteCurrentStatus} aria-label="Delete status">🗑</button>
      )}
    </div>
    <div className="status-progress">
      {viewerUser.statuses.map((s, i) => (
        <div
          key={String(s._id)}
          className={`status-progress-seg ${i < statusViewer.index ? 'done' : i === statusViewer.index ? 'active' : ''}`}
        />
      ))}
    </div>
    <div className="status-viewer-content" onClick={handleViewerTap}>
      {currentStatusForViewer.type === 'video' ? (
        <StatusVideoView src={currentStatusForViewer.file} onEnded={() => setVideoStatusEnded(true)} />
      ) : currentStatusForViewer.type === 'image' ? (
        <img src={currentStatusForViewer.file} alt="status" className="status-viewer-image" />
      ) : (
        <div className="status-text-view">
          {currentStatusForViewer.text}
        </div>
      )}
    </div>
    <div className="status-viewer-info">
      <img
        src={
          viewerUser.user.photo ||
          `https://via.placeholder.com/40/25D366/fff?text=${encodeURIComponent((viewerUser.user.name || '?')[0])}`
        }
        alt={viewerUser.user.name}
      />
      <div className="status-viewer-meta">
        <strong>{viewerUser.user.name}</strong>
        <span>{timeAgo(currentStatusForViewer.createdAt)}</span>
      </div>
    </div>
    {(currentStatusForViewer.type === 'image' || currentStatusForViewer.type === 'video') && currentStatusForViewer.text && (
      <p className="status-viewer-caption">{currentStatusForViewer.text}</p>
    )}
    {String(viewerUser.user.id) !== String(user.id) && (
      <div className="status-viewer-reply" onClick={(e) => e.stopPropagation()}>
        <input
          value={statusReplyText}
          onChange={(e) => setStatusReplyText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && statusReplyText.trim()) sendStatusReply(); }}
          placeholder={`Reply to ${viewerUser.user.name}`}
          aria-label="Reply to status"
        />
        <button
          className="status-reply-send"
          onClick={() => sendStatusReply()}
          disabled={!statusReplyText.trim()}
          aria-label="Send reply"
        >
          ➤
        </button>
      </div>
    )}
  </div>
)}

{/* ===== FULL-SCREEN CALL OVERLAY (voice + video) ===== */}
{activeCall && callMinimized && (
  <div className="call-minimized-bar" onClick={() => setCallMinimized(false)}>
    <div className="call-min-info">
      <span className="call-min-name">{activeCall.peerName}</span>
      <span className="call-min-status">
        {activeCall.mode === 'incoming'
          ? 'Incoming call…'
          : activeCall.mode === 'outgoing'
            ? 'Ringing…'
            : <span className="call-elapsed">{fmtCallTime(activeCall.elapsed)}</span>}
      </span>
    </div>
    <div className="call-min-actions" onClick={(e) => e.stopPropagation()}>
      {activeCall.mode === 'incoming' && (
        <button className="call-min-accept" onClick={acceptCall} aria-label="Answer"><Phone size={18} strokeWidth={2.2} /></button>
      )}
      <button
        className="call-min-decline"
        onClick={() => { if (activeCall.mode === 'incoming') rejectCall(); else hangupCall(); }}
        aria-label="End call"
      >
        <Phone size={18} strokeWidth={2.2} style={{ transform: 'rotate(135deg)' }} />
      </button>
    </div>
  </div>
)}

{activeCall && !callMinimized && (
  <div className={`call-overlay ${activeCall.type === 'video' ? 'video-call' : 'voice-call'}`}>
    <button className="call-back-btn" onClick={() => setCallMinimized(true)} aria-label="Back to app">‹</button>
    {/* Peer video (fullscreen once connected) / group mesh grid */}
    {activeCall.group ? (
      activeCall.mode === 'active' && activeCall.type === 'video' && (() => {
        const entries = Object.keys(groupTiles);
        const perPage = 4;
        const pages = Math.max(1, Math.ceil(entries.length / perPage));
        const page = Math.min(groupCallPage, pages - 1);
        const pageTiles = entries.slice(page * perPage, page * perPage + perPage);
        const gridClass = pageTiles.length <= 1 ? 'gcall-1' : pageTiles.length === 2 ? 'gcall-2' : 'gcall-4';
        return (
          <div className={`gcall-grid ${gridClass}`}>
            {pageTiles.length > 0 && pageTiles.map((pid) => {
              const peerName = contacts.find((c) => String(c.id) === String(pid))?.name || 'Member';
              return (
                <div key={pid} className="gcall-tile">
                  <video
                    key={pid}
                    ref={(el) => { if (el && el.srcObject !== groupTiles[pid]) el.srcObject = groupTiles[pid]; }}
                    className="gcall-tile-video"
                    autoPlay
                    playsInline
                    style={{ objectFit: 'cover', width: '100%', height: '100%' }}
                  />
                  <span className="gcall-tile-name">{peerName}</span>
                </div>
              );
            })}
            {pageTiles.length === 0 && (
              <div className="call-peer-fallback">
                <img src={activeCall.peerPhoto} alt={activeCall.peerName} />
              </div>
            )}
            {pages > 1 && (
              <div className="gcall-pager" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => setGroupCallPage((p) => Math.max(0, p - 1))} disabled={page === 0} aria-label="Previous page">‹</button>
                <span>{page + 1} / {pages}</span>
                <button onClick={() => setGroupCallPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1} aria-label="Next page">›</button>
              </div>
            )}
          </div>
        );
      })()
    ) : (
      activeCall.mode === 'active' && activeCall.type === 'video' && (
        <>
          <video
            ref={peerVideoRef}
            className="call-peer-video"
            autoPlay
            playsInline
            style={{ objectFit: 'cover', width: '100%', height: '100%' }}
          />
          {(!remoteStreamRef.current || activeCall.peerCameraOn === false) && (
            <div className="call-peer-fallback">
              {activeCall.peerCameraOn === false ? (
                <div className="call-cam-off">Video is off</div>
              ) : (
                <img src={activeCall.peerPhoto} alt={activeCall.peerName} />
              )}
            </div>
          )}
        </>
      )
    )}

    {/* Own camera preview / PiP */}
    {activeCall.type === 'video' && (
      <video
        ref={ownVideoRef}
        className={`call-own-video ${activeCall.mode === 'active' ? 'pip' : 'preview'}`}
        autoPlay
        playsInline
        muted
      />
    )}

    {/* Voice / pre-connect avatar */}
    {(activeCall.type === 'voice' || activeCall.mode !== 'active') && (
      <div className={`call-avatar-zone ${activeCall.mode !== 'active' && activeCall.type === 'video' && localStreamRef.current ? 'with-preview' : ''}`}>
        <div className="call-avatar-ring">
          <img src={activeCall.peerPhoto} alt={activeCall.peerName} />
        </div>
        <h2>{activeCall.peerName}</h2>
        <p>
          {activeCall.mode === 'outgoing' && 'Ringing…'}
          {activeCall.mode === 'incoming' && 'Incoming video call…'}
          {activeCall.mode !== 'active' && (activeCall.peerName || '') }
          {activeCall.mode === 'active' && activeCall.type === 'voice' && (
            <>
              <span className="call-elapsed">{fmtCallTime(activeCall.elapsed)}</span>
              {activeCall.group && (
                <span className="call-group-joined">
                  · {Math.max(1, 1 + Object.keys(groupTiles).length)} {Object.keys(groupTiles).length === 0 ? 'person' : 'people'}
                </span>
              )}
            </>
          )}
        </p>
      </div>
    )}

    {/* Top-center name for video + elapsed */}
    {activeCall.mode === 'active' && activeCall.type === 'video' && (
      <div className="call-top-center">
        <h2>{activeCall.peerName}</h2>
        <span className="call-elapsed">{fmtCallTime(activeCall.elapsed)}</span>
      </div>
    )}

    {/* Speaker/Handset chooser */}
    {callSpeakerMenuOpen && (
      <>
        <div className="call-speaker-backdrop" onClick={() => setCallSpeakerMenuOpen(false)} />
        <div className="call-speaker-menu">
          <button onClick={() => { setCallSpeakerOutput('speaker'); setCallSpeakerMenuOpen(false); }}>
            <span className="cs-icon">🔊</span> Speaker
          </button>
          <button onClick={() => { setCallSpeakerOutput('handset'); setCallSpeakerMenuOpen(false); }}>
            <span className="cs-icon">📱</span> Handset
          </button>
        </div>
      </>
    )}

    {/* Bottom controls */}
    <div className="call-controls">
      {activeCall.mode === 'incoming' ? (
        <>
          <button className="call-ctrl accept" onClick={acceptCall} aria-label="Answer"><Phone size={26} strokeWidth={2} /></button>
          <button className="call-ctrl decline" onClick={rejectCall} aria-label="Decline"><Phone size={26} strokeWidth={2} style={{ transform: 'rotate(135deg)' }} /></button>
        </>
      ) : activeCall.mode === 'outgoing' ? (
        <button className="call-ctrl decline big" onClick={() => { if (activeCall.group) { socket.emit('call:groupTimeout', { groupId: activeCall.groupId, callId: activeCall.callId, type: activeCall.type, callerName: user.name }); } else { socket.emit('call:timeout', { to: callPeerIdRef.current, callId: activeCall.callId, type: activeCall.type }); } setActiveCall(null); }} aria-label="Cancel call">
          <Phone size={26} strokeWidth={2} style={{ transform: 'rotate(135deg)' }} />
        </button>
      ) : (
        <>
          {activeCall.type === 'video' && (
            <>
              <button className="call-ctrl" onClick={switchCameraCall} aria-label="Switch camera"><Camera size={24} strokeWidth={2} /></button>
              <button className="call-ctrl" onClick={() => { const on = toggleCameraCall(); setCallCamOn(on); }} aria-label="Turn camera off" style={{ background: !callCamOn ? '#e02f5b' : undefined }}>
                <VideoOff size={24} strokeWidth={2} />
              </button>
            </>
          )}
          <button className="call-ctrl" onClick={() => { const on = toggleMuteCall(); setCallMicOn(on); }} aria-label="Mute" style={{ background: !callMicOn ? '#e02f5b' : undefined }}>
            <MicOff size={24} strokeWidth={2} />
          </button>
          <button className="call-ctrl" onClick={() => setCallSpeakerMenuOpen(true)} aria-label="Speaker or handset"><Volume2 size={24} strokeWidth={2} /></button>
          {activeCall.type === 'voice' && (
            <button className="call-ctrl" onClick={upgradeToVideo} aria-label="Switch to video call"><Video size={24} strokeWidth={2} /></button>
          )}
          <button className="call-ctrl decline" onClick={hangupCall} aria-label="End call"><Phone size={26} strokeWidth={2} style={{ transform: 'rotate(135deg)' }} /></button>
        </>
      )}
    </div>
  </div>
)}

{/* ===== FULL-SCREEN MEDIA / LINKS / DOCS ===== */}
{mediaViewer && (() => {
  const src = mediaViewer.type === 'dm'
    ? (messages[mediaViewer.chatId] || [])
    : (groupMessages[mediaViewer.chatId] || []);
  const { media: mediaList, links: linksList, docs: docsList } = classifyChatMessages(src);
  const tabs = [
    { key: 'media', label: 'Media' },
    { key: 'links', label: 'Links' },
    { key: 'docs', label: 'Docs' },
  ];
  return (
    <div className="media-viewer-overlay">
      <div className="media-viewer-head">
        <button className="media-viewer-back" onClick={() => setMediaViewer(null)} aria-label="Back">‹</button>
        <div className="media-viewer-title">
          <strong>{mediaViewer.chatName}</strong>
          <span>Media, links and docs</span>
        </div>
        <div className="media-viewer-tabs">
          {tabs.map((t) => (
            <button
              key={t.key}
              className={`media-viewer-tab ${mediaViewer.tab === t.key ? 'active' : ''}`}
              onClick={() => setMediaViewer({ ...mediaViewer, tab: t.key })}
            >
              {t.label} ({t.key === 'media' ? mediaList.length : t.key === 'links' ? linksList.length : docsList.length})
            </button>
          ))}
        </div>
      </div>
      <div className="media-viewer-body">
        {mediaViewer.tab === 'media' && (
          mediaList.length ? (
            <div className="media-grid">
              {mediaList.map((m, i) => {
                const src = m.file || m.dataUrl;
                const isVideo = (m.fileType || '').startsWith('video/');
                return isVideo
                  ? (
                    <video
                      key={String(m._id || i)}
                      src={src}
                      className="media-grid-item"
                      onClick={() => setPreviewImage({ src, caption: m.text, fileName: m.fileName, fileType: m.fileType })}
                    />
                  )
                  : (
                    <img
                      key={String(m._id || i)}
                      src={src}
                      className="media-grid-item"
                      alt="media"
                      onClick={() => setPreviewImage({ src, caption: m.text, fileName: m.fileName, fileType: m.fileType })}
                    />
                  );
              })}
            </div>
          ) : <div className="media-viewer-empty">No media available</div>
        )}
        {mediaViewer.tab === 'links' && (
          linksList.length ? (
            <div className="links-list">
              {linksList.map((m, i) => {
                const match = (m.text || '').match(/https?:\/\/[^\s]+/);
                return (
                  <a key={String(m._id || i)} className="link-item" href={match ? match[0] : '#'} target="_blank" rel="noreferrer">
                    <span className="link-ico">🔗</span>
                    <span className="link-text">{m.text}</span>
                  </a>
                );
              })}
            </div>
          ) : <div className="media-viewer-empty">No links available</div>
        )}
        {mediaViewer.tab === 'docs' && (
          docsList.length ? (
            <div className="docs-list">
              {docsList.map((m, i) => (
                <a key={String(m._id || i)} className="doc-item" href={m.file} target="_blank" rel="noreferrer" download>
                  <span className="doc-ico">📄</span>
                  <div>
                    <strong>{m.fileName || 'Document'}</strong>
                    <small>{m.fileSize ? `${Math.round(m.fileSize / 1024)} KB` : ''}</small>
                  </div>
                </a>
              ))}
            </div>
          ) : <div className="media-viewer-empty">No documents available</div>
        )}
      </div>
    </div>
  );
})()}

  {/* Full-screen image/video preview overlay (from chat photo click or media viewer) */}
  {(() => {
    if (!previewImage) return null;
    const src = previewImage.src || previewImage.dataUrl;
    const isVideo = (previewImage.fileType || '').startsWith('video/');
    return (
      <div className="photo-preview-overlay" onClick={() => setPreviewImage(null)}>
        <button className="preview-close" onClick={() => setPreviewImage(null)} aria-label="Close">✕</button>
        {isVideo ? (
          <video
            className="photo-preview-media"
            src={src}
            controls
            autoPlay
            playsInline
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <img
            className="photo-preview-media"
            src={src}
            alt={previewImage.caption || 'Preview'}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {previewImage.caption && (
          <div className="preview-caption" onClick={(e) => e.stopPropagation()}>{previewImage.caption}</div>
        )}
      </div>
    );
  })()}

</div>
  );
}//MARKER123
