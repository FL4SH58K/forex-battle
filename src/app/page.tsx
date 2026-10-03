"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  type CandlestickData,
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
type Position = { type: TradeType; entry: number; lots: number };
type Player = {
  id: string;
  alias: string;
  balance: number;
  isDisqualified: boolean;
};

const generateData = (): CandlestickData<Time>[] => {
  const data: CandlestickData<Time>[] = [];
  let currentPrice = 2000.5;
  const startTime = Math.floor(Date.now() / 1000) - 1800;

  for (let index = 0; index < 1800; index += 1) {
    const volatility = (Math.random() - 0.5) * 2;
    const open = currentPrice;
    const high = open + Math.abs(volatility) + Math.random();
    const low = open - Math.abs(volatility) - Math.random();
    const close = open + volatility;

    data.push({ time: (startTime + index) as Time, open, high, low, close });
    currentPrice = close;
  }

  return data;
};

const historicalData = generateData();

export default function App() {
  const [screen, setScreen] = useState<Screen>("LOGIN");
  const [email, setEmail] = useState("");
  const [alias, setAlias] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<Player[]>([]);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [balance, setBalance] = useState(10000);
  const [currentPrice, setCurrentPrice] = useState(
    historicalData[historicalData.length - 1].close,
  );
  const [position, setPosition] = useState<Position | null>(null);
  const [isDisqualified, setIsDisqualified] = useState(false);
  const [lotSize, setLotSize] = useState(1);

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email || !alias) return;

    try {
      const player = await addDoc(collection(db, "players"), {
        email,
        alias,
        balance: 10000,
        isDisqualified: false,
      });
      setUserId(player.id);
      setScreen("TRADE");
    } catch (error) {
      console.error("Error creating player profile:", error);
    }
  };

  const updateFirebaseBalance = useCallback(async (newBalance: number, disqualified = false) => {
    if (!userId) return;

    try {
      await updateDoc(doc(db, "players", userId), {
        balance: newBalance,
        isDisqualified: disqualified,
      });
    } catch (error) {
      console.error("Error updating balance:", error);
    }
  }, [userId]);

  useEffect(() => {
    if (screen !== "TRADE" || !chartContainerRef.current) return;

    const container = chartContainerRef.current;
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: "#131722" },
        textColor: "#d1d4dc",
      },
      grid: {
        vertLines: { color: "#2b2b43" },
        horzLines: { color: "#2b2b43" },
      },
      width: container.clientWidth,
      height: 400,
    });
    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#26a69a",
      wickDownColor: "#ef5350",
    });

    candlestickSeries.setData(historicalData);
    let lastPrice = historicalData[historicalData.length - 1].close;
    let time = historicalData[historicalData.length - 1].time as number;
    const interval = setInterval(() => {
      time += 1;
      const volatility = (Math.random() - 0.5) * 1.5;
      const open = lastPrice;
      const close = open + volatility;
      const high = Math.max(open, close) + Math.random() * 0.5;
      const low = Math.min(open, close) - Math.random() * 0.5;

      candlestickSeries.update({ time: time as Time, open, high, low, close });
      setCurrentPrice(close);
      lastPrice = close;
    }, 1000);

    return () => {
      clearInterval(interval);
      chart.remove();
    };
  }, [screen]);

  const floatingPnL = position
    ? (position.type === "BUY"
        ? currentPrice - position.entry
        : position.entry - currentPrice) *
      (position.lots * 100)
    : 0;
  const equity = balance + floatingPnL;

  useEffect(() => {
    if (equity <= 2000 && !isDisqualified) {
      const timeout = setTimeout(() => {
        setIsDisqualified(true);
        setPosition(null);
        setBalance(equity);
        void updateFirebaseBalance(equity, true);
      }, 0);

      return () => clearTimeout(timeout);
    }
  }, [equity, isDisqualified, updateFirebaseBalance]);

  const handleTrade = (type: TradeType) => {
    if (isDisqualified || position) return;
    setPosition({ type, entry: currentPrice, lots: lotSize });
  };

  const closePosition = () => {
    if (!position) return;
    const newBalance = balance + floatingPnL;
    setBalance(newBalance);
    setPosition(null);
    void updateFirebaseBalance(newBalance);
  };

  useEffect(() => {
    const playersQuery = query(collection(db, "players"), orderBy("balance", "desc"));
    return onSnapshot(playersQuery, (snapshot) => {
      const players = snapshot.docs.map((player) => ({
        id: player.id,
        ...player.data(),
      })) as Player[];
      setLeaderboard(players);
    });
  }, []);

  return (
    <div className="min-h-screen bg-gray-900 p-8 font-sans text-white">
      <div className="fixed right-4 top-4 z-50">
        <button
          onClick={() => setScreen(screen === "LEADERBOARD" ? "LOGIN" : "LEADERBOARD")}
          className="rounded bg-gray-700 px-3 py-2 text-xs font-medium text-white hover:bg-gray-600"
        >
          {screen === "LEADERBOARD" ? "Back to Login" : "View Leaderboard"}
        </button>
      </div>

      {screen === "LOGIN" && (
        <div className="flex h-[80vh] items-center justify-center">
          <form
            onSubmit={handleLogin}
            className="flex w-96 flex-col gap-4 rounded-lg border border-gray-700 bg-gray-800 p-8"
          >
            <h1 className="mb-2 text-center text-2xl font-bold text-yellow-500">
              FOREX BATTLE
            </h1>
            <p className="mb-2 text-center text-xs text-gray-400">
              Enter details to join trading floor
            </p>
            <input
              type="email"
              placeholder="College Email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="rounded border border-gray-600 bg-gray-900 p-3 text-white focus:border-yellow-500 focus:outline-none"
            />
            <input
              type="text"
              placeholder="Trader Alias / Name"
              required
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              className="rounded border border-gray-600 bg-gray-900 p-3 text-white focus:border-yellow-500 focus:outline-none"
            />
            <button
              type="submit"
              className="mt-2 rounded bg-yellow-600 p-3 font-bold text-white transition-colors hover:bg-yellow-700"
            >
              ENTER TRADING FLOOR
            </button>
          </form>
        </div>
      )}

      {screen === "LEADERBOARD" && (
        <div className="mx-auto mt-10 max-w-3xl">
          <h1 className="mb-8 text-center text-3xl font-bold text-yellow-500">
            LIVE LEADERBOARD
          </h1>
          <div className="overflow-hidden rounded-lg border border-gray-700 bg-gray-800">
            {leaderboard.length === 0 ? (
              <p className="p-6 text-center text-gray-400">No traders registered yet.</p>
            ) : (
              leaderboard.map((player, index) => (
                <div
                  key={player.id}
                  className="flex items-center justify-between border-b border-gray-700 p-4 last:border-0"
                >
                  <div className="flex items-center gap-4">
                    <span className="w-6 font-mono text-xl text-gray-500">{index + 1}</span>
                    <span className="text-lg font-bold">
                      {player.alias}
                      {player.isDisqualified && (
                        <span className="ml-2 rounded border border-red-500 px-2 py-0.5 text-xs text-red-500">
                          DISQUALIFIED
                        </span>
                      )}
                    </span>
                  </div>
                  <span
                    className={`font-mono text-xl ${
                      player.balance >= 10000 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    ${player.balance.toFixed(2)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {screen === "TRADE" && (
        <div className="mx-auto mt-6 max-w-5xl">
          <div className="mb-6 flex items-center justify-between rounded-lg border border-gray-700 bg-gray-800 p-4">
            <div>
              <h1 className="text-2xl font-bold text-yellow-500">XAUUSD BATTLE</h1>
              <p className="text-sm text-gray-400">
                Trader: <span className="font-semibold text-white">{alias}</span>
              </p>
            </div>
            <div className="flex gap-6 text-right">
              <div>
                <p className="text-xs text-gray-400">Balance</p>
                <p className="font-mono text-xl">${balance.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Equity</p>
                <p
                  className={`font-mono text-xl ${
                    equity < balance ? "text-red-400" : "text-green-400"
                  }`}
                >
                  ${equity.toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          {isDisqualified && (
            <div className="mb-6 rounded-lg bg-red-600 p-4 text-center text-xl font-bold text-white">
              DISQUALIFIED: YOU HIT THE $8,000 LOSS LIMIT (MARGIN CALL)
            </div>
          )}

          <div ref={chartContainerRef} className="mb-6 w-full rounded-lg border border-gray-700" />

          <div className="rounded-lg border border-gray-700 bg-gray-800 p-6">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-400" htmlFor="lot-size">
                  Lot Size:
                </label>
                <input
                  id="lot-size"
                  type="number"
                  value={lotSize}
                  onChange={(event) => setLotSize(Number(event.target.value))}
                  min="0.1"
                  step="0.1"
                  className="w-24 rounded border border-gray-600 bg-gray-900 px-3 py-2 text-white focus:border-yellow-500 focus:outline-none"
                  disabled={isDisqualified || position !== null}
                />
              </div>
              <div className="flex gap-4">
                <button
                  onClick={() => handleTrade("SELL")}
                  disabled={isDisqualified || position !== null}
                  className="rounded bg-red-500 px-8 py-2.5 font-bold text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  SELL
                </button>
                <button
                  onClick={() => handleTrade("BUY")}
                  disabled={isDisqualified || position !== null}
                  className="rounded bg-green-500 px-8 py-2.5 font-bold text-white transition-colors hover:bg-green-600 disabled:opacity-50"
                >
                  BUY
                </button>
              </div>
            </div>

            {position ? (
              <div className="flex items-center justify-between rounded border border-gray-700 bg-gray-900 p-4">
                <div>
                  <span
                    className={`font-bold ${
                      position.type === "BUY" ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {position.type} {position.lots} Lots
                  </span>
                  <span className="ml-4 text-sm text-gray-400">
                    Entry: ${position.entry.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-6">
                  <span
                    className={`font-mono text-xl ${
                      floatingPnL >= 0 ? "text-green-400" : "text-red-400"
                    }`}
                  >
                    {floatingPnL >= 0 ? "+" : ""}${floatingPnL.toFixed(2)}
                  </span>
                  <button
                    onClick={closePosition}
                    className="rounded bg-yellow-600 px-4 py-2 text-sm font-semibold text-white hover:bg-yellow-700"
                  >
                    CLOSE TRADE
                  </button>
                </div>
              </div>
            ) : (
              <p className="py-2 text-center text-sm text-gray-500">No open positions.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
