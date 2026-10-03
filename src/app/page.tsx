"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type CandlestickData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";

type Screen = "LOGIN" | "TRADE" | "LEADERBOARD";
type TradeType = "BUY" | "SELL";
type Position = {
  id: string;
  type: TradeType;
  entry: number;
  lots: number;
  sl: number | null;
  tp: number | null;
  time: number;
};
type TradeHistory = Position & { exit: number; pnl: number; reason: string };
type Player = { id: string; alias: string; balance: number; isDisqualified: boolean };

const STARTING_BALANCE = 10000;
const SESSION_SECONDS = 25 * 60;

const generateData = (): CandlestickData<Time>[] => {
  const data: CandlestickData<Time>[] = [];
  let price = 2000.5;
  const start = Math.floor(Date.now() / 1000) - 3600;

  for (let index = 0; index < 3600; index += 1) {
    const volatility = (Math.random() - 0.5) * 2;
    const open = price;
    const close = open + volatility;
    data.push({
      time: (start + index) as Time,
      open,
      high: Math.max(open, close) + Math.random(),
      low: Math.min(open, close) - Math.random(),
      close,
    });
    price = close;
  }
  return data;
};

const historicalData = generateData();
const initialPrice = historicalData[historicalData.length - 1].close;

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

export default function App() {
  const [screen, setScreen] = useState<Screen>("LOGIN");
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<Player[]>([]);
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [currentPrice, setCurrentPrice] = useState(initialPrice);
  const [currentTime, setCurrentTime] = useState(Number(historicalData.at(-1)?.time));
  const [positions, setPositions] = useState<Position[]>([]);
  const [history, setHistory] = useState<TradeHistory[]>([]);
  const [lotSize, setLotSize] = useState(0.1);
  const [slInput, setSlInput] = useState("");
  const [tpInput, setTpInput] = useState("");
  const [isDisqualified, setIsDisqualified] = useState(false);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [timeUp, setTimeUp] = useState(false);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const sessionEndedRef = useRef(false);
  const positionsRef = useRef<Position[]>([]);
  const priceRef = useRef(currentPrice);
  const timeRef = useRef(currentTime);
  const markersRef = useRef<SeriesMarker<Time>[]>([]);
  const setMarkersRef = useRef<((markers: SeriesMarker<Time>[]) => void) | null>(null);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    priceRef.current = currentPrice;
  }, [currentPrice]);

  const updateFirebaseBalance = useCallback(
    async (newBalance: number, disqualified = false) => {
      if (!userId) return;
      try {
        await updateDoc(doc(db, "players", userId), {
          balance: newBalance,
          isDisqualified: disqualified,
        });
      } catch (error) {
        console.error("Error updating balance:", error);
      }
    },
    [userId],
  );

  const calculatePnL = useCallback((position: Position, price: number) => {
    const difference =
      position.type === "BUY" ? price - position.entry : position.entry - price;
    return difference * position.lots * 100;
  }, []);

  const floatingPnL = useMemo(
    () => positions.reduce((total, position) => total + calculatePnL(position, currentPrice), 0),
    [calculatePnL, currentPrice, positions],
  );
  const equity = balance + floatingPnL;

  const closeAllTrades = useCallback(
    (reason = "MANUAL CLOSE ALL") => {
      const openPositions = positionsRef.current;
      if (openPositions.length === 0) return 0;
      const exit = priceRef.current;
      const closed = openPositions.map((position) => ({
        ...position,
        exit,
        pnl: calculatePnL(position, exit),
        reason,
      }));
      const realizedPnL = closed.reduce((total, trade) => total + trade.pnl, 0);
      const newBalance = balance + realizedPnL;
      setBalance(newBalance);
      setPositions([]);
      setHistory((previous) => [...closed, ...previous]);
      void updateFirebaseBalance(newBalance, reason === "MARGIN CALL");
      return realizedPnL;
    },
    [balance, calculatePnL, updateFirebaseBalance],
  );

  useEffect(() => {
    if (screen !== "TRADE" || !chartContainerRef.current) return;
    const container = chartContainerRef.current;
    const chart = createChart(container, {
      layout: { background: { type: ColorType.Solid, color: "#0f172a" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      width: container.clientWidth,
      height: 450,
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    series.setData(historicalData);
    markersRef.current = [];
    const markers = createSeriesMarkers<Time>(series, []);
    setMarkersRef.current = markers.setMarkers;
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);
    let lastPrice = initialPrice;
    let time = Number(historicalData.at(-1)?.time);

    const interval = setInterval(() => {
      if (sessionEndedRef.current) return;
      time += 1;
      const open = lastPrice;
      const close = open + (Math.random() - 0.5) * 2.5;
      const high = Math.max(open, close) + Math.random() * 0.8;
      const low = Math.min(open, close) - Math.random() * 0.8;
      series.update({ time: time as Time, open, high, low, close });
      timeRef.current = time;
      priceRef.current = close;
      setCurrentTime(time);
      setCurrentPrice(close);
      lastPrice = close;
    }, 1000);

    return () => {
      clearInterval(interval);
      markers.setMarkers([]);
      setMarkersRef.current = null;
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== "TRADE" || timeUp || isDisqualified) return;
    const timer = setInterval(() => {
      setTimeLeft((previous) => {
        if (previous <= 1) {
          setTimeUp(true);
          sessionEndedRef.current = true;
          return 0;
        }
        return previous - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isDisqualified, screen, timeUp]);

  useEffect(() => {
    if (equity <= 2000 && !isDisqualified) {
      const timeout = setTimeout(() => {
        setIsDisqualified(true);
        sessionEndedRef.current = true;
        closeAllTrades("MARGIN CALL");
        setBalance(2000);
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [closeAllTrades, equity, isDisqualified]);

  useEffect(() => {
    if (!timeUp) return;
    closeAllTrades("TIME UP");
  }, [closeAllTrades, timeUp]);

  useEffect(() => {
    if (screen !== "TRADE" || positions.length === 0) return;
    const hit = positions.find((position) => {
      if (position.type === "BUY") {
        return (
          (position.sl !== null && currentPrice <= position.sl) ||
          (position.tp !== null && currentPrice >= position.tp)
        );
      }
      return (
        (position.sl !== null && currentPrice >= position.sl) ||
        (position.tp !== null && currentPrice <= position.tp)
      );
    });
    if (!hit) return;
    const reason =
      hit.type === "BUY"
        ? currentPrice <= (hit.sl ?? Number.NEGATIVE_INFINITY)
          ? "SL HIT"
          : "TP HIT"
        : currentPrice >= (hit.sl ?? Number.POSITIVE_INFINITY)
          ? "SL HIT"
          : "TP HIT";
    const timeout = setTimeout(() => {
      const pnl = calculatePnL(hit, currentPrice);
      const newBalance = balance + pnl;
      setBalance(newBalance);
      setPositions((previous) => previous.filter((position) => position.id !== hit.id));
      setHistory((previous) => [{ ...hit, exit: currentPrice, pnl, reason }, ...previous]);
      void updateFirebaseBalance(newBalance);
    }, 0);
    return () => clearTimeout(timeout);
  }, [balance, calculatePnL, currentPrice, positions, screen, updateFirebaseBalance]);

  useEffect(() => {
    const playersQuery = query(collection(db, "players"), orderBy("balance", "desc"));
    return onSnapshot(playersQuery, (snapshot) => {
      setLeaderboard(
        snapshot.docs.map((player) => ({ id: player.id, ...player.data() })) as Player[],
      );
    });
  }, []);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !alias) return;
    try {
      const player = await addDoc(collection(db, "players"), {
        email,
        alias,
        balance: STARTING_BALANCE,
        isDisqualified: false,
      });
      setUserId(player.id);
      setScreen("TRADE");
      sessionEndedRef.current = false;
    } catch (error) {
      console.error("Error creating player profile:", error);
    }
  };

  const handleTrade = (type: TradeType) => {
    if (isDisqualified || timeUp || lotSize <= 0) return;
    const position: Position = {
      id: crypto.randomUUID(),
      type,
      entry: currentPrice,
      lots: lotSize,
      sl: slInput ? Number(slInput) : null,
      tp: tpInput ? Number(tpInput) : null,
      time: timeRef.current,
    };
    setPositions((previous) => [...previous, position]);
    const marker: SeriesMarker<Time> = {
      time: position.time as Time,
      position: type === "BUY" ? "belowBar" : "aboveBar",
      color: type === "BUY" ? "#10b981" : "#ef4444",
      shape: type === "BUY" ? "arrowUp" : "arrowDown",
      text: `${type} ${lotSize}`,
      price: position.entry,
    };
    markersRef.current = [
      ...markersRef.current,
      marker,
    ].sort((left, right) => Number(left.time) - Number(right.time));
    setMarkersRef.current?.(markersRef.current);
    setSlInput("");
    setTpInput("");
  };

  const closeTrade = (position: Position) => {
    const pnl = calculatePnL(position, currentPrice);
    const newBalance = balance + pnl;
    setBalance(newBalance);
    setPositions((previous) => previous.filter((item) => item.id !== position.id));
    setHistory((previous) => [{ ...position, exit: currentPrice, pnl, reason: "MANUAL" }, ...previous]);
    void updateFirebaseBalance(newBalance);
  };

  const goToScreen = (nextScreen: Screen) => {
    if (nextScreen === "LOGIN") {
      sessionEndedRef.current = true;
    }
    setScreen(nextScreen);
  };

  return (
    <div className="min-h-screen bg-slate-950 p-4 font-sans text-slate-200 md:p-6">
      <header className="mb-6 flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-lg">
        <h1 className="bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-2xl font-black tracking-tighter text-transparent">
          FOREX BATTLE
        </h1>
        {screen === "TRADE" && (
          <div className="flex items-center gap-3 md:gap-6">
            <div
              className={`rounded border px-3 py-1 font-mono text-xl font-bold ${
                timeLeft < 300
                  ? "animate-pulse border-red-500/50 text-red-500"
                  : "border-slate-800 text-blue-400"
              }`}
            >
              {formatTime(timeLeft)}
            </div>
            <button
              onClick={() => goToScreen("LEADERBOARD")}
              className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
            >
              Leaderboard
            </button>
          </div>
        )}
        {screen === "LEADERBOARD" && (
          <button
            onClick={() => goToScreen(userId ? "TRADE" : "LOGIN")}
            className="rounded bg-slate-800 px-4 py-2 text-sm font-semibold hover:bg-slate-700"
          >
            {userId ? "Back to Terminal" : "Back to Login"}
          </button>
        )}
      </header>

      {screen === "LOGIN" && (
        <div className="flex h-[70vh] items-center justify-center">
          <form
            onSubmit={handleLogin}
            className="flex w-96 flex-col gap-5 rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-2xl"
          >
            <div className="mb-4 text-center">
              <h2 className="text-xl font-bold text-white">Join the Floor</h2>
              <p className="mt-1 text-sm text-slate-400">Start with $10,000. Survive 25 minutes.</p>
            </div>
            <input
              type="email"
              placeholder="College Email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-white focus:border-blue-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Trader Alias"
              required
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-white focus:border-blue-500 focus:outline-none"
            />
            <button type="submit" className="rounded-lg bg-blue-600 p-3 font-bold text-white hover:bg-blue-700">
              START TRADING
            </button>
          </form>
        </div>
      )}

      {screen === "TRADE" && (
        <main className="mx-auto flex max-w-7xl flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            {[
              ["Trader", alias, "text-lg"],
              ["Balance", `$${balance.toFixed(2)}`, "text-xl"],
              ["Equity", `$${equity.toFixed(2)}`, `text-xl ${equity >= balance ? "text-emerald-400" : "text-red-400"}`],
            ].map(([label, value, className]) => (
              <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs font-bold uppercase text-slate-500">{label}</p>
                <p className={`font-mono font-bold text-white ${className}`}>{value}</p>
              </div>
            ))}
            <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-xs font-bold uppercase text-slate-500">Loss Limit ($8,000 Max)</p>
              <div className="mt-1 flex justify-between font-mono text-sm">
                <span>Liq: $2,000</span>
                <span>${equity.toFixed(0)}</span>
              </div>
              <div className="absolute bottom-0 left-0 h-1 w-full bg-slate-800">
                <div
                  className={`h-full ${equity < 4000 ? "bg-red-500" : "bg-blue-500"}`}
                  style={{ width: `${Math.min(100, Math.max(0, ((equity - 2000) / 8000) * 100))}%` }}
                />
              </div>
            </div>
          </div>

          {isDisqualified && (
            <div className="rounded-xl border border-red-500 bg-red-500/10 p-4 text-center text-lg font-bold text-red-500">
              ACCOUNT BLOWN: $8,000 LOSS LIMIT REACHED. DISQUALIFIED.
            </div>
          )}
          {timeUp && (
            <div className="rounded-xl border border-blue-500 bg-blue-500/10 p-4 text-center text-lg font-bold text-blue-400">
              BATTLE ENDED: TIME IS UP. ALL TRADES CLOSED.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div className="relative col-span-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <div className="absolute left-4 top-4 z-10 rounded bg-slate-800/80 px-3 py-1 font-mono text-lg font-bold text-emerald-400">
                XAUUSD {currentPrice.toFixed(2)}
              </div>
              <div ref={chartContainerRef} className="w-full" />
            </div>
            <div className="flex flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="border-b border-slate-800 pb-2 font-bold text-white">Order Execution</h3>
              <label className="text-xs font-bold uppercase text-slate-400">
                Volume (Lots)
                <input
                  type="number"
                  value={lotSize}
                  min="0.1"
                  step="0.1"
                  onChange={(event) => setLotSize(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-white focus:border-blue-500 focus:outline-none"
                  disabled={isDisqualified || timeUp}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                {[
                  ["Stop Loss", slInput, setSlInput],
                  ["Take Profit", tpInput, setTpInput],
                ].map(([label, value, setter]) => (
                  <label key={label as string} className="text-xs font-bold uppercase text-slate-400">
                    {label as string}
                    <input
                      type="number"
                      placeholder="Optional"
                      value={value as string}
                      onChange={(event) => (setter as (value: string) => void)(event.target.value)}
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 font-mono text-white focus:outline-none"
                      disabled={isDisqualified || timeUp}
                    />
                  </label>
                ))}
              </div>
              <button
                onClick={() => handleTrade("SELL")}
                disabled={isDisqualified || timeUp}
                className="rounded-lg bg-red-500 py-3 font-bold text-white shadow-lg shadow-red-500/20 hover:bg-red-600 disabled:opacity-50"
              >
                SELL BY MARKET
              </button>
              <button
                onClick={() => handleTrade("BUY")}
                disabled={isDisqualified || timeUp}
                className="rounded-lg bg-emerald-500 py-3 font-bold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 disabled:opacity-50"
              >
                BUY BY MARKET
              </button>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <h3 className="font-bold text-white">Active Positions ({positions.length})</h3>
              {positions.length > 0 && (
                <button
                  onClick={() => closeAllTrades()}
                  className="rounded border border-red-500/50 bg-red-500/20 px-4 py-1.5 text-sm font-bold text-red-500 hover:bg-red-500 hover:text-white"
                >
                  CLOSE ALL
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="bg-slate-950 text-xs uppercase text-slate-500">
                  <tr>
                    {["Type", "Lots", "Entry", "Current", "SL", "TP", "Floating PnL", "Action"].map((heading) => (
                      <th key={heading} className="px-4 py-3">{heading}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.length === 0 ? (
                    <tr><td colSpan={8} className="px-4 py-8 text-center italic text-slate-600">No open trades. Market is waiting.</td></tr>
                  ) : positions.map((position) => {
                    const pnl = calculatePnL(position, currentPrice);
                    return (
                      <tr key={position.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                        <td className={`px-4 py-3 font-bold ${position.type === "BUY" ? "text-emerald-400" : "text-red-400"}`}>{position.type}</td>
                        <td className="px-4 py-3 font-mono">{position.lots}</td>
                        <td className="px-4 py-3 font-mono">{position.entry.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono">{currentPrice.toFixed(2)}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{position.sl ?? "-"}</td>
                        <td className="px-4 py-3 font-mono text-slate-500">{position.tp ?? "-"}</td>
                        <td className={`px-4 py-3 text-right font-mono font-bold ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}</td>
                        <td className="px-4 py-3 text-center"><button onClick={() => closeTrade(position)} className="rounded bg-slate-700 px-3 py-1 text-xs font-bold hover:bg-slate-600">X</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {history.length > 0 && (
            <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <h3 className="border-b border-slate-800 p-4 text-sm font-bold text-slate-400">Trade History Log</h3>
              <div className="max-h-40 overflow-y-auto">
                {history.map((trade) => (
                  <div key={`${trade.id}-${trade.exit}-${trade.reason}`} className="flex justify-between border-b border-slate-800/50 px-4 py-2 text-xs">
                    <span>{trade.type} {trade.lots} | In: {trade.entry.toFixed(2)} | Out: {trade.exit.toFixed(2)} [{trade.reason}]</span>
                    <span className={`font-mono font-bold ${trade.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>{trade.pnl >= 0 ? "+" : ""}${trade.pnl.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>
      )}

      {screen === "TRADE" && isDisqualified && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/95 p-6 text-center backdrop-blur-sm">
          <div className="max-w-2xl">
            <p className="mb-4 text-sm font-bold uppercase tracking-[0.35em] text-red-500">
              $8,000 loss limit reached
            </p>
            <h2 className="animate-pulse text-7xl font-black tracking-tight text-red-500 drop-shadow-[0_0_24px_rgba(239,68,68,0.8)] sm:text-9xl">
              DISQUALIFIED
            </h2>
            <p className="mt-6 text-lg text-slate-300">
              Your trading account has been closed for this battle.
            </p>
            <button
              onClick={() => goToScreen("LEADERBOARD")}
              className="mt-8 rounded-lg bg-red-600 px-6 py-3 font-bold text-white hover:bg-red-500"
            >
              VIEW LEADERBOARD
            </button>
          </div>
        </div>
      )}

      {screen === "LEADERBOARD" && (
        <main className="mx-auto mt-10 max-w-3xl">
          <h2 className="mb-8 text-center text-3xl font-black text-white">GLOBAL RANKINGS</h2>
          <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl">
            {leaderboard.length === 0 ? (
              <p className="p-8 text-center text-slate-500">No traders registered yet.</p>
            ) : leaderboard.map((player, index) => (
              <div key={player.id} className="flex items-center justify-between border-b border-slate-800 p-5 last:border-0 hover:bg-slate-800/50">
                <div className="flex items-center gap-5"><span className="w-6 text-center font-mono text-xl font-bold text-slate-500">{index + 1}</span><span className="font-bold text-white">{player.alias}{player.isDisqualified && <span className="ml-2 rounded border border-red-500 px-2 py-0.5 text-xs text-red-500">DISQUALIFIED</span>}</span></div>
                <span className={`font-mono text-xl font-bold ${player.balance >= STARTING_BALANCE ? "text-emerald-400" : "text-red-400"}`}>${player.balance.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
