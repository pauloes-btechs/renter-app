/** Representative bedroom illustrations (original artwork, inline SVG). */
export function RoomArt({ kind, className, title }: { kind: string; className?: string; title?: string }) {
  const wall = { master: "#efe6da", view: "#e6eef0", comfort: "#efe4e0", bunk: "#e9ebe3", generic: "#eee9e1" }[kind] ?? "#eee9e1";
  return (
    <svg viewBox="0 0 320 200" className={className} role="img" aria-label={title ?? `${kind} bedroom illustration`} preserveAspectRatio="xMidYMid slice">
      <rect width="320" height="200" fill={wall} />
      <rect y="150" width="320" height="50" fill="#d9cbb6" />
      <rect y="150" width="320" height="3" fill="#cbbba3" />
      {kind === "view" && (
        <g>
          <rect x="150" y="26" width="140" height="92" rx="6" fill="#fff" />
          <rect x="156" y="32" width="128" height="80" rx="3" fill="#bcd9e2" />
          <path d="M156 92 L190 62 L214 80 L238 56 L284 92 L284 112 L156 112Z" fill="#7fa79b" />
          <path d="M156 100 C190 96 230 104 284 98 L284 112 L156 112Z" fill="#5f8fa3" />
          <circle cx="262" cy="48" r="8" fill="#f6d79a" />
          <rect x="219" y="32" width="2" height="80" fill="#fff" />
        </g>
      )}
      {kind === "master" && (
        <g>
          <rect x="226" y="40" width="64" height="110" rx="4" fill="#cdb79c" />
          <rect x="232" y="46" width="52" height="104" rx="2" fill="#e2d3bf" />
          <circle cx="276" cy="100" r="3" fill="#a88b66" />
          <path d="M240 64 h36 v6 h-36z" fill="#bfd6df" />
          <text x="258" y="88" textAnchor="middle" fontSize="10" fill="#8a7458" fontFamily="sans-serif">ensuite</text>
        </g>
      )}
      {kind === "comfort" && (
        <g>
          <path d="M226 150 L232 92 Q236 70 258 70 L272 70 Q292 70 292 92 L292 150 Z" fill="#9c6b5a" />
          <rect x="232" y="108" width="62" height="20" rx="8" fill="#b9806c" />
          <rect x="222" y="104" width="12" height="40" rx="6" fill="#86594a" />
          <rect x="286" y="104" width="12" height="40" rx="6" fill="#86594a" />
          <rect x="240" y="78" width="40" height="10" rx="5" fill="#c99583" opacity=".8" />
        </g>
      )}
      {kind === "bunk" ? (
        <g>
          <rect x="34" y="40" width="8" height="112" fill="#8b6b4a" />
          <rect x="176" y="40" width="8" height="112" fill="#8b6b4a" />
          <rect x="38" y="76" width="142" height="12" rx="3" fill="#a5835e" />
          <rect x="42" y="64" width="134" height="14" rx="5" fill="#f4f1ea" />
          <rect x="46" y="60" width="30" height="10" rx="5" fill="#fff" />
          <rect x="38" y="132" width="142" height="12" rx="3" fill="#a5835e" />
          <rect x="42" y="120" width="134" height="14" rx="5" fill="#f4f1ea" />
          <rect x="46" y="116" width="30" height="10" rx="5" fill="#fff" />
          <rect x="190" y="40" width="4" height="110" fill="#8b6b4a" />
          {[56, 78, 100, 122].map((y) => (
            <rect key={y} x="184" y={y} width="12" height="3" fill="#8b6b4a" />
          ))}
        </g>
      ) : (
        <g>
          <rect x="30" y={kind === "master" ? 72 : 82} width={kind === "master" ? 172 : 140} height={kind === "master" ? 50 : 42} rx="8" fill="#8b6b4a" />
          <rect x="24" y="112" width={kind === "master" ? 184 : 152} height="30" rx="8" fill="#f4f1ea" />
          <rect x="24" y="128" width={kind === "master" ? 184 : 152} height="22" rx="6" fill={kind === "master" ? "#c9b08e" : "#9fb7b1"} />
          <rect x="38" y="100" width="40" height="16" rx="8" fill="#fff" />
          <rect x={kind === "master" ? 150 : 110} y="100" width="40" height="16" rx="8" fill="#fff" />
          {kind === "master" && <rect x="94" y="100" width="40" height="16" rx="8" fill="#fff" />}
        </g>
      )}
      {kind === "generic" && <rect x="220" y="40" width="70" height="60" rx="4" fill="#fff" opacity=".7" />}
      <ellipse cx="120" cy="174" rx="90" ry="8" fill="#000" opacity=".05" />
    </svg>
  );
}

export function HouseArt({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 360" className={className} role="img" aria-label="Illustration of a coastal vacation house">
      <defs>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f3e7d7" />
          <stop offset="1" stopColor="#e9eff0" />
        </linearGradient>
      </defs>
      <rect width="600" height="360" fill="url(#sky)" />
      <circle cx="470" cy="90" r="34" fill="#f4cf8a" opacity=".9" />
      <path d="M0 250 C120 210 220 236 320 214 C420 192 500 222 600 206 L600 360 L0 360Z" fill="#a9c3b5" />
      <path d="M0 290 C140 270 300 300 600 276 L600 360 L0 360Z" fill="#6f9aa6" />
      <g transform="translate(150 120)">
        <path d="M0 80 L120 10 L240 80Z" fill="#7b5a44" />
        <rect x="16" y="78" width="208" height="110" fill="#f6f1e9" />
        <rect x="30" y="98" width="46" height="34" rx="3" fill="#bcd9e2" />
        <rect x="96" y="98" width="46" height="34" rx="3" fill="#bcd9e2" />
        <rect x="162" y="98" width="46" height="34" rx="3" fill="#f2d79b" />
        <rect x="104" y="146" width="32" height="42" rx="3" fill="#2f7268" />
        <rect x="-10" y="186" width="260" height="10" rx="3" fill="#8b6b4a" />
      </g>
    </svg>
  );
}
