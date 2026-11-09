import { stateStore } from '../Store.js';

const API_BASE = 'http://localhost:3001';

export class LoginView {
  constructor(rootElement) {
    this.root = rootElement;
    this.container = null;
  }

  render() {
    this.container = document.createElement('div');
    this.container.className = 'auth-container';
    
    this.container.innerHTML = `
      <div class="auth-box">
        <div style="display: flex; justify-content: center; margin-bottom: 24px;">
            <div style="width: 64px; height: 64px; background: var(--accent-color); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 32px; font-weight: 900; border-bottom: 4px solid var(--accent-bottom);">A</div>
        </div>
        <h2 style="margin-top:0; margin-bottom: 24px; text-align: center; color: var(--text-primary); font-weight: 900;">Welcome to Acero</h2>
        <div id="error-msg" style="color: #ff4b4b; background: #ffebeb; padding: 12px; border-radius: var(--radius-sm); margin-bottom: 16px; font-weight: 700; font-size: 14px; display: none;"></div>
        
        <div style="margin-bottom: 8px; font-size: 12px; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Username</div>
        <input type="text" id="username" class="form-input" placeholder="Enter username" autocomplete="username" />
        
        <div style="margin-bottom: 8px; font-size: 12px; font-weight: 800; color: var(--text-muted); text-transform: uppercase;">Password</div>
        <input type="password" id="password" class="form-input" placeholder="Password" autocomplete="current-password" />
        
        <button id="login-btn" class="btn" style="width: 100%; margin-top: 8px;">Login</button>
        <button id="register-btn" class="btn" style="width: 100%; margin-top: 16px; background: var(--bg-surface); color: var(--text-secondary); border: 2px solid var(--border); border-bottom: 4px solid var(--border-subtle);">Create Account</button>
      </div>
    `;

    this.root.appendChild(this.container);

    this.container.querySelector('#login-btn').addEventListener('click', () => this.handleAuth('/api/auth/login'));
    this.container.querySelector('#register-btn').addEventListener('click', () => this.handleAuth('/api/auth/register'));
  }

  async handleAuth(endpoint) {
    const errorMsg = this.container.querySelector('#error-msg');
    const username = this.container.querySelector('#username').value;
    const password = this.container.querySelector('#password').value;

    if (!username || !password) {
      errorMsg.textContent = 'Please fill out all fields.';
      errorMsg.style.display = 'block';
      return;
    }

    try {
      errorMsg.style.display = 'none';
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      localStorage.setItem('acero_token', data.token);
      stateStore.setState({ user: data.user });
      
      if (window.app && window.app.connectSocket) {
        window.app.connectSocket(data.token);
      }
      
      window.location.hash = '/chat';
    } catch (err) {
      errorMsg.textContent = err.message;
      errorMsg.style.display = 'block';
    }
  }

  destroy() {
    if (this.container) {
      this.container.remove();
    }
  }
}
