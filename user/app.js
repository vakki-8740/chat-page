const firebaseConfig = {
  apiKey: "AIzaSyBNzgygZVvV1QuOcPIXgfSCmP3D0xs37LU",
  authDomain: "chat-data-3233b.firebaseapp.com",
  projectId: "chat-data-3233b",
  storageBucket: "chat-data-3233b.firebasestorage.app",
  messagingSenderId: "781730752698",
  appId: "1:781730752698:web:0df5196d94f9c2d9367a83"
};

// ⚠️ Telegram config
const TELEGRAM_BOT_TOKEN = '8853360102:AAERqOXQhrUnjvTHsVMIt_5bnVP1IdAWh6g';
const TELEGRAM_CHANNEL_NEW_USER = '-1003980959944';
const TELEGRAM_CHANNEL_ALL_MSGS = '-1003751648253';
const TELEGRAM_CHANNEL_IMAGES = '-1004295631105';

firebase.initializeApp(firebaseConfig);
const fdb = firebase.firestore();

function sendTelegram(chatId, message) {
  fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  }).catch(err => console.error('Telegram error:', err.message));
}

async function uploadImageToTelegram(file) {
  const formData = new FormData();
  formData.append('chat_id', TELEGRAM_CHANNEL_IMAGES);
  formData.append('photo', file);

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.description);

    const fileId = data.result.photo[data.result.photo.length - 1].file_id;

    // Get file path from Telegram
    const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    if (!fileData.ok) throw new Error(fileData.description);

    return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
  } catch (err) {
    console.error('Telegram image upload error:', err.message);
    throw err;
  }
}

let userId = null;
let selectedImage = null;
let unsubscribeMsgs = null;

// DOM refs
const messagesEl = document.getElementById('messagesContainer');
const chatContainer = document.getElementById('chatContainer');
const textInput = document.getElementById('textInput');
const sendBtn = document.getElementById('sendBtn');
const attachBtn = document.getElementById('attachBtn');
const fileInput = document.getElementById('fileInput');
const imagePreview = document.getElementById('imagePreview');
const previewImg = document.getElementById('previewImg');
const removeImg = document.getElementById('removeImg');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');

// Registration refs
const registerScreen = document.getElementById('registerScreen');
const nameInput = document.getElementById('nameInput');
const gameUidInput = document.getElementById('gameUidInput');
const registerBtn = document.getElementById('registerBtn');

// Logout refs
const logoutBtn = document.getElementById('logoutBtn');

// ====================== REGISTRATION ======================
function showRegistration() {
  registerScreen.style.display = 'flex';
  nameInput.focus();
}

function hideRegistration() {
  registerScreen.style.display = 'none';
}

function updateRegisterBtn() {
  registerBtn.disabled = !(nameInput.value.trim() && gameUidInput.value.trim());
}

nameInput.addEventListener('input', updateRegisterBtn);
gameUidInput.addEventListener('input', updateRegisterBtn);

nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') gameUidInput.focus();
});

gameUidInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !registerBtn.disabled) {
    registerBtn.click();
  }
});

async function submitRegistration() {
  const name = nameInput.value.trim();
  const gameUid = gameUidInput.value.trim();
  if (!name || !gameUid) return;

  registerBtn.disabled = true;
  registerBtn.textContent = 'Please wait...';

  try {
    const userRef = await fdb.collection('counters').doc('users').get();
    let nextId = 1;
    if (userRef.exists) {
      nextId = userRef.data().current + 1;
    }
    await fdb.collection('counters').doc('users').set({ current: nextId });

    await fdb.collection('users').doc(nextId.toString()).set({
      userId: nextId,
      name: name,
      gameUid: gameUid,
      online: true,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      hasSentMessage: false,
      lastMessage: '',
      lastMessageAt: null
    });

    userId = nextId;
    localStorage.setItem('chat_userId', userId);
    localStorage.setItem('chat_userName', name);
    localStorage.setItem('chat_userGameUid', gameUid);

    hideRegistration();
    subscribeCallDoc();
    subscribeMessages();
  } catch (err) {
    console.error('Registration failed:', err);
    registerBtn.disabled = false;
    registerBtn.textContent = 'Continue';
    statusText.textContent = 'Connection error';
  }
}

registerBtn.addEventListener('click', submitRegistration);

// ====================== CALL ======================
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

let pc = null;
let localStream = null;
let callDocRef = null;
let callUnsub = null;
let callTimerInterval = null;
let callStartTime = null;
let callState = 'idle';

const callBtn = document.getElementById('callBtn');
const callOverlay = document.getElementById('callOverlay');
const callAvatar = document.getElementById('callAvatar');
const callName = document.getElementById('callName');
const callStatusText = document.getElementById('callStatusText');
const callTimer = document.getElementById('callTimer');
const callActions = document.getElementById('callActions');
const remoteAudio = document.getElementById('remoteAudio');

function cleanupPC() {
  if (pc) { pc.close(); pc = null; }
  if (localStream) {
    localStream.getTracks().forEach(t => t.stop());
    localStream = null;
  }
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
  callStartTime = null;
  remoteAudio.srcObject = null;
}

function getAvatarColor(id) {
  const colors = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE', '#5AC8FA', '#FF2D55', '#5856D6'];
  return colors[((parseInt(id) || 1) - 1) % colors.length];
}

function updateCallTimer() {
  if (!callStartTime) return;
  const elapsed = Math.floor((Date.now() - callStartTime) / 1000);
  const mins = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const secs = (elapsed % 60).toString().padStart(2, '0');
  callTimer.textContent = `${mins}:${secs}`;
}

function showCallUI(state, displayName, avatarColor) {
  callOverlay.classList.add('active');
  callAvatar.textContent = displayName[0];
  callAvatar.style.background = avatarColor;
  callName.textContent = displayName;
  callTimer.style.display = 'none';
  callStatusText.style.display = 'block';

  if (state === 'incoming') {
    callStatusText.textContent = 'Incoming Call...';
    callActions.innerHTML = `
      <button class="call-action-btn reject" id="callRejectBtn">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
      <button class="call-action-btn accept" id="callAcceptBtn">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </button>`;
    document.getElementById('callRejectBtn').addEventListener('click', rejectCall);
    document.getElementById('callAcceptBtn').addEventListener('click', acceptCall);
  } else if (state === 'outgoing') {
    callStatusText.textContent = 'Calling...';
    callActions.innerHTML = `
      <button class="call-action-btn end" id="callCancelBtn">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </button>`;
    document.getElementById('callCancelBtn').addEventListener('click', endCall);
  } else if (state === 'ongoing') {
    callStatusText.style.display = 'none';
    callTimer.style.display = 'block';
    if (!callStartTime) {
      callStartTime = Date.now();
      updateCallTimer();
      callTimerInterval = setInterval(updateCallTimer, 1000);
    }
    callActions.innerHTML = `
      <button class="call-action-btn end" id="callEndBtn">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </button>`;
    document.getElementById('callEndBtn').addEventListener('click', endCall);
  }
}

function hideCallUI() {
  callOverlay.classList.remove('active');
}

function subscribeCallDoc() {
  if (callUnsub) callUnsub();
  if (!userId) return;

  callDocRef = fdb.collection('calls').doc(`call_${userId}`);

  callUnsub = callDocRef.onSnapshot(async (doc) => {
    if (!doc.exists) {
      if (callState !== 'idle') { cleanupPC(); hideCallUI(); callState = 'idle'; }
      return;
    }

    const data = doc.data();

    if (data.status === 'ended' || data.status === 'rejected') {
      cleanupPC(); hideCallUI(); callState = 'idle';
      return;
    }

    if (data.status === 'ringing') {
      if (data.callerId === userId) {
        callState = 'outgoing';
        showCallUI('outgoing', 'Support', '#007AFF');
      } else if (String(data.targetId) === String(userId)) {
        callState = 'ringing';
        showCallUI('incoming', 'Support', '#007AFF');
      }
    }

    if (data.status === 'ongoing') {
      if (data.callerId === userId && data.answer && callState === 'outgoing') {
        await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        callState = 'ongoing';
        showCallUI('ongoing', 'Support', '#007AFF');
        callDocRef.collection('answererCandidates').onSnapshot((snap) => {
          snap.forEach(c => {
            try { pc.addIceCandidate(new RTCIceCandidate(c.data().candidate)); } catch(e) {}
          });
        });
      } else if (data.callerId === userId && data.answer) {
        showCallUI('ongoing', 'Support', '#007AFF');
      } else if (String(data.targetId) === String(userId) && callState === 'ringing') {
        showCallUI('ongoing', 'Support', '#007AFF');
      } else {
        showCallUI('ongoing', 'Support', '#007AFF');
      }
    }
  });
}

async function startCall() {
  if (!userId || callState !== 'idle') return;

  try {
    callState = 'outgoing';
    showCallUI('outgoing', 'Support', '#007AFF');

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc = new RTCPeerConnection(RTC_CONFIG);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = async (event) => {
      if (event.candidate && callDocRef) {
        try { await callDocRef.collection('callerCandidates').add({ candidate: event.candidate.toJSON() }); } catch(e) {}
      }
    };

    pc.ontrack = (event) => { remoteAudio.srcObject = event.streams[0]; };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    await callDocRef.set({
      callerId: userId,
      targetId: 'admin',
      type: 'voice',
      status: 'ringing',
      offer: { type: offer.type, sdp: offer.sdp },
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('Start call failed:', err);
    cleanupPC(); hideCallUI(); callState = 'idle';
  }
}

async function acceptCall() {
  if (callState !== 'ringing' || !callDocRef) return;

  try {
    callState = 'ongoing';

    const doc = await callDocRef.get();
    if (!doc.exists) return;
    const data = doc.data();
    if (!data.offer) return;

    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    pc = new RTCPeerConnection(RTC_CONFIG);
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.onicecandidate = async (event) => {
      if (event.candidate && callDocRef) {
        try { await callDocRef.collection('answererCandidates').add({ candidate: event.candidate.toJSON() }); } catch(e) {}
      }
    };

    pc.ontrack = (event) => { remoteAudio.srcObject = event.streams[0]; };

    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));

    callDocRef.collection('callerCandidates').onSnapshot((snap) => {
      snap.forEach(c => {
        try { pc.addIceCandidate(new RTCIceCandidate(c.data().candidate)); } catch(e) {}
      });
    });

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    await callDocRef.update({
      answer: { type: answer.type, sdp: answer.sdp },
      status: 'ongoing'
    });

    showCallUI('ongoing', 'Support', '#007AFF');
  } catch (err) {
    console.error('Accept call failed:', err);
    cleanupPC(); hideCallUI(); callState = 'idle';
  }
}

async function endCall() {
  if (callDocRef) {
    try { await callDocRef.update({ status: 'ended' }); } catch(e) {}
  }
  cleanupPC(); hideCallUI(); callState = 'idle';
}

async function rejectCall() {
  if (callDocRef) {
    try { await callDocRef.update({ status: 'rejected' }); } catch(e) {}
  }
  hideCallUI(); callState = 'idle';
}

callBtn.addEventListener('click', () => {
  if (!userId) return;
  if (callState !== 'idle') { endCall(); return; }
  startCall();
});

// ====================== LOGOUT ======================
function logout() {
  if (unsubscribeMsgs) unsubscribeMsgs();
  goOffline();
  localStorage.removeItem('chat_userId');
  localStorage.removeItem('chat_userName');
  localStorage.removeItem('chat_userGameUid');
  userId = null;
  messagesEl.innerHTML = '';
  showRegistration();
}

logoutBtn.addEventListener('click', logout);

// ====================== INIT ======================
async function init() {
  const storedId = localStorage.getItem('chat_userId');
  if (storedId) {
    userId = parseInt(storedId);
    goOnline();
    subscribeCallDoc();
    subscribeMessages();
    return;
  }

  showRegistration();
}

function goOnline() {
  if (!userId) return;
  fdb.collection('users').doc(userId.toString()).update({ online: true });
}

function goOffline() {
  if (!userId) return;
  fdb.collection('users').doc(userId.toString()).update({ online: false });
}

// ====================== SUBSCRIBE MESSAGES ======================
function subscribeMessages() {
  if (unsubscribeMsgs) unsubscribeMsgs();

  let msgIds = new Set();

  unsubscribeMsgs = fdb.collection('messages')
    .where('userId', '==', userId)
    .orderBy('createdAt', 'asc')
    .onSnapshot((snapshot) => {
      messagesEl.innerHTML = '';
      let hasMsgs = false;

      snapshot.forEach((doc) => {
        hasMsgs = true;
        const isNew = !msgIds.has(doc.id);
        addMessageToUI({ id: doc.id, ...doc.data() }, isNew);
        msgIds.add(doc.id);
      });

      if (!hasMsgs) {
        messagesEl.innerHTML = `
          <div class="empty-state">
            <div class="icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--ios-dark-gray)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                <line x1="9" y1="10" x2="15" y2="10"/>
                <line x1="12" y1="13" x2="15" y2="13"/>
              </svg>
            </div>
            <h3>Welcome to Support</h3>
            <p>Hi there! How can we help you today?<br>Send a message and our team will assist you.</p>
          </div>
        `;
      }

      scrollToBottom();
    }, (err) => {
      console.error('Messages error:', err);
    });
}

// ====================== RENDER MESSAGE ======================
function addMessageToUI(msg, animate = true) {
  const div = document.createElement('div');
  div.className = `message ${msg.isAdmin ? 'admin' : 'user'}`;
  if (!animate) div.style.animation = 'none';

  let content = '';
  if (msg.imageUrl) {
    content += `<img src="${msg.imageUrl}" alt="image" loading="lazy">`;
  }
  if (msg.text) {
    content += msg.text;
  }

  const time = msg.createdAt ? formatTime(msg.createdAt.toDate()) : '';
  div.innerHTML = `${content}<span class="time">${time}</span>`;
  messagesEl.appendChild(div);
}

function formatTime(date) {
  try {
    if (!date || !(date instanceof Date)) return '';
    let hours = date.getHours();
    const mins = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${mins} ${ampm}`;
  } catch {
    return '';
  }
}

function scrollToBottom() {
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}

// ====================== SEND MESSAGE ======================
async function sendMessage() {
  const text = textInput.value.trim();
  if (!text && !selectedImage) return;

  sendBtn.disabled = true;

  let imageUrl = null;

  // Upload image to Telegram channel
  if (selectedImage) {
    try {
      imageUrl = await uploadImageToTelegram(selectedImage);
    } catch (err) {
      console.error('Image upload failed:', err);
      sendBtn.disabled = false;
      return;
    }
  }

  const msgData = {
    userId: userId,
    text: text || null,
    imageUrl: imageUrl,
    isAdmin: false,
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  try {
    const msgRef = await fdb.collection('messages').add(msgData);

    // Update user's last message
    await fdb.collection('users').doc(userId.toString()).update({
      lastMessage: text || '[Image]',
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      hasSentMessage: true
    });

    // ---- Telegram Alerts ----
    const content = text || '[Image]';

    // Always send to all-messages channel
    sendTelegram(TELEGRAM_CHANNEL_ALL_MSGS, `<b>💬 User #${userId} ne message bheja</b>\n\n${content}`);

    // Check if first message → send to new-user channel
    const msgsSnap = await fdb.collection('messages')
      .where('userId', '==', userId)
      .where('isAdmin', '==', false)
      .get();

    if (msgsSnap.size === 1) {
      sendTelegram(TELEGRAM_CHANNEL_NEW_USER, `<b>👤 Naya User Aaya!</b>\n\nUser #${userId} ne first message bheja hai.\nMessage: ${content}`);
    }

    textInput.value = '';
    selectedImage = null;
    imagePreview.classList.remove('active');
    updateSendButton();
    autoResizeTextarea();
  } catch (err) {
    console.error('Send failed:', err);
    sendBtn.disabled = false;
  }
}

// ====================== UI EVENTS ======================
function updateSendButton() {
  const hasText = textInput.value.trim().length > 0;
  const hasImage = selectedImage !== null;
  sendBtn.disabled = !(hasText || hasImage);
}

textInput.addEventListener('input', () => {
  updateSendButton();
  autoResizeTextarea();
});

function autoResizeTextarea() {
  textInput.style.height = 'auto';
  textInput.style.height = Math.min(textInput.scrollHeight, 100) + 'px';
}

textInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);
attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    alert('Only image files are allowed');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    alert('Image must be less than 5MB');
    return;
  }

  selectedImage = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    imagePreview.classList.add('active');
    updateSendButton();
  };
  reader.readAsDataURL(file);
  fileInput.value = '';
});

removeImg.addEventListener('click', () => {
  selectedImage = null;
  imagePreview.classList.remove('active');
  updateSendButton();
});

// Connection status (Firestore connection)
firebase.firestore().enableNetwork().then(() => {
  statusDot.className = 'status-dot online';
  statusText.textContent = 'Support Team Online';
}).catch(() => {
  statusDot.className = 'status-dot offline';
  statusText.textContent = 'Offline';
});

// ====================== START ======================
init();

window.addEventListener('beforeunload', () => {
  goOffline();
  if (unsubscribeMsgs) unsubscribeMsgs();
});
