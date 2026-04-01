import '../src/style.css'

// Register service worker for PWA support
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js')
}
