import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Home } from "./ui/Home";
import { Room } from "./ui/Room";
import "./styles.css";

function useHash(): string {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

function App() {
  const hash = useHash();
  const room = hash.match(/^#\/r\/([A-Za-z0-9_-]+)/);
  return room ? <Room key={room[1]} roomId={room[1]} /> : <Home />;
}

createRoot(document.getElementById("root")!).render(<App />);
