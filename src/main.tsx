import '@gear-js/vara-ui/dist/style-deprecated.css';
import '@gear-js/wallet-connect/dist/style.css';
import { Buffer } from 'buffer';
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Make Buffer available globally for libraries that need it (e.g., sails-js)
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
  (window as any).global = window;
}

createRoot(document.getElementById("root")!).render(<App />);
