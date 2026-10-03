"use client";

import { useMemo, useState } from "react";

type ResultPlayer = {
  id: string;
  alias: string;
  balance: number;
  isDisqualified: boolean;
};

export default function TournamentResults({ players }: { players: ResultPlayer[] }) {
  const [showResults, setShowResults] = useState(false);
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => b.balance - a.balance),
    [players],
  );
  const top3 = sortedPlayers.slice(0, 3);

  if (!showResults) {
    return (
      <div className="my-8 flex justify-center">
        <button
          type="button"
          onClick={() => setShowResults(true)}
          className="rounded-2xl bg-gradient-to-r from-blue-600 to-emerald-600 px-8 py-5 text-lg font-black text-white shadow-[0_0_40px_rgba(16,185,129,0.3)] transition-all hover:scale-105 hover:from-blue-500 hover:to-emerald-500 md:px-12 md:py-6 md:text-xl"
        >
          GENERATE FINAL RESULTS
        </button>
      </div>
    );
  }

  return (
    <section className="mx-auto w-full max-w-4xl animate-[fadeIn_0.5s_ease-out] rounded-3xl border border-slate-800 bg-slate-950 p-5 shadow-2xl md:p-8">
      <div className="mb-12 text-center">
        <h2 className="bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-3xl font-black tracking-tighter text-transparent md:text-4xl">
          FINAL LEADERBOARD
        </h2>
        <p className="mt-2 text-slate-400">Tournament Concluded</p>
      </div>

      <div className="mb-16 flex h-64 items-end justify-center gap-2 md:gap-8">
        {[top3[1], top3[0], top3[2]].map((player) => {
          if (!player) return null;
          const rank = player === top3[0] ? 1 : player === top3[1] ? 2 : 3;
          const isWinner = rank === 1;
          const height = isWinner ? "h-32" : rank === 2 ? "h-24" : "h-16";
          const animationDelay = rank === 1 ? "1s" : rank === 2 ? "0.6s" : "0.2s";

          return (
            <div
              key={player.id}
              className={`flex w-1/3 max-w-[180px] flex-col items-center animate-[slideUp_0.5s_ease-out_both] ${
                isWinner ? "z-10" : ""
              }`}
              style={{ animationDelay }}
            >
              <div
                className={`w-full rounded-t-2xl border-2 bg-slate-900 p-3 text-center md:p-4 ${
                  isWinner
                    ? "border-yellow-400/80 shadow-[0_0_50px_rgba(250,204,21,0.3)]"
                    : rank === 2
                      ? "border-slate-400/50 shadow-[0_0_30px_rgba(148,163,184,0.2)]"
                      : "border-amber-600/50 shadow-[0_0_30px_rgba(217,119,6,0.15)]"
                } ${isWinner ? "-translate-y-4" : ""}`}
              >
                <div
                  className={`mb-2 font-black ${
                    isWinner ? "text-3xl text-yellow-400 md:text-4xl" : "text-2xl text-slate-400"
                  }`}
                >
                  #{rank}
                </div>
                <div className="w-full truncate font-bold text-white">{player.alias}</div>
                <div className="mt-1 font-mono text-sm text-slate-400">
                  ${player.balance.toFixed(2)}
                </div>
              </div>
              <div className={`w-full border-x border-slate-800 bg-gradient-to-b from-slate-800 to-slate-950 ${height}`} />
            </div>
          );
        })}
      </div>

      <div className="custom-scrollbar max-h-96 space-y-3 overflow-y-auto pr-2">
        {sortedPlayers.slice(3).map((player, index) => (
          <div
            key={player.id}
            className="flex animate-[fadeIn_0.5s_ease-out_1.5s_both] items-center justify-between rounded-xl border border-slate-800 bg-slate-900 p-4 transition-colors hover:border-slate-700"
          >
            <div className="flex items-center gap-4">
              <div className="w-8 font-mono font-bold text-slate-500">#{index + 4}</div>
              <div className="font-bold text-white">{player.alias}</div>
              {player.isDisqualified && (
                <span className="rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-500">
                  Bust
                </span>
              )}
            </div>
            <div className="font-mono font-bold text-slate-300">${player.balance.toFixed(2)}</div>
          </div>
        ))}
      </div>

      <style jsx>{`
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0f172a; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #1e293b; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #334155; }
      `}</style>
    </section>
  );
}
