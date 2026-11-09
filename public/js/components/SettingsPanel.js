import { stateStore } from '../Store.js';

export class SettingsPanel {
  constructor(container) {
    this.container = container; 
  }
  
  render() {
    this.container.innerHTML = `
      <div class="chat-header">
          <div style="display:flex; align-items:center; gap:12px;">
            <i class="fa-solid fa-gear" style="color: var(--text-muted);"></i>
            <h4 style="margin:0; font-size: 18px; font-weight: 800; color: var(--text-primary);">User Settings</h4>
          </div>
          <div>
            <button id="close-settings-btn" title="Close" style="background: none; border: none; cursor: pointer; color: var(--text-muted); font-size: 20px;"><i class="fa-solid fa-xmark"></i></button>
          </div>
      </div>
      <div style="flex:1; padding: 48px; overflow-y: auto; background: #fdfdfd;">
        <h2 style="font-weight: 900; margin-bottom: 32px; font-size: 24px; color: var(--text-primary);">My Profile</h2>
        <div style="display:flex; flex-direction:column; gap:24px; max-width: 600px;">
            <div>
              <label style="font-weight: 800; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; display: block; text-transform: uppercase;">Display Name</label>
              <input type="text" class="form-input" id="settings-display-name" placeholder="Display Name" />
            </div>
            <div>
              <label style="font-weight: 800; font-size: 12px; color: var(--text-muted); margin-bottom: 8px; display: block; text-transform: uppercase;">About Me</label>
              <textarea class="form-input" id="settings-bio" style="height: 100px; resize: none;" placeholder="Write a little about yourself..."></textarea>
            </div>
            <button class="btn" style="align-self: flex-start; margin-top: 8px;">Save Changes</button>
            <div style="height: 2px; background: var(--border-subtle); margin: 24px 0;"></div>
            <button class="btn" id="logout-btn" style="background: #ff4b4b; border-bottom: 4px solid #cc3c3c; margin-top: 8px; width: 200px;">Log Out</button>
        </div>
      </div>
    `;

    this.container.querySelector('#close-settings-btn').addEventListener('click', () => {
      stateStore.setState({ middlePanel: 'chat' });
    });
    
    this.container.querySelector('#logout-btn').addEventListener('click', () => {
      localStorage.removeItem('acero_token');
      stateStore.setState({ user: null });
      if (window.app && window.app.socket) window.app.socket.disconnect();
      window.location.hash = '/';
    });
  }

  updateUI(state) {
    const nameInput = this.container.querySelector('#settings-display-name');
    if (nameInput && state.user && state.user.username) {
        if (!nameInput.value) nameInput.value = state.user.username;
    }
  }
}
