import React, { useState, useEffect, useRef } from 'react';
import { 
  Video, Plus, ArrowRight, Sparkles, History, 
  CheckSquare, BarChart2, LogOut, Copy, Check, 
  Clock, ClipboardList, Calendar, Smartphone, Laptop, 
  Activity, PlusCircle, MessageSquare, ChevronDown, 
  ChevronUp, Mic, VideoOff
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { BACKEND_URL } from '../config';

function Dashboard({ user, onLogout, onJoinMeeting }) {
  const [activeSection, setActiveSection] = useState('home');
  const [newRoomId, setNewRoomId] = useState('');
  const [copilotLink, setCopilotLink] = useState('');

  const handleStartCopilotClick = (e) => {
    e.preventDefault();
    const code = parseRoomCode(copilotLink);
    if (code) {
      const googleMeetUrl = copilotLink.includes('meet.google.com') ? copilotLink : `https://meet.google.com/${code}`;
      onJoinMeeting(code, true, googleMeetUrl);
    }
  };
  const [agendaGoal, setAgendaGoal] = useState('');
  const [agendaDuration, setAgendaDuration] = useState(30);
  const [generatedAgenda, setGeneratedAgenda] = useState(null);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [meetingsHistory, setMeetingsHistory] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [copiedId, setCopiedId] = useState('');
  const [newReminderText, setNewReminderText] = useState('');
  const [newReminderTime, setNewReminderTime] = useState('');
  const [expandedTranscripts, setExpandedTranscripts] = useState({});

  const toggleTranscript = (meetId) => {
    setExpandedTranscripts(prev => ({
      ...prev,
      [meetId]: !prev[meetId]
    }));
  };

  const formatDuration = (sec) => {
    if (!sec) return '0s';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  // Refs for sections to handle scrolling and intersection observing
  const containerRef = useRef(null);
  const sections = {
    home: useRef(null),
    agenda: useRef(null),
    history: useRef(null),
    tasks: useRef(null),
    analytics: useRef(null)
  };

  // Intersection Observer for scroll-sync navigation
  useEffect(() => {
    const observerOptions = {
      root: containerRef.current,
      rootMargin: '0px',
      threshold: 0.5
    };

    const observerCallback = (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          setActiveSection(entry.target.id);
        }
      });
    };

    const observer = new IntersectionObserver(observerCallback, observerOptions);
    
    Object.values(sections).forEach(ref => {
      if (ref.current) observer.observe(ref.current);
    });

    return () => observer.disconnect();
  }, []);

  // Fetch initial dashboard data (history, tasks, reminders)
  useEffect(() => {
    fetchHistory();
    fetchTasks();
    
    // Load local storage reminders
    const savedReminders = localStorage.getItem('meeting_reminders');
    if (savedReminders) {
      setReminders(JSON.parse(savedReminders));
    } else {
      const defaultReminders = [
        { id: '1', text: 'Share project roadmap with client', time: 'Tomorrow, 10:00 AM' },
        { id: '2', text: 'Review team testing phase comments', time: 'May 20, 03:00 PM' }
      ];
      setReminders(defaultReminders);
      localStorage.setItem('meeting_reminders', JSON.stringify(defaultReminders));
    }
  }, []);

  const fetchHistory = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/meetings/history`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setMeetingsHistory(data);
      }
    } catch (e) {
      // Mock history for showcase mode
      setMeetingsHistory([
        {
          _id: 'm1',
          roomId: 'f2d8-91c2',
          host: 'Aman',
          agenda: 'Weekly Sync & Project Roadmap',
          summary: 'The team discussed the project update. Development is on track and testing is in progress. Sneha flagged potential delays in the design mockups.',
          score: 8.6,
          isCompleted: true,
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
          participants: [
            { name: 'Aman', device: 'Desktop/Laptop', micSwitches: 1, camSwitches: 1 },
            { name: 'Priya', device: 'Desktop/Laptop', micSwitches: 2, camSwitches: 0 },
            { name: 'Rahul', device: 'Mobile/Phone', micSwitches: 4, camSwitches: 2 }
          ]
        }
      ]);
    }
  };

  const fetchTasks = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/tasks`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setTasks(data);
      }
    } catch (e) {
      // Mock tasks for showcase mode
      setTasks([
        { _id: 't1', title: 'Prepare project roadmap timeline presentation', assignee: 'Aman', status: 'pending', dueDate: '2026-07-02' },
        { _id: 't2', title: 'Finalize design mockups and client feedback session', assignee: 'Sneha', status: 'pending', dueDate: '2026-07-04' },
        { _id: 't3', title: 'Complete testing phase QA report', assignee: 'Rahul', status: 'completed', dueDate: '2026-06-29' }
      ]);
    }
  };

  const scrollIntoView = (sectionId) => {
    sections[sectionId].current?.scrollIntoView({ behavior: 'smooth' });
    setActiveSection(sectionId);
  };

  const handleCreateMeeting = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/meetings/create`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        }
      });
      const data = await res.json();
      if (res.ok) {
        onJoinMeeting(data.roomId);
      } else {
        throw new Error(data.error || 'Server error');
      }
    } catch (e) {
      console.warn("Failed to create server meeting room, falling back to mock room ID", e);
      const mockRoom = Math.random().toString(36).substring(2, 6) + '-' + Math.random().toString(36).substring(2, 6);
      onJoinMeeting(mockRoom);
    }
  };

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

  const handleJoinMeetingClick = (e) => {
    e.preventDefault();
    const code = parseRoomCode(newRoomId);
    if (code) {
      onJoinMeeting(code);
    }
  };

  const handleGenerateAgenda = async (e) => {
    e.preventDefault();
    if (!agendaGoal.trim()) return;
    setAgendaLoading(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/ai/agenda`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ goal: agendaGoal, duration: agendaDuration })
      });
      const data = await res.json();
      if (res.ok) {
        setGeneratedAgenda(data);
      }
    } catch (e) {
      setGeneratedAgenda({
        goal: agendaGoal,
        duration: agendaDuration,
        agenda: `1. Welcome & Icebreaker (5 mins)\n2. Align on core objective: "${agendaGoal}" (15 mins)\n3. Allocate roles & next task dependencies (${agendaDuration - 25} mins)\n4. Recap of actions & Smart follow-up assignment (5 mins)`
      });
    } finally {
      setAgendaLoading(false);
    }
  };

  const handleToggleTaskStatus = async (taskId, currentStatus) => {
    const nextStatus = currentStatus === 'pending' ? 'completed' : 'pending';
    
    try {
      const res = await fetch(`${BACKEND_URL}/api/tasks/${taskId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ status: nextStatus })
      });
      if (res.ok) {
        fetchTasks();
      }
    } catch (e) {
      setTasks(prev => prev.map(t => {
        if (t._id === taskId) {
          const updated = { ...t, status: nextStatus };
          if (nextStatus === 'completed') {
            confetti({
              particleCount: 50,
              spread: 60,
              origin: { y: 0.8 },
              colors: ['#4A7A5D', '#819472', '#F8F6F2']
            });
          }
          return updated;
        }
        return t;
      }));
    }
  };

  const handleCopyLink = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const handleAddReminder = (e) => {
    e.preventDefault();
    if (!newReminderText.trim() || !newReminderTime.trim()) return;

    const newReminder = {
      id: Math.random().toString(),
      text: newReminderText,
      time: newReminderTime
    };

    const updated = [...reminders, newReminder];
    setReminders(updated);
    localStorage.setItem('meeting_reminders', JSON.stringify(updated));

    setNewReminderText('');
    setNewReminderTime('');
  };

  const handleDeleteReminder = (id) => {
    const updated = reminders.filter(r => r.id !== id);
    setReminders(updated);
    localStorage.setItem('meeting_reminders', JSON.stringify(updated));
  };

  // Calculate real insights from meeting history
  const completedMeetings = meetingsHistory.filter(m => m.isCompleted);
  
  // 1. Avg Score
  const totalScore = completedMeetings.reduce((acc, m) => acc + (m.score || 0), 0);
  const avgScore = completedMeetings.length > 0 
    ? (totalScore / completedMeetings.length).toFixed(1) 
    : 'N/A';

  // 2. Device Stats
  let laptopCount = 0;
  let mobileCount = 0;
  completedMeetings.forEach(m => {
    if (m.participants) {
      m.participants.forEach(p => {
        if (p.device === 'Mobile/Phone') {
          mobileCount++;
        } else {
          laptopCount++;
        }
      });
    }
  });
  const totalDevices = laptopCount + mobileCount;
  const laptopPct = totalDevices > 0 ? Math.round((laptopCount / totalDevices) * 100) : 100;
  const mobilePct = totalDevices > 0 ? Math.round((mobileCount / totalDevices) * 100) : 0;

  return (
    <div className="bg-cream-grad" style={{ minHeight: '100vh', position: 'relative' }}>
      
      {/* Top Navbar */}
      <nav className="fixed-nav">
        <div className="flex-row items-center gap-3" style={{ display: 'flex' }}>
          <div className="flex-row items-center justify-center" style={{ display: 'flex', height: '38px', width: '38px', backgroundColor: 'var(--primary-mint)', color: 'white', borderRadius: '50%' }}>
            <Video style={{ width: '20px', height: '20px' }} />
          </div>
          <span className="font-heading" style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary-mint)' }}>AI Meet Intelligent</span>
        </div>
        
        <div className="nav-links">
          <button onClick={() => scrollIntoView('home')} className={`nav-item ${activeSection === 'home' ? 'active' : ''}`}>
            Home
          </button>
          <button onClick={() => scrollIntoView('agenda')} className={`nav-item ${activeSection === 'agenda' ? 'active' : ''}`}>
            Smart Agenda
          </button>
          <button onClick={() => scrollIntoView('history')} className={`nav-item ${activeSection === 'history' ? 'active' : ''}`}>
            Summaries
          </button>
          <button onClick={() => scrollIntoView('tasks')} className={`nav-item ${activeSection === 'tasks' ? 'active' : ''}`}>
            Action Items
          </button>
          <button onClick={() => scrollIntoView('analytics')} className={`nav-item ${activeSection === 'analytics' ? 'active' : ''}`}>
            Analytics & Reminders
          </button>
        </div>

        <div className="flex-row items-center gap-4" style={{ display: 'flex' }}>
          <span className="border-soft bg-green-accent" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary-mint)', padding: '6px 14px', borderRadius: '20px' }}>
            Hi, {user.name}
          </span>
          <button onClick={onLogout} className="btn-secondary" style={{ padding: '8px 14px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <LogOut style={{ width: '14px', height: '14px' }} /> Logout
          </button>
        </div>
      </nav>

      {/* Snap-scrolling shell container */}
      <div ref={containerRef} className="scroll-shell">
        
        {/* SECTION 1: START/JOIN MEETING */}
        <section id="home" ref={sections.home} className="scroll-section bg-cream-grad">
          <div className="w-full text-center" style={{ maxWidth: '850px' }}>
            <span className="border-soft bg-green-accent" style={{ fontSize: '0.75rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--primary-mint)', padding: '8px 16px', borderRadius: '30px' }}>
              Premium Meeting Spaces
            </span>
            <h1 style={{ fontSize: '2.8rem', fontWeight: 800, marginTop: '20px', marginBottom: '24px', letterSpacing: '-0.02em', lineHeight: '1.2' }}>
              Replicate Google Meet,<br/>Infused with <span style={{ color: 'var(--primary-mint)' }}>Real-time AI Intelligence</span>
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', maxWidth: '600px', margin: '0 auto 20px auto' }}>
              Host instantaneous video calls, share links, track device statistics, log microphone/camera toggles, and chat using automatic speech-to-text.
            </p>
            <img 
              src="/meeting_illustration.png" 
              alt="Meeting Illustration" 
              style={{ width: '100%', maxWidth: '280px', height: 'auto', borderRadius: '16px', marginBottom: '24px', boxShadow: '0 8px 24px rgba(74, 122, 93, 0.08)' }}
            />

            <div className="grid grid-cols-3 gap-6" style={{ maxWidth: '1050px', margin: '0 auto' }}>
              <div className="glass-panel flex-col items-center justify-between" style={{ display: 'flex', minHeight: '260px', padding: '30px' }}>
                <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '50px', width: '50px', borderRadius: '50%', backgroundColor: 'var(--bg-green-light)', color: 'var(--primary-mint)', marginBottom: '16px' }}>
                  <Plus style={{ width: '24px', height: '24px' }} />
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Initiate Instant Meeting</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '8px', marginBottom: '24px' }}>
                  Create a secure native meeting room inside this app. You will get an invite link instantly.
                </p>
                <button onClick={handleCreateMeeting} className="btn-primary w-full">
                  Start Meeting <ArrowRight style={{ width: '16px', height: '16px' }} />
                </button>
              </div>

              <div className="glass-panel flex-col items-center justify-between" style={{ display: 'flex', minHeight: '260px', padding: '30px' }}>
                <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '50px', width: '50px', borderRadius: '50%', backgroundColor: 'var(--bg-green-light)', color: 'var(--primary-mint)', marginBottom: '16px' }}>
                  <Video style={{ width: '24px', height: '24px' }} />
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Join with Room Code</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '8px', marginBottom: '20px' }}>
                  Enter the native room code to join an active session inside this app.
                </p>
                <form onSubmit={handleJoinMeetingClick} className="w-full flex-row gap-3" style={{ display: 'flex' }}>
                  <input
                    type="text"
                    placeholder="abcd-efgh"
                    value={newRoomId}
                    onChange={(e) => setNewRoomId(e.target.value)}
                    className="input-field"
                    style={{ padding: '10px 14px', fontSize: '0.8rem', textAlign: 'center' }}
                    required
                  />
                  <button type="submit" className="btn-secondary shrink-0" style={{ padding: '10px 18px', fontSize: '0.85rem', cursor: 'pointer' }}>
                    Join
                  </button>
                </form>
              </div>

              <div className="glass-panel flex-col items-center justify-between" style={{ display: 'flex', minHeight: '260px', padding: '30px' }}>
                <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '50px', width: '50px', borderRadius: '50%', backgroundColor: 'var(--bg-green-light)', color: 'var(--primary-mint)', marginBottom: '16px' }}>
                  <Activity style={{ width: '24px', height: '24px' }} />
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700 }}>Google Meet AI Copilot</h3>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '8px', marginBottom: '20px' }}>
                  Track mic/cam active times, transcriptions, and summaries while on Google Meet.
                </p>
                <form onSubmit={handleStartCopilotClick} className="w-full flex-row gap-3" style={{ display: 'flex' }}>
                  <input
                    type="text"
                    placeholder="Paste Google Meet link"
                    value={copilotLink}
                    onChange={(e) => setCopilotLink(e.target.value)}
                    className="input-field"
                    style={{ padding: '10px 14px', fontSize: '0.8rem', textAlign: 'center' }}
                    required
                  />
                  <button type="submit" className="btn-primary shrink-0" style={{ padding: '10px 18px', fontSize: '0.85rem', cursor: 'pointer' }}>
                    Launch
                  </button>
                </form>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 2: SMART AGENDA GENERATOR */}
        <section id="agenda" ref={sections.agenda} className="scroll-section bg-green-grad">
          <div className="w-full max-w-4xl">
            <div className="grid grid-cols-2 gap-8">
              <div className="glass-panel flex-col" style={{ display: 'flex' }}>
                <div className="flex-row items-center gap-2" style={{ display: 'flex', marginBottom: '16px' }}>
                  <Sparkles style={{ width: '24px', height: '24px', color: 'var(--primary-mint)' }} />
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Smart AI Agenda</h2>
                </div>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '24px' }}>
                  Input your core meeting goals below, and let the AI generate a detailed, time-blocked meeting agenda structure.
                </p>
                <form onSubmit={handleGenerateAgenda} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div>
                    <label className="form-label">Core Goal of Meeting</label>
                    <input
                      type="text"
                      placeholder="e.g. Design review for payment portal, assign roadmap milestones"
                      value={agendaGoal}
                      onChange={(e) => setAgendaGoal(e.target.value)}
                      className="input-field"
                      style={{ fontSize: '0.85rem' }}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Duration (Minutes)</label>
                    <select
                      value={agendaDuration}
                      onChange={(e) => setAgendaDuration(parseInt(e.target.value))}
                      className="input-field"
                      style={{ fontSize: '0.85rem' }}
                    >
                      <option value={15}>15 Minutes</option>
                      <option value={30}>30 Minutes</option>
                      <option value={45}>45 Minutes</option>
                      <option value={60}>60 Minutes</option>
                    </select>
                  </div>
                  <button type="submit" disabled={agendaLoading} className="btn-primary w-full" style={{ fontSize: '0.85rem' }}>
                    {agendaLoading ? 'Analyzing...' : 'Generate Smart Agenda'}
                  </button>
                </form>
              </div>

              <div className="glass-panel flex-col justify-between" style={{ display: 'flex' }}>
                <div>
                  <h3 className="pb-3 border-soft flex-row items-center justify-between" style={{ display: 'flex', fontSize: '1.1rem', fontWeight: 700, borderBottom: '1px solid var(--border-soft)', marginBottom: '16px' }}>
                    <span>Generated Schedule</span>
                    {generatedAgenda && (
                      <button 
                        onClick={() => handleCopyLink(generatedAgenda.agenda, 'agenda-copy')}
                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)' }}
                        title="Copy to Clipboard"
                      >
                        {copiedId === 'agenda-copy' ? <Check style={{ width: '16px', height: '16px', color: '#166534' }} /> : <Copy style={{ width: '16px', height: '16px' }} />}
                      </button>
                    )}
                  </h3>
                  
                  {generatedAgenda ? (
                    <div className="bg-cream-grad border-soft" style={{ padding: '16px', borderRadius: '12px', fontSize: '0.75rem', lineHeight: '1.6', maxHeight: '250px', overflowY: 'auto', whitespace: 'pre-line', fontFamily: 'monospace', color: 'var(--primary-mint)', fontWeight: '600' }}>
                      {generatedAgenda.agenda}
                    </div>
                  ) : (
                    <div className="flex-col items-center justify-center" style={{ display: 'flex', padding: '60px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
                      <ClipboardList style={{ width: '40px', height: '40px', marginBottom: '8px', opacity: 0.3 }} />
                      <p style={{ fontSize: '0.75rem' }}>No agenda generated yet.</p>
                      <p style={{ fontSize: '0.65rem', marginTop: '4px' }}>Submit your meeting goal on the left to create one.</p>
                    </div>
                  )}
                </div>
                
                {generatedAgenda && (
                  <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '16px' }}>
                    Copy and paste this agenda into your meeting description box when inviting participants.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3: MEETING SUMMARIES & HISTORY */}
        <section id="history" ref={sections.history} className="scroll-section bg-cream-grad">
          <div className="w-full max-w-4xl">
            <div className="flex-row items-center gap-2" style={{ display: 'flex', marginBottom: '24px' }}>
              <History style={{ width: '24px', height: '24px', color: 'var(--primary-mint)' }} />
              <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Past Meeting Insights</h2>
            </div>

            {meetingsHistory.length === 0 ? (
              <div className="glass-panel text-center" style={{ padding: '48px', color: 'var(--text-muted)' }}>
                <ClipboardList style={{ width: '48px', height: '48px', margin: '0 auto 12px auto', opacity: 0.3 }} />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>No Meeting History Found</h3>
                <p style={{ fontSize: '0.75rem', maxWidth: '400px', margin: '8px auto 0 auto' }}>
                  Once you end your first video call meeting, its summaries, transcript, actions, and engagement analytics will be stored here.
                </p>
              </div>
            ) : (
              <div className="dashboard-inner-scroll flex-col gap-4" style={{ display: 'flex' }}>
                {[...meetingsHistory]
                  .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
                  .map((meet) => (
                  <div key={meet._id} className="glass-panel" style={{ padding: '24px' }}>
                    <div className="flex-row items-center justify-between pb-4 border-soft" style={{ display: 'flex', borderBottom: '1px solid var(--border-soft)', marginBottom: '16px' }}>
                      <div>
                        <h3 style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--primary-mint)' }}>{meet.agenda || 'General Meeting Session'}</h3>
                        <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                          <Clock style={{ width: '12px', height: '12px' }} /> {new Date(meet.createdAt).toLocaleString()} | Room Code: <span style={{ fontFamily: 'monospace', fontWeight: 700, backgroundColor: 'var(--bg-green-light)', padding: '2px 6px', borderRadius: '4px' }}>{meet.roomId}</span>
                        </p>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'block' }}>Engagement Score</span>
                        <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--primary-mint)' }}>{meet.score ? meet.score.toFixed(1) : '8.0'}/10.0</span>
                      </div>
                    </div>

                    <div className="flex-col gap-4" style={{ display: 'flex', fontSize: '0.75rem' }}>
                      <div>
                        <h4 className="form-label" style={{ marginBottom: '8px' }}>AI Summary</h4>
                        <p className="bg-cream-grad border-soft" style={{ padding: '12px', borderRadius: '10px', color: 'var(--primary-mint)', fontWeight: '500', lineHeight: '1.5' }}>
                          {meet.summary}
                        </p>
                      </div>

                      <div style={{ marginTop: '4px' }}>
                        <h4 className="form-label" style={{ marginBottom: '8px' }}>Participant Hardware Analytics</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3" style={{ fontSize: '0.7rem' }}>
                          {meet.participants && meet.participants.map((p, idx) => (
                            <div key={idx} className="bg-green-accent border-soft" style={{ padding: '12px', borderRadius: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              <div className="flex-row justify-between items-center" style={{ display: 'flex', borderBottom: '1px solid rgba(74,122,93,0.1)', paddingBottom: '3px' }}>
                                <strong style={{ color: 'var(--primary-mint)' }}>{p.name}</strong>
                                <span className="flex-row items-center gap-1" style={{ display: 'flex', fontSize: '0.6rem', color: 'var(--text-muted)' }}>
                                  {p.device === 'Mobile/Phone' ? <Smartphone style={{ width: '10px', height: '10px' }} /> : <Laptop style={{ width: '10px', height: '10px' }} />}
                                  {p.device || 'Desktop/Laptop'}
                                </span>
                              </div>
                              <div className="flex-col gap-1" style={{ display: 'flex', fontSize: '0.65rem' }}>
                                <div className="flex-row justify-between" style={{ display: 'flex' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>🎙️ Mic Toggles:</span>
                                  <strong>{p.micSwitches || 0} times</strong>
                                </div>
                                <div className="flex-row justify-between" style={{ display: 'flex' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>🎙️ Active Time:</span>
                                  <strong>{formatDuration(p.micOnDuration)}</strong>
                                </div>
                                <div className="flex-row justify-between" style={{ display: 'flex' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>🎙️ Muted Time:</span>
                                  <strong>{formatDuration(p.micOffDuration || 0)}</strong>
                                </div>
                                <div className="flex-row justify-between" style={{ display: 'flex', borderTop: '1px dashed rgba(74,122,93,0.1)', paddingTop: '2px', marginTop: '2px' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>📷 Cam Active:</span>
                                  <strong>{formatDuration(p.camOnDuration)}</strong>
                                </div>
                                <div className="flex-row justify-between" style={{ display: 'flex' }}>
                                  <span style={{ color: 'var(--text-muted)' }}>📷 Cam Inactive:</span>
                                  <strong>{formatDuration(p.camOffDuration || 0)}</strong>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Collapsible Transcript Dialogue Log */}
                      {meet.transcript && meet.transcript.length > 0 && (
                        <div style={{ marginTop: '8px' }}>
                          <button 
                            onClick={() => toggleTranscript(meet._id)} 
                            className="btn-secondary flex-row items-center justify-between"
                            style={{ display: 'flex', width: '100%', padding: '10px 16px', fontSize: '0.75rem', borderRadius: '10px' }}
                          >
                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700 }}>
                              <MessageSquare style={{ width: '14px', height: '14px', color: 'var(--primary-mint)' }} /> 
                              {expandedTranscripts[meet._id] ? 'Hide Meeting Chat Transcript Timeline' : 'View Full Group Chat & Transcript Timeline'}
                            </span>
                            {expandedTranscripts[meet._id] ? <ChevronUp style={{ width: '14px', height: '14px' }} /> : <ChevronDown style={{ width: '14px', height: '14px' }} />}
                          </button>
                          
                          {expandedTranscripts[meet._id] && (
                            <div className="bg-green-accent border-soft flex-col gap-2 chat-message-scroller" style={{ display: 'flex', marginTop: '10px', padding: '16px', borderRadius: '12px', maxHeight: '250px', overflowY: 'auto' }}>
                              {meet.transcript.map((msg, idx) => (
                                msg.isSystem ? (
                                  <div key={idx} style={{ textAlign: 'center', margin: '4px 0', fontSize: '0.68rem', color: 'var(--accent-olive)', fontStyle: 'italic' }}>
                                    — {msg.message} —
                                  </div>
                                ) : (
                                  <div key={idx} style={{ fontSize: '0.72rem', display: 'flex', flexDirection: 'column', gap: '2px', paddingBottom: '6px', borderBottom: '1px solid rgba(74,122,93,0.1)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                                      <strong style={{ color: 'var(--primary-mint)' }}>
                                        {msg.sender} 
                                        {msg.isSpeech && <span style={{ fontSize: '6px', textTransform: 'uppercase', letterSpacing: '0.05em', marginLeft: '6px', backgroundColor: 'rgba(74,122,93,0.06)', padding: '1px 3px', borderRadius: '2px' }}>Voice</span>}
                                      </strong>
                                      <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{msg.timestamp}</span>
                                    </div>
                                    <span style={{ color: 'var(--text-dark)' }}>{msg.message}</span>
                                  </div>
                                )
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* SECTION 4: ACTION ITEMS BOARD */}
        <section id="tasks" ref={sections.tasks} className="scroll-section bg-green-grad">
          <div className="w-full max-w-4xl">
            <div className="flex-row items-center justify-between" style={{ display: 'flex', marginBottom: '24px' }}>
              <div className="flex-row items-center gap-2" style={{ display: 'flex' }}>
                <CheckSquare style={{ width: '24px', height: '24px', color: 'var(--primary-mint)' }} />
                <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Action Items & Deliverables</h2>
              </div>
              <span className="bg-green-accent border-soft" style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--primary-mint)', padding: '6px 14px', borderRadius: '20px' }}>
                {tasks.filter(t => t.status === 'pending').length} Pending Tasks
              </span>
            </div>

            {tasks.length === 0 ? (
              <div className="glass-panel text-center" style={{ padding: '48px', color: 'var(--text-muted)' }}>
                <CheckSquare style={{ width: '48px', height: '48px', margin: '0 auto 12px auto', opacity: 0.3 }} />
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>No Pending Actions</h3>
                <p style={{ fontSize: '0.75rem', maxWidth: '400px', margin: '8px auto 0 auto' }}>
                  Action items detected automatically during meeting transcript processing will be loaded and displayed on this task dashboard.
                </p>
              </div>
            ) : (
              <div className="dashboard-inner-scroll grid grid-cols-2 gap-4">
                {tasks.map((task) => (
                  <div 
                    key={task._id} 
                    onClick={() => handleToggleTaskStatus(task._id, task.status)}
                    className="glass-panel flex-row gap-4"
                    style={{ 
                      display: 'flex', 
                      padding: '16px', 
                      alignItems: 'flex-start',
                      cursor: 'pointer',
                      opacity: task.status === 'completed' ? 0.6 : 1,
                      textDecoration: task.status === 'completed' ? 'line-through' : 'none',
                      backgroundColor: task.status === 'completed' ? 'rgba(74, 122, 93, 0.02)' : 'white'
                    }}
                  >
                    <div style={{ 
                      marginTop: '2px',
                      display: 'flex', 
                      height: '20px', 
                      width: '20px', 
                      flexShrink: 0, 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      borderRadius: '4px', 
                      border: '1.5px solid var(--border-soft)',
                      backgroundColor: task.status === 'completed' ? 'var(--primary-mint)' : 'var(--bg-yellow-light)',
                      color: task.status === 'completed' ? 'white' : 'transparent'
                    }}>
                      <Check style={{ width: '14px', height: '14px' }} />
                    </div>

                    <div className="flex-1" style={{ fontSize: '0.75rem' }}>
                      <p style={{ fontWeight: 600, color: 'var(--text-dark)' }}>
                        {task.title}
                      </p>
                      
                      <div className="flex-row justify-between items-center" style={{ display: 'flex', marginTop: '12px', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        <span className="bg-green-accent border-soft" style={{ fontWeight: 700, padding: '2px 8px', borderRadius: '4px', color: 'var(--primary-mint)' }}>
                          Assignee: {task.assignee}
                        </span>
                        <span>Due: {task.dueDate || 'No due date'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* SECTION 5: ANALYTICS & REMINDERS */}
        <section id="analytics" ref={sections.analytics} className="scroll-section bg-cream-grad">
          <div className="w-full max-w-4xl">
            <div className="grid grid-cols-3 gap-8">
              
              {/* Analytics Summary */}
              <div style={{ gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div className="flex-row items-center gap-2" style={{ display: 'flex' }}>
                  <BarChart2 style={{ width: '24px', height: '24px', color: 'var(--primary-mint)' }} />
                  <h2 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Engagement Insights</h2>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="glass-panel text-center" style={{ padding: '20px' }}>
                    <Activity style={{ width: '24px', height: '24px', margin: '0 auto 8px auto', color: 'var(--primary-mint)' }} />
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', display: 'block' }}>Average Meeting Score</span>
                    <span style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary-mint)', marginTop: '4px', display: 'block' }}>{avgScore === 'N/A' ? 'N/A' : `${avgScore}/10.0`}</span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '8px', display: 'block' }}>Calculated from actual history</span>
                  </div>
                  <div className="glass-panel text-center" style={{ padding: '20px' }}>
                    <History style={{ width: '24px', height: '24px', margin: '0 auto 8px auto', color: 'var(--primary-mint)' }} />
                    <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.05em', display: 'block' }}>Total Hosted Calls</span>
                    <span style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--primary-mint)', marginTop: '4px', display: 'block' }}>{completedMeetings.length}</span>
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '8px', display: 'block' }}>All logs and data stored</span>
                  </div>
                </div>

                {/* Device Distribution Widget */}
                <div className="glass-panel" style={{ padding: '24px' }}>
                  <h3 style={{ fontSize: '0.85rem', fontWeight: 700, borderBottom: '1px solid var(--border-soft)', paddingBottom: '12px', marginBottom: '16px' }}>Device Access Distribution</h3>
                  <div className="flex-row items-center justify-around" style={{ display: 'flex' }}>
                    <div className="flex-row items-center gap-3" style={{ display: 'flex' }}>
                      <div className="border-soft bg-green-accent" style={{ display: 'flex', padding: '12px', borderRadius: '50%', color: 'var(--primary-mint)' }}>
                        <Laptop style={{ width: '24px', height: '24px' }} />
                      </div>
                      <div style={{ fontSize: '0.75rem' }}>
                        <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{laptopPct}%</span>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.65rem' }}>Desktop / Laptop</span>
                      </div>
                    </div>
                    
                    <div className="flex-row items-center gap-3" style={{ display: 'flex' }}>
                      <div className="border-soft bg-green-accent" style={{ display: 'flex', padding: '12px', borderRadius: '50%', color: 'var(--primary-mint)' }}>
                        <Smartphone style={{ width: '24px', height: '24px' }} />
                      </div>
                      <div style={{ fontSize: '0.75rem' }}>
                        <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{mobilePct}%</span>
                        <span style={{ color: 'var(--text-muted)', display: 'block', fontSize: '0.65rem' }}>Mobile / Phone</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Reminders Panel */}
              <div className="glass-panel flex-col justify-between" style={{ display: 'flex', padding: '24px' }}>
                <div>
                  <div className="flex-row items-center gap-2 pb-3 border-soft" style={{ display: 'flex', borderBottom: '1px solid var(--border-soft)', marginBottom: '16px' }}>
                    <Calendar style={{ width: '20px', height: '20px', color: 'var(--primary-mint)' }} />
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 700 }}>Smart Reminders</h3>
                  </div>

                  <form onSubmit={handleAddReminder} style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
                    <input
                      type="text"
                      placeholder="Add custom reminder..."
                      value={newReminderText}
                      onChange={(e) => setNewReminderText(e.target.value)}
                      className="input-field"
                      style={{ padding: '8px 12px', fontSize: '0.75rem' }}
                      required
                    />
                    <div className="flex-row gap-2" style={{ display: 'flex' }}>
                      <input
                        type="text"
                        placeholder="e.g. Tomorrow, 10 AM"
                        value={newReminderTime}
                        onChange={(e) => setNewReminderTime(e.target.value)}
                        className="input-field"
                        style={{ padding: '8px 12px', fontSize: '0.75rem' }}
                        required
                      />
                      <button type="submit" className="btn-primary" style={{ padding: '8px 12px' }}>
                        <PlusCircle style={{ width: '16px', height: '16px' }} />
                      </button>
                    </div>
                  </form>

                  <div className="flex-col gap-3" style={{ display: 'flex', maxHeight: '180px', overflowY: 'auto' }}>
                    {reminders.map((rem) => (
                      <div key={rem.id} className="bg-cream-grad border-soft" style={{ padding: '12px', borderRadius: '10px', fontSize: '0.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <p style={{ fontWeight: 700, color: 'var(--primary-mint)' }}>{rem.text}</p>
                          <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <Clock style={{ width: '10px', height: '10px' }} /> {rem.time}
                          </p>
                        </div>
                        <button 
                          onClick={() => handleDeleteReminder(rem.id)}
                          style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '0.75rem', fontWeight: 'bold' }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                </div>

                <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', textAlign: 'center', marginTop: '16px' }}>
                  Reminders are synced locally with browser storage for quick dashboard refresh alerts.
                </p>
              </div>

            </div>
          </div>
        </section>

      </div>
    </div>
  );
}

export default Dashboard;
