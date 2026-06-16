const firebaseConfig = {
  apiKey: "AIzaSyBNzgygZVvV1QuOcPIXgfSCmP3D0xs37LU",
  authDomain: "chat-data-3233b.firebaseapp.com",
  projectId: "chat-data-3233b",
  storageBucket: "chat-data-3233b.firebasestorage.app",
  messagingSenderId: "781730752698",
  appId: "1:781730752698:web:0df5196d94f9c2d9367a83"
};

const TELEGRAM_BOT_TOKEN = '8853360102:AAERqOXQhrUnjvTHsVMIt_5bnVP1IdAWh6g';
const TELEGRAM_CHANNEL_NEW_USER = '-1003980959944';
const TELEGRAM_CHANNEL_ALL_MSGS = '-1003751648253';
const TELEGRAM_CHANNEL_IMAGES = '-1004295631105';

firebase.initializeApp(firebaseConfig);
const fdb = firebase.firestore();

let userId = null;
let userData = null;
let selectedImage = null;
let unsubscribeMsgs = null;
let loginAttempts = 0;

// DOM - Login
const loginScreen = document.getElementById('loginScreen');
const usernameInput = document.getElementById('usernameInput');
const passwordInput = document.getElementById('passwordInput');
const loginNextBtn = document.getElementById('loginNextBtn');
const loginError = document.getElementById('loginError');

// DOM - Chat
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

// DOM - Profile
const profileScreen = document.getElementById('profileScreen');
const profileLogo = document.getElementById('profileLogo');
const profileNameTitle = document.getElementById('profileNameTitle');
const profileUsername = document.getElementById('profileUsername');
const profileUid = document.getElementById('profileUid');
const profileNewUsername = document.getElementById('profileNewUsername');
const profileCurPassword = document.getElementById('profileCurPassword');
const profileNewPassword = document.getElementById('profileNewPassword');
const profileSaveBtn = document.getElementById('profileSaveBtn');
const profileMsg = document.getElementById('profileMsg');
const profileLogoutBtn = document.getElementById('profileLogoutBtn');
const profileBackBtn = document.getElementById('profileBackBtn');
const profileBtn = document.getElementById('profileBtn');

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

    const fileRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileData = await fileRes.json();
    if (!fileData.ok) throw new Error(fileData.description);

    return `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${fileData.result.file_path}`;
  } catch (err) {
    console.error('Telegram image upload error:', err.message);
    throw err;
  }
}

// ====================== LOGIN / REGISTER ======================
function updateLoginBtn() {
  loginNextBtn.disabled = !(usernameInput.value.trim() && passwordInput.value.trim());
}

usernameInput.addEventListener('input', updateLoginBtn);
passwordInput.addEventListener('input', updateLoginBtn);

usernameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') passwordInput.focus();
});

passwordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !loginNextBtn.disabled) loginNextBtn.click();
});

function showLogin() {
  loginScreen.style.display = 'flex';
  loginError.style.display = 'none';
  usernameInput.focus();
}

function hideLogin() {
  loginScreen.style.display = 'none';
}

function showLoginError(msg) {
  loginError.textContent = msg;
  loginError.style.display = 'block';
}

async function fetchRandomLogo() {
  try {
    const res = await fetch('./url-images.txt');
    const text = await res.text();
    const urls = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
    if (urls.length === 0) return null;
    return urls[Math.floor(Math.random() * urls.length)];
  } catch (err) {
    console.error('Failed to fetch logos:', err);
    return null;
  }
}

async function handleLogin() {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  if (!username || !password) return;

  loginNextBtn.disabled = true;
  loginNextBtn.textContent = 'Please wait...';
  loginError.style.display = 'none';

  try {
    const snap = await fdb.collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();

    if (snap.empty) {
      const logo = await fetchRandomLogo();
      const userRef = await fdb.collection('counters').doc('users').get();
      let nextId = 1;
      if (userRef.exists) {
        nextId = userRef.data().current + 1;
      }
      await fdb.collection('counters').doc('users').set({ current: nextId });

      await fdb.collection('users').doc(nextId.toString()).set({
        userId: nextId,
        username: username,
        name: username,
        password: password,
        logo: logo,
        online: true,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        hasSentMessage: false,
        lastMessage: '',
        lastMessageAt: null
      });

      userId = nextId;
      userData = { username, name: username, logo, userId: nextId };
      localStorage.setItem('chat_userId', userId);

      hideLogin();
      subscribeCallDoc();
      subscribeMessages();
    } else {
      const doc = snap.docs[0];
      const data = doc.data();
      if (data.password !== password) {
        showLoginError('Wrong password. Try again.');
        loginNextBtn.disabled = false;
        loginNextBtn.textContent = 'Next';
        return;
      }

      userId = data.userId;
      userData = data;
      localStorage.setItem('chat_userId', userId);

      await fdb.collection('users').doc(userId.toString()).update({ online: true });

      hideLogin();
      subscribeCallDoc();
      subscribeMessages();
    }
  } catch (err) {
    console.error('Login failed:', err);
    showLoginError('Connection error. Please try again.');
    loginNextBtn.disabled = false;
    loginNextBtn.textContent = 'Next';
  }
}

loginNextBtn.addEventListener('click', handleLogin);

// ====================== PROFILE ======================
function showProfile() {
  if (!userData) return;
  const logoUrl = userData.logo;
  if (logoUrl) {
    profileLogo.innerHTML = `<img src="${logoUrl}" alt="logo">`;
  } else {
    profileLogo.innerHTML = `<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--ios-blue)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
  }
  profileNameTitle.textContent = userData.username || `User #${userId}`;
  profileUsername.textContent = userData.username || '-';
  profileUid.textContent = `#${userId}`;
  profileNewUsername.value = '';
  profileCurPassword.value = '';
  profileNewPassword.value = '';
  profileMsg.style.display = 'none';
  profileScreen.style.display = 'flex';
}

function hideProfile() {
  profileScreen.style.display = 'none';
}

profileBtn.addEventListener('click', showProfile);
profileBackBtn.addEventListener('click', hideProfile);

async function saveProfileChanges() {
  const newUsername = profileNewUsername.value.trim();
  const curPassword = profileCurPassword.value.trim();
  const newPassword = profileNewPassword.value.trim();

  if (!curPassword) {
    profileMsg.textContent = 'Please enter current password';
    profileMsg.style.color = 'var(--ios-red)';
    profileMsg.style.display = 'block';
    return;
  }

  if (!newUsername && !newPassword) {
    profileMsg.textContent = 'No changes to save';
    profileMsg.style.color = 'var(--ios-subtext)';
    profileMsg.style.display = 'block';
    return;
  }

  profileSaveBtn.disabled = true;
  profileSaveBtn.textContent = 'Saving...';
  profileMsg.style.display = 'none';

  try {
    const userRef = fdb.collection('users').doc(userId.toString());
    const doc = await userRef.get();
    if (!doc.exists) {
      profileMsg.textContent = 'User not found';
      profileMsg.style.color = 'var(--ios-red)';
      profileMsg.style.display = 'block';
      profileSaveBtn.disabled = false;
      profileSaveBtn.textContent = 'Save Changes';
      return;
    }

    const data = doc.data();
    if (data.password !== curPassword) {
      profileMsg.textContent = 'Current password is wrong';
      profileMsg.style.color = 'var(--ios-red)';
      profileMsg.style.display = 'block';
      profileSaveBtn.disabled = false;
      profileSaveBtn.textContent = 'Save Changes';
      return;
    }

    const updates = {};
    if (newUsername) {
      const existing = await fdb.collection('users')
        .where('username', '==', newUsername)
        .get();
      let taken = false;
      existing.forEach(doc => { if (doc.id !== userId.toString()) taken = true; });
      if (taken) {
        profileMsg.textContent = 'Username already taken';
        profileMsg.style.color = 'var(--ios-red)';
        profileMsg.style.display = 'block';
        profileSaveBtn.disabled = false;
        profileSaveBtn.textContent = 'Save Changes';
        return;
      }
      updates.username = newUsername;
      updates.name = newUsername;
      userData.username = newUsername;
      userData.name = newUsername;
    }
    if (newPassword) {
      updates.password = newPassword;
    }

    await userRef.update(updates);
    profileMsg.textContent = 'Changes saved successfully!';
    profileMsg.style.color = 'var(--ios-green)';
    profileMsg.style.display = 'block';

    profileNewUsername.value = '';
    profileCurPassword.value = '';
    profileNewPassword.value = '';
    profileNameTitle.textContent = userData.username || `User #${userId}`;
    profileUsername.textContent = userData.username || '-';
  } catch (err) {
    console.error('Save failed:', err);
    profileMsg.textContent = 'Error saving changes';
    profileMsg.style.color = 'var(--ios-red)';
    profileMsg.style.display = 'block';
  }

  profileSaveBtn.disabled = false;
  profileSaveBtn.textContent = 'Save Changes';
}

profileSaveBtn.addEventListener('click', saveProfileChanges);

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
function handleLogout() {
  if (unsubscribeMsgs) unsubscribeMsgs();
  if (callUnsub) callUnsub();
  goOffline();
  localStorage.removeItem('chat_userId');
  userId = null;
  userData = null;
  messagesEl.innerHTML = '';
  hideProfile();
  showLogin();
  loginNextBtn.disabled = true;
  loginNextBtn.textContent = 'Next';
  usernameInput.value = '';
  passwordInput.value = '';
}

profileLogoutBtn.addEventListener('click', handleLogout);

// ====================== INIT ======================
async function init() {
  const storedId = localStorage.getItem('chat_userId');
  if (storedId) {
    userId = parseInt(storedId);
    try {
      const doc = await fdb.collection('users').doc(storedId).get();
      if (doc.exists) {
        userData = doc.data();
        goOnline();
        subscribeCallDoc();
        subscribeMessages();
        return;
      }
    } catch (e) {
      console.error('Auto-login failed:', e);
    }
    localStorage.removeItem('chat_userId');
    userId = null;
  }
  showLogin();
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

    await fdb.collection('users').doc(userId.toString()).update({
      lastMessage: text || '[Image]',
      lastMessageAt: firebase.firestore.FieldValue.serverTimestamp(),
      hasSentMessage: true
    });

    const content = text || '[Image]';
    sendTelegram(TELEGRAM_CHANNEL_ALL_MSGS, `<b>💬 User #${userId} (${userData?.username || 'unknown'}) ne message bheja</b>\n\n${content}`);

    const msgsSnap = await fdb.collection('messages')
      .where('userId', '==', userId)
      .where('isAdmin', '==', false)
      .get();

    if (msgsSnap.size === 1) {
      const nameStr = userData?.username || `User #${userId}`;
      sendTelegram(TELEGRAM_CHANNEL_NEW_USER, `<b>👤 Naya User Aaya!</b>\n\n${nameStr} ne first message bheja hai.\nMessage: ${content}`);
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
