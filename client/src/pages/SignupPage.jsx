// src/pages/SignupPage.jsx

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './signup.css'; // Reuse same CSS
import { API_URL } from '../config.js';

export default function SignupPage() {
  const [formData, setFormData] = useState({
    name: '',
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
      const res = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });

      const data = await res.json();

      if (res.ok) {
        setMessage('✅ Account created! Please sign in.');
        setMessageType('success');
        setFormData({ name: '', email: '', password: '' }); // Optional: clear form
      } else {
        setMessage(data.message || 'Signup failed. Please try again.');
        setMessageType('error');
      }
    } catch (err) {
      console.error('Signup Error:', err);
      setMessage('Network error. Please check your connection.');
      setMessageType('error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-layout">
      {/* Left Brand Panel */}
      <div className="brand-panel">
        <div className="brand-content">
          <h1>NexChat</h1>
          <p>Connect with friends and family in real time. Secure, fast, and beautiful.</p>
        </div>
        <div className="shape shape-1"></div>
        <div className="shape shape-2"></div>
        <div className="shape shape-3"></div>
      </div>

      {/* Right Form Panel */}
      <div className="form-panel">
        <div className="form-container slide-in">
          <h2>Create Account</h2>

          {/* Message Display */}
          {message && (
            <div className={`form-message ${messageType}`}>
              {message}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <input
              type="text"
              name="name"
              placeholder="Full Name"
              value={formData.name}
              onChange={handleChange}
              required
            />
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
              placeholder="Password (6+ chars)"
              value={formData.password}
              onChange={handleChange}
              required
            />
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Creating Account...' : 'Sign Up'}
            </button>
          </form>

          {/* Sign In Link */}
          <button className="btn-link" onClick={() => navigate('/signin')}>
            Already have an account? <strong>Sign In</strong>
          </button>
        </div>
      </div>
    </div>
  );
}