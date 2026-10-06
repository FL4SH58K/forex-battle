"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../lib/firebase";

type Screen = "LOGIN" | "LOBBY" | "TRADE";
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
type MarketCandle = {
  tick: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

const STARTING_BALANCE = 10000;
const MAX_TOTAL_LOSS = 2000;
const MIN_EQUITY = STARTING_BALANCE - MAX_TOTAL_LOSS;
const SESSION_SECONDS = 25 * 60;
const MAX_OPEN_POSITIONS = 5;
const MAX_LOT_SIZE = 1.5;
const USER_STORAGE_KEY = "forex_user";
const POSITIONS_STORAGE_KEY = "forex_positions";
const HISTORY_STORAGE_KEY = "forex_history";
const configuredSpeedMultiplier = Number(process.env.NEXT_PUBLIC_TEST_SPEED_MULTIPLIER ?? "1");
const TEST_SPEED_MULTIPLIER =
  Number.isFinite(configuredSpeedMultiplier) && configuredSpeedMultiplier >= 1
    ? configuredSpeedMultiplier
    : 1;

const getElapsedSeconds = (startTime: number) =>
  Math.floor(((Date.now() - startTime) / 1000) * TEST_SPEED_MULTIPLIER);

const generateScriptedMarket = (): MarketCandle[] => {
  const candles: MarketCandle[] = [];
  let price = 2000;

  for (let tick = -100; tick <= SESSION_SECONDS; tick += 1) {
    let targetOffset = 0;
    let volatility = 0.7;
    if (tick < 0) {
      targetOffset = 0;
    } else if (tick < 180) {
      targetOffset = (tick / 180) * 12;
      volatility = 0.5;
    } else if (tick < 360) {
      targetOffset = 12 + Math.sin((tick - 180) * 0.03) * 6;
      volatility = 0.8;
    } else if (tick < 480) {
      targetOffset = 15 - ((tick - 360) / 120) * 8;
      volatility = 1;
    } else if (tick < 630) {
      targetOffset = 7 + ((tick - 480) / 150) * 8;
      volatility = 1.4;
    } else if (tick < 810) {
      targetOffset = 10 + Math.sin(tick * 0.4) * 2.5;
      volatility = 0.6;
    } else if (tick < 990) {
      targetOffset = 10 - ((tick - 810) / 180) * 18;
      volatility = 1.6;
    } else if (tick < 1140) {
      targetOffset = -8 + ((tick - 990) / 150) * 10;
      volatility = 0.9;
    } else if (tick < 1290) {
      targetOffset = 2 + Math.sin((tick - 1140) * 0.05) * 1.5;
      volatility = 0.8;
    } else {
      targetOffset = 2 + ((tick - 1290) / 210) * 25;
      volatility = 2.2;
    }

    const randomA = Math.sin(tick * 12.9898) * 43758.5453;
    const randomB = Math.sin(tick * 78.233) * 43758.5453;
    const fractionA = randomA - Math.floor(randomA);
    const fractionB = randomB - Math.floor(randomB);
    const targetPrice = 2000 + targetOffset;
    const move =
      (targetPrice - price) * 0.12 +
      (fractionA > 0.5 ? 1 : -1) * fractionB * volatility;
    const open = price;
    const close = open + move;
    candles.push({
      tick,
      open,
      high: Math.max(open, close) + fractionA * volatility,
      low: Math.min(open, close) - (1 - fractionB) * volatility,
      close,
    });
    price = close;
  }
  return candles;
};

const scriptedMarket = generateScriptedMarket();
const initialCandle = scriptedMarket.find((candle) => candle.tick === 0) ?? scriptedMarket[0];
const initialPrice = initialCandle.close;

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;

export default function App() {
  const [screen, setScreen] = useState<Screen>("LOGIN");
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [balance, setBalance] = useState(STARTING_BALANCE);
  const [currentPrice, setCurrentPrice] = useState(initialPrice);
  const [currentTime, setCurrentTime] = useState(0);
  const [positions, setPositions] = useState<Position[]>([]);
  const [history, setHistory] = useState<TradeHistory[]>([]);
  const [lotSize, setLotSize] = useState("0.1");
  const [slInput, setSlInput] = useState("");
  const [tpInput, setTpInput] = useState("");
  const [isDisqualified, setIsDisqualified] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [playerStartTime, setPlayerStartTime] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(SESSION_SECONDS);
  const [timeUp, setTimeUp] = useState(false);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const sessionEndedRef = useRef(false);
  const positionsRef = useRef<Position[]>([]);
  const priceRef = useRef(currentPrice);
  const timeRef = useRef(currentTime);
  const markersRef = useRef<SeriesMarker<Time>[]>([]);
  const setMarkersRef = useRef<((markers: SeriesMarker<Time>[]) => void) | null>(null);
  const playerStartTimeRef = useRef<number | null>(null);
  const restoredStorageRef = useRef(false);

  useEffect(() => {
    positionsRef.current = positions;
  }, [positions]);

  useEffect(() => {
    priceRef.current = currentPrice;
  }, [currentPrice]);

  const updateFirebaseBalance = useCallback(
    async (newBalance: number, disqualified?: boolean) => {
      if (!userId) return;
      try {
        const updates: { balance: number; isDisqualified?: boolean } = { balance: newBalance };
        if (disqualified !== undefined) updates.isDisqualified = disqualified;
        await updateDoc(doc(db, "players", userId), updates);
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
    if (!userId) return;
    return onSnapshot(doc(db, "players", userId), (snapshot) => {
      if (!snapshot.exists()) return;
      const data = snapshot.data();
      setIsStarted(data.isStarted === true);
      const nextStartTime = typeof data.startTime === "number" ? data.startTime : null;
      setPlayerStartTime(nextStartTime);
      playerStartTimeRef.current = nextStartTime;
      setIsDisqualified(data.isDisqualified === true);
      if (typeof data.balance === "number") setBalance(data.balance);
      if (data.isStarted !== true && screen === "TRADE") {
        setScreen("LOBBY");
        setPositions([]);
        setHistory([]);
        localStorage.removeItem(POSITIONS_STORAGE_KEY);
        localStorage.removeItem(HISTORY_STORAGE_KEY);
        setTimeUp(false);
        setTimeLeft(SESSION_SECONDS);
        sessionEndedRef.current = false;
      }
      if (data.isStarted === true && !isDisqualified && !timeUp && screen === "LOBBY") {
        setScreen("TRADE");
      }
    });
  }, [isDisqualified, screen, timeUp, userId]);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const storedUser = localStorage.getItem(USER_STORAGE_KEY);
        if (!storedUser) return;
        const parsedUser = JSON.parse(storedUser) as {
          id?: string;
          alias?: string;
          email?: string;
        };
        if (!parsedUser.id) return;
        setUserId(parsedUser.id);
        setAlias(typeof parsedUser.alias === "string" ? parsedUser.alias : "");
        setEmail(typeof parsedUser.email === "string" ? parsedUser.email : "");
        setScreen("LOBBY");

        const storedPositions = localStorage.getItem(POSITIONS_STORAGE_KEY);
        const storedHistory = localStorage.getItem(HISTORY_STORAGE_KEY);
        if (storedPositions) {
          const parsedPositions = JSON.parse(storedPositions);
          if (Array.isArray(parsedPositions)) setPositions(parsedPositions);
        }
        if (storedHistory) {
          const parsedHistory = JSON.parse(storedHistory);
          if (Array.isArray(parsedHistory)) setHistory(parsedHistory);
        }
      } catch (error) {
        console.error("Unable to restore the saved trading session:", error);
      } finally {
        restoredStorageRef.current = true;
      }
    }, 0);

    return () => window.clearTimeout(restoreTimer);
  }, []);

  useEffect(() => {
    if (!restoredStorageRef.current) return;
    try {
      localStorage.setItem(POSITIONS_STORAGE_KEY, JSON.stringify(positions));
    } catch (error) {
      console.error("Unable to save open positions locally:", error);
    }
  }, [positions]);

  useEffect(() => {
    if (!restoredStorageRef.current) return;
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
      console.error("Unable to save trade history locally:", error);
    }
  }, [history]);

  useEffect(() => {
    if (screen !== "TRADE" || !chartContainerRef.current) return;
    const container = chartContainerRef.current;
    const chart = createChart(container, {
      layout: { background: { type: ColorType.Solid, color: "#0f172a" }, textColor: "#94a3b8" },
      grid: { vertLines: { color: "#1e293b" }, horzLines: { color: "#1e293b" } },
      width: container.clientWidth,
      height: container.clientHeight || 450,
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981",
      downColor: "#ef4444",
      borderVisible: false,
      wickUpColor: "#10b981",
      wickDownColor: "#ef4444",
    });
    const activeStartTime = playerStartTime ?? Date.now();
    const baseTimestamp = Math.floor(activeStartTime / 1000);
    const elapsedAtEntry = Math.min(SESSION_SECONDS, Math.max(0, getElapsedSeconds(activeStartTime)));
    const visibleMarket = scriptedMarket
      .filter((candle) => candle.tick <= elapsedAtEntry)
      .map((candle) => ({
        time: (baseTimestamp + candle.tick) as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));
    series.setData(visibleMarket);
    const entryCandle = scriptedMarket.find((candle) => candle.tick === elapsedAtEntry);
    if (entryCandle) {
      priceRef.current = entryCandle.close;
      timeRef.current = elapsedAtEntry;
    }
    const initialStateTimer = window.setTimeout(() => {
      if (entryCandle) {
        setCurrentTime(elapsedAtEntry);
        setCurrentPrice(entryCandle.close);
        setTimeLeft(SESSION_SECONDS - elapsedAtEntry);
      }
      if (elapsedAtEntry >= SESSION_SECONDS) setTimeUp(true);
    }, 0);
    if (elapsedAtEntry >= SESSION_SECONDS) {
      sessionEndedRef.current = true;
    }
    markersRef.current = [];
    const markers = createSeriesMarkers<Time>(series, []);
    setMarkersRef.current = markers.setMarkers;
    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    resizeObserver.observe(container);
    let renderedTick = elapsedAtEntry;

    const interval = setInterval(() => {
      const currentStartTime = playerStartTimeRef.current;
      if (sessionEndedRef.current || !isStarted || !currentStartTime) return;
      const elapsed = Math.min(SESSION_SECONDS, Math.max(0, getElapsedSeconds(currentStartTime)));
      const candle = scriptedMarket.find((item) => item.tick === elapsed);
      if (!candle || elapsed <= renderedTick) return;
      series.update({
        time: (baseTimestamp + elapsed) as Time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      });
      renderedTick = elapsed;
      timeRef.current = elapsed;
      priceRef.current = candle.close;
      setCurrentTime(elapsed);
      setCurrentPrice(candle.close);
      setTimeLeft(SESSION_SECONDS - elapsed);
      if (elapsed >= SESSION_SECONDS) {
        chart.timeScale().fitContent();
        setTimeUp(true);
        sessionEndedRef.current = true;
      }
    }, 100);

    return () => {
      clearTimeout(initialStateTimer);
      clearInterval(interval);
      markers.setMarkers([]);
      setMarkersRef.current = null;
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [isStarted, playerStartTime, screen]);

  useEffect(() => {
    if (screen !== "TRADE" || timeUp || isDisqualified || !isStarted || !playerStartTime) {
      return;
    }
    const timer = setInterval(() => {
      const elapsed = Math.min(SESSION_SECONDS, Math.max(0, getElapsedSeconds(playerStartTime)));
      const remaining = Math.max(0, SESSION_SECONDS - elapsed);
      setTimeLeft(remaining);
      if (remaining === 0) {
        setTimeUp(true);
        sessionEndedRef.current = true;
      }
    }, 250);
    return () => clearInterval(timer);
  }, [isDisqualified, isStarted, playerStartTime, screen, timeUp]);

  useEffect(() => {
    if (equity <= MIN_EQUITY && !isDisqualified) {
      const timeout = setTimeout(() => {
        setIsDisqualified(true);
        sessionEndedRef.current = true;
        closeAllTrades("MARGIN CALL");
      }, 0);
      return () => clearTimeout(timeout);
    }
  }, [closeAllTrades, equity, isDisqualified, updateFirebaseBalance]);

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

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !alias) return;
    try {
      const player = await addDoc(collection(db, "players"), {
        email,
        alias,
        balance: STARTING_BALANCE,
        isDisqualified: false,
        isStarted: false,
        startTime: null,
      });
      localStorage.setItem(
        USER_STORAGE_KEY,
        JSON.stringify({ id: player.id, alias, email }),
      );
      localStorage.removeItem(POSITIONS_STORAGE_KEY);
      localStorage.removeItem(HISTORY_STORAGE_KEY);
      setUserId(player.id);
      setScreen("LOBBY");
      sessionEndedRef.current = false;
    } catch (error) {
      console.error("Error creating player profile:", error);
    }
  };

  const handleTrade = (type: TradeType) => {
    const lotValue = Number(lotSize);
    const stopLoss = slInput.trim() === "" ? null : Number(slInput);
    const takeProfit = tpInput.trim() === "" ? null : Number(tpInput);
    if (
      isDisqualified ||
      timeUp ||
      !isStarted ||
      !playerStartTime ||
      !Number.isFinite(lotValue) ||
      lotValue <= 0 ||
      lotValue > MAX_LOT_SIZE ||
      positionsRef.current.length >= MAX_OPEN_POSITIONS ||
      (stopLoss !== null && !Number.isFinite(stopLoss)) ||
      (takeProfit !== null && !Number.isFinite(takeProfit))
    ) {
      return;
    }
    const position: Position = {
      id: crypto.randomUUID(),
      type,
      entry: priceRef.current,
      lots: lotValue,
      sl: stopLoss,
      tp: takeProfit,
      time: timeRef.current,
    };
    setPositions((previous) => [...previous, position]);
    const marker: SeriesMarker<Time> = {
      time: (Math.floor(playerStartTime / 1000) + position.time) as Time,
      position: type === "BUY" ? "belowBar" : "aboveBar",
      color: type === "BUY" ? "#10b981" : "#ef4444",
      shape: type === "BUY" ? "arrowUp" : "arrowDown",
      text: `${type} ${lotValue}`,
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

  const enterTradingFloor = () => {
    if (!isStarted || !playerStartTime || isDisqualified || timeUp) return;
    const elapsed = Math.min(SESSION_SECONDS, Math.max(0, getElapsedSeconds(playerStartTime)));
    if (elapsed >= SESSION_SECONDS) {
      setTimeLeft(0);
      setTimeUp(true);
      sessionEndedRef.current = true;
      return;
    }
    const entryCandle = scriptedMarket.find((candle) => candle.tick === elapsed);
    if (entryCandle) {
      setCurrentTime(elapsed);
      setCurrentPrice(entryCandle.close);
      setTimeLeft(SESSION_SECONDS - elapsed);
      priceRef.current = entryCandle.close;
      timeRef.current = elapsed;
    }
    setScreen("TRADE");
    sessionEndedRef.current = false;
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
          </div>
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
              placeholder="Full Name"
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

      {screen === "LOBBY" && (
        <main className="mx-auto flex min-h-[70vh] max-w-xl items-center justify-center">
          <section className="w-full rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
            <p className="text-sm font-bold uppercase tracking-[0.3em] text-blue-400">Trader lobby</p>
            <h2 className="mt-3 text-3xl font-black text-white">Welcome, {alias}</h2>
            <p className="mt-3 text-slate-400">
              Your starting balance is <span className="font-mono text-emerald-400">$10,000.00</span>.
            </p>
            <div className="mt-8 w-full rounded-xl border border-slate-800 bg-slate-950 p-5">
              <p className="mb-2 text-xs font-bold uppercase text-slate-500">Staging Status</p>
              {isDisqualified ? (
                <p className="text-lg font-black tracking-widest text-red-500 drop-shadow-[0_0_10px_rgba(239,68,68,0.8)]">
                  DISQUALIFIED
                </p>
              ) : isStarted ? (
                <p className="text-lg font-bold text-emerald-400">READY TO ENTER</p>
              ) : (
                <p className="animate-pulse font-bold tracking-widest text-yellow-500">
                  WAITING FOR ADMIN TO START
                </p>
              )}
            </div>
            {isDisqualified ? (
              <button
                type="button"
                disabled
                className="mt-8 w-full cursor-not-allowed rounded-xl border border-red-900/50 bg-slate-900 p-4 text-lg font-black tracking-wide text-red-500/50"
              >
                BATTLE OVER
              </button>
            ) : (
              <button
                type="button"
                onClick={enterTradingFloor}
                disabled={!isStarted || !playerStartTime}
                className={`mt-8 w-full rounded-xl p-4 text-lg font-black tracking-wide shadow-lg transition-all ${
                  isStarted
                    ? "bg-blue-600 text-white shadow-blue-600/20 hover:bg-blue-500"
                    : "cursor-not-allowed bg-slate-800 text-slate-500"
                }`}
              >
                ENTER TRADING FLOOR
              </button>
            )}
          </section>
        </main>
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
              <p className="text-xs font-bold uppercase text-slate-500">Loss Limit (${MAX_TOTAL_LOSS.toLocaleString()} Max)</p>
              <div className="mt-1 flex justify-between font-mono text-sm">
                <span>Min equity: ${MIN_EQUITY.toLocaleString()}</span>
                <span>${equity.toFixed(0)}</span>
              </div>
              <div className="absolute bottom-0 left-0 h-1 w-full bg-slate-800">
                <div
                  className={`h-full ${equity <= MIN_EQUITY ? "bg-red-500" : "bg-blue-500"}`}
                  style={{
                    width: `${Math.min(
                      100,
                      Math.max(0, ((equity - MIN_EQUITY) / MAX_TOTAL_LOSS) * 100),
                    )}%`,
                  }}
                />
              </div>
            </div>
          </div>

          {isDisqualified && (
            <div className="rounded-xl border border-red-500 bg-red-500/10 p-4 text-center text-lg font-bold text-red-500">
              ACCOUNT BLOWN: $2,000 LOSS LIMIT REACHED. DISQUALIFIED.
            </div>
          )}
          {timeUp && (
            <div className="rounded-xl border border-blue-500 bg-blue-500/10 p-4 text-center text-lg font-bold text-blue-400">
              BATTLE ENDED: TIME IS UP. ALL TRADES CLOSED.
            </div>
          )}
          {!isStarted && !timeUp && !isDisqualified && (
            <div className="rounded-xl border border-yellow-500/50 bg-yellow-500/10 p-4 text-center text-lg font-bold text-yellow-400">
              WAITING FOR ADMIN: MARKET TRADING IS PAUSED.
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <div className="relative col-span-3 overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
              <div className="absolute left-4 top-4 z-10 rounded bg-slate-800/80 px-3 py-1 font-mono text-lg font-bold text-emerald-400">
                XAUUSD {currentPrice.toFixed(2)}
              </div>
              <div ref={chartContainerRef} className="h-[300px] w-full md:h-[450px]" />
            </div>
            <div className="flex flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h3 className="border-b border-slate-800 pb-2 font-bold text-white">Order Execution</h3>
              <label className="text-xs font-bold uppercase text-slate-400">
                Volume (Lots, max {MAX_LOT_SIZE})
                <input
                  type="number"
                  value={lotSize}
                  min="0.1"
                  max={MAX_LOT_SIZE}
                  step="0.1"
                  onChange={(event) => setLotSize(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-base font-mono text-white focus:border-blue-500 focus:outline-none"
                  disabled={isDisqualified || timeUp || !isStarted}
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
                      className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-base font-mono text-white focus:outline-none"
                      disabled={isDisqualified || timeUp || !isStarted}
                    />
                  </label>
                ))}
              </div>
              <button
                onClick={() => handleTrade("SELL")}
                disabled={
                  isDisqualified ||
                  timeUp ||
                  !isStarted ||
                  positions.length >= MAX_OPEN_POSITIONS
                }
                className="rounded-lg bg-red-500 py-4 font-bold text-white shadow-lg shadow-red-500/20 hover:bg-red-600 disabled:opacity-50 md:py-3"
              >
                SELL BY MARKET
              </button>
              <button
                onClick={() => handleTrade("BUY")}
                disabled={
                  isDisqualified ||
                  timeUp ||
                  !isStarted ||
                  positions.length >= MAX_OPEN_POSITIONS
                }
                className="rounded-lg bg-emerald-500 py-4 font-bold text-white shadow-lg shadow-emerald-500/20 hover:bg-emerald-600 disabled:opacity-50 md:py-3"
              >
                BUY BY MARKET
              </button>
            </div>
          </div>

          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-800 p-4">
              <h3 className="font-bold text-white">
                Active Positions ({positions.length}/{MAX_OPEN_POSITIONS})
              </h3>
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
                        <td className="px-4 py-3 text-center">
                          <button
                            type="button"
                            onClick={() => closeTrade(position)}
                            className="rounded bg-slate-700 px-4 py-2 text-sm font-bold hover:bg-slate-600"
                          >
                            X
                          </button>
                        </td>
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
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md">
          <div className="flex w-full max-w-xl flex-col items-center rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-[0_0_100px_rgba(220,38,38,0.2)] md:p-12">
            <span className="mb-2 font-mono text-xs font-bold uppercase tracking-widest text-red-500 md:text-sm">
              $2,000 loss limit reached
            </span>
            <h2 className="mb-4 text-4xl font-black tracking-wider text-red-600 drop-shadow-[0_0_30px_rgba(220,38,38,0.8)] md:text-7xl">
              DISQUALIFIED
            </h2>
            <p className="mb-8 text-sm text-slate-400 md:text-base">
              Your trading account has been closed for this battle.
            </p>
            <button
              onClick={() => {
                setUserId(null);
                setAlias("");
                setEmail("");
                setBalance(STARTING_BALANCE);
                setPositions([]);
                setHistory([]);
                setIsDisqualified(false);
                setIsStarted(false);
                setPlayerStartTime(null);
                setTimeUp(false);
                setTimeLeft(SESSION_SECONDS);
                localStorage.removeItem(USER_STORAGE_KEY);
                localStorage.removeItem(POSITIONS_STORAGE_KEY);
                localStorage.removeItem(HISTORY_STORAGE_KEY);
                sessionEndedRef.current = false;
                setScreen("LOGIN");
              }}
              className="w-full max-w-xs rounded-xl bg-red-600 px-8 py-4 text-base font-bold text-white shadow-lg shadow-red-600/30 transition-all hover:bg-red-500"
            >
              REGISTER NEW PLAYER
            </button>
          </div>
        </div>
      )}

      {screen === "TRADE" && !isStarted && !isDisqualified && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/90 p-4 backdrop-blur-md">
          <div className="flex w-full max-w-xl flex-col items-center rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl md:p-12">
            <div className="mb-6 flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl border border-yellow-500/30 bg-yellow-500/10">
              <span className="text-2xl" aria-hidden="true">⏳</span>
            </div>
            <h2 className="mb-3 text-2xl font-black tracking-wider text-yellow-500 md:text-4xl">
              WAITING FOR ADMIN
            </h2>
            <p className="text-sm text-slate-400 md:text-base">
              Admin is about to start your individual challenge. Get ready!
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
