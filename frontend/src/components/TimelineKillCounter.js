import React, { useState, useEffect, useRef } from "react";

export default function TimelineKillCounter({ value, color }) {
  const [displayed, setDisplayed] = useState(0);
  const prevRef = useRef(0);
  const timerRef = useRef(null);

  useEffect(() => {
    if (value === prevRef.current) return;
    const diff = value - prevRef.current;
    if (diff <= 0) { prevRef.current = value; setDisplayed(value); return; }
    if (timerRef.current) clearInterval(timerRef.current);
    const ms = Math.max(40, Math.min(120, 600 / diff));
    let cur = prevRef.current;
    timerRef.current = setInterval(() => {
      cur += 1;
      setDisplayed(cur);
      if (cur >= value) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        prevRef.current = value;
      }
    }, ms);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [value]);

  return (
    <span style={{ fontSize: 48, fontWeight: 900, lineHeight: 1, color, fontVariantNumeric: "tabular-nums" }}>
      {displayed}
    </span>
  );
}
