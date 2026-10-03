"use client";

import { useEffect, useState } from "react";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";

type GameState = {
  isRunning: boolean;
  startTime: number | null;
};

type Player = {
  id: string;
  alias: string;
  email: string;
  balance: number;
  isDisqualified: boolean;
};

type ActionState = {
  playerId: string | null;
  type: "balance" | "disqualify" | "delete" | null;
};

const initialGameState: GameState = { isRunning: false, startTime: null };

const toPlayer = (snapshot: QueryDocumentSnapshot<DocumentData>): Player => {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    alias: typeof data.alias === "string" ? data.alias : "Unknown player",
    email: typeof data.email === "string" ? data.email : "—",
    balance: typeof data.balance === "number" && Number.isFinite(data.balance) ? data.balance : 0,
    isDisqualified: data.isDisqualified === true,
  };
};

export default function SecretAdminDashboard() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const [error, setError] = useState<string | null>(null);
  const [actionState, setActionState] = useState<ActionState>({
    playerId: null,
    type: null,
  });

  useEffect(() => {
    return onSnapshot(
      doc(db, "system", "gameState"),
      (snapshot) => {
        if (!snapshot.exists()) {
          setGameState(initialGameState);
          return;
        }

        const data = snapshot.data();
        setGameState({
          isRunning: data.isRunning === true,
          startTime: typeof data.startTime === "number" ? data.startTime : null,
        });
      },
      () => setError("Unable to load the global game state."),
    );
  }, []);

  useEffect(() => {
    const playersQuery = query(collection(db, "players"), orderBy("balance", "desc"));
    return onSnapshot(
      playersQuery,
      (snapshot) => {
        setPlayers(snapshot.docs.map(toPlayer));
      },
      () => setError("Unable to load players. Check the Firestore index and permissions."),
    );
  }, []);

  const runAction = async (
    action: () => Promise<void>,
    state: ActionState,
    failureMessage: string,
  ) => {
    setError(null);
    setActionState(state);
    try {
      await action();
    } catch {
      setError(failureMessage);
    } finally {
      setActionState({ playerId: null, type: null });
    }
  };

  const startTournament = async () => {
    if (!window.confirm("START THE BATTLE? This syncs all players to Tick 0.")) return;
    await runAction(
      () => setDoc(doc(db, "system", "gameState"), { isRunning: true, startTime: Date.now() }),
      { playerId: null, type: null },
      "Unable to start the tournament.",
    );
  };

  const stopTournament = async () => {
    if (!window.confirm("STOP THE BATTLE? This freezes all charts and locks trading.")) return;
    await runAction(
      () => setDoc(doc(db, "system", "gameState"), { isRunning: false, startTime: null }),
      { playerId: null, type: null },
      "Unable to stop the tournament.",
    );
  };

  const handleUpdateBalance = async (player: Player) => {
    const input = window.prompt("Enter new balance for this player:", player.balance.toString());
    if (input === null || input.trim() === "") return;

    const newBalance = Number(input);
    if (!Number.isFinite(newBalance) || newBalance < 0) {
      setError("Balance must be a non-negative number.");
      return;
    }

    await runAction(
      () => updateDoc(doc(db, "players", player.id), { balance: newBalance }),
      { playerId: player.id, type: "balance" },
      `Unable to update ${player.alias}'s balance.`,
    );
  };

  const handleToggleDisqualify = async (player: Player) => {
    await runAction(
      () =>
        updateDoc(doc(db, "players", player.id), {
          isDisqualified: !player.isDisqualified,
        }),
      { playerId: player.id, type: "disqualify" },
      `Unable to update ${player.alias}'s status.`,
    );
  };

  const handleDelete = async (player: Player) => {
    if (!window.confirm(`Delete ${player.alias} permanently?`)) return;
    await runAction(
      () => deleteDoc(doc(db, "players", player.id)),
      { playerId: player.id, type: "delete" },
      `Unable to delete ${player.alias}.`,
    );
  };

  const isBusy = (playerId: string, type: ActionState["type"]) =>
    actionState.playerId === playerId && actionState.type === type;

  return (
    <main className="min-h-screen bg-slate-950 p-4 font-sans text-slate-200 md:p-8">
      <div className="mx-auto max-w-6xl">
        <h1 className="mb-8 bg-gradient-to-r from-red-500 to-yellow-500 bg-clip-text text-3xl font-black tracking-tighter text-transparent md:text-4xl">
          MASTER ADMIN DASHBOARD
        </h1>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-red-300"
          >
            <span>{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="font-bold text-red-200 hover:text-white"
              aria-label="Dismiss error"
            >
              Dismiss
            </button>
          </div>
        )}

        <section className="mb-8 flex flex-col items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 shadow-2xl md:flex-row md:items-center md:p-6">
          <div>
            <h2 className="mb-1 text-xl font-bold text-white">Global Market Engine</h2>
            <p className="text-sm text-slate-400">
              Controls the synchronized chart for all players in the room.
            </p>
          </div>
          <div className="flex w-full flex-col items-center gap-4 md:w-auto md:flex-row">
            <span
              className={`w-full rounded-lg border px-4 py-3 text-center font-mono font-bold md:w-auto md:py-2 ${
                gameState.isRunning
                  ? "animate-pulse border-emerald-500/50 bg-emerald-500/20 text-emerald-400"
                  : "border-slate-700 bg-slate-800 text-slate-400"
              }`}
            >
              STATUS: {gameState.isRunning ? "LIVE BATTLE RUNNING" : "WAITING / STOPPED"}
            </span>
            {!gameState.isRunning ? (
              <button
                type="button"
                onClick={startTournament}
                className="w-full rounded-lg bg-emerald-600 px-6 py-3 font-black text-white shadow-lg shadow-emerald-600/20 hover:bg-emerald-500 md:w-auto"
              >
                START 25-MIN TOURNAMENT
              </button>
            ) : (
              <button
                type="button"
                onClick={stopTournament}
                className="w-full rounded-lg bg-red-600 px-6 py-3 font-black text-white shadow-lg shadow-red-600/20 hover:bg-red-500 md:w-auto"
              >
                FORCE STOP BATTLE
              </button>
            )}
          </div>
        </section>

        <section className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="bg-slate-950 text-xs uppercase text-slate-400">
              <tr>
                <th className="px-6 py-4">Rank</th>
                <th className="px-6 py-4">Alias</th>
                <th className="px-6 py-4">Email</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Balance</th>
                <th className="px-6 py-4 text-right">Admin Actions</th>
              </tr>
            </thead>
            <tbody>
              {players.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center italic text-slate-500">
                    No players registered yet.
                  </td>
                </tr>
              ) : (
                players.map((player, index) => (
                  <tr key={player.id} className="border-b border-slate-800 hover:bg-slate-800/50">
                    <td className="px-6 py-4 font-mono font-bold text-slate-500">#{index + 1}</td>
                    <td className="px-6 py-4 font-bold text-white">{player.alias}</td>
                    <td className="px-6 py-4 text-slate-400">{player.email}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded px-2 py-1 text-xs font-bold uppercase tracking-wider ${
                          player.isDisqualified
                            ? "bg-red-400/10 text-red-400"
                            : "bg-emerald-400/10 text-emerald-400"
                        }`}
                      >
                        {player.isDisqualified ? "Disqualified" : "Active"}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-lg font-bold">
                      ${player.balance.toFixed(2)}
                    </td>
                    <td className="flex justify-end gap-2 px-6 py-4 text-right">
                      <button
                        type="button"
                        disabled={actionState.playerId !== null}
                        onClick={() => void handleUpdateBalance(player)}
                        className="rounded bg-blue-500/20 px-3 py-1.5 text-xs font-bold text-blue-400 transition-colors hover:bg-blue-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy(player.id, "balance") ? "Saving..." : "Edit Bal"}
                      </button>
                      <button
                        type="button"
                        disabled={actionState.playerId !== null}
                        onClick={() => void handleToggleDisqualify(player)}
                        className={`rounded px-3 py-1.5 text-xs font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          player.isDisqualified
                            ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500 hover:text-white"
                            : "bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500 hover:text-white"
                        }`}
                      >
                        {isBusy(player.id, "disqualify")
                          ? "Saving..."
                          : player.isDisqualified
                            ? "Revive"
                            : "DQ"}
                      </button>
                      <button
                        type="button"
                        disabled={actionState.playerId !== null}
                        onClick={() => void handleDelete(player)}
                        className="rounded bg-red-500/20 px-3 py-1.5 text-xs font-bold text-red-500 transition-colors hover:bg-red-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isBusy(player.id, "delete") ? "Deleting..." : "Delete"}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
