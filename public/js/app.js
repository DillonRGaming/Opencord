import { Router } from './Router.js';
import { stateStore } from './Store.js';
import { LoginView } from './views/LoginView.js';
import { ChatView } from './views/ChatView.js';

class App {
  constructor() {
    this.root = document.getElementById('app');
    this.router = null;
    this.socket = null;
    this.init();
  }

  init() {
    console.log('Acero App Initialized');
    
    // Define Routes
    const routes = {
      '/': LoginView,
      '/chat': ChatView
    };

    // Initialize Router
    this.router = new Router(routes, this.root);
    
    // Check local token
    const token = localStorage.getItem('acero_token');
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        stateStore.setState({ user: { username: payload.username } });
        this.connectSocket(token);
        // Do not navigate automatically unless we want to force them from / to /chat
        if (window.location.hash === '' || window.location.hash === '#/') {
          this.router.navigate('/chat');
        }
      } catch (e) {
        localStorage.removeItem('acero_token');
        this.router.navigate('/');
      }
    } else {
      this.router.navigate('/');
    }
    
    this.router.handleRoute();
  }

  connectSocket(token) {
    if (window.io) {
      // Connect specifically to our backend on port 3001
      this.socket = window.io('http://localhost:3001', {
        auth: { token }
      });
      
      this.socket.on('connect', () => {
        console.log('Socket connected:', this.socket.id);
      });
      
      this.socket.on('connect_error', (err) => {
        console.error('Socket connection error:', err.message);
        if (err.message.includes('Authentication error')) {
            localStorage.removeItem('acero_token');
            stateStore.setState({ user: null });
            this.router.navigate('/');
        }
      });
    }
  }
}

// Initialize App (type="module" scripts are deferred and run after HTML parsing)
window.app = new App();
