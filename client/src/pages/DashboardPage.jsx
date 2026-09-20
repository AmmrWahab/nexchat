// src/pages/DashboardPage.jsx

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import './dashboard.css';
import { io } from 'socket.io-client';
import { Search, X, CornerUpRight, CornerUpLeft, Phone, Video, Paperclip, Camera, Mic, User, FileText, Trash2, Copy, Forward, Reply, ArrowLeft, ChevronUp, ChevronDown, ChevronRight, Info, MessageCircle, Users, Settings, Menu, SquarePen, Images, Image, PencilLine, Check, MicOff, VideoOff, Volume2, Headset } from "lucide-react";
import { API_URL } from '../config.js';

// Bump this marker whenever the sync/delete behavior changes so a stale cached
// bundle is immediately detectable on any device.
const CLIENT_BUILD = 'sync-v5';

// Prints on every load so it's immediately obvious which client build a device
// is running (hard-refresh issues / stale bundles are a common cause of
// "chat deleted on laptop but still visible on my phone").
console.info(`[nexchat] DashboardPage build ${CLIENT_BUILD} · API ${API_URL}`);

const BLUE_TICK = '#53bdeb';

// Hollow/profile-anonymous avatar shown when a user has BLOCKED you — per
// privacy rules they get the default silhouette instead of the real photo.
const HOLLOW_AVATAR = skeletonAvatar();

// Skeleton avatar: a clean gray circle with a white person silhouette and
// transparent "donut" hole. Used everywhere a profile picture is missing or
// hasn't loaded yet.
function skeletonAvatar() {
  return (
    'data:image/svg+xml;charset=utf-8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
      '<circle cx="50" cy="50" r="50" fill="#dfe4ea"/>' +
      '<circle cx="50" cy="38" r="16" fill="#fff"/>' +
      '<path d="M26 82c0-13.255 10.745-24 24-24s24 10.745 24 24" fill="#fff"/>' +
      '</svg>'
    )
  );
}

// Avatar helper: returns the real photo if available, otherwise the skeleton.
function avatarSrc(photo, size) {
  if (photo && !photo.includes('placeholder')) return photo;
  return skeletonAvatar(size);
}

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
    localStorage.setItem(accountScopedKey(key), JSON.stringify(value));
  } catch (err) {
    console.warn(`localStorage write failed for "${key}"`, err);
  }
}

// Conversation data (chatMessages, selectedChat, dashboardChatOpen) is keyed
// per account so a second account signing in on the SAME device can never see
// another account's chats. localStorage is only a cache — the server is the
// source of truth.
function currentUserIdFromToken() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload && payload.userId ? String(payload.userId) : null;
  } catch (err) {
    return null;
  }
}

function accountScopedKey(key) {
  const uid = currentUserIdFromToken();
  return uid ? `${key}_${uid}` : key;
}

function readChatMessages() {
  const saved = localStorage.getItem(accountScopedKey('chatMessages'));
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === 'object') {
      for (const chatId of Object.keys(parsed)) {
        if (Array.isArray(parsed[chatId])) healReplyTo(parsed[chatId]);
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

// Reply-to-file label used when quoting a file/image/voice message.
// Replaces the old hardcoded "[Image]" fallback so every media type shows
// its real type, and text messages never get labelled as "[Image]".
function replyFileLabel(msg) {
  if (!msg || msg.text) return null;
  if (!msg.file && !msg.fileType) return null;
  if (msg.fileType?.startsWith('image/')) return '[Photo]';
  if (msg.fileType?.startsWith('video/')) return 'Video';
  if (msg.duration || msg.fileType?.startsWith('audio/') || msg.fileType?.includes('ogg')) return 'Voice message';
  return '[File]';
}

// Ghost/stale `replyTo` objects from older builds could leave an empty shell
// behind in localStorage, causing a bogus "Unknown: [Image]" quote to render
// above every message after a refresh. This drops any replyTo that carries no
// queryable reference.
function sanitizeReplyTo(replyTo) {
  if (!replyTo || typeof replyTo !== 'object') return null;
  const hasRef = replyTo.messageId || replyTo.statusId;
  const hasContent = !!replyTo.text;
  if (!hasRef && !hasContent) return null;
  return {
    sender: replyTo.sender ? String(replyTo.sender) : null,
    text: replyTo.text ? String(replyTo.text) : null,
    messageId: replyTo.messageId ? String(replyTo.messageId) : null,
    statusId: replyTo.statusId ? String(replyTo.statusId) : null,
    statusType: replyTo.statusType ? String(replyTo.statusType) : null,
    senderId: replyTo.senderId ? String(replyTo.senderId) : null,
  };
}

// Walk a chat's message array: sanitize every replyTo and backfill a proper
// file label for quotes whose original message sits in the same batch, so the
// reply pill never shows "Unknown: [Image]" after a refresh. Legacy clients
// stored bare '[Image]'/'[File]' labels (or shared response shells) as the
// replied text — those are treated as "no content" here so the label is
// re-derived from the original message instead of being painted as a quote.
function healReplyTo(list) {
  if (!Array.isArray(list)) return;
  for (const m of list) {
    if (m && typeof m === 'object' && 'replyTo' in m) m.replyTo = sanitizeReplyTo(m.replyTo);
  }
  for (const m of list) {
    const r = m?.replyTo;
    if (!r) continue;
    const rawText = String(r.text || '').trim();
    if (rawText === '[Image]' || rawText === '[File]' || rawText === '[Photo]' || rawText === '📷 Photo') r.text = null;
    if (!r.text && !r.statusId) {
      const orig = r.messageId ? list.find(o => String(o?.id || o?.localId) === String(r.messageId)) : undefined;
      const label = replyFileLabel(orig);
      if (label) r.text = label;
      if (orig) {
        if (!r.senderId && orig.senderId) r.senderId = orig.senderId;
        if (!r.sender && orig.sender) r.sender = orig.sender;
      }
    }
    m.replyTo = sanitizeReplyTo(r);
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
  const [activeTab, setActiveTab] = useState(() => {
    try { return localStorage.getItem('dashboardActiveTab') || 'chats'; } catch { return 'chats'; }
  });
  const [view, setView] = useState(() => {
    try { return localStorage.getItem('dashboardView') || 'chats'; } catch { return 'chats'; }
  });
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
  const [lastGroupsCount, setLastGroupsCount] = useState(null);
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
  const [memberProfile, setMemberProfile] = useState(null);
  const [groupMessages, setGroupMessages] = useState({});
  // Permission preferences chosen while creating a group (opened via the Group
  // Settings sub-page of the creation flow).
  const [groupAddPref, setGroupAddPref] = useState('everyone'); // 'everyone' | 'admins'
  const [groupSendPref, setGroupSendPref] = useState('everyone'); // 'everyone' | 'admins'
  // Whether the nested "Group Settings" page is shown INSIDE the group-creation
  // panel (opened from the hollow Settings icon on the name+photo page).
  const [groupFlowSettingsOpen, setGroupFlowSettingsOpen] = useState(false);
  // Group Info: options popup for the group profile picture (true = open).
  const [groupDpMenuOpen, setGroupDpMenuOpen] = useState(false);
  // Permission toggles that are awaiting the server's confirmation. While a
  // toggle is pending, the active button is blurred + shows a small spinner so
  // users can't spam-click (the server round-trip is slow, 5-15s).
  const [pendingGroupSettings, setPendingGroupSettings] = useState(new Set());
  // Group Info -> nested "Group Settings" screen (photo + permissions).
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  // Group Info -> "Add members" screen state.
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const [addMembersQuery, setAddMembersQuery] = useState('');
  const [addMembersSelected, setAddMembersSelected] = useState(new Set());
  // Leave-group confirmation: null or { groupId, name }.
  const [confirmLeave, setConfirmLeave] = useState(null);
  // In-app "Delete chat" / "Delete group" confirmation: null or
  // { kind: 'dm'|'group', id, name }. Replaces the old window.confirm so the
  // destructive step gets a proper Confirm/Cancel popup on every screen size.
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  // Sole-admin info popup: shown when the only admin tries to leave.
  // null or { name }.
  const [soleAdminWarning, setSoleAdminWarning] = useState(null);
  // Per-user "cleared at" timestamps for group chats, persisted in localStorage
  // so a "Clear chat" survives a refresh. Messages older than the stamp stay
  // hidden; anything received after clearing shows normally.
  const groupClearedRef = useRef((() => {
    try { return JSON.parse(localStorage.getItem(accountScopedKey('groupCleared')) || '{}') || {}; } catch { return {}; }
  })());
  const groupClearedAt = (gid) => groupClearedRef.current[String(gid ?? '')] || 0;
  const persistGroupCleared = (gid, ts) => {
    groupClearedRef.current = { ...(groupClearedRef.current || {}), [String(gid ?? '')]: ts };
    try { localStorage.setItem(accountScopedKey('groupCleared'), JSON.stringify(groupClearedRef.current)); } catch { /* ignore quota errors */ }
  };
  // Same "cleared at" persistence for 1:1 DM chats. Without this, a "Clear
  // chat" only empties the in-memory list, and the next refresh re-fetches the
  // server history and resurrects the cleared conversation.
  const dmClearedRef = useRef((() => {
    try { return JSON.parse(localStorage.getItem(accountScopedKey('dmCleared')) || '{}') || {}; } catch { return {}; }
  })());
  const dmClearedAt = (cid) => dmClearedRef.current[String(cid ?? '')] || 0;
  const persistDmCleared = (cid, ts) => {
    dmClearedRef.current = { ...(dmClearedRef.current || {}), [String(cid ?? '')]: ts };
    try { localStorage.setItem(accountScopedKey('dmCleared'), JSON.stringify(dmClearedRef.current)); } catch { /* ignore quota errors */ }
  };
  const selectedGroupRef = useRef(null);
  const prefetchedGroupHistoryRef = useRef(new Set());
  const prefetchedHistoryRef = useRef(new Set());
  const contactsRef = useRef([]);
  // Deleted-chat ids for THIS viewer/account. When a chat is deleted on any of
  // the user's devices, the server drops it from this account's address book.
  // The id is remembered here so a later address-book re-fetch can never
  // resurrect the chat mid-session, and this device can detect deletions made
  // on another device even if it missed the realtime event.
  const deletedChatsRef = useRef((() => {
    try { return new Set(JSON.parse(localStorage.getItem(accountScopedKey('deletedChats')) || '[]') || []); } catch { return new Set(); }
  })());
  // Ids the server listed in the most recent /api/contacts response. Any id
  // that was listed before but is missing now means the chat was deleted on
  // another device -> pull it off this device's list too.
  const serverContactsSeenRef = useRef(new Set());
  // Viewer-local map of user id -> custom contact name the CURRENT viewer has
  // deliberately saved (mirror of the server's per-viewer contactNames). Kept
  // separate from the contacts refetch merge so a backend rename can never
  // clobber the name the viewer chose; nameOf resolves it first and falls back
  // to the live account name when no custom name has been saved.
  const savedNamesRef = useRef((() => {
    try {
      return JSON.parse(localStorage.getItem('nexchatSavedNames') || '{}') || {};
    } catch {
      return {};
    }
  })());
  const persistSavedName = (who, name) => {
    const key = String(who ?? '');
    const trimmed = String(name || '').trim();
    const next = { ...(savedNamesRef.current || {}) };
    if (key) {
      if (trimmed) next[key] = trimmed;
      else delete next[key];
    }
    savedNamesRef.current = next;
    try { localStorage.setItem('nexchatSavedNames', JSON.stringify(next)); } catch { /* ignore quota/private-mode errors */ }
  };
  // Central name resolver: returns the contact's effective name (the viewer's
  // saved custom name, or the account's real name) when an id matches the
  // address book, otherwise the given fallback. Reads contactsRef so every
  // surface (chat list, chat header, status, calls, groups, profiles, replies)
  // resolves names consistently, including data arriving from socket/backend.
  const nameOf = (who, fallback) => {
    const id = who !== null && typeof who === 'object'
      ? String(who.id ?? who._id ?? who.userId ?? who.senderId ?? who.from ?? '')
      : String(who ?? '');
    if (!id) return fallback || 'Unknown';
    const saved = (savedNamesRef.current || {})[id];
    if (saved && String(saved).trim()) return String(saved).trim();
    const hit = (contactsRef.current || []).find((c) => c && String(c.id) === id);
    return hit && hit.name && String(hit.name).trim() ? hit.name : (fallback || 'Unknown');
  };
  // Privacy-aware avatar: users who blocked us are shown the anonymous hollow
  // silhouette instead of their real profile photo (WhatsApp-style).
  const avatarFor = (id, photo, fallback) => {
    if (blockedMeSet.has(String(id ?? ''))) return HOLLOW_AVATAR;
    return photo || fallback || skeletonAvatar();
  };
  // True when the email-lookup user is already in the private address book
  // (matched by user id or by email), so adding them is blocked as a duplicate.
  const isContactAlreadySaved = (lookupUser) => {
    if (!lookupUser?._id) return false;
    const uid = String(lookupUser._id);
    const em = lookupUser.email ? String(lookupUser.email).toLowerCase() : '';
    return (contacts || []).some(c =>
      String(c.id) === uid ||
      (c.email && String(c.email).toLowerCase() === em)
    );
  };
  // Block / unblock the currently open DM from the Contact Info drawer.
  // First opens an in-app confirmation popup (mobile + desktop), then acts.
  const askBlockToggle = () => {
    const chatId = selectedChat?.id;
    if (!chatId || selectedChat?.type === 'group') return;
    setBlockConfirm({
      chatId,
      currentlyBlocked: blockedByMeSet.has(String(chatId)),
      name: nameOf(chatId, 'this contact'),
    });
  };
  const confirmBlockToggle = async (chatId, currentlyBlocked) => {
    setBlockConfirm(null);
    try {
      // POST /block = block, DELETE /block = unblock (the route is the same).
      const res = await fetch(`${API_URL}/api/profile/${encodeURIComponent(chatId)}/block`, {
        method: currentlyBlocked ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      if (!res.ok) {
        console.error('Block toggle failed', res.status);
        return;
      }
      // Update local state immediately; profileRefreshTick triggers refetches.
      setBlockedByMeSet(prev => {
        const next = new Set(prev);
        if (currentlyBlocked) next.delete(String(chatId));
        else next.add(String(chatId));
        return next;
      });
      setContacts(prev => prev.map(c =>
        String(c.id) === String(chatId) ? { ...c, blockedByMe: !currentlyBlocked } : c
      ));
      setProfileRefreshTick(t => t + 1);
    } catch (err) {
      console.error('Block toggle error', err);
    }
  };

  // Open the "Profile Edit" nested screen from the Contact Info drawer (the
  // pencil button). Prefills the field with the current effective name (the
  // viewer's custom saved name when present, otherwise the real account name).
  const openContactEdit = () => {
    if (!selectedChat || selectedChat.type === 'group') return;
    const id = String(selectedChat.id);
    const realName = contactInfoProfile?.name || selectedChat?.name || '';
    const customName =
      (savedNamesRef.current || {})[id] ||
      (contactsRef.current || []).find((c) => c && String(c.id) === id)?.name ||
      '';
    setContactEditName(customName || realName);
    setContactEditOpen(true);
  };

  // Save the edited contact name. This only touches the CURRENT viewer's own
  // per-user custom name (me.contactNames on the server): every surface that
  // resolves names through nameOf (chat list, chat headers, contact list,
  // groups, status, calls) picks up the new name immediately, while other
  // users keep the custom names THEY saved for this person.
  const saveContactName = async () => {
    const id = String(selectedChat?.id || '');
    if (!id || selectedChat?.type === 'group') return;
    const clean = String(contactEditName || '').trim();
    if (clean.length > 25) return alert('Name must be 25 characters or fewer');
    const tk = localStorage.getItem('token');
    if (!tk) return;
    setContactEditBusy(true);
    try {
      const realName = contactInfoProfile?.name || selectedChat?.name || 'Contact';
      const cur = contactsRef.current || [];
      const entry = {
        id,
        name: clean || realName,
        firstName: clean || '',
        lastName: '',
        email: selectedChat?.email || '',
        photo: avatarSrc(selectedChat?.photo, 50),
        blockedByMe: (cur.find((c) => c && String(c.id) === id))?.blockedByMe || false,
      };
      const next = cur.some((c) => c && String(c.id) === id)
        ? cur.map((c) => (String(c.id) === id ? { ...c, ...entry } : c))
        : [entry, ...cur];
      contactsRef.current = next;
      setContacts(next);
      persistSavedName(id, clean);

      // Persist to this viewer's address book (adds the link if missing and
      // stores the custom name). An empty name clears the custom entry so the
      // real account name is used again.
      const res = await fetch(`${API_URL}/api/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
        body: JSON.stringify({ userId: id, name: clean }),
      });
      const data = await res.json().catch(() => ({}));
      // Adopt the server's stored custom name when reported (authoritative),
      // otherwise the value just submitted stays local.
      if (data && data.contact && typeof data.contact.customName === 'string') {
        persistSavedName(id, data.contact.customName);
      }
    } catch (err) {
      console.error('Save contact name error', err);
    } finally {
      setContactEditBusy(false);
      setContactEditOpen(false);
    }
  };

  // Submit a user report. Stored server-side (reporter, reported, reason, timestamp)
  // for later admin review.
  const submitReport = async () => {
    const chatId = selectedChat?.id;
    if (!chatId || selectedChat?.type === 'group') return;
    const reason = reportReason.trim();
    if (!reason) {
      alert('Please enter a reason for the report.');
      return;
    }
    setReportBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({ reportedId: chatId, reason }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data?.message || 'Could not submit report.');
        return;
      }
      setShowReportModal(false);
      setReportReason('');
      alert('Thanks! Your report has been submitted.');
    } catch (err) {
      console.error('Report submit error', err);
      alert('Could not submit report.');
    } finally {
      setReportBusy(false);
    }
  };

  // ---------- Group admin / member management ----------
  const groupAdminsOf = (g) => (Array.isArray(g?.admins) ? g.admins.map(String) : []);
  const viewerIsGroupAdmin = (g) =>
    !!g && (String(g.admin) === String(user.id) || groupAdminsOf(g).includes(String(user.id)));

  const closeMemberMenu = () => {
    setMemberMenu(null);
    setOpenMemberMenuId(null);
  };

  const emitRemoveGroupMember = (gid, memberIdStr) => {
    const s = socketRef.current || socket;
    if (s && gid && memberIdStr) s.emit('removeGroupMember', { groupId: gid, memberId: memberIdStr });
    closeMemberMenu();
  };
  const emitMakeGroupAdmin = (gid, memberIdStr) => {
    const s = socketRef.current || socket;
    if (s && gid && memberIdStr) s.emit('makeGroupAdmin', { groupId: gid, memberId: memberIdStr });
    closeMemberMenu();
  };
  const emitDemoteAdmin = (gid, memberIdStr) => {
    const s = socketRef.current || socket;
    if (s && gid && memberIdStr) s.emit('demoteGroupAdmin', { groupId: gid, memberId: memberIdStr });
    closeMemberMenu();
  };

  // Compute which management options are allowed for the given member under the
  // current viewer (who opened the menu, so always an admin).
  const memberActionsFor = (member, group) => {
    const gAdmin = String(group?.admin || '');
    const viewerIsCreator = gAdmin === String(user.id);
    const targetIsCreator = !!member?.isCreator;
    const targetIsAdmin = !!member?.isAdmin;
    const targetIsSelf = !!member?.isSelf;
    // Original creator is the root admin and can never be removed by another
    // admin. Promoted admins can only be removed by the creator; regular
    // members can be removed by any admin.
    const canRemove = viewerIsCreator
      ? !targetIsCreator && !targetIsSelf
      : !targetIsCreator && !targetIsSelf && !targetIsAdmin;
    const canMakeAdmin = !targetIsCreator && !targetIsAdmin && !targetIsSelf;
    // Only the creator can demote a promoted admin back to a regular member.
    const canDemote = viewerIsCreator && targetIsAdmin && !targetIsCreator && !targetIsSelf;
    const roleLabel = targetIsCreator ? 'Owner' : targetIsAdmin ? 'Admin' : 'Member';
    return { canRemove, canMakeAdmin, canDemote, roleLabel };
  };

  // Append a group system/history entry (e.g. "X removed Y") to the open chat.
  const appendGroupSystemMsg = (gid, sys) => {
    if (!sys || !sys._id) return;
    const sysId = String(sys._id);
    // Respect a per-user cleared chat: history/events older than the clearing
    // point are not resurrected (persisted "Clear chat" behavior).
    const clearedTs = groupClearedAt(gid);
    if (clearedTs && (sys.timestamp || 0) <= clearedTs) return;
    setGroupMessages(prev => {
      const list = prev[gid] || [];
      if (list.some(m => m.id === sysId)) return prev;
      return {
        ...prev,
        [gid]: [...list, {
          id: sysId,
          text: sys.message,
          senderId: String(sys.from || 'system'),
          sender: sys.fromName || 'System',
          timestamp: sys.timestamp || Date.now(),
          isSystem: true,
          systemType: sys.systemType || 'groupEvent',
          target: sys.target ? String(sys.target) : null,
          targetName: sys.targetName || '',
        }],
      };
    });
  };

  // Apply a server-provided group snapshot (fresh members/admin lists) to the
  // groups list AND the currently open group.
  const applyGroupSnapshot = (gid, snap) => {
    if (!snap) return;
    const merge = (g) => ({
      ...g,
      memberCount: snap.memberCount ?? g.memberCount,
      members: snap.members || g.members,
      admins: snap.admins || g.admins || [],
      admin: (snap.admin && String(snap.admin) !== '[object Object]') ? snap.admin : g.admin,
      adminName: snap.adminName ?? g.adminName,
      dp: snap.dp ?? g.dp,
      name: snap.name ?? g.name,
      addMembers: snap.addMembers ?? g.addMembers,
      sendMessages: snap.sendMessages ?? g.sendMessages,
    });
    const gidStr = String(gid);
    setGroupsList(prev => prev.map(g => String(g.id) === gidStr ? merge(g) : g));
    setSelectedGroup(prev => (prev && String(prev.id) === gidStr ? merge(prev) : prev));
  };
  const isChatBlocked = (chatId) => {
    return selectedChat?.type !== 'group' && blockedByMeSet.has(String(chatId ?? ''));
  };
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
  const emailLookupTimerRef = useRef(null);
  const [groupDropdownPos, setGroupDropdownPos] = useState({ top: 0, right: 0, placement: 'bottom' });
  const [groupShowDropdown, setGroupShowDropdown] = useState(false);
  const [groupShowAttach, setGroupShowAttach] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [emailLookupUser, setEmailLookupUser] = useState(null);
  const [emailLookupStatus, setEmailLookupStatus] = useState(null);
  const [user, setUser] = useState({ name: 'You' }); // Update this to include id

  // Personalize a group event for the CURRENT viewer: the person who was
  // removed/demoted sees "X removed you", the admin who did it sees "You
  // removed X", and everyone else sees "X removed Y". Falls back to the raw
  // server text when there is no target info (e.g. legacy messages).
  const groupEventLabel = useCallback((sys) => {
    if (!sys) return '';
    const targetId = sys.target ? String(sys.target) : null;
    const fromIsSelf = String(sys.from || '') === String(user.id);
    // "X left" — the leaver personally sees "You left the group".
    if (sys.systemType === 'memberLeft') {
      if (targetId && targetId === String(user.id)) return 'You left the group';
      return `${fromIsSelf ? 'You' : (sys.fromName || 'Someone')} left`;
    }
    // "X added Y" — personalized: "You added Y" / "X added you" / "X added Y".
    if (sys.systemType === 'memberAdded') {
      if (targetId && targetId === String(user.id)) return `${sys.fromName || 'Someone'} added you`;
      if (fromIsSelf) return `You added ${sys.targetName || 'a member'}`;
      return `${sys.fromName || 'Someone'} added ${sys.targetName || 'a member'}`;
    }
    const kind = sys.systemType === 'memberDemoted' ? ' as admin' : '';
    if (targetId && targetId === String(user.id)) {
      return `${sys.fromName || 'Someone'} removed you${kind}`;
    }
    if (sys.targetName && fromIsSelf) {
      return `You removed ${sys.targetName}${kind}`;
    }
    return sys.message || '';
  }, [user.id]);
  const [profileRoute, setProfileRoute] = useState('page'); // 'page' | 'name' | 'about'; desktop opens directly on 'page'
  const [profilePhotoMenu, setProfilePhotoMenu] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileAboutDraft, setProfileAboutDraft] = useState('');
  const [profileSaveBusy, setProfileSaveBusy] = useState(false);
  const [profileRefreshTick, setProfileRefreshTick] = useState(0);
  const profilePhotoInputRef = useRef(null);
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
  const onlineUsersRef = useRef(new Set());
  const lastStatusUpdate = useRef({});
  const [showClearChatConfirm, setShowClearChatConfirm] = useState(false);
  // Prompt shown when "Chat privately" opens a DM for a group member who is
  // NOT saved as a contact: warns the chat would disappear after reload and
  // offers to open the existing Add Contact form (email pre-filled).
  const [showUnsavedContactPrompt, setShowUnsavedContactPrompt] = useState(false);
  const [pendingPrivateContact, setPendingPrivateContact] = useState(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMessages, setSelectedMessages] = useState(new Set());
  const [mobileSearch, setMobileSearch] = useState(false);
  const [mobileSearchQuery, setMobileSearchQuery] = useState('');
  const [mobileSearchIndex, setMobileSearchIndex] = useState(-1);
  // Dedicated "filter the active list" query. Distinct from in-rail
  // find-in-conversation searches (mobileSearch*/chatSearchQuery) and the
  // group *create* picker (groupSearchQuery): this one filters whichever
  // rail is active — Chats/Unread by name OR email, Groups by name.
  const [listFilterQuery, setListFilterQuery] = useState('');
  const [groupMobileSearch, setGroupMobileSearch] = useState(false);
  const [groupMobileSearchQuery, setGroupMobileSearchQuery] = useState('');
  const [groupMobileSearchResults, setGroupMobileSearchResults] = useState([]);
  const [groupMobileSearchIndex, setGroupMobileSearchIndex] = useState(-1);
  const [showSelDropdown, setShowSelDropdown] = useState(false);
  const [showContactInfo, setShowContactInfo] = useState(false);
  // Block state: blockedByMeSet = users I blocked; blockedMeSet = users who blocked me.
  const [blockedByMeSet, setBlockedByMeSet] = useState(new Set());
  const [blockedMeSet, setBlockedMeSet] = useState(new Set());
  // In-app confirmation popup for block/unblock: null or { chatId, currentlyBlocked, name }
  const [blockConfirm, setBlockConfirm] = useState(null);
  // Report User popup
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  // Group member management. memberMenu = the member being managed plus where
  // to anchor the popup: { memberId, memberName, memberPhoto, isCreator,
  // isAdmin, isSelf, isMobile, rect } — null when closed.
  const [memberMenu, setMemberMenu] = useState(null);
  const [openMemberMenuId, setOpenMemberMenuId] = useState(null);

  // Clicking anywhere outside the member menu (or its dots button) closes it.
  // Lives AFTER the memberMenu state on purpose: a hook reads its dependency
  // array at render time, so referencing a later-declared const throws a
  // ReferenceError (TDZ).
  useEffect(() => {
    if (!memberMenu) return;
    const handler = (e) => {
      if (e.target && e.target.closest && e.target.closest('.member-dropdown, .member-sheet-overlay, .member-dots')) return;
      setMemberMenu(null);
      setOpenMemberMenuId(null);
    };
    document.addEventListener('pointerdown', handler);
    return () => document.removeEventListener('pointerdown', handler);
  }, [memberMenu]);

  const [contactInfoProfile, setContactInfoProfile] = useState(null);
  // Contact-Info edit panel: true = the "Profile Edit" nested screen is open.
  const [contactEditOpen, setContactEditOpen] = useState(false);
  const [contactEditName, setContactEditName] = useState('');
  const [contactEditBusy, setContactEditBusy] = useState(false);
  const [showGroupInfo, setShowGroupInfo] = useState(false);
  const [showForwardModal, setShowForwardModal] = useState(false);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');
  const [selectedForwardChats, setSelectedForwardChats] = useState(new Set());
  const [selectedForwardGroups, setSelectedForwardGroups] = useState(new Set());
  const [newMsgCount, setNewMsgCount] = useState(0);
  const messagesScrollRef = useRef(null);
  const lastDmChatRef = useRef(null);
  const dmOpenAtRef = useRef(0);
  const dmStayBottomRef = useRef(false);
  const dmRafRef = useRef(null);
  const dmHistoryMergeAtRef = useRef(0);
  const dmScrollOnSendRef = useRef(false);
  const dmAbortRef = useRef(null);
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
  const callsRef = useRef([]);
  const [activeCall, setActiveCall] = useState(null); // { mode, type, callId, peerId, peerName, peerPhoto }
  const activeCallRef = useRef(null);
  const [callSpeakerMenuOpen, setCallSpeakerMenuOpen] = useState(false);
  // '' = system default output (earpiece/handset on phones, or the platform
  // default), 'speaker' = loudspeaker, otherwise a concrete audiooutput deviceId.
  const [callSpeakerOutput, setCallSpeakerOutput] = useState('');
  // The CURRENT system audio-output device, read live from enumerateDevices()
  // (devicechange). kind is 'handset' only when a real earpiece/headset is
  // detected as the default route; anything else (loudspeaker, unclassified)
  // is 'speaker', so the in-call icon and chooser always reflect what the user
  // is physically using right now - the routine state is the loudspeaker.
  const [callDefaultOut, setCallDefaultOut] = useState({ name: '', kind: 'speaker' });
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
  const peerAudioRef = useRef(null);   // hidden <audio> that plays remote voice-call audio
  const groupAudioRef = useRef(null);  // hidden <audio> that plays remote group voice-call audio
  const groupVoiceStreamRef = useRef(null);
  // Every live media element that can receive remote audio. Output routing via
  // HTMLMediaElement.setSinkId() is applied to each one.
  const audioElsRef = useRef(new Set());
  const sinkIdRef = useRef('');
  const audioOutputsCacheRef = useRef({ speakerId: '', external: [], defaultName: '', defaultKind: 'speaker' });
  // Last detected system-default output name, for reacting to handset plug-in
  // / plug-out during a live call.
  const prevDefaultNameRef = useRef('');
  // Real microphone list (audioinput) for pairing the in-call mic with the
  // chosen output device: on a handset both mic+speaker are the handset's, on
  // Speaker (mobile/laptop loudspeaker) both are the device's own mic+speaker,
  // and a no-mic device (bass speaker) falls back to the device mic.
  const audioInputsCacheRef = useRef({ defaultIsHandset: false, handsetMicId: '', builtinMicId: '', byGroup: {} });
  // The identified loudspeaker's (deviceId, groupId) so its sibling mic can be
  // used when Speaker is picked while a headset is the system default input.
  const speakerDevRef = useRef({ deviceId: '', groupId: '' });
  const callTimerRef = useRef(null);
  const peekReminderRef = useRef(null);
  // Transient in-call notice (e.g. "… declined the video request" / "Rear
  // camera…"). Auto-cleared after a few seconds.
  const [callNotice, setCallNotice] = useState('');
  const callNoticeRef = useRef(null);
  // Voice -> video upgrade consent. The pending flag lives in a ref so the
  // once-registered socket handlers see the fresh value.
  const videoSwitchPendingRef = useRef(false);
  // Real camera list (from enumerateDevices). Used only for switching.
  const videoInputsRef = useRef([]);
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
    if (!token) return null;
    try {
      const res = await fetch(`${API_URL}/api/status/feed`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data && Array.isArray(data.statuses)) {
        setStatusFeed(data.statuses);
        return data.statuses;
      }
      return null;
    } catch (err) {
      console.error('Failed to load status feed', err);
      return null;
    }
  }, []);
  const loadStatusFeedRef = useRef(loadStatusFeed);
  useEffect(() => { loadStatusFeedRef.current = loadStatusFeed; });

  // Open the exact status a message replies to, by its id.
  // Always re-fetch the fresh feed first: a status may have been deleted or
  // expired (24h) since the local feed was cached, so we must not trust it.
  // If the status is gone, alert instead of opening a stale/wrong viewer.
  const openStatusFromReply = useCallback(async (statusId) => {
    if (!statusId) return;
    const fresh = await loadStatusFeedRef.current();
    // Trust the fresh feed whenever the server answered (even if empty):
    // a deleted/expired status leaves the feed, and the stale local cache
    // could still list it. Only fall back to cache if the fetch failed.
    const feed = Array.isArray(fresh) ? fresh : (statusFeed || []);
    const find = (from) => from.find(s => String(s._id) === String(statusId));
    let st = find(feed);
    if (!st) {
      alert('This status is no longer available.');
      return;
    }
    const uid = String(st.user.id);
    const isOwn = String(uid) === String(user.id);
    const list = isOwn
      ? feed.filter(s => s.user && String(s.user.id) === String(user.id))
      : feed.filter(s => s.user && String(s.user.id) === uid);
    const idx = list.findIndex(s => String(s._id) === String(statusId));
    if (idx >= 0) setStatusViewer({ userId: uid, index: idx });
    else alert('This status is no longer available.');
  }, [statusFeed, user.id]);

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
    skeletonAvatar();

  const postStatus = (type, text, bg, file) => {
    if (!socket || !socket.connected) {
      alert('Not connected yet. Please wait a moment.');
      return;
    }
    socket.emit('postStatus', { type, text: text || '', bg: bg || 'default', file: file || '' });
  };

  // WhatsApp-style "Forwarded" tag shown above forwarded text or media.
  const ForwardedLabel = () => (
    <div
      style={{
        fontSize: '0.72rem',
        fontWeight: 600,
        color: '#128c7e',
        fontStyle: 'italic',
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
        marginBottom: '2px',
      }}
    >
      Forwarded
    </div>
  );

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
            goBackPage();
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
    goBackPage();
    setStatusCaptureCaption('');
    setStatusAddSheet(false);
  };

  const sendStatusText = () => {
    const txt = statusText.trim();
    if (!txt) return;
    postStatus('text', txt, 'default', '');
    setStatusText('');
    goBackPage();
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
    if (!contact) {
      goBackPage();
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
          replyTo: {
            sender: nameOf(viewerUser.user.id, viewerUser.user.name),
            text: `Status: ${quoteText}`,
            statusId: cur?._id ? String(cur._id) : null,
          },
        });
      }
      return;
    }
    setStatusViewer(null);
    setSelectedChat(contact);
    setSelectedGroup(null);
    setMobileChatOpen(true);
    setActiveTab('chats');
    setReplyTo({
      sender: nameOf(viewerUser.user.id, viewerUser.user.name),
      text: `Status: ${quoteText}`,
      isStatus: true,
      statusId: cur?._id ? String(cur._id) : null,
      statusType: cur?.type || null,
      statusOwnerId: String(viewerUser.user.id),
    });
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
    goBackPage();
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
      const list = String(statusViewer.userId) === String(user.id) ? myStatuses : feedGroups.find(g => String(g.user.id) === String(statusViewer.userId))?.statuses || [];
      if (statusViewer.index < list.length - 1) {
        setStatusViewer({ userId: statusViewer.userId, index: statusViewer.index + 1 });
      } else {
        goBackPage();
      }
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
        goBackPage();
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
      // Remember this user's clearing point so a refresh doesn't restore the
      // older history (server keeps the messages for other members).
      persistGroupCleared(t.chatId, Date.now());
      setGroupMessages(prev => ({ ...prev, [String(t.chatId)]: [] }));
    } else {
      socketRef.current?.emit('clearChat', { to: t.chatId, forEveryone: false });
      // Remember this user's clearing point so a refresh doesn't restore the
      // older history (the server keeps the messages for the other member).
      persistDmCleared(t.chatId, Date.now());
      setMessages(prev => {
        const next = { ...prev, [String(t.chatId)]: [] };
        safeSetItem('chatMessages', next);
        return next;
      });
    }
    setClearTarget(null);
    goBackPage();
  };

  // Confirm popup for Delete chat (DM) / Delete group.
  // DM: removes the contact from the viewer's address book + custom name on the
  // server (so the person must be added again to chat), drops the local chat,
  // and mirrors it to the viewer's other devices. Group: only reachable after
  // the viewer has exited the group; permanently removes the group from their
  // list (server drops the reference, or deletes the group for everyone when
  // nobody references it anymore).
  const confirmDeleteChat = () => {
    const t = deleteConfirm;
    if (!t) return;
    const s = socketRef.current || socket;
    if (t.kind === 'group') {
      if (s && s.connected) {
        console.info('[nexchat] delete group dispatched', t.id);
        s.emit('deleteGroupChat', { groupId: t.id });
      }
      fetch(`${API_URL}/api/groups/${encodeURIComponent(t.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
        .then((res) => {
          console.info('[nexchat] delete group server responded', res.status);
          if (!res.ok) console.warn('Delete group: server returned', res.status);
        })
        .catch((err) => console.warn('Delete group failed on server', err));
      applyGroupDeleted(t.id);
    } else {
      console.info('[nexchat] delete dispatched', t.id);
      if (s && s.connected) s.emit('deleteChat', { to: t.id });
      fetch(`${API_URL}/api/contacts/${encodeURIComponent(t.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      })
        .then((res) => {
          console.info('[nexchat] delete server responded', res.status);
          if (!res.ok) {
            console.warn('Delete chat: server returned', res.status);
            return;
          }
          fetchContacts();
        })
        .catch((err) => console.warn('Delete chat failed on server', err));
      applyChatDeleted(t.id);
    }
    setDeleteConfirm(null);
    setShowDropdown(false);
    setGroupShowDropdown(false);
  };




  const [contacts, setContacts] = useState([]);

  // Remove a deleted 1:1 chat from EVERY surface + cache on this device and
  // close it if open. Invoked from the realtime 'chatDeleted' event, from the
  // address-book fetch (self-heal when another device deleted it), and from
  // the Delete-chat menu action.
  const applyChatDeleted = useCallback((rawId) => {
    const id = String(rawId || '');
    if (!id) return;
    deletedChatsRef.current.add(id);
    try { localStorage.setItem(accountScopedKey('deletedChats'), JSON.stringify([...deletedChatsRef.current])); } catch { /* ignore quota errors */ }
    // A deleted contact's saved custom name goes with it: drop the viewer's
    // per-contact entry so re-adding the person starts clean (the account
    // name is the fallback again until a new name is saved).
    const savedNamesNow = { ...(savedNamesRef.current || {}) };
    delete savedNamesNow[id];
    savedNamesRef.current = savedNamesNow;
    try { localStorage.setItem('nexchatSavedNames', JSON.stringify(savedNamesNow)); } catch { /* ignore quota/private-mode errors */ }
    setContacts((prev) => prev.filter((c) => c && String(c.id) !== id));
    setMessages((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      safeSetItem('chatMessages', next);
      return next;
    });
    // Close the chat if this device currently has it open, and drop the
    // persisted "chat was open" markers so a reload can't reopen it.
    if (selectedChatRef.current && String(selectedChatRef.current.id) === id) {
      setSelectedChat(null);
      selectedChatRef.current = null;
      setMobileChatOpen(false);
      setShowContactInfo(false);
      setContactEditOpen(false);
    }
    try {
      localStorage.removeItem(accountScopedKey('selectedChat'));
      localStorage.removeItem(accountScopedKey('selectedGroup'));
      localStorage.setItem(accountScopedKey('dashboardChatOpen'), 'false');
    } catch { /* ignore */ }
  }, []);

  // Remove a deleted group from EVERY surface + cache on this device and close
  // it if open. Invoked from the realtime 'groupChatDeleted' event (any of this
  // user's devices) and from the Delete-group menu action.
  const applyGroupDeleted = useCallback((rawId) => {
    const id = String(rawId || '');
    if (!id) return;
    setGroupsList((prev) => prev.filter((g) => g && String(g.id) !== id));
    setGroupMessages((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedGroupRef.current && String(selectedGroupRef.current.id) === id) {
      setSelectedGroup(null);
      selectedGroupRef.current = null;
      setGroupSettingsOpen(false);
      setShowGroupInfo(false);
      setGroupDpMenuOpen(false);
      setGroupMobileSearch(false);
      setGroupMobileSearchQuery('');
      setMobileChatOpen(false);
    }
    try {
      localStorage.removeItem(accountScopedKey('selectedGroup'));
      localStorage.removeItem(accountScopedKey('selectedChat'));
      localStorage.setItem(accountScopedKey('dashboardChatOpen'), 'false');
    } catch { /* ignore */ }
  }, []);

  // Pull this user's private address book from the server. Merge-based so
  // runtime-only chats (a sender who just messaged you) stay visible, with
  // self-heal: contacts listed on a previous fetch but missing now were
  // deleted on another device, so they're removed here even if this device
  // never received the realtime event.
  const fetchContacts = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token || !user.id) return;
    try {
      const res = await fetch(`${API_URL}/api/contacts`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data || !Array.isArray(data.contacts)) return;
      const serverIds = new Set(data.contacts.map((c) => String(c._id)));
      [...serverContactsSeenRef.current].forEach((id) => {
        if (!serverIds.has(id)) {
          console.info('[nexchat] reconcile: contact vanished from server list -> removing', id);
          applyChatDeleted(id);
        }
      });
      serverContactsSeenRef.current = serverIds;
      // Reconcile block state from the server (authoritative).
      setBlockedByMeSet(prev => {
        const next = new Set(prev);
        data.contacts.forEach(c => (c.blockedByMe ? next.add(String(c._id)) : next.delete(String(c._id))));
        return next;
      });
      setBlockedMeSet(prev => {
        const next = new Set(prev);
        data.contacts.forEach(c => (c.blockedMe ? next.add(String(c._id)) : next.delete(String(c._id))));
        return next;
      });
      // Merge server contacts into state WITHOUT wiping contacts that were
      // added at runtime (e.g. a sender who just messaged you), so the
      // fresh chat stays visible.
      setContacts(prev => {
        const map = new Map(prev.map(c => [String(c.id), c]));
        data.contacts.forEach(c => {
          map.set(String(c._id), {
            id: c._id,
            name: c.name,
            about: c.about || '',
            firstName: c.firstName || '',
            lastName: c.lastName || '',
            email: c.email,
            photo: avatarSrc(c.photo, 50),
            lastMsg: '',
            time: '',
            online: false,
            lastSeen: c.lastSeen || Date.now(),
          });
        });
        // Adopt any server-stored custom names (the viewer's own per-user
        // contactNames) so they survive restarts and stay in sync across
        // devices. Absent customName is NOT a deletion — a locally saved name
        // wins until the viewer clears it.
        data.contacts.forEach(c => {
          if (c && c.customName && String(c.customName).trim()) {
            persistSavedName(c._id, c.customName);
          }
        });
        return [...map.values()];
      });
      setDataReady(true);
    } catch (err) {
      console.error('Failed to fetch contacts', err);
    }
  }, [user.id, applyChatDeleted]);



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

// WhatsApp-style "latest message" time for the chat/group list:
// today → clock time ("8:35 am"), otherwise relative ("Yesterday",
// "3 days ago", "2 weeks ago", "a month ago", "2 years ago" …).
function formatRelativeTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";

  const now = new Date();
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startOf(now) - startOf(date)) / 86400000);

  if (diffDays <= 0) {
    return date.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return weeks === 1 ? "a week ago" : `${weeks} weeks ago`;
  }

  const months = Math.max(
    1,
    (now.getFullYear() - date.getFullYear()) * 12 + (now.getMonth() - date.getMonth())
  );
  if (months < 12) return months === 1 ? "a month ago" : `${months} months ago`;

  const years = Math.floor(months / 12);
  return years === 1 ? "a year ago" : `${years} years ago`;
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

  // Unread missed calls from this contact count toward the same green badge;
  // opening the chat must clear those too (server marks call.calleeRead).
  const missedUnread = (callsRef.current || []).some(c => !c.groupId && String(c.userId) === String(chat.id) && c.missedCallUnread);

  setMessages(prev => {
    const chatMessages = prev[chat.id] || [];
    const receivedMessages = chatMessages.filter(msg => msg.sender !== 'You');
    const hasUnread = receivedMessages.some(msg => !msg.read);

    if (!hasUnread && !missedUnread) return prev; // ✅ Already read

    // ✅ Emit only once
    currentSocket.emit('markAsRead', {
      chatId: chat.id,
      readerId: currentUser.id
    });

    if (!hasUnread) return prev;

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
    return readChatMessages() || {};
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

// Persist the current application section so a refresh restores the same
// screen the user was on (Chats / Status / Calls / …) instead of resetting
// to Chats while also auto-opening a previously selected chat.
useEffect(() => {
  try { localStorage.setItem('dashboardActiveTab', activeTab); } catch { console.warn('Failed to persist activeTab'); }
}, [activeTab]);
useEffect(() => {
  try { localStorage.setItem('dashboardView', view); } catch { console.warn('Failed to persist view'); }
}, [view]);

useEffect(() => {
  mobileChatOpenRef.current = mobileChatOpen;
}, [mobileChatOpen]);

// Scoping the mobile chat overlay to its own viewport: the overlay (a
// full-screen reuse of the desktop right panel) is driven by
// mobileChatOpen, which is set when a chat/group is explicitly opened from
// the mobile UI. A chat/group left open on the DESKTOP must not follow the
// window into a narrow viewport — clearing the flag at the moment the app
// enters the mobile layout surfaces the mobile home instead of letting the
// desktop panel take over the phone screen. Mobile opens later in the same
// session re-set the flag normally.
useEffect(() => {
  if (isMobile) {
    setMobileChatOpen(false);
  }
}, [isMobile]);

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

// Keep the call audio-output list honest: re-enumerate whenever the browser
// reports that the physical audio devices changed (headset plugged/unplugged,
// speaker added, BT paired, ...). Nothing is shown unless the browser really
// enumerates it.
useEffect(() => {
  refreshAudioOutputs();
  refreshVideoInputs();
  const md = navigator.mediaDevices;
  if (!md || typeof md.addEventListener !== 'function') return undefined;
  md.addEventListener('devicechange', refreshAudioOutputs);
  md.addEventListener('devicechange', refreshVideoInputs);
  return () => {
    md.removeEventListener('devicechange', refreshAudioOutputs);
    md.removeEventListener('devicechange', refreshVideoInputs);
  };
}, []);

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
          goBackPage();
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
  if (isGroup && selectedGroup?.removedAt) return;

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

    dmScrollOnSendRef.current = true;
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
    dmScrollOnSendRef.current = true;
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
            // Group voice: SINGLE tick until the server confirms every other
            // member received it (WhatsApp-style per-member delivery receipt).
            delivered: false,
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
    dmScrollOnSendRef.current = true;
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
    if (data && Array.isArray(data.calls)) {
      setCalls(data.calls);
      callsRef.current = data.calls;
    }
  } catch (err) {
    console.error('Failed to load calls', err);
  }
}, []);
useEffect(() => { loadCalls(); }, [loadCalls]);
useEffect(() => { callsRef.current = calls; }, [calls]);

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

const callElapsed = () => Math.max(0, (Date.now() - callStartAtRef.current) / 1000);

// The elapsed timer must start at the moment the call is actually
// accepted/connected, never at ring time. callStartAtRef is that "connected"
// timestamp: set exactly once per call (guarded), reset on cleanup.
const markCallConnected = () => {
  if (callStartAtRef.current === 0) {
    callStartAtRef.current = Date.now();
    setActiveCall((prev) => (prev ? { ...prev, connectedAt: callStartAtRef.current } : prev));
  }
};

const showCallNotice = (msg) => {
  setCallNotice(msg);
  if (callNoticeRef.current) clearTimeout(callNoticeRef.current);
  callNoticeRef.current = setTimeout(() => setCallNotice(''), 4000);
};

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

// Tear down every media element that was playing call audio/video. iOS in
// particular keeps the WebRTC "call" audio session (and thus the microphone)
// alive while an <audio>/<video> still references a call stream — the OS only
// releases it once the elements are paused and unbound. Detaching them while a
// live MediaStream is still attached makes the phone keep showing "on a call".
const releaseCallMediaElements = () => {
  [peerAudioRef.current, groupAudioRef.current, peerVideoRef.current, ownVideoRef.current].forEach((el) => {
    if (!el) return;
    try {
      el.pause();
      if (el.srcObject) el.srcObject = null;
      if (el.hasAttribute('src')) { el.removeAttribute('src'); el.load(); }
    } catch { return; }
  });
  peerAudioRef.current = null;
  groupAudioRef.current = null;
  peerVideoRef.current = null;
  ownVideoRef.current = null;
  audioElsRef.current.clear();
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
  try { groupVoiceStreamRef.current?.getTracks().forEach((t) => t.stop()); } catch (err) {}
  groupVoiceStreamRef.current = null;
  sinkIdRef.current = '';
  setCallSpeakerOutput('');
  audioElsRef.current.clear();
  signalingRoleRef.current = '';
  callIdRef.current = null;
  callPeerIdRef.current = null;
  callStartAtRef.current = 0;
  videoSwitchPendingRef.current = false;
  if (callNoticeRef.current) { clearTimeout(callNoticeRef.current); callNoticeRef.current = null; }
  setCallNotice('');
  clearGroupCallState();
  releaseCallMediaElements();
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
      // Voice calls have no peer <video> element: the remote audio is bound
      // to the dedicated hidden <audio> (peerAudioRef) instead. Video calls
      // keep playing through the peer <video> element.
      bindRemoteMedia(peerVideoRef.current || peerAudioRef.current);
    }, 100);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      // The 1:1 timer starts counting from this moment, on both sides, once.
      markCallConnected();
    } else if (['failed', 'disconnected'].includes(pc.connectionState)) {
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
    // Voice mesh: every peer's audio must reach the shared hidden <audio> so
    // group voice calls are actually audible (there are no <video> tiles in a
    // voice group call).
    if (activeCallRef.current?.group && activeCallRef.current?.type === 'voice') {
      if (!groupVoiceStreamRef.current) groupVoiceStreamRef.current = new MediaStream();
      stream.getAudioTracks().forEach((t) => {
        if (!groupVoiceStreamRef.current.getTracks().includes(t)) {
          groupVoiceStreamRef.current.addTrack(t);
        }
      });
      const gi = groupAudioRef.current;
      if (gi) bindStreamToEl(gi, groupVoiceStreamRef.current);
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') {
      markCallConnected();
    } else if (['failed', 'disconnected'].includes(pc.connectionState)) {
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
  refreshVideoInputs();
  // Re-read real devices at every call start so the detected output/input
  // state is never stale from a previous call.
  refreshAudioOutputs();
  refreshAudioInputs();
  // Device labels are only available AFTER microphone permission is granted,
  // so refresh once more right after getUserMedia succeeds (and shortly after,
  // for slow OS descriptor enumeration such as a USB-C/OTG hands-free). This
  // is how a freshly plugged Type-C earpiece gets detected.
  const refreshAfterPermission = () => {
    refreshAudioOutputs();
    setTimeout(() => refreshAudioOutputs(), 350);
  };
  if (!video) {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    refreshAfterPermission();
    return s;
  }
  // Use the camera the device actually has: prefer the front (user) camera,
  // fall back to the rear, then to the browser default. Never assume a
  // particular camera exists.
  const attempts = [
    { video: { facingMode: 'user' }, audio: true },
    { video: { facingMode: 'environment' }, audio: true },
    { video: true, audio: true },
  ];
  let lastErr = null;
  for (const constraints of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      refreshVideoInputs();
      refreshAfterPermission();
      return stream;
    } catch (err) { lastErr = err; }
  }
  throw lastErr;
};

const initLocalVideo = () => {
  const v = ownVideoRef.current;
  if (v && localStreamRef.current && v.srcObject !== localStreamRef.current) {
    v.srcObject = localStreamRef.current;
    v.play().catch(() => {});
  }
};

const addLocalTracks = (pc, stream) => {
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
};

// Assign a freshly-acquired media stream to the live call, or stop it if the
// call already ended while getUserMedia() was in flight. Without this guard a
// stream resolved AFTER a hangup would be stored in localStreamRef and never
// stopped — a dead call would keep the microphone held (the device keeps
// showing "you are still on a call"). Returns the stream when adopted, else
// null (the caller should abandon whatever it was about to do).
const adoptLocalStream = (stream, expectedCallId) => {
  if (!stream) return null;
  if (!expectedCallId || String(callIdRef.current) !== String(expectedCallId)) {
    try { stream.getTracks().forEach((t) => t.stop()); } catch { return null; }
    return null;
  }
  localStreamRef.current = stream;
  return stream;
};

// -------- Audio-output detection + routing (voice & video) --------
// Track every live media element that plays remote audio so a single helper
// can reroute them all.
const registerAudioEl = (el) => {
  if (!el || audioElsRef.current.has(el)) return;
  audioElsRef.current.add(el);
  routeTo(el);
};
// Route a single element to the sink chosen by the user. '' = system default,
// so we leave the element untouched (the browser keeps its default output).
const routeTo = (el) => {
  if (!el || typeof el.setSinkId !== 'function') return;
  const id = sinkIdRef.current;
  if (!id) return;
  try {
    el.setSinkId(id).catch(() => {});
  } catch (err) { /* setSinkId unsupported -> keep default output */ }
};
const applyAudioOutput = (id, kind) => {
  if (kind === 'default') sinkIdRef.current = '';
  else if (id) sinkIdRef.current = id;
  else sinkIdRef.current = '';
  audioElsRef.current.forEach((el) => routeTo(el));
  setCallSpeakerOutput(kind === 'default' ? '' : (id || 'speaker'));
  // Pair the microphone with the chosen output device: on a handset the mic
  // is the handset's own mic, on Speaker it is the phone/laptop mic.
  applyCallMicForOutput(kind, id);
};
const bindStreamToEl = (el, stream) => {
  if (!el) return;
  registerAudioEl(el);
  if (!stream) {
    try {
      if (el.srcObject) { el.pause(); el.srcObject = null; }
      if (el.hasAttribute('src')) { el.removeAttribute('src'); el.load(); }
    } catch { return; }
    return;
  }
  if (el.srcObject !== stream) {
    el.srcObject = stream;
    el.play().catch(() => {});
  }
};
// Real output-device classification. Only the REAL device name decides: a
// recognizable earpiece/headset - or any physically-wired/USB/Type-C/OTG
// dongle device - turns the default route into a 'handset'; a loudspeaker
// (built-in or external speaker label) or anything unrecognized stays a
// 'speaker'. Nothing is ever assumed to be a headset without evidence.
const isLoudspeakerOutputLabel = (s) => /speaker|loudspeaker|built-?in|internal|扬声|扬声器|\bspk\b/i.test(s);
const isHandsetOutputLabel = (s) => !isLoudspeakerOutputLabel(s) &&
  /handset|headset|headphone|earbud|earphone|earpiece|neckband|airpod|air\s*dots|hands-?free|wired|usb|type-?c|otg|dongle|adapter|receiver|蓝牙耳机|耳机/i.test(s);
// Detect the REAL microphone the browser can target: the handset's own mic
// (headset/earpiece/bluetooth/USB-C/OTG input) and the built-in phone/laptop
// mic. Only genuinely enumerated audioinput devices are used; nothing is
// invented. A USB or Type-C hands-free is caught by the generic 'usb' /
// 'type-c' tokens alone, even when the OS labels it just "USB Audio".
const isHandsetMicLabel = (s) => /handset|headset|headphone|earbud|earphone|earpiece|neckband|airpod|air\s*dots|hands-?free|wired|bluetooth|usb|type-?c|otg|dongle|adapter|耳机|蓝牙|蓝牙耳机/i.test(s);
const refreshAudioInputs = async () => refreshAudioOutputs();
// Pick the mic deviceId that matches the chosen output device: handset mode
// -> the handset's own mic (following the system default input, which is the
// plug-in headset's mic while plugged and the device mic otherwise), speaker
// mode -> the identified loudspeaker's sibling mic, else the phone/laptop
// microphone. A no-mic device (bass speaker, plain headphones) naturally
// falls back to the phone/laptop mic because it has no matching audioinput.
const micDeviceIdForOutput = (speakerMode, activeOut) => {
  const { defaultIsHandset, builtinMicId, byGroup } = audioInputsCacheRef.current;
  if (activeOut && activeOut.groupId && byGroup[activeOut.groupId]) return byGroup[activeOut.groupId];
  if (speakerMode) return defaultIsHandset ? builtinMicId : '';
  return ''; // follow the system default input
};
// Swap the live call's microphone to match the output device without
// touching the camera: acquire the target mic, replace it on every active
// peer (1:1 + group mesh) via sender.replaceTrack(), then refresh the shared
// local stream. Falls back to the default mic on any failure.
const applyCallMicForOutput = async (kind, id) => {
  if (!activeCallRef.current) return;
  if (!pcRef.current && Object.keys(groupPeersRef.current).length === 0) return;
  await refreshAudioInputs();
  const speakerMode = kind === 'speaker';
  let activeOut = null;
  if (speakerMode) {
    if (speakerDevRef.current && speakerDevRef.current.deviceId) activeOut = speakerDevRef.current;
  } else if (kind === 'external' && id) {
    const ext = audioOutputsCacheRef.current.external.find((d) => d.deviceId === id);
    if (ext) activeOut = { deviceId: ext.deviceId, groupId: ext.groupId };
  }
  const target = micDeviceIdForOutput(speakerMode, activeOut);
  const constraints = target ? { audio: { deviceId: { exact: target } } } : { audio: true };
  let newTrack;
  try {
    const s = await navigator.mediaDevices.getUserMedia(constraints);
    newTrack = s.getAudioTracks()[0] || null;
  } catch (err) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      newTrack = s.getAudioTracks()[0] || null;
    } catch (err2) { return; }
  }
  if (!newTrack) return;
  const pcs = [];
  if (pcRef.current) pcs.push(pcRef.current);
  Object.keys(groupPeersRef.current).forEach((k) => pcs.push(groupPeersRef.current[k]));
  const senders = pcs.map((pc) => pc.getSenders()).flat().filter((s) => s.track && s.track.kind === 'audio');
  const results = await Promise.all(senders.map((s) => s.replaceTrack(newTrack).catch(() => null)));
  if (senders.length > 0 && results.some((r) => r === null)) { newTrack.stop(); return; }
  const ls = localStreamRef.current;
  if (ls) {
    ls.getAudioTracks().forEach((t) => { ls.removeTrack(t); t.stop(); });
    ls.addTrack(newTrack);
  } else {
    newTrack.stop();
  }
};
const bindRemoteMedia = (el) => bindStreamToEl(el, remoteStreamRef.current);
// Detect the REAL available audio-output devices. The labels come from
// navigator.mediaDevices.enumerateDevices(). No device is ever invented:
// 'Speaker' is surfaced only as a routing target we can actually setSinkId()
// to, and external devices (headsets, earphones, BT) appear only when the
// browser actually enumerates an audiooutput that is not the default.
const refreshAudioOutputs = async () => {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    const clean = (l) => (l || '').replace(/^Default\s*-\s*/i, '').trim();
    const outs = devs.filter((d) => d.kind === 'audiooutput');
    let speakerId = '';
    const external = [];
    let defaultName = '';
    outs.forEach((d) => {
      const label = clean(d.label);
      if (d.deviceId === 'default' || /^Default\s*-/i.test(d.label || '')) {
        if (label) defaultName = label;
      }
      if (!d.deviceId || d.deviceId === 'default' || !label) return;
      if (isLoudspeakerOutputLabel(label)) {
        if (!speakerId) {
          speakerId = d.deviceId;
          speakerDevRef.current = { deviceId: d.deviceId, groupId: d.groupId || '' };
        }
      } else {
        external.push({ deviceId: d.deviceId, label, groupId: d.groupId || '' });
      }
    });
    // Microphone ground truth: the default input IS the handset's own mic when
    // it belongs to a heads-free peripheral (wired/USB/Type-C/OTG/BT dongle),
    // not the device's built-in microphone - so a generic "USB Audio" hands-free
    // is still recognized even though its output label looks unclassified.
    const ins = devs.filter((d) => d.kind === 'audioinput');
    let defaultInputLabel = '';
    let handsetMic = '';
    let builtinMic = '';
    const byGroup = {};
    ins.forEach((d) => {
      const label = clean(d.label);
      if (d.deviceId === 'default' || /^Default\s*-/i.test(d.label || '')) {
        if (label) defaultInputLabel = label;
        return;
      }
      if (d.groupId && !byGroup[d.groupId]) byGroup[d.groupId] = d.deviceId;
      if (isHandsetMicLabel(label)) {
        if (!handsetMic) handsetMic = d.deviceId;
      } else if (label) {
        if (!builtinMic) builtinMic = d.deviceId;
      }
    });
    const defaultIsHandset = !!defaultInputLabel && isHandsetMicLabel(defaultInputLabel);
    audioInputsCacheRef.current = { defaultIsHandset, handsetMicId: handsetMic, builtinMicId: builtinMic, byGroup };
    // Classify the live default route: a handset when the default output is a
    // recognizable earpiece/peripheral OR the default input is the hands-free
    // mic, a speaker otherwise. Never assume a headset without evidence.
    let defaultKind = 'speaker';
    if ((defaultName && isHandsetOutputLabel(defaultName)) || defaultIsHandset) defaultKind = 'handset';
    // On Android the browser only ever shows the ONE system sink and the OS
    // silently re-routes it to whatever is physically connected (earbud,
    // USB-C/OTG headset, loudspeaker). There is no switchable alternate, so no
    // web page can force the loudspeaker while a headset is plugged in.
    const systemRouted = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '') && !speakerId && external.length === 0;
    audioOutputsCacheRef.current = { speakerId, external, defaultName, defaultKind, systemRouted };
    setCallDefaultOut((prev) => {
      if (!defaultName) return prev;
      if (prev.name === defaultName) return prev;
      return { name: defaultName, kind: defaultKind };
    });
  } catch (err) {
    audioOutputsCacheRef.current = { speakerId: '', external: [], defaultName: '', defaultKind: 'speaker', systemRouted: false };
    audioInputsCacheRef.current = { defaultIsHandset: false, handsetMicId: '', builtinMicId: '', byGroup: {} };
  }
};
// When the user plugs in (or switches to) a handset during a live call,
// follow it: route back to the system default ('' so future plug/unplug
// automatically re-follows) and let the icon flip to the handset. Unplugging
// (or switching the system output to a loudspeaker) follows the same route
// back to the loudspeaker with the phone/laptop mic.
useEffect(() => {
  const name = callDefaultOut?.name;
  if (!name) return;
  const prevName = prevDefaultNameRef.current;
  prevDefaultNameRef.current = name;
  if (!prevName) return; // first real detection — nothing to switch away from
  if (callDefaultOut.kind === 'handset') {
    applyAudioOutput('', 'default');
  } else {
    const speakerId = audioOutputsCacheRef.current.speakerId;
    applyAudioOutput(speakerId, 'speaker');
  }
}, [callDefaultOut?.name]);

// Real camera list for the switch-camera control. Built purely from
// navigator.mediaDevices.enumerateDevices(); nothing is invented.
const refreshVideoInputs = async () => {
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') return;
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    videoInputsRef.current = devs
      .filter((d) => d.kind === 'videoinput')
      .map((d) => ({ deviceId: d.deviceId, label: (d.label || '').replace(/^Default\s*-\s*/i, '').trim() }));
  } catch (err) { /* keep the last known list */ }
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
  const peer = avatarSrc(chat.photo, 50);
  callPeerIdRef.current = String(chat.id);
  callIdRef.current = callId;
  // Start media + peer connection immediately (like WhatsApp).
  try {
    const stream = await getMediaStream(type === 'video');
    if (!adoptLocalStream(stream, callId)) return;
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
  try {
    const stream = await getMediaStream(type === 'video');
    if (!adoptLocalStream(stream, callId)) return;
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
    peerPhoto: avatarSrc(group.dp, 50),
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
      if (!adoptLocalStream(stream, call.callId)) { cleanupCall(false); return; }
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
    if (!adoptLocalStream(stream, call.callId)) { cleanupCall(false); return; }
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
  const track = stream?.getVideoTracks()[0];
  if (!track) return;
  const cams = videoInputsRef.current;
  if (cams.length < 2) {
    // One camera only: never stop/replace the working camera.
    showCallNotice('Only one camera is available on this device.');
    return;
  }
  let settings = {};
  try { settings = track.getSettings(); } catch (err) {}
  const currentId = settings.deviceId;
  const other = cams.find((c) => c.deviceId && c.deviceId !== currentId);
  if (other) {
    try {
      // Steer to the other REAL camera device and swap the track the sender
      // publishes, so the remote side sees the change without renegotiation.
      const next = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: other.deviceId } }, audio: false });
      const nextTrack = next.getVideoTracks()[0];
      if (nextTrack) {
        const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) { await sender.replaceTrack(nextTrack).catch(() => {}); }
        stream.removeTrack(track);
        track.stop();
        stream.addTrack(nextTrack);
        const own = ownVideoRef.current;
        if (own) own.srcObject = stream;
        return;
      }
      next.getTracks().forEach((t) => t.stop());
    } catch (err) { /* fall through to constraint-based switch */ }
  }
  try {
    // Devices without a usable deviceId: flip facingMode on the live track.
    const want = settings.facingMode === 'environment' ? 'user' : 'environment';
    await track.applyConstraints({ facingMode: want });
    const own = ownVideoRef.current;
    if (own) own.srcObject = stream;
  } catch (err) {
    showCallNotice('Camera switch is not supported on this device.');
  }
};

// ---------- Voice -> video upgrade (mutual consent) ----------

const videoSwitchInFlight = () => videoSwitchPendingRef.current || !!activeCallRef.current?.videoSwitchPhase;

// User A in an active voice call asks the other side to turn it into video.
// Nothing turns on until the remote user approves.
const requestVideoUpgrade = () => {
  if (!activeCall || activeCall.mode !== 'active' || activeCall.type !== 'voice' || activeCall.group) return;
  if (videoSwitchInFlight() || !callPeerIdRef.current || !callIdRef.current) return;
  socket.emit('call:videoRequest', { to: callPeerIdRef.current, callId: callIdRef.current });
  videoSwitchPendingRef.current = true;
  setActiveCall((prev) => (prev ? { ...prev, videoSwitchPhase: 'waiting' } : prev));
};

// Called on BOTH sides once the other user agreed (or the two requests
// mutually matched). Acquires the camera, publishes the video track through
// the existing peer connection and starts the own preview. Audio continues.
const promoteToVideo = async () => {
  if (!pcRef.current) return;
  const stream = localStreamRef.current;
  if (!stream) return;
  if (stream.getVideoTracks().length > 0) return; // already video -> idempotent
  try {
    const cam = await getMediaStream(true);
    if (!pcRef.current || !callIdRef.current) { cam.getTracks().forEach((t) => t.stop()); return; }
    const vTrack = cam.getVideoTracks()[0];
    if (!vTrack) {
      cam.getTracks().forEach((t) => t.stop());
      showCallNotice('Camera unavailable to start video.');
      return;
    }
    // Keep the existing outgoing audio path; only adopt the camera track.
    cam.getAudioTracks().forEach((t) => t.stop());
    pcRef.current?.addTrack(vTrack, stream);
    stream.addTrack(vTrack);
    localStreamRef.current = stream;
    initLocalVideo();
    videoSwitchPendingRef.current = false;
    setCallNotice('');
    setActiveCall((prev) => (prev ? { ...prev, type: 'video', videoSwitchPhase: undefined } : prev));
    setCallCamOn(true);
    // The side that originally offered must renegotiate so both new video
    // tracks land in ONE offer/answer round-trip. The remote side attaches
    // its track during promote (above) right before this offer arrives.
    if (signalingRoleRef.current === 'offerer') {
      setTimeout(sendOffer, 400);
    }
  } catch (err) {
    showCallNotice('Camera unavailable to start video.');
  }
};

// Receiver of the request approves -> tell the requester, then start video locally.
const acceptVideoSwitch = () => {
  if (!activeCall || activeCall.mode !== 'active' || activeCall.videoSwitchPhase !== 'requested') return;
  socket.emit('call:videoAccept', { to: String(activeCall.peerId), callId: activeCall.callId });
  videoSwitchPendingRef.current = false;
  promoteToVideo();
};

// Receiver declines -> stay in the voice call, requester gets feedback.
const declineVideoSwitch = () => {
  if (!activeCall || activeCall.mode !== 'active' || activeCall.videoSwitchPhase !== 'requested') return;
  socket.emit('call:videoDecline', { to: String(activeCall.peerId), callId: activeCall.callId });
  setActiveCall((prev) => (prev ? { ...prev, videoSwitchPhase: undefined } : prev));
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
    // Pre-block microphone so the accepted call starts cleanly.
    getMediaStream(data.type === 'video').then((stream) => {
      if (adoptLocalStream(stream, data.callId)) {
        if (data.type === 'video') initLocalVideo();
      }
    }).catch(() => {});
    signalingRoleRef.current = 'answerer';
    setActiveCall({
      mode: 'incoming',
      type: data.type,
      callId: data.callId,
      peerId: String(data.from),
      peerName: data.fromName,
      peerPhoto: avatarSrc(data.fromPhoto, 50),
    });
  };

  const onAccepted = (data) => {
    if (!activeCallRef.current || String(activeCallRef.current.callId) !== String(data.callId)) return;
    // Group call: the caller just needs to flip to active; peer wiring happens
    // via call:memberJoined / call:groupJoined as members come in.
    if (activeCallRef.current.group) {
      markCallConnected();
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
    markCallConnected();
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
          const s = await getMediaStream(activeCallRef.current?.type === 'video').catch(() => null);
          if (!adoptLocalStream(s, data.callId)) return;
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
        const s = await getMediaStream(activeCallRef.current?.type === 'video').catch(() => null);
        if (!adoptLocalStream(s, data.callId)) return;
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
    getMediaStream(data.type === 'video').then((stream) => {
      if (adoptLocalStream(stream, data.callId)) {
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
      peerPhoto: avatarSrc(data.fromPhoto, 50),
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

  // ---- Voice -> video upgrade (consent relayed by the server) ----
  const onVideoRequest = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    if (!activeCallRef.current || activeCallRef.current.mode !== 'active' || activeCallRef.current.type !== 'voice' || activeCallRef.current.group) return;
    // Both users pressed Switch at the same time -> treat it as mutual consent.
    if (videoSwitchPendingRef.current || activeCallRef.current.videoSwitchPhase === 'waiting') {
      s.emit('call:videoAccept', { to: data.from, callId: data.callId });
      promoteToVideo();
      return;
    }
    if (activeCallRef.current.videoSwitchPhase === 'requested') return; // duplicate dialog
    setActiveCall((prev) => (prev ? { ...prev, videoSwitchPhase: 'requested' } : prev));
  };

  const onVideoAccept = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    videoSwitchPendingRef.current = false;
    setCallNotice('');
    promoteToVideo();
  };

  const onVideoDecline = (data) => {
    if (String(data.callId) !== String(callIdRef.current)) return;
    videoSwitchPendingRef.current = false;
    const peer = activeCallRef.current;
    const who = peer && peer.peerId ? nameOf(peer.peerId, peer.peerName) : 'The other person';
    showCallNotice(`${who} declined the video call request.`);
    setActiveCall((prev) => (prev ? { ...prev, videoSwitchPhase: undefined } : prev));
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
  s.on('call:videoRequest', onVideoRequest);
  s.on('call:videoAccept', onVideoAccept);
  s.on('call:videoDecline', onVideoDecline);
  s.on('call:historyUpdated', loadCalls);
  s.on('call:groupIncoming', onGroupIncoming);
  s.on('call:groupJoined', onGroupJoined);
  s.on('call:memberJoined', onMemberJoined);
  s.on('call:memberLeft', onMemberLeft);
  // Reconnect: a missed call that arrived while disconnected is persisted on
  // the server; reload it so the contact list preview + badge recover without
  // requiring a page refresh.
  s.on('connect', loadCalls);
  s.on('user:profileUpdated', () => { setProfileRefreshTick((t) => t + 1); loadStatusFeed(); });

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
    s.off('call:videoRequest', onVideoRequest);
    s.off('call:videoAccept', onVideoAccept);
    s.off('call:videoDecline', onVideoDecline);
    s.off('call:historyUpdated', loadCalls);
    s.off('call:groupIncoming', onGroupIncoming);
    s.off('call:groupJoined', onGroupJoined);
    s.off('call:memberJoined', onMemberJoined);
    s.off('call:memberLeft', onMemberLeft);
    s.off('connect', loadCalls);
    s.off('user:profileUpdated');
  };
}, [socket]);

useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);

useEffect(() => {
  if (activeTab === 'profile') {
    // The Profile tab always lands directly on the editable profile page —
    // there is no intermediate preview page anymore.
    setProfileRoute('page');
    setProfilePhotoMenu(false);
  }
}, [activeTab, isMobile]);

// One elapsed-time interval per connected call. Created exactly when a call
// goes active (keyed by callId + mode + type), cleared when it ends. The tick
// only writes 'elapsed' (derived from the connected timestamp), so muting,
// camera toggles, camera switching and speaker changes never stall or reset
// it, and re-renders leave it alone. cleanupCall's clearInterval is a safety
// net for paths that end a call without changing the effect deps.
useEffect(() => {
  if (!activeCall || activeCall.mode !== 'active' || !callStartAtRef.current) return;
  if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; }
  callTimerRef.current = setInterval(() => {
    setActiveCall((prev) => (prev && prev.mode === 'active' ? { ...prev, elapsed: (Date.now() - callStartAtRef.current) / 1000 } : prev));
  }, 1000);
  return () => { if (callTimerRef.current) { clearInterval(callTimerRef.current); callTimerRef.current = null; } };
}, [activeCall?.callId, activeCall?.mode, activeCall?.type]);





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
  const saved = readChatMessages();
  console.log('📁 Messages on load:', saved ? Object.keys(saved) : 'none');
}, []);

  // Auto-scroll to the latest message for the open DM — always when the chat
  // was just opened; otherwise only when the user is already at the bottom so
  // an incoming message never yanks them away from older messages (the
  // new-message indicator covers the scrolled-up case).
useEffect(() => {
  const id = selectedChat ? String(selectedChat.id) : null;
  const switched = lastDmChatRef.current !== id;
  lastDmChatRef.current = id;
  // Anchoring helpers: while the chat is freshly open (or was just opened),
  // keep aiming at the latest message while async server history and media
  // (images/videos/documents) arrive/decode after the first paint and grow the
  // scroll height, which would otherwise strand the view mid-chat (e.g. right
  // where a photo just expanded). Stop re-anchoring once the layout has stayed
  // unchanged well past the last media load, the settle window elapses, or the
  // user deliberately scrolls away — a scroll gesture (wheel/touch), which
  // programmatic rides and re-renders never fire. Gesture-based detection
  // avoids the false abandonment triggered by scroll-position analysis, since
  // remounts and history merges can reset scrollTop to 0 on their own.
  const bindDmAbort = () => {
    const sc = messagesScrollRef.current;
    if (!sc) return;
    const existing = dmAbortRef.current;
    if (existing) {
      // The container may have been remounted since the listeners were bound;
      // rebind on the live node so a user gesture is still recognised.
      if (existing.container === sc) return;
      unbindDmAbort();
    }
    const handler = () => {
      dmStayBottomRef.current = false;
      cancelAnimationFrame(dmRafRef.current);
      const b = dmAbortRef.current;
      if (b) {
        b.container.removeEventListener('wheel', b.handler);
        b.container.removeEventListener('touchmove', b.handler);
        dmAbortRef.current = null;
      }
    };
    sc.addEventListener('wheel', handler, { passive: true });
    sc.addEventListener('touchmove', handler, { passive: true });
    dmAbortRef.current = { container: sc, handler };
  };
  const unbindDmAbort = () => {
    const b = dmAbortRef.current;
    if (b) {
      b.container.removeEventListener('wheel', b.handler);
      b.container.removeEventListener('touchmove', b.handler);
      dmAbortRef.current = null;
    }
  };
  const armDmBottom = () => {
    dmStayBottomRef.current = true;
    bindDmAbort();
  };
  const disarmDmBottom = () => {
    dmStayBottomRef.current = false;
    unbindDmAbort();
  };
  if (!id) {
    disarmDmBottom();
    return;
  }
  const end = messagesEndRef.current;
  const scroller = messagesScrollRef.current;
  if (!end || !scroller) return;
  // Consume a scroll request that was explicitly set by one of my own send
  // handlers (text, photo, file, voice). Only the actual send action sets this
  // flag — incoming messages and state restores never do — so this is the only
  // DM case where sending while scrolled up rides the view to the latest
  // message.
  const sent = dmScrollOnSendRef.current;
  dmScrollOnSendRef.current = false;
  if (sent) {
    dmOpenAtRef.current = Date.now();
    armDmBottom();
  } else if (switched) {
    dmOpenAtRef.current = Date.now();
    armDmBottom();
  } else if (Date.now() - dmHistoryMergeAtRef.current < 4000 &&
             Date.now() - dmOpenAtRef.current < 10000) {
    // Fresh server history for the open conversation just landed: re-anchor so
    // the view settles on the (possibly extended) latest message instead of
    // the old end. Plain incoming messages never re-activate this.
    dmHistoryMergeAtRef.current = 0;
    armDmBottom();
  }
  if (sent || switched || isAtChatBottom(scroller)) {
    end.scrollIntoView({ behavior: 'instant' });
  }
  // When the chat was just opened, keep aiming at the latest message while the
  // conversation finishes rendering: async server history and media
  // (images/videos/documents) arrive/decode after the first paint and grow the
  // scroll height, which would otherwise strand the view mid-chat (e.g. right
  // where a photo just expanded). Stop re-anchoring once the layout has stayed
  // unchanged well past the last media load, or the settle window elapses, or
  // the user deliberately scrolls away (a scroll gesture — wheel/touch — which
  // programmatic rides and re-renders never fire).
  if (!dmStayBottomRef.current) return;
  cancelAnimationFrame(dmRafRef.current);
  let lastHeight = -1;
  let stableMs = 0;
  let lastTs = 0;
  const tick = (ts) => {
    const e = messagesEndRef.current;
    const sc = messagesScrollRef.current;
    if (!e || !sc) { disarmDmBottom(); return; }
    if (!dmStayBottomRef.current) return;
    if (Date.now() - dmOpenAtRef.current > 10000) {
      disarmDmBottom();
      return;
    }
    const h = sc.scrollHeight;
    const pendingMedia = dmHasPendingMedia(sc);
    const dt = lastTs ? ts - lastTs : 16;
    lastTs = ts;
    if (h === lastHeight && !pendingMedia) {
      stableMs += dt;
    } else {
      stableMs = 0;
      lastHeight = h;
    }
    if (stableMs >= 1500) {
      // The conversation has stayed at the same height well after its last
      // media finished loading — it is fully settled. Stop anchoring and
      // leave the user wherever they are now.
      disarmDmBottom();
      return;
    }
    e.scrollIntoView({ behavior: 'instant' });
    dmRafRef.current = requestAnimationFrame(tick);
  };
  dmRafRef.current = requestAnimationFrame(tick);
}, [selectedChat, messages]);

  // A media element is still shifting the layout if an image has not finished
  // decoding or a video has not loaded its metadata yet. For images,
  // `complete`/`naturalWidth` alone are not enough: before the decoded pixels
  // arrive the browser lays them out at the default 300x150 box, then reflows
  // them to their real aspect ratio (≤300px tall). That reflow is exactly what
  // grows the conversation height late, so we treat an image as pending until
  // its on-screen ratio matches its natural ratio (up to rounding noise).
  const dmHasPendingMedia = (cont) => {
    const imgs = cont.querySelectorAll('img');
    for (const im of imgs) {
      if (!im.complete || !im.naturalWidth || !im.naturalHeight) return true;
      if (!im.clientWidth || !im.clientHeight) return true;
      const drift = Math.abs(im.clientWidth * im.naturalHeight - im.clientHeight * im.naturalWidth);
      if (drift > (im.naturalWidth + im.naturalHeight) * 0.02) return true;
    }
    const vids = cont.querySelectorAll('video');
    for (const vd of vids) if (vd.readyState < 1) return true;
    return false;
  };

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

// Someone blocked/unblocked us -> update the "users who blocked me" set and
// refresh contacts/profile so the blocked party's photo/About immediately
// turn into the anonymous silhouette + hidden About.
newSocket.on('user:blocked', ({ by, target, blocked }) => {
  const myId = userRef.current?.id;
  if (target && String(target) === String(myId)) {
    // A contact blocked (or unblocked) me.
    setBlockedMeSet(prev => {
      const next = new Set(prev);
      if (blocked) next.add(String(by));
      else next.delete(String(by));
      return next;
    });
  } else if (by && String(by) === String(myId)) {
    // I blocked/unblocked someone on another of my devices.
    setBlockedByMeSet(prev => {
      const next = new Set(prev);
      if (blocked) next.add(String(target));
      else next.delete(String(target));
      return next;
    });
  }
  setProfileRefreshTick(t => t + 1);
});

// Server rejected a message due to an active block — mark the optimistic
// message as failed (single tick stays, and the user is informed).
newSocket.on('messageBlocked', ({ to }) => {
  console.warn('🚫 Message blocked by server for', to);
});

// ✅ 1:1 conversation history (server-authoritative) — lets every device of
//    the same account rebuild identical conversation state on connect/open.
newSocket.on('messagesHistory', ({ chatId, messages }) => {
  const cid = String(chatId);
  if (!Array.isArray(messages)) return;
  setMessages(prev => {
    let existing = prev[cid] || [];
    healReplyTo(existing);
    let fresh = messages.map(m => ({
      id: m._id?.toString() || m.messageId || `dm-${m.timestamp}`,
      localId: m.messageId || null,
      text: m.message,
      sender: String(m.from) === user.id ? 'You' : (m.fromName || 'Someone'),
      senderId: String(m.from),
      timestamp: m.timestamp || Date.now(),
      file: m.file,
      fileName: m.fileName,
      fileType: m.fileType,
      duration: m.duration,
      replyTo: m.replyTo ? {
        sender: m.replyTo.sender,
        text: m.replyTo.text,
        messageId: m.replyTo.messageId,
        senderId: m.replyTo.senderId,
        statusId: m.replyTo.statusId,
        statusType: m.replyTo.statusType,
      } : null,
      photo: m.fromPhoto || 'https://placehold.co/50x50',
      delivered: m.delivered,
      read: !!m.read,
      isForwarded: !!m.isForwarded,
    }));
    healReplyTo(fresh);
    // Respect this user's persisted "Clear chat" point: history older than it
    // never comes back on a refresh (the server keeps the messages for the
    // other member, so new ones received after clearing still appear).
    const dmClearedTs = dmClearedAt(cid);
    if (dmClearedTs) {
      if (existing.length) existing = existing.filter(m => (m.timestamp || 0) > dmClearedTs);
      if (fresh.length) fresh = fresh.filter(m => (m.timestamp || 0) > dmClearedTs);
    }
    // Merge: server copies (fresh) win over local copies with the same id/localId.
    const seen = new Map();
    existing.forEach(m => seen.set(m.localId || m.id, m));
    fresh.forEach(m => seen.set(m.localId || m.id, m));
    const ordered = [...seen.values()].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    const sameList = existing.length === ordered.length &&
      existing.map(m => m.localId || m.id).join('|') === ordered.map(m => m.localId || m.id).join('|');
    if (!sameList && ordered.length > existing.length) {
      // The server copy extended this conversation with messages the local
      // state did not have. If the chat is open, re-anchor to the (newer)
      // latest message. No-op merges and same-sized replacement copies (e.g.
      // optimistic send → server ids, delivery/read flips) must NOT re-anchor,
      // or incoming messages would yank a scrolled-up user back to the bottom.
      dmHistoryMergeAtRef.current = Date.now();
    }
    if (sameList) return prev;
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

  if (data.isOnline) onlineUsersRef.current.add(targetId);
  else onlineUsersRef.current.delete(targetId);

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
  onlineUsersRef.current = new Set(snapshot.map(s => String(s.userId)));
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
  const displayName = isOwn ? "You" : data.fromName || "Someone";
  if (!chatKey) return;

  // A live message older than this user's clearing point (persisted "Clear
  // chat") must not resurrect itself into the cleared conversation.
  if (dmClearedAt(chatKey) && (data.timestamp || 0) <= dmClearedAt(chatKey)) return;

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
        replyTo: sanitizeReplyTo(data.replyTo),
        photo: data.fromPhoto || 'https://placehold.co/50x50',
        isForwarded: !!data.isForwarded,
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
      senderId,
      timestamp: data.timestamp || Date.now(),
      file: data.file,
      fileName: data.fileName,
      fileType: data.fileType,
      duration: data.duration,
      replyTo: sanitizeReplyTo(data.replyTo),
      photo: data.fromPhoto || 'https://placehold.co/50x50',
      isForwarded: !!data.isForwarded,
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
        const next = prev.map(c =>
          String(c.id) === senderId
            ? { ...c, lastMsg: data.message || replyFileLabel(data) || data.fileName || '', time: data.timestamp, online: true }
            : c
        );
        contactsRef.current = next;
        return next;
      }
      const newContact = {
        id: senderId,
        name: data.fromName || senderId,
        photo: data.fromPhoto || 'https://placehold.co/50x50',

        lastMsg: data.message,
        time: data.timestamp,
        online: true
      };
      const updated = [newContact, ...prev];
      contactsRef.current = updated;
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
          const base = {
            id: group._id,
            name: group.name,
            dp: group.dp,
            memberCount: (group.members?.length || 0),
            lastMsg: `${group.members?.length || 0} members`,
            members: group.members || [],
            admins: (group.admins || []).map(String),
            admin: group.admin?._id || group.admin,
            addMembers: group.addMembers || 'everyone',
            sendMessages: group.sendMessages || 'everyone',
          };
          const existing = exists ? prev.map(g => String(g.id) === String(group._id) ? base : g) : [base, ...prev];
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

      // A member was removed by an admin. Received by the REMAINING members
      // (including the admin who removed them — each sees their own wording).
      newSocket.on('groupMemberRemoved', (data) => {
        const gid = String(data.groupId);
        appendGroupSystemMsg(gid, data.systemMessage);
        applyGroupSnapshot(gid, data.group);
        setGroupsList(prev => prev.map(g =>
          String(g.id) === gid
            ? { ...g, lastMsg: groupEventLabel(data.systemMessage), lastTime: data.systemMessage?.timestamp || Date.now() }
            : g
        ));
        // If that member's profile drawer is open, close it.
        if (memberProfile && String(memberProfile.id) === String(data.memberId)) setMemberProfile(null);
      });

      // Received by the member who was just removed: keep the group openable
      // (they can still read history) but lock it down — no new updates, no
      // sending. The input area shows a hardcoded lock message.
      newSocket.on('groupRemovedYou', (data) => {
        const gid = String(data.groupId);
        const removedFlag = {
          removedAt: Date.now(),
          removedBy: String(data.by || ''),
          removedByName: data.byName || '',
        };
        setGroupsList(prev => prev.map(g =>
          String(g.id) === gid
            ? { ...g, ...removedFlag, admins: data.group?.admins || g.admins || [], lastMsg: groupEventLabel(data.systemMessage), lastTime: data.systemMessage?.timestamp || Date.now() }
            : g
        ));
        setSelectedGroup(prev => {
          if (!prev || String(prev.id) !== gid) return prev;
          return { ...prev, ...removedFlag };
        });
        appendGroupSystemMsg(gid, data.systemMessage);
        setShowGroupInfo(false);
        closeMemberMenu();
      });

      // A member was promoted to admin. Received by all members.
      newSocket.on('groupMemberMadeAdmin', (data) => {
        const gid = String(data.groupId);
        appendGroupSystemMsg(gid, data.systemMessage);
        applyGroupSnapshot(gid, data.group);
        setGroupsList(prev => prev.map(g =>
          String(g.id) === gid
            ? { ...g, lastMsg: groupEventLabel(data.systemMessage), lastTime: data.systemMessage?.timestamp || Date.now() }
            : g
        ));
      });

      // An admin was demoted by the creator. Received by every member (the
      // demoted member individually gets the "removed you" wording).
      newSocket.on('groupMemberDemoted', (data) => {
        const gid = String(data.groupId);
        appendGroupSystemMsg(gid, data.systemMessage);
        applyGroupSnapshot(gid, data.group);
        setGroupsList(prev => prev.map(g =>
          String(g.id) === gid
            ? { ...g, lastMsg: groupEventLabel(data.systemMessage), lastTime: data.systemMessage?.timestamp || Date.now() }
            : g
        ));
      });

      // New members were added. Received by every existing member: the fresh
      // snapshot (list + permissions) and one "X added Y" entry per person.
      newSocket.on('groupMemberAdded', (data) => {
        const gid = String(data.groupId);
        (data.systemMessages || []).forEach((sys) => appendGroupSystemMsg(gid, sys));
        applyGroupSnapshot(gid, data.group);
        setGroupsList(prev => prev.map(g =>
          String(g.id) === gid
            ? { ...g, lastMsg: groupEventLabel((data.systemMessages || [])[0] || data.systemMessage), lastTime: (data.systemMessages || [])[0]?.timestamp || Date.now() }
            : g
        ));
      });

      // A member left. Remaining members see the updated snapshot and a
      // "X left" history entry.
      newSocket.on('groupMemberLeft', (data) => {
        const gid = String(data.groupId);
        appendGroupSystemMsg(gid, data.systemMessage);
        applyGroupSnapshot(gid, data.group);
        setGroupsList(prev => prev.map(g =>
          String(g.id) === gid
            ? { ...g, lastMsg: groupEventLabel(data.systemMessage), lastTime: data.systemMessage?.timestamp || Date.now() }
            : g
        ));
      });

      // A member left of their own accord (received by that same member). Same
      // treatment as an admin removal: keep the group openable but locked, no
      // further updates or sending.
      newSocket.on('groupLeftYou', (data) => {
        const gid = String(data.groupId);
        const leftFlag = {
          removedAt: Date.now(),
          removedBy: String(data.by || ''),
          removedByName: data.byName || '',
        };
        setGroupsList(prev => prev.map(g =>
          String(g.id) === gid
            ? { ...g, ...leftFlag, admins: data.group?.admins || g.admins || [], lastMsg: groupEventLabel(data.systemMessage), lastTime: data.systemMessage?.timestamp || Date.now() }
            : g
        ));
        setSelectedGroup(prev => {
          if (!prev || String(prev.id) !== gid) return prev;
          return { ...prev, ...leftFlag, admins: data.group?.admins || prev.admins || [] };
        });
        appendGroupSystemMsg(gid, data.systemMessage);
        setShowGroupInfo(false);
        setAddMembersOpen(false);
        setGroupSettingsOpen(false);
        setGroupDpMenuOpen(false);
        closeMemberMenu();
      });

      // Server rejected a leave attempt (sole admin). Show the info popup so
      // the user knows why they can't leave.
      newSocket.on('groupLeaveRejected', (data) => {
        if (data?.reason === 'soleAdmin') {
          const gid = String(data.groupId || '');
          const g = groupsListRef.current?.find((x) => String(x.id) === gid);
          setSoleAdminWarning({ name: g?.name || 'this group' });
        }
      });

      // Group permissions/photo changed by an admin (every member receives the
      // updated snapshot + a "changed the group info" history entry).
      newSocket.on('groupInfoUpdated', (data) => {
        const gid = String(data.groupId);
        appendGroupSystemMsg(gid, data.systemMessage);
        applyGroupSnapshot(gid, data.group);
        // Server confirmed the last permission toggle (or rolled us back).
        // Release the row lock + spinner so the buttons un-blur and re-enable
        // on whichever value the server ended up with.
        setPendingGroupSettings(new Set());
        setGroupsList(prev => prev.map(g =>
          String(g.id) === gid
            ? { ...g, lastMsg: groupEventLabel(data.systemMessage), lastTime: data.systemMessage?.timestamp || Date.now() }
            : g
        ));
      });

      // The server rejected a message/action attempt (non-member after being
      // removed, or the "admins only" setting changed mid-session). Surface the
      // server-provided reason.
      newSocket.on('groupSendRestricted', (data) => {
        const reason =
          data && (data.message
            || (data.reason === 'admins_only'
              ? 'Only admins can send messages'
              : data.reason === 'not_member'
                ? 'You are no longer a participant of this group'
                : null));
        if (reason) alert(reason);
      });

      // ✅ Receive a group message
      newSocket.on('receiveGroupMessage', (data) => {
        const gid = String(data.groupId);
        const senderId = String(data.from);
        const displayName = senderId === user.id ? 'You' : data.fromName || 'Someone';
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
          // A message older than this user's clearing point (persisted "Clear
          // chat") must not resurrect itself into the cleared conversation.
          const clearedTs = groupClearedAt(gid);
          if (clearedTs && (data.timestamp || 0) <= clearedTs) return prev;
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
              replyTo: sanitizeReplyTo(data.replyTo),
              photo: data.fromPhoto || 'https://placehold.co/50x50',
              isForwarded: !!data.isForwarded,
              isSystem: !!data.isSystem,
              systemType: data.systemType || null,
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
          : nameOf(senderId, displayName);
        const previewText = data.file
          ? (data.fileType?.startsWith('image/') ? '[Photo]'
            : data.fileType?.startsWith('video/') ? 'Video'
            : (data.duration || data.fileType?.startsWith('audio/') || data.fileType?.includes('ogg')) ? 'Voice message'
            : '[File]')
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
        let existing = prev[gid] || [];
        healReplyTo(existing);
        let fresh = messages.map(m => ({
          id: m._id?.toString() || m.messageId || `g-${Date.now()}-${Math.random()}`,
          text: m.message,
          sender: String(m.from) === user.id ? 'You' : m.fromName || 'Someone',
          senderId: String(m.from),
          timestamp: m.timestamp || Date.now(),
          file: m.file,
          fileName: m.fileName,
          fileType: m.fileType,
          duration: m.duration,
          replyTo: sanitizeReplyTo(m.replyTo),
          photo: m.fromPhoto || 'https://placehold.co/50x50',
          delivered: !!m.allDelivered,
          // On load, MY OWN messages show ✓ or ✓✓ per the server's per-member
          // delivery receipts — a message stays single-tick until every OTHER
          // member's device has received it (WhatsApp-style). Received messages
          // don't show ticks anyway.
          read: String(m.from) !== user.id,
          allRead: !!m.allRead,
          readBy: m.readBy || [],
          isForwarded: !!m.isForwarded,
          isSystem: !!m.isSystem,
          systemType: m.systemType || null,
          target: m.target ? String(m.target) : null,
          targetName: m.targetName || '',
        }));
        healReplyTo(fresh);
        // Respect this user's persisted "Clear chat" point: history older than
        // it never comes back on a refresh (the server keeps the messages for
        // other members, so new ones received after clearing still appear).
        const clearedTs = groupClearedAt(gid);
        if (clearedTs) {
          if (existing.length) existing = existing.filter(m => (m.timestamp || 0) > clearedTs);
          if (fresh.length) fresh = fresh.filter(m => (m.timestamp || 0) > clearedTs);
        }
        const merged = [...existing, ...fresh];
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
        // Remember the clearing point on THIS device too (even for a remote
        // clear-for-everyone) so the chats-list row drops its old preview/date
        // instead of showing the last pre-clear message + timestamp.
        if (to !== undefined && to !== null) persistDmCleared(String(to), Date.now());
      });

      // ✅ 1:1 chat deleted on ANY of this user's devices: drop the contact
      //    from the chat list + caches, close it if open, then self-heal with
      //    a refreshed address book (also covers deletions made while offline).
      newSocket.on('chatDeleted', ({ to }) => {
        console.info('[nexchat] chatDeleted received', to);
        applyChatDeleted(to);
        fetchContacts();
      });

      // ✅ group deleted on ANY of this user's devices (after exiting it):
      //    drop it from the groups list + caches and close it if open.
      newSocket.on('groupChatDeleted', ({ groupId }) => {
        console.info('[nexchat] groupChatDeleted received', groupId);
        applyGroupDeleted(groupId);
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
        // Record the clearing point for THIS user so a refresh doesn't restore
        // the older history (only their own view is affected).
        if (forMe === true) persistGroupCleared(gid, Date.now());
        setGroupMessages(prev => ({ ...prev, [gid]: [] }));
      });

      // ✅ Status posted by anyone I am in contact with (including my own
      //    other devices) — refresh the status feed.
      newSocket.on('statusPosted', () => loadStatusFeedRef.current());
      newSocket.on('statusDeleted', () => loadStatusFeedRef.current());

    return () => {
    newSocket.disconnect();
   };
    }, [user.id, navigate, groupEventLabel, applyChatDeleted, fetchContacts]);   
  
  
  

        // ✅ Fetch my groups from the backend on load
        useEffect(() => {
          const token = localStorage.getItem('token');
          if (!token) {
            setLastGroupsCount(0);
            return;
          }
          // user.id is set by a separate session effect shortly after first
          // render. Do NOT mark the groups as empty/loaded while it's missing —
          // return and let the [user.id] dep re-run this effect for real, so
          // the buffering spinner stays up until the list actually arrives.
          if (!user.id) return;
          // The loading spinner must stay up until the groups ACTUALLY come
          // back (a failed/empty response must not end the spinner early while
          // the contact list is already rendered). Retry a few times on error,
          // and only mark groups as ready once a valid list — even an empty one —
          // arrives, or after the retries give up.
          let cancelled = false;
          let attempt = 0;
          const loadGroups = async () => {
            if (cancelled) return;
            try {
              const res = await fetch(`${API_URL}/api/groups`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              const data = await res.json().catch(() => null);
              if (cancelled) return;
              if (res.ok && data && Array.isArray(data.groups)) {
                console.info('[nexchat] groups loaded', data.groups.length, `(attempt ${attempt + 1}, status ${res.status})`);
                setLastGroupsCount(data.groups.length);
                setGroupsList(prev => {
                  const map = new Map();
                  prev.forEach(g => map.set(String(g.id), g));
                  data.groups.forEach(g => map.set(String(g._id), {
                    id: g._id,
                    name: g.name,
                    dp: g.dp,
                    memberCount: (g.members?.length || 0),
                    lastMsg: g.lastMessage
                      ? (g.lastMessage.isSystem
                          ? groupEventLabel({
                              from: String(g.lastMessage.from),
                              fromName: g.lastMessage.fromName,
                              target: g.lastMessage.target ? String(g.lastMessage.target) : null,
                              targetName: g.lastMessage.targetName || '',
                              systemType: g.lastMessage.systemType || '',
                              message: g.lastMessage.text || '',
                            })
                          : (String(g.lastMessage.from) === String(user.id)
                              ? 'You: '
                              : (nameOf(g.lastMessage.from, g.lastMessage.fromName) + ': ')) +
                              (g.lastMessage.file
                                ? (g.lastMessage.fileType?.startsWith('image/') ? '[Photo]' : g.lastMessage.fileType?.startsWith('audio/') ? '🎤 Voice message' : '[File]')
                                : (g.lastMessage.text || '')))
                      : `${g.members?.length || 0} members`,
                    lastTime: g.lastMessage?.timestamp || null,
                    lastMessage: g.lastMessage || null,
                    members: g.members || [],
                    admins: (g.admins || []).map(String),
                    admin: g.admin?._id || g.admin,
                    addMembers: g.addMembers || 'everyone',
                    sendMessages: g.sendMessages || 'everyone',
                    removedAt: g.removedAt || null,
                    removedBy: g.removedBy || null,
                    removedByName: g.removedByName || '',
                  }));
                  return [...map.values()];
                });
                setLastGroupsCount(data.groups.length);
                return;
              }
              throw new Error(`groups request failed: ${res.status}`);
            } catch (err) {
              console.error('Failed to fetch groups', err);
              attempt += 1;
              if (attempt < 4 && !cancelled) {
                setTimeout(loadGroups, 1500 * attempt);
              } else {
                setLastGroupsCount(0);
              }
            }
          };
          loadGroups();
          return () => {
            cancelled = true;
          };
        }, [user.id, profileRefreshTick, groupEventLabel]);

        // ✅ Load/sync this user's private address book from the server
        //    (per-account). Refetches on mount and whenever a profile update
        //    bumps profileRefreshTick, self-healing chats deleted on other
        //    devices (contacts that dropped off the server list).
        useEffect(() => {
          fetchContacts();
        }, [fetchContacts, profileRefreshTick]);

        // On (re)connect, re-pull the address book so deletions that happened
        // while this device was offline get applied here too.
        useEffect(() => {
          if (!socket) return;
          const onConnect = () => fetchContacts();
          socket.on('connect', onConnect);
          if (socket.connected) fetchContacts();
          return () => socket.off('connect', onConnect);
        }, [socket, fetchContacts]);

        // Keep every device of this account agreeing with the server: poll
        // periodically and on window focus/visibility, so a chat deleted on
        // another device disappears here even if the realtime event is missed
        // and the device never reconnects. The reconcile inside fetchContacts
        // only ever removes ids the server no longer lists, so this is safe.
        useEffect(() => {
          const poll = () => { if (document.visibilityState === 'visible') fetchContacts(); };
          const onFocus = () => fetchContacts();
          const onVis = () => { if (document.visibilityState === 'visible') fetchContacts(); };
          const id = setInterval(poll, 20000);
          window.addEventListener('focus', onFocus);
          document.addEventListener('visibilitychange', onVis);
          return () => {
            clearInterval(id);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVis);
          };
        }, [fetchContacts]);

        // When the Contact Info panel opens, pull the target user's latest
        // profile (name/photo/about) from the database so the About line is
        // never stale or hardcoded. Refetches when user:profileUpdated arrives
        // (profileRefreshTick) so an open panel reflects live changes.
        useEffect(() => {
          if (!showContactInfo || !selectedChat?.id) {
            setContactInfoProfile(null);
            return;
          }
          const tk = localStorage.getItem('token');
          if (!tk) return;
          let cancelled = false;
          (async () => {
            try {
              const res = await fetch(`${API_URL}/api/profile/${encodeURIComponent(selectedChat.id)}`, {
                headers: { Authorization: `Bearer ${tk}` },
              });
              const data = await res.json();
              if (!cancelled && data?.user) setContactInfoProfile(data.user);
            } catch (err) {
              console.error('Failed to load contact profile', err);
            }
          })();
          return () => { cancelled = true; };
        }, [showContactInfo, selectedChat?.id, profileRefreshTick]);

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

        // Save whenever chat changes. Persist a PRUNED copy (only the fields a
        // restore needs) and swallow quota errors: the message cache fills
        // localStorage on busy accounts, and an uncaught QuotaExceededError
        // from this write shows the "Error in DashboardPage" screen when a
        // specific chat is opened.
        useEffect(() => {
          if (!selectedChat?.id) return;
          try {
            localStorage.setItem(
              accountScopedKey('selectedChat'),
              JSON.stringify({
                id: selectedChat.id,
                type: selectedChat.type || 'dm',
                name: selectedChat.name,
                email: selectedChat.email,
                about: typeof selectedChat.about === 'string' && selectedChat.about.length > 500
                  ? selectedChat.about.slice(0, 500)
                  : selectedChat.about,
                photo: (typeof selectedChat.photo === 'string' && selectedChat.photo.startsWith('data:'))
                  ? null
                  : selectedChat.photo,
                firstName: selectedChat.firstName,
                lastName: selectedChat.lastName,
                lastMsg: typeof selectedChat.lastMsg === 'string' && selectedChat.lastMsg.length > 200
                  ? selectedChat.lastMsg.slice(0, 200)
                  : (selectedChat.lastMsg || ''),
                time: selectedChat.time,
                online: !!selectedChat.online,
                lastSeen: selectedChat.lastSeen,
              })
            );
          } catch (err) {
            console.warn('Failed to persist selectedChat', err);
          }
        }, [selectedChat]);

        // Mirror of the DM persistence above, but for an open group so a refresh
        // inside a group restores the SAME group (same approach private chats
        // already use). Stores a pruned copy of the normalized group object.
        useEffect(() => {
          if (!selectedGroup?.id) return;
          try {
            localStorage.setItem(
              accountScopedKey('selectedGroup'),
              JSON.stringify({
                id: selectedGroup.id,
                name: selectedGroup.name,
                dp: (typeof selectedGroup.dp === 'string' && selectedGroup.dp.startsWith('data:'))
                  ? null
                  : selectedGroup.dp,
                memberCount: selectedGroup.memberCount || (selectedGroup.members?.length || 0),
                admins: Array.isArray(selectedGroup.admins) ? selectedGroup.admins.map(String) : [],
                admin: selectedGroup.admin,
                adminName: selectedGroup.adminName || null,
                addMembers: selectedGroup.addMembers || 'everyone',
                sendMessages: selectedGroup.sendMessages || 'everyone',
                removedAt: selectedGroup.removedAt || null,
                removedBy: selectedGroup.removedBy || null,
                removedByName: selectedGroup.removedByName || '',
              })
            );
          } catch (err) {
            console.warn('Failed to persist selectedGroup', err);
          }
        }, [selectedGroup]);

        // Track whether a chat is ACTUALLY open (set) vs the user sitting on the
        // Chats list. Only a genuinely open chat should be restored on refresh —
        // closing a chat (or navigating to another section) must NOT make it come
        // back, even though a stale 'selectedChat' value may linger in storage.
        // Skip the very first run: on page load selectedChat is still (null, not
        // yet restored) while dataReady hasn't happened, so writing here would
        // clobber the flag from before the refresh before restore can read it.
        const chatOpenFirstRunRef = useRef(true);
        useEffect(() => {
          if (chatOpenFirstRunRef.current) {
            chatOpenFirstRunRef.current = false;
            return;
          }
          const chatOpen = !!(selectedChat?.id || selectedGroup?.id);
          try { localStorage.setItem(accountScopedKey('dashboardChatOpen'), chatOpen ? 'true' : 'false'); } catch { console.warn('Failed to persist chat-open state'); }
        }, [selectedChat?.id, selectedGroup?.id]);

        // Restore the previous chat ONLY if, at page load, a chat was genuinely
        // open (dashboardChatOpen 'true'), the user was on the Chats or Groups
        // section (activeTab 'chats'/'groups' on desktop, view 'chats'/'groups'
        // on mobile), AND that person/group still exists in this account's
        // contact list or groups (prevents ghost chats after a refresh). Both
        // private chats AND groups are restored this way (groups used to be
        // lost on refresh). If the user was on Status, Calls, etc., or just
        // browsing the list, do NOT reopen a chat. The section was already
        // restored from localStorage by the useState initializers, so this reads
        // the saved section directly and only ever runs once.
        const restoredChatOnceRef = useRef(false);
        const [pendingRestore, setPendingRestore] = useState(true);
        useEffect(() => {
          if (!dataReady || restoredChatOnceRef.current) return;
          restoredChatOnceRef.current = true;
          let savedSection;
          try { savedSection = isMobile ? localStorage.getItem('dashboardView') : localStorage.getItem('dashboardActiveTab'); } catch { savedSection = null; }
          let chatWasOpen;
          try { chatWasOpen = localStorage.getItem(accountScopedKey('dashboardChatOpen')) === 'true'; } catch { chatWasOpen = false; }
          if (!chatWasOpen || ((savedSection || '') !== 'chats' && (savedSection || '') !== 'groups')) {
            setPendingRestore(false);
            return;
          }
          let savedDm = null;
          let savedGrp = null;
          try {
            const dmRaw = localStorage.getItem(accountScopedKey('selectedChat'));
            savedDm = dmRaw ? JSON.parse(dmRaw) : null;
            const grpRaw = localStorage.getItem(accountScopedKey('selectedGroup'));
            savedGrp = grpRaw ? JSON.parse(grpRaw) : null;
          } catch { savedDm = null; savedGrp = null; }
          let restored = false;
          // Private chat first (only from the Chats section like before).
          if (savedDm?.id && (savedSection || '') === 'chats' && !restored) {
            const stillExists =
              contacts.some(c => String(c.id) === String(savedDm.id)) ||
              groupsList.some(g => String(g.id) === String(savedDm.id));
            if (stillExists) {
              setSelectedChat(savedDm);
              selectedChatRef.current = savedDm;
              if (isMobile) setMobileChatOpen(true);
              restored = true;
            } else {
              localStorage.removeItem('selectedChat');
              setSelectedChat(prev => (prev && String(prev.id) === String(savedDm.id) ? null : prev));
            }
          }
          // Open group restore (refreshing inside a group keeps that group).
          if (!restored && savedGrp?.id) {
            const stillExists = groupsList.some(g => String(g.id) === String(savedGrp.id));
            if (stillExists) {
              const normalized = {
                id: savedGrp.id,
                name: savedGrp.name,
                dp: savedGrp.dp || null,
                memberCount: savedGrp.memberCount,
                admins: Array.isArray(savedGrp.admins) ? savedGrp.admins.map(String) : [],
                admin: savedGrp.admin,
                adminName: savedGrp.adminName || null,
                addMembers: savedGrp.addMembers || 'everyone',
                sendMessages: savedGrp.sendMessages || 'everyone',
                removedAt: savedGrp.removedAt || null,
                removedBy: savedGrp.removedBy || null,
                removedByName: savedGrp.removedByName || '',
              };
              selectedGroupRef.current = normalized;
              setSelectedGroup(normalized);
              setSelectedChat(null);
              selectedChatRef.current = null;
              if (isMobile) setMobileChatOpen(true);
              groupOpenAtRef.current = Date.now();
              if (socket) socket.emit('fetchGroupMessages', { groupId: normalized.id });
              restored = true;
            } else {
              localStorage.removeItem('selectedGroup');
            }
          }
          setPendingRestore(false);
        }, [dataReady, groupsList, isMobile, socket]);

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

        // Live email lookup (debounced): both the New Contact modal and the
        // Add Contact drawer check whether the typed email belongs to an
        // existing NexChat user as soon as it looks like a full address, so the
        // UI can show the found user's real photo and block saving otherwise.
        useEffect(() => {
          if (emailLookupTimerRef.current) clearTimeout(emailLookupTimerRef.current);
          const trimmed = email.trim();
          if (!trimmed || !/\S+@\S+\.\S+/.test(trimmed)) {
            setEmailLookupStatus(null);
            setEmailLookupUser(null);
            return;
          }
          setEmailLookupStatus('checking');
          setEmailLookupUser(null);
          let cancelled = false;
          emailLookupTimerRef.current = setTimeout(async () => {
            try {
              const res = await fetch(`${API_URL}/api/auth/check-email?email=${encodeURIComponent(trimmed)}`);
              if (cancelled) return;
              if (res.ok) {
                const data = await res.json();
                setEmailLookupStatus('found');
                setEmailLookupUser(data.user || null);
              } else {
                setEmailLookupStatus('not-found');
                setEmailLookupUser(null);
              }
            } catch {
              if (!cancelled) {
                setEmailLookupStatus('not-found');
                setEmailLookupUser(null);
              }
            }
          }, 600);
          return () => { cancelled = true; clearTimeout(emailLookupTimerRef.current); };
        }, [email]);
  
  


  
  
  
  
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
              goBackPage();
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

                // Hydrate the current user's own profile (real name, photo, about).
                fetch(`${API_URL}/api/profile/me`, {
                  headers: { Authorization: `Bearer ${token}` },
                })
                  .then((res) => (res.ok ? res.json() : null))
                  .then((data) => {
                    if (data && data.user && data.user.id) {
                      setUser({
                        id: String(data.user.id),
                        name: data.user.name || 'You',
                        email: data.user.email || '',
                        photo: avatarSrc(data.user.photo, 50),
                        about: data.user.about || '',
                        blockedUsers: data.user.blockedUsers || [],
                      });
                      setBlockedByMeSet(new Set((data.user.blockedUsers || []).map(String)));
                    }
                  })
                  .catch(() => {});

                // ✅ Per-account chat cache: read ONLY this account's messages
                //    so a second account on the same device never sees another
                //    account's conversations.
                const saved = readChatMessages();
                if (saved) {
                  // Legacy cleanup: a stale "undefined" chat key must never
                  // surface as a ghost conversation under this account.
                  if ('undefined' in saved) {
                    delete saved.undefined;
                    safeSetItem('chatMessages', saved);
                  }
                  setMessages(saved);
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
            try { localStorage.setItem('token', token); } catch (err) { console.warn('Failed to persist token', err); }
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
        const lastNavKeyRef = useRef(null);        // last on-screen descriptor
        const lastNavFlagsRef = useRef(null);      // nav snapshot of last render
        const firstNavRunRef = useRef(true);       // first descriptor run = baseline
        const chatOnRef = useRef(false);
        const contactInfoOnRef = useRef(false);
        const groupInfoOnRef = useRef(false);
        const addContactOnRef = useRef(false);
        const forwardOnRef = useRef(false);
        const groupFlowOnRef = useRef(false);
        const cameraOnRef = useRef(false);
        const mediaOnRef = useRef(false);
        const previewOnRef = useRef(false);
        const statusViewerOnRef = useRef(false);
        const statusAddOnRef = useRef(false);
        const statusComposerOnRef = useRef(false);
        const statusCameraOnRef = useRef(false);
        const statusCaptureOnRef = useRef(false);
        const clearConfirmOnRef = useRef(false);
        const unsavedPromptOnRef = useRef(false);
        const newContactOnRef = useRef(false);
        const memberProfileOnRef = useRef(false);

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
          if (previewImage) {
            setPreviewImage(null);
            previewOnRef.current = false;
          } else if (statusViewer) {
            setStatusViewer(null);
            statusViewerOnRef.current = false;
          } else if (statusCameraOpen) {
            closeStatusCamera();
            statusCameraOnRef.current = false;
          } else if (statusComposerOpen) {
            setStatusComposerOpen(false);
            statusComposerOnRef.current = false;
          } else if (statusCapture) {
            setStatusCapture(null);
            statusCaptureOnRef.current = false;
          } else if (mediaViewer) {
            setMediaViewer(null);
            mediaOnRef.current = false;
          } else if (statusAddSheet) {
            setStatusAddSheet(false);
            statusAddOnRef.current = false;
          } else if (showClearChatConfirm) {
            setShowClearChatConfirm(false);
            clearConfirmOnRef.current = false;
          } else if (soleAdminWarning) {
            setSoleAdminWarning(null);
          } else if (memberProfile) {
            setMemberProfile(null);
            memberProfileOnRef.current = false;
          } else if (showCameraModal) {
            stopCameraStream();
            setShowCameraModal(false);
            cameraOnRef.current = false;
          } else if (showGroupFlow) {
            setShowGroupFlow(false);
            setSlideClass('');
            groupFlowOnRef.current = false;
          } else if (showContactInfo) {
            setShowContactInfo(false);
            setContactEditOpen(false);
            contactInfoOnRef.current = false;
          } else if (showGroupInfo) {
            setShowGroupInfo(false);
            groupInfoOnRef.current = false;
          } else if (showNewContactModal) {
            setShowNewContactModal(false);
            newContactOnRef.current = false;
          } else if (showAddContact) {
            setShowAddContact(false);
            addContactOnRef.current = false;
          } else if (showForwardModal) {
            setShowForwardModal(false);
            forwardOnRef.current = false;
          } else if (showUnsavedContactPrompt) {
            setShowUnsavedContactPrompt(false);
            unsavedPromptOnRef.current = false;
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

        // -------- Mobile screen stack: snapshot-based tracking --------
        // Every stack entry stores, in `saved`, a snapshot of ALL nav-affecting
        // flags from the render BEFORE the transition that created it. Pop-ping
        // an entry (system/on-screen back) hydrates that snapshot, so Back
        // rebuilds the EXACT previous screen (drawers re-open, the same chat is
        // re-selected, overlapping sub-views return) instead of just closing the
        // current page while hoping the underlying flags survived. This is what
        // lets "Group Info -> Member Info -> Chat privately -> Chat -> Back"
        // land back on Member Info instead of a stale/empty screen.

        // Single "what is on screen right now" descriptor. Uses the SAME
        // precedence as closeTopLive() (top-most first) so the stack records a
        // real transition whenever it changes — including identity swaps that
        // never flip a Boolean (group chat -> DM chat via "Chat privately").
        const composeNavKey = (f) => {
          if (f.statusCapture) return 'statuscapture';
          if (f.statusCameraOpen) return 'statuscamera';
          if (f.statusComposerOpen) return 'statuscomposer';
          if (f.statusViewer) return 'statusviewer';
          if (f.previewImage) return 'preview';
          if (f.mediaViewer) return 'media';
          if (f.statusAddSheet) return 'statusadd';
          if (f.showClearChatConfirm) return 'clearconfirm';
          if (f.memberProfile) return 'memberprofile';
          if (f.showCameraModal) return 'camera';
          if (f.showGroupFlow) return 'groupflow';
          if (f.showContactInfo) return f.contactEditOpen ? 'contactinfo-edit' : 'contactinfo';
          if (f.showGroupInfo) {
            if (f.groupSettingsOpen) return 'groupinfo-settings';
            if (f.addMembersOpen) return 'groupinfo-addmembers';
            return 'groupinfo';
          }
          if (f.showNewContactModal) return 'newcontact';
          if (f.showAddContact) return 'addcontact';
          if (f.showUnsavedContactPrompt) return 'unsavedprompt';
          if (f.showForwardModal) return 'forward';
          if (f.selectedChat?.id) return `chat:dm:${f.selectedChat.id}`;
          if (f.selectedGroup?.id) return `chat:grp:${f.selectedGroup.id}`;
          if (f.activeTab === 'profile' && f.profileRoute !== 'page') return `profile:${f.profileRoute}`;
          return `${f.view}:${f.activeTab}`;
        };

        // Layer order: higher = visually above the layers below (mirrors the
        // closeTopLive() fallback chain). Used to tell a FORWARD transition
        // (push a new history entry) from an in-app CLOSE (replace the current
        // entry so history stays balanced and Back never reopens a closed page).
        const rankOfNavKey = (k) => {
          if (!k) return 0;
          if (k.startsWith('chat:')) return 2;
          if (k === 'profile:name' || k === 'profile:about') return 1.5;
          switch (k) {
            case 'preview': return 17;
            case 'statusviewer': return 16;
            case 'statuscamera': return 15;
            case 'statuscomposer': return 14;
            case 'statuscapture': return 13;
            case 'media': return 12;
            case 'statusadd': return 11;
            case 'clearconfirm': return 10;
            case 'memberprofile': return 9;
            case 'camera': return 8;
            case 'groupflow': return 7;
            case 'contactinfo-edit': return 6.5;
            case 'contactinfo': return 6;
            case 'groupinfo-settings':
            case 'groupinfo-addmembers': return 5.5;
            case 'groupinfo': return 5;
            case 'newcontact': return 4.5;
            case 'addcontact': return 4;
            case 'unsavedprompt': return 2.5;
            case 'forward': return 3;
            default: return 1;
          }
        };

        // Apply a saved snapshot (rebuild the previous screen). Runs whatever
        // cleanup a closing top layer needs, then replays every nav flag and
        // keeps the tracking refs in sync so the descriptor effect sees the
        // restored screen as its new baseline and doesn't re-push.
        const hydrateNav = (saved) => {
          if (!saved) return;
          if (cameraOnRef.current && !saved.showCameraModal) {
            try { stopCameraStream(); } catch (e) { console.warn(e); }
            videoRef.current = null;
            setCapturedPhoto(null);
            setCaption('');
          }
          if (statusCameraOnRef.current && !saved.statusCameraOpen) {
            try { closeStatusCamera(); } catch (e) { console.warn(e); }
          }
          if (groupFlowOnRef.current && !saved.showGroupFlow) setSlideClass('');
          if (forwardOnRef.current && !saved.showForwardModal) {
            setSelectedForwardChats(new Set());
            setSelectedForwardGroups(new Set());
            setForwardSearchQuery('');
          }
          setView(saved.view);
          setActiveTab(saved.activeTab);
          setProfileRoute(saved.profileRoute || 'page');
          setSelectedChat(saved.selectedChat || null);
          selectedChatRef.current = saved.selectedChat || null;
          setSelectedGroup(saved.selectedGroup || null);
          selectedGroupRef.current = saved.selectedGroup || null;
          setMobileChatOpen(!!saved.mobileChatOpen);
          mobileChatOpenRef.current = !!saved.mobileChatOpen;
          setMemberProfile(saved.memberProfile || null);
          setShowContactInfo(!!saved.showContactInfo);
          setContactEditOpen(!!saved.contactEditOpen);
          setShowGroupInfo(!!saved.showGroupInfo);
          setGroupSettingsOpen(!!saved.groupSettingsOpen);
          setAddMembersOpen(!!saved.addMembersOpen);
          setShowAddContact(!!saved.showAddContact);
          setShowNewContactModal(!!saved.showNewContactModal);
          setShowForwardModal(!!saved.showForwardModal);
          setShowGroupFlow(!!saved.showGroupFlow);
          setShowCameraModal(!!saved.showCameraModal);
          setMediaViewer(saved.mediaViewer || null);
          setPreviewImage(saved.previewImage || null);
          setStatusViewer(saved.statusViewer || null);
          setStatusAddSheet(!!saved.statusAddSheet);
          setStatusComposerOpen(!!saved.statusComposerOpen);
          setStatusCameraOpen(!!saved.statusCameraOpen);
          setStatusCapture(saved.statusCapture || null);
          setShowClearChatConfirm(!!saved.showClearChatConfirm);
          setShowUnsavedContactPrompt(!!saved.showUnsavedContactPrompt);
          setPendingPrivateContact(saved.pendingPrivateContact || null);
          chatOnRef.current = !!(saved.selectedChat?.id || saved.selectedGroup?.id);
          contactInfoOnRef.current = !!saved.showContactInfo;
          groupInfoOnRef.current = !!saved.showGroupInfo;
          memberProfileOnRef.current = !!saved.memberProfile;
          addContactOnRef.current = !!saved.showAddContact;
          newContactOnRef.current = !!saved.showNewContactModal;
          forwardOnRef.current = !!saved.showForwardModal;
          groupFlowOnRef.current = !!saved.showGroupFlow;
          cameraOnRef.current = !!saved.showCameraModal;
          mediaOnRef.current = !!saved.mediaViewer;
          previewOnRef.current = !!saved.previewImage;
          statusViewerOnRef.current = !!saved.statusViewer;
          statusAddOnRef.current = !!saved.statusAddSheet;
          statusComposerOnRef.current = !!saved.statusComposerOpen;
          statusCameraOnRef.current = !!saved.statusCameraOpen;
          statusCaptureOnRef.current = !!saved.statusCapture;
          clearConfirmOnRef.current = !!saved.showClearChatConfirm;
          unsavedPromptOnRef.current = !!saved.showUnsavedContactPrompt;
          prevNavRef.current = { view: saved.view, activeTab: saved.activeTab };
          lastNavKeyRef.current = composeNavKey(saved);
          lastNavFlagsRef.current = saved;
          setShowDropdown(false);
          setGroupShowDropdown(false);
        };

        const closeScreen = (entry) => {
          if (entry?.saved) {
            hydrateNav(entry.saved);
          } else if (entry) {
            closeTopLive();
          }
        };

        // Shared handler for ANY on-screen back/close button: goes through the
        // browser history so the pushed entry is consumed (stack stays balanced).
        const goBackPage = () => {
          if (navStackRef.current.length && window.history.state && window.history.state.appNav) {
            window.history.back();
          } else {
            closeTopLive();
          }
        };

        // Anchor the root history entry (mobile only) so that once the in-app
        // stack empties, back stays on the dashboard instead of leaving the app.
        useEffect(() => {
          if (!isMobile) return;
          if (!window.history.state || !window.history.state.appNav) {
            window.history.replaceState({ appNav: true }, '');
          }
        }, [isMobile]);

        // Mobile screen tracking: whenever the on-screen descriptor changes —
        // a page opens (rank UP), sub-views toggle, or the chat content swaps
        // while the chat itself stays open (group -> DM via "Chat privately"):
        //  - FORWARD transitions push a history entry carrying the previous
        //    render's full nav snapshot, so Back can rebuild that exact screen.
        //  - In-app CLOSES (rank DOWN, done directly with setState) replace the
        //    top history entry with the restored key so the stack stays balanced
        //    and Back never reopens a page the user just closed.
        // The first run only records the baseline; nothing is pushed on mount.
        useEffect(() => {
            if (!isMobile) return;
            const flags = {
              view,
              activeTab,
              profileRoute,
              selectedChat,
              selectedGroup,
              mobileChatOpen,
              memberProfile,
              showContactInfo,
              contactEditOpen,
              showGroupInfo,
              groupSettingsOpen,
              addMembersOpen,
              showAddContact,
              showNewContactModal,
              showForwardModal,
              showGroupFlow,
              showCameraModal,
              mediaViewer,
              previewImage,
              statusViewer,
              statusAddSheet,
              statusComposerOpen,
              statusCameraOpen,
              statusCapture,
              showClearChatConfirm,
              showUnsavedContactPrompt,
              pendingPrivateContact,
            };
            const key = composeNavKey(flags);
            // Keep the page on/off refs truthful for closeTopLive/hydrate cleanup.
            chatOnRef.current = !!(selectedChat?.id || selectedGroup?.id);
            contactInfoOnRef.current = !!showContactInfo;
            groupInfoOnRef.current = !!showGroupInfo;
            memberProfileOnRef.current = !!memberProfile;
            addContactOnRef.current = !!showAddContact;
            newContactOnRef.current = !!showNewContactModal;
            forwardOnRef.current = !!showForwardModal;
            groupFlowOnRef.current = !!showGroupFlow;
            cameraOnRef.current = !!showCameraModal;
            mediaOnRef.current = !!mediaViewer;
            previewOnRef.current = !!previewImage;
            statusViewerOnRef.current = !!statusViewer;
            statusAddOnRef.current = !!statusAddSheet;
            statusComposerOnRef.current = !!statusComposerOpen;
            statusCameraOnRef.current = !!statusCameraOpen;
            statusCaptureOnRef.current = !!statusCapture;
            clearConfirmOnRef.current = !!showClearChatConfirm;
            unsavedPromptOnRef.current = !!showUnsavedContactPrompt;
            if (firstNavRunRef.current) {
              firstNavRunRef.current = false;
              lastNavKeyRef.current = key;
              lastNavFlagsRef.current = flags;
              return;
            }
            if (key !== lastNavKeyRef.current) {
              const prevKey = lastNavKeyRef.current;
              // A chat -> chat swap (same layer, different conversation) is a
              // forward navigation, as is "Chat privately" from a member profile
              // that sits ABOVE a chat: both must PUSH so Back can rebuild the
              // previous overlay chain instead of replacing/stale-pop-ping it.
              const chatSwap =
                key.startsWith('chat:') &&
                (prevKey.startsWith('chat:') ||
                  prevKey === 'memberprofile' ||
                  prevKey.startsWith('groupinfo') ||
                  prevKey.startsWith('contactinfo'));
              if (chatSwap || rankOfNavKey(key) >= rankOfNavKey(prevKey)) {
                pushPage(key, lastNavFlagsRef.current);
              } else {
                // In-app close (rank DOWN, done with a direct setState): swap
                // the top entry for the closed page's own snapshot — that's the
                // state that WAS on screen before the closed page opened, i.e.
                // exactly what the current screen should look like now — so the
                // browser history stays balanced and Back never reopens a page
                // the user just closed.
                const idx = navStackRef.current.length - 1;
                if (idx >= 0) {
                  window.history.replaceState({ appNav: true }, '');
                  navStackRef.current[idx] = {
                    screen: key,
                    saved: navStackRef.current[idx].saved || lastNavFlagsRef.current,
                  };
                }
              }
              lastNavKeyRef.current = key;
            }
            lastNavFlagsRef.current = flags;
          }, [isMobile, view, activeTab, profileRoute, selectedChat, selectedGroup, mobileChatOpen, memberProfile, showContactInfo, contactEditOpen, showGroupInfo, groupSettingsOpen, addMembersOpen, showAddContact, showNewContactModal, showForwardModal, showGroupFlow, showCameraModal, mediaViewer, previewImage, statusViewer, statusAddSheet, statusComposerOpen, statusCameraOpen, statusCapture, showClearChatConfirm, showUnsavedContactPrompt, pendingPrivateContact]);

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
        setGroupAddPref('everyone');
        setGroupSendPref('everyone');
        setGroupFlowSettingsOpen(false);
        setSlideClass('slide-in-forward');
      };

      const closeGroupFlow = () => {
        goBackPage();
      };

      const advanceGroupStep = () => {
        setSlideClass('slide-in-forward');
        setGroupStep(s => Math.min(s + 1, 2));
      };

      const backGroupStep = () => {
        setSlideClass('slide-in-backward');
        setGroupStep(s => Math.max(s - 1, 1));
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

      // Contacts that can still be added to the currently open group (in the
      // address book, not already a member, and not the viewer themselves).
      const groupMembersForAdd = (() => {
        if (!selectedGroup) return [];
        const memberIds = new Set(
          (selectedGroup.members || []).map(m => String(m?._id || m?.id || m))
        );
        const q = addMembersQuery.trim().toLowerCase();
        const seen = new Set();
        const out = [];
        (contacts || []).forEach(c => {
          if (!c || !c.id) return;
          const cid = String(c.id);
          if (memberIds.has(cid) || cid === String(user.id)) return;
          // Search across the viewer's saved contact name, the user's
          // profile/database name, and their email.
          const savedName = (nameOf(cid, c.name || '') || '').toLowerCase();
          const profileName = String(c.name || '').toLowerCase();
          const email = String(c.email || '').toLowerCase();
          if (q && !savedName.includes(q) && !profileName.includes(q) && !email.includes(q)) return;
          // Avoid exposing duplicate identity rows.
          if (seen.has(cid)) return;
          seen.add(cid);
          out.push(c);
        });
        return out;
      })();

      // Add the selected contacts to the group (server re-validates the
      // addMembers permission; the setting gates who sees the Add button).
      const submitAddMembers = () => {
        const s = socketRef.current || socket;
        if (!s || !selectedGroup || addMembersSelected.size === 0) return;
        s.emit('group:addMembers', {
          groupId: String(selectedGroup.id || selectedGroup._id),
          memberIds: [...addMembersSelected],
        });
        setAddMembersOpen(false);
        setAddMembersSelected(new Set());
        setAddMembersQuery('');
        closeMemberMenu();
      };

      const openAddMembers = () => {
        setAddMembersQuery('');
        setAddMembersSelected(new Set());
        setAddMembersOpen(true);
      };

      const updateGroupSetting = (key, value) => {
        if (!selectedGroup || selectedGroup.removedAt) return;
        if (!viewerIsGroupAdmin(selectedGroup)) return; // admins only
        const s = socketRef.current || socket;
        if (!s) return;
        const gid = String(selectedGroup.id || selectedGroup._id);
        // If this exact setting is already being saved, ignore extra clicks so
        // the user can't spam the (slow) permission round-trip.
        if (pendingGroupSettings.has(key)) return;
        // Optimistically flip the UI right now so the toggle feels instant,
        // then let the server broadcast (groupInfoUpdated → applyGroupSnapshot)
        // reconcile the authoritative value a few seconds later.
        const applyLocal = (g) => (g && String(g.id) === gid ? { ...g, [key]: value } : g);
        setGroupsList(prev => prev.map(applyLocal));
        setSelectedGroup(prev => applyLocal(prev));
        setPendingGroupSettings(prev => new Set(prev).add(key));
        s.emit('group:updateSettings', { groupId: gid, [key]: value });
        // Safety net: if the server never confirms, release the lock.
        setTimeout(() => {
          setPendingGroupSettings(prev => {
            if (!prev.has(key)) return prev;
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }, 15000);
      };

      // Group profile picture: change (dataURL) or remove (null). Any member can
      // change the photo (server permits dp changes for members, while the
      // permission toggles stay admin-only).
      const handleGroupInfoDpChange = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setGroupDpMenuOpen(false);
        const reader = new FileReader();
        reader.onload = () => {
          const s = socketRef.current || socket;
          if (!s || !selectedGroup) return;
          s.emit('group:updateSettings', {
            groupId: String(selectedGroup.id || selectedGroup._id),
            dp: reader.result,
          });
        };
        reader.readAsDataURL(file);
        if (e.target) e.target.value = null;
      };

      const removeGroupDp = () => {
        const s = socketRef.current || socket;
        if (!s || !selectedGroup) return;
        setGroupDpMenuOpen(false);
        s.emit('group:updateSettings', {
          groupId: String(selectedGroup.id || selectedGroup._id),
          dp: null,
        });
      };

      // Leave group: confirmed in-app, then delegated to the server (which
      // removes the viewer, writes the "X left" history entry and keeps the
      // group in their chats locked). The groupLeftYou event finalizes the UI.
      const confirmLeaveGroup = () => {
        if (!confirmLeave) return;
        const s = socketRef.current || socket;
        if (s) s.emit('group:leave', { groupId: confirmLeave.groupId });
        setConfirmLeave(null);
        setShowGroupInfo(false);
        setSelectedGroup(null);
        selectedGroupRef.current = null;
      };

      // "Chat privately" from a member profile: opens a DM with that member.
      // When the member is NOT a saved contact the DM is opened but NOT folded
      // into the contact list yet — a prompt warns it will disappear after a
      // reload and offers to open the existing Add Contact flow. Declining
      // (Cancel) folds the local entry in (existing unsaved-contact behavior);
      // accepting adds the person through the normal Add Contact form (which
      // owns dedupe + persistence + custom-name priority).
      const chatPrivatelyWithMember = () => {
        if (!memberProfile) return;
        const mid = String(memberProfile.id);
        const entry = {
          id: mid,
          name: nameOf(mid, memberProfile.name || 'Someone'),
          photo: avatarSrc(memberProfile.photo, 50),
          firstName: String(memberProfile.name || '').split(' ')[0] || '',
          lastName: '',
          email: memberProfile.email || '',
        };
        const exists = (contactsRef.current || []).some(c => c && String(c.id) === mid);
        if (exists) {
          // Already saved: merge any fresh profile data, no prompt.
          const nextContacts = (contactsRef.current || []).map(c => String(c.id) === mid ? { ...c, ...entry } : c);
          contactsRef.current = nextContacts;
          setContacts(nextContacts);
          setShowUnsavedContactPrompt(false);
          setPendingPrivateContact(null);
        } else {
          // Not saved: open the chat, then ask whether to add the contact.
          setPendingPrivateContact(entry);
          setShowUnsavedContactPrompt(true);
        }
        setMemberProfile(null);
        setShowGroupInfo(false);
        setGroupSettingsOpen(false);
        setAddMembersOpen(false);
        setSelectedChat(entry);
        selectedChatRef.current = entry;
        setSelectedGroup(null);
        selectedGroupRef.current = null;
        setMobileChatOpen(true);
        setActiveTab('chats');
      };

      // Prompt -> Cancel: keep the private chat open WITHOUT saving the person.
      // The member is folded into the local list like any unsaved random chat,
      // so it survives this session but disappears after a reload.
      const cancelUnsavedPrivatePrompt = () => {
        const target = pendingPrivateContact;
        setShowUnsavedContactPrompt(false);
        if (target) {
          const cur = contactsRef.current || [];
          if (!cur.some(c => String(c.id) === String(target.id))) {
            const next = [target, ...cur];
            contactsRef.current = next;
            setContacts(next);
          }
        }
      };

      // Prompt -> Add Contact: reuse the EXISTING Add Contact UI (desktop
      // modal / mobile drawer). The person's email is pre-filled so the email
      // lookup resolves automatically and the user only types the name. The
      // prompt is dismissed first, then the modal opens a moment later, so the
      // modal's Back snapshot rebuilds the chat (never this prompt again).
      const addContactFromUnsavedPrompt = () => {
        const target = pendingPrivateContact;
        setShowUnsavedContactPrompt(false);
        if (!target) return;
        setTimeout(() => {
          const parts = String(target.name || '').split(' ').filter(Boolean);
          setEmail(String(target.email || '').trim());
          setFirstName(parts[0] || '');
          setLastName(parts.slice(1).join(' '));
          if (isMobile) setShowAddContact(true);
          else setShowNewContactModal(true);
        }, 150);
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
          admins: [],
          admin: user.id,
          addMembers: groupAddPref,
          sendMessages: groupSendPref,
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
            addMembers: groupAddPref,
            sendMessages: groupSendPref,
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
            ) : groupFlowSettingsOpen ? (
              <div className="group-screen">
                <div className="group-header">
                  <button
                    type="button"
                    className="group-back-btn"
                    onClick={() => setGroupFlowSettingsOpen(false)}
                    aria-label="Back"
                  >
                    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
                      <path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                    </svg>
                  </button>
                  <div className="group-header-text">
                    <span className="group-header-title">Group Settings</span>
                  </div>
                </div>

                <div className="group-details">
                  <div className="group-settings-row">
                    <div className="group-settings-row-label" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className="group-settings-row-title" style={{ fontSize: '0.95rem', fontWeight: 500, color: '#1f2933' }}>Add members</span>
                      <span className="group-settings-row-sub" style={{ fontSize: '0.8rem', color: '#8a8f99' }}>Who can add new members to this group</span>
                    </div>
                    <div className="group-perm-toggle" style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className={groupAddPref === 'everyone' ? 'active' : ''}
                        onClick={() => setGroupAddPref('everyone')}
                      >
                        Everyone
                      </button>
                      <button
                        type="button"
                        className={groupAddPref === 'admins' ? 'active' : ''}
                        onClick={() => setGroupAddPref('admins')}
                      >
                        Admins only
                      </button>
                    </div>
                  </div>

                  <div className="group-settings-row">
                    <div className="group-settings-row-label" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <span className="group-settings-row-title" style={{ fontSize: '0.95rem', fontWeight: 500, color: '#1f2933' }}>Send messages</span>
                      <span className="group-settings-row-sub" style={{ fontSize: '0.8rem', color: '#8a8f99' }}>Who can send messages in this group</span>
                    </div>
                    <div className="group-perm-toggle" style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className={groupSendPref === 'everyone' ? 'active' : ''}
                        onClick={() => setGroupSendPref('everyone')}
                      >
                        Everyone
                      </button>
                      <button
                        type="button"
                        className={groupSendPref === 'admins' ? 'active' : ''}
                        onClick={() => setGroupSendPref('admins')}
                      >
                        Admins only
                      </button>
                    </div>
                  </div>
                </div>

                <div className="group-bottom-bar">
                  <button
                    type="button"
                    className="group-done-btn"
                    onClick={() => setGroupFlowSettingsOpen(false)}
                  >
                    Done
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
                  <button
                    type="button"
                    className="group-settings-icon-btn"
                    onClick={() => setGroupFlowSettingsOpen(true)}
                    aria-label="Group Settings"
                    style={{ marginLeft: 'auto' }}
                  >
                    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="12" r="3"/>
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                    </svg>
                  </button>
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

      // ==================== Profile page state + actions ====================
      const profileDefaultPhoto = skeletonAvatar();
      const profileDefaultAbout = 'Hey there! I am using NexChat.';
      const profileToken = () => localStorage.getItem('token');

      const profileBack = () => {
        if (profileRoute === 'name' || profileRoute === 'about') setProfileRoute('page');
        else if (isMobile) { setActiveTab('chats'); setView('chats'); }
      };
      const openProfileName = () => { setProfileNameDraft(user.name || ''); setProfileRoute('name'); };
      const openProfileAbout = () => { setProfileAboutDraft(user.about || profileDefaultAbout); setProfileRoute('about'); };

      const downscaleImage = (dataUrl, maxDim) => new Promise((resolve) => {
        try {
          const img = new Image();
          img.onload = () => {
            try {
              const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
              if (scale === 1) return resolve(dataUrl);
              const canvas = document.createElement('canvas');
              canvas.width = Math.round(img.width * scale);
              canvas.height = Math.round(img.height * scale);
              canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
              resolve(canvas.toDataURL('image/jpeg', 0.85));
            } catch { resolve(dataUrl); }
          };
          img.onerror = () => resolve(dataUrl);
          img.src = dataUrl;
        } catch { resolve(dataUrl); }
      });

      const saveProfilePhoto = async (photo) => {
        const next = photo === null || photo === '' ? null : photo;
        const tk = profileToken();
        if (!tk) return;
        setProfileSaveBusy(true);
        try {
          const res = await fetch(`${API_URL}/api/profile/me`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
            body: JSON.stringify({ photo: next }),
          });
          const data = await res.json();
          if (!res.ok || !data.user) { alert(data?.message || 'Could not update profile picture'); return; }
          setUser((u) => ({ ...u, photo: data.user.photo }));
          setProfilePhotoMenu(false);
        } catch { alert('Could not update profile picture'); }
        finally { setProfileSaveBusy(false); }
      };

      const handleProfilePhotoFile = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        try {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('read failed'));
            reader.readAsDataURL(file);
          });
          const resized = await downscaleImage(dataUrl, 512);
          await saveProfilePhoto(resized);
        } catch { alert('Could not read the image'); }
      };

      const saveProfileName = async () => {
        const clean = String(profileNameDraft || '').trim();
        if (!clean) return alert('Name is required');
        if (clean.length > 25) return alert('Name must be 25 characters or fewer');
        const tk = profileToken();
        if (!tk) return;
        setProfileSaveBusy(true);
        try {
          const res = await fetch(`${API_URL}/api/profile/me`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
            body: JSON.stringify({ name: clean }),
          });
          const data = await res.json();
          if (!res.ok || !data.user) { alert(data?.message || 'Could not save name'); return; }
          setUser((u) => ({ ...u, name: data.user.name }));
          setProfileRoute('page');
        } catch { alert('Could not save name'); }
        finally { setProfileSaveBusy(false); }
      };

      const saveProfileAbout = async () => {
        const clean = String(profileAboutDraft || '').trim();
        if (clean.length > 100) return alert('About must be 100 characters or fewer');
        const tk = profileToken();
        if (!tk) return;
        setProfileSaveBusy(true);
        try {
          const res = await fetch(`${API_URL}/api/profile/me`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` },
            body: JSON.stringify({ about: clean }),
          });
          const data = await res.json();
          if (!res.ok || !data.user) { alert(data?.message || 'Could not save about'); return; }
          setUser((u) => ({ ...u, about: data.user.about }));
          setProfileRoute('page');
        } catch { alert('Could not save about'); }
        finally { setProfileSaveBusy(false); }
      };
      // ==================== End Profile actions ====================

      const renderCenterContent = () => {
        if (showGroupFlow) {
          return renderGroupFlow();
        }
        if (activeTab === 'profile') {
          return renderProfileArea();
        }

        // Buffering animation while the chat/group list finishes its first
        // load (refresh): shows until (a) the address book arrived, (b) the
        // groups fetch confirmed a result, and (c) if the account HAS groups,
        // until those rows are actually rendered. An account with zero
        // contacts/groups shows its normal empty state, no animation.
        // Flex-centered: the whole screen on mobile, the left list panel on
        // desktop.
        const listLoading =
          !dataReady ||
          lastGroupsCount === null ||
          (lastGroupsCount > 0 && groupsList.length === 0);
        if (listLoading) {
          return (
            <div className="chat-list-loading" role="status" aria-label="Loading chats">
              <div className="chat-list-spinner" />
            </div>
          );
        }

   


    return (
      <>
        <div className="search-bar">
          <input
            type="text"
            placeholder="Search"
            value={listFilterQuery}
            onChange={(e) => setListFilterQuery(e.target.value)}
          />
        </div>
        <div className="items-list">
          {activeTab === 'chats' && [...contacts, ...chats]
            .filter(item => {
              const qf = listFilterQuery.trim().toLowerCase();
              if (!qf) return true;
              return String(item.name || '').toLowerCase().includes(qf) ||
                String(item.email || '').toLowerCase().includes(qf);
            })
            .sort((a, b) => {
              const latestActivity = (chat) => {
                // A "Clear chat" removes the row's preview/date: activity older
                // than this user's cleared point no longer counts for sorting.
                const clearedTs = dmClearedAt(chat.id);
                const active = (ts) => !clearedTs || (Number(ts) || 0) > clearedTs;
                const msgs = (messages[chat.id] || []).filter(m => active(m.timestamp));
                const last = msgs[msgs.length - 1];
                const msgTime = last ? Number(last.timestamp) || 0 : 0;
                const ct = calls.filter(c => !c.groupId && String(c.userId) === String(chat.id) && active(c.time));
                const callTime = ct.length ? Number(ct.reduce((x, y) => (Number(y.time) || 0) > (Number(x.time) || 0) ? y : x).time) || 0 : 0;
                return Math.max(msgTime, callTime);
              };
              return latestActivity(b) - latestActivity(a);
            })
            .map(chat => {
            // Same cleared-point gate for the visible row so a cleared chat
            // shows no stale last-message preview or old date.
            const clearedTs = dmClearedAt(chat.id);
            const active = (ts) => !clearedTs || (Number(ts) || 0) > clearedTs;
            const chatMsgs = (messages[chat.id] || []).filter(m => active(m.timestamp));
            const last = chatMsgs[chatMsgs.length - 1];
            const unreadMsgs = chatMsgs.filter(m => m.sender !== 'You' && !m.read);
            // Calls participate in the same latest-activity/unread machinery:
            // unread missed calls from this contact add to the SAME green badge,
            // and the newest call can win the preview slot against the newest
            // message (whichever happened later).
            const chatCalls = calls.filter(c => !c.groupId && String(c.userId) === String(chat.id) && active(c.time));
            const unreadMissed = chatCalls.filter(c => c.missedCallUnread).length;
            const unreadCount = unreadMsgs.length + unreadMissed;
            const hasUnread = unreadCount > 0;
            const previewMsg = hasUnread ? unreadMsgs[0] : last; // oldest unread, else latest
            const latestCall = chatCalls.length
              ? chatCalls.reduce((a, b) => ((b.time || 0) > (a.time || 0) ? b : a))
              : null;
            const truncate = (t) => {
              if (!t) return '';
              return t.length > 35 ? `${t.slice(0, 35)}…` : t;
            };
            // Latest activity = newest message OR newest call, decided ONLY by
            // real timestamp (never by localStorage order or arrival order).
            const msgTime = previewMsg ? previewMsg.timestamp : (chat.time || null);
            const useCall = !!latestCall && (msgTime == null || (latestCall.time || 0) > msgTime);
            let preview = '';
            let timeToShow = (clearedTs ? '' : chat.timestamp);
            if (useCall) {
              const missedShow = latestCall.direction === 'missed' && !latestCall.iCalled && !latestCall.rejected;
              preview = `${latestCall.video ? '📹' : '📞'} ${missedShow ? 'Missed ' : ''}${latestCall.video ? (missedShow ? 'video' : 'Video') : (missedShow ? 'voice' : 'Voice')} call`;
              timeToShow = formatRelativeTime(latestCall.time) || chat.timestamp;
            } else if (previewMsg) {
              if (previewMsg.file) {
                preview = previewMsg.fileType?.startsWith('image/') ? '[Photo]' : previewMsg.fileType?.startsWith('audio/') ? '🎤 Voice message' : '[File]';
              } else if (previewMsg.text) {
                preview = truncate(previewMsg.text);
              }
              if (previewMsg.sender === 'You' && preview) {
                preview = `You: ${preview}`;
              }
              timeToShow = previewMsg
                ? (formatRelativeTime(previewMsg.timestamp) || chat.timestamp)
                : chat.timestamp;
            } else {
              preview = (clearedTs ? '' : truncate(chat.lastMsg || ''));
            }
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
          // A missed call alone (no unread messages) also clears on open.
          if ((messages[chat.id] || []).some(m => m.sender !== 'You' && !m.read) || unreadMissed > 0) {
            setTimeout(() => markAsReadRef.current(), 60);
          }
        }}
        style={{ cursor: 'pointer' }}
      >
          <img src={avatarFor(chat.id, chat.photo, skeletonAvatar())} alt={nameOf(chat.id, chat.name)} onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }} />
          <div className="chat-info">
            <h4>{nameOf(chat.id, chat.name)}</h4>
            <p className={hasUnread ? 'unread-preview' : ''}>{preview}</p>
          </div>
          <div className="chat-item-right">
            <span className={`timestamp ${hasUnread ? 'unread' : ''}`}>{timeToShow}</span>
            {hasUnread && <span className="unread-badge">{unreadCount}</span>}
          </div>
        </div>
            );
          })}
                {activeTab === 'groups' && groupsList
            .filter(group => {
              const qf = listFilterQuery.trim().toLowerCase();
              if (!qf) return true;
              return String(group.name || '').toLowerCase().includes(qf);
            })
            .map(group => {
                  // Respect this viewer's "Clear chat" point: older activity and
                  // the stale last-message/date fallbacks stay hidden after clear.
                  const clearedTs = groupClearedAt(group._id || group.id);
                  const groupMsgs = (groupMessages[group._id || group.id] || [])
                    .filter(m => !clearedTs || (Number(m.timestamp) || 0) > clearedTs);
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
                      : nameOf(previewMsg.senderId, previewMsg.sender || 'Someone');
                    if (previewMsg.file) {
                      preview = previewMsg.fileType?.startsWith('image/') ? '[Photo]' : previewMsg.fileType?.startsWith('audio/') ? '🎤 Voice message' : '[File]';
                    } else if (previewMsg.text) {
                      preview = truncate(previewMsg.text);
                    }
                    if (preview) {
                      preview = `${senderName}: ${preview}`;
                    }
                  } else {
                    preview = (clearedTs ? '' : truncate(group.lastMsg || 'No messages yet'));
                  }
                  const timeToShow = previewMsg
                    ? (formatRelativeTime(previewMsg.timestamp) || group.lastTime)
                    : (clearedTs ? '' : group.lastTime);
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
                        admins: Array.isArray(group.admins) ? group.admins.map(String) : [],
                        admin: group.admin,
                        adminName: group.adminName || null,
                        addMembers: group.addMembers || 'everyone',
                        sendMessages: group.sendMessages || 'everyone',
                        removedAt: group.removedAt || null,
                        removedBy: group.removedBy || null,
                        removedByName: group.removedByName || '',
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
                      src={group.dp || skeletonAvatar()}
                      alt={group.name}
                      onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }}
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
                    .filter(item => {
                      const qf = listFilterQuery.trim().toLowerCase();
                      if (!qf) return true;
                      return String(item.name || '').toLowerCase().includes(qf) ||
                        String(item.email || '').toLowerCase().includes(qf);
                    })
                    .map(chat => {
                      const chatMsgs = messages[chat.id] || [];
                      const un = chatMsgs.filter(m => m.sender !== 'You' && !m.read);
                      const missedUnread = calls.filter(c => !c.groupId && String(c.userId) === String(chat.id) && c.missedCallUnread).length;
                      if (un.length === 0 && missedUnread === 0) return null;
                      const last = chatMsgs[chatMsgs.length - 1];
                      const p = un[0] || last;
                      let text = '';
                      if (p) text = p.file ? '[Photo]' : (p.text ? (p.text.length > 35 ? p.text.slice(0, 35) + '…' : p.text) : '');
                      return {
                        key: chat.id,
                        name: chat.name,
                        photo: avatarFor(chat.id, chat.photo, skeletonAvatar()),
                        count: un.length + missedUnread,
                        text,
                        open: () => {
                          setSelectedChat(chat);
                          setSelectedGroup(null);
                          selectedGroupRef.current = null;
                          setMobileChatOpen(true);
                          setActiveTab('chats');
                          if (un.length > 0 || missedUnread > 0) {
                            setTimeout(() => markAsReadRef.current(), 60);
                          }
                        },
                      };
                    })
                    .filter(Boolean);
                  const unreadGrps = groupsList
                    .filter(g => (groupMessages[g._id || g.id] || []).some(m => m.sender !== 'You' && !m.read))
                    .map(g => {
                      const gid = g._id || g.id;
                      const gm = groupMessages[gid] || [];
                      const un = gm.filter(m => m.sender !== 'You' && !m.read);
                      return {
                        key: gid,
                        name: g.name,
                        photo: avatarSrc(g.photo, 50),
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
                      <img src={c.photo} alt={nameOf(c.key, c.name)} />
                      <div className="chat-info">
                        <h4>{nameOf(c.key, c.name)}</h4>
                        <p className="unread-preview">{c.count} unread{!c.text ? '' : ' • ' + c.text}</p>
                      </div>
                      <div className="chat-item-right"><span className="unread-badge">{c.count}</span></div>
                    </div>
                  ));
                })()}
{activeTab === 'calls' && calls.map(call => (
                  <div key={call.id} className="chat-item" style={{ cursor: 'pointer' }}>
                    <img src={call.groupId ? skeletonAvatar() : avatarSrc(call.photo, 50)} alt={nameOf(call.userId, call.name)} />
                    <div className="chat-info">
                      <h4>{call.groupId ? (groupsList.find(g => String(g.id) === String(call.groupId))?.name || 'Group call') : nameOf(call.userId, call.name)}</h4>
                      <p><span className={`call-dir ${call.direction === 'missed' ? 'missed' : ''}`}>{call.direction === 'outgoing' ? '↗' : (call.direction === 'rejected' ? '↔' : '↘')}</span> {call.direction === 'outgoing' ? 'Outgoing' : call.direction === 'rejected' ? 'Declined' : call.direction === 'missed' ? 'Missed' : 'Incoming'} {call.video ? 'video' : 'voice'} {call.groupId ? 'group ' : ''}call{call.durationSec ? ` • ${fmtCallTime(call.durationSec)}` : ''}</p>
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
                            src={status.statuses[0]?.file || avatarSrc(status.user.photo, 50)}
                            count={status.statuses.length}
                            seen={!hasUnseen}
                          />
                          <div className="chat-info">
                            <h4>{nameOf(status.user.id, status.user.name)}</h4>
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
        if (!selectedGroup || selectedGroup.removedAt) return;
        // Admin-only messaging: non-admins are rejected client-side too (the
        // server enforces the same rule regardless).
        if (selectedGroup.sendMessages === 'admins' && !viewerIsGroupAdmin(selectedGroup)) return;
        const input = messageInputRef.current;
        if (!input?.value.trim()) return;
        const text = input.value.trim();
        const now = new Date();
        const tempId = `group-temp-${now.getTime()}-${Math.random()}`;
        const gid = selectedGroup.id;

        const replyToForPayload = groupReplyTo ? sanitizeReplyTo({
          id: groupReplyTo.id,
          messageId: groupReplyTo.id,
          text: groupReplyTo.text,
          sender: groupReplyTo.sender,
          senderId: groupReplyTo.senderId || (groupReplyTo.sender === 'You' ? user.id : groupReplyTo.from),
        }) : null;

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
              ? { ...g, lastMsg: `You: ${text}`, lastTime: now.getTime() }
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
        if (selectedGroup.removedAt) return;
        if (selectedGroup.sendMessages === 'admins' && !viewerIsGroupAdmin(selectedGroup)) return;

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

          const replyToForPayload = groupReplyTo ? sanitizeReplyTo({
            id: groupReplyTo.id,
            messageId: groupReplyTo.id,
            text: groupReplyTo.text,
            sender: groupReplyTo.sender,
            senderId: groupReplyTo.senderId || (groupReplyTo.sender === 'You' ? user.id : groupReplyTo.from),
          }) : null;

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

      const callEmptyIcon = (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M6.6 10.8c1.3 3 3.6 5.3 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3.1.7-.2 1l-2.2 2.2Z" fill="currentColor" opacity="0.9" />
          <circle cx="17.5" cy="5.5" r="1.3" fill="#025144" />
        </svg>
      );

      const statusEmptyIcon = (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 5C7 5 3.2 8 1.5 12 3.2 16 7 19 12 19s8.8-3 10.5-7C20.8 8 17 5 12 5Z" fill="currentColor" opacity="0.9" />
          <circle cx="12" cy="12" r="3.2" fill="#025144" />
        </svg>
      );

      const profileEmptyIcon = (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="8" r="3.2" fill="currentColor" />
          <path d="M4.5 20c.6-3.6 3.4-5.5 7.5-5.5s6.9 1.9 7.5 5.5H4.5Z" fill="currentColor" opacity="0.9" />
        </svg>
      );

      const renderProfileArea = () => {
        const photo = user.photo || profileDefaultPhoto;
        const aboutText = user.about ? String(user.about).trim() : profileDefaultAbout;
        const myName = user.name || 'You';

        const photoMenu = (
          <div className="profile-photo-menu">
            <button type="button" className="profile-photo-menu-btn" onClick={() => profilePhotoInputRef.current?.click()} disabled={profileSaveBusy}>
              Change profile picture
            </button>
            <button type="button" className="profile-photo-menu-btn remove" onClick={() => { if (!profileSaveBusy) saveProfilePhoto(null); }}>
              Remove profile picture
            </button>
          </div>
        );

        if (profileRoute === 'name') {
          return (
            <div className="profile-page">
              <div className="profile-topbar">
                <button type="button" className="profile-back" onClick={profileBack} aria-label="Back">
                  <ArrowLeft size={22} strokeWidth={1.8} />
                </button>
                <h2>Name</h2>
                <span className="profile-topbar-spacer" />
              </div>
              <div className="profile-body">
                <div className="profile-edit-wrap">
                  <input
                    className="profile-edit-input"
                    value={profileNameDraft}
                    onChange={(e) => setProfileNameDraft(e.target.value)}
                    maxLength={25}
                    placeholder="Enter your name"
                  />
                  <p className="profile-hint">Maximum length is 25 characters. Letters, numbers and special characters allowed — {profileNameDraft.length}/25.</p>
                </div>
                <div className="profile-save-row">
                  <button type="button" className="profile-save-btn" onClick={saveProfileName} disabled={profileSaveBusy}>
                    <Check size={20} strokeWidth={2.2} /> Save
                  </button>
                </div>
              </div>
            </div>
          );
        }

        if (profileRoute === 'about') {
          return (
            <div className="profile-page">
              <div className="profile-topbar">
                <button type="button" className="profile-back" onClick={profileBack} aria-label="Back">
                  <ArrowLeft size={22} strokeWidth={1.8} />
                </button>
                <h2>About</h2>
                <span className="profile-topbar-spacer" />
              </div>
              <div className="profile-body">
                <div className="profile-edit-wrap">
                  <textarea
                    className="profile-edit-input profile-edit-about"
                    value={profileAboutDraft}
                    onChange={(e) => setProfileAboutDraft(e.target.value)}
                    maxLength={100}
                    placeholder="Write something about you..."
                  />
                  <p className="profile-hint">Maximum length is 100 characters.</p>
                </div>
                <div className="profile-save-row">
                  <button type="button" className="profile-save-btn" onClick={saveProfileAbout} disabled={profileSaveBusy}>
                    <Check size={20} strokeWidth={2.2} /> Done
                  </button>
                </div>
              </div>
            </div>
          );
        }

        // Main profile page. On desktop the Profile tab behaves like every
        // other top-level tab (its "Profile" header is rendered by the panel),
        // so there is no back arrow here. On mobile the topbar with a back
        // arrow is preserved so the page works like a nested view.
        return (
          <div className="profile-page">
            {isMobile && (
              <div className="profile-topbar">
                <button type="button" className="profile-back" onClick={profileBack} aria-label="Back">
                  <ArrowLeft size={22} strokeWidth={1.8} />
                </button>
                <h2>Profile</h2>
                <span className="profile-topbar-spacer" />
              </div>
            )}
            <div className="profile-body">
              <div className="profile-avatar-wrap">
                <div
                  className="profile-avatar"
                  onClick={() => setProfilePhotoMenu((pm) => !pm)}
                  role="button"
                  aria-label="Profile picture"
                >
                  <img src={photo} alt="Profile" />
                  <span className="profile-avatar-badge">
                    <Camera size={18} strokeWidth={2} />
                  </span>
                </div>
                {profilePhotoMenu && photoMenu}
                <input
                  ref={profilePhotoInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleProfilePhotoFile}
                />
              </div>

              <div className="profile-row" onClick={openProfileName} role="button">
                <span className="profile-row-icon"><User size={20} strokeWidth={1.8} /></span>
                <span className="profile-row-text">
                  <span className="profile-row-head">Name</span>
                  <span className="profile-row-value">{myName}</span>
                </span>
                <ChevronRight size={20} strokeWidth={1.8} className="profile-chevron" />
              </div>

              <div className="profile-row" onClick={openProfileAbout} role="button">
                <span className="profile-row-icon"><Info size={20} strokeWidth={1.8} /></span>
                <span className="profile-row-text">
                  <span className="profile-row-head">About</span>
                  <span className="profile-row-value profile-row-about">{aboutText}</span>
                </span>
                <ChevronRight size={20} strokeWidth={1.8} className="profile-chevron" />
              </div>
            </div>
          </div>
        );
      };

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

        // A member who can actually type/send in this group right now: still an
        // active participant AND (no admin-only restriction OR an admin).
        const viewerCanSendGroup = !!(selectedGroup && !selectedGroup.removedAt) &&
          (!selectedGroup.sendMessages || selectedGroup.sendMessages === 'everyone' || viewerIsGroupAdmin(selectedGroup));

        const groupSearchMatches = chatSearchQuery
          ? groupMsgs.filter((m) => m.text?.toLowerCase().includes(chatSearchQuery.toLowerCase()))
          : [];

        return (
          <div
            className="chat-container"
            style={{ width: showGroupInfo ? 'calc(100% - 400px)' : '100%', transition: 'width 0.3s ease' }}
          >
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
                                text: firstMsg.text || replyFileLabel(firstMsg),
                                sender: nameOf(firstMsg.senderId || firstMsg.from, firstMsg.sender || firstMsg.fromName || firstMsg.from || 'Someone'),
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
                            setSelectedForwardGroups(new Set());
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
                                    const sender = nameOf(m.senderId || m.from, m.sender || m.fromName || m.from || 'You');
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
                <div
                  className="header-left"
                  style={{ cursor: 'pointer' }}
                  onClick={() => setShowGroupInfo(true)}
                >
                  {isMobile && (
                    <button
                      className="mobile-header-back"
                      onClick={(e) => {
                        e.stopPropagation();
                        goBackPage();
                      }}
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
                      {selectedGroup?.removedAt && (
                        <button
                          className="dropdown-item"
                          style={{ color: 'red', fontWeight: 600 }}
                          onClick={() => {
                            setDeleteConfirm({ kind: 'group', id: gid, name: selectedGroup?.name });
                            setGroupShowDropdown(false);
                          }}
                        >
                          <X size={18} strokeWidth={1.8} />
                          <span>Delete group</span>
                        </button>
                      )}
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
                  const grpCalls = (calls || []).filter(c =>
                    String(c.groupId) === String(selectedGroup.id) &&
                    (Number(c.time) || Number(c.timestamp) || 0) > groupClearedAt(selectedGroup?.id)
                  );
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

                  // System/history entry (e.g. "X removed Y") — centered notice. The wording
                  // is personalized per viewer: the affected person sees "X
                  // removed you", the admin who acted sees "You removed X".
                  if (msg.isSystem) {
                    const sysType = msg.systemType;
                    const isTarget = msg.target && String(msg.target) === String(user.id);
                    const isActor = String(msg.senderId) === String(user.id);
                    let label = msg.text;
                    if (sysType === 'memberRemoved' || sysType === 'memberDemoted') {
                      const kind = sysType === 'memberDemoted' ? ' as admin' : '';
                      if (isTarget) label = `${msg.sender || 'Someone'} removed you${kind}`;
                      else if (isActor && msg.targetName) label = `You removed ${msg.targetName}${kind}`;
                    }
                    return (
                      <div key={msg.id} className="group-system-msg">
                        <span>{label}</span>
                      </div>
                    );
                  }

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
                          {nameOf(msg.senderId, msg.sender || msg.fromName || msg.from || 'Someone')}
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
                            : nameOf(msg.replyTo.senderId, msg.replyTo.sender || 'Someone')}
                          : {msg.replyTo.text || 'Attachment'}
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
                                  text: msg.text || replyFileLabel(msg),
                                  sender: nameOf(msg.senderId || msg.from, msg.sender || msg.fromName || 'Someone'),
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

                      {msg.isForwarded && <ForwardedLabel />}
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

{selectedGroup?.removedAt ? (
                <div className="group-compose-locked" style={isMobile ? { display: 'none' } : undefined}>
You are no longer a participant of this group
                </div>
              ) : !viewerCanSendGroup ? (
                <div className="group-compose-locked" style={isMobile ? { display: 'none' } : undefined}>
Only admins can send messages
                </div>
              ) : (
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
                        ↪ Replying to {nameOf(groupReplyTo.from || groupReplyTo.senderId, groupReplyTo.sender)}: "{groupReplyTo.text || 'Attachment'}"
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
              )}

              {isMobile && (selectedGroup?.removedAt ? (
                <div className="mobile-compose-locked">You are no longer a participant of this group</div>
              ) : !viewerCanSendGroup ? (
                <div className="mobile-compose-locked">Only admins can send messages</div>
              ) : (
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
                      ↪ Replying to {nameOf(groupReplyTo.from || groupReplyTo.senderId, groupReplyTo.sender)}: "{groupReplyTo.text || 'Attachment'}"
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
                ))}
            </div>
          </div>
        );
      };

const renderRightPanel = () => {
      if (!selectedChat) {
        if (pendingRestore) {
          return (
            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8f99', fontSize: '0.95rem' }}>
              Loading…
            </div>
          );
        }
        return emptyState(
          'Select a chat',
          'Choose a conversation from the list to start messaging.',
          chatEmptyIcon
        );
      }

      const chatMessages = messages[selectedChat.id] || [];
      const chatIsBlocked = isChatBlocked(selectedChat.id);
      // Presence (Online / last seen) is hidden for BOTH parties of a block.
      const chatBlockedEitherWay = chatIsBlocked || blockedMeSet.has(String(selectedChat?.id ?? ''));

    const handleSendMessage = (e) => {
      
  e.preventDefault();
  if (chatIsBlocked) return;
  const input = messageInputRef.current;
  if (!input?.value.trim()) return;

  const text = input.value.trim();
  console.log("📝 Message being sent:", text);
  const now = new Date();

  // ✅ Generate tempId first
  const tempId = `temp-${now.getTime()}-${Math.random()}`;

  const replyToForPayload = replyTo ? sanitizeReplyTo({
    id: replyTo.id,
    messageId: replyTo.id,
    text: replyTo.text,
    sender: replyTo.sender,
    senderId: replyTo.senderId || (replyTo.sender === 'You' ? user.id : selectedChat.id),
    statusId: replyTo.statusId || null,
    statusType: replyTo.statusType || null,
    statusOwnerId: replyTo.statusOwnerId || null,
  }) : null;

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
  dmScrollOnSendRef.current = true;
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
                    if (firstMsg) setReplyTo({ id: firstMsg.id, sender: firstMsg.sender === 'You' ? 'You' : nameOf(selectedChat?.id || firstMsg.senderId, firstMsg.sender), text: firstMsg.text || replyFileLabel(firstMsg) });
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
                    setSelectedForwardGroups(new Set());
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
                          .map((m) => `(${m.sender === 'You' ? 'You' : nameOf(selectedChat?.id || m.senderId, m.sender)}) ${m.text}`)
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
                  setSelectedForwardGroups(new Set());
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
        <div
          className="header-left"
          style={{ cursor: 'pointer' }}
          onClick={() => { setContactEditOpen(false); setShowContactInfo(true); }}
        >
          {isMobile && (
            <button
              className="mobile-header-back"
              onClick={(e) => {
                e.stopPropagation();
                goBackPage();
              }}
              aria-label="Back"
            >
              ‹
            </button>
          )}
          <img
            src={avatarFor(selectedChat?.id, selectedChat?.photo, skeletonAvatar())}
            alt={nameOf(selectedChat?.id, selectedChat?.name)}
            onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }}
          />
          <div className="user-info">
            <h4>{nameOf(selectedChat?.id, selectedChat?.name)}</h4>
            <p>
              {chatBlockedEitherWay
                ? ''
                : (selectedChat?.online
                  ? 'Online'
                  : formatLastSeen(selectedChat?.lastSeen))}
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
                    setContactEditOpen(false);
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
                    if (selectedChat) setMediaViewer({ type: 'dm', chatId: selectedChat.id, chatName: nameOf(selectedChat.id, selectedChat.name), tab: 'media' });
                  }}
                >
                  <FileText size={18} strokeWidth={2.2} style={{ color: '#00a884' }} />
                  <span>Media, links and docs</span>
                </button>
                <button
                  className="dropdown-item"
                  onClick={() => {
                    setClearTarget({ chatType: 'dm', chatId: selectedChat.id, name: nameOf(selectedChat.id, selectedChat.name) });
                    setShowClearChatConfirm(true);
                    setShowDropdown(false);
                  }}
                >
                  <Trash2 size={18} strokeWidth={2.2} style={{ color: '#e02f5b' }} />
                  <span>Clear chat</span>
                </button>
                <button
                  className="dropdown-item"
                  style={{ color: 'red' }}
                  onClick={() => {
                    setDeleteConfirm({ kind: 'dm', id: selectedChat.id, name: nameOf(selectedChat.id, selectedChat.name) });
                    setShowDropdown(false);
                  }}
                >
                  <X size={18} strokeWidth={1.8} />
                  <span>Delete chat</span>
                </button>
              </>
            ) : (
              <>
            <button
              className="dropdown-item"
              onClick={() => {
                setContactEditOpen(false);
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
                if (selectedChat) setMediaViewer({ type: 'dm', chatId: selectedChat.id, chatName: nameOf(selectedChat.id, selectedChat.name), tab: 'media' });
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
                setClearTarget({ chatType: 'dm', chatId: selectedChat?.id, name: nameOf(selectedChat?.id, selectedChat?.name) });
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
                setDeleteConfirm({ kind: 'dm', id: selectedChat.id, name: nameOf(selectedChat.id, selectedChat?.name) });
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
        const dmCalls = (calls || []).filter(c =>
          String(c.userId) === String(selectedChat.id) &&
          (Number(c.time) || Number(c.timestamp) || 0) > dmClearedAt(selectedChat?.id)
        );
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
                onClick={(e) => {
                  e.stopPropagation();
                  if (msg.replyTo.statusId) {
                    openStatusFromReply(msg.replyTo.statusId);
                  }
                }}
                title={msg.replyTo.statusId ? 'Open the original status' : undefined}
                style={{
                  padding: '6px 12px',
                  backgroundColor: isYou ? '#06544c' : '#b9e8dc',
                  color: 'black',
                  borderRadius: '6px 6px 0 0',
                  fontSize: '0.8rem',
                  cursor: msg.replyTo.statusId ? 'pointer' : 'default',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                {msg.replyTo.statusId && (
                  <span style={{ fontSize: '0.85rem', lineHeight: 1 }}>
                    {msg.replyTo.statusType === 'video' ? '🎥' : msg.replyTo.statusType === 'image' ? '📷' : '💬'}
                  </span>
                )}
                ↪{' '}
                {String(msg.replyTo.senderId) === String(user.id)
                  ? 'You'
                  : nameOf(msg.replyTo.senderId, msg.replyTo.sender || 'Someone')}
                : {msg.replyTo.text || 'Attachment'}
                {msg.replyTo.statusId && (
                  <span style={{ fontStyle: 'italic', opacity: 0.7 }}> · tap to open</span>
                )}
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
                        text: msg.text || replyFileLabel(msg),
                        sender: String(msg.senderId) === String(user.id)
                          ? 'You'
                          : nameOf(msg.senderId || selectedChat?.id, msg.sender === 'You' ? 'You' : msg.sender),
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
            {msg.isForwarded && <ForwardedLabel />}
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
      chatBlockedEitherWay ? (
        <div className="group-compose-locked">Please unblock to send messages</div>
      ) : isMobile ? (
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
              ↪ Replying to {nameOf(replyTo.statusOwnerId || replyTo.senderId, replyTo.sender === 'You' ? 'You' : replyTo.sender)}: "{replyTo.text || 'Attachment'}"
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
                ↪ Replying to {nameOf(replyTo.statusOwnerId || replyTo.senderId, replyTo.sender === 'You' ? 'You' : replyTo.sender)}: "{replyTo.text || 'Attachment'}"
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
              onChange={(e) => {
                setDesktopDraft(e.target.value);
              }}
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
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: '100%',
            minWidth: '100%',
            height: '100%',
            overflowY: 'auto',
            flexShrink: 0,
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
            onClick={openContactEdit}
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
            src={avatarFor(selectedChat?.id, selectedChat?.photo, skeletonAvatar())}
            alt="Profile"
            onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }}
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
            {nameOf(selectedChat?.id, selectedChat?.name)}
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
          <div>
            {blockedMeSet.has(String(selectedChat?.id ?? ''))
              ? 'No about info yet.'
              : (contactInfoProfile?.about ? contactInfoProfile.about : 'No about info yet.')}
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
            Media, Links and Docs
          </div>
          <div
            className="action-item"
            style={{ cursor: 'pointer' }}
            onClick={() => selectedChat && setMediaViewer({ type: 'dm', chatId: selectedChat.id, chatName: nameOf(selectedChat.id, selectedChat.name), tab: 'media' })}
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
          {(() => {
            const selfId = String(user.id);
            const contactId = String(selectedChat?.id ?? '');
            const commonGroups = (groupsList || []).filter(g => {
              const ids = (g.members || []).map(m => String(m?._id || m?.id || m || ''));
              return ids.includes(selfId) && ids.includes(contactId);
            });
            if (commonGroups.length === 0) {
              return <div className="action-item">No groups yet</div>;
            }
            return (
              <div>
                {commonGroups.map(g => {
                  const gid = String(g._id || g.id);
                  return (
                    <div
                      key={gid}
                      onClick={() => {
                        setSelectedChat(null);
                        selectedChatRef.current = null;
                        const normalized = {
                          id: gid,
                          name: g.name,
                          dp: g.dp,
                          memberCount: g.memberCount || (g.members?.length || 0),
                          members: g.members || [],
                          admins: Array.isArray(g.admins) ? g.admins.map(String) : [],
                          admin: g.admin,
                          adminName: g.adminName || null,
                          removedAt: g.removedAt || null,
                          removedBy: g.removedBy || null,
                          removedByName: g.removedByName || '',
                        };
                        selectedGroupRef.current = normalized;
                        setSelectedGroup(normalized);
                        setShowContactInfo(false);
                        setMobileChatOpen(true);
                        setActiveTab('groups');
                        if (socket) socket.emit('fetchGroupMessages', { groupId: gid });
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 0',
                        cursor: 'pointer',
                        borderBottom: '1px solid #f0f0f0',
                      }}
                    >
                      <img
                        src={g.dp || skeletonAvatar()}
                        alt=""
                        style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                      />
                      <div style={{ fontSize: '15px', color: '#111', flex: 1 }}>{g.name}</div>
                      <span style={{ color: '#666', fontSize: '13px' }}>{g.memberCount || (g.members?.length || 0)} members</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>

        <div
  className="section"
  style={{
    padding: '16px',
    borderTop: '1px solid #eee',
  }}
>
  {/* Block / Unblock */}
  <div
    onClick={askBlockToggle}
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
    {blockedByMeSet.has(String(selectedChat?.id ?? '')) ? (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="green" strokeWidth="2" />
        <polyline points="8 12 11 15 16 9" stroke="green" strokeWidth="2" fill="none" />
      </svg>
    ) : (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" r="10" stroke="red" strokeWidth="2" />
        <line x1="7" y1="7" x2="17" y2="17" stroke="red" strokeWidth="2" />
      </svg>
    )}
    <span>
      {blockedByMeSet.has(String(selectedChat?.id ?? ''))
        ? `Unblock ${nameOf(selectedChat?.id, selectedChat?.name)}`
        : `Block ${nameOf(selectedChat?.id, selectedChat?.name)}`}
    </span>
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
    onClick={() => {
      if (selectedChat?.type !== 'group') {
        setReportReason('');
        setShowReportModal(true);
      }
    }}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 8H14M10 12H14M10 16H14M8 21H16C17.1046 21 18 20.1046 18 19V5C18 3.89543 17.1046 3 16 3H8C6.89543 3 6 3.89543 6 5V19C6 20.1046 6.89543 21 8 21Z" stroke="red" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 9L4 9" stroke="red" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 13L4 13" stroke="red" strokeWidth="2" strokeLinecap="round" />
      <path d="M8 17L4 17" stroke="red" strokeWidth="2" strokeLinecap="round" />
    </svg>
    <span>Report {nameOf(selectedChat?.id, selectedChat?.name)}</span>
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
      setClearTarget({ chatType: 'dm', chatId: selectedChat?.id, name: nameOf(selectedChat?.id, selectedChat?.name) });
      setShowClearChatConfirm(true);
      setShowContactInfo(false);
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
        {contactEditOpen && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 20,
              display: 'flex',
              flexDirection: 'column',
              background: '#f5f7f9',
              boxShadow: '-2px 0 8px rgba(0,0,0,0.1)',
              overflowY: 'auto',
            }}
          >
            <div className="profile-topbar">
              <button type="button" className="profile-back" onClick={() => setContactEditOpen(false)} aria-label="Back">
                <ArrowLeft size={22} strokeWidth={1.8} />
              </button>
              <h2>Profile Info</h2>
              <span className="profile-topbar-spacer" />
            </div>
            <div className="profile-body">
              <div className="profile-edit-wrap">
                <input
                  className="profile-edit-input"
                  value={contactEditName}
                  onChange={(e) => setContactEditName(e.target.value)}
                  maxLength={25}
                  placeholder="Enter contact name"
                />
                <p className="profile-hint">Maximum length is 25 characters. Letters, numbers and special characters allowed — {contactEditName.length}/25.</p>
              </div>
              <div className="profile-save-row">
                <button type="button" className="profile-save-btn" onClick={saveContactName} disabled={contactEditBusy}>
                  <Check size={20} strokeWidth={2.2} /> Save
                </button>
              </div>
            </div>
          </div>
        )}
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

  const forwardSelectedMessages = (target, targetType) => {
    const currentSocket = socketRef.current;
    const currentUser = userRef.current;
    if (!currentSocket || !currentUser?.id || !target?.id) return;

    const fromGroup = !!selectedGroup;
    const sourceMsgs = fromGroup
      ? (groupMessages[selectedGroup.id] || [])
      : (messages[selectedChat?.id] || []);
    const toForward = sourceMsgs.filter((m) => selectedMessages.has(m.id));
    if (toForward.length === 0) {
      goBackPage();
      setIsSelectionMode(false);
      setSelectedMessages(new Set());
      return;
    }

    const now = Date.now();
    const isGroupTarget = targetType === 'group';

    toForward.forEach((msg, idx) => {
      const tempId = `fwd-${now}-${idx}-${Math.random()}`;

      if (isGroupTarget) {
        // Can't forward into a group you're no longer a member of.
        if (target.removedAt) return;
        const payload = {
          groupId: target.id,
          message: msg.text || '',
          file: msg.file || undefined,
          fileName: msg.fileName,
          fileType: msg.fileType,
          from: currentUser.id,
          fromName: currentUser.name,
          timestamp: now,
          messageId: tempId,
          isForwarded: true,
        };
        currentSocket.emit('sendGroupMessage', payload);

        setGroupMessages((prev) => ({
          ...prev,
          [target.id]: [
            ...(prev[target.id] || []),
            {
              id: tempId,
              text: payload.message || '',
              sender: 'You',
              senderId: currentUser.id,
              timestamp: now,
              file: payload.file || undefined,
              fileName: payload.fileName,
              fileType: payload.fileType,
              isForwarded: true,
              delivered: false,
              read: false,
            },
          ],
        }));

        setGroupsList((prev) => {
          const exists = prev.some((g) => String(g.id) === String(target.id));
          return exists
            ? prev.map((g) =>
                String(g.id) === String(target.id)
                  ? {
                      ...g,
                      lastMsg: msg.file
                        ? (String(msg.fileType || '').startsWith('image/')
                            ? 'You: 📷 Photo'
                            : `You: 📄 ${msg.fileName || 'File'}`)
                        : `You: ${msg.text || ''}`,
                      lastTime: now,
                    }
                  : g
              )
            : prev;
        });
      } else {
        const payload = {
          to: target.id,
          from: currentUser.id,
          fromName: currentUser.name,
          fromPhoto: target.photo,
          timestamp: now,
          messageId: tempId,
          isForwarded: true,
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
              isForwarded: true,
              delivered: false,
              read: false,
            },
          ],
        }));
      }
    });

    goBackPage();
    setIsSelectionMode(false);
    setSelectedMessages(new Set());
  };


  return (
    <div className={`dashboard-layout ${isMobile && mobileChatOpen ? 'chat-open' : ''}`}>
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
{!showGroupFlow && (activeTab !== 'profile' || (!isMobile && profileRoute === 'page')) && (
  <h2 className="panel-title">
    {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
  </h2>
)}

{!showGroupFlow && activeTab !== 'profile' && (
  <>
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
            <img src={skeletonAvatar()} alt={nameOf(chat.id, chat.name)} />
            <span>{nameOf(chat.id, chat.name)}</span>
          </div>
        ))}
      </div>
    </div>
  )}

  {/* New Contact Modal */}
{showNewContactModal && (
  <div
    className="new-contact-modal-overlay"
    onClick={goBackPage}
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
      <div className="profile-placeholder" style={{ overflow: 'hidden' }}>
        {emailLookupUser?.photo ? (
          <img
            src={emailLookupUser.photo}
            alt=""
            style={{ width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover' }}
          />
        ) : (
          (email ? email[0].toUpperCase() : '?')
        )}
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
        {email.trim() && /\S+@\S+\.\S+/.test(email.trim()) && (
          <div
            style={{
              fontSize: '13px',
              marginTop: '-8px',
              color: emailLookupStatus === 'found' && isContactAlreadySaved(emailLookupUser)
                ? '#f59e0b'
                : emailLookupStatus === 'found' ? '#22c55e' : emailLookupStatus === 'not-found' ? '#e53935' : '#666',
            }}
          >
            {emailLookupStatus === 'checking' && 'Checking…'}
            {emailLookupStatus === 'found' && isContactAlreadySaved(emailLookupUser) && '✓ Contact already saved'}
            {emailLookupStatus === 'found' && !isContactAlreadySaved(emailLookupUser) && (emailLookupUser?.name ? `✓ ${emailLookupUser.name} (${emailLookupUser.email})` : '✓ NexChat user found')}
            {emailLookupStatus === 'not-found' && '✗ No NexChat user with this email'}
          </div>
        )}
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
          onClick={goBackPage}
        >
          Cancel
        </button>
        <button
  className="modal-btn save"
  disabled={!email || emailLookupStatus !== 'found' || isContactAlreadySaved(emailLookupUser)}
  onClick={async () => {
  const foundUser = await findUserByEmail(email);
  if (!foundUser) {
    alert('User not found. Please enter a valid email.');
    return;
  }

  const typedName = `${firstName} ${lastName}`.trim();
  const customName = typedName || '';
  const newContact = {
    id: foundUser._id,
    name: customName || foundUser.name,
    firstName,
    lastName,
    email: foundUser.email,
    photo: avatarSrc(foundUser.photo, 50),
    lastMsg: '',
    time: '',
    online: false
  };

  const exists = (contactsRef.current || []).some(c => String(c.id) === String(newContact.id));
  if (!exists) {
    setMessages(prevMsgs => ({
      ...prevMsgs,
      [newContact.id]: []
    }));
    setContacts(prev => {
      if (prev.some(c => String(c.id) === String(newContact.id))) return prev;
      return [newContact, ...prev];
    });
  }
  // Persist server-side with the typed custom name so a later rename of the
  // account keeps resolving to what the viewer saved (empty name = no entry).
  fetch(`${API_URL}/api/contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${localStorage.getItem('token')}`,
    },
    body: JSON.stringify({ userId: foundUser._id, name: customName }),
  }).catch(err => console.error('Failed to save contact to server', err));
  // Mirror into savedNamesRef so nameOf/pencil resolve it immediately, before
  // any contacts refetch adopts the server-stored custom name.
  persistSavedName(foundUser._id, customName);

  alert(`Contact added: ${newContact.name}`);
  goBackPage();
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
        pendingRestore ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a8f99', fontSize: '0.95rem' }}>
            Loading…
          </div>
        ) : (
          groupsList.length
            ? emptyState('Select a group', 'Choose a group from the list to start chatting.', groupEmptyIcon)
            : emptyState('No groups yet', 'Create a group from the 📝 menu to start chatting.', groupEmptyIcon)
        )
      )
    ) : activeTab === 'statuses' ? (
      emptyState('Status', 'Share photo, text and video updates with your contacts. Your statuses appear in the list on the left.', statusEmptyIcon)
    ) : activeTab === 'calls' ? (
      emptyState('Calls', 'Your call history appears in the list on the left. Select a call to view its details here.', callEmptyIcon)
    ) : activeTab === 'profile' ? (
      emptyState('Profile', 'Your profile appears in the panel on the left.', profileEmptyIcon)
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
      onClick={() => {
        if (addMembersOpen) setAddMembersOpen(false);
        else if (groupSettingsOpen) setGroupSettingsOpen(false);
        else goBackPage();
      }}
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
          onClick={() => {
            if (addMembersOpen) setAddMembersOpen(false);
            else if (groupSettingsOpen) setGroupSettingsOpen(false);
            else goBackPage();
          }}
          style={{
            background: 'none',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
            color: '#000000ff',
            padding: '4px',
            marginRight: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isMobile ? (
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          ) : (
            '✖'
          )}
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
          {addMembersOpen ? 'Add members' : (groupSettingsOpen ? 'Group Settings' : 'Group Info')}
        </div>
        {!addMembersOpen && !groupSettingsOpen && viewerIsGroupAdmin(selectedGroup) && (
          <button
            type="button"
            aria-label="Group Settings"
            onClick={() => setGroupSettingsOpen(true)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: '#333',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '6px',
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        )}
      </div>

      {addMembersOpen ? (
        <div style={{ padding: '16px' }}>
          <div
            className="group-search"
            style={{ marginBottom: '12px' }}
          >
            <svg className="group-search-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/>
            </svg>
            <input
              type="text"
              placeholder="Search contacts"
              value={addMembersQuery}
              onChange={(e) => setAddMembersQuery(e.target.value)}
            />
          </div>
          <div className="group-contacts-list">
            {groupMembersForAdd.map((contact) => {
              const isTicked = addMembersSelected.has(String(contact.id));
              const contactName = nameOf(contact.id, contact.name || 'Someone');
              return (
                <div
                  key={contact.id}
                  className={`group-contact-item ${isTicked ? 'ticked' : ''}`}
                  onClick={() => {
                    setAddMembersSelected(prev => {
                      const next = new Set(prev);
                      if (isTicked) next.delete(String(contact.id));
                      else next.add(String(contact.id));
                      return next;
                    });
                  }}
                >
                  <span className={`group-contact-check ${isTicked ? 'checked' : ''}`}>
                    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                      <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
                    </svg>
                  </span>
                  <span className="group-contact-avatar">
                    {contact.photo ? (
                      <img src={contact.photo} alt={contactName} onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }} />
                    ) : (
                      <span>{(contactName || '?').charAt(0).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="group-contact-name">{contactName}</span>
                </div>
              );
            })}
            {groupMembersForAdd.length === 0 && (
              <div style={{ padding: '16px 4px', color: '#8a8f99', fontSize: '0.9rem' }}>
                No contacts to add
              </div>
            )}
          </div>
          <button
            type="button"
            className="group-create-btn"
            style={{ marginTop: '16px', width: '58px', height: '58px', borderRadius: '50%', border: 'none', background: '#25d366', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 10px rgba(37,211,102,0.35)' }}
            disabled={addMembersSelected.size === 0}
            onClick={submitAddMembers}
            aria-label="Add members"
          >
            <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
              <path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
            </svg>
          </button>
        </div>
      ) : groupSettingsOpen ? (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
          <label className="group-dp-picker" style={{ cursor: 'pointer' }}>
            {selectedGroup.dp ? (
              <img className="group-dp-preview" src={selectedGroup.dp} alt="Group DP" />
            ) : (
              <span className="group-dp-placeholder">{(selectedGroup.name || 'G').charAt(0).toUpperCase()}</span>
            )}
            <span className="group-dp-edit">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
              </svg>
            </span>
            <input
              type="file"
              accept="image/*"
              onChange={handleGroupInfoDpChange}
              hidden
            />
          </label>

          {selectedGroup.dp && (
            <button
              type="button"
              className="group-remove-dp-btn"
              onClick={removeGroupDp}
            >
              Remove photo
            </button>
          )}

          <div className="group-settings-row" style={{ width: '100%' }}>
            <div className="group-settings-row-label" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span className="group-settings-row-title" style={{ fontSize: '0.95rem', fontWeight: 500, color: '#1f2933' }}>Send messages</span>
              <span className="group-settings-row-sub" style={{ fontSize: '0.8rem', color: '#8a8f99' }}>Who can send messages in this group</span>
            </div>
            <div className="group-perm-toggle" style={{ display: 'flex', gap: '8px', alignItems: 'center', filter: pendingGroupSettings.has('sendMessages') ? 'blur(1.5px)' : 'none', opacity: pendingGroupSettings.has('sendMessages') ? 0.55 : 1, pointerEvents: pendingGroupSettings.has('sendMessages') ? 'none' : 'auto' }}>
              <button
                type="button"
                className={selectedGroup.sendMessages === 'everyone' ? 'active' : ''}
                onClick={() => updateGroupSetting('sendMessages', 'everyone')}
              >
                Everyone
              </button>
              <button
                type="button"
                className={selectedGroup.sendMessages === 'admins' ? 'active' : ''}
                onClick={() => updateGroupSetting('sendMessages', 'admins')}
              >
                Admins only
              </button>
              {pendingGroupSettings.has('sendMessages') && (
                <span aria-hidden="true" style={{ display: 'inline-flex', width: '16px', height: '16px', marginLeft: '4px' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="#dde1e5" strokeWidth="3" />
                    <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="#075e54" strokeWidth="3" strokeLinecap="round">
                      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite" />
                    </path>
                  </svg>
                </span>
              )}
            </div>
          </div>

          <div className="group-settings-row" style={{ width: '100%' }}>
            <div className="group-settings-row-label" style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <span className="group-settings-row-title" style={{ fontSize: '0.95rem', fontWeight: 500, color: '#1f2933' }}>Add members</span>
              <span className="group-settings-row-sub" style={{ fontSize: '0.8rem', color: '#8a8f99' }}>Who can add new members to this group</span>
            </div>
            <div className="group-perm-toggle" style={{ display: 'flex', gap: '8px', alignItems: 'center', filter: pendingGroupSettings.has('addMembers') ? 'blur(1.5px)' : 'none', opacity: pendingGroupSettings.has('addMembers') ? 0.55 : 1, pointerEvents: pendingGroupSettings.has('addMembers') ? 'none' : 'auto' }}>
              <button
                type="button"
                className={selectedGroup.addMembers === 'everyone' ? 'active' : ''}
                onClick={() => updateGroupSetting('addMembers', 'everyone')}
              >
                Everyone
              </button>
              <button
                type="button"
                className={selectedGroup.addMembers === 'admins' ? 'active' : ''}
                onClick={() => updateGroupSetting('addMembers', 'admins')}
              >
                Admins only
              </button>
              {pendingGroupSettings.has('addMembers') && (
                <span aria-hidden="true" style={{ display: 'inline-flex', width: '16px', height: '16px', marginLeft: '4px' }}>
                  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                    <circle cx="12" cy="12" r="10" fill="none" stroke="#dde1e5" strokeWidth="3" />
                    <path d="M12 2a10 10 0 0 1 10 10" fill="none" stroke="#075e54" strokeWidth="3" strokeLinecap="round">
                      <animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="0.7s" repeatCount="indefinite" />
                    </path>
                  </svg>
                </span>
              )}
            </div>
          </div>

          {!viewerIsGroupAdmin(selectedGroup) && (
            <div style={{ fontSize: '0.85rem', color: '#8a8f99', textAlign: 'center' }}>
              Only admins can change these settings.
            </div>
          )}
        </div>
      ) : (
      <>
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
        <button
          type="button"
          className="group-dp-options-btn"
          aria-label="Group profile picture options"
          onClick={() => { if (!selectedGroup.removedAt) setGroupDpMenuOpen(true); }}
        >
          <img
            src={selectedGroup.dp || skeletonAvatar()}
            alt="Group"
            onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }}
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              objectFit: 'cover',
              border: '3px solid #ddd',
              display: 'block',
            }}
          />
        </button>
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
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '14px',
            color: '#333',
            marginBottom: '12px',
          }}
        >
          <span>Members</span>
          {!selectedGroup.removedAt && (viewerIsGroupAdmin(selectedGroup) || selectedGroup.addMembers !== 'admins') && (
            <button
              type="button"
              className="group-add-members-top"
              onClick={openAddMembers}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '6px 12px', border: '1px solid #b0b8c1', borderRadius: '16px', background: '#e8f5e9', color: '#075e54', fontSize: '0.8rem', fontWeight: 500, cursor: 'pointer' }}
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Add members
            </button>
          )}
        </div>
        {(Array.isArray(selectedGroup.members) ? selectedGroup.members : []).map((m, idx) => {
          const memberId = String(m?._id || m?.id || m || '');
          const memberName =
            nameOf(memberId, m?.name) ||
            'Someone';
          const memberPhoto = avatarSrc(m?.photo, 40);
          const memberEmail = m?.email || '';
          const gAdmin = String(selectedGroup?.admin || '');
          const gAdmins = Array.isArray(selectedGroup?.admins) ? selectedGroup.admins.map(String) : [];
          const isCreator = gAdmin === memberId;
          const isAdmin = isCreator || gAdmins.includes(memberId);
          const isSelf = String(user.id) === memberId;
          const canManage = viewerIsGroupAdmin(selectedGroup) && !isSelf;
          const openMemberMenuFor = () => {
            setMemberMenu({
              memberId,
              memberName,
              memberPhoto,
              isCreator,
              isAdmin,
              isSelf,
              isMobile: true,
              rect: null,
            });
          };
          return (
            <div
              key={memberId || idx}
              className="group-member-row"
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px 4px',
                cursor: 'pointer',
              }}
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                // The viewer's own row is not openable (no profile/menu).
                if (isSelf) return;
                setMemberProfile({ id: memberId, name: memberName, photo: memberPhoto, isAdmin, email: memberEmail });
              }}
              onPointerDown={() => {
                if (isMobile && canManage) {
                  startLongPress(() => {
                    setOpenMemberMenuId(memberId);
                    openMemberMenuFor();
                  });
                }
              }}
              onPointerUp={clearLongPress}
              onPointerLeave={clearLongPress}
              onPointerCancel={clearLongPress}
              onContextMenu={(e) => {
                if (isMobile && canManage) {
                  e.preventDefault();
                  suppressClickRef.current = true;
                  setOpenMemberMenuId(memberId);
                  openMemberMenuFor();
                }
              }}
            >
              <div className="group-member-avatar-wrap" style={{ width: '40px', height: '40px', minWidth: '40px' }}>
                  <img
                    src={memberPhoto}
                    alt={memberName}
                    onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }}
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '2px solid #ddd',
                    }}
                  />
                </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '15px', color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {memberName}
                </div>
                {isSelf && <span className="group-you-tag">You</span>}
                {isAdmin && <span className="group-admin-badge">Admin</span>}
              </div>
              {!isMobile && canManage && (
                <button
                  className={`member-dots ${openMemberMenuId === memberId ? 'show' : ''}`}
                  aria-label={`Options for ${memberName}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (openMemberMenuId === memberId) {
                      closeMemberMenu();
                      return;
                    }
                    const r = e.currentTarget.getBoundingClientRect();
                    setMemberMenu({
                      memberId,
                      memberName,
                      memberPhoto,
                      isCreator,
                      isAdmin,
                      isSelf,
                      isMobile: false,
                      rect: { top: r.top, bottom: r.bottom, right: Math.round(window.innerWidth - r.right) },
                    });
                    setOpenMemberMenuId(memberId);
                  }}
                >
                  ⋮
                </button>
              )}
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
            borderTop: '1px solid #eee',
          }}
          onClick={() => {
            if (selectedGroup) {
              const gid = String(selectedGroup.id || selectedGroup._id);
              setClearTarget({ chatType: 'group', chatId: gid, name: selectedGroup?.name });
              setShowClearChatConfirm(true);
              setShowGroupInfo(false);
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
            if (selectedGroup) {
              const gid = String(selectedGroup.id || selectedGroup._id);
              // Sole-admin guard: if this user is the only admin, block the
              // leave and show an info popup instead. Mirror the server-side
              // check so the UI stays consistent.
              const viewerId = String(user.id);
              const gAdmin = String(selectedGroup.admin || '');
              const gAdmins = Array.isArray(selectedGroup.admins) ? selectedGroup.admins.map(String) : [];
              const isViewerSuperAdmin = gAdmin === viewerId;
              const isViewerPromotedAdmin = gAdmins.includes(viewerId);
              if (isViewerSuperAdmin || isViewerPromotedAdmin) {
                // Count admins that would remain after the viewer leaves.
                const remaining = isViewerSuperAdmin
                  ? gAdmins.length
                  : gAdmins.length - 1 + 1; // minus self, plus super admin stays
                if (remaining === 0) {
                  setSoleAdminWarning({ name: selectedGroup.name });
                  return;
                }
              }
              setConfirmLeave({ groupId: gid, name: selectedGroup.name });
            }
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M9 21H5C3.89543 21 3 20.1046 3 19V5C3 3.89543 3.89543 3 5 3H9M16 17L21 12L16 7M21 12H9" stroke="red" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Exit group</span>
        </div>
      </div>
      </>
      )}
    </div>
  </>
)}

{/* Group profile picture options popup (opened from the Group Info photo) */}
{groupDpMenuOpen && selectedGroup && (
  <div
    className="group-dp-menu-overlay"
    style={{
      position: 'fixed',
      top: 0,
      left: isMobile ? 0 : 'auto',
      right: isMobile ? 'auto' : 0,
      width: isMobile ? '100vw' : 400,
      height: '100vh',
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      zIndex: 20000,
    }}
    onClick={() => setGroupDpMenuOpen(false)}
  >
    <div
      style={{
        background: 'white',
        borderRadius: '12px',
        padding: '8px 0',
        minWidth: '250px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <label className="group-dp-menu-row" style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '13px 20px', border: 'none', background: 'none', color: '#1f2933', fontSize: '0.95rem', cursor: 'pointer', boxSizing: 'border-box' }}>
        {selectedGroup.dp ? 'Change profile picture' : 'Add profile picture'}
        <input type="file" accept="image/*" onChange={handleGroupInfoDpChange} hidden />
      </label>
      {selectedGroup.dp && (
        <button type="button" className="group-dp-menu-row group-dp-menu-remove" style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '13px 20px', border: 'none', background: 'none', color: '#e02f5b', fontSize: '0.95rem', cursor: 'pointer', boxSizing: 'border-box' }} onClick={removeGroupDp}>
          Remove profile picture
        </button>
      )}
      <button type="button" className="group-dp-menu-row" style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '13px 20px', border: 'none', background: 'none', color: '#1f2933', fontSize: '0.95rem', cursor: 'pointer', boxSizing: 'border-box' }} onClick={() => setGroupDpMenuOpen(false)}>
        Cancel
      </button>
    </div>
  </div>
)}

{/* Member Profile Drawer */}
{memberProfile && (
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
          Member Profile
        </div>
      </div>

      <div
        className="profile-section"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px', gap: '12px' }}
      >
        <img
          src={avatarSrc(memberProfile.photo, 80)}
          alt={nameOf(memberProfile.id, memberProfile.name || 'Someone')}
          onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }}
          style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #ddd' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ fontSize: '17px', fontWeight: '600', color: '#111' }}>{nameOf(memberProfile.id, memberProfile.name || 'Someone')}</div>
          {String(memberProfile.id) === String(user.id) && <span className="group-you-tag">You</span>}
        </div>
        {/* Chat privately: opens a 1:1 conversation with this member. Hidden for
            the viewer's own row (marked "You", not openable). */}
        {String(memberProfile.id) !== String(user.id) && (
          <button
            type="button"
            onClick={chatPrivatelyWithMember}
            style={{
              marginTop: '4px',
              padding: '10px 22px',
              background: '#075e54',
              color: 'white',
              border: 'none',
              borderRadius: '24px',
              fontSize: '0.95rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Chat privately
          </button>
        )}
      </div>

      <div className="section" style={{ padding: '16px', borderTop: '1px solid #eee' }}>
        <div className="section-title" style={{ fontSize: '14px', color: '#333', marginBottom: '12px' }}>
          Member ID
        </div>
        <div style={{ fontSize: '14px', color: '#666', wordBreak: 'break-all' }}>{memberProfile.id || '—'}</div>
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

{/* Unsaved private-chat prompt: shown after "Chat privately" opened a DM
          with a group member who is NOT a saved contact. */}
      {showUnsavedContactPrompt && (
        <div
          style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 20000,
          }}
          onClick={cancelUnsavedPrivatePrompt}
        >
          <div
            style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: '12px', color: '#333' }}>Add Contact</h3>
            <p style={{ color: '#555', lineHeight: '1.5' }}>
              Please add this contact otherwise it will disappear after reload.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
              <button
                onClick={cancelUnsavedPrivatePrompt}
                style={{ padding: '10px 16px', background: '#eef1f4', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={addContactFromUnsavedPrompt}
                style={{ padding: '10px 16px', background: '#075e54', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
              >
                Add Contact
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
    onClick={goBackPage}
  >
    <div
      style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 style={{ marginBottom: '12px', color: '#333' }}>Clear Chat</h3>
      <p style={{ color: '#555', lineHeight: '1.5' }}>
        Are you sure you want to clear all messages with <strong>{nameOf(clearTarget?.chatId, clearTarget?.name)}</strong>? This action cannot be undone.
      </p>
      <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
        <button
          onClick={goBackPage}
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

{/* Leave Group Confirmation Modal */}
{confirmLeave && (
  <div
    style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 20000,
    }}
    onClick={() => setConfirmLeave(null)}
  >
    <div
      style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 style={{ marginBottom: '12px', color: '#333' }}>Leave group</h3>
      <p style={{ color: '#555', lineHeight: '1.5' }}>
        Are you sure you want to leave <strong>{confirmLeave.name || 'this group'}</strong>? You will only see messages until you left, and you can ask an admin to add you back.
      </p>
      <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setConfirmLeave(null)}
          style={{ padding: '10px 16px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px', color: '#333', cursor: 'pointer', fontWeight: 500 }}
        >
          Cancel
        </button>
        <button
          onClick={confirmLeaveGroup}
          style={{ padding: '10px 16px', background: '#e02f5b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
        >
          Leave
        </button>
      </div>
    </div>
  </div>
)}

{/* Sole-admin info popup: shown when the only admin tries to leave. */}
{soleAdminWarning && (
  <div
    style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 20015,
    }}
    onClick={() => setSoleAdminWarning(null)}
  >
    <div
      style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 style={{ marginBottom: '12px', color: '#333' }}>Cannot leave group</h3>
      <p style={{ color: '#555', lineHeight: '1.5' }}>
        You are currently the only admin of <strong>{soleAdminWarning.name || 'this group'}</strong>. Please assign another member as an admin before leaving the group.
      </p>
      <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setSoleAdminWarning(null)}
          style={{ padding: '10px 16px', background: '#075e54', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
        >
          OK
        </button>
      </div>
    </div>
  </div>
)}

{/* In-app Delete chat / Delete group confirmation popup. Replaces the old
    window.confirm so the destructive step is a proper Confirm/Cancel modal
    that works on every screen size (mobile included). */}
{deleteConfirm && (
  <div
    style={{
      position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
      background: 'rgba(0, 0, 0, 0.5)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 20010,
    }}
    onClick={() => setDeleteConfirm(null)}
  >
    <div
      style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '400px', boxShadow: '0 4px 20px rgba(0,0,0,0.2)' }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3 style={{ marginBottom: '12px', color: '#333' }}>
        {deleteConfirm.kind === 'da' || deleteConfirm.kind === 'group' ? 'Delete group' : 'Delete chat'}
      </h3>
      <p style={{ color: '#555', lineHeight: '1.5' }}>
        Are you sure you want to permanently delete <strong>{deleteConfirm.name || 'this chat'}</strong>? This will remove the saved contact from your address book on every device — <strong>{deleteConfirm.kind === 'dm' ? 'you will need to save' : 'the group will be gone from your list'}</strong> before you can chat again.
      </p>
      <div style={{ display: 'flex', gap: '12px', marginTop: '24px', justifyContent: 'flex-end' }}>
        <button
          onClick={() => setDeleteConfirm(null)}
          style={{ padding: '10px 16px', background: '#f0f0f0', border: '1px solid #ddd', borderRadius: '6px', color: '#333', cursor: 'pointer', fontWeight: 500 }}
        >
          Cancel
        </button>
        <button
          onClick={confirmDeleteChat}
          style={{ padding: '10px 16px', background: '#e02f5b', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}
        >
          Delete
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
              onClick={goBackPage}
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
                  <button onClick={() => { setShowMobileMenu(false); setActiveTab('profile'); }}>Profile</button>
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
                    src={first.file || avatarSrc(g.user.photo, 50)}
                    count={g.statuses.length}
                    seen={!hasUnseen}
                  />
                  <div className="status-info">
                    <h4>{nameOf(g.user.id, g.user.name)}</h4>
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
        <img src={call.groupId ? skeletonAvatar() : avatarSrc(call.photo, 50)} alt={nameOf(call.userId, call.name)} />
       <div className="call-info">
  <h4>{call.groupId ? (groupsList.find(g => String(g.id) === String(call.groupId))?.name || 'Group call') : nameOf(call.userId, call.name)}</h4>
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
) : activeTab === 'profile' ? (
  renderProfileArea()
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
      <button
  onClick={() => {
    setShowMobileMenu(false);
    setActiveTab('profile');
  }}
>
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
        <input
          type="text"
          placeholder="Search"
          value={listFilterQuery}
          onChange={(e) => setListFilterQuery(e.target.value)}
        />
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
    {!showGroupFlow && activeTab !== 'profile' && (
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
      <button onClick={() => { setView('chats'); setActiveTab('profile'); }} aria-label="Profile">
        <User size={24} strokeWidth={1.8} />
        <small>Profile</small>
      </button>
    </nav>
    )}
  </div>
{/* Add Contact Drawer */}
{showAddContact && (
  <div
    className="add-contact-drawer-overlay"
    onClick={goBackPage}
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
          onClick={goBackPage}
        >
          Cancel
        </button>
        <h3>New Contact</h3>
        <button
          className="drawer-btn done"
          disabled={!email.trim() || emailLookupStatus !== 'found' || isContactAlreadySaved(emailLookupUser)}
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
              photo: avatarSrc(foundUser.photo, 50),
              lastMsg: '',
              time: '',
              online: false,
            };

            const customName = `${firstName} ${lastName}`.trim();

            // Compute the next address book from contactsRef (kept in sync),
            // update both state and ref so the saved custom name is applied to
            // every surface immediately.
            const cur = contactsRef.current || [];
            const exists = cur.some(c => String(c.id) === String(newContact.id));
            const next = exists
              ? cur.map(c =>
                  String(c.id) === String(newContact.id)
                    ? { ...c, name: customName || c.name, firstName: firstName.trim(), lastName: lastName.trim() }
                    : c
                )
              : [newContact, ...cur];
            contactsRef.current = next;
            setContacts(next);
            if (customName) persistSavedName(newContact.id, customName);

            if (!exists) {
              setMessages(prevMsgs => ({
                ...prevMsgs,
                [newContact.id]: [],
              }));
            }

            // Persist the bound user + optional custom name to the server-side
            // address book so it survives a refresh and shows on every device.
            fetch(`${API_URL}/api/contacts`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${localStorage.getItem('token')}`,
              },
              body: JSON.stringify({ userId: foundUser._id, name: customName || '' }),
            }).catch(err => console.error('Failed to save contact to server', err));

            alert('Contact saved!');
            goBackPage();
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
        {emailLookupUser?.photo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 0 4px' }}>
            <img
              src={emailLookupUser.photo}
              alt=""
              style={{ width: '56px', height: '56px', borderRadius: '50%', objectFit: 'cover', border: '2px solid #ddd' }}
            />
            <div>
              <div style={{ fontSize: '15px', fontWeight: '600', color: '#111' }}>{emailLookupUser.name}</div>
              <div style={{ fontSize: '13px', color: '#666' }}>{emailLookupUser.email}</div>
            </div>
          </div>
        )}
        {email.trim() && /\S+@\S+\.\S+/.test(email.trim()) && (
          <div
            style={{
              fontSize: '13px',
              marginTop: '-4px',
              color: emailLookupStatus === 'found' && isContactAlreadySaved(emailLookupUser)
                ? '#f59e0b'
                : emailLookupStatus === 'found' ? '#22c55e' : emailLookupStatus === 'not-found' ? '#e53935' : '#666',
            }}
          >
            {emailLookupStatus === 'checking' && 'Checking…'}
            {emailLookupStatus === 'found' && isContactAlreadySaved(emailLookupUser) && '✓ Contact already saved'}
            {emailLookupStatus === 'found' && !isContactAlreadySaved(emailLookupUser) && '✓ NexChat user found'}
            {emailLookupStatus === 'not-found' && '✗ No NexChat user with this email'}
          </div>
        )}
      </div>
    </div>
  </div>
)}
{/* ✅ Add this line here */}
<canvas ref={canvasRef} style={{ display: 'none' }} />

{/* Block / Unblock confirmation popup (mobile + desktop) */}
{blockConfirm && (
  <div
    className="new-contact-modal-overlay"
    style={{ zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={() => setBlockConfirm(null)}
  >
    <div
      className="new-contact-modal"
      style={{ maxWidth: '380px', width: '90%' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <h3>{blockConfirm.currentlyBlocked ? 'Unblock' : 'Block'} {blockConfirm.name}?</h3>
      </div>
      <div className="modal-body">
        <p className="block-confirm-body">
          {blockConfirm.currentlyBlocked
            ? `Unblock ${blockConfirm.name}? They will be able to message you and see your profile photo, About and last seen again.`
            : `Block ${blockConfirm.name}? They won't be able to message you or see your profile photo, About and last seen.`}
        </p>
      </div>
      <div className="modal-actions">
        <button className="modal-btn cancel" onClick={() => setBlockConfirm(null)}>
          Cancel
        </button>
        <button
          className={`modal-btn ${blockConfirm.currentlyBlocked ? 'save' : 'danger'}`}
          onClick={() => confirmBlockToggle(blockConfirm.chatId, blockConfirm.currentlyBlocked)}
        >
          {blockConfirm.currentlyBlocked ? 'Unblock' : 'Block'}
        </button>
      </div>
    </div>
  </div>
)}

{/* Report User popup (mobile + desktop) */}
{showReportModal && (
  <div
    className="new-contact-modal-overlay"
    style={{ zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={() => { if (!reportBusy) setShowReportModal(false); }}
  >
    <div
      className="new-contact-modal report-modal"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <h3>Report {nameOf(selectedChat?.id, selectedChat?.name)}</h3>
      </div>
      <div className="modal-body">
        <p className="block-confirm-body">
          Help us understand what happened. Your report is private and will be reviewed by our team.
        </p>
        <textarea
          className="report-textarea"
          placeholder="Describe why you're reporting this user..."
          rows={5}
          maxLength={1000}
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
        />
      </div>
      <div className="modal-actions">
        <button
          className="modal-btn cancel"
          disabled={reportBusy}
          onClick={() => setShowReportModal(false)}
        >
          Cancel
        </button>
        <button
          className="modal-btn danger"
          disabled={reportBusy || !reportReason.trim()}
          onClick={submitReport}
        >
          {reportBusy ? 'Sending…' : 'Submit'}
        </button>
      </div>
    </div>
  </div>
)}

{/* Member management popup: bottom sheet on mobile, anchored dropdown on desktop */}
{memberMenu && (() => {
  const actions = memberActionsFor(memberMenu, selectedGroup);
  const gid = String(selectedGroup?.id || selectedGroup?._id || '');
  const body = (
    <div className="member-actions">
      <div className="member-actions-head">
        <img
          src={memberMenu.memberPhoto}
          alt={memberMenu.memberName}
          style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '2px solid #ddd' }}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.95rem', fontWeight: 600, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {memberMenu.memberName}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#667781' }}>Permissions: {actions.roleLabel}</div>
        </div>
      </div>
      {actions.canMakeAdmin && (
        <button className="member-action-btn" onClick={() => emitMakeGroupAdmin(gid, memberMenu.memberId)}>
          Make admin
        </button>
      )}
      {actions.canDemote && (
        <button className="member-action-btn" onClick={() => emitDemoteAdmin(gid, memberMenu.memberId)}>
          Demote
        </button>
      )}
      {actions.canRemove && (
        <button
          className="member-action-btn danger"
          onClick={() => {
            if (window.confirm(`Remove ${memberMenu.memberName} from this group?`)) {
              emitRemoveGroupMember(gid, memberMenu.memberId);
            } else {
              closeMemberMenu();
            }
          }}
        >
          Remove member
        </button>
      )}
      {!actions.canMakeAdmin && !actions.canRemove && !actions.canDemote && (
        <div className="member-action-note">
          {memberMenu.isCreator ? 'This is the original group creator and cannot be removed.' : 'No available actions for this member.'}
        </div>
      )}
      <button className="member-action-btn cancel" onClick={closeMemberMenu}>Cancel</button>
    </div>
  );
  const closeProps = { onClick: closeMemberMenu };
  return memberMenu.isMobile ? (
    <div className="member-sheet-overlay" {...closeProps}>
      <div
        className="member-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  ) : (
    memberMenu.rect && (
      (() => {
        // Keep the menu on screen: open downward when there's room, otherwise
        // flip it above the three-dot button (helps members near the bottom).
        const MENU_H = 250;
        const fitsBelow = memberMenu.rect.bottom + 10 + MENU_H <= window.innerHeight;
        const pos = fitsBelow
          ? { top: memberMenu.rect.bottom + 6 }
          : { bottom: Math.round(window.innerHeight - memberMenu.rect.top) + 6 };
        return (
          <div
            className="member-dropdown"
            style={{ position: 'fixed', right: memberMenu.rect.right, maxHeight: 'min(60vh, 340px)', overflowY: 'auto', ...pos }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            {body}
          </div>
        );
      })()
    )
  );
})()}

{/* Forward Modal */}
{showForwardModal && (
  <div
    className="new-contact-modal-overlay"
    style={{ zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    onClick={goBackPage}
  >
    <div
      className="new-contact-modal"
      style={{ maxWidth: '420px', width: '90%' }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="modal-header">
        <h3>Forward {selectedMessages.size} message{selectedMessages.size > 1 ? 's' : ''}</h3>
        <button
          onClick={goBackPage}
          style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer' }}
          aria-label="Close forward"
        >
          ✕
        </button>
      </div>

      <div className="modal-body">
        <input
          type="text"
          placeholder="Search name or group"
          value={forwardSearchQuery}
          onChange={(e) => setForwardSearchQuery(e.target.value)}
          className="modal-input"
          style={{ marginBottom: '12px' }}
          autoFocus
        />

        <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
          {/* Contacts */}
          {contacts
            .filter((c) => String(c.id) !== String(selectedChat?.id))
            .filter((c) =>
              c.name?.toLowerCase().includes(forwardSearchQuery.toLowerCase())
            ).length > 0 && (
            <div style={{ fontSize: '0.85rem', color: '#999', marginBottom: '6px' }}>
              Contacts
            </div>
          )}
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
                    src={avatarSrc(contact.photo, 50)}
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

          {/* Groups */}
          {groupsList
            .filter((g) => !selectedGroup || String(g._id || g.id) !== String(selectedGroup.id))
            .filter((g) =>
              g.name?.toLowerCase().includes(forwardSearchQuery.toLowerCase())
            ).length > 0 && (
            <div style={{ fontSize: '0.85rem', color: '#999', marginTop: '10px', marginBottom: '6px' }}>
              Groups
            </div>
          )}
          {groupsList
            .filter((g) => !selectedGroup || String(g._id || g.id) !== String(selectedGroup.id))
            .filter((g) =>
              g.name?.toLowerCase().includes(forwardSearchQuery.toLowerCase())
            )
            .map((group) => {
              const gid = group._id || group.id;
              const isChecked = selectedForwardGroups.has(String(gid));
              return (
                <div
                  key={gid}
                  onClick={() =>
                    setSelectedForwardGroups((prev) => {
                      const next = new Set(prev);
                      const key = String(gid);
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
                    src={group.dp || skeletonAvatar()}
                    alt={group.name}
                    style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
                  />
                  <div>
                    <div style={{ fontWeight: '600' }}>{group.name}</div>
                    <div style={{ fontSize: '0.8rem', color: '#666' }}>
                      {group.memberCount || (group.members?.length || 0)} members
                    </div>
                  </div>
                </div>
              );
            })}

          {contacts.filter(
            (c) =>
              String(c.id) !== String(selectedChat?.id) &&
              c.name?.toLowerCase().includes(forwardSearchQuery.toLowerCase())
          ).length === 0 && groupsList.filter(
            (g) =>
              (!selectedGroup || String(g._id || g.id) !== String(selectedGroup.id)) &&
              g.name?.toLowerCase().includes(forwardSearchQuery.toLowerCase())
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
            {selectedForwardChats.size + selectedForwardGroups.size > 0
              ? `${selectedForwardChats.size + selectedForwardGroups.size} chat${selectedForwardChats.size + selectedForwardGroups.size > 1 ? 's' : ''} selected`
              : 'No chat selected'}
          </span>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={goBackPage}
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
              disabled={selectedForwardChats.size + selectedForwardGroups.size === 0}
              onClick={() => {
                const contactTargets = contacts.filter((c) =>
                  selectedForwardChats.has(String(c.id))
                );
                contactTargets.forEach((t) => forwardSelectedMessages(t, 'contact'));

                const groupTargets = groupsList.filter((g) =>
                  selectedForwardGroups.has(String(g._id || g.id))
                );
                groupTargets.forEach((t) => forwardSelectedMessages(t, 'group'));

                setSelectedForwardChats(new Set());
                setSelectedForwardGroups(new Set());
                setForwardSearchQuery('');
              }}
              style={{
                padding: '8px 18px',
                background: '#075e54',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: '600',
                cursor: selectedForwardChats.size + selectedForwardGroups.size === 0 ? 'not-allowed' : 'pointer',
                opacity: selectedForwardChats.size + selectedForwardGroups.size === 0 ? 0.5 : 1,
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
  <div className="status-action-overlay" onClick={goBackPage}>
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
      <button className="status-action-cancel" onClick={goBackPage}>Cancel</button>
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
      <button className="status-camera-close" onClick={goBackPage} aria-label="Close camera">✕</button>
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
      <button onClick={goBackPage}>Cancel</button>
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
      <button onClick={goBackPage}>Cancel</button>
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
      <button className="status-viewer-close" onClick={goBackPage} aria-label="Close">✕</button>
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
          skeletonAvatar()
        }
        alt={nameOf(viewerUser.user.id, viewerUser.user.name)}
      />
      <div className="status-viewer-meta">
        <strong>{nameOf(viewerUser.user.id, viewerUser.user.name)}</strong>
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
          placeholder={`Reply to ${nameOf(viewerUser.user.id, viewerUser.user.name)}`}
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
      <span className="call-min-name">{nameOf(activeCall.peerId, activeCall.peerName)}</span>
      <span className="call-min-status">
        {activeCall.mode === 'incoming'
          ? 'Incoming call…'
            : activeCall.mode === 'outgoing'
              ? (() => {
                  if (activeCall.group) {
                    const g = groupsList.find(x => String(x.id) === String(activeCall.groupId));
                    const memberIds = (g?.members || []).map(m => String((m?._id || m?.id) || m)).filter(x => x && x !== String(user.id));
                    if (memberIds.length === 0) return 'Ringing…';
                    return memberIds.every(id => onlineUsersRef.current.has(id)) ? 'Ringing…' : 'Calling…';
                  }
                  return onlineUsersRef.current.has(String(activeCall.peerId)) ? 'Ringing…' : 'Calling…';
                })()
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
    {callNotice && <div className="call-notice" role="status">{callNotice}</div>}
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
              const peerName = nameOf(pid, 'Someone');
              return (
                <div key={pid} className="gcall-tile">
                  <video
                    key={pid}
                    ref={(el) => {
                      if (el && el.srcObject !== groupTiles[pid]) el.srcObject = groupTiles[pid];
                      registerAudioEl(el);
                    }}
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
                <img src={activeCall.peerPhoto} alt={nameOf(activeCall.peerId, activeCall.peerName)} onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }} />
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
            ref={(el) => { peerVideoRef.current = el; bindRemoteMedia(el); }}
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
                <img src={activeCall.peerPhoto} alt={nameOf(activeCall.peerId, activeCall.peerName)} onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }} />
              )}
            </div>
          )}
        </>
      )
    )}

    {/* Remote audio element for voice calls: the peer <video> only exists for
        video calls, so without this, a voice call has no element to play the
        remote stream on and the far end is silent. */}
    {activeCall.mode === 'active' && activeCall.type === 'voice' && !activeCall.group && (
      <audio
        ref={(el) => { peerAudioRef.current = el; bindStreamToEl(el, remoteStreamRef.current); }}
        className="call-remote-audio"
        autoPlay
        playsInline
      />
    )}
    {activeCall.mode === 'active' && activeCall.type === 'voice' && activeCall.group && (
      <audio
        ref={(el) => { groupAudioRef.current = el; bindStreamToEl(el, groupVoiceStreamRef.current); }}
        className="call-remote-audio"
        autoPlay
        playsInline
      />
    )}

    {/* Own camera preview / PiP */}
    {activeCall.type === 'video' && (
      <video
        ref={(el) => { ownVideoRef.current = el; initLocalVideo(); }}
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
          <img src={activeCall.peerPhoto} alt={nameOf(activeCall.peerId, activeCall.peerName)} onError={(e) => { e.target.onerror = null; e.target.src = skeletonAvatar(); }} />
        </div>
        <h2>{nameOf(activeCall.peerId, activeCall.peerName)}</h2>
        <p>
          {activeCall.mode === 'outgoing' && (() => {
            if (activeCall.group) {
              const g = groupsList.find(x => String(x.id) === String(activeCall.groupId));
              const memberIds = (g?.members || []).map(m => String((m?._id || m?.id) || m)).filter(x => x && x !== String(user.id));
              const allOnline = memberIds.length > 0 && memberIds.every(id => onlineUsersRef.current.has(id));
              return allOnline ? 'Ringing…' : 'Calling…';
            }
            return onlineUsersRef.current.has(String(activeCall.peerId)) ? 'Ringing…' : 'Calling…';
          })()}
          {activeCall.mode === 'incoming' && 'Incoming video call…'}
          {activeCall.mode !== 'active' && (nameOf(activeCall.peerId, activeCall.peerName) || '') }
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
        <h2>{nameOf(activeCall.peerId, activeCall.peerName)}</h2>
        <span className="call-elapsed">{fmtCallTime(activeCall.elapsed)}</span>
      </div>
    )}

    {/* Voice -> video consent dialog (shown to the user being asked) */}
    {activeCall.mode === 'active' && !activeCall.group && activeCall.videoSwitchPhase === 'requested' && (
      <div className="call-switch-dialog">
        <p>{nameOf(activeCall.peerId, activeCall.peerName)} wants to switch this voice call to a video call.</p>
        <div className="call-switch-actions">
          <button onClick={acceptVideoSwitch} aria-label="Accept video request" className="switch-accept">Accept</button>
          <button onClick={declineVideoSwitch} aria-label="Decline video request" className="switch-decline">Decline</button>
        </div>
      </div>
    )}

    {/* Requester: waiting for the other person's decision */}
    {activeCall.mode === 'active' && !activeCall.group && activeCall.videoSwitchPhase === 'waiting' && (
      <div className="call-switch-waiting">Waiting for {nameOf(activeCall.peerId, activeCall.peerName)} to accept video…</div>
    )}

    {/* Audio-output chooser. Two real choices built from enumerateDevices():
        the current "handset" (earpiece / headset / bluetooth — whatever the
        system is routing to right now) and the loudspeaker. The handset entry
        always shows the name of the device the user is actually on, and
        selecting it routes to the system default so plugging in / taking out a
        headset mid-call re-follows it automatically. */}
    {callSpeakerMenuOpen && (() => {
      const { speakerId, external, systemRouted } = audioOutputsCacheRef.current;
      const onHandset = callSpeakerOutput === '' || external.some((d) => d.deviceId === callSpeakerOutput);
      // The route is Speaker when it points at a loudspeaker, but also when it
      // is the untouched system default and that default is a loudspeaker.
      const activeIsSpeaker = !onHandset || (callSpeakerOutput === '' && callDefaultOut.kind === 'speaker');
      const currentHandsetLabel =
        callDefaultOut.kind === 'handset' && callDefaultOut.name
          ? `Handset (${callDefaultOut.name})`
          : external.length > 0
            ? `Handset (${external[0].label})`
            : 'Handset';
      const entries = [
        { id: 'handset', kind: 'handset', label: currentHandsetLabel, active: !activeIsSpeaker },
        { id: 'speaker', kind: 'speaker', label: 'Speaker', active: activeIsSpeaker },
      ];
      const pick = (o) => {
        if (o.kind === 'handset') {
          const target = callDefaultOut.kind === 'handset' ? '' : external[0] ? external[0].deviceId : '';
          applyAudioOutput(target, target === '' ? 'default' : 'external');
        } else {
          applyAudioOutput(speakerId, 'speaker');
        }
        setCallSpeakerMenuOpen(false);
      };
      return (
        <>
          <div className="call-speaker-backdrop" onClick={() => setCallSpeakerMenuOpen(false)} />
          <div className="call-speaker-menu">
            {entries.map((o) => (
              <button key={o.kind} onClick={() => pick(o)} className={o.active ? 'speaker-active' : ''}>
                <span className="cs-icon">{o.kind === 'speaker' ? '🔊' : '🎧'}</span>
                <span className="cs-label">{o.label}</span>
                {o.active && <span className="cs-active">●</span>}
              </button>
            ))}
            {systemRouted && (
              <div className="call-speaker-note" style={{ padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 12, lineHeight: 1.5, color: 'rgba(255,255,255,0.75)' }}>
                Android sends call audio to whatever is plugged in. Pick Handset for the earbud — to hear on the phone speaker, disconnect the earbud. Browsers can't force the loudspeaker while a headset is connected.
              </div>
            )}
          </div>
        </>
      );
    })()}

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
          {(() => {
            // Icon reflects what is REALLY being used: a loudspeaker when the
            // user picked Speaker OR the system default route is a speaker, and
            // the handset icon whenever a headset/earpiece/bluetooth device is
            // the detected default (or an explicit external pick).
            const onHandset = callSpeakerOutput === '' || audioOutputsCacheRef.current.external.some((d) => d.deviceId === callSpeakerOutput);
            const activeIsSpeaker = !onHandset || (callSpeakerOutput === '' && callDefaultOut.kind === 'speaker');
            return (
              <button className={`call-ctrl ${activeIsSpeaker ? 'speaker-on' : ''}`} onClick={() => setCallSpeakerMenuOpen(true)} aria-label="Audio output">
                {activeIsSpeaker ? <Volume2 size={24} strokeWidth={2} /> : <Headset size={24} strokeWidth={2} />}
              </button>
            );
          })()}
          {activeCall.type === 'voice' && activeCall.mode === 'active' && !activeCall.group && !activeCall.videoSwitchPhase && (
            <button className="call-ctrl" onClick={requestVideoUpgrade} aria-label="Switch to video call"><Video size={24} strokeWidth={2} /></button>
          )}
          {activeCall.type === 'voice' && activeCall.mode === 'active' && activeCall.videoSwitchPhase === 'waiting' && (
            <button className="call-ctrl switch-waiting" disabled aria-label="Switch to video call"><Video size={24} strokeWidth={2} /></button>
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
        <button className="media-viewer-back" onClick={goBackPage} aria-label="Back">‹</button>
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
      <div className="photo-preview-overlay" onClick={goBackPage}>
        <button className="preview-close" onClick={goBackPage} aria-label="Close">✕</button>
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
