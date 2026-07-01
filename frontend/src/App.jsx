import React, { useState, useEffect } from 'react';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import MeetingRoom from './components/MeetingRoom';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token') || '');
  const [user, setUser] = useState(null);
  const [currentRoomId, setCurrentRoomId] = useState(null);
  const [isCopilotMode, setIsCopilotMode] = useState(false);
  const [currentView, setCurrentView] = useState('login');

  // Helper to extract room code from standard texts or Google Meet URLs
  const parseRoomCode = (input) => {
    const cleaned = input.trim();
    if (!cleaned) return '';
    try {
      if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
        const url = new URL(cleaned);
        if (url.hostname.includes('meet.google.com')) {
          const code = url.pathname.replace(/^\//, '');
          if (code) return code;
        }
        const roomQuery = url.searchParams.get('room');
        if (roomQuery) return roomQuery;
        const code = url.pathname.replace(/^\//, '');
        if (code) return code;
      }
    } catch (e) {}

    if (cleaned.includes('meet.google.com/')) {
      const parts = cleaned.split('meet.google.com/');
      if (parts[1]) {
        return parts[1].split('?')[0].split('/')[0];
      }
    }
    return cleaned;
  };

  // Verify token on startup
  useEffect(() => {
    if (token) {
      localStorage.setItem('token', token);
      fetchUserProfile();
    } else {
      localStorage.removeItem('token');
      setUser(null);
      setCurrentView('login');
    }
  }, [token]);

  // Handle direct meeting links (e.g. ?room=xxxx-yyyy)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    const copilotParam = params.get('copilot') === 'true';
    if (roomParam) {
      const parsedRoom = parseRoomCode(roomParam);
      setCurrentRoomId(parsedRoom);
      setIsCopilotMode(copilotParam);
      if (token) {
        setCurrentView('meeting');
      } else {
        setCurrentView('login');
      }
    }
  }, [token]);

  // Sync browser back/forward history navigation clicks (popstate events)
  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      const copilotParam = params.get('copilot') === 'true';
      
      if (roomParam) {
        const parsed = parseRoomCode(roomParam);
        setCurrentRoomId(parsed);
        setIsCopilotMode(copilotParam);
        if (token) {
          setCurrentView('meeting');
        } else {
          setCurrentView('login');
        }
      } else {
        setCurrentRoomId(null);
        setIsCopilotMode(false);
        if (token) {
          setCurrentView('dashboard');
        } else {
          setCurrentView('login');
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [token]);

  const fetchUserProfile = async () => {
    if (token === 'mock-jwt-token-12345') {
      if (!user) {
        setUser({ id: 'showcase-user-id', name: 'Aman', email: 'aman@example.com' });
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get('room')) {
        setCurrentView('meeting');
      } else {
        setCurrentView('dashboard');
      }
      return;
    }

    try {
      const res = await fetch(`http://${window.location.hostname}:5000/api/auth/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data);
        const params = new URLSearchParams(window.location.search);
        if (params.get('room')) {
          setCurrentView('meeting');
        } else {
          setCurrentView('dashboard');
        }
      } else {
        // Invalid token
        setToken('');
      }
    } catch (e) {
      console.error("Error fetching profile:", e);
      // Fallback/offline mode for presentation showcase
      setUser({ id: 'offline-id', name: 'Showcase User', email: 'user@example.com' });
      const params = new URLSearchParams(window.location.search);
      if (params.get('room')) {
        setCurrentView('meeting');
      } else {
        setCurrentView('dashboard');
      }
    }
  };

  const handleLogin = (newToken, userData) => {
    setUser(userData);
    setToken(newToken);
  };

  const handleLogout = () => {
    setToken('');
    setUser(null);
    setCurrentRoomId(null);
    window.history.pushState({}, document.title, window.location.pathname);
    setCurrentView('login');
  };

  const handleJoinMeeting = (roomId, isCopilot = false, googleMeetUrl = '') => {
    setCurrentRoomId(roomId);
    setIsCopilotMode(isCopilot);
    window.history.pushState({}, document.title, `?room=${roomId}${isCopilot ? '&copilot=true' : ''}`);
    setCurrentView('meeting');
    if (isCopilot && googleMeetUrl) {
      window.open(googleMeetUrl, '_blank');
    }
  };

  const handleLeaveMeeting = () => {
    setCurrentRoomId(null);
    setIsCopilotMode(false);
    window.history.pushState({}, document.title, window.location.pathname);
    setCurrentView('dashboard');
  };

  return (
    <div className="bg-cream-grad" style={{ minHeight: '100vh' }}>
      {currentView === 'login' && (
        <Login onLogin={handleLogin} initialRoomId={currentRoomId} />
      )}
      
      {currentView === 'dashboard' && user && (
        <Dashboard 
          user={user} 
          onLogout={handleLogout} 
          onJoinMeeting={handleJoinMeeting} 
        />
      )}
      
      {currentView === 'meeting' && user && currentRoomId && (
        <MeetingRoom 
          user={user} 
          roomId={currentRoomId} 
          isCopilotMode={isCopilotMode}
          onLeave={handleLeaveMeeting} 
        />
      )}
    </div>
  );
}

export default App;
