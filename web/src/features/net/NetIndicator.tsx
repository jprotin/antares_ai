// Pictogramme de connexion Internet (et partage ngrok en cours)
import { netLabel, netTitle } from "@/engines/net/netMonitor";
import { useAppStore } from "@/state/hooks";

import "./net.css";

export function NetIndicator() {
  const net = useAppStore((state) => state.net);
  const classes = [
    "net",
    net && !net.online && "net--offline",
    net?.sharing && "net--sharing",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={classes}
      role="status"
      title={net ? netTitle(net) : "Connexion Internet"}
      data-testid="net"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 6h-2.95a15.7 15.7 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.9 8ZM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82A13.9 13.9 0 0 1 12 4.04ZM4.26 14a8.2 8.2 0 0 1 0-4h3.38a16.5 16.5 0 0 0 0 4H4.26Zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A8 8 0 0 1 5.08 16Zm2.95-8H5.08a8 8 0 0 1 4.33-3.56A15.7 15.7 0 0 0 8.03 8ZM12 19.96A14 14 0 0 1 10.09 16h3.82A14 14 0 0 1 12 19.96ZM14.34 14H9.66a14.7 14.7 0 0 1 0-4h4.68a14.7 14.7 0 0 1 0 4Zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56ZM16.36 14a16.5 16.5 0 0 0 0-4h3.38a8.2 8.2 0 0 1 0 4h-3.38Z" />
        <path className="net__slash" d="M3 3l18 18" />
      </svg>
      <span className="net__label">{net ? netLabel(net) : "…"}</span>
    </span>
  );
}
