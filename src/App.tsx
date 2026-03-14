import { useState, useEffect, useCallback } from "react";

const DAYS = 31;
const HABIT_N = 8;
const INNER_R = 95;
const RING_W = 20;
const START_DEG = -92;
const SWEEP_DEG = 292;
const DAY_ARC = SWEEP_DEG / DAYS;
const LABEL_R = INNER_R + HABIT_N * RING_W + 22;
const SEG_GAP = 0.6;
// SUCCESS color is now accentColor state
const FAIL = "#E04444";
const EMPTY = "#EAE2D4";
const EMPTY_H = "#D8CEBC";

const DEFAULT_HABITS = Array(HABIT_N).fill("");

const RATING_QS = [
  { key: "mood",      label: "Mood",                 q: "How is my mood today?" },
  { key: "energy",    label: "Energy",               q: "How is my energy level?" },
  { key: "identity",  label: "Identity & Control",   q: "Am I living with identity and control?" },
  { key: "calm",      label: "Calm",                 q: "How calm am I? (lack of angst)" },
  { key: "libido",    label: "Libido",               q: "How is my libido?" },
];
const RATING_N = RATING_QS.length;

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const toRad = (d: number) => (d * Math.PI) / 180;

function arcPath(r1: number, r2: number, a1: number, a2: number) {
  const s1 = a1 + SEG_GAP / 2;
  const s2 = a2 - SEG_GAP / 2;
  const p = (r: number, a: number): [number, number] => [
    r * Math.cos(toRad(a)),
    r * Math.sin(toRad(a)),
  ];
  const [ix1, iy1] = p(r1, s1);
  const [ox1, oy1] = p(r2, s1);
  const [ox2, oy2] = p(r2, s2);
  const [ix2, iy2] = p(r1, s2);
  const lg = s2 - s1 > 180 ? 1 : 0;
  return `M${ix1},${iy1} L${ox1},${oy1} A${r2},${r2} 0 ${lg} 1 ${ox2},${oy2} L${ix2},${iy2} A${r1},${r1} 0 ${lg} 0 ${ix1},${iy1}Z`;
}

function centroid(r1: number, r2: number, a1: number, a2: number): [number, number] {
  const midR = (r1 + r2) / 2;
  const midA = (a1 + a2) / 2;
  return [midR * Math.cos(toRad(midA)), midR * Math.sin(toRad(midA))];
}

const FAST_MS = 16 * 3600 * 1000;
const CT_TZ = "America/Chicago";

function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function fmtTime(d: Date) {
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: true, timeZone: CT_TZ
  });
}

// Get current CT time as HH:MM for <input type="time"> default
function nowTimeCT() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CT_TZ, hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const h = parts.find(p => p.type === "hour")?.value ?? "20";
  const m = parts.find(p => p.type === "minute")?.value ?? "00";
  // clamp hour to valid range
  const hNum = Math.min(23, parseInt(h, 10));
  return `${String(hNum).padStart(2,"0")}:${m}`;
}

function fmtDateCT(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: CT_TZ });
}

// Get current date string in CT as YYYY-MM-DD for <input type="date"> default
function todayCT() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: CT_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return parts; // returns YYYY-MM-DD
}

// Convert a CT date + time string to a UTC timestamp.
// Works regardless of what timezone the browser is in.
// Try both CT offsets (CST=-6, CDT=-5), pick whichever round-trips correctly.
function ctToTimestamp(dateStr: string, timeStr: string): number {
  const inputHour = parseInt(timeStr.split(":")[0], 10);
  const inputMin  = parseInt(timeStr.split(":")[1], 10);

  for (const offsetHours of [-5, -6]) {
    const sign = offsetHours < 0 ? "-" : "+";
    const abs  = String(Math.abs(offsetHours)).padStart(2, "0");
    const ts   = new Date(`${dateStr}T${timeStr}:00${sign}${abs}:00`).getTime();

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CT_TZ,
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date(ts));

    const h = parseInt(parts.find((p: Intl.DateTimeFormatPart) => p.type === "hour")?.value   ?? "0", 10);
    const m = parseInt(parts.find((p: Intl.DateTimeFormatPart) => p.type === "minute")?.value ?? "0", 10);

    if (h === inputHour && m === inputMin) return ts;
  }
  // Fallback: CST
  return new Date(`${dateStr}T${timeStr}:00-06:00`).getTime();
}

export default function HabitTracker() {
  const now = new Date();
  const [habits, setHabits] = useState<string[]>(DEFAULT_HABITS);
  const [data, setData] = useState<number[][]>(() =>
    Array(31).fill(null).map(() => Array(HABIT_N).fill(0))
  );
  const [goals, setGoals] = useState<string[]>(Array(HABIT_N).fill(""));
  const [ratings, setRatings] = useState<number[][]>(() =>
    Array(31).fill(null).map(() => Array(RATING_N).fill(0))
  );
  const [editHabit, setEditHabit] = useState<number | null>(null);
  const [hovered, setHovered] = useState<[number, number] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [fastStart, setFastStart] = useState<number | null>(null);
  const [tick, setTick] = useState(Date.now());
  const [manualDate, setManualDate] = useState(todayCT());
  const [manualTime, setManualTime] = useState(() => nowTimeCT());
  const [showManual, setShowManual] = useState(false);
  const [accentColor, setAccentColor] = useState<string>(() => {
    try { return localStorage.getItem("ht2-color") || "#3DAA6A"; } catch { return "#3DAA6A"; }
  });

  const updateColor = (c: string) => {
    setAccentColor(c);
    try { localStorage.setItem("ht2-color", c); } catch {}
  };

  // cycleStart: the date assigned to slot 0 (day 1) of the spiral
  const [cycleStart, setCycleStartState] = useState<string>(() => {
    try {
      return localStorage.getItem("ht2-cyclestart") ||
        `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    } catch {
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }
  });
  const [editCycleStart, setEditCycleStart] = useState(false);

  const updateCycleStart = (v: string) => {
    setCycleStartState(v);
    try { localStorage.setItem("ht2-cyclestart", v); } catch {}
    setEditCycleStart(false);
  };

  // dateForSlot: returns the actual Date for segment index d (0-based)
  const dateForSlot = (d: number): Date => {
    const [cy, cm, cday] = cycleStart.split("-").map(Number);
    const base = new Date(cy, cm - 1, cday);
    return new Date(base.getFullYear(), base.getMonth(), base.getDate() + d);
  };

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // derive storage key from cycle start date
  const [csY, csM] = cycleStart.split("-").map(Number);
  const key = `ht2-${csY}-${csM}`;

  useEffect(() => {
    try {
      const s = localStorage.getItem(key);
      if (s) {
        const p = JSON.parse(s);
        setHabits((p.habits || DEFAULT_HABITS).slice(0, HABIT_N));
        setData((p.data || Array(31).fill(null).map(() => Array(HABIT_N).fill(0))).map((r: number[]) => r.slice(0, HABIT_N)));
        setGoals((p.goals || Array(HABIT_N).fill("")).slice(0, HABIT_N));
        setRatings((p.ratings || Array(31).fill(null).map(() => Array(RATING_N).fill(0))).map((r: number[]) => {
          const row = r.slice(0, RATING_N);
          while (row.length < RATING_N) row.push(0);
          return row;
        }));
      } else {
        const cfg = localStorage.getItem("ht2-config");
        if (cfg) setHabits((JSON.parse(cfg).habits || DEFAULT_HABITS).slice(0, HABIT_N));
        setData(Array(31).fill(null).map(() => Array(HABIT_N).fill(0)));
        setGoals(Array(HABIT_N).fill(""));
      }
      const fs = localStorage.getItem("ht2-fast");
      if (fs) setFastStart(parseInt(fs));
    } catch (e) {}
    setLoaded(true);
  }, [key]);

  const persist = useCallback(
    (d: number[][], h: string[], g: string[], r: number[][]) => {
      localStorage.setItem(key, JSON.stringify({ data: d, habits: h, goals: g, ratings: r }));
      localStorage.setItem("ht2-config", JSON.stringify({ habits: h }));
    },
    [key]
  );

  const toggle = (d: number, h: number) => {
    const next = data.map((r) => [...r]);
    next[d][h] = (next[d][h] + 1) % 3;
    setData(next);
    persist(next, habits, goals, ratings);
  };

  const updateHabit = (i: number, v: string) => {
    const next = [...habits];
    next[i] = v;
    setHabits(next);
    persist(data, next, goals, ratings);
  };

  const updateGoal = (i: number, v: string) => {
    const next = [...goals];
    next[i] = v;
    setGoals(next);
    persist(data, habits, next, ratings);
  };

  const updateRating = (day: number, qi: number, val: number) => {
    const next = ratings.map((r) => [...r]);
    next[day][qi] = next[day][qi] === val ? 0 : val;
    setRatings(next);
    persist(data, habits, goals, next);
  };

  const nav = (dir: number) => {
    const [cy, cm, cd] = cycleStart.split("-").map(Number);
    const base = new Date(cy, cm - 1, cd);
    base.setDate(base.getDate() + dir * 31);
    const newStart = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
    updateCycleStart(newStart);
  };

  const startFast = () => {
    const t = Date.now();
    setFastStart(t);
    setShowManual(false);
    localStorage.setItem("ht2-fast", String(t));
  };

  const startFastManual = () => {
    const t = ctToTimestamp(manualDate, manualTime);
    setFastStart(t);
    setShowManual(false);
    localStorage.setItem("ht2-fast", String(t));
  };

  const stopFast = () => {
    setFastStart(null);
    setShowManual(false);
    localStorage.removeItem("ht2-fast");
  };

  const dim = 31; // cycle always has 31 slots
  const achieved = habits.map((_, h) =>
    data.slice(0, dim).filter((r) => r[h] === 1).length
  );
  const failed = habits.map((_, h) =>
    data.slice(0, dim).filter((r) => r[h] === 2).length
  );

  const elapsed = fastStart ? tick - fastStart : 0;
  const remaining = fastStart ? Math.max(0, FAST_MS - elapsed) : 0;
  const fastPct = fastStart ? Math.min(100, (elapsed / FAST_MS) * 100) : 0;
  const eatAt = fastStart ? new Date(fastStart + FAST_MS) : null;
  const done = fastStart ? elapsed >= FAST_MS : false;

  if (!loaded) {
    return (
      <div style={{
        minHeight: "100vh",
        background: "#1A1A1A",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: accentColor,
        fontFamily: "monospace",
        fontSize: "16px",
        letterSpacing: "3px",
      }}>
        LOADING...
      </div>
    );
  }

  const borderColor = done ? accentColor : fastStart ? "#2A4A2A" : "#1E2A1E";

  return (
    <div style={{
      minHeight: "100vh",
      background: "#1A1A1A",
      color: "#E8E2D8",
      fontFamily: '"Courier New", monospace',
      padding: "24px",
      boxSizing: "border-box",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #0D1117; }
        .seg:hover { filter: brightness(1.15); cursor: pointer; }
        .nb:hover { background: #1E2A1E !important; }
        .hn:hover { color: ${accentColor} !important; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
        .pulse { animation: pulse 1.5s infinite; }
        @keyframes glow { 0%,100%{box-shadow:0 0 12px ${accentColor}44} 50%{box-shadow:0 0 28px ${accentColor}99} }
        .glow { animation: glow 2s infinite; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        .fu { animation: fadeUp 0.4s ease forwards; }
        input:focus { outline: none; }
      `}</style>

      {/* Header */}
      <div className="fu" style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottom: "1px solid #1E2A1E",
        paddingBottom: "16px",
        marginBottom: "20px",
      }}>
        <div>
          <h1 style={{
            fontFamily: '"DM Serif Display", serif',
            fontSize: "clamp(24px,3.5vw,38px)",
            margin: 0,
            color: "#E8E2D8",
            fontWeight: 400,
            letterSpacing: "1px",
          }}>
            Habit Tracker
          </h1>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>

            <label title="Pick accent color" style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer" }}>
              <input
                type="color"
                value={accentColor}
                onChange={(e) => updateColor(e.target.value)}
                style={{
                  width: "22px", height: "22px",
                  border: "none", padding: "0",
                  borderRadius: "50%",
                  cursor: "pointer",
                  background: "none",
                }}
              />
            </label>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <button
            className="nb"
            onClick={() => nav(-1)}
            style={{
              background: "#141C14",
              border: "1px solid #2A3A2A",
              color: accentColor,
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              cursor: "pointer",
              fontSize: "18px",
              transition: "background 0.2s",
              fontFamily: "serif",
            }}
          >
            ‹
          </button>
          <div style={{ textAlign: "center", minWidth: "160px" }}>
            <div style={{
              fontFamily: '"DM Serif Display", serif',
              fontSize: "18px",
              color: "#E8E2D8",
              letterSpacing: "1px",
            }}>
              {MONTHS[csM - 1]}
            </div>
            <div style={{ fontSize: "11px", color: "#FFFFFF", marginTop: "1px" }}>{csY}</div>
          </div>
          <button
            className="nb"
            onClick={() => nav(1)}
            style={{
              background: "#141C14",
              border: "1px solid #2A3A2A",
              color: accentColor,
              width: "34px",
              height: "34px",
              borderRadius: "50%",
              cursor: "pointer",
              fontSize: "18px",
              transition: "background 0.2s",
              fontFamily: "serif",
            }}
          >
            ›
          </button>
        </div>
      </div>

      {/* Fasting Tracker */}
      <div className="fu" style={{
        background: "#1E1E1E",
        border: `1px solid ${borderColor}`,
        borderRadius: "12px",
        padding: "18px 24px",
        marginBottom: "20px",
        transition: "border-color 0.4s",
      }}>
        <div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "16px",
          alignItems: "center",
          justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <div style={{ fontSize: "22px" }}>🕐</div>
            <div>
              <div style={{
                fontSize: "10px",
                letterSpacing: "3px",
                color: accentColor,
                marginBottom: "2px",
              }}>
                16:8 INTERMITTENT FAST
              </div>
              {!fastStart && (
                <div style={{ fontSize: "13px", color: "#FFFFFF" }}>
                  No active fast — start one below
                </div>
              )}
              {fastStart && !done && (
                <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                  <span
                    className="pulse"
                    style={{
                      fontFamily: '"DM Mono", monospace',
                      fontSize: "clamp(22px,3vw,32px)",
                      color: "#E8E2D8",
                      fontWeight: 500,
                      letterSpacing: "2px",
                    }}
                  >
                    {fmt(remaining)}
                  </span>
                  <span style={{ fontSize: "11px", color: "#FFFFFF" }}>remaining</span>
                </div>
              )}
              {done && (
                <div style={{
                  fontFamily: '"DM Serif Display", serif',
                  fontSize: "22px",
                  color: accentColor,
                }}>
                  Fast complete — you can eat now!
                </div>
              )}
            </div>
          </div>

          <div style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "8px",
            minWidth: "200px",
          }}>
            {fastStart && eatAt && (
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "10px", letterSpacing: "2px", color: "#FFFFFF" }}>
                  EAT AT (CT)
                </div>
                <div style={{
                  fontFamily: '"DM Serif Display", serif',
                  fontSize: "24px",
                  color: done ? accentColor : "#E8E2D8",
                }}>
                  {fmtTime(eatAt)}
                </div>
                <div style={{ fontSize: "10px", color: "#334433" }}>
                  Started: {fmtTime(new Date(fastStart))} CT · {fmtDateCT(new Date(fastStart))}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" }}>
              {!fastStart ? (
                <>
                  <button
                    className="glow"
                    onClick={startFast}
                    style={{
                      background: "#1E3A1E",
                      border: `1px solid ${accentColor}`,
                      color: accentColor,
                      padding: "8px 16px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontFamily: '"DM Mono", monospace',
                      fontSize: "11px",
                      letterSpacing: "2px",
                    }}
                  >
                    START NOW
                  </button>
                  <button
                    onClick={() => setShowManual(!showManual)}
                    style={{
                      background: showManual ? "#1A2A3A" : "#141C14",
                      border: `1px solid ${showManual ? "#4A8ABB" : "#2A3A2A"}`,
                      color: showManual ? "#4A8ABB" : "#FFFFFF",
                      padding: "8px 14px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontFamily: '"DM Mono", monospace',
                      fontSize: "11px",
                      letterSpacing: "2px",
                    }}
                  >
                    SET TIME
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => setShowManual(!showManual)}
                    style={{
                      background: showManual ? "#1A2A3A" : "#141C14",
                      border: `1px solid ${showManual ? "#4A8ABB" : "#2A3A2A"}`,
                      color: showManual ? "#4A8ABB" : "#FFFFFF",
                      padding: "8px 14px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontFamily: '"DM Mono", monospace',
                      fontSize: "11px",
                      letterSpacing: "2px",
                    }}
                  >
                    EDIT TIME
                  </button>
                  <button
                    onClick={stopFast}
                    style={{
                      background: "#2A1414",
                      border: "1px solid #E04444",
                      color: "#E04444",
                      padding: "8px 16px",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontFamily: '"DM Mono", monospace',
                      fontSize: "11px",
                      letterSpacing: "2px",
                    }}
                  >
                    STOP
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Manual time entry panel */}
        {showManual && (
          <div style={{
            marginTop: "14px",
            padding: "14px 16px",
            background: "#1A1A1A",
            border: "1px solid #1A2A3A",
            borderRadius: "8px",
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-end",
            gap: "12px",
          }}>
            <div>
              <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#4A8ABB", marginBottom: "5px" }}>
                DATE (CENTRAL TIME)
              </div>
              <input
                type="date"
                value={manualDate}
                onChange={e => setManualDate(e.target.value)}
                style={{
                  background: "#111A22",
                  border: "1px solid #2A3A4A",
                  borderRadius: "4px",
                  color: "#E8E2D8",
                  padding: "6px 10px",
                  fontFamily: '"DM Mono", monospace',
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: "9px", letterSpacing: "2px", color: "#4A8ABB", marginBottom: "5px" }}>
                TIME (CENTRAL)
              </div>
              <input
                type="time"
                value={manualTime}
                onChange={e => setManualTime(e.target.value)}
                style={{
                  background: "#111A22",
                  border: "1px solid #2A3A4A",
                  borderRadius: "4px",
                  color: "#E8E2D8",
                  padding: "6px 10px",
                  fontFamily: '"DM Mono", monospace',
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              />
            </div>
            <button
              onClick={startFastManual}
              style={{
                background: "#1A2A3A",
                border: "1px solid #4A8ABB",
                color: "#4A8ABB",
                padding: "8px 18px",
                borderRadius: "6px",
                cursor: "pointer",
                fontFamily: '"DM Mono", monospace',
                fontSize: "11px",
                letterSpacing: "2px",
              }}
            >
              {fastStart ? "UPDATE TIME" : "START FAST"}
            </button>
            <div style={{ fontSize: "10px", color: "#334433", alignSelf: "center" }}>
              Eat at: <span style={{ color: "#E8E2D8" }}>
                {fmtTime(new Date(ctToTimestamp(manualDate, manualTime) + FAST_MS))} CT
              </span>
            </div>
          </div>
        )}

        {fastStart && (
          <div style={{ marginTop: "14px" }}>
            <div style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "10px",
              color: "#FFFFFF",
              marginBottom: "5px",
            }}>
              <span>0h</span>
              <span style={{ color: accentColor }}>
                {Math.floor(fastPct)}% complete · {fmt(elapsed)} elapsed
              </span>
              <span>16h</span>
            </div>
            <div style={{
              height: "8px",
              background: "#1A1A1A",
              borderRadius: "4px",
              overflow: "hidden",
              border: "1px solid #1E2A1E",
            }}>
              <div style={{
                height: "100%",
                width: `${fastPct}%`,
                background: done ? accentColor : `linear-gradient(90deg, #1E6A3A, ${accentColor})`,
                borderRadius: "4px",
                transition: "width 1s linear",
                boxShadow: fastPct > 0 ? `0 0 8px ${accentColor}66` : "none",
              }} />
            </div>
            <div style={{
              marginTop: "6px",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "10px",
              color: "#FFFFFF",
            }}>
              <div style={{
                flex: "0 0 66.6%",
                height: "4px",
                background: "#1E2A1E",
                borderRadius: "2px",
                position: "relative",
              }}>
                <div style={{
                  position: "absolute",
                  right: 0,
                  top: "-14px",
                  fontSize: "9px",
                  color: "#FFFFFF",
                }}>
                  FASTING 16h
                </div>
              </div>
              <div style={{
                flex: "0 0 33.3%",
                height: "4px",
                background: "#1E3A28",
                borderRadius: "2px",
                position: "relative",
              }}>
                <div style={{
                  position: "absolute",
                  right: 0,
                  top: "-14px",
                  fontSize: "9px",
                  color: accentColor,
                }}>
                  EATING 8h
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Habit + Circle — labels live inside the SVG */}
      <div className="fu" style={{ maxWidth: "780px", margin: "0 auto", width: "100%" }}>
          <svg viewBox="-296 -297 593 594" style={{ width: "100%", height: "auto", display: "block" }}>
            <defs>
              <filter id="glow-green">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {Array.from({ length: DAYS }, (_, d) => {
              if (d >= dim) return null;
              const a1 = START_DEG + d * DAY_ARC;
              const a2 = START_DEG + (d + 1) * DAY_ARC;
              return Array.from({ length: HABIT_N }, (_, h) => {
                const r1 = INNER_R + (HABIT_N - 1 - h) * RING_W;
                const r2 = INNER_R + (HABIT_N - h) * RING_W;
                const state = data[d][h];
                const isHov = hovered && hovered[0] === d && hovered[1] === h;
                const [cx, cy] = centroid(r1, r2, a1, a2);
                const dotR = RING_W * 0.22;
                return (
                  <g key={`${d}-${h}`}>
                    <path
                      className="seg"
                      d={arcPath(r1, r2, a1, a2)}
                      fill={
                        state === 1
                          ? accentColor
                          : state === 2
                          ? "#2A1414"
                          : isHov
                          ? EMPTY_H
                          : EMPTY
                      }
                      stroke="#1A1A1A"
                      strokeWidth="1"
                      onClick={() => toggle(d, h)}
                      onMouseEnter={() => setHovered([d, h])}
                      onMouseLeave={() => setHovered(null)}
                      filter={state === 1 ? "url(#glow-green)" : "none"}
                    />
                    {state === 2 && (
                      <circle
                        cx={cx}
                        cy={cy}
                        r={dotR}
                        fill={FAIL}
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                  </g>
                );
              });
            })}

            {/* Habit labels — right-justified flush against day 1 column */}
            {habits.map((name, i) => {
              const midR = INNER_R + (HABIT_N - 1 - i + 0.5) * RING_W;
              // x/y of the midpoint of this ring AT the day-1 left edge angle
              const xEdge = midR * Math.cos(toRad(START_DEG));
              const yPos  = midR * Math.sin(toRad(START_DEG));
              const GAP   = 5;                // px gap between text and segment
              const xEnd  = xEdge - GAP;      // right edge of label
              const LBL_W = 148;
              const xStart = xEnd - LBL_W;
              const rowH  = RING_W - 1;
              const isEdit = editHabit === i;
              return (
                <g key={`label-${i}`}>
                  {/* hit-area / edit bg */}
                  <rect
                    x={xStart} y={yPos - rowH / 2}
                    width={LBL_W} height={rowH}
                    fill={isEdit ? "#1E1E1E" : "transparent"}
                    rx={2}
                    onClick={() => !isEdit && setEditHabit(i)}
                    style={{ cursor: "pointer" }}
                  />
                  {/* index number */}
                  <text
                    x={xStart + 8} y={yPos}
                    textAnchor="start" dominantBaseline="central"
                    style={{ fontSize: "9px", fill: "#FFFFFF", fontFamily: '"DM Mono", monospace', pointerEvents: "none" }}
                  >
                    {i + 1}
                  </text>
                  {isEdit ? (
                    <foreignObject x={xStart + 18} y={yPos - rowH / 2 + 1} width={LBL_W - 20} height={rowH - 2}>
                      <input
                        autoFocus
                        value={name}
                        placeholder={`habit ${i + 1}…`}
                        onChange={(e) => updateHabit(i, e.target.value)}
                        onBlur={() => setEditHabit(null)}
                        onKeyDown={(e) => e.key === "Enter" && setEditHabit(null)}
                        style={{
                          width: "100%", height: "100%",
                          background: "transparent",
                          border: "none",
                          borderBottom: `1px solid ${accentColor}`,
                          color: "#E8E2D8",
                          fontSize: "11px",
                          fontFamily: '"DM Mono", monospace',
                          outline: "none",
                          padding: "0 2px",
                          boxSizing: "border-box" as const,
                        }}
                      />
                    </foreignObject>
                  ) : (
                    <text
                      x={xEnd} y={yPos}
                      textAnchor="end" dominantBaseline="central"
                      onClick={() => setEditHabit(i)}
                      style={{
                        fontSize: "11px",
                        fill: name ? "#FFFFFF" : "#1E3A1E",
                        fontFamily: '"DM Mono", monospace',
                        cursor: "pointer",
                        fontStyle: name ? "normal" : "italic",
                      }}
                    >
                      {name || `+ habit ${i + 1}`}
                    </text>
                  )}
                </g>
              );
            })}

            {Array.from({ length: DAYS }, (_, d) => {
              if (d >= dim) return null;
              const midA = START_DEG + (d + 0.5) * DAY_ARC;
              const rad = toRad(midA);
              const x = LABEL_R * Math.cos(rad);
              const y = LABEL_R * Math.sin(rad);
              const slotDate = dateForSlot(d);
              const isToday =
                slotDate.getDate() === now.getDate() &&
                slotDate.getMonth() === now.getMonth() &&
                slotDate.getFullYear() === now.getFullYear();
              return (
                <g key={d}>
                  {isToday && (
                    <circle cx={x} cy={y} r="11" fill={accentColor} opacity="0.15" />
                  )}
                  <text
                    x={x}
                    y={y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(${midA + 90},${x},${y})`}
                    style={{
                      fontSize: isToday ? "11px" : "9px",
                      fontWeight: isToday ? 700 : 400,
                      fill: isToday ? accentColor : "#FFFFFF",
                      fontFamily: '"DM Mono", monospace',
                    }}
                  >
                    {String(slotDate.getDate()).padStart(2, "0")}
                  </text>
                </g>
              );
            })}

            <text
              x="0"
              y="-18"
              textAnchor="middle"
              style={{
                fontSize: "9px",
                fill: accentColor,
                letterSpacing: "3px",
                fontFamily: '"DM Mono", monospace',
              }}
            >
              DAY 1
            </text>
            <text
              x="0"
              y="-2"
              textAnchor="middle"
              style={{
                fontSize: "13px",
                fill: "#FFFFFF",
                fontFamily: '"DM Mono", monospace',
                fontWeight: 500,
              }}
            >
              {cycleStart.split("-").slice(1).join("/")}
            </text>
            <text
              x="0"
              y="16"
              textAnchor="middle"
              style={{
                fontSize: "10px",
                fill: "#AAAAAA",
                fontFamily: '"DM Mono", monospace',
              }}
            >
              {cycleStart.split("-")[0]}
            </text>
            <text
              x="0"
              y="34"
              textAnchor="middle"
              onClick={() => setEditCycleStart(true)}
              style={{
                fontSize: "8px",
                fill: accentColor,
                fontFamily: '"DM Mono", monospace',
                cursor: "pointer",
                letterSpacing: "1px",
                textDecoration: "underline",
              }}
            >
              edit
            </text>
          </svg>
      </div>

      {/* ── Ratings Spiral ───────────────────────────────────────────── */}
      <div className="fu" style={{ maxWidth: "780px", margin: "8px auto 0", width: "100%" }}>
        <svg viewBox="-234 -234 467 468" style={{ width: "100%", height: "auto", display: "block" }}>
          <defs>
            <filter id="glow-rating">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Rating segments — 5 rings, each showing 1–5 fill via color */}
          {Array.from({ length: DAYS }, (_, d) => {
            return Array.from({ length: RATING_N }, (_, qi) => {
              const RW = 26; const RI = 60;
              const r1 = RI + (RATING_N - 1 - qi) * RW;
              const r2 = RI + (RATING_N - qi) * RW;
              const a1 = START_DEG + d * DAY_ARC;
              const a2 = START_DEG + (d + 1) * DAY_ARC;
              const val = ratings[d]?.[qi] ?? 0;
              // Color: empty = dark, filled = hue based on value 1-5
              // 1=deep muted, 5=bright accentColor
              const alpha = val === 0 ? 0 : 0.15 + (val / 5) * 0.85;
              const fill = val === 0 ? EMPTY : accentColor;
              const slotDate = dateForSlot(d);
              const isToday =
                slotDate.getDate() === now.getDate() &&
                slotDate.getMonth() === now.getMonth() &&
                slotDate.getFullYear() === now.getFullYear();
              return (
                <path
                  key={`r-${d}-${qi}`}
                  d={arcPath(r1, r2, a1, a2)}
                  fill={val === 0 ? (isToday ? "#1A2A1A" : EMPTY) : fill}
                  fillOpacity={val === 0 ? 1 : alpha}
                  stroke="#1A1A1A"
                  strokeWidth="1"
                  onClick={() => {/* ratings entered via check-in panel */}}
                  style={{ cursor: "default" }}
                  filter={val > 0 ? "url(#glow-rating)" : "none"}
                />
              );
            });
          })}

          {/* Value dots for non-zero ratings */}
          {Array.from({ length: DAYS }, (_, d) =>
            Array.from({ length: RATING_N }, (_, qi) => {
              const RW = 26; const RI = 60;
              const r1 = RI + (RATING_N - 1 - qi) * RW;
              const r2 = RI + (RATING_N - qi) * RW;
              const a1 = START_DEG + d * DAY_ARC;
              const a2 = START_DEG + (d + 1) * DAY_ARC;
              const val = ratings[d]?.[qi] ?? 0;
              if (val === 0) return null;
              const [cx, cy] = centroid(r1, r2, a1, a2);
              return (
                <text
                  key={`rv-${d}-${qi}`}
                  x={cx} y={cy}
                  textAnchor="middle" dominantBaseline="central"
                  style={{
                    fontSize: "9px",
                    fill: "#FFFFFF",
                    fontFamily: '"DM Mono", monospace',
                    fontWeight: 700,
                    pointerEvents: "none",
                  }}
                >
                  {val}
                </text>
              );
            })
          )}

          {/* Day labels */}
          {Array.from({ length: DAYS }, (_, d) => {
            const midA = START_DEG + (d + 0.5) * DAY_ARC;
            const rad = toRad(midA);
            const RLABEL_R = 60 + RATING_N * 26 + 24;
            const x = RLABEL_R * Math.cos(rad);
            const y = RLABEL_R * Math.sin(rad);
            const slotDate = dateForSlot(d);
            const isToday =
              slotDate.getDate() === now.getDate() &&
              slotDate.getMonth() === now.getMonth() &&
              slotDate.getFullYear() === now.getFullYear();
            return (
              <g key={d}>
                {isToday && <circle cx={x} cy={y} r="9" fill={accentColor} opacity="0.15" />}
                <text
                  x={x} y={y}
                  textAnchor="middle" dominantBaseline="central"
                  transform={`rotate(${midA + 90},${x},${y})`}
                  style={{
                    fontSize: isToday ? "12px" : "10px",
                    fontWeight: isToday ? 700 : 500,
                    fill: isToday ? accentColor : "#CCCCCC",
                    fontFamily: '"DM Mono", monospace',
                  }}
                >
                  {String(slotDate.getDate()).padStart(2, "0")}
                </text>
              </g>
            );
          })}

          {/* Rating labels — right-justified flush against day 1 */}
          {RATING_QS.map((rq, qi) => {
            const midR = 60 + (RATING_N - 1 - qi + 0.5) * 26;
            const xEdge = midR * Math.cos(toRad(START_DEG));
            const yPos  = midR * Math.sin(toRad(START_DEG));
            const GAP   = 5;
            const xEnd  = xEdge - GAP;
            const LBL_W = 120;
            const xStart = xEnd - LBL_W;
            const rowH  = 25;
            return (
              <g key={rq.key}>
                <text
                  x={xStart + 8} y={yPos}
                  textAnchor="start" dominantBaseline="central"
                  style={{ fontSize: "9px", fill: "#FFFFFF", fontFamily: '"DM Mono", monospace', pointerEvents: "none" }}
                >
                  {qi + 1}
                </text>
                <text
                  x={xEnd} y={yPos}
                  textAnchor="end" dominantBaseline="central"
                  style={{
                    fontSize: "10px",
                    fill: "#FFFFFF",
                    fontFamily: '"DM Mono", monospace',
                  }}
                >
                  {rq.label}
                </text>
              </g>
            );
          })}

          {/* Center label */}
          <text x="0" y="-8" textAnchor="middle"
            style={{ fontSize: "9px", fill: accentColor, letterSpacing: "3px", fontFamily: '"DM Mono", monospace' }}>
            FEELINGS
          </text>
          <text x="0" y="10" textAnchor="middle"
            style={{ fontSize: "9px", fill: "#888", fontFamily: '"DM Mono", monospace' }}>
            1–5 scale
          </text>
        </svg>
      </div>

      {/* ── Day Entry Panel ───────────────────────────────────────────── */}
      {(() => {
        // Find which slot index corresponds to today and yesterday
        const days: { label: string; d: number }[] = [];
        for (let d = 0; d < 31; d++) {
          const sd = dateForSlot(d);
          const diffMs = now.setHours(0,0,0,0) - new Date(sd.getFullYear(), sd.getMonth(), sd.getDate()).getTime();
          const diffDays = Math.round(diffMs / 86400000);
          if (diffDays === 0) days.push({ label: "Today", d });
          else if (diffDays === 1) days.push({ label: "Yesterday", d });
        }
        // show yesterday first, today last
        days.sort((a, b) => a.d - b.d);
        if (days.length === 0) return null;

        const STATE_ICONS: Record<number, string> = { 0: "—", 1: "✓", 2: "✗" };
        const STATE_COLORS: Record<number, string> = { 0: "#2A3A2A", 1: accentColor, 2: "#E04444" };
        const STATE_BG: Record<number, string> = { 0: "transparent", 1: "#0D1F0D", 2: "#1F0D0D" };

        return (
          <div className="fu" style={{
            marginTop: "16px",
            background: "#181818",
            border: "1px solid #1E2A1E",
            borderRadius: "8px",
            padding: "16px",
            fontFamily: '"DM Mono", monospace',
          }}>
            <div style={{ fontSize: "9px", letterSpacing: "3px", color: accentColor, marginBottom: "14px" }}>
              DAILY CHECK-IN
            </div>

            {/* Habit toggles */}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "360px" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 10px 8px", fontSize: "10px", color: "#FFFFFF", fontWeight: 400, width: "50%" }}>
                      Habit
                    </th>
                    {days.map(({ label }) => (
                      <th key={label} style={{ textAlign: "center", padding: "4px 10px 8px", fontSize: "10px", color: "#FFFFFF", fontWeight: 400, whiteSpace: "nowrap" }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {habits.map((name, hi) => name ? (
                    <tr key={hi} style={{ borderTop: "1px solid #1A241A" }}>
                      <td style={{ padding: "7px 10px", fontSize: "12px", color: "#FFFFFF" }}>
                        <span style={{ fontSize: "9px", color: accentColor, marginRight: "6px" }}>{hi + 1}</span>
                        {name}
                      </td>
                      {days.map(({ label, d }) => {
                        const st = data[d][hi];
                        return (
                          <td key={label} style={{ textAlign: "center", padding: "6px" }}>
                            <button
                              onClick={() => toggle(d, hi)}
                              style={{
                                width: "38px", height: "28px",
                                background: STATE_BG[st],
                                border: `1px solid ${STATE_COLORS[st]}`,
                                borderRadius: "4px",
                                color: STATE_COLORS[st],
                                fontSize: "14px",
                                cursor: "pointer",
                                fontFamily: '"DM Mono", monospace',
                                transition: "all 0.15s",
                              }}
                            >
                              {STATE_ICONS[st]}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ) : null)}
                </tbody>
              </table>
            </div>

            {/* Ratings */}
            <div style={{ marginTop: "18px", borderTop: "1px solid #1A241A", paddingTop: "14px" }}>
              <div style={{ fontSize: "9px", letterSpacing: "3px", color: accentColor, marginBottom: "12px" }}>
                DAILY RATINGS
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "360px" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 10px 8px", fontSize: "10px", color: "#FFFFFF", fontWeight: 400, width: "50%" }}>
                      Question
                    </th>
                    {days.map(({ label }) => (
                      <th key={label} style={{ textAlign: "center", padding: "4px 10px 8px", fontSize: "10px", color: "#FFFFFF", fontWeight: 400, whiteSpace: "nowrap" }}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RATING_QS.map((rq, qi) => (
                    <tr key={rq.key} style={{ borderTop: "1px solid #1A241A" }}>
                      <td style={{ padding: "8px 10px" }}>
                        <div style={{ fontSize: "11px", color: "#FFFFFF" }}>{rq.label}</div>
                        <div style={{ fontSize: "9px", color: "#AAAAAA", marginTop: "2px" }}>{rq.q}</div>
                      </td>
                      {days.map(({ label, d }) => {
                        const val = ratings[d]?.[qi] ?? 0;
                        return (
                          <td key={label} style={{ textAlign: "center", padding: "6px 10px" }}>
                            <div style={{ display: "flex", gap: "4px", justifyContent: "center" }}>
                              {[1,2,3,4,5].map(n => (
                                <button
                                  key={n}
                                  onClick={() => updateRating(d, qi, n)}
                                  style={{
                                    width: "22px", height: "22px",
                                    borderRadius: "50%",
                                    border: n <= val ? `1px solid ${accentColor}` : "1px solid #2A3A2A",
                                    background: n <= val ? accentColor + "33" : "transparent",
                                    color: n <= val ? accentColor : "#3A4A3A",
                                    fontSize: "10px",
                                    cursor: "pointer",
                                    fontFamily: '"DM Mono", monospace',
                                    transition: "all 0.15s",
                                    fontWeight: n <= val ? 700 : 400,
                                  }}
                                >
                                  {n}
                                </button>
                              ))}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

            {/* Summary Table */}
      <div
        className="fu"
        style={{
          marginTop: "16px",
          overflowX: "auto",
          background: "#181818",
          border: "1px solid #1E2A1E",
          borderRadius: "8px",
          padding: "4px",
        }}
      >
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontFamily: '"DM Mono", monospace',
            fontSize: "11px",
            minWidth: "600px",
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  padding: "10px 14px",
                  textAlign: "left",
                  fontWeight: 500,
                  letterSpacing: "2px",
                  fontSize: "9px",
                  border: "1px solid #1E2A1E",
                  background: "#1A1A1A",
                  color: accentColor,
                  minWidth: "110px",
                }}
              >
                HABIT
              </th>
              {habits.map((name, i) => (
                <th
                  key={i}
                  style={{
                    padding: "8px 4px",
                    textAlign: "center",
                    border: "1px solid #1E2A1E",
                    background: "#1A1A1A",
                    fontSize: "9px",
                    color: "#FFFFFF",
                    letterSpacing: "1px",
                  }}
                >
                  {name.slice(0, 7)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                style={{
                  padding: "8px 14px",
                  border: "1px solid #1E2A1E",
                  fontSize: "9px",
                  letterSpacing: "2px",
                  color: accentColor,
                }}
              >
                SUCCESS
              </td>
              {achieved.map((n, i) => (
                <td
                  key={i}
                  style={{ padding: "6px", textAlign: "center", border: "1px solid #1E2A1E" }}
                >
                  <span
                    style={{
                      fontSize: "18px",
                      color: accentColor,
                      fontFamily: '"DM Serif Display", serif',
                    }}
                  >
                    {n}
                  </span>
                </td>
              ))}
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 14px",
                  border: "1px solid #1E2A1E",
                  fontSize: "9px",
                  letterSpacing: "2px",
                  color: FAIL,
                }}
              >
                FAILS
              </td>
              {failed.map((n, i) => (
                <td
                  key={i}
                  style={{ padding: "6px", textAlign: "center", border: "1px solid #1E2A1E" }}
                >
                  <span
                    style={{
                      fontSize: "18px",
                      color: n > 0 ? FAIL : "#2A2A2A",
                      fontFamily: '"DM Serif Display", serif',
                    }}
                  >
                    {n}
                  </span>
                </td>
              ))}
            </tr>
            <tr>
              <td
                style={{
                  padding: "8px 14px",
                  border: "1px solid #1E2A1E",
                  fontSize: "9px",
                  letterSpacing: "2px",
                  color: "#FFFFFF",
                }}
              >
                GOAL / MO
              </td>
              {habits.map((_, i) => (
                <td
                  key={i}
                  style={{ padding: "6px", textAlign: "center", border: "1px solid #1E2A1E" }}
                >
                  <input
                    type="number"
                    min="1"
                    max={dim}
                    value={goals[i]}
                    onChange={(e) => updateGoal(i, e.target.value)}
                    style={{
                      width: "36px",
                      border: "none",
                      borderBottom: "1px solid #2A3A2A",
                      background: "transparent",
                      textAlign: "center",
                      fontFamily: '"DM Mono", monospace',
                      fontSize: "14px",
                      color: "#FFFFFF",
                    }}
                    placeholder="—"
                  />
                </td>
              ))}
            </tr>
            {goals.some((g) => g) && (
              <tr>
                <td
                  style={{
                    padding: "8px 14px",
                    border: "1px solid #1E2A1E",
                    fontSize: "9px",
                    letterSpacing: "2px",
                    color: "#FFFFFF",
                  }}
                >
                  PROGRESS
                </td>
                {achieved.map((n, i) => {
                  const g = parseInt(goals[i]);
                  const pct = g ? Math.min(100, Math.round((n / g) * 100)) : 0;
                  return (
                    <td
                      key={i}
                      style={{ padding: "8px", border: "1px solid #1E2A1E" }}
                    >
                      {g ? (
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
                          <div style={{ width: "100%", height: "4px", background: "#1A1A1A", borderRadius: "2px", overflow: "hidden" }}>
                            <div style={{
                              height: "100%",
                              width: `${pct}%`,
                              background: pct >= 100 ? accentColor : "#2A6A4A",
                              borderRadius: "2px",
                              transition: "width 0.4s",
                            }} />
                          </div>
                          <span style={{ fontSize: "10px", color: pct >= 100 ? accentColor : "#FFFFFF" }}>
                            {pct}%
                          </span>
                        </div>
                      ) : (
                        <span style={{ color: "#222" }}>—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Cycle Start Date Edit Modal */}
      {editCycleStart && (
        <div style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.7)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 999,
        }}
          onClick={() => setEditCycleStart(false)}
        >
          <div
            style={{
              background: "#1E1E1E",
              border: `1px solid ${accentColor}`,
              borderRadius: "12px",
              padding: "28px 32px",
              fontFamily: '"DM Mono", monospace',
              minWidth: "280px",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "9px", letterSpacing: "3px", color: accentColor, marginBottom: "16px" }}>
              SET DAY 1 DATE
            </div>
            <input
              type="date"
              defaultValue={cycleStart}
              autoFocus
              onChange={(e) => {
                if (e.target.value) updateCycleStart(e.target.value);
              }}
              style={{
                background: "#1A1A1A",
                border: `1px solid ${accentColor}`,
                color: "#FFFFFF",
                fontSize: "16px",
                padding: "8px 12px",
                borderRadius: "6px",
                fontFamily: '"DM Mono", monospace',
                width: "100%",
                cursor: "pointer",
              }}
            />
            <div style={{ fontSize: "10px", color: "#888", marginTop: "12px", lineHeight: "1.5" }}>
              Day 1 of the spiral will show this date.<br/>
              All 31 slots follow in sequence.
            </div>
            <button
              onClick={() => setEditCycleStart(false)}
              style={{
                marginTop: "16px",
                background: "transparent",
                border: `1px solid #2A3A2A`,
                color: "#888",
                padding: "6px 16px",
                borderRadius: "4px",
                cursor: "pointer",
                fontFamily: '"DM Mono", monospace',
                fontSize: "11px",
              }}
            >
              cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
