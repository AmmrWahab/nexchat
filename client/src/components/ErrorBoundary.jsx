// src/components/ErrorBoundary.jsx
import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('💥 Error caught by boundary:', error);
    console.error('Component Stack:', info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '20px',
          color: 'red',
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap'
        }}>
          <h2>❌ Error in DashboardPage</h2>
          <p>{this.state.error?.toString()}</p>
          <details>
            <summary>Details</summary>
            {this.state.error?.stack}
          </details>
        </div>
      );
    }

    return this.props.children;
  }
}