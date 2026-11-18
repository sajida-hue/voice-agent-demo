import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { MeetingAgent } from './MeetingAgent';

createRoot(document.getElementById("root")!).render(
  location.pathname === '/meet/agent' ? <MeetingAgent /> : <StrictMode>
    <App />
  </StrictMode>
);
