import { ImageResponse } from "next/og";

// the social share card: text and a simple chart only (no logos, no headshots)
export const alt = "NBA Points Predictor: pick a player and an opponent, a machine learning model predicts his points";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BARS = [18, 26, 21, 33, 24, 29, 35, 27, 31, 22];

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 64,
              height: 64,
              borderRadius: 14,
              background: "#2f6fed",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            PP
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#a1a1aa" }}>Intro to AI final project, CSUSM</div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 700 }}>
            <div style={{ display: "flex", fontSize: 76, fontWeight: 700, letterSpacing: -2, lineHeight: 1.05 }}>
              NBA Points Predictor
            </div>
            <div style={{ display: "flex", fontSize: 32, color: "#a1a1aa", marginTop: 20, lineHeight: 1.3 }}>
              Pick a player and an opponent. A machine learning model predicts how many points he scores.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 220 }}>
            {BARS.map((b, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  width: 22,
                  height: b * 6,
                  borderRadius: 5,
                  background: i === BARS.length - 1 ? "#f59e3b" : "#2f6fed",
                  opacity: i === BARS.length - 1 ? 1 : 0.55 + i * 0.04,
                }}
              />
            ))}
          </div>
        </div>

        <div style={{ display: "flex", gap: 20 }}>
          {[
            ["4.86", "points off on average"],
            ["60%", "within 5 points"],
            ["19,832", "test games"],
          ].map(([v, l]) => (
            <div
              key={l}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 12,
                padding: "16px 24px",
                borderRadius: 14,
                border: "1px solid #27272a",
                background: "#171717",
              }}
            >
              <span style={{ fontSize: 36, fontWeight: 700 }}>{v}</span>
              <span style={{ fontSize: 24, color: "#a1a1aa" }}>{l}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}
