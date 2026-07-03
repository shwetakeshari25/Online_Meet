import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { BACKEND_URL } from '../config';
import { 
  Mic, MicOff, Video as Cam, VideoOff, PhoneOff, 
  Share2, MessageSquare, BarChart2, Globe, Sparkles, 
  Send, Laptop, Smartphone, AlertCircle, Award, 
  CheckCircle, FileText, UserPlus
} from 'lucide-react';
import confetti from 'canvas-confetti';

function MeetingRoom({ user, roomId, isCopilotMode, onLeave }) {
  const [socket, setSocket] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [activeTab, setActiveTab] = useState('chat');
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  
  // Media States
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [localStream, setLocalStream] = useState(null);
  const [deviceType, setDeviceType] = useState('Desktop/Laptop');

  // Live AI translation selection
  const [translationLang, setTranslationLang] = useState('en');
  const [translatingTextId, setTranslatingTextId] = useState(null);

  // Meeting ending summary report modal
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState(null);

  // Admit/Deny Host Approval States
  const [isAdmitted, setIsAdmitted] = useState(false);
  const [isWaitingApproval, setIsWaitingApproval] = useState(false);
  const [isDenied, setIsDenied] = useState(false);
  const [joinRequests, setJoinRequests] = useState([]);

  // Hardware Active Duration tracking
  const [micOnDuration, setMicOnDuration] = useState(0);
  const [micOffDuration, setMicOffDuration] = useState(0);
  const [camOnDuration, setCamOnDuration] = useState(0);
  const [camOffDuration, setCamOffDuration] = useState(0);
  const [micOnCount, setMicOnCount] = useState(1); // Mic starts enabled
  const [micOffCount, setMicOffCount] = useState(0);

  // Speech Recognition Language state
  const [speechLang, setSpeechLang] = useState('en-US');

  // Refs
  const localVideoRef = useRef(null);
  const peersRef = useRef({});
  const [remoteStreams, setRemoteStreams] = useState({});
  const recognitionRef = useRef(null);
  const animationFrameRef = useRef(null);
  const endTimeoutRef = useRef(null);

  // 1. Detect Device Type on load
  useEffect(() => {
    const ua = navigator.userAgent;
    const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
    setDeviceType(isMobile ? 'Mobile/Phone' : 'Desktop/Laptop');
  }, []);

  // 2. Setup Local Media (Camera/Mic with Mock Canvas Fallback)
  useEffect(() => {
    let activeStream = null;
    let canvas = null;
    let ctx = null;
    
    const initializeMedia = async () => {
      if (isCopilotMode) {
        const dummyStream = new MediaStream();
        activeStream = dummyStream;
        setLocalStream(dummyStream);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 360 },
          audio: true
        });
        activeStream = stream;
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.warn("Camera/Mic blocked or not found. Initializing animated mock stream fallback...", err);
        
        const fallbackStream = new MediaStream();

        try {
          canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 360;
          ctx = canvas.getContext('2d');
          
          let frameCount = 0;
          
          const drawMockFrame = () => {
            if (!ctx) return;
            ctx.fillStyle = '#FCF8EE';
            ctx.fillRect(0, 0, 640, 360);
            
            ctx.fillStyle = '#EDF3EC';
            ctx.beginPath();
            ctx.arc(320, 180, 100, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#4A7A5D';
            ctx.beginPath();
            ctx.arc(320, 150, 40, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.ellipse(320, 240, 60, 40, 0, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 36px Outfit';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const initials = user.name ? user.name.substring(0, 2).toUpperCase() : 'ME';
            ctx.fillText(initials, 320, 150);
            
            ctx.fillStyle = '#1E293B';
            ctx.font = '16px Inter';
            ctx.fillText(`${user.name} (Live Feed Fallback)`, 320, 290);
            ctx.font = '12px Inter';
            ctx.fillStyle = '#64748B';
            ctx.fillText("Webcam/Mic Not Detected", 320, 310);
            
            frameCount++;
            animationFrameRef.current = requestAnimationFrame(drawMockFrame);
          };
          
          drawMockFrame();
          
          const captureFn = canvas.captureStream || canvas.webkitCaptureStream;
          if (captureFn) {
            const canvasStream = captureFn.call(canvas, 25);
            if (canvasStream && canvasStream.getVideoTracks().length > 0) {
              fallbackStream.addTrack(canvasStream.getVideoTracks()[0]);
            }
          }
        } catch (canvasErr) {
          console.warn("Could not capture canvas stream track:", canvasErr);
        }
        
        try {
          const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
          const destination = audioCtx.createMediaStreamDestination();
          const silentAudioTrack = destination.stream.getAudioTracks()[0];
          if (silentAudioTrack) {
            fallbackStream.addTrack(silentAudioTrack);
          }
        } catch (audioErr) {
          console.warn("Could not create mock audio context:", audioErr);
        }
        
        activeStream = fallbackStream;
        setLocalStream(fallbackStream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = fallbackStream;
        }
      }
    };

    initializeMedia();

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [user.name]);

  // 3. Connect Socket.io and join room
  useEffect(() => {
    if (!localStream) return;

    const newSocket = io(BACKEND_URL);
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to meeting socket, joining room:', roomId);
      newSocket.emit('join-meeting', {
        roomId,
        name: user.name,
        email: user.email || '',
        device: deviceType
      });
    });

    newSocket.on('room-users', ({ users, transcript }) => {
      setParticipants(users);
      if (transcript && transcript.length > 0) {
        setMessages(transcript);
      }
    });

    newSocket.on('updated-users', (users) => {
      setParticipants(users);
    });

    newSocket.on('chat-message', (msg) => {
      setMessages(prev => [...prev, msg]);
      
      const chatArea = document.getElementById('chat-scroll-box');
      if (chatArea) {
        setTimeout(() => {
          chatArea.scrollTop = chatArea.scrollHeight;
        }, 100);
      }
    });

    newSocket.on('user-connected', async ({ socketId, name, device }) => {
      console.log(`New user connected: ${name} (${socketId}) on ${device}`);
      if (isCopilotMode) return;
      const pc = createPeerConnection(socketId, newSocket);
      peersRef.current[socketId] = pc;
      
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        newSocket.emit('webrtc-offer', {
          targetSocketId: socketId,
          offer
        });
      } catch (err) {
        console.error("Error creating WebRTC offer:", err);
      }
    });

    newSocket.on('webrtc-offer', async ({ senderSocketId, offer }) => {
      console.log("Received WebRTC offer from:", senderSocketId);
      if (isCopilotMode) return;
      const pc = createPeerConnection(senderSocketId, newSocket);
      peersRef.current[senderSocketId] = pc;
      
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        newSocket.emit('webrtc-answer', {
          targetSocketId: senderSocketId,
          answer
        });
      } catch (err) {
        console.error("Error handling WebRTC offer:", err);
      }
    });

    newSocket.on('webrtc-answer', async ({ senderSocketId, answer }) => {
      if (isCopilotMode) return;
      const pc = peersRef.current[senderSocketId];
      if (pc) {
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (err) {
          console.error("Error handling WebRTC answer:", err);
        }
      }
    });

    newSocket.on('webrtc-candidate', ({ senderSocketId, candidate }) => {
      if (isCopilotMode) return;
      const pc = peersRef.current[senderSocketId];
      if (pc) {
        try {
          pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("Error adding ICE candidate:", err);
        }
      }
    });

    newSocket.on('user-disconnected-signal', (socketId) => {
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].close();
        delete peersRef.current[socketId];
      }
      setRemoteStreams(prev => {
        const copy = { ...prev };
        delete copy[socketId];
        return copy;
      });
    });

    newSocket.on('waiting-approval', () => {
      setIsWaitingApproval(true);
      setIsAdmitted(false);
    });

    newSocket.on('joined-successfully', () => {
      setIsAdmitted(true);
      setIsWaitingApproval(false);
    });

    newSocket.on('join-denied', () => {
      setIsDenied(true);
      setIsAdmitted(false);
      setIsWaitingApproval(false);
    });

    newSocket.on('join-request', ({ socketId, name }) => {
      setJoinRequests(prev => {
        if (prev.some(r => r.socketId === socketId)) return prev;
        return [...prev, { socketId, name }];
      });
    });

    newSocket.on('meeting-ended-report', (report) => {
      if (endTimeoutRef.current) {
        clearTimeout(endTimeoutRef.current);
        endTimeoutRef.current = null;
      }
      setReportData(report);
      setShowReport(true);
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 },
        colors: ['#4A7A5D', '#819472', '#F8F6F2']
      });
    });

    return () => {
      newSocket.disconnect();
      Object.values(peersRef.current).forEach(pc => pc.close());
      peersRef.current = {};
      if (endTimeoutRef.current) {
        clearTimeout(endTimeoutRef.current);
      }
    };
  }, [localStream]);

  const handleAdmitJoin = (targetSocketId) => {
    if (socket) {
      socket.emit('approve-user', { targetSocketId });
    }
    setJoinRequests(prev => prev.filter(r => r.socketId !== targetSocketId));
  };

  const handleDenyJoin = (targetSocketId) => {
    if (socket) {
      socket.emit('deny-user', { targetSocketId });
    }
    setJoinRequests(prev => prev.filter(r => r.socketId !== targetSocketId));
  };

  // Real-time camera and mic duration timers
  useEffect(() => {
    if (!isAdmitted) return;
    const timer = setInterval(() => {
      if (micEnabled) {
        setMicOnDuration(prev => prev + 1);
      } else {
        setMicOffDuration(prev => prev + 1);
      }
      if (camEnabled) {
        setCamOnDuration(prev => prev + 1);
      } else {
        setCamOffDuration(prev => prev + 1);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [isAdmitted, micEnabled, camEnabled]);

  // Periodic socket sync of durations to server (every 5 seconds)
  useEffect(() => {
    if (!socket || !isAdmitted) return;
    const syncTimer = setInterval(() => {
      socket.emit('update-durations', { 
        roomId, 
        micOnDuration, 
        micOffDuration, 
        camOnDuration, 
        camOffDuration,
        micOnCount,
        micOffCount
      });
    }, 5000);

    return () => {
      clearInterval(syncTimer);
      socket.emit('update-durations', { 
        roomId, 
        micOnDuration, 
        micOffDuration, 
        camOnDuration, 
        camOffDuration,
        micOnCount,
        micOffCount
      });
    };
  }, [socket, isAdmitted, roomId, micOnDuration, micOffDuration, camOnDuration, camOffDuration, micOnCount, micOffCount]);

  // Helper to format raw duration seconds
  const formatDuration = (sec) => {
    if (!sec) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const createPeerConnection = (targetSocketId, currentSocket) => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        currentSocket.emit('webrtc-candidate', {
          targetSocketId: targetSocketId,
          candidate: event.candidate
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      setRemoteStreams(prev => ({
        ...prev,
        [targetSocketId]: stream
      }));
    };

    return pc;
  };

  // 5. Speech Recognition Setup (Voice-to-Chat Integration)
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn("Speech Recognition not supported in this browser. Voice-to-chat disabled.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = speechLang;

    recognition.onresult = (event) => {
      const transcript = event.results[event.results.length - 1][0].transcript;
      if (socket && transcript.trim() !== '') {
        socket.emit('speech-transcribed', { roomId, text: transcript });
      }
    };

    recognitionRef.current = recognition;

    if (micEnabled && socket) {
      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to start speech recognition:", e);
      }
    }

    return () => {
      try {
        recognition.stop();
      } catch (e) {}
    };
  }, [micEnabled, socket, speechLang]);

  // 6. Camera/Mic Toggles
  const handleToggleMic = () => {
    const nextVal = !micEnabled;
    setMicEnabled(nextVal);
    
    let currentOnCount = micOnCount;
    let currentOffCount = micOffCount;
    if (nextVal) {
      currentOnCount = micOnCount + 1;
      setMicOnCount(currentOnCount);
    } else {
      currentOffCount = micOffCount + 1;
      setMicOffCount(currentOffCount);
    }

    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = nextVal;
      });
    }

    if (recognitionRef.current) {
      try {
        if (nextVal) {
          recognitionRef.current.start();
        } else {
          recognitionRef.current.stop();
        }
      } catch (e) {}
    }

    if (socket) {
      socket.emit('toggle-media', { roomId, type: 'mic', enabled: nextVal });
      // Sync immediately on click
      socket.emit('update-durations', { 
        roomId, 
        micOnDuration, 
        micOffDuration, 
        camOnDuration, 
        camOffDuration,
        micOnCount: currentOnCount,
        micOffCount: currentOffCount
      });
    }
  };

  const handleToggleCam = () => {
    const nextVal = !camEnabled;
    setCamEnabled(nextVal);

    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = nextVal;
      });
    }

    if (socket) {
      socket.emit('toggle-media', { roomId, type: 'cam', enabled: nextVal });
      // Sync immediately on click
      socket.emit('update-durations', { 
        roomId, 
        micOnDuration, 
        micOffDuration, 
        camOnDuration, 
        camOffDuration,
        micOnCount,
        micOffCount
      });
    }
  };

  // 7. Chat Submit
  const handleSendChat = (e) => {
    e.preventDefault();
    if (!inputMessage.trim()) return;

    if (socket) {
      socket.emit('send-chat', { roomId, message: inputMessage.trim() });
      setInputMessage('');
    }
  };

  // 8. End or Leave Meeting
  const handleEndOrLeave = () => {
    if (socket && socket.connected) {
      socket.emit('end-meeting', { roomId });
      
      if (endTimeoutRef.current) {
        clearTimeout(endTimeoutRef.current);
      }
      
      // Safety timeout: if server doesn't reply with report, exit cleanly anyway after 4s
      endTimeoutRef.current = setTimeout(() => {
        onLeave();
      }, 4000);
    } else {
      onLeave();
    }
  };

  // 9. Share Link Helper
  const handleShareLink = () => {
    const link = `${window.location.origin}/?room=${roomId}`;
    navigator.clipboard.writeText(link);
    alert(`Meeting link copied to clipboard!\nShare this link to let others join: \n${link}`);
  };

  // 10. AI Speech Translation Handler
  const handleTranslateText = async (msgId, text) => {
    setTranslatingTextId(msgId);
    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/translate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text, targetLang: translationLang })
      });
      const data = await res.json();
      if (res.ok) {
        setMessages(prev => prev.map((m, idx) => {
          if (idx === msgId) {
            return { ...m, message: data.translated, originalMessage: text };
          }
          return m;
        }));
      }
    } catch (e) {
      setMessages(prev => prev.map((m, idx) => {
        if (idx === msgId) {
          const transWord = translationLang === 'es' ? '[Traducido] ' : translationLang === 'hi' ? '[अनुवादित] ' : '[Translated] ';
          return { ...m, message: `${transWord} ${text}`, originalMessage: text };
        }
        return m;
      }));
    } finally {
      setTranslatingTextId(null);
    }
  };

  const handleRevertTranslation = (msgId) => {
    setMessages(prev => prev.map((m, idx) => {
      if (idx === msgId && m.originalMessage) {
        return { ...m, message: m.originalMessage, originalMessage: undefined };
      }
      return m;
    }));
  };

  const handleToggleParticipantDevice = (participantName, currentDevice) => {
    const newDevice = currentDevice === 'Mobile/Phone' ? 'Desktop/Laptop' : 'Mobile/Phone';
    if (socket && socket.connected) {
      socket.emit('toggle-participant-device', {
        roomId,
        name: participantName,
        device: newDevice
      });
    } else {
      // Local fallback for offline mock simulation
      setParticipants(prev => prev.map(p => {
        if (p.name.toLowerCase() === participantName.toLowerCase()) {
          return { ...p, device: newDevice };
        }
        return p;
      }));
    }
  };

  if (isDenied) {
    return (
      <div className="flex-col items-center justify-center bg-cream-grad" style={{ minHeight: '100vh', display: 'flex', padding: '16px', textAlign: 'center' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '420px', padding: '32px' }}>
          <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '56px', width: '56px', borderRadius: '50%', backgroundColor: '#FEF2F2', color: '#EF4444', margin: '0 auto 16px auto' }}>
            <PhoneOff style={{ width: '24px', height: '24px' }} />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800, color: '#B91C1C' }}>Entry Denied</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px', marginBottom: '24px', lineHeight: '1.5' }}>
            The meeting host denied your request to join this call.
          </p>
          <button onClick={onLeave} className="btn-primary w-full">
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (isWaitingApproval) {
    return (
      <div className="flex-col items-center justify-center bg-cream-grad" style={{ minHeight: '100vh', display: 'flex', padding: '16px', textAlign: 'center' }}>
        <div className="glass-panel" style={{ width: '100%', maxWidth: '420px', padding: '32px' }}>
          <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '56px', width: '56px', borderRadius: '50%', backgroundColor: 'var(--bg-green-light)', color: 'var(--primary-mint)', margin: '0 auto 16px auto' }}>
            <Sparkles className="pulse-active" style={{ width: '24px', height: '24px' }} />
          </div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Asking to Join...</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px', marginBottom: '24px', lineHeight: '1.5' }}>
            Please wait. A host in the meeting has been notified and will admit you shortly.
          </p>
          <button onClick={onLeave} className="btn-secondary w-full" style={{ padding: '12px' }}>
            Cancel Request
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="meeting-layout">
      {joinRequests.length > 0 && (
        <div className="border-soft" style={{ position: 'fixed', top: '90px', right: '20px', zIndex: 1000, backgroundColor: 'var(--bg-yellow-light)', padding: '16px', borderRadius: '16px', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', maxWidth: '320px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>
            {joinRequests[0].name} wants to join this meeting
          </div>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
            <button 
              onClick={() => handleDenyJoin(joinRequests[0].socketId)} 
              className="btn-secondary" 
              style={{ padding: '6px 12px', fontSize: '0.7rem', cursor: 'pointer' }}
            >
              Deny
            </button>
            <button 
              onClick={() => handleAdmitJoin(joinRequests[0].socketId)} 
              className="btn-primary" 
              style={{ padding: '6px 12px', fontSize: '0.7rem', cursor: 'pointer' }}
            >
              Admit
            </button>
          </div>
        </div>
      )}
      
      {/* LEFT PANEL: VIDEO GRID & CONTROLS */}
      <div className="meeting-video-panel flex-1">
        {/* Top Room Header */}
        <div className="flex-row justify-between items-center" style={{ display: 'flex', backgroundColor: 'var(--bg-yellow-light)', border: '1.5px solid var(--border-soft)', padding: '12px 20px', borderRadius: '16px', marginBottom: '16px', boxShadow: '0 2px 10px rgba(0,0,0,0.02)' }}>
          <div className="flex-row items-center gap-3" style={{ display: 'flex' }}>
            <span className="font-heading" style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--primary-mint)', backgroundColor: 'var(--bg-green-light)', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border-soft)' }}>
              Room: {roomId}
            </span>
            <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Laptop style={{ width: '16px', height: '16px' }} /> Active Call ({participants.length} connected)
            </span>
          </div>
          <div className="flex-row items-center gap-2" style={{ display: 'flex' }}>
            <button onClick={handleShareLink} className="btn-secondary" style={{ padding: '8px 14px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Share2 style={{ width: '14px', height: '14px' }} /> Share Invite
            </button>
            <button onClick={onLeave} className="btn-secondary" style={{ padding: '8px 14px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#FEE2E2', color: '#EF4444', borderColor: '#FCA5A5' }}>
              Exit to Dashboard
            </button>
          </div>
        </div>

        {/* Google Meet External Connection Banner */}
        {isCopilotMode && (
          <div className="glass-panel border-soft flex-row items-center justify-between" style={{ display: 'flex', backgroundColor: 'var(--bg-yellow-light)', padding: '16px 20px', borderRadius: '16px', marginBottom: '20px', gap: '16px', boxShadow: '0 4px 15px rgba(12, 59, 46, 0.05)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxWidth: '70%', alignItems: 'flex-start', textAlign: 'left' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: 'var(--primary-mint)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Cam style={{ width: '16px', height: '16px' }} /> Google Meet Copilot Integration
              </span>
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                Conduct your actual call directly on Google Meet. Keep this Online_Meet window open in the background—our AI assistant will continue to listen to your voice, count mic/cam active times, and compile real-time summaries!
              </p>
            </div>
            <a 
              href={roomId.includes('-') || roomId.length === 10 || roomId.includes('meet.google.com') ? `https://meet.google.com/${roomId}` : `https://meet.google.com`}
              target="_blank" 
              rel="noopener noreferrer" 
              className="btn-primary" 
              style={{ padding: '10px 18px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px', textDecoration: 'none', borderRadius: '10px', fontWeight: 700 }}
            >
              Launch Google Meet ↗
            </a>
          </div>
        )}

        {/* Video Grid or Copilot Console */}
        {isCopilotMode ? (
          <div className="flex-col gap-6" style={{ display: 'flex', width: '100%', minHeight: '400px', justifyContent: 'center', alignItems: 'center', padding: '20px' }}>
            <div className="glass-panel" style={{ width: '100%', maxWidth: '640px', padding: '40px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '24px' }}>
              <div 
                className="pulse-active" 
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  height: '96px', 
                  width: '96px', 
                  borderRadius: '50%', 
                  backgroundColor: micEnabled ? 'rgba(255, 186, 0, 0.15)' : 'rgba(239, 68, 68, 0.1)', 
                  color: micEnabled ? 'var(--primary-gold)' : '#EF4444', 
                  border: `3px solid ${micEnabled ? 'var(--primary-gold)' : '#EF4444'}`,
                  transition: 'all 0.3s ease',
                  boxShadow: micEnabled ? '0 0 30px rgba(255, 186, 0, 0.3)' : 'none'
                }}
              >
                {micEnabled ? <Mic style={{ width: '40px', height: '40px' }} /> : <MicOff style={{ width: '40px', height: '40px' }} />}
              </div>

              <div>
                <h3 style={{ fontSize: '1.3rem', fontWeight: 800 }}>AI Copilot Listening...</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', maxWidth: '440px', margin: '8px auto 0 auto', lineHeight: '1.5' }}>
                  Your call is running in the <strong>other Google Meet tab</strong>. Keep this window open. When your call ends, simply close that Google Meet tab and return here to click <strong>"Exit to Dashboard"</strong> or <strong>"End Session"</strong>!
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 w-full" style={{ maxWidth: '480px' }}>
                <div className="bg-yellow-light border-soft" style={{ padding: '16px', borderRadius: '12px', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Mic Speaking Time</span>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary-mint)', display: 'block', marginTop: '6px' }}>{formatDuration(micOnDuration)}</span>
                </div>
                <div className="bg-yellow-light border-soft" style={{ padding: '16px', borderRadius: '12px', textAlign: 'center' }}>
                  <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', fontWeight: 600 }}>Cam Active Time</span>
                  <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--primary-mint)', display: 'block', marginTop: '6px' }}>{formatDuration(camOnDuration)}</span>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '16px', width: '100%', maxWidth: '480px', borderTop: '1px solid var(--border-soft)', paddingTop: '20px', justifyContent: 'center' }}>
                <div style={{ fontSize: '0.75rem', fontWeight: 700 }}>
                  Active Participants: <span style={{ color: 'var(--primary-mint)' }}>{participants.length} connected</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="video-container-grid">
            {/* Local User Card */}
            <div className={`video-card ${micEnabled ? 'active-speaker' : ''}`}>
              <video 
                ref={localVideoRef} 
                autoPlay 
                playsInline 
                muted 
                className="video-stream-elem"
              />
              {!camEnabled && (
                <div className="flex-col items-center justify-center" style={{ display: 'flex', position: 'absolute', inset: 0, backgroundColor: '#131A22', color: 'white', gap: '8px' }}>
                  <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '64px', width: '64px', borderRadius: '50%', backgroundColor: '#1E293B', color: 'var(--primary-mint)', fontSize: '1.5rem', fontWeight: 'bold' }}>
                    {user.name ? user.name.substring(0, 2).toUpperCase() : 'ME'}
                  </div>
                  <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Camera is off</span>
                </div>
              )}
              <div className="video-name-overlay" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', padding: '8px 14px' }}>
                <div className="flex-row items-center gap-2" style={{ display: 'flex' }}>
                  <span style={{ fontWeight: 'bold' }}>{user.name} (You)</span>
                  {!micEnabled && <MicOff style={{ width: '14px', height: '14px', color: '#EF4444' }} />}
                </div>
                <div style={{ fontSize: '0.62rem', opacity: 0.85, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                  <span>🎙️ ON: {formatDuration(micOnDuration)} | OFF: {formatDuration(micOffDuration)}</span>
                  <span>📷 ON: {formatDuration(camOnDuration)} | OFF: {formatDuration(camOffDuration)}</span>
                </div>
              </div>
              <div className="video-device-overlay">{deviceType}</div>
            </div>

            {/* Remote User Cards */}
            {participants.filter(p => p.socketId !== socket?.id).map((peer) => {
              const remoteStream = remoteStreams[peer.socketId];
              const isMock = peer.isMock;
              const displayInitials = peer.name ? peer.name.substring(0, 2).toUpperCase() : 'P';
              
              return (
                <div key={peer.socketId} className={`video-card ${peer.micEnabled ? 'active-speaker' : ''}`}>
                  {isMock ? (
                    // Simulated Mock Participant View
                    peer.camEnabled ? (
                      <div className="flex-col items-center justify-center simulated-cam-active" style={{ display: 'flex', position: 'absolute', inset: 0, background: 'linear-gradient(135deg, #1E293B 0%, #0F172A 100%)', color: 'white', gap: '12px' }}>
                        <div 
                          className={`flex-row items-center justify-center border-soft ${peer.micEnabled ? 'pulse-avatar' : ''}`} 
                          style={{ 
                            display: 'flex', 
                            height: '80px', 
                            width: '80px', 
                            borderRadius: '50%', 
                            backgroundColor: 'rgba(255, 255, 255, 0.05)', 
                            border: `3px solid ${peer.micEnabled ? 'var(--primary-mint)' : 'var(--border-soft)'}`,
                            color: 'var(--primary-mint)', 
                            fontSize: '2rem', 
                            fontWeight: 'bold',
                            boxShadow: peer.micEnabled ? '0 0 20px rgba(0, 242, 178, 0.3)' : 'none',
                            transition: 'all 0.3s ease'
                          }}
                        >
                          {displayInitials}
                        </div>
                        <span style={{ fontSize: '0.7rem', color: '#38BDF8', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 600 }}>Simulated Video Stream</span>
                      </div>
                    ) : (
                      <div className="flex-col items-center justify-center" style={{ display: 'flex', position: 'absolute', inset: 0, backgroundColor: '#131A22', color: 'white', gap: '8px' }}>
                        <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '64px', width: '64px', borderRadius: '50%', backgroundColor: '#1E293B', color: '#94A3B8', fontSize: '1.5rem', fontWeight: 'bold' }}>
                          {displayInitials}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Camera is off</span>
                      </div>
                    )
                  ) : (
                    // Regular WebRTC Participant View
                    <>
                      {remoteStream ? (
                        <video
                          autoPlay
                          playsInline
                          ref={(el) => {
                            if (el && el.srcObject !== remoteStream) {
                              el.srcObject = remoteStream;
                            }
                          }}
                          className="video-stream-elem"
                        />
                      ) : (
                        <div className="flex-col items-center justify-center" style={{ display: 'flex', position: 'absolute', inset: 0, backgroundColor: '#131A22', color: 'white', gap: '8px' }}>
                          <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '64px', width: '64px', borderRadius: '50%', backgroundColor: '#1E293B', color: 'var(--primary-mint)', fontSize: '1.5rem', fontWeight: 'bold' }}>
                            {displayInitials}
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Negotiating stream...</span>
                        </div>
                      )}
                      
                      {!peer.camEnabled && (
                        <div className="flex-col items-center justify-center" style={{ display: 'flex', position: 'absolute', inset: 0, backgroundColor: '#131A22', color: 'white', gap: '8px' }}>
                          <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '64px', width: '64px', borderRadius: '50%', backgroundColor: '#1E293B', color: 'var(--primary-mint)', fontSize: '1.5rem', fontWeight: 'bold' }}>
                            {displayInitials}
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Camera is off</span>
                        </div>
                      )}
                    </>
                  )}
                  
                  <div className="video-name-overlay" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', padding: '8px 14px' }}>
                    <div className="flex-row items-center gap-2" style={{ display: 'flex' }}>
                      <span style={{ fontWeight: 'bold' }}>{peer.name} {isMock && <span style={{ fontSize: '0.65rem', backgroundColor: 'rgba(255,186,0,0.2)', color: 'var(--primary-gold)', padding: '1px 6px', borderRadius: '4px' }}>Mock</span>}</span>
                      {!peer.micEnabled && <MicOff style={{ width: '14px', height: '14px', color: '#EF4444' }} />}
                    </div>
                    <div style={{ fontSize: '0.62rem', opacity: 0.85, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      <span>🎙️ ON: {formatDuration(peer.micOnDuration)} | OFF: {formatDuration(peer.micOffDuration || 0)}</span>
                      <span>📷 ON: {formatDuration(peer.camOnDuration)} | OFF: {formatDuration(peer.camOffDuration || 0)}</span>
                    </div>
                  </div>
                  <div className="video-device-overlay">{peer.device}</div>
                </div>
              );
            })}
          </div>
        )}

        {/* Floating Meeting Controls Dock */}
        <div className="controls-dock">
          <select 
            value={speechLang} 
            onChange={(e) => setSpeechLang(e.target.value)} 
            className="dock-btn"
            style={{ 
              background: 'rgba(255, 255, 255, 0.95)', 
              border: '1px solid var(--border-soft)', 
              borderRadius: '10px', 
              padding: '0 8px', 
              fontSize: '0.65rem', 
              fontWeight: '800',
              outline: 'none',
              cursor: 'pointer',
              color: 'var(--primary-mint)',
              width: '85px',
              height: '40px',
              textAlign: 'center'
            }}
            title="Choose speech recognition language"
          >
            <option value="en-US">🇬🇧 English</option>
            <option value="hi-IN">🇮🇳 हिन्दी</option>
          </select>

          <button 
            onClick={handleToggleMic} 
            className={`dock-btn ${!micEnabled ? 'muted-off' : ''}`}
            title={micEnabled ? "Mute Mic" : "Unmute Mic"}
          >
            {micEnabled ? <Mic style={{ width: '20px', height: '20px' }} /> : <MicOff style={{ width: '20px', height: '20px' }} />}
          </button>
          
          <button 
            onClick={handleToggleCam} 
            className={`dock-btn ${!camEnabled ? 'muted-off' : ''}`}
            title={camEnabled ? "Disable Camera" : "Enable Camera"}
          >
            {camEnabled ? <Cam style={{ width: '20px', height: '20px' }} /> : <VideoOff style={{ width: '20px', height: '20px' }} />}
          </button>

          <button 
            onClick={handleShareLink} 
            className="dock-btn"
            title="Invite Participants"
          >
            <UserPlus style={{ width: '20px', height: '20px' }} />
          </button>

          <button 
            onClick={handleEndOrLeave} 
            className="dock-btn hangup-red"
            title="End Session"
          >
            <PhoneOff style={{ width: '20px', height: '20px' }} />
          </button>
        </div>
      </div>

      {/* RIGHT SIDEBAR: CHAT, STATS & AI OPTIONS */}
      <div className="meeting-sidebar">
        
        {/* Tab Selection */}
        <div className="tab-container" style={{ marginBottom: 0 }}>
          <button 
            onClick={() => setActiveTab('chat')} 
            className={`tab-btn ${activeTab === 'chat' ? 'active' : ''}`}
            style={{ fontSize: '0.75rem', padding: '16px' }}
          >
            <MessageSquare style={{ width: '16px', height: '16px' }} /> Chat
          </button>
          <button 
            onClick={() => setActiveTab('stats')} 
            className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}
            style={{ fontSize: '0.75rem', padding: '16px' }}
          >
            <BarChart2 style={{ width: '16px', height: '16px' }} /> Stats
          </button>
          <button 
            onClick={() => setActiveTab('ai')} 
            className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
            style={{ fontSize: '0.75rem', padding: '16px' }}
          >
            <Sparkles style={{ width: '16px', height: '16px' }} /> AI Tools
          </button>
        </div>

        {/* TAB CONTENTS */}
        
        {/* TAB 1: CHATBOX */}
        {activeTab === 'chat' && (
          <div className="chat-tab-wrapper flex-1">
            <div id="chat-scroll-box" className="chat-message-scroller">
              {messages.length === 0 ? (
                <div className="flex-col items-center justify-center" style={{ display: 'flex', height: '100%', textAlign: 'center', color: 'var(--text-muted)', padding: '24px' }}>
                  <MessageSquare style={{ width: '36px', height: '36px', opacity: 0.2, marginBottom: '8px' }} />
                  <p style={{ fontSize: '0.75rem' }}>Chat room is empty.</p>
                  <p style={{ fontSize: '0.65rem', marginTop: '4px' }}>Speak into the mic for automatic speech-to-text chat logs!</p>
                </div>
              ) : (
                messages.map((msg, idx) => 
                  msg.isSystem ? (
                    <div key={idx} style={{ textAlign: 'center', margin: '14px 0', fontSize: '0.72rem', color: 'var(--accent-olive)', fontStyle: 'italic', fontWeight: 600 }}>
                      — {msg.message} —
                    </div>
                  ) : (
                    <div 
                      key={idx} 
                      className={`msg-bubble ${
                        msg.sender === user.name
                          ? (msg.isSpeech ? 'voice-sent' : 'sent')
                          : (msg.isSpeech ? 'voice-received' : 'received')
                      }`}
                    >
                      <span className="msg-sender-name">
                        {msg.sender === user.name ? 'You' : msg.sender} 
                        {msg.isSpeech && <span style={{ fontSize: '7px', textTransform: 'uppercase', letterSpacing: '0.05em', marginLeft: '6px', backgroundColor: 'rgba(0,0,0,0.06)', padding: '2px 4px', borderRadius: '4px' }}>Voice</span>}
                      </span>
                      <p style={{ fontSize: '0.85rem' }}>{msg.message}</p>
                      
                      {msg.sender !== user.name && (
                        <div style={{ marginTop: '8px', display: 'flex', gap: '8px', borderTop: '1px solid rgba(0,0,0,0.03)', paddingTop: '6px', justifyContent: 'flex-end' }}>
                          {msg.originalMessage ? (
                            <button 
                              onClick={() => handleRevertTranslation(idx)} 
                              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.65rem', color: 'var(--text-muted)', textDecoration: 'underline' }}
                            >
                              Original
                            </button>
                          ) : (
                            <button 
                              onClick={() => handleTranslateText(idx, msg.message)} 
                              style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: '0.65rem', color: 'var(--primary-mint)', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: '3px' }}
                            >
                              <Globe style={{ width: '10px', height: '10px' }} /> Translate ({translationLang})
                            </button>
                          )}
                        </div>
                      )}

                      <span className="msg-timestamp">{msg.timestamp}</span>
                    </div>
                  )
                )
              )}
            </div>

            <form onSubmit={handleSendChat} className="chat-input-row">
              <input
                type="text"
                placeholder="Type a message..."
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                className="input-field"
                style={{ padding: '10px 14px', fontSize: '0.8rem' }}
              />
              <button type="submit" className="btn-primary" style={{ padding: '10px 16px' }}>
                <Send style={{ width: '16px', height: '16px' }} />
              </button>
            </form>
          </div>
        )}

        {/* TAB 2: MEETING STATISTICS */}
        {activeTab === 'stats' && (
          <div className="flex-1" style={{ overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '0.75rem' }}>
            <div className="flex-row justify-between items-center" style={{ display: 'flex', borderBottom: '1px solid var(--border-soft)', paddingBottom: '10px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, margin: 0 }}>Participant Hardware Statistics</h3>
              {!participants.some(p => p.isMock) && (
                <button 
                  onClick={() => socket && socket.emit('start-demo-simulation')}
                  className="btn-primary"
                  style={{ padding: '6px 12px', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', borderRadius: '8px' }}
                >
                  <Sparkles style={{ width: '12px', height: '12px' }} /> Simulate Demo (Mock Data)
                </button>
              )}
            </div>

            {/* Instruction helper to load Chrome Extension */}
            <div className="glass-panel border-soft" style={{ padding: '12px 16px', backgroundColor: 'rgba(74, 122, 93, 0.05)', borderRadius: '10px', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <span style={{ fontSize: '0.9rem' }}>🔌</span>
                <span style={{ fontWeight: 800, color: 'var(--primary-mint)' }}>How to sync real meeting data:</span>
              </div>
              <p style={{ margin: 0, fontSize: '0.68rem', color: 'var(--text-muted)', lineHeight: '1.4' }}>
                To track actual Google Meet or Zoom calls, load the unpacked extension in <strong style={{ color: 'var(--text-dark)' }}>chrome://extensions</strong> from: <code style={{ background: '#E6ECE5', padding: '2px 4px', borderRadius: '4px' }}>c:\Users\shwet\OneDrive\Desktop\Online_Meet\chrome-extension</code>.
                Then, join your Meet/Zoom call and <strong style={{ color: 'var(--text-dark)' }}>turn on Captions (CC)</strong>. It will automatically detect actual participants, mic/cam states, and conversations!
              </p>
            </div>
            
            <div className="flex-col gap-4" style={{ display: 'flex' }}>
              {participants.filter(p => p.isOnline !== false).map((p, idx) => (
                <div key={idx} className="glass-panel bg-yellow-light flex-col gap-3" style={{ display: 'flex', padding: '16px' }}>
                  <div className="flex-row justify-between items-center" style={{ display: 'flex' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.85rem', color: 'var(--primary-mint)' }}>{p.name} {p.socketId === socket?.id && '(You)'}</span>
                      {p.email && <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{p.email}</span>}
                    </div>
                    <button 
                      onClick={() => handleToggleParticipantDevice(p.name, p.device)}
                      className="flex-row items-center gap-1 bg-green-accent border-soft hover-btn-pulse" 
                      style={{ 
                        display: 'flex', 
                        fontSize: '0.68rem', 
                        color: 'var(--primary-mint)', 
                        padding: '4px 10px', 
                        borderRadius: '8px', 
                        cursor: 'pointer',
                        border: '1.5px solid var(--border-soft)',
                        background: 'var(--bg-green-light)',
                        fontWeight: 800,
                        transition: 'all 0.2s ease',
                        outline: 'none'
                      }}
                      title="Click to toggle device type"
                    >
                      {p.device === 'Mobile/Phone' ? <Smartphone style={{ width: '12px', height: '12px' }} /> : <Laptop style={{ width: '12px', height: '12px' }} />}
                      {p.device}
                      <span style={{ fontSize: '0.55rem', opacity: 0.6, marginLeft: '3px' }}>🔄</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2" style={{ marginTop: '4px' }}>
                    <div className="bg-cream-grad border-soft" style={{ padding: '8px', borderRadius: '8px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-dark)', fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid var(--border-soft)', paddingBottom: '3px', marginBottom: '4px', display: 'block' }}>🎙️ Microphone Stats</span>
                      <div className="flex-row justify-between" style={{ display: 'flex', fontSize: '0.7rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Mic Toggles:</span>
                        <strong style={{ color: 'var(--primary-mint)' }}>{p.micSwitches || 0} times</strong>
                      </div>
                      <div className="flex-row justify-between" style={{ display: 'flex', fontSize: '0.7rem', marginTop: '4px', borderTop: '1px dashed var(--border-soft)', paddingTop: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Total ON:</span>
                        <strong>{formatDuration(p.micOnDuration)}</strong>
                      </div>
                      <div className="flex-row justify-between" style={{ display: 'flex', fontSize: '0.7rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Total OFF:</span>
                        <strong>{formatDuration(p.micOffDuration || 0)}</strong>
                      </div>
                    </div>
                    
                    <div className="bg-cream-grad border-soft" style={{ padding: '8px', borderRadius: '8px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span style={{ fontSize: '0.65rem', color: 'var(--text-dark)', fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid var(--border-soft)', paddingBottom: '3px', marginBottom: '4px', display: 'block' }}>📷 Camera Stats</span>
                      <div className="flex-row justify-between" style={{ display: 'flex', fontSize: '0.7rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Cam Toggles:</span>
                        <strong style={{ color: 'var(--primary-mint)' }}>{p.camSwitches} times</strong>
                      </div>
                      <div className="flex-row justify-between" style={{ display: 'flex', fontSize: '0.7rem', marginTop: '4px', borderTop: '1px dashed var(--border-soft)', paddingTop: '4px' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Total ON:</span>
                        <strong>{formatDuration(p.camOnDuration)}</strong>
                      </div>
                      <div className="flex-row justify-between" style={{ display: 'flex', fontSize: '0.7rem' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Total OFF:</span>
                        <strong>{formatDuration(p.camOffDuration || 0)}</strong>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-green-accent border-soft" style={{ padding: '12px', borderRadius: '8px', fontSize: '0.65rem', color: 'var(--text-muted)', lineHeight: '1.5' }}>
              <strong>Info:</strong> Switch logs update dynamically in real-time. Device classifications are resolved via hardware User-Agent headers.
            </div>
          </div>
        )}

        {/* TAB 3: AI SPEECH TRANSLATION SETTINGS */}
        {activeTab === 'ai' && (
          <div className="flex-1" style={{ overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: '24px', fontSize: '0.75rem' }}>
            <div>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, borderBottom: '1px solid var(--border-soft)', paddingBottom: '10px', marginBottom: '12px' }}>Live Translation Settings</h3>
              <p style={{ color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '16px' }}>
                Choose the language you wish to translate incoming participant speeches into.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label className="form-label">Target Language</label>
                <select 
                  value={translationLang} 
                  onChange={(e) => setTranslationLang(e.target.value)}
                  className="input-field"
                  style={{ fontSize: '0.8rem', padding: '10px 14px' }}
                >
                  <option value="es">Spanish (Español)</option>
                  <option value="hi">Hindi (हिन्दी)</option>
                  <option value="fr">French (Français)</option>
                  <option value="en">English (default)</option>
                </select>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: '16px' }}>
              <h3 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles className="pulse-active" style={{ width: '16px', height: '16px', color: 'var(--primary-mint)' }} /> Real-time Speech-to-Text
              </h3>
              <p style={{ color: 'var(--text-muted)', lineHeight: '1.5', marginBottom: '16px' }}>
                The browser is automatically transcribing your spoken words. Select your speaking language below to ensure accurate transcription.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                <label className="form-label">Voice Input Language</label>
                <select 
                  value={speechLang} 
                  onChange={(e) => setSpeechLang(e.target.value)}
                  className="input-field"
                  style={{ fontSize: '0.8rem', padding: '10px 14px' }}
                >
                  <option value="en-US">English (United States)</option>
                  <option value="hi-IN">Hindi (हिन्दी)</option>
                </select>
              </div>

              <div style={{ padding: '12px', backgroundColor: '#F0F9FF', border: '1px solid #BAE6FD', borderRadius: '10px', display: 'flex', gap: '8px', color: '#0369A1' }}>
                <AlertCircle style={{ width: '16px', height: '16px', flexShrink: 0, marginTop: '2px' }} />
                <span>Web Speech API is running automatically. Ensure browser mic permission is allowed.</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* SUMMARY REPORT POST-MEETING MODAL */}
      {showReport && reportData && (
        <div className="modal-overlay">
          <div className="modal-content-card">
            <div className="flex-row justify-between items-center pb-4 border-soft" style={{ display: 'flex', borderBottom: '1px solid var(--border-soft)', marginBottom: '24px' }}>
              <div className="flex-row items-center gap-3" style={{ display: 'flex' }}>
                <Award style={{ width: '32px', height: '32px', color: 'var(--primary-mint)' }} />
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>AI Summary Report</h2>
                  <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px' }}>Compiled successfully in real-time</p>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block' }}>Engagement Score</span>
                <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--primary-mint)' }}>{reportData.score}/10.0</span>
              </div>
            </div>

            <div className="flex-col gap-5" style={{ display: 'flex', fontSize: '0.75rem', lineHeight: '1.5' }}>
              
              {/* Meeting Summary */}
              <div className="bg-yellow-light border-soft" style={{ padding: '16px', borderRadius: '14px' }}>
                <h4 className="form-label" style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <FileText style={{ width: '16px', height: '16px', color: 'var(--primary-mint)' }} /> Executed Summary
                </h4>
                <p style={{ color: 'var(--primary-mint)', fontWeight: '600', fontSize: '0.75rem' }}>
                  {reportData.summary}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Action Items List */}
                <div>
                  <h4 className="form-label" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <CheckCircle style={{ width: '16px', height: '16px', color: 'var(--primary-mint)' }} /> Extracted Tasks
                  </h4>
                  <div className="flex-col gap-2" style={{ display: 'flex', maxHeight: '180px', overflowY: 'auto' }}>
                    {reportData.actionItems.map((item, idx) => (
                      <div key={idx} className="bg-yellow-light border-soft" style={{ padding: '12px', borderRadius: '10px' }}>
                        <p style={{ fontWeight: 700, color: 'var(--text-dark)' }}>{item.title}</p>
                        <div className="flex-row justify-between items-center" style={{ display: 'flex', marginTop: '8px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                          <span className="bg-green-accent border-soft" style={{ fontWeight: 700, padding: '2px 6px', borderRadius: '4px', color: 'var(--primary-mint)' }}>
                            Assignee: {item.assignee}
                          </span>
                          <span>Due: {item.dueDate}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Speaker Distribution */}
                <div>
                  <h4 className="form-label" style={{ marginBottom: '12px' }}>Speaking Distribution</h4>
                  <div className="bg-yellow-light border-soft flex-col gap-3" style={{ display: 'flex', padding: '16px', borderRadius: '14px' }}>
                    {Object.entries(reportData.speakingInsights).map(([name, pct]) => (
                      <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div className="flex-row justify-between" style={{ display: 'flex', fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                          <span>{name}</span>
                          <span>{pct}%</span>
                        </div>
                        <div style={{ width: '100%', backgroundColor: 'var(--bg-green-light)', height: '8px', borderRadius: '4px', overflow: 'hidden' }}>
                          <div 
                            style={{ backgroundColor: 'var(--primary-mint)', height: '100%', borderRadius: '4px', width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Hardware Toggles Analytics Log */}
              <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: '16px' }}>
                <h4 className="form-label" style={{ marginBottom: '12px' }}>Participant Hardware Analytics</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {reportData.participants.map((p, idx) => (
                    <div key={idx} className="bg-yellow-light border-soft" style={{ padding: '12px', borderRadius: '12px', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div className="flex-row justify-between items-center" style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.05)', paddingBottom: '4px' }}>
                        <strong style={{ color: 'var(--primary-mint)' }}>{p.name}</strong>
                        <span className="flex-row items-center gap-1 bg-green-accent border-soft" style={{ display: 'flex', fontSize: '0.6rem', padding: '1px 6px', borderRadius: '4px' }}>
                          {p.device === 'Mobile/Phone' ? <Smartphone style={{ width: '10px', height: '10px' }} /> : <Laptop style={{ width: '10px', height: '10px' }} />}
                          {p.device || 'Desktop/Laptop'}
                        </span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2" style={{ fontSize: '0.65rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>🎙️ Mic Stats:</div>
                          <div>Toggles: {p.micSwitches || 0} times</div>
                          <div>Active: {formatDuration(p.micOnDuration)}</div>
                          <div>Muted: {formatDuration(p.micOffDuration || 0)}</div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>📷 Cam Stats:</div>
                          <div>Toggles: {p.camSwitches || 0} times</div>
                          <div>Active: {formatDuration(p.camOnDuration)}</div>
                          <div>Inactive: {formatDuration(p.camOffDuration || 0)}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Dialogue Transcript Chat Log */}
              {reportData.transcript && reportData.transcript.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: '16px' }}>
                  <h4 className="form-label" style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <MessageSquare style={{ width: '16px', height: '16px', color: 'var(--primary-mint)' }} /> Group Chat & Voice Transcript
                  </h4>
                  <div className="bg-yellow-light border-soft flex-col gap-2 chat-message-scroller" style={{ display: 'flex', padding: '16px', borderRadius: '14px', maxHeight: '180px', overflowY: 'auto' }}>
                    {reportData.transcript.map((msg, idx) => (
                      msg.isSystem ? (
                        <div key={idx} style={{ textAlign: 'center', margin: '4px 0', fontSize: '0.68rem', color: 'var(--accent-olive)', fontStyle: 'italic' }}>
                          — {msg.message} —
                        </div>
                      ) : (
                        <div key={idx} style={{ fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: '2px', paddingBottom: '6px', borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                            <strong style={{ color: 'var(--primary-mint)' }}>
                              {msg.sender} 
                              {msg.isSpeech && <span style={{ fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.05em', marginLeft: '6px', backgroundColor: 'rgba(0,0,0,0.06)', padding: '1px 3px', borderRadius: '2px' }}>Voice</span>}
                            </strong>
                            <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{msg.timestamp}</span>
                          </div>
                          <span style={{ color: 'var(--text-dark)' }}>{msg.message}</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              )}

            </div>

            <div className="flex-row justify-end border-soft" style={{ display: 'flex', marginTop: '24px', borderTop: '1px solid var(--border-soft)', paddingTop: '16px' }}>
              <button 
                onClick={onLeave} 
                className="btn-primary"
              >
                Close Report & Exit
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default MeetingRoom;
