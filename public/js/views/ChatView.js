import { stateStore } from '../Store.js';
import { ChatPanel } from '../components/ChatPanel.js';
import { SettingsPanel } from '../components/SettingsPanel.js';
import { MembersPanel } from '../components/MembersPanel.js';
import { ContextMenu } from '../components/ContextMenu.js';

const API_BASE = 'http://localhost:3001';

export class ChatView {
  constructor(rootElement) {
    this.root = rootElement;
    this.container = null;
    this.unsubscribe = null;
    this.token = localStorage.getItem('acero_token');
    
    this.chatPanel = null;
    this.settingsPanel = null;
    this.membersPanel = null;
    this.currentMiddlePanel = null;
  }

  render() {
    this.container = document.createElement('div');
    this.container.className = 'app-container';
    
    this.container.innerHTML = `
      <div class="server-sidebar">
        <div id="dynamic-nav" style="display:flex; flex-direction:column; gap:12px; align-items:center; width:100%; padding: 4px 0;">
            <div class="brand-logo" id="home-btn" title="Direct Messages" style="width:56px; height:56px; background:var(--accent-color); color:white; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:24px; font-weight:900; cursor:pointer; border-bottom:4px solid var(--accent-bottom); transition: 0.1s;"><i class="fa-brands fa-discord" style="font-size: 24px;"></i></div>
            <div style="width:40px; height:3px; background:var(--border-subtle); border-radius:3px;"></div>
        </div>
        <div id="servers-list" style="flex:1; width: 100%; display: flex; flex-direction: column; align-items: center; gap: var(--spacing-sm); overflow-y: auto;">
        </div>
        <button id="add-server-btn" title="Add Server" style="border-radius: 50%; border: none; padding: 0; font-size: 20px; display:flex; align-items:center; justify-content:center; width: 48px; height: 48px; background: var(--bg-surface); color: var(--accent-color); cursor: pointer; transition: 0.2s; margin-top: auto;"><i class="fa-solid fa-plus"></i></button>
      </div>
      
      <div class="sidebar">
        <div class="chat-header">
          <h3 id="active-server-name" style="margin:0; color: var(--text-primary); text-overflow: ellipsis; overflow: hidden; white-space: nowrap; font-size: 15px; font-weight: 800; text-transform: uppercase;">Direct Messages</h3>
          <i class="fa-solid fa-chevron-down" style="font-size: 12px; color: var(--text-muted);"></i>
        </div>
        <div id="channels-list" style="flex:1; padding: 16px 8px; overflow-y: auto;">
        </div>
        <div id="user-settings-btn" title="User Settings" style="padding: 12px 16px; background: #f7f7f7; display:flex; align-items:center; height: 60px; border-top: 2px solid var(--border-subtle); margin-top: auto; cursor: pointer; transition: background 0.15s;">
          <div style="width: 32px; height: 32px; border-radius: 50%; background: var(--accent-color); margin-right: 12px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 14px;">U</div>
          <span id="user-display" style="font-weight: 800; font-size: 15px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; color: var(--text-primary); flex: 1;"></span>
          <i class="fa-solid fa-gear" style="color: var(--text-muted); font-size: 14px;"></i>
        </div>
      </div>
      
      <div class="main-content" id="main-panel-wrapper">
      </div>

      <div class="right-panel" id="members-panel-wrapper">
      </div>
    `;

    this.root.appendChild(this.container);

    this.mainPanelWrapper = this.container.querySelector('#main-panel-wrapper');
    this.membersPanelWrapper = this.container.querySelector('#members-panel-wrapper');
    
    this.chatPanel = new ChatPanel(this.mainPanelWrapper);
    this.settingsPanel = new SettingsPanel(this.mainPanelWrapper);
    this.membersPanel = new MembersPanel(this.membersPanelWrapper);

    this.attachEventListeners();
    this.fetchServers();

    this.unsubscribe = stateStore.subscribe('stateChange', () => {
      this.updateUI();
    });
    
    this.bindSocketEvents();
    
    // Load home automatically
    stateStore.setState({ activeServerId: null, activeChannelId: null, middlePanel: 'chat', messages: [] });
    this.updateUI();
  }

  bindSocketEvents() {
    if (window.app && window.app.socket) {
      window.app.socket.off('channelHistory');
      window.app.socket.off('newMessage');
      window.app.socket.on('channelHistory', (data) => this.handleChannelHistory(data));
      window.app.socket.on('newMessage', (data) => this.handleNewMessage(data));
    }
  }

  attachEventListeners() {
    this.container.querySelector('#add-server-btn').addEventListener('click', () => this.createServer());
    this.container.querySelector('#home-btn').addEventListener('click', () => {
      stateStore.setState({ activeServerId: null, activeChannelId: null, middlePanel: 'chat', messages: [] });
    });
    this.container.querySelector('#user-settings-btn').addEventListener('click', () => {
      if (stateStore.getState().middlePanel === 'settings') {
         stateStore.setState({ middlePanel: 'chat' });
      } else {
         stateStore.setState({ middlePanel: 'settings' });
      }
    });
  }

  async fetchServers() {
    try {
      const res = await fetch(`${API_BASE}/api/servers`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (res.ok) {
        const servers = await res.json();
        stateStore.setState({ servers });
      }
    } catch (e) {
      console.error(e);
    }
  }

  async selectServer(server) {
    stateStore.setState({ activeServerId: server.id, activeChannelId: null, messages: [], middlePanel: 'chat' });
    try {
      const res = await fetch(`${API_BASE}/api/servers/${server.id}/channels`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });
      if (res.ok) {
        const channels = await res.json();
        stateStore.setState({ channels });
        if (channels.length > 0) {
          this.selectChannel(channels[0]);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  selectChannel(channel) {
    stateStore.setState({ activeChannelId: channel.id, messages: [], middlePanel: 'chat' });
    this.bindSocketEvents();
    if (window.app && window.app.socket) {
      window.app.socket.emit('joinChannel', channel.id);
    }
  }

  async createServer() {
    const name = prompt('Enter Server Name:');
    if (!name) return;
    try {
      const res = await fetch(`${API_BASE}/api/servers`, {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name })
      });
      if (res.ok) {
        this.fetchServers();
      }
    } catch (e) {
      console.error(e);
    }
  }

  handleChannelHistory(data) {
    const state = stateStore.getState();
    if (data.channelId === state.activeChannelId) {
      stateStore.setState({ messages: data.messages });
    }
  }

  handleNewMessage(data) {
    const state = stateStore.getState();
    if (data.channelId === state.activeChannelId) {
      const msgs = [...state.messages, data];
      stateStore.setState({ messages: msgs });
    }
  }

  updateUI() {
    const state = stateStore.getState();
    
    if (state.middlePanel !== this.currentMiddlePanel) {
      this.currentMiddlePanel = state.middlePanel;
      if (this.currentMiddlePanel === 'settings') {
        this.settingsPanel.render();
      } else {
        this.chatPanel.render();
      }
    }
    
    if (this.currentMiddlePanel === 'settings') {
      this.settingsPanel.updateUI(state);
    } else {
      this.chatPanel.updateUI(state);
    }

    if (state.activeServerId && state.middlePanel === 'chat') {
        this.container.classList.remove('right-panel-collapsed');
        if (!this.membersPanelWrapper.innerHTML) {
            this.membersPanel.render();
        }
        this.membersPanel.updateUI(state);
    } else {
        this.container.classList.add('right-panel-collapsed');
    }

    const userDisplay = this.container.querySelector('#user-display');
    if (userDisplay) userDisplay.textContent = state.user ? state.user.username : 'Guest';

    const serversList = this.container.querySelector('#servers-list');
    if (serversList) {
      serversList.innerHTML = state.servers.map(s => `
        <div class="server-icon ${s.id === state.activeServerId ? 'active' : ''}" data-id="${s.id}" title="${s.name}">
          ${s.name.charAt(0).toUpperCase()}
        </div>
      `).join('');
      
      serversList.querySelectorAll('.server-icon').forEach(el => {
        const srv = state.servers.find(s => s.id === el.getAttribute('data-id'));
        if (!srv) return;
        el.addEventListener('click', () => {
          this.selectServer(srv);
        });
        el.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          ContextMenu.show(e.clientX, e.clientY, [
            { label: 'Mark as read', icon: 'fa-solid fa-check', action: () => console.log('Mark read:', srv.name) },
            { label: 'Server Settings', icon: 'fa-solid fa-gear', action: () => console.log('Settings:', srv.name) },
            { label: 'Leave Server', icon: 'fa-solid fa-arrow-right-from-bracket', danger: true, action: () => console.log('Leave:', srv.name) }
          ]);
        });
      });
    }

    const homeBtn = this.container.querySelector('#home-btn');
    if (homeBtn) {
       homeBtn.style.borderRadius = !state.activeServerId ? '16px' : '50%';
    }

    const activeServerName = this.container.querySelector('#active-server-name');
    if (activeServerName) {
      if (state.activeServerId) {
        const activeServer = state.servers.find(s => s.id === state.activeServerId);
        activeServerName.textContent = activeServer ? activeServer.name : 'Unknown Server';
      } else {
        activeServerName.textContent = 'Direct Messages';
      }
    }

    const channelsList = this.container.querySelector('#channels-list');
    if (channelsList) {
      if (state.activeServerId) {
        const channelHTML = state.channels.map(c => `
          <div class="channel-item ${(c.id === state.activeChannelId && state.middlePanel === 'chat') ? 'active' : ''}" data-id="${c.id}" ${state.middlePanel === 'settings' ? 'style="opacity: 0.5;"' : ''}>
            <i class="fa-solid fa-hashtag" style="font-size: 14px; opacity: 0.6; width: 20px; text-align: center;"></i> ${c.name}
          </div>
        `).join('');

        channelsList.innerHTML = `
            <div class="sidebar-cat">
                <div class="sidebar-cat-left">
                    <i class="fa-solid fa-chevron-down sidebar-cat-chevron" style="opacity: 0.5;"></i>
                    <span class="sidebar-cat-name" style="letter-spacing: 1px;">TEXT CHANNELS</span>
                </div>
                <div class="sidebar-cat-actions">
                    <button class="sidebar-cat-icon-btn"><i class="fa-solid fa-plus"></i></button>
                </div>
            </div>
            ${channelHTML}
        `;

        channelsList.querySelectorAll('.channel-item').forEach(el => {
          const chan = state.channels.find(c => c.id === el.getAttribute('data-id'));
          if (!chan) return;
          el.addEventListener('click', () => {
            this.selectChannel(chan);
          });
          el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            ContextMenu.show(e.clientX, e.clientY, [
              { label: 'Edit Channel', icon: 'fa-solid fa-pen', action: () => console.log('Edit channel:', chan.name) },
              { label: 'Delete Channel', icon: 'fa-solid fa-trash', danger: true, action: () => console.log('Delete channel:', chan.name) }
            ]);
          });
        });
      } else {
        channelsList.innerHTML = `
          <div class="sidebar-cat" style="margin-top:0;">
              <div class="sidebar-cat-left">
                  <span class="sidebar-cat-name" style="letter-spacing: 1px;">DIRECT MESSAGES</span>
              </div>
              <div class="sidebar-cat-actions">
                  <button class="sidebar-cat-icon-btn"><i class="fa-solid fa-plus"></i></button>
              </div>
          </div>
          <div style="padding: 16px; text-align: center; color: var(--text-muted); font-size: 13px; font-weight: 700;">
            No direct messages yet.
          </div>
        `;
      }
    }
  }

  destroy() {
    if (this.unsubscribe) this.unsubscribe();
    if (window.app && window.app.socket) {
      window.app.socket.off('channelHistory');
      window.app.socket.off('newMessage');
    }
    if (this.container) this.container.remove();
  }
}
