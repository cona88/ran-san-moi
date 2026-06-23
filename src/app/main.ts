import '../styles/style.css';

// Composition root. Wired up in Phase 5.
// Placeholder keeps the Vite entry valid while lower layers are built.
const app = document.getElementById('app');
if (!app) {
  throw new Error('Missing #app mount point');
}
