// src/App.jsx

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import SignupPage from './pages/SignupPage';
import SigninPage from './pages/SigninPage';
import DashboardPage from './pages/DashboardPage';
import ErrorBoundary from './components/ErrorBoundary';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SigninPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/signin" element={<SigninPage />} />
       <Route path="/dashboard" element={
  <ErrorBoundary>
    <DashboardPage />
  </ErrorBoundary>
} />
      </Routes>
       
    </BrowserRouter>
  );
}