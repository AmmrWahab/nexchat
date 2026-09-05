// src/pages/SigninPage.jsx

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './signup.css'; // Share the signup/auth layout styles
import { API_URL } from '../config.js';

export default function SigninPage() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('');
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');
    setMessageType('');

    try {
      const res = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (res.ok) {
        localStorage.setItem('token', data.token);
        navigate('/dashboard');
      } else {
        setMessage(data.message || 'Invalid email or password.');
        setMessageType('error');
      }
    } catch (err) {
      console.error('Login Error:', err);
      setMessage('Network error. Please check your connection.');
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  // ✅ Real Google Login: Redirect to Backend OAuth
  const handleGoogleLogin = () => {
    // Open Google OAuth route on backend
    window.location.href = `${API_URL}/api/auth/google`;
  };

  return (
    <div className="auth-layout">
      {/* Left Brand Panel */}
      <div className="brand-panel">
        <div className="brand-content">
          <h1>NexChat</h1>
          <p>Stay in touch effortlessly. Your conversations, your way.</p>
        </div>
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
      </div>

      {/* Right Form Panel */}
      <div className="form-panel">
        <div className="form-container slide-in">
          <h2>Sign In</h2>

          {/* Message Display */}
          {message && (
            <div className={`form-message ${messageType}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <input
              type="email"
              name="email"
              placeholder="Email Address"
              value={formData.email}
              onChange={handleChange}
              required
            />
            <input
              type="password"
              name="password"
              placeholder="Password"
              value={formData.password}
              onChange={handleChange}
              required
            />
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Signing In...' : 'Sign In'}
            </button>
          </form>

          {/* Google Login Button */}
          <button
            className="btn-google"
            onClick={handleGoogleLogin}
            disabled={loading}
            type="button"
          >
            <img src="https://img.icons8.com/color/16/000000/google-logo.png" alt="Google" />
            {loading ? 'Processing...' : 'Sign in with Google'}
          </button>

          {/* Sign Up Link */}
          <button className="btn-link" onClick={() => navigate('/signup')}>
            Don't have an account? <strong>Sign Up</strong>
          </button>
        </div>
      </div>
    </div>
  );
}