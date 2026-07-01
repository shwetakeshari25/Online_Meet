import React, { useState } from 'react';
import { Video, LogIn, UserPlus, AlertCircle, Sparkles, UserCheck } from 'lucide-react';

function Login({ onLogin, initialRoomId }) {
  const [isLoginTab, setIsLoginTab] = useState(true);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const endpoint = isLoginTab ? '/api/auth/login' : '/api/auth/register';
    const payload = isLoginTab ? { email, password } : { name, email, password };

    try {
      const res = await fetch(`http://${window.location.hostname}:5000${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (res.ok) {
        onLogin(data.token, data.user);
      } else {
        setError(data.error || 'Invalid credentials or database connection issue.');
      }
    } catch (err) {
      console.warn("Backend server connection failed. Standard fallback applied.", err);
      setError("Unable to connect to backend server. Try 'Showcase Access' below!");
    } finally {
      setLoading(false);
    }
  };

  const handleShowcaseLogin = (role) => {
    const mockUser = role === 'host' 
      ? { id: 'host-user-id', name: 'Aman', email: 'aman@meeting.com' }
      : { id: 'participant-user-id', name: 'Sneha', email: 'sneha@meeting.com' };
    
    onLogin('mock-jwt-token-12345', mockUser);
  };

  return (
    <div className="flex-col items-center justify-center bg-cream-grad" style={{ minHeight: '100vh', display: 'flex', padding: '16px' }}>
      <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', position: 'relative', overflow: 'hidden' }}>
        
        <div className="flex-col items-center" style={{ display: 'flex', marginBottom: '24px' }}>
          <div className="flex-row items-center justify-center border-soft" style={{ display: 'flex', height: '60px', width: '60px', borderRadius: '14px', backgroundColor: 'var(--bg-green-light)', color: 'var(--primary-mint)', marginBottom: '16px' }}>
            <Video className="pulse-active" style={{ width: '32px', height: '32px' }} />
          </div>
          <h2 style={{ fontSize: '1.8rem', textAlign: 'center' }}>AI Meeting Intelligent</h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'center' }}>
            Smart, collaborative, and outcome-driven meeting spaces.
          </p>
          
          {initialRoomId && (
            <div className="border-soft bg-green-accent" style={{ marginTop: '16px', padding: '12px', borderRadius: '12px', fontSize: '0.75rem', color: 'var(--primary-mint)', fontWeight: '700', textAlign: 'center', width: '100%' }}>
              Invited to join room: <span style={{ fontFamily: 'monospace', textDecoration: 'underline', fontSize: '0.9rem', letterSpacing: '0.05em' }}>{initialRoomId}</span>
            </div>
          )}
        </div>

        {/* Tab Selection */}
        <div className="tab-container">
          <button
            onClick={() => { setIsLoginTab(true); setError(''); }}
            className={`tab-btn ${isLoginTab ? 'active' : ''}`}
          >
            <LogIn style={{ width: '16px', height: '16px' }} /> Sign In
          </button>
          <button
            onClick={() => { setIsLoginTab(false); setError(''); }}
            className={`tab-btn ${!isLoginTab ? 'active' : ''}`}
          >
            <UserPlus style={{ width: '16px', height: '16px' }} /> Register
          </button>
        </div>

        {error && (
          <div className="border-soft" style={{ marginBottom: '20px', padding: '14px', backgroundColor: '#FEF2F2', borderColor: '#FEE2E2', borderRadius: '12px', display: 'flex', gap: '10px', fontSize: '0.75rem', color: '#B91C1C' }}>
            <AlertCircle style={{ width: '16px', height: '16px', flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {!isLoginTab && (
            <div>
              <label className="form-label">Full Name</label>
              <input
                type="text"
                placeholder="Aman Sharma"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                required={!isLoginTab}
              />
            </div>
          )}

          <div>
            <label className="form-label">Email Address</label>
            <input
              type="email"
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              required
            />
          </div>

          <div>
            <label className="form-label">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input-field"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full"
            style={{ marginTop: '12px', padding: '16px 20px' }}
          >
            {loading ? 'Processing...' : isLoginTab ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {/* Showcase / HR Demo Access Panel */}
        <div className="divider-container">
          <div className="divider-line"></div>
          <span className="divider-text">Or HR Demo Access</span>
        </div>

        <div className="showcase-card">
          <div className="flex-row items-center justify-center" style={{ display: 'flex', gap: '6px', color: 'var(--primary-mint)', fontWeight: '700', fontSize: '0.8rem', marginBottom: '8px' }}>
            <Sparkles className="pulse-active" style={{ width: '14px', height: '14px' }} />
            <span>Launch Showcase Mode Instantly</span>
          </div>
          <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '16px' }}>
            Bypass standard database setup and log in as either participant role for quick local testing.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleShowcaseLogin('host')}
              className="btn-secondary"
              style={{ padding: '10px 14px', fontSize: '0.75rem', backgroundColor: 'var(--bg-yellow-light)', cursor: 'pointer' }}
            >
              <UserCheck style={{ width: '14px', height: '14px' }} /> Host (Aman)
            </button>
            <button
              onClick={() => handleShowcaseLogin('participant')}
              className="btn-secondary"
              style={{ padding: '10px 14px', fontSize: '0.75rem', backgroundColor: 'var(--bg-yellow-light)', cursor: 'pointer' }}
            >
              <UserCheck style={{ width: '14px', height: '14px' }} /> Guest (Sneha)
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

export default Login;
