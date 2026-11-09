import { stateStore } from '../Store.js';

export class ChatPanel {
  constructor(container) {
    this.container = container; 
  }
  
  render() {
    this.container.innerHTML = `
        <div class="chat-header">
          <div style="display:flex; align-items:center; gap:12px;">
            <i class="fa-solid fa-hashtag" style="color: var(--text-muted);"></i>
            <h4 id="active-channel-name" style="margin:0; font-size: 18px; font-weight: 800; color: var(--text-primary);"></h4>
          </div>
        </div>
        <div id="messages-list" style="flex:1; padding: 24px; overflow-y: auto; display: flex; flex-direction: column; background: #ffffff;">
        </div>
        <div class="input-area-wrapper">
          <form id="message-form">
            <div class="input-box" id="main-input-box">
                <input type="file" id="attachment-input" style="display:none;" multiple>
                <button type="button" class="input-btn" id="attach-btn" title="Attach"><i class="fa-solid fa-circle-plus"></i></button>
                <input type="text" class="chat-input" id="message-input" placeholder="Message..." autocomplete="off">
                <div class="input-icons">
                    <i class="fa-solid fa-gift" title="Gift"></i>
                    <i class="fa-solid fa-note-sticky" title="Stickers"></i>
                    <i class="fa-solid fa-face-smile" title="Emoji"></i>
                </div>
                <button type="submit" style="display:none;"></button>
            </div>
          </form>
        </div>
    `;
    this.container.querySelector('#message-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendMessage();
    });
  }

  sendMessage() {
    const input = this.container.querySelector('#message-input');
    const content = input.value.trim();
    const state = stateStore.getState();
    if (!content || !state.activeChannelId) return;
    
    if (window.app && window.app.socket) {
      window.app.socket.emit('sendMessage', {
        channelId: state.activeChannelId,
        content
      });
      input.value = '';
    }
  }

  updateUI(state) {
    const activeChannelName = this.container.querySelector('#active-channel-name');
    const activeChannel = state.channels.find(c => c.id === state.activeChannelId);
    if (activeChannelName) {
      activeChannelName.textContent = activeChannel ? `${activeChannel.name}` : 'Welcome';
      const input = this.container.querySelector('#message-input');
      if (input) input.placeholder = activeChannel ? `Message #${activeChannel.name}` : 'Select a channel...';
    }

    const messagesList = this.container.querySelector('#messages-list');
    if (messagesList) {
      messagesList.innerHTML = state.messages.map(m => `
        <div class="message">
          <div style="width: 40px; height: 40px; border-radius: 50%; background: var(--bg-app); color: var(--accent-color); display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; flex-shrink: 0;">
            ${(m.user || 'U').charAt(0).toUpperCase()}
          </div>
          <div style="flex: 1; min-width: 0;">
            <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px;">
              <strong style="color: var(--text-primary); font-size: 15px; font-weight: 800;">${m.user}</strong>
              <span style="color: var(--text-muted); font-size: 12px; font-weight: 600;">${new Date(m.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
            </div>
            <p style="margin: 0; color: var(--text-primary); font-size: 15px; font-weight: 600; line-height: 1.4; word-wrap: break-word;">${m.content}</p>
          </div>
        </div>
      `).join('');
      messagesList.scrollTop = messagesList.scrollHeight;
    }
  }
}
